/**
 * Sync S3 AI Reports to Aurora
 *
 * Migrates existing AI reports from S3 to the analysis_history table in Aurora
 * so they appear in the Past Reports section.
 *
 * Run with: npx tsx scripts/migration/18-sync-s3-reports-to-aurora.ts
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

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

interface S3Report {
  report_id: string;
  model_type: string;
  timestamp?: string;
  date?: string;
  answer: string;
  question: string;
  model_name?: string;
}

async function listAllReports(): Promise<Array<{ key: string; lastModified: Date }>> {
  const reports: Array<{ key: string; lastModified: Date }> = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'ai-reports/',
      ContinuationToken: continuationToken,
    }));

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.Key.endsWith('.json') && obj.Key.includes('report-')) {
          reports.push({
            key: obj.Key,
            lastModified: obj.LastModified || new Date(),
          });
        }
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  // Also check nested folders like 2026/
  const nestedResponse = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: 'ai-reports/2026/',
  }));

  if (nestedResponse.Contents) {
    for (const obj of nestedResponse.Contents) {
      if (obj.Key && obj.Key.endsWith('.json') && obj.Key.includes('report-')) {
        reports.push({
          key: obj.Key,
          lastModified: obj.LastModified || new Date(),
        });
      }
    }
  }

  return reports;
}

async function fetchReport(key: string): Promise<S3Report | null> {
  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));
    const content = await response.Body?.transformToString();
    if (content) {
      return JSON.parse(content) as S3Report;
    }
    return null;
  } catch (error) {
    console.error(`  Error fetching ${key}:`, error);
    return null;
  }
}

async function main() {
  console.log('========================================');
  console.log('Sync S3 AI Reports to Aurora');
  console.log('========================================\n');
  console.log(`S3 Bucket: ${BUCKET}`);
  console.log(`Prefix: ai-reports/\n`);

  // Check current Aurora count
  const currentCount = await prisma.analysisHistory.count();
  console.log(`Current analysis_history records: ${currentCount}\n`);

  // List all reports in S3
  console.log('Scanning S3 for AI reports...');
  const s3Reports = await listAllReports();
  console.log(`Found ${s3Reports.length} report files in S3\n`);

  if (s3Reports.length === 0) {
    console.log('No reports found in S3 to sync.');
    await prisma.$disconnect();
    return;
  }

  // Get existing report IDs to avoid duplicates
  const existingReports = await prisma.analysisHistory.findMany({
    select: { id: true, inputSummary: true },
  });
  const existingIds = new Set(existingReports.map(r => r.id));

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  console.log('Syncing reports to Aurora...\n');

  for (const { key, lastModified } of s3Reports) {
    try {
      const report = await fetchReport(key);
      if (!report) {
        errors++;
        continue;
      }

      // Check if already exists by report_id
      if (existingIds.has(report.report_id)) {
        console.log(`  Skip (exists): ${report.report_id}`);
        skipped++;
        continue;
      }

      // Determine analysis type from model_type or report_id
      let analysisType = report.model_type || 'custom';
      if (report.report_id.includes('report-sales')) analysisType = 'sales';
      else if (report.report_id.includes('report-brands')) analysisType = 'brands';
      else if (report.report_id.includes('report-categories')) analysisType = 'categories';
      else if (report.report_id.includes('report-insights')) analysisType = 'insights';
      else if (report.report_id.includes('report-custom')) analysisType = 'custom';

      // Parse date from timestamp or report_id
      let createdAt: Date;
      if (report.timestamp || report.date) {
        createdAt = new Date(report.timestamp || report.date || lastModified);
      } else {
        // Extract timestamp from report_id like "report-custom-1768692800284"
        const match = report.report_id.match(/(\d{13})$/);
        if (match) {
          createdAt = new Date(parseInt(match[1], 10));
        } else {
          createdAt = lastModified;
        }
      }

      // Create in Aurora
      await prisma.analysisHistory.create({
        data: {
          id: report.report_id,
          analysisType,
          inputSummary: report.question || `${analysisType} analysis`,
          outputSummary: report.answer || '',
          model: report.model_name || 'claude-3-5-sonnet',
          createdAt,
        },
      });

      console.log(`  Synced: ${report.report_id} (${analysisType})`);
      synced++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`  Error syncing ${key}: ${errMsg}`);
      errors++;
    }
  }

  // Final count
  const finalCount = await prisma.analysisHistory.count();

  console.log('\n========================================');
  console.log('SYNC COMPLETE');
  console.log('========================================');
  console.log(`Reports synced: ${synced}`);
  console.log(`Reports skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total analysis_history records: ${finalCount}`);

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Sync failed:', error);
    process.exit(1);
  });
