/**
 * Import SEO Analysis Data from S3 to Aurora
 *
 * Migrates SEO analysis findings from S3 to Aurora.
 *
 * Run with: npx tsx scripts/migration/15-import-seo-data.ts
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const s3Client = new S3Client({ region: 'us-west-1' });
const BUCKET = 'retail-data-bcgr';

interface SeoCategory {
  score: number;
  findings: string[];
  issues: string[];
  recommendations: string[];
}

interface SeoAnalysis {
  website: string;
  analyzed_at: string;
  overall_score: number;
  categories: {
    technical_seo?: SeoCategory;
    on_page_seo?: SeoCategory;
    local_seo?: SeoCategory;
    content?: SeoCategory;
    competition?: SeoCategory;
  };
  priority_actions?: string[];
  quick_wins?: string[];
}

async function listSeoFiles(): Promise<string[]> {
  const keys: string[] = [];

  // Get files from seo-analysis folder (summary files)
  const response = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'seo-analysis/',
    })
  );

  if (response.Contents) {
    for (const obj of response.Contents) {
      if (obj.Key && obj.Key.includes('/summary/latest.json')) {
        keys.push(obj.Key);
      }
    }
  }

  return keys;
}

async function getDocument(key: string): Promise<SeoAnalysis | null> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key })
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

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

async function main() {
  console.log('========================================');
  console.log('Import SEO Analysis Data from S3');
  console.log('========================================\n');

  // List SEO files
  console.log('[1/3] Finding SEO analysis files in S3...');
  const keys = await listSeoFiles();
  console.log(`  Found ${keys.length} SEO analysis files`);

  // Process each file
  console.log('\n[2/3] Importing SEO data to Aurora...');

  let auditsImported = 0;
  let pagesImported = 0;

  for (const key of keys) {
    const analysis = await getDocument(key);
    if (!analysis) continue;

    const domain = extractDomain(analysis.website);
    console.log(`  Processing: ${domain}`);

    try {
      // Check if audit already exists for this domain
      const existing = await prisma.seoAudit.findFirst({
        where: { domain },
        orderBy: { createdAt: 'desc' },
      });

      // Skip if we have a recent audit (within 1 day)
      if (existing) {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (existing.createdAt > dayAgo) {
          console.log(`    Skipping - recent audit exists`);
          continue;
        }
      }

      // Build summary from categories
      const categories = analysis.categories || {};
      const summary = {
        healthScore: analysis.overall_score,
        totalPages: Object.keys(categories).length,
        criticalIssues: 0,
        warnings: 0,
        passed: 0,
        categories: Object.entries(categories).map(([name, cat]) => ({
          name,
          score: cat.score,
          issues: cat.issues?.length || 0,
          recommendations: cat.recommendations?.length || 0,
        })),
      };

      // Count issues by severity (estimate based on score)
      for (const cat of Object.values(categories)) {
        if (cat.score < 40) summary.criticalIssues += cat.issues?.length || 0;
        else if (cat.score < 70) summary.warnings += cat.issues?.length || 0;
        else summary.passed += cat.findings?.length || 0;
      }

      // Create audit
      const audit = await prisma.seoAudit.create({
        data: {
          domain,
          status: 'completed',
          completedAt: new Date(analysis.analyzed_at),
          config: {
            source: 's3',
            s3Key: key,
          },
          progress: {
            pagesDiscovered: Object.keys(categories).length,
            pagesCrawled: Object.keys(categories).length,
            pagesAnalyzed: Object.keys(categories).length,
          },
          summary,
        },
      });

      auditsImported++;

      // Create page entries for each category
      for (const [categoryName, category] of Object.entries(categories)) {
        const issues = [
          ...(category.issues || []).map(i => ({
            type: 'issue',
            severity: category.score < 50 ? 'critical' : 'warning',
            message: i,
          })),
          ...(category.recommendations || []).map(r => ({
            type: 'recommendation',
            severity: 'info',
            message: r,
            recommendation: r,
          })),
        ];

        await prisma.seoAuditPage.create({
          data: {
            auditId: audit.id,
            url: `${analysis.website}#${categoryName}`,
            statusCode: 200,
            title: categoryName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            metaDescription: category.findings?.slice(0, 2).join('. ') || null,
            headings: { h1: [categoryName], h2: category.findings?.slice(0, 5) || [] },
            images: {},
            links: {},
            issues,
          },
        });

        pagesImported++;
      }

      console.log(`    Imported audit with ${Object.keys(categories).length} categories`);
    } catch (error) {
      console.error(`    Error importing ${domain}:`, error);
    }
  }

  // Summary
  console.log('\n[3/3] Final summary...');

  const totalAudits = await prisma.seoAudit.count();
  const totalPages = await prisma.seoAuditPage.count();

  console.log(`\n${'='.repeat(50)}`);
  console.log('SEO DATA IMPORT COMPLETE');
  console.log(`${'='.repeat(50)}`);
  console.log(`Audits imported:      ${auditsImported}`);
  console.log(`Pages imported:       ${pagesImported}`);
  console.log('');
  console.log('Total in Aurora:');
  console.log(`  SEO Audits:         ${totalAudits}`);
  console.log(`  Audit Pages:        ${totalPages}`);

  // Show audit summaries
  const audits = await prisma.seoAudit.findMany({
    include: { _count: { select: { pages: true } } },
  });

  console.log('\nImported Audits:');
  for (const audit of audits) {
    const summary = audit.summary as { healthScore?: number } | null;
    console.log(`  ${audit.domain}: Score ${summary?.healthScore || 'N/A'}, ${audit._count.pages} pages`);
  }

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
