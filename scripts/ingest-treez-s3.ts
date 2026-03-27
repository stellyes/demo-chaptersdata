/**
 * Ingest Treez Product Summary CSVs from S3 into sales_line_items table.
 *
 * Reads from s3://treez-data-export/exports/ (Barbary Coast) and
 * s3://treez-data-export/exports/grassroots/ (Grass Roots).
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/ingest-treez-s3.ts
 *   DATABASE_URL="..." npx tsx scripts/ingest-treez-s3.ts --store=barbary_coast
 *   DATABASE_URL="..." npx tsx scripts/ingest-treez-s3.ts --store=grass_roots
 *   DATABASE_URL="..." npx tsx scripts/ingest-treez-s3.ts --dry-run
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();
const s3 = new S3Client({ region: 'us-west-1' });
const BUCKET = 'treez-data-export';

const MIN_FILE_SIZE = 2000; // Skip header-only files (941 bytes)

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const storeFilter = args.find(a => a.startsWith('--store='))?.split('=')[1];
const yearFilter = args.find(a => a.startsWith('--year='))?.split('=')[1];
const allYears = args.includes('--all-years');

interface IngestStats {
  filesProcessed: number;
  filesSkipped: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  errors: string[];
}

function parseNum(value: string | undefined): number {
  if (!value || value === '') return 0;
  const cleaned = value.replace(/[$,%"]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  // Format: MM/DD/YYYY
  const match = value.replace(/"/g, '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const d = new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
  return isNaN(d.getTime()) ? null : d;
}

function parseDob(value: string | undefined): Date | null {
  if (!value || value === 'N/A' || value === '') return null;
  // Format: YYYY-MM-DD
  const d = new Date(value.replace(/"/g, ''));
  return isNaN(d.getTime()) ? null : d;
}

async function listS3Files(prefix: string): Promise<{ key: string; size: number }[]> {
  const files: { key: string; size: number }[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const response = await s3.send(command);
    for (const obj of response.Contents || []) {
      if (obj.Key?.endsWith('.csv') && obj.Key.includes('Product Summary')) {
        files.push({ key: obj.Key, size: obj.Size || 0 });
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return files;
}

async function getS3Content(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3.send(command);
  return await response.Body?.transformToString() || '';
}

// Determine store name from S3 path
function getStoreName(key: string): string {
  if (key.startsWith('exports/grassroots/')) return 'Grass Roots - SF';
  return 'Barbary Coast - SF Mission';
}

// Deduplicate: for each date folder, pick the largest file (most complete export)
function pickBestFilePerDate(files: { key: string; size: number }[]): { key: string; size: number }[] {
  const byDate = new Map<string, { key: string; size: number }>();

  for (const file of files) {
    // Extract date folder: exports/2026/03/11/ or exports/grassroots/2026/03/13/
    const match = file.key.match(/exports\/(grassroots\/)?(\d{4}\/\d{2}\/\d{2})\//);
    if (!match) continue;
    const dateKey = (match[1] || '') + match[2];

    const existing = byDate.get(dateKey);
    if (!existing || file.size > existing.size) {
      byDate.set(dateKey, file);
    }
  }

  return Array.from(byDate.values());
}

async function ingestFile(
  key: string,
  storeName: string,
  stats: IngestStats
): Promise<void> {
  const content = await getS3Content(key);
  const cleanContent = content.replace(/^\uFEFF/, '');

  const records = parse(cleanContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  });

  if (records.length === 0) {
    stats.filesSkipped++;
    return;
  }

  // Batch upsert for performance
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    for (const row of batch) {
      const dateOpen = parseDate(row['Date Open']);
      const ticketId = (row['Ticket ID'] || '').replace(/"/g, '').trim();
      const ticketLineId = (row['Ticket Line ID'] || '').replace(/"/g, '').trim();

      if (!dateOpen || !ticketId || !ticketLineId) {
        stats.rowsSkipped++;
        continue;
      }

      // Skip return-only rows with no product info
      const type = (row['Type'] || '').trim();
      if (type === 'Return' && !row['Product Name']?.trim()) {
        stats.rowsSkipped++;
        continue;
      }

      try {
        await prisma.salesLineItem.upsert({
          where: {
            ticketId_ticketLineId_dateOpen: {
              ticketId,
              ticketLineId,
              dateOpen,
            },
          },
          create: {
            storeName,
            ticketId,
            ticketLineId,
            dateOpen,
            dateClose: parseDate(row['Date Closed']),
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
            dateClose: parseDate(row['Date Closed']),
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
        stats.rowsInserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Unique constraint')) {
          stats.errors.push(`${key} ticket=${ticketId}: ${msg.slice(0, 120)}`);
        }
        stats.rowsSkipped++;
      }
    }
  }

  stats.filesProcessed++;
}

async function main() {
  console.log('===========================================');
  console.log('Treez S3 Product Summary -> sales_line_items');
  console.log('===========================================');
  if (dryRun) console.log('*** DRY RUN - no database writes ***');
  if (storeFilter) console.log(`Filtering to store: ${storeFilter}`);
  if (yearFilter) console.log(`Filtering to year: ${yearFilter}`);
  if (allYears) console.log('Scanning ALL years');
  console.log('');

  const stats: IngestStats = {
    filesProcessed: 0,
    filesSkipped: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    errors: [],
  };

  // Determine prefix: --all-years scans everything, --year=YYYY scans one year, default is current year
  const currentYear = new Date().getFullYear().toString();
  const yearSuffix = allYears ? '' : `${yearFilter || currentYear}/`;

  // Collect files for each store
  const stores: { prefix: string; storeName: string; storeId: string }[] = [];

  if (!storeFilter || storeFilter === 'barbary_coast') {
    stores.push({
      prefix: `exports/${yearSuffix}`,
      storeName: 'Barbary Coast - SF Mission',
      storeId: 'barbary_coast',
    });
  }
  if (!storeFilter || storeFilter === 'grass_roots') {
    stores.push({
      prefix: `exports/grassroots/${yearSuffix}`,
      storeName: 'Grass Roots - SF',
      storeId: 'grass_roots',
    });
  }

  for (const store of stores) {
    console.log(`\n--- ${store.storeName} ---`);
    console.log(`Listing files from s3://${BUCKET}/${store.prefix}...`);

    const allFiles = await listS3Files(store.prefix);
    console.log(`Found ${allFiles.length} Product Summary CSVs`);

    // Filter out header-only files
    const realFiles = allFiles.filter(f => f.size >= MIN_FILE_SIZE);
    console.log(`${realFiles.length} files with actual data (>= ${MIN_FILE_SIZE} bytes)`);

    // Pick best file per date
    const bestFiles = pickBestFilePerDate(realFiles);
    console.log(`${bestFiles.length} unique dates to process`);

    // Sort by date
    bestFiles.sort((a, b) => a.key.localeCompare(b.key));

    for (const file of bestFiles) {
      const shortName = file.key.split('/').pop();
      process.stdout.write(`  ${shortName} (${(file.size / 1024).toFixed(0)}KB)...`);

      if (dryRun) {
        console.log(' [dry run]');
        stats.filesProcessed++;
        continue;
      }

      const before = stats.rowsInserted;
      await ingestFile(file.key, store.storeName, stats);
      const inserted = stats.rowsInserted - before;
      console.log(` ${inserted} rows`);
    }
  }

  console.log('\n===========================================');
  console.log('Ingestion Complete');
  console.log('===========================================');
  console.log(`Files processed: ${stats.filesProcessed}`);
  console.log(`Files skipped:   ${stats.filesSkipped}`);
  console.log(`Rows inserted:   ${stats.rowsInserted}`);
  console.log(`Rows skipped:    ${stats.rowsSkipped}`);

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    stats.errors.slice(0, 20).forEach(e => console.log(`  - ${e}`));
    if (stats.errors.length > 20) console.log(`  ... and ${stats.errors.length - 20} more`);
  }

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
