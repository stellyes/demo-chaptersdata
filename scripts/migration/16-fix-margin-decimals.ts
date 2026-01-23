/**
 * Fix Margin Decimal Values
 *
 * Corrects brand record margins that were stored as decimals (0.70)
 * instead of percentages (70.0).
 *
 * Run with: npx tsx scripts/migration/16-fix-margin-decimals.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('========================================');
  console.log('Fix Brand Record Margin Values');
  console.log('========================================\n');

  // Get all brand records with margin values that look like decimals (< 2)
  const brandRecords = await prisma.brandRecord.findMany({
    where: {
      grossMarginPct: {
        lt: 2,
        gt: -2,
      },
    },
    select: {
      id: true,
      originalBrandName: true,
      grossMarginPct: true,
    },
  });

  console.log(`Found ${brandRecords.length} brand records with decimal margins to fix\n`);

  // Also check product records
  const productRecords = await prisma.productRecord.findMany({
    where: {
      grossMarginPct: {
        lt: 2,
        gt: -2,
      },
    },
    select: {
      id: true,
      productType: true,
      grossMarginPct: true,
    },
  });

  console.log(`Found ${productRecords.length} product records with decimal margins to fix\n`);

  // Update brand records
  console.log('Updating brand records...');
  let brandUpdated = 0;

  for (const record of brandRecords) {
    const oldMargin = Number(record.grossMarginPct);
    const newMargin = oldMargin * 100;

    // Skip if already looks like a percentage or is negative outlier
    if (oldMargin > 1 || oldMargin < -1) continue;

    await prisma.brandRecord.update({
      where: { id: record.id },
      data: {
        grossMarginPct: new Prisma.Decimal(newMargin),
      },
    });
    brandUpdated++;

    if (brandUpdated % 500 === 0) {
      process.stdout.write(`\r  Updated ${brandUpdated}/${brandRecords.length}...`);
    }
  }
  console.log(`\n  Updated ${brandUpdated} brand records`);

  // Update product records
  console.log('\nUpdating product records...');
  let productUpdated = 0;

  for (const record of productRecords) {
    const oldMargin = Number(record.grossMarginPct);
    const newMargin = oldMargin * 100;

    // Skip if already looks like a percentage
    if (oldMargin > 1 || oldMargin < -1) continue;

    await prisma.productRecord.update({
      where: { id: record.id },
      data: {
        grossMarginPct: new Prisma.Decimal(newMargin),
      },
    });
    productUpdated++;
  }
  console.log(`  Updated ${productUpdated} product records`);

  // Verify the fix
  console.log('\n========================================');
  console.log('Verification');
  console.log('========================================\n');

  const verifyBrands = await prisma.brandRecord.findMany({
    take: 10,
    orderBy: { netSales: 'desc' },
    select: {
      originalBrandName: true,
      grossMarginPct: true,
      netSales: true,
    },
  });

  console.log('Top 10 brands after fix:\n');
  console.log('Brand'.padEnd(40) + 'Margin %'.padStart(12) + 'Net Sales'.padStart(15));
  console.log('-'.repeat(67));

  for (const record of verifyBrands) {
    const marginValue = Number(record.grossMarginPct);
    const netSales = Number(record.netSales);
    console.log(
      record.originalBrandName.slice(0, 38).padEnd(40) +
      marginValue.toFixed(1).padStart(12) + '%' +
      `$${netSales.toLocaleString()}`.padStart(14)
    );
  }

  // Statistics after fix
  const allMargins = await prisma.brandRecord.findMany({
    select: { grossMarginPct: true },
  });

  const marginValues = allMargins.map(r => Number(r.grossMarginPct));
  const avgMargin = marginValues.reduce((a, b) => a + b, 0) / marginValues.length;

  console.log(`\nAverage margin after fix: ${avgMargin.toFixed(1)}%`);

  if (avgMargin >= 30 && avgMargin <= 80) {
    console.log('✓ Margins now appear to be in correct percentage format!');
  }

  console.log('\n========================================');
  console.log('MARGIN FIX COMPLETE');
  console.log('========================================');
  console.log(`Brand records updated:   ${brandUpdated}`);
  console.log(`Product records updated: ${productUpdated}`);

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
