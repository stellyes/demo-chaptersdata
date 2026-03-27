/**
 * Ingest Treez Product Summary CSVs from LOCAL disk into sales_line_items table.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/ingest-treez-local.ts <directory> <store_name>
 *
 * Example:
 *   DATABASE_URL="..." npx tsx scripts/ingest-treez-local.ts /tmp/treez-ingest/barbary "Barbary Coast - SF Mission"
 *   DATABASE_URL="..." npx tsx scripts/ingest-treez-local.ts /tmp/treez-ingest/grassroots "Grass Roots - SF"
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const dir = process.argv[2];
const storeName = process.argv[3];

if (!dir || !storeName) {
  console.error('Usage: npx tsx scripts/ingest-treez-local.ts <directory> <store_name>');
  process.exit(1);
}

function parseNum(value: string | undefined): number {
  if (!value || value === '') return 0;
  const cleaned = value.replace(/[$,%"]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseDateField(value: string | undefined): Date | null {
  if (!value) return null;
  const clean = value.replace(/"/g, '').trim();
  const match = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const d = new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
  return isNaN(d.getTime()) ? null : d;
}

function parseDob(value: string | undefined): Date | null {
  if (!value || value === 'N/A' || value === '') return null;
  const d = new Date(value.replace(/"/g, '').trim());
  return isNaN(d.getTime()) ? null : d;
}

function findCsvFiles(directory: string): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.csv')) {
        const stat = fs.statSync(full);
        if (stat.size > 2000) files.push(full);
      }
    }
  }
  walk(directory);
  return files.sort();
}

async function ingestFile(filePath: string): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  });

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of records) {
    const dateOpen = parseDateField(row['Date Open']);
    const ticketId = (row['Ticket ID'] || '').replace(/"/g, '').trim();
    const ticketLineId = (row['Ticket Line ID'] || '').replace(/"/g, '').trim();

    if (!dateOpen || !ticketId || !ticketLineId) {
      skipped++;
      continue;
    }

    try {
      await prisma.salesLineItem.upsert({
        where: {
          ticketId_ticketLineId_dateOpen: { ticketId, ticketLineId, dateOpen },
        },
        create: {
          storeName,
          ticketId,
          ticketLineId,
          dateOpen,
          dateClose: parseDateField(row['Date Closed']),
          originalBrandName: (row['Brand'] || '').trim() || null,
          productName: (row['Product Name'] || '').trim() || null,
          productType: (row['Product Type'] || '').trim() || null,
          productSubtype: (row['Subtype'] || '').trim() || null,
          classification: (row['Classification'] || '').trim() || null,
          stateTrackingId: (row['State Tracking ID'] || '').trim() || null,
          batch: (row['Batch'] || '').trim() || null,
          distributor: (row['Distributor'] || '').trim() || null,
          quantity: Math.round(parseNum(row['Qty'])),
          pricePerUnit: new Prisma.Decimal(parseNum(row['Price/Unit'])),
          grossSales: new Prisma.Decimal(parseNum(row['Gross Sales'])),
          discounts: new Prisma.Decimal(parseNum(row['Discounts'])),
          returns: new Prisma.Decimal(parseNum(row['Returns'])),
          netSales: new Prisma.Decimal(parseNum(row['Net Sales'])),
          taxes: new Prisma.Decimal(parseNum(row['Taxes'])),
          costWithoutExcise: new Prisma.Decimal(parseNum(row['Cost Without Excise'])),
          costWithExcise: new Prisma.Decimal(parseNum(row['Cost With Excise'])),
          customerTreezId: (row['Customer ID'] || '').trim() || null,
          customerName: (row['Customer Name'] || '').trim() || null,
          customerDob: parseDob(row['DOB']),
          customerGender: (row['Gender'] || '').trim() || null,
          customerAge: row['Age'] ? parseInt(row['Age']) || null : null,
          customerCity: (row['City'] || '').trim() || null,
          customerState: (row['State/Province'] || '').trim() || null,
          customerZip: (row['Zip Code'] || '').trim() || null,
          size: (row['Size'] || '').trim() || null,
          totalMgThc: row['Total Mg THC'] ? new Prisma.Decimal(parseNum(row['Total Mg THC'])) : null,
          totalMgCbd: row['Total Mg CBD'] ? new Prisma.Decimal(parseNum(row['Total Mg CBD'])) : null,
          cashier: (row['Cashier'] || '').trim() || null,
          registerNumber: (row['Register #'] || '').trim() || null,
        },
        update: {
          storeName,
          dateClose: parseDateField(row['Date Closed']),
          originalBrandName: (row['Brand'] || '').trim() || null,
          productName: (row['Product Name'] || '').trim() || null,
          productType: (row['Product Type'] || '').trim() || null,
          productSubtype: (row['Subtype'] || '').trim() || null,
          classification: (row['Classification'] || '').trim() || null,
          distributor: (row['Distributor'] || '').trim() || null,
          quantity: Math.round(parseNum(row['Qty'])),
          pricePerUnit: new Prisma.Decimal(parseNum(row['Price/Unit'])),
          grossSales: new Prisma.Decimal(parseNum(row['Gross Sales'])),
          discounts: new Prisma.Decimal(parseNum(row['Discounts'])),
          returns: new Prisma.Decimal(parseNum(row['Returns'])),
          netSales: new Prisma.Decimal(parseNum(row['Net Sales'])),
          taxes: new Prisma.Decimal(parseNum(row['Taxes'])),
          costWithoutExcise: new Prisma.Decimal(parseNum(row['Cost Without Excise'])),
          costWithExcise: new Prisma.Decimal(parseNum(row['Cost With Excise'])),
        },
      });
      inserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Unique constraint')) {
        errors.push(`ticket=${ticketId}: ${msg.slice(0, 100)}`);
      }
      skipped++;
    }
  }

  return { inserted, skipped, errors };
}

async function main() {
  console.log('===========================================');
  console.log('Treez Local CSV -> sales_line_items');
  console.log(`Store: ${storeName}`);
  console.log(`Directory: ${dir}`);
  console.log('===========================================\n');

  const files = findCsvFiles(dir);
  console.log(`Found ${files.length} CSV files with data\n`);

  let totalInserted = 0;
  let totalSkipped = 0;
  const allErrors: string[] = [];

  for (const file of files) {
    const shortName = path.basename(file);
    process.stdout.write(`  ${shortName}...`);

    const result = await ingestFile(file);
    totalInserted += result.inserted;
    totalSkipped += result.skipped;
    allErrors.push(...result.errors);

    console.log(` ${result.inserted} rows inserted, ${result.skipped} skipped`);
  }

  console.log('\n===========================================');
  console.log('Done!');
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}`);

  if (allErrors.length > 0) {
    console.log(`\nErrors (${allErrors.length}):`);
    allErrors.slice(0, 15).forEach(e => console.log(`  - ${e}`));
    if (allErrors.length > 15) console.log(`  ... and ${allErrors.length - 15} more`);
  }

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
