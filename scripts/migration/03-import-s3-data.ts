/**
 * S3 to Aurora PostgreSQL Data Migration Script
 *
 * Imports all CSV data from S3 into Aurora PostgreSQL:
 * - Sales records (daily store metrics)
 * - Brand records (brand performance by store/period)
 * - Product records (category performance by store)
 * - Brand mappings (canonical brand definitions with aliases)
 *
 * Run with: npx tsx scripts/migration/03-import-s3-data.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { parse } from 'csv-parse/sync';

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

// Store mapping
const STORE_IDS: Record<string, string> = {
  'barbary_coast': 'barbary_coast',
  'grass_roots': 'grass_roots',
  'Barbary Coast - SF Mission': 'barbary_coast',
  'Grass Roots - SF Excelsior': 'grass_roots',
};

interface MigrationStats {
  salesRecords: number;
  brandRecords: number;
  productRecords: number;
  canonicalBrands: number;
  brandAliases: number;
  errors: string[];
}

async function getS3Object(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3.send(command);
  return await response.Body?.transformToString() || '';
}

async function listS3Objects(prefix: string): Promise<string[]> {
  const command = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
  const response = await s3.send(command);
  return (response.Contents || [])
    .map(obj => obj.Key!)
    .filter(key => key && key.endsWith('.csv'));
}

// Parse date range from filename: brand_20230101-20230201_20251223_214826.csv
function parseDateRange(filename: string): { startDate: Date; endDate: Date } | null {
  const match = filename.match(/(\d{8})-(\d{8})/);
  if (!match) return null;

  const parseDate = (str: string) => new Date(
    parseInt(str.slice(0, 4)),
    parseInt(str.slice(4, 6)) - 1,
    parseInt(str.slice(6, 8))
  );

  return {
    startDate: parseDate(match[1]),
    endDate: parseDate(match[2]),
  };
}

function parseNumber(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = value.replace(/[$,%]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Clamp percentage values to fit Decimal(6,3) which allows -999.999 to 999.999
function clampPercent(value: number): number {
  return Math.max(-999.999, Math.min(999.999, value));
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

async function importSalesData(storeId: string, stats: MigrationStats): Promise<void> {
  console.log(`\n📊 Importing sales data for ${storeId}...`);

  const files = await listS3Objects(`raw-uploads/${storeId}/sales_`);
  console.log(`   Found ${files.length} sales files`);

  for (const file of files) {
    try {
      const content = await getS3Object(file);
      // Remove BOM if present
      const cleanContent = content.replace(/^\uFEFF/, '');

      const records = parse(cleanContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      for (const row of records) {
        const date = parseDate(row['Date']);
        if (!date) continue;

        const storeName = row['Store'] || '';
        const resolvedStoreId = STORE_IDS[storeName] || storeId;

        try {
          await prisma.salesRecord.upsert({
            where: {
              storeId_date: {
                storeId: resolvedStoreId,
                date: date,
              },
            },
            create: {
              storeId: resolvedStoreId,
              storeName: storeName,
              date: date,
              week: row['Week'] || null,
              ticketsCount: Math.round(parseNumber(row['Tickets Count'])),
              unitsSold: Math.round(parseNumber(row['Units Sold'])),
              customersCount: Math.round(parseNumber(row['Customers Count'])),
              newCustomers: Math.round(parseNumber(row['New Customers'])),
              grossSales: new Prisma.Decimal(parseNumber(row['Gross Sales'])),
              discounts: new Prisma.Decimal(parseNumber(row['Discounts'])),
              returns: new Prisma.Decimal(parseNumber(row['Returns'])),
              netSales: new Prisma.Decimal(parseNumber(row['Net Sales'])),
              taxes: new Prisma.Decimal(parseNumber(row['Taxes'])),
              grossReceipts: new Prisma.Decimal(parseNumber(row['Gross Receipts'])),
              cogsWithExcise: new Prisma.Decimal(parseNumber(row['COGS (with excise)'])),
              grossIncome: new Prisma.Decimal(parseNumber(row['Gross Income'])),
              grossMarginPct: new Prisma.Decimal(parseNumber(row['Gross Margin %'])),
              discountPct: new Prisma.Decimal(parseNumber(row['Discount %'])),
              costPct: new Prisma.Decimal(parseNumber(row['Cost %'])),
              avgBasketSize: new Prisma.Decimal(parseNumber(row['Avg Basket Size'])),
              avgOrderValue: new Prisma.Decimal(parseNumber(row['Avg Order Value'])),
              avgOrderProfit: new Prisma.Decimal(parseNumber(row['Avg Order Profit'])),
            },
            update: {
              storeName: storeName,
              week: row['Week'] || null,
              ticketsCount: Math.round(parseNumber(row['Tickets Count'])),
              unitsSold: Math.round(parseNumber(row['Units Sold'])),
              customersCount: Math.round(parseNumber(row['Customers Count'])),
              newCustomers: Math.round(parseNumber(row['New Customers'])),
              grossSales: new Prisma.Decimal(parseNumber(row['Gross Sales'])),
              discounts: new Prisma.Decimal(parseNumber(row['Discounts'])),
              returns: new Prisma.Decimal(parseNumber(row['Returns'])),
              netSales: new Prisma.Decimal(parseNumber(row['Net Sales'])),
              taxes: new Prisma.Decimal(parseNumber(row['Taxes'])),
              grossReceipts: new Prisma.Decimal(parseNumber(row['Gross Receipts'])),
              cogsWithExcise: new Prisma.Decimal(parseNumber(row['COGS (with excise)'])),
              grossIncome: new Prisma.Decimal(parseNumber(row['Gross Income'])),
              grossMarginPct: new Prisma.Decimal(parseNumber(row['Gross Margin %'])),
              discountPct: new Prisma.Decimal(parseNumber(row['Discount %'])),
              costPct: new Prisma.Decimal(parseNumber(row['Cost %'])),
              avgBasketSize: new Prisma.Decimal(parseNumber(row['Avg Basket Size'])),
              avgOrderValue: new Prisma.Decimal(parseNumber(row['Avg Order Value'])),
              avgOrderProfit: new Prisma.Decimal(parseNumber(row['Avg Order Profit'])),
            },
          });
          stats.salesRecords++;
        } catch (err) {
          stats.errors.push(`Sales ${file} row: ${err instanceof Error ? err.message : 'Unknown'}`);
        }
      }

      process.stdout.write('.');
    } catch (err) {
      stats.errors.push(`Sales file ${file}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  console.log(` Done! (${stats.salesRecords} records)`);
}

async function importBrandData(storeId: string, stats: MigrationStats): Promise<void> {
  console.log(`\n🏷️  Importing brand data for ${storeId}...`);

  const files = await listS3Objects(`raw-uploads/${storeId}/brand_`);
  console.log(`   Found ${files.length} brand files`);

  for (const file of files) {
    try {
      const content = await getS3Object(file);
      const cleanContent = content.replace(/^\uFEFF/, '');

      const records = parse(cleanContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      // Parse date range from filename
      const filename = file.split('/').pop() || '';
      const dateRange = parseDateRange(filename);

      for (const row of records) {
        const brandName = row['Brand'] || row['Product Brand'] || '';
        if (!brandName) continue;

        // Skip sample records
        if (brandName.includes('[DS]') || brandName.includes('[SS]')) continue;

        const netSales = parseNumber(row['Net Sales']);
        if (netSales <= 0) continue;

        try {
          await prisma.brandRecord.create({
            data: {
              storeId: storeId,
              storeName: storeId === 'barbary_coast' ? 'Barbary Coast - SF Mission' : 'Grass Roots - SF Excelsior',
              originalBrandName: brandName,
              pctOfTotalNetSales: new Prisma.Decimal(clampPercent(parseNumber(row['% of Total Net Sales']))),
              grossMarginPct: new Prisma.Decimal(clampPercent(parseNumber(row['Gross Margin %']))),
              avgCostWoExcise: new Prisma.Decimal(parseNumber(row['Avg Cost (w/o excise)'])),
              netSales: new Prisma.Decimal(netSales),
              uploadStartDate: dateRange?.startDate || null,
              uploadEndDate: dateRange?.endDate || null,
            },
          });
          stats.brandRecords++;
        } catch (err) {
          // Might be duplicate, continue
          if (!(err instanceof Error && err.message.includes('Unique constraint'))) {
            stats.errors.push(`Brand ${file} "${brandName}": ${err instanceof Error ? err.message : 'Unknown'}`);
          }
        }
      }

      process.stdout.write('.');
    } catch (err) {
      stats.errors.push(`Brand file ${file}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  console.log(` Done! (${stats.brandRecords} records)`);
}

async function importProductData(storeId: string, stats: MigrationStats): Promise<void> {
  console.log(`\n📦 Importing product data for ${storeId}...`);

  const files = await listS3Objects(`raw-uploads/${storeId}/product_`);
  console.log(`   Found ${files.length} product files`);

  for (const file of files) {
    try {
      const content = await getS3Object(file);
      const cleanContent = content.replace(/^\uFEFF/, '');

      const records = parse(cleanContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      for (const row of records) {
        const productType = row['Product Type'] || '';
        if (!productType) continue;

        const netSales = parseNumber(row['Net Sales']);
        if (netSales <= 0) continue;

        try {
          await prisma.productRecord.create({
            data: {
              storeId: storeId,
              storeName: storeId === 'barbary_coast' ? 'Barbary Coast - SF Mission' : 'Grass Roots - SF Excelsior',
              productType: productType,
              pctOfTotalNetSales: new Prisma.Decimal(parseNumber(row['% of Total Net Sales']) || 0),
              grossMarginPct: new Prisma.Decimal(parseNumber(row['Gross Margin %']) || 0),
              avgCostWoExcise: new Prisma.Decimal(parseNumber(row['Avg Cost (w/o excise)']) || 0),
              netSales: new Prisma.Decimal(netSales),
            },
          });
          stats.productRecords++;
        } catch (err) {
          if (!(err instanceof Error && err.message.includes('Unique constraint'))) {
            stats.errors.push(`Product ${file} "${productType}": ${err instanceof Error ? err.message : 'Unknown'}`);
          }
        }
      }

      process.stdout.write('.');
    } catch (err) {
      stats.errors.push(`Product file ${file}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  console.log(` Done! (${stats.productRecords} records)`);
}

async function importBrandMappings(stats: MigrationStats): Promise<void> {
  console.log(`\n🔗 Importing brand mappings...`);

  try {
    const content = await getS3Object('config/brand_product_mapping.json');
    const mappings = JSON.parse(content) as Record<string, { aliases: Record<string, string> }>;

    for (const [canonicalName, entry] of Object.entries(mappings)) {
      try {
        // Create canonical brand
        const brand = await prisma.canonicalBrand.upsert({
          where: { canonicalName },
          create: { canonicalName },
          update: {},
        });
        stats.canonicalBrands++;

        // Create aliases
        for (const [aliasName, productType] of Object.entries(entry.aliases)) {
          try {
            await prisma.brandAlias.upsert({
              where: { aliasName },
              create: {
                brandId: brand.id,
                aliasName,
                productType: productType || null,
              },
              update: {
                brandId: brand.id,
                productType: productType || null,
              },
            });
            stats.brandAliases++;
          } catch (err) {
            // Skip duplicate aliases
          }
        }
      } catch (err) {
        stats.errors.push(`Brand mapping "${canonicalName}": ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    console.log(` Done! (${stats.canonicalBrands} brands, ${stats.brandAliases} aliases)`);
  } catch (err) {
    stats.errors.push(`Brand mappings file: ${err instanceof Error ? err.message : 'Unknown'}`);
    console.log(` Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
  }
}

async function main() {
  console.log('========================================');
  console.log('S3 to Aurora PostgreSQL Data Migration');
  console.log('========================================\n');

  const stats: MigrationStats = {
    salesRecords: 0,
    brandRecords: 0,
    productRecords: 0,
    canonicalBrands: 0,
    brandAliases: 0,
    errors: [],
  };

  try {
    // Import brand mappings first (needed for brand record relationships)
    await importBrandMappings(stats);

    // Import data for each store
    for (const storeId of ['barbary_coast', 'grass_roots']) {
      await importSalesData(storeId, stats);
      await importBrandData(storeId, stats);
      await importProductData(storeId, stats);
    }

    console.log('\n========================================');
    console.log('Migration Complete!');
    console.log('========================================');
    console.log(`\n📈 Summary:`);
    console.log(`   Sales records:    ${stats.salesRecords}`);
    console.log(`   Brand records:    ${stats.brandRecords}`);
    console.log(`   Product records:  ${stats.productRecords}`);
    console.log(`   Canonical brands: ${stats.canonicalBrands}`);
    console.log(`   Brand aliases:    ${stats.brandAliases}`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors (${stats.errors.length}):`);
      stats.errors.slice(0, 10).forEach(err => console.log(`   - ${err}`));
      if (stats.errors.length > 10) {
        console.log(`   ... and ${stats.errors.length - 10} more`);
      }
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
