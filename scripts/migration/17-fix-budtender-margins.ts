/**
 * Fix Budtender Margin Decimal Values
 *
 * Corrects budtender record margins that were stored as decimals (0.70)
 * instead of percentages (70.0).
 *
 * Run with: npx tsx scripts/migration/17-fix-budtender-margins.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('========================================');
  console.log('Fix Budtender Record Margin Values');
  console.log('========================================\n');

  // Get all budtender records with margin values that look like decimals
  // Margins should be in -1 to 1 range if stored as decimals
  const budtenderRecords = await prisma.budtenderRecord.findMany({
    where: {
      grossMarginPct: {
        gte: -10,
        lte: 2,
      },
    },
    select: {
      id: true,
      employeeName: true,
      grossMarginPct: true,
    },
  });

  console.log(`Found ${budtenderRecords.length} budtender records with decimal margins to fix\n`);

  // Update records
  console.log('Updating budtender records...');
  let updated = 0;
  let skipped = 0;

  for (const record of budtenderRecords) {
    const oldMargin = Number(record.grossMarginPct);

    // Skip if already looks like a percentage (> 2)
    if (oldMargin > 2 || oldMargin < -10) {
      skipped++;
      continue;
    }

    const newMargin = oldMargin * 100;

    await prisma.budtenderRecord.update({
      where: { id: record.id },
      data: {
        grossMarginPct: new Prisma.Decimal(newMargin),
      },
    });
    updated++;

    if (updated % 50 === 0) {
      process.stdout.write(`\r  Updated ${updated}/${budtenderRecords.length}...`);
    }
  }
  console.log(`\n  Updated ${updated} budtender records (skipped ${skipped})`);

  // Verify the fix
  console.log('\n========================================');
  console.log('Verification');
  console.log('========================================\n');

  const verifyRecords = await prisma.budtenderRecord.findMany({
    take: 15,
    orderBy: { netSales: 'desc' },
    select: {
      employeeName: true,
      grossMarginPct: true,
      netSales: true,
      unitsSold: true,
    },
  });

  console.log('Top 15 budtenders after fix:\n');
  console.log('Employee'.padEnd(25) + 'Margin %'.padStart(12) + 'Units'.padStart(10) + 'Net Sales'.padStart(14));
  console.log('-'.repeat(61));

  for (const record of verifyRecords) {
    const marginValue = Number(record.grossMarginPct);
    const netSales = Number(record.netSales);
    console.log(
      record.employeeName.slice(0, 23).padEnd(25) +
      (marginValue.toFixed(1) + '%').padStart(12) +
      record.unitsSold.toString().padStart(10) +
      `$${netSales.toLocaleString()}`.padStart(14)
    );
  }

  // Statistics after fix
  const allRecords = await prisma.budtenderRecord.findMany({
    select: { grossMarginPct: true },
  });

  const marginValues = allRecords.map(r => Number(r.grossMarginPct));
  const avgMargin = marginValues.reduce((a, b) => a + b, 0) / marginValues.length;

  console.log(`\nAverage margin after fix: ${avgMargin.toFixed(1)}%`);

  if (avgMargin >= 30 && avgMargin <= 90) {
    console.log('✓ Margins now appear to be in correct percentage format!');
  }

  console.log('\n========================================');
  console.log('BUDTENDER MARGIN FIX COMPLETE');
  console.log('========================================');
  console.log(`Records updated: ${updated}`);
  console.log(`Records skipped: ${skipped}`);

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
