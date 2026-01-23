/**
 * Migration Script: Customers and Budtenders from S3 to Aurora
 *
 * Usage: npx ts-node scripts/migrate-customers-budtenders.ts [customers|budtenders|all]
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { parse } from 'csv-parse/sync';

// Type for CSV records
type CsvRecord = Record<string, string>;

const prisma = new PrismaClient();

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-west-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

const BUCKET = process.env.S3_BUCKET_NAME || 'retail-data-bcgr';

// Helper to parse date strings
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || dateStr === '' || dateStr === 'null') return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

// Helper to parse numbers
function parseNumber(val: string | null | undefined, defaultVal = 0): number {
  if (!val || val === '') return defaultVal;
  const num = parseFloat(val);
  return isNaN(num) ? defaultVal : num;
}

// Helper to parse integers
function parseInt2(val: string | null | undefined, defaultVal = 0): number {
  if (!val || val === '') return defaultVal;
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultVal : num;
}

// Calculate customer segment based on lifetime value
function calculateCustomerSegment(lifetimeNetSales: number, lifetimeVisits: number): string {
  if (lifetimeNetSales >= 5000 || lifetimeVisits >= 50) return 'VIP';
  if (lifetimeNetSales >= 1000 || lifetimeVisits >= 20) return 'Regular';
  if (lifetimeNetSales >= 200 || lifetimeVisits >= 5) return 'Occasional';
  return 'New/Low';
}

// Calculate recency segment based on last visit
function calculateRecencySegment(lastVisitDate: Date | null): string {
  if (!lastVisitDate) return 'Lost';
  const daysSinceVisit = Math.floor((Date.now() - lastVisitDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSinceVisit <= 30) return 'Active';
  if (daysSinceVisit <= 90) return 'At Risk';
  if (daysSinceVisit <= 180) return 'Dormant';
  return 'Lost';
}

// Map store name to store ID
function getStoreId(storeName: string): string {
  const normalizedName = storeName.toLowerCase();
  if (normalizedName.includes('barbary') || normalizedName.includes('mission')) {
    return 'barbary_coast';
  }
  if (normalizedName.includes('grass') || normalizedName.includes('root')) {
    return 'grass_roots';
  }
  return storeName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

// Migrate customers from S3 CSV files
async function migrateCustomers(): Promise<{ migrated: number; skipped: number; errors: string[] }> {
  console.log('\n=== Starting Customer Migration ===\n');
  const errors: string[] = [];
  let migrated = 0;
  let skipped = 0;

  try {
    // List customer CSV files
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'raw-uploads/',
    });
    const listResult = await s3.send(listCommand);
    const customerFiles = (listResult.Contents || [])
      .filter(obj => obj.Key?.includes('customers_') && obj.Key?.endsWith('.csv'))
      .map(obj => obj.Key!);

    console.log(`Found ${customerFiles.length} customer files to process`);

    for (const fileKey of customerFiles) {
      console.log(`\nProcessing: ${fileKey}`);

      try {
        const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: fileKey });
        const response = await s3.send(getCommand);
        const content = await response.Body?.transformToString();

        if (!content) {
          console.log(`  Skipping empty file`);
          continue;
        }

        // Parse CSV (handle BOM)
        const cleanContent = content.replace(/^\uFEFF/, '');
        const records: CsvRecord[] = parse(cleanContent, {
          columns: true,
          skip_empty_lines: true,
          relax_column_count: true,
        });

        console.log(`  Found ${records.length} customer records`);

        // Process in batches
        const batchSize = 100;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);

          for (const record of batch as CsvRecord[]) {
            try {
              const storeName = record['Store Name'] || '';
              const customerId = record['Customer ID'] || '';

              if (!storeName || !customerId) {
                skipped++;
                continue;
              }

              const firstName = record['First Name'] || '';
              const lastName = record['Last Name'] || '';
              const name = [firstName, lastName].filter(Boolean).join(' ') || null;

              const dateOfBirth = parseDate(record['Date of Birth']);
              const signupDate = parseDate(record['Sign-Up Date']);
              const lastVisitDate = parseDate(record['Last Visit Date']);

              const lifetimeVisits = parseInt2(record['Life Time In-Store Visits']);
              const lifetimeTransactions = parseInt2(record['Lifetime Transactions']);
              const lifetimeNetSales = parseNumber(record['Lifetime Net Sales']);
              const lifetimeAov = parseNumber(record['Lifetime Avg Order Value']);

              const customerSegment = calculateCustomerSegment(lifetimeNetSales, lifetimeVisits);
              const recencySegment = calculateRecencySegment(lastVisitDate);

              await prisma.customer.upsert({
                where: {
                  storeName_customerId: { storeName, customerId },
                },
                update: {
                  name,
                  dateOfBirth,
                  lifetimeVisits,
                  lifetimeTransactions,
                  lifetimeNetSales,
                  lifetimeAov,
                  signupDate,
                  lastVisitDate,
                  customerSegment,
                  recencySegment,
                },
                create: {
                  storeName,
                  customerId,
                  name,
                  dateOfBirth,
                  lifetimeVisits,
                  lifetimeTransactions,
                  lifetimeNetSales,
                  lifetimeAov,
                  signupDate,
                  lastVisitDate,
                  customerSegment,
                  recencySegment,
                },
              });

              migrated++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown error';
              if (!errors.includes(msg)) {
                errors.push(msg);
              }
              skipped++;
            }
          }

          if ((i + batchSize) % 1000 === 0) {
            console.log(`  Processed ${Math.min(i + batchSize, records.length)} / ${records.length}`);
          }
        }
      } catch (err) {
        errors.push(`File ${fileKey}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  } catch (err) {
    errors.push(`S3 list failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  console.log(`\nCustomer migration complete: ${migrated} migrated, ${skipped} skipped`);
  return { migrated, skipped, errors };
}

// Migrate budtender records from S3 CSV
async function migrateBudtenders(): Promise<{ migrated: number; skipped: number; errors: string[] }> {
  console.log('\n=== Starting Budtender Migration ===\n');
  const errors: string[] = [];
  let migrated = 0;
  let skipped = 0;

  try {
    const fileKey = 'data/budtender_performance.csv';
    console.log(`Processing: ${fileKey}`);

    const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: fileKey });
    const response = await s3.send(getCommand);
    const content = await response.Body?.transformToString();

    if (!content) {
      errors.push('Budtender file is empty');
      return { migrated, skipped, errors };
    }

    // Parse CSV
    const records: CsvRecord[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Found ${records.length} budtender records`);

    // Aggregate by employee + store + date (since CSV has per-brand data)
    const aggregated = new Map<string, {
      storeName: string;
      storeId: string;
      employeeName: string;
      date: Date;
      unitsSold: number;
      netSales: number;
      grossMarginSum: number;
      grossMarginCount: number;
      discountSum: number;
      discountCount: number;
    }>();

    for (const record of records as CsvRecord[]) {
      const storeName = record['Store_Name'] || '';
      const employeeName = record['Employee'] || '';
      const storeId = record['Store_ID'] || getStoreId(storeName);
      const uploadDateStr = record['Upload_Date'] || '';

      if (!storeName || !employeeName) continue;

      // Use upload date as the record date
      const date = parseDate(uploadDateStr);
      if (!date) continue;

      // Normalize date to midnight
      const dateKey = date.toISOString().split('T')[0];
      const key = `${storeId}|${employeeName}|${dateKey}`;

      const existing = aggregated.get(key) || {
        storeName,
        storeId,
        employeeName,
        date: new Date(dateKey),
        unitsSold: 0,
        netSales: 0,
        grossMarginSum: 0,
        grossMarginCount: 0,
        discountSum: 0,
        discountCount: 0,
      };

      existing.unitsSold += parseNumber(record['Units_Sold']);
      existing.netSales += parseNumber(record['Net_Sales']);
      existing.grossMarginSum += parseNumber(record['Gross_Margin']);
      existing.grossMarginCount += 1;
      existing.discountSum += parseNumber(record['Discount_Pct']);
      existing.discountCount += 1;

      aggregated.set(key, existing);
    }

    console.log(`Aggregated to ${aggregated.size} unique employee/date combinations`);

    // Insert aggregated records
    let count = 0;
    for (const [, data] of aggregated) {
      try {
        const avgGrossMargin = data.grossMarginCount > 0
          ? data.grossMarginSum / data.grossMarginCount
          : 0;

        // Try to find existing record
        const existing = await prisma.budtenderRecord.findFirst({
          where: {
            storeId: data.storeId,
            employeeName: data.employeeName,
            date: data.date,
          },
        });

        if (existing) {
          await prisma.budtenderRecord.update({
            where: { id: existing.id },
            data: {
              storeName: data.storeName,
              unitsSold: Math.round(data.unitsSold),
              netSales: data.netSales,
              grossMarginPct: avgGrossMargin,
            },
          });
        } else {
          await prisma.budtenderRecord.create({
            data: {
              storeId: data.storeId,
              storeName: data.storeName,
              employeeName: data.employeeName,
              date: data.date,
              unitsSold: Math.round(data.unitsSold),
              netSales: data.netSales,
              grossMarginPct: avgGrossMargin,
              ticketsCount: 0,
              customersCount: 0,
              avgOrderValue: 0,
            },
          });
        }

        migrated++;
        count++;

        if (count % 100 === 0) {
          console.log(`  Processed ${count} / ${aggregated.size}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (!errors.includes(msg)) {
          errors.push(msg);
        }
        skipped++;
      }
    }
  } catch (err) {
    errors.push(`Budtender migration failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  console.log(`\nBudtender migration complete: ${migrated} migrated, ${skipped} skipped`);
  return { migrated, skipped, errors };
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const migrationType = args[0] || 'all';

  console.log('========================================');
  console.log('  S3 to Aurora Migration Script');
  console.log('========================================');
  console.log(`Migration type: ${migrationType}`);
  console.log(`S3 Bucket: ${BUCKET}`);
  console.log('');

  const results: Record<string, unknown> = {};

  try {
    if (migrationType === 'customers' || migrationType === 'all') {
      results.customers = await migrateCustomers();
    }

    if (migrationType === 'budtenders' || migrationType === 'all') {
      results.budtenders = await migrateBudtenders();
    }

    // Verify counts
    console.log('\n========================================');
    console.log('  Final Database Counts');
    console.log('========================================');

    const [customerCount, budtenderCount] = await Promise.all([
      prisma.customer.count(),
      prisma.budtenderRecord.count(),
    ]);

    console.log(`Customers: ${customerCount}`);
    console.log(`Budtender Records: ${budtenderCount}`);

    console.log('\n========================================');
    console.log('  Migration Results');
    console.log('========================================');
    console.log(JSON.stringify(results, null, 2));

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
