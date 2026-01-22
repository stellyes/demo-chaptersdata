// Migrate AI reports from S3 to Aurora PostgreSQL
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-west-1',
});

const prisma = new PrismaClient();
const BUCKET = process.env.S3_BUCKET_NAME || 'retail-data-bcgr';

async function migrateAIReports() {
  console.log('Scanning S3 for AI reports...');

  const command = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: 'ai-reports/',
  });

  const result = await s3.send(command);
  const items = (result.Contents || []).filter(obj => obj.Key?.endsWith('.json'));
  console.log(`Found ${items.length} AI reports in S3`);

  let migrated = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET,
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
        console.log(`Skipping empty report: ${reportId}`);
        skipped++;
        continue;
      }

      // Check if report with similar content already exists
      const existing = await prisma.analysisHistory.findFirst({
        where: {
          analysisType,
          inputSummary,
          createdAt: {
            gte: new Date(createdAt.getTime() - 60000), // Within 1 minute
            lte: new Date(createdAt.getTime() + 60000),
          },
        },
      });

      if (existing) {
        console.log(`Already exists: ${reportId} (${analysisType})`);
        skipped++;
        continue;
      }

      await prisma.analysisHistory.create({
        data: {
          analysisType,
          inputSummary,
          outputSummary,
          model: 'claude-3-5-sonnet',
          createdAt,
        },
      });

      console.log(`Migrated: ${reportId} (${analysisType})`);
      migrated++;
    } catch (error) {
      console.error(`Error migrating ${item.Key}:`, error.message);
      skipped++;
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
}

migrateAIReports()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
