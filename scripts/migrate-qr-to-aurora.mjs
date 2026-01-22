// Migrate QR codes from DynamoDB to Aurora PostgreSQL
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { PrismaClient } from '@prisma/client';

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-west-1',
});

const prisma = new PrismaClient();

async function migrateQRCodes() {
  console.log('Scanning DynamoDB for QR codes...');

  const tableName = process.env.DYNAMODB_QR_TABLE || 'qr-tracker-qr-codes';
  const command = new ScanCommand({ TableName: tableName });
  const result = await dynamodb.send(command);

  const items = result.Items || [];
  console.log(`Found ${items.length} QR codes in DynamoDB`);

  let migrated = 0;
  let skipped = 0;

  for (const item of items) {
    const shortCode = item.short_code?.S;
    const name = item.name?.S || 'Unnamed QR Code';
    const originalUrl = item.original_url?.S;
    const description = item.description?.S || null;
    const totalClicks = parseInt(item.total_clicks?.N || '0');
    const active = item.active?.BOOL !== false;
    const createdAt = item.created_at?.S ? new Date(item.created_at.S) : new Date();

    if (!shortCode || !originalUrl) {
      console.log(`Skipping invalid QR code: ${JSON.stringify(item)}`);
      skipped++;
      continue;
    }

    try {
      // Check if already exists
      const existing = await prisma.qrCode.findUnique({
        where: { shortCode },
      });

      if (existing) {
        // Update existing
        await prisma.qrCode.update({
          where: { shortCode },
          data: {
            name,
            originalUrl,
            description,
            totalClicks,
            active,
          },
        });
        console.log(`Updated: ${name} (${shortCode})`);
      } else {
        // Create new
        await prisma.qrCode.create({
          data: {
            shortCode,
            name,
            originalUrl,
            description,
            totalClicks,
            active,
            createdAt,
          },
        });
        console.log(`Created: ${name} (${shortCode})`);
      }
      migrated++;
    } catch (error) {
      console.error(`Error migrating ${shortCode}:`, error.message);
      skipped++;
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
}

migrateQRCodes()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
