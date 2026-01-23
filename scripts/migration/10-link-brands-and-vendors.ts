/**
 * Link Brands to Line Items and Populate Vendor-Brand Relationships
 *
 * 1. Links InvoiceLineItem records to CanonicalBrand based on originalBrandName → BrandAlias
 * 2. Populates VendorBrand junction table from invoice data
 * 3. Identifies confusing entries for manual review
 *
 * Run with: npx tsx scripts/migration/10-link-brands-and-vendors.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ConfusingEntry {
  lineItemId: string;
  invoiceId: string;
  originalBrandName: string;
  reason: string;
  suggestions?: string[];
}

interface VendorBrandStats {
  vendorId: string;
  vendorName: string;
  brandId: string;
  brandName: string;
  invoiceCount: number;
  totalUnits: number;
  totalCost: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

async function main() {
  console.log('========================================');
  console.log('Link Brands & Populate Vendor-Brand Relationships');
  console.log('========================================\n');

  // ============================================
  // PHASE 1: Build brand alias lookup map
  // ============================================
  console.log('[1/5] Building brand alias lookup map...');

  const brandAliases = await prisma.brandAlias.findMany({
    include: { brand: true },
  });

  // Create lookup maps (case-insensitive)
  const aliasToCanonical = new Map<string, { brandId: string; canonicalName: string }>();
  const canonicalToBrandId = new Map<string, string>();

  for (const alias of brandAliases) {
    const key = alias.aliasName.toUpperCase().trim();
    aliasToCanonical.set(key, {
      brandId: alias.brandId,
      canonicalName: alias.brand.canonicalName,
    });
  }

  // Also add canonical names directly
  const canonicalBrands = await prisma.canonicalBrand.findMany();
  for (const brand of canonicalBrands) {
    const key = brand.canonicalName.toUpperCase().trim();
    if (!aliasToCanonical.has(key)) {
      aliasToCanonical.set(key, {
        brandId: brand.id,
        canonicalName: brand.canonicalName,
      });
    }
    canonicalToBrandId.set(brand.canonicalName, brand.id);
  }

  console.log(`  Loaded ${aliasToCanonical.size} brand aliases/names`);

  // ============================================
  // PHASE 2: Link line items to brands
  // ============================================
  console.log('\n[2/5] Linking line items to brands...');

  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { brandId: null },
    select: {
      id: true,
      invoiceId: true,
      originalBrandName: true,
    },
  });

  console.log(`  Found ${lineItems.length} unlinked line items`);

  let linked = 0;
  let notFound = 0;
  const confusingEntries: ConfusingEntry[] = [];
  const unmatchedBrands = new Map<string, number>();
  const brandLinkCounts: Record<string, number> = {};

  // Process in batches
  const batchSize = 500;
  for (let i = 0; i < lineItems.length; i += batchSize) {
    const batch = lineItems.slice(i, i + batchSize);

    if (i % 2000 === 0) {
      process.stdout.write(`\r  Processing ${i}/${lineItems.length}...`);
    }

    for (const item of batch) {
      const originalName = item.originalBrandName?.trim().toUpperCase();

      if (!originalName || originalName.length < 2) {
        confusingEntries.push({
          lineItemId: item.id,
          invoiceId: item.invoiceId,
          originalBrandName: item.originalBrandName || '(empty)',
          reason: 'Empty or too short brand name',
        });
        notFound++;
        continue;
      }

      // Try exact match first
      let match = aliasToCanonical.get(originalName);

      // Try partial matches if no exact match
      if (!match) {
        // Try removing common suffixes/prefixes
        const cleanedName = originalName
          .replace(/\s*(LLC|INC|CORP|CO|COMPANY|DISTRIBUTION|DIST|FARMS?|COLLECTIVE)\.?\s*$/i, '')
          .trim();

        match = aliasToCanonical.get(cleanedName);
      }

      if (match) {
        await prisma.invoiceLineItem.update({
          where: { id: item.id },
          data: { brandId: match.brandId },
        });
        linked++;
        brandLinkCounts[match.canonicalName] = (brandLinkCounts[match.canonicalName] || 0) + 1;
      } else {
        notFound++;
        unmatchedBrands.set(originalName, (unmatchedBrands.get(originalName) || 0) + 1);

        // Only add to confusing if it appears multiple times
        if ((unmatchedBrands.get(originalName) || 0) === 5) {
          // Find similar brands for suggestions
          const suggestions: string[] = [];
          for (const [aliasKey, value] of aliasToCanonical.entries()) {
            if (aliasKey.includes(originalName.substring(0, 4)) ||
                originalName.includes(aliasKey.substring(0, 4))) {
              suggestions.push(value.canonicalName);
              if (suggestions.length >= 3) break;
            }
          }

          confusingEntries.push({
            lineItemId: item.id,
            invoiceId: item.invoiceId,
            originalBrandName: originalName,
            reason: 'No matching brand alias found',
            suggestions: suggestions.length > 0 ? [...new Set(suggestions)] : undefined,
          });
        }
      }
    }
  }

  console.log('\n');
  console.log(`  Linked: ${linked}`);
  console.log(`  Not found: ${notFound}`);

  // Show top linked brands
  const topBrands = Object.entries(brandLinkCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('\n  Top brands linked:');
  for (const [brand, count] of topBrands) {
    console.log(`    ${brand}: ${count}`);
  }

  // ============================================
  // PHASE 3: Identify and create new brands for common unmatched
  // ============================================
  console.log('\n[3/5] Analyzing unmatched brand names...');

  const commonUnmatched = Array.from(unmatchedBrands.entries())
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  console.log(`  Found ${commonUnmatched.length} unmatched brands with 3+ occurrences`);

  // Create new brands for common unmatched names
  let newBrandsCreated = 0;
  const newBrandIds = new Map<string, string>();

  for (const [brandName, count] of commonUnmatched.slice(0, 100)) {
    // Skip generic names
    const skipPatterns = [
      /^(FLOWER|EDIBLE|VAPE|CARTRIDGE|PREROLL|CONCENTRATE|TOPICAL|TINCTURE)$/i,
      /^(INDICA|SATIVA|HYBRID|CBD|THC)$/i,
      /^(SAMPLE|PROMO|TEST|MISC|OTHER|UNKNOWN)$/i,
      /^[0-9]+$/,
      /^.{1,2}$/,
    ];

    if (skipPatterns.some(p => p.test(brandName))) continue;

    try {
      const newBrand = await prisma.canonicalBrand.create({
        data: { canonicalName: brandName },
      });

      // Create alias
      await prisma.brandAlias.create({
        data: {
          brandId: newBrand.id,
          aliasName: brandName,
        },
      });

      newBrandIds.set(brandName, newBrand.id);
      newBrandsCreated++;
    } catch (e) {
      // Brand might already exist
    }
  }

  console.log(`  Created ${newBrandsCreated} new canonical brands`);

  // Link line items to newly created brands
  if (newBrandIds.size > 0) {
    console.log('  Linking line items to new brands...');
    let newlyLinked = 0;

    const stillUnlinked = await prisma.invoiceLineItem.findMany({
      where: { brandId: null },
      select: { id: true, originalBrandName: true },
    });

    for (const item of stillUnlinked) {
      const key = item.originalBrandName?.trim().toUpperCase();
      if (key && newBrandIds.has(key)) {
        await prisma.invoiceLineItem.update({
          where: { id: item.id },
          data: { brandId: newBrandIds.get(key) },
        });
        newlyLinked++;
      }
    }

    console.log(`  Linked ${newlyLinked} more line items to new brands`);
    linked += newlyLinked;
  }

  // ============================================
  // PHASE 4: Populate VendorBrand junction table
  // ============================================
  console.log('\n[4/5] Populating VendorBrand relationships...');

  // Get all invoices with vendor and line items
  const invoicesWithBrands = await prisma.invoice.findMany({
    where: {
      vendorId: { not: null },
      lineItems: {
        some: {
          brandId: { not: null },
        },
      },
    },
    include: {
      vendor: true,
      lineItems: {
        where: { brandId: { not: null } },
        include: { brand: true },
      },
    },
  });

  console.log(`  Found ${invoicesWithBrands.length} invoices with linked vendors and brands`);

  // Aggregate vendor-brand statistics
  const vendorBrandMap = new Map<string, VendorBrandStats>();

  for (const invoice of invoicesWithBrands) {
    if (!invoice.vendor) continue;

    for (const lineItem of invoice.lineItems) {
      if (!lineItem.brand) continue;

      const key = `${invoice.vendorId}-${lineItem.brandId}`;

      if (!vendorBrandMap.has(key)) {
        vendorBrandMap.set(key, {
          vendorId: invoice.vendorId!,
          vendorName: invoice.vendor.canonicalName,
          brandId: lineItem.brandId!,
          brandName: lineItem.brand.canonicalName,
          invoiceCount: 0,
          totalUnits: 0,
          totalCost: 0,
          firstSeenAt: null,
          lastSeenAt: null,
        });
      }

      const stats = vendorBrandMap.get(key)!;
      stats.invoiceCount++;
      stats.totalUnits += lineItem.skuUnits;
      stats.totalCost += Number(lineItem.totalCost);

      const invoiceDate = invoice.invoiceDate;
      if (invoiceDate) {
        if (!stats.firstSeenAt || invoiceDate < stats.firstSeenAt) {
          stats.firstSeenAt = invoiceDate;
        }
        if (!stats.lastSeenAt || invoiceDate > stats.lastSeenAt) {
          stats.lastSeenAt = invoiceDate;
        }
      }
    }
  }

  console.log(`  Found ${vendorBrandMap.size} unique vendor-brand relationships`);

  // Upsert VendorBrand records
  let vendorBrandsCreated = 0;
  for (const stats of vendorBrandMap.values()) {
    try {
      await prisma.vendorBrand.upsert({
        where: {
          vendorId_brandId: {
            vendorId: stats.vendorId,
            brandId: stats.brandId,
          },
        },
        update: {
          invoiceCount: stats.invoiceCount,
          totalUnits: stats.totalUnits,
          totalCost: stats.totalCost,
          firstSeenAt: stats.firstSeenAt,
          lastSeenAt: stats.lastSeenAt,
        },
        create: {
          vendorId: stats.vendorId,
          brandId: stats.brandId,
          invoiceCount: stats.invoiceCount,
          totalUnits: stats.totalUnits,
          totalCost: stats.totalCost,
          firstSeenAt: stats.firstSeenAt,
          lastSeenAt: stats.lastSeenAt,
        },
      });
      vendorBrandsCreated++;
    } catch (e) {
      console.error(`  Error creating vendor-brand: ${stats.vendorName} -> ${stats.brandName}`);
    }
  }

  console.log(`  Created/updated ${vendorBrandsCreated} VendorBrand records`);

  // ============================================
  // PHASE 5: Summary and confusing entries
  // ============================================
  console.log('\n[5/5] Summary and confusing entries...');

  // Final counts
  const finalLinked = await prisma.invoiceLineItem.count({ where: { brandId: { not: null } } });
  const finalUnlinked = await prisma.invoiceLineItem.count({ where: { brandId: null } });
  const totalVendorBrands = await prisma.vendorBrand.count();

  console.log('\n' + '='.repeat(50));
  console.log('FINAL RESULTS:');
  console.log('='.repeat(50));
  console.log(`Line Items Linked to Brands:   ${finalLinked} (${((finalLinked / (finalLinked + finalUnlinked)) * 100).toFixed(1)}%)`);
  console.log(`Line Items Still Unlinked:     ${finalUnlinked}`);
  console.log(`Vendor-Brand Relationships:    ${totalVendorBrands}`);
  console.log(`New Brands Created:            ${newBrandsCreated}`);

  // Show top unmatched brands for manual review
  const remainingUnmatched = commonUnmatched.slice(0, 30);
  if (remainingUnmatched.length > 0) {
    console.log('\n' + '-'.repeat(50));
    console.log('TOP UNMATCHED BRANDS (for manual review):');
    console.log('-'.repeat(50));
    for (const [brand, count] of remainingUnmatched) {
      console.log(`  ${brand}: ${count} occurrences`);
    }
  }

  // Save confusing entries to file
  if (confusingEntries.length > 0) {
    const fs = await import('fs');
    const path = await import('path');
    const outputPath = path.join(process.cwd(), 'confusing_brand_entries.json');
    fs.writeFileSync(outputPath, JSON.stringify(confusingEntries.slice(0, 100), null, 2));
    console.log(`\nSaved ${Math.min(confusingEntries.length, 100)} confusing entries to: ${outputPath}`);
  }

  // Show vendor-brand examples
  console.log('\n' + '-'.repeat(50));
  console.log('TOP VENDOR-BRAND RELATIONSHIPS:');
  console.log('-'.repeat(50));

  const topVendorBrands = await prisma.vendorBrand.findMany({
    orderBy: { invoiceCount: 'desc' },
    take: 20,
    include: {
      vendor: true,
      brand: true,
    },
  });

  for (const vb of topVendorBrands) {
    console.log(`  ${vb.vendor.canonicalName} → ${vb.brand.canonicalName}: ${vb.invoiceCount} invoices, ${vb.totalUnits} units`);
  }

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
