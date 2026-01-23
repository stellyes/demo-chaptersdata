/**
 * Import Research Documents from S3 to Aurora
 *
 * Migrates manually analyzed research documents from S3 to the new
 * ResearchDocument and ResearchFinding tables in Aurora.
 *
 * Run with: npx tsx scripts/migration/13-import-research-documents.ts
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();

// Use default credential chain (AWS CLI, env vars, IAM role, etc.)
const s3Client = new S3Client({
  region: 'us-west-1',
});

const BUCKET = process.env.CHAPTERS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'retail-data-bcgr';

interface S3Finding {
  finding: string;
  relevance: string;
  category: string;
  action_required: boolean;
  recommended_action?: string | null;
}

interface S3DocumentFinding {
  summary: string;
  key_findings: S3Finding[];
  date_mentioned?: string;
  key_facts?: string[];
  relevance_score: string;
  analyzed_at: string;
  source?: string;
  category?: string;
}

interface S3ResearchDocument {
  started_at?: string;
  documents_analyzed?: number;
  findings_by_category?: Record<string, S3DocumentFinding[]>;
  all_findings?: S3DocumentFinding[];
  // Legacy format
  id?: string;
  filename?: string;
  category?: string;
  source_url?: string;
  summary?: string;
  key_findings?: S3Finding[];
  key_facts?: string[];
  relevance_score?: string;
  date_mentioned?: string;
  analyzed_at?: string;
}

async function listResearchDocuments(): Promise<string[]> {
  const keys: string[] = [];

  const response = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'research-findings/manual/',
    })
  );

  if (response.Contents) {
    for (const obj of response.Contents) {
      if (obj.Key && obj.Key.endsWith('.json')) {
        keys.push(obj.Key);
      }
    }
  }

  return keys;
}

async function getDocument(key: string): Promise<S3ResearchDocument | null> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );

    const content = await response.Body?.transformToString();
    if (content) {
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`  Error fetching ${key}:`, error);
  }
  return null;
}

async function main() {
  console.log('========================================');
  console.log('Import Research Documents from S3');
  console.log('========================================\n');

  // List all research documents in S3
  console.log('[1/3] Listing research documents in S3...');
  const keys = await listResearchDocuments();
  console.log(`  Found ${keys.length} documents\n`);

  // Process each document
  console.log('[2/3] Importing documents to Aurora...');

  let imported = 0;
  let findingsCount = 0;
  let skipped = 0;

  for (const key of keys) {
    const doc = await getDocument(key);
    if (!doc) {
      skipped++;
      continue;
    }

    // Handle new format with findings_by_category
    if (doc.findings_by_category || doc.all_findings) {
      const findings = doc.all_findings || [];

      // Also extract from findings_by_category if present
      if (doc.findings_by_category) {
        for (const categoryFindings of Object.values(doc.findings_by_category)) {
          findings.push(...categoryFindings);
        }
      }

      for (const finding of findings) {
        try {
          // Create the research document
          const researchDoc = await prisma.researchDocument.create({
            data: {
              filename: finding.source || key.split('/').pop() || 'unknown',
              category: finding.category || 'Market Research',
              summary: finding.summary || '',
              relevanceScore: finding.relevance_score || 'medium',
              dateMentioned: finding.date_mentioned ? new Date(finding.date_mentioned) : null,
              analyzedAt: finding.analyzed_at ? new Date(finding.analyzed_at) : new Date(),
              s3Key: key,
            },
          });

          // Create findings
          if (finding.key_findings && finding.key_findings.length > 0) {
            for (const kf of finding.key_findings) {
              await prisma.researchFinding.create({
                data: {
                  documentId: researchDoc.id,
                  finding: kf.finding,
                  relevance: kf.relevance || 'medium',
                  category: kf.category || 'general',
                  actionRequired: kf.action_required || false,
                  recommendedAction: kf.recommended_action || null,
                },
              });
              findingsCount++;
            }
          }

          imported++;
        } catch (error) {
          console.error(`  Error importing finding from ${key}:`, error);
        }
      }
    }
    // Handle legacy format
    else if (doc.summary && doc.key_findings) {
      try {
        const researchDoc = await prisma.researchDocument.create({
          data: {
            filename: doc.filename || key.split('/').pop() || 'unknown',
            category: doc.category || 'Market Research',
            sourceUrl: doc.source_url,
            summary: doc.summary,
            relevanceScore: doc.relevance_score || 'medium',
            dateMentioned: doc.date_mentioned ? new Date(doc.date_mentioned) : null,
            analyzedAt: doc.analyzed_at ? new Date(doc.analyzed_at) : new Date(),
            s3Key: key,
          },
        });

        for (const kf of doc.key_findings) {
          await prisma.researchFinding.create({
            data: {
              documentId: researchDoc.id,
              finding: kf.finding,
              relevance: kf.relevance || 'medium',
              category: kf.category || 'general',
              actionRequired: kf.action_required || false,
              recommendedAction: kf.recommended_action || null,
            },
          });
          findingsCount++;
        }

        imported++;
      } catch (error) {
        console.error(`  Error importing ${key}:`, error);
      }
    } else {
      skipped++;
    }

    process.stdout.write(`\r  Processed ${imported + skipped}/${keys.length}...`);
  }

  console.log('\n');

  // Summary
  console.log('[3/3] Final summary...');

  const totalDocs = await prisma.researchDocument.count();
  const totalFindings = await prisma.researchFinding.count();

  console.log(`\n${'='.repeat(50)}`);
  console.log('RESEARCH IMPORT COMPLETE');
  console.log(`${'='.repeat(50)}`);
  console.log(`Documents imported:  ${imported}`);
  console.log(`Findings imported:   ${findingsCount}`);
  console.log(`Documents skipped:   ${skipped}`);
  console.log('');
  console.log(`Total in Aurora:`);
  console.log(`  Research Documents: ${totalDocs}`);
  console.log(`  Research Findings:  ${totalFindings}`);

  // Show sample findings
  const sampleFindings = await prisma.researchFinding.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { document: true },
  });

  console.log('\nSample findings:');
  for (const f of sampleFindings) {
    console.log(`  [${f.category}] ${f.finding.substring(0, 80)}...`);
    console.log(`    → Action: ${f.recommendedAction?.substring(0, 60) || 'None'}...`);
  }

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
