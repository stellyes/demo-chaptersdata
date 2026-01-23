/**
 * Recover Vendors from Line Items
 *
 * For invoices with null vendor, extract the dominant brand from line items
 * and link to an existing or new vendor.
 *
 * Run with: npx tsx scripts/migration/08-recover-vendors-from-lineitems.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Brand name normalizations (common variations -> canonical name)
const BRAND_NORMALIZATIONS: Record<string, string> = {
  'PURE XTRACTS': 'PUREXTRACTS',
  'PLUS GUMMIES': 'PLUS',
  'PLUS PRODUCTS': 'PLUS',
  "BIG PETE'S": 'BIG PETES',
  'BIG PETES TREATS': 'BIG PETES',
  'CART - EEL RIVER': 'EEL RIVER ORGANICS',
  "HENRY'S ORIGINAL": 'HENRYS ORIGINAL',
  'SINGLE INFUSED -': null, // Skip - too generic
  'BUENA VISTA': 'BUENA VISTA',
  'PACIFIC RESERVE': 'PACIFIC RESERVE',
  'FIG FARMS': 'FIG FARMS',
  'STONE ROAD': 'STONE ROAD',
  'LOST FARM': 'LOST FARM',
  'CAVIAR GOLD': 'CAVIAR GOLD',
  'CAMINO': 'KIVA SALES & SERVICE', // Camino is a Kiva brand
  'WALLY DROPS': 'WALLY',
  'BARBARY COAST': null, // Skip - this is the dispensary, not a vendor
};

// Brands to skip (dispensary names, generic terms)
const SKIP_BRANDS = new Set([
  'BARBARY COAST',
  'GRASS ROOTS',
  'SINGLE INFUSED -',
  'INFUSED',
  'FLOWER',
  'PREROLL',
  'EDIBLE',
  'TOPICAL',
  'VAPE',
  'CARTRIDGE',
  'CONCENTRATE',
  '',
]);

interface BrandCount {
  brand: string;
  count: number;
}

async function getDominantBrand(invoiceId: string): Promise<string | null> {
  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { invoiceId },
    select: { originalBrandName: true },
  });

  if (lineItems.length === 0) return null;

  // Count brand occurrences
  const brandCounts: Record<string, number> = {};
  for (const item of lineItems) {
    const brand = item.originalBrandName?.trim().toUpperCase();
    if (!brand || SKIP_BRANDS.has(brand)) continue;

    // Apply normalizations
    let normalizedBrand = BRAND_NORMALIZATIONS[brand];
    if (normalizedBrand === null) continue; // Explicitly skip
    if (normalizedBrand === undefined) normalizedBrand = brand;

    brandCounts[normalizedBrand] = (brandCounts[normalizedBrand] || 0) + 1;
  }

  // Find most common brand
  let maxCount = 0;
  let dominantBrand: string | null = null;
  for (const [brand, count] of Object.entries(brandCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantBrand = brand;
    }
  }

  // Only return if dominant (>50% of line items or only brand)
  const total = Object.values(brandCounts).reduce((a, b) => a + b, 0);
  if (dominantBrand && (maxCount >= total * 0.4 || Object.keys(brandCounts).length === 1)) {
    return dominantBrand;
  }

  return null;
}

async function getOrCreateVendor(brandName: string): Promise<string> {
  // Check if vendor exists
  let vendor = await prisma.vendor.findFirst({
    where: { canonicalName: brandName },
  });

  if (vendor) return vendor.id;

  // Check aliases
  const alias = await prisma.vendorAlias.findFirst({
    where: { aliasName: brandName },
    include: { vendor: true },
  });

  if (alias) return alias.vendor.id;

  // Create new vendor
  vendor = await prisma.vendor.create({
    data: { canonicalName: brandName },
  });

  // Create alias for the brand name
  await prisma.vendorAlias.create({
    data: {
      aliasName: brandName,
      vendorId: vendor.id,
    },
  });

  return vendor.id;
}

async function main() {
  console.log('========================================');
  console.log('Recover Vendors from Line Items');
  console.log('========================================\n');

  // Get unlinked invoices with line items
  console.log('[1/3] Finding unlinked invoices with line items...');
  const unlinkedInvoices = await prisma.invoice.findMany({
    where: {
      vendorId: null,
      lineItems: { some: {} },
    },
    select: { id: true, invoiceId: true },
  });

  console.log(`Found ${unlinkedInvoices.length} unlinked invoices with line items\n`);

  // Process each invoice
  console.log('[2/3] Extracting dominant brands and linking vendors...');
  let linked = 0;
  let noVendor = 0;
  const vendorCounts: Record<string, number> = {};
  const newVendors: string[] = [];

  for (let i = 0; i < unlinkedInvoices.length; i++) {
    const inv = unlinkedInvoices[i];

    if (i % 100 === 0) {
      process.stdout.write(`\r  Processing ${i}/${unlinkedInvoices.length}...`);
    }

    const dominantBrand = await getDominantBrand(inv.id);

    if (!dominantBrand) {
      noVendor++;
      continue;
    }

    try {
      // Check if vendor is new
      const existingVendor = await prisma.vendor.findFirst({
        where: { canonicalName: dominantBrand },
      });

      const vendorId = await getOrCreateVendor(dominantBrand);

      if (!existingVendor) {
        newVendors.push(dominantBrand);
      }

      // Link invoice to vendor
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          vendorId,
          originalVendorName: dominantBrand,
        },
      });

      linked++;
      vendorCounts[dominantBrand] = (vendorCounts[dominantBrand] || 0) + 1;
    } catch (err) {
      console.error(`\nError linking invoice ${inv.invoiceId}: ${err}`);
    }
  }

  console.log('\n');

  // Results
  console.log('[3/3] Results:');
  console.log('-'.repeat(50));
  console.log(`Total processed:     ${unlinkedInvoices.length}`);
  console.log(`Invoices linked:     ${linked}`);
  console.log(`No dominant brand:   ${noVendor}`);
  console.log(`New vendors created: ${newVendors.length}`);

  // Top vendors
  const sortedVendors = Object.entries(vendorCounts).sort((a, b) => b[1] - a[1]);
  console.log('\nTop vendors linked:');
  for (const [vendor, count] of sortedVendors.slice(0, 20)) {
    console.log(`  ${vendor}: ${count}`);
  }

  // New vendors created
  if (newVendors.length > 0) {
    console.log('\nNew vendors created:');
    for (const v of newVendors.slice(0, 30)) {
      console.log(`  - ${v}`);
    }
    if (newVendors.length > 30) {
      console.log(`  ... and ${newVendors.length - 30} more`);
    }
  }

  // Final count
  const remainingUnlinked = await prisma.invoice.count({
    where: { vendorId: null },
  });
  console.log(`\nRemaining unlinked invoices: ${remainingUnlinked}`);

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
