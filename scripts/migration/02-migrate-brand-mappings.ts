/**
 * Brand Mappings Migration Script
 *
 * Downloads brand_product_mapping.json from S3 and migrates to PostgreSQL.
 * Creates canonical_brands and brand_aliases tables.
 *
 * Run with: npm run migrate:brands
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-west-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET = process.env.S3_BUCKET_NAME || 'retail-data-bcgr';
const BRAND_MAPPINGS_KEY = 'config/brand_product_mapping.json';

// V2 Brand mapping structure
interface BrandMappingData {
  [canonicalBrand: string]: {
    aliases: {
      [aliasName: string]: string; // alias -> product_type
    };
  };
}

async function downloadBrandMappings(): Promise<BrandMappingData> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: BRAND_MAPPINGS_KEY })
    );

    const jsonString = await response.Body?.transformToString();
    if (!jsonString) {
      throw new Error('Empty response from S3');
    }

    const data = JSON.parse(jsonString);

    // Validate v2 format
    const firstValue = Object.values(data)[0];
    if (firstValue && typeof firstValue === 'object' && 'aliases' in (firstValue as object)) {
      return data as BrandMappingData;
    }

    throw new Error('Brand mapping file not in expected v2 format');
  } catch (error) {
    if (error instanceof Error && error.message.includes('NoSuchKey')) {
      console.log('No existing brand mappings file found in S3. Creating empty mappings.');
      return {};
    }
    throw error;
  }
}

async function migrateBrandMappings() {
  console.log('Starting brand mappings migration...\n');
  console.log(`Downloading from s3://${BUCKET}/${BRAND_MAPPINGS_KEY}...\n`);

  let brandCount = 0;
  let aliasCount = 0;
  let skippedAliases = 0;

  try {
    const mappings = await downloadBrandMappings();
    const totalBrands = Object.keys(mappings).length;

    console.log(`Found ${totalBrands} canonical brands to migrate.\n`);

    for (const [canonicalName, entry] of Object.entries(mappings)) {
      // Create or update the canonical brand
      const brand = await prisma.canonicalBrand.upsert({
        where: { canonicalName },
        update: {},
        create: { canonicalName },
      });

      brandCount++;
      console.log(`[${brandCount}/${totalBrands}] Created brand: ${canonicalName}`);

      // Create aliases
      const aliases = entry.aliases || {};
      for (const [aliasName, productType] of Object.entries(aliases)) {
        try {
          await prisma.brandAlias.upsert({
            where: { aliasName },
            update: {
              brandId: brand.id,
              productType: productType || null,
            },
            create: {
              brandId: brand.id,
              aliasName,
              productType: productType || null,
            },
          });
          aliasCount++;
        } catch (error) {
          // Skip if alias already exists for another brand
          skippedAliases++;
          console.log(`    Skipped alias (conflict): ${aliasName}`);
        }
      }
    }

    console.log('\n========================================');
    console.log(`Migration complete!`);
    console.log(`  Brands created: ${brandCount}`);
    console.log(`  Aliases created: ${aliasCount}`);
    console.log(`  Aliases skipped: ${skippedAliases}`);
    console.log('========================================\n');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateBrandMappings()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
