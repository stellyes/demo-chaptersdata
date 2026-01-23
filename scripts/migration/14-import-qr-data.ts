/**
 * Import QR Code Data from DynamoDB to Aurora
 *
 * Migrates QR codes and click events from DynamoDB tables to Aurora.
 *
 * Run with: npx tsx scripts/migration/14-import-qr-data.ts
 */

import { PrismaClient } from '@prisma/client';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const prisma = new PrismaClient();
const dynamodb = new DynamoDBClient({ region: 'us-west-1' });

interface DynamoQrCode {
  short_code: { S: string };
  original_url: { S: string };
  name: { S: string };
  description?: { S: string };
  total_clicks: { N: string };
  active: { BOOL: boolean };
  deleted?: { BOOL: boolean };
  created_at: { S: string };
  last_clicked?: { S: string };
}

interface DynamoClick {
  click_id: { S: string };
  short_code: { S: string };
  clicked_at: { S: string };
  ip_address?: { S: string };
  user_agent?: { S: string };
  referrer?: { S: string };
  location?: { S: string };
}

async function main() {
  console.log('========================================');
  console.log('Import QR Code Data from DynamoDB');
  console.log('========================================\n');

  // Get all QR codes from DynamoDB
  console.log('[1/3] Loading QR codes from DynamoDB...');

  const qrCodesResult = await dynamodb.send(
    new ScanCommand({ TableName: 'qr-tracker-qr-codes' })
  );

  const qrCodes = (qrCodesResult.Items || []) as unknown as DynamoQrCode[];
  console.log(`  Found ${qrCodes.length} QR codes`);

  // Get all clicks from DynamoDB
  console.log('\n[2/3] Loading clicks from DynamoDB...');

  const clicksResult = await dynamodb.send(
    new ScanCommand({ TableName: 'qr-tracker-clicks' })
  );

  const clicks = (clicksResult.Items || []) as unknown as DynamoClick[];
  console.log(`  Found ${clicks.length} click events`);

  // Import QR codes to Aurora
  console.log('\n[3/3] Importing to Aurora...');

  let qrImported = 0;
  let clicksImported = 0;
  const codeMap = new Map<string, string>(); // shortCode -> Aurora ID

  for (const qr of qrCodes) {
    try {
      // Check if already exists
      const existing = await prisma.qrCode.findUnique({
        where: { shortCode: qr.short_code.S },
      });

      if (existing) {
        codeMap.set(qr.short_code.S, existing.id);
        console.log(`  Skipping existing: ${qr.name.S}`);
        continue;
      }

      const created = await prisma.qrCode.create({
        data: {
          shortCode: qr.short_code.S,
          originalUrl: qr.original_url.S,
          name: qr.name.S,
          description: qr.description?.S || null,
          totalClicks: parseInt(qr.total_clicks.N, 10),
          active: qr.active.BOOL,
          deleted: qr.deleted?.BOOL || false,
          createdAt: new Date(qr.created_at.S),
        },
      });

      codeMap.set(qr.short_code.S, created.id);
      qrImported++;
      console.log(`  Imported: ${qr.name.S} (${qr.total_clicks.N} clicks)`);
    } catch (error) {
      console.error(`  Error importing ${qr.name.S}:`, error);
    }
  }

  // Import clicks
  for (const click of clicks) {
    try {
      const qrCodeId = codeMap.get(click.short_code.S);
      if (!qrCodeId) {
        console.log(`  Skipping click - no QR code found for: ${click.short_code.S}`);
        continue;
      }

      // Check if click already exists (by timestamp + shortcode)
      const clickTime = new Date(click.clicked_at.S);
      const existing = await prisma.qrClick.findFirst({
        where: {
          shortCode: click.short_code.S,
          clickedAt: clickTime,
        },
      });

      if (existing) continue;

      await prisma.qrClick.create({
        data: {
          qrCodeId,
          shortCode: click.short_code.S,
          clickedAt: clickTime,
          ipAddress: click.ip_address?.S || null,
          userAgent: click.user_agent?.S || null,
          referrer: click.referrer?.S || null,
          location: click.location?.S || null,
        },
      });

      clicksImported++;
    } catch (error) {
      // Likely duplicate, skip
    }
  }

  // Summary
  const totalQr = await prisma.qrCode.count();
  const totalClicks = await prisma.qrClick.count();

  console.log(`\n${'='.repeat(50)}`);
  console.log('QR DATA IMPORT COMPLETE');
  console.log(`${'='.repeat(50)}`);
  console.log(`QR Codes imported:    ${qrImported}`);
  console.log(`Clicks imported:      ${clicksImported}`);
  console.log('');
  console.log('Total in Aurora:');
  console.log(`  QR Codes:           ${totalQr}`);
  console.log(`  Click Events:       ${totalClicks}`);

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
