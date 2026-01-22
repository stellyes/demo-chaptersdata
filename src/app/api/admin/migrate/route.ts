// ============================================
// ADMIN MIGRATION API ROUTE
// Triggers data migrations from legacy storage to Aurora
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { AWS_CONFIG, DYNAMODB_TABLES } from '@/lib/config';

const s3 = new S3Client({
  region: AWS_CONFIG.region,
  credentials: AWS_CONFIG.accessKeyId && AWS_CONFIG.secretAccessKey
    ? {
        accessKeyId: AWS_CONFIG.accessKeyId,
        secretAccessKey: AWS_CONFIG.secretAccessKey,
      }
    : undefined,
});

const dynamodb = new DynamoDBClient({
  region: AWS_CONFIG.region,
  credentials: AWS_CONFIG.accessKeyId && AWS_CONFIG.secretAccessKey
    ? {
        accessKeyId: AWS_CONFIG.accessKeyId,
        secretAccessKey: AWS_CONFIG.secretAccessKey,
      }
    : undefined,
});

// Migrate QR codes from DynamoDB to Aurora
async function migrateQRCodes(): Promise<{ migrated: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let migrated = 0;
  let skipped = 0;

  try {
    const tableName = DYNAMODB_TABLES.qrCodes;
    console.log(`[Migration] Scanning DynamoDB table: ${tableName}`);

    const command = new ScanCommand({ TableName: tableName });
    const result = await dynamodb.send(command);
    const items = result.Items || [];

    console.log(`[Migration] Found ${items.length} QR codes in DynamoDB`);

    for (const item of items) {
      const shortCode = item.short_code?.S;
      const name = item.name?.S || 'Unnamed QR Code';
      const originalUrl = item.original_url?.S;
      const description = item.description?.S || null;
      const totalClicks = parseInt(item.total_clicks?.N || '0');
      const active = item.active?.BOOL !== false;
      const createdAt = item.created_at?.S ? new Date(item.created_at.S) : new Date();

      if (!shortCode || !originalUrl) {
        skipped++;
        continue;
      }

      try {
        const existing = await prisma.qrCode.findUnique({
          where: { shortCode },
        });

        if (existing) {
          await prisma.qrCode.update({
            where: { shortCode },
            data: { name, originalUrl, description, totalClicks, active },
          });
        } else {
          await prisma.qrCode.create({
            data: { shortCode, name, originalUrl, description, totalClicks, active, createdAt },
          });
        }
        migrated++;
      } catch (err) {
        errors.push(`QR ${shortCode}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        skipped++;
      }
    }
  } catch (err) {
    errors.push(`DynamoDB scan failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return { migrated, skipped, errors };
}

// Migrate AI reports from S3 to Aurora
async function migrateAIReports(): Promise<{ migrated: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let migrated = 0;
  let skipped = 0;

  try {
    const bucket = AWS_CONFIG.bucket;
    console.log(`[Migration] Scanning S3 bucket: ${bucket}/ai-reports/`);

    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'ai-reports/',
    });

    const result = await s3.send(command);
    const items = (result.Contents || []).filter(obj => obj.Key?.endsWith('.json'));

    console.log(`[Migration] Found ${items.length} AI reports in S3`);

    for (const item of items) {
      try {
        const getCommand = new GetObjectCommand({
          Bucket: bucket,
          Key: item.Key,
        });

        const response = await s3.send(getCommand);
        const content = await response.Body?.transformToString();
        if (!content) {
          skipped++;
          continue;
        }

        const report = JSON.parse(content);
        const reportId = report.report_id || item.Key;
        const analysisType = report.model_type || 'custom';
        const createdAt = report.timestamp || report.date ? new Date(report.timestamp || report.date) : item.LastModified;
        const inputSummary = report.question || `${analysisType} analysis`;
        const outputSummary = report.answer || report.analysis || '';

        if (!outputSummary) {
          skipped++;
          continue;
        }

        // Check if report with similar content already exists
        const existing = await prisma.analysisHistory.findFirst({
          where: {
            analysisType,
            inputSummary,
            createdAt: {
              gte: new Date((createdAt?.getTime() || Date.now()) - 60000),
              lte: new Date((createdAt?.getTime() || Date.now()) + 60000),
            },
          },
        });

        if (existing) {
          skipped++;
          continue;
        }

        await prisma.analysisHistory.create({
          data: {
            analysisType,
            inputSummary,
            outputSummary,
            model: 'claude-3-5-sonnet',
            createdAt: createdAt || new Date(),
          },
        });

        migrated++;
      } catch (err) {
        errors.push(`S3 ${item.Key}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        skipped++;
      }
    }
  } catch (err) {
    errors.push(`S3 list failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return { migrated, skipped, errors };
}

export async function POST(request: NextRequest) {
  try {
    const { type } = await request.json();

    if (!type || !['qr', 'reports', 'all'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid migration type. Use: qr, reports, or all' },
        { status: 400 }
      );
    }

    const results: Record<string, unknown> = {};

    if (type === 'qr' || type === 'all') {
      console.log('[Migration] Starting QR code migration...');
      results.qrCodes = await migrateQRCodes();
    }

    if (type === 'reports' || type === 'all') {
      console.log('[Migration] Starting AI reports migration...');
      results.aiReports = await migrateAIReports();
    }

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error('[Migration] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    );
  }
}

// GET endpoint to check current data counts
export async function GET() {
  try {
    const [qrCount, reportsCount] = await Promise.all([
      prisma.qrCode.count(),
      prisma.analysisHistory.count(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        qrCodes: qrCount,
        aiReports: reportsCount,
      },
    });
  } catch (error) {
    console.error('[Migration] Error checking counts:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to check counts' },
      { status: 500 }
    );
  }
}
