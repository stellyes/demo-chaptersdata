// ============================================
// RESEARCH & SEO DATA API ROUTE
// Loads industry research, SEO analysis, and QR data from S3
// ============================================

import { NextRequest } from 'next/server';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { gzipSync } from 'zlib';

// S3 Client singleton
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.CHAPTERS_AWS_REGION || process.env.AWS_REGION || 'us-west-1',
      credentials: {
        accessKeyId: process.env.CHAPTERS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.CHAPTERS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3Client;
}

// DynamoDB Client singleton
let dynamoClient: DynamoDBDocumentClient | null = null;

function getDynamoClient(): DynamoDBDocumentClient {
  if (!dynamoClient) {
    const client = new DynamoDBClient({
      region: process.env.CHAPTERS_AWS_REGION || process.env.AWS_REGION || 'us-west-1',
      credentials: {
        accessKeyId: process.env.CHAPTERS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.CHAPTERS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    dynamoClient = DynamoDBDocumentClient.from(client);
  }
  return dynamoClient;
}

const BUCKET = process.env.CHAPTERS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'retail-data-bcgr';
const QR_CODES_TABLE = process.env.DYNAMODB_QR_TABLE || 'qr-tracker-qr-codes';
const QR_CLICKS_TABLE = process.env.DYNAMODB_CLICKS_TABLE || 'qr-tracker-clicks';

interface ResearchFinding {
  id: string;
  date: string;
  category: string;
  summary: string;
  key_findings: string[];
  relevance: string;
  source?: string;
}

interface SEOSummary {
  site: string;
  score: number;
  priorities: string[];
  quickWins: string[];
  lastUpdated: string;
}

interface QRCode {
  shortCode: string;
  name: string;
  originalUrl: string;
  totalClicks: number;
  createdAt: string;
  active: boolean;
}

interface AIRecommendation {
  id: string;
  type: string;
  date: string;
  analysis: string;
  summary?: string;
}

// Cache
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let researchCache: CacheEntry<ResearchFinding[]> | null = null;
let seoCache: CacheEntry<SEOSummary[]> | null = null;
let qrCache: CacheEntry<QRCode[]> | null = null;
let recommendationsCache: CacheEntry<AIRecommendation[]> | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Download file from S3
async function downloadFromS3(key: string): Promise<string> {
  try {
    const client = getS3Client();
    const response = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return (await response.Body?.transformToString()) || '';
  } catch (error: unknown) {
    // Only log errors that aren't "file not found" - those are expected for optional files
    const errorCode = (error as { Code?: string })?.Code;
    if (errorCode !== 'NoSuchKey') {
      console.error(`Error downloading ${key}:`, error);
    }
    return '';
  }
}

// List files from S3
async function listS3Files(prefix: string): Promise<string[]> {
  const client = getS3Client();
  const files: string[] = [];
  let continuationToken: string | undefined;

  try {
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of response.Contents || []) {
        if (obj.Key) files.push(obj.Key);
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  } catch (error) {
    console.error(`Error listing S3 files for ${prefix}:`, error);
  }

  return files;
}

// Interface for key finding object from S3 files
interface KeyFindingObject {
  finding: string;
  relevance?: string;
  category?: string;
  action_required?: boolean;
  recommended_action?: string | null;
}

// Interface for category finding from S3 files
interface CategoryFinding {
  summary: string;
  key_findings: KeyFindingObject[];
}

// Parse a single finding from the findings_by_category structure
function parseCategoryFinding(
  categoryFinding: CategoryFinding,
  category: string,
  fileKey: string,
  analyzedAt: string,
  index: number
): ResearchFinding {
  // Extract key findings as strings
  const keyFindings = categoryFinding.key_findings?.map(kf => kf.finding) || [];

  // Determine relevance based on key findings
  const highRelevanceCount = categoryFinding.key_findings?.filter(kf => kf.relevance === 'high').length || 0;
  const relevance = highRelevanceCount >= 2 ? 'high' : highRelevanceCount >= 1 ? 'medium' : 'low';

  return {
    id: `${fileKey}-${category}-${index}`,
    date: analyzedAt,
    category: category,
    summary: categoryFinding.summary,
    key_findings: keyFindings,
    relevance: relevance,
  };
}

// Parse research document from various JSON formats
function parseResearchDocument(data: Record<string, unknown>, fileKey: string): ResearchFinding[] {
  const findings: ResearchFinding[] = [];
  const analyzedAt = String(data.analyzed_at || data.started_at || data.date || new Date().toISOString());

  // Format 1: findings_by_category structure (from automated analysis)
  if (data.findings_by_category && typeof data.findings_by_category === 'object') {
    const categories = data.findings_by_category as Record<string, CategoryFinding[]>;
    for (const [category, categoryFindings] of Object.entries(categories)) {
      if (Array.isArray(categoryFindings)) {
        categoryFindings.forEach((cf, idx) => {
          if (cf.summary) {
            findings.push(parseCategoryFinding(cf, category, fileKey, analyzedAt, idx));
          }
        });
      }
    }
    return findings;
  }

  // Format 2: Direct summary with key_findings (from manual upload)
  const summary = data.summary || data.description || data.content;
  if (summary && typeof summary === 'string') {
    let keyFindings: string[] = [];
    if (Array.isArray(data.key_findings)) {
      keyFindings = data.key_findings.map((kf: string | KeyFindingObject) =>
        typeof kf === 'string' ? kf : kf.finding
      );
    }

    findings.push({
      id: String(data.id || data.document_id || fileKey),
      date: analyzedAt,
      category: String(data.category || data.type || 'Research'),
      summary: summary,
      key_findings: keyFindings,
      relevance: String(data.relevance_score || data.relevance || 'medium'),
      source: data.source_url ? String(data.source_url) : (data.source ? String(data.source) : undefined),
    });
  }

  return findings;
}

// Load research findings from S3
async function loadResearchFindings(): Promise<ResearchFinding[]> {
  const findings: ResearchFinding[] = [];
  const seenIds = new Set<string>();

  // Helper to add findings with deduplication
  const addFindings = (newFindings: ResearchFinding[]) => {
    for (const f of newFindings) {
      if (!seenIds.has(f.id)) {
        seenIds.add(f.id);
        findings.push(f);
      }
    }
  };

  // Load from research-findings/manual/ (analyzed documents - recursive)
  try {
    const manualFiles = await listS3Files('research-findings/manual/');
    const jsonFiles = manualFiles
      .filter(f => f.endsWith('.json') && !f.includes('/monthly-summaries/'))
      .slice(0, 50);

    for (const file of jsonFiles) {
      const content = await downloadFromS3(file);
      if (content) {
        try {
          const data = JSON.parse(content);
          const parsed = parseResearchDocument(data, file);
          addFindings(parsed);
        } catch {
          // Skip invalid JSON files
        }
      }
    }
  } catch (error) {
    console.error('Error loading manual research:', error);
  }

  // Load from research-documents/ (user-uploaded documents - recursive)
  try {
    const documentFiles = await listS3Files('research-documents/');
    const jsonFiles = documentFiles.filter(f => f.endsWith('.json')).slice(0, 50);

    for (const file of jsonFiles) {
      const content = await downloadFromS3(file);
      if (content) {
        try {
          const data = JSON.parse(content);
          const parsed = parseResearchDocument(data, file);
          // Mark uploaded documents with category if not set
          for (const p of parsed) {
            if (p.category === 'Research') {
              p.category = 'Uploaded Document';
            }
          }
          addFindings(parsed);
        } catch {
          // Skip invalid JSON files
        }
      }
    }
  } catch (error) {
    console.error('Error loading research-documents:', error);
  }

  // Sort by date descending (most recent first)
  findings.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return findings;
}

// Load SEO analysis data
async function loadSEOData(): Promise<SEOSummary[]> {
  const seoData: SEOSummary[] = [];

  // Sites with their S3 folder names (include .com suffix as that's how they're stored)
  const sites = [
    { id: 'barbarycoastsf', folder: 'barbarycoastsf.com', displayName: 'Barbary Coast' },
    { id: 'grassrootssf', folder: 'grassrootssf.com', displayName: 'Grass Roots' },
  ];

  for (const site of sites) {
    try {
      // First try to load the latest summary file directly
      const latestPath = `seo-analysis/${site.folder}/summary/latest.json`;
      let content = await downloadFromS3(latestPath);

      // If no latest.json, try to find the most recent file in the folder
      if (!content) {
        const files = await listS3Files(`seo-analysis/${site.folder}/`);
        const jsonFiles = files
          .filter(f => f.endsWith('.json') && !f.includes('/summary/'))
          .sort()
          .reverse();

        if (jsonFiles.length > 0) {
          content = await downloadFromS3(jsonFiles[0]);
        }
      }

      if (content) {
        const data = JSON.parse(content);

        // Extract priorities - could be strings or objects with 'priority' field
        let priorities: string[] = [];
        const rawPriorities = data.priorities || data.top_priorities || [];
        if (Array.isArray(rawPriorities)) {
          priorities = rawPriorities.map((p: string | { priority: string }) =>
            typeof p === 'string' ? p : p.priority
          ).filter(Boolean);
        }

        // Extract quick wins - could be strings or objects with 'win' or 'action' field
        let quickWins: string[] = [];
        const rawQuickWins = data.quick_wins || data.quickWins || [];
        if (Array.isArray(rawQuickWins)) {
          quickWins = rawQuickWins.map((w: string | { win?: string; action?: string }) =>
            typeof w === 'string' ? w : (w.win || w.action || '')
          ).filter(Boolean);
        }

        seoData.push({
          site: site.displayName,
          score: data.score || data.overall_score || 0,
          priorities,
          quickWins,
          lastUpdated: data.analyzed_at || data.lastUpdated || data.date || new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error(`Error loading SEO data for ${site.id}:`, error);
    }
  }

  return seoData;
}

// Load QR codes from DynamoDB
async function loadQRData(): Promise<QRCode[]> {
  const client = getDynamoClient();
  const qrCodes: QRCode[] = [];

  try {
    const response = await client.send(
      new ScanCommand({
        TableName: QR_CODES_TABLE,
        FilterExpression: 'deleted <> :deleted',
        ExpressionAttributeValues: { ':deleted': true },
      })
    );

    for (const item of response.Items || []) {
      qrCodes.push({
        shortCode: String(item.short_code || item.shortCode || ''),
        name: String(item.name || ''),
        originalUrl: String(item.original_url || item.originalUrl || ''),
        totalClicks: Number(item.total_clicks || item.totalClicks || 0),
        createdAt: String(item.created_at || item.createdAt || ''),
        active: Boolean(item.active !== false),
      });
    }
  } catch (error) {
    console.error('Error loading QR data:', error);
  }

  return qrCodes;
}

// Load past AI recommendations from S3
async function loadAIRecommendations(): Promise<AIRecommendation[]> {
  const recommendations: AIRecommendation[] = [];

  try {
    // Check for cached AI reports (stored in ai-reports/)
    const files = await listS3Files('ai-reports/');
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse().slice(0, 50);

    for (const file of jsonFiles) {
      const content = await downloadFromS3(file);
      if (content) {
        try {
          const data = JSON.parse(content);
          // Map the actual S3 file structure to our interface
          // Files have: report_id, timestamp, date, question, answer, model_type, model_name
          recommendations.push({
            id: data.report_id || file,
            type: data.model_type || data.type || 'general',
            date: data.timestamp || data.date || new Date().toISOString(),
            analysis: data.answer || data.analysis || data.content || '',
            summary: data.question || data.summary || data.title,
          });
        } catch {
          // Skip invalid files
        }
      }
    }
  } catch (error) {
    console.error('Error loading AI recommendations:', error);
  }

  return recommendations;
}

export async function GET(request: NextRequest) {
  try {
    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get('refresh') === 'true';
    const includeDebug = url.searchParams.get('debug') === 'true';

    // Check caches and load fresh data if needed
    const now = Date.now();
    let fromCache = true;

    if (forceRefresh || !researchCache || now - researchCache.timestamp > CACHE_TTL) {
      const research = await loadResearchFindings();
      researchCache = { data: research, timestamp: now };
      fromCache = false;
    }

    if (forceRefresh || !seoCache || now - seoCache.timestamp > CACHE_TTL) {
      const seo = await loadSEOData();
      seoCache = { data: seo, timestamp: now };
      fromCache = false;
    }

    if (forceRefresh || !qrCache || now - qrCache.timestamp > CACHE_TTL) {
      const qr = await loadQRData();
      qrCache = { data: qr, timestamp: now };
      fromCache = false;
    }

    if (forceRefresh || !recommendationsCache || now - recommendationsCache.timestamp > CACHE_TTL) {
      const recommendations = await loadAIRecommendations();
      recommendationsCache = { data: recommendations, timestamp: now };
      fromCache = false;
    }

    const responseData: Record<string, unknown> = {
      success: true,
      data: {
        research: researchCache.data,
        seo: seoCache.data,
        qrCodes: qrCache.data,
        aiRecommendations: recommendationsCache.data,
      },
      counts: {
        research: researchCache.data.length,
        seo: seoCache.data.length,
        qrCodes: qrCache.data.length,
        aiRecommendations: recommendationsCache.data.length,
      },
      cached: fromCache,
    };

    // Include debug info when requested
    if (includeDebug) {
      responseData.debug = {
        bucket: BUCKET,
        s3Paths: {
          researchFindings: 'research-findings/',
          researchDocuments: 'research-documents/',
          seoAnalysis: 'seo-analysis/',
          aiReports: 'ai-reports/',
        },
        seoSitesLoaded: seoCache.data.map(s => s.site),
        researchSources: researchCache.data.slice(0, 5).map(r => ({ id: r.id, category: r.category })),
        cacheTimestamp: new Date(researchCache.timestamp).toISOString(),
      };
    }

    if (supportsGzip) {
      const compressed = gzipSync(JSON.stringify(responseData));
      return new Response(compressed, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        },
      });
    }

    return Response.json(responseData);
  } catch (error) {
    console.error('Research data loading error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load research data',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
