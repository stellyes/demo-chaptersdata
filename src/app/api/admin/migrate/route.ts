// ============================================
// ADMIN MIGRATION API ROUTE
// Triggers data migrations from legacy storage to Aurora
// ============================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { AWS_CONFIG } from '@/lib/config';

const s3Config = AWS_CONFIG.accessKeyId && AWS_CONFIG.secretAccessKey
  ? {
      region: AWS_CONFIG.region,
      credentials: {
        accessKeyId: AWS_CONFIG.accessKeyId,
        secretAccessKey: AWS_CONFIG.secretAccessKey,
      },
    }
  : { region: AWS_CONFIG.region };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s3 = new S3Client(s3Config as any);

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

export async function POST() {
  try {
    console.log('[Migration] Starting AI reports migration...');
    const aiReports = await migrateAIReports();

    return NextResponse.json({
      success: true,
      data: { aiReports },
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
