// ============================================
// LAMBDA HANDLER FOR TREEZ S3 → AURORA INGESTION
// Triggered by EventBridge Scheduler at 7AM UTC
// (1 hour after Treez export Lambdas deposit CSVs at 6AM UTC).
//
// Reads Product Summary CSVs from s3://treez-data-export,
// deduplicates by date, and upserts into sales_line_items.
// ============================================

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

// Bootstrap: construct DATABASE_URL from Secrets Manager before importing Prisma
async function bootstrapDatabase(): Promise<void> {
  if (process.env.DATABASE_URL) return;

  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) {
    throw new Error('DATABASE_SECRET_ARN environment variable is required');
  }

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-west-1' });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

  if (!response.SecretString) {
    throw new Error('Secret value is empty');
  }

  const secret = JSON.parse(response.SecretString) as { username: string; password: string };
  const encodedPassword = encodeURIComponent(secret.password);

  const host = process.env.DATABASE_HOST;
  const dbName = process.env.DATABASE_NAME || 'chapters_data';

  if (!host) {
    throw new Error('DATABASE_HOST environment variable is required');
  }

  const poolParams = [
    'sslmode=require',
    'connection_limit=10',
    'pool_timeout=30',
    'connect_timeout=15',
  ].join('&');

  process.env.DATABASE_URL = `postgresql://${secret.username}:${encodedPassword}@${host}:5432/${dbName}?${poolParams}`;
  console.log(`[TreezIngest] Database URL constructed for user: ${secret.username}`);
}

// --- S3 + CSV helpers ---

const BUCKET = process.env.TREEZ_S3_BUCKET || 'treez-data-export';
const MIN_FILE_SIZE = 2000; // Skip header-only files

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-west-1' });

interface IngestStats {
  filesProcessed: number;
  filesSkipped: number;
  rowsInserted: number;
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
  const match = value.replace(/"/g, '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const d = new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
  return isNaN(d.getTime()) ? null : d;
}

function parseDob(value: string | undefined): Date | null {
  if (!value || value === 'N/A' || value === '') return null;
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

function getStoreName(key: string): string {
  if (key.startsWith('exports/store2/')) return 'Emerald Collective - Midtown';
  return 'Greenleaf Market - Downtown';
}

function pickBestFilePerDate(files: { key: string; size: number }[]): { key: string; size: number }[] {
  const byDate = new Map<string, { key: string; size: number }>();

  for (const file of files) {
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

// Filter to only files within the lookback window
function filterByLookback(files: { key: string; size: number }[], lookbackDays: number): { key: string; size: number }[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = `${cutoff.getFullYear()}/${String(cutoff.getMonth() + 1).padStart(2, '0')}/${String(cutoff.getDate()).padStart(2, '0')}`;

  return files.filter(f => {
    const match = f.key.match(/(\d{4}\/\d{2}\/\d{2})/);
    return match && match[1] >= cutoffStr;
  });
}

interface IngestEvent {
  lookbackDays?: number;
  store?: 'greenleaf' | 'emerald';
  source?: string;
}

export const handler = async (event: IngestEvent = {}) => {
  const startTime = Date.now();
  const lookbackDays = event.lookbackDays || 3;

  console.log(`[TreezIngest] Starting ingestion (lookback=${lookbackDays} days, store=${event.store || 'all'})`);

  // Step 1: Bootstrap database credentials
  await bootstrapDatabase();

  // Step 2: Dynamic import of Prisma (after DATABASE_URL is set)
  const { PrismaClient, Prisma } = await import('@prisma/client');
  const { parse } = await import('csv-parse/sync');
  const prisma = new PrismaClient();

  const stats: IngestStats = {
    filesProcessed: 0,
    filesSkipped: 0,
    rowsInserted: 0,
    rowsSkipped: 0,
    errors: [],
  };

  const stores: { prefix: string; storeName: string; storeId: string }[] = [];

  if (!event.store || event.store === 'greenleaf') {
    stores.push({
      prefix: 'exports/',
      storeName: 'Greenleaf Market - Downtown',
      storeId: 'greenleaf',
    });
  }
  if (!event.store || event.store === 'emerald') {
    stores.push({
      prefix: 'exports/store2/',
      storeName: 'Emerald Collective - Midtown',
      storeId: 'emerald',
    });
  }

  try {
    for (const store of stores) {
      console.log(`\n[TreezIngest] --- ${store.storeName} ---`);

      const allFiles = await listS3Files(store.prefix);
      console.log(`[TreezIngest] Found ${allFiles.length} Product Summary CSVs`);

      const realFiles = allFiles.filter(f => f.size >= MIN_FILE_SIZE);
      const bestFiles = pickBestFilePerDate(realFiles);
      const recentFiles = filterByLookback(bestFiles, lookbackDays);

      console.log(`[TreezIngest] ${recentFiles.length} files within ${lookbackDays}-day lookback`);

      recentFiles.sort((a, b) => a.key.localeCompare(b.key));

      for (const file of recentFiles) {
        const shortName = file.key.split('/').pop();
        console.log(`[TreezIngest] Processing ${shortName} (${(file.size / 1024).toFixed(0)}KB)...`);

        try {
          const content = await getS3Content(file.key);
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
            continue;
          }

          let fileRows = 0;
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
                    storeName: store.storeName,
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
                    storeName: store.storeName,
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
                fileRows++;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!msg.includes('Unique constraint')) {
                  stats.errors.push(`${file.key} ticket=${ticketId}: ${msg.slice(0, 120)}`);
                }
                stats.rowsSkipped++;
              }
            }
          }

          stats.filesProcessed++;
          console.log(`[TreezIngest] ${shortName}: ${fileRows} rows`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stats.errors.push(`File ${file.key}: ${msg.slice(0, 200)}`);
          stats.filesSkipped++;
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  const result = {
    statusCode: 200,
    body: {
      duration: `${duration}s`,
      filesProcessed: stats.filesProcessed,
      filesSkipped: stats.filesSkipped,
      rowsInserted: stats.rowsInserted,
      rowsSkipped: stats.rowsSkipped,
      errorCount: stats.errors.length,
      errors: stats.errors.slice(0, 10),
    },
  };

  console.log(`[TreezIngest] Complete in ${duration}s — ${stats.filesProcessed} files, ${stats.rowsInserted} rows inserted, ${stats.errors.length} errors`);
  return result;
};
