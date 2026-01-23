/**
 * Link BrandRecords to CanonicalBrand
 *
 * BrandRecords track brand performance (sales, margins) but aren't linked to the
 * canonical brand table. This script links them using the brand alias lookup.
 *
 * Run with: npx tsx scripts/migration/12-link-brand-records.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('========================================');
  console.log('Link BrandRecords to CanonicalBrand');
  console.log('========================================\n');

  // Build brand alias lookup
  console.log('[1/3] Building brand alias lookup...');

  const brandAliases = await prisma.brandAlias.findMany({
    include: { brand: true },
  });

  const aliasToCanonical = new Map<string, { brandId: string; canonicalName: string }>();

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
  }

  console.log(`  Loaded ${aliasToCanonical.size} brand aliases/names`);

  // Get unlinked brand records
  console.log('\n[2/3] Linking BrandRecords...');

  const unlinkedRecords = await prisma.brandRecord.findMany({
    where: { brandId: null },
    select: { id: true, originalBrandName: true },
  });

  console.log(`  Found ${unlinkedRecords.length} unlinked BrandRecords`);

  let linked = 0;
  let notFound = 0;
  const unmatchedBrands = new Map<string, number>();

  for (let i = 0; i < unlinkedRecords.length; i++) {
    const record = unlinkedRecords[i];
    const originalName = record.originalBrandName?.trim().toUpperCase();

    if (!originalName) {
      notFound++;
      continue;
    }

    // Try exact match
    let match = aliasToCanonical.get(originalName);

    // Try without common suffixes
    if (!match) {
      const cleanedName = originalName
        .replace(/\s*(LLC|INC|CORP|CO|COMPANY|DISTRIBUTION|DIST|FARMS?|COLLECTIVE)\.?\s*$/i, '')
        .trim();
      match = aliasToCanonical.get(cleanedName);
    }

    if (match) {
      await prisma.brandRecord.update({
        where: { id: record.id },
        data: { brandId: match.brandId },
      });
      linked++;
    } else {
      notFound++;
      unmatchedBrands.set(originalName, (unmatchedBrands.get(originalName) || 0) + 1);
    }

    if (i % 500 === 0) {
      process.stdout.write(`\r  Processing ${i}/${unlinkedRecords.length}...`);
    }
  }

  console.log(`\n  Linked: ${linked}`);
  console.log(`  Not found: ${notFound}`);

  // Show top unmatched
  const topUnmatched = Array.from(unmatchedBrands.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  if (topUnmatched.length > 0) {
    console.log('\n  Top unmatched brands:');
    for (const [brand, count] of topUnmatched) {
      console.log(`    ${brand}: ${count}`);
    }
  }

  // Summary
  console.log('\n[3/3] Final summary...');

  const totalRecords = await prisma.brandRecord.count();
  const linkedRecords = await prisma.brandRecord.count({ where: { brandId: { not: null } } });

  console.log(`\n${'='.repeat(50)}`);
  console.log('BRAND RECORD LINKING COMPLETE');
  console.log(`${'='.repeat(50)}`);
  console.log(`Total BrandRecords:  ${totalRecords}`);
  console.log(`Linked to Brand:     ${linkedRecords} (${((linkedRecords/totalRecords)*100).toFixed(1)}%)`);
  console.log(`Still unlinked:      ${totalRecords - linkedRecords}`);

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
