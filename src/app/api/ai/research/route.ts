// ============================================
// AI RESEARCH DOCUMENT ANALYSIS API ROUTE
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { analyzeResearchDocument, BillingContext } from '@/lib/services/claude';

// Helper to extract orgId from request headers
function getOrgIdFromRequest(request: NextRequest): string | null {
  return request.headers.get('X-Org-Id') || request.headers.get('x-org-id');
}

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

const BUCKET = process.env.CHAPTERS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'retail-data-bcgr';

// Save analyzed research document to S3
async function saveResearchToS3(data: {
  id: string;
  filename: string;
  category: string;
  source_url?: string;
  summary: string;
  key_findings: Array<{
    finding: string;
    relevance: string;
    category: string;
    action_required: boolean;
    recommended_action?: string;
  }>;
  key_facts: string[];
  relevance_score: string;
  date_mentioned?: string;
  analyzed_at: string;
}): Promise<boolean> {
  try {
    const client = getS3Client();
    const key = `research-findings/manual/${data.id}.json`;

    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json',
      })
    );

    return true;
  } catch (error) {
    console.error('Error saving research to S3:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { filename, content, category, sourceUrl } = await request.json();

    if (!filename || !content) {
      return NextResponse.json(
        { success: false, error: 'Missing filename or content' },
        { status: 400 }
      );
    }

    if (!category) {
      return NextResponse.json(
        { success: false, error: 'Category is required' },
        { status: 400 }
      );
    }

    // Get billing context from request header
    const orgId = getOrgIdFromRequest(request);
    const billingContext: BillingContext | undefined = orgId
      ? { orgId, category: 'research', actionName: 'analyze_research_document' }
      : undefined;

    if (!orgId) {
      console.warn('[Billing] No X-Org-Id header provided, skipping billing for research analysis');
    }

    // Analyze the document using Claude
    const analysis = await analyzeResearchDocument(content, filename, billingContext);

    // Generate unique ID
    const docId = `research-${Date.now()}`;
    const analyzedAt = new Date().toISOString();

    // Save to S3
    const saveData = {
      id: docId,
      filename,
      category,
      source_url: sourceUrl || undefined,
      summary: analysis.summary,
      key_findings: analysis.key_findings,
      key_facts: analysis.key_facts,
      relevance_score: analysis.relevance_score,
      date_mentioned: analysis.date_mentioned,
      analyzed_at: analyzedAt,
    };

    // Save to S3 in background (don't await to not block response)
    saveResearchToS3(saveData).catch((err) => {
      console.error('Failed to save research to S3:', err);
    });

    return NextResponse.json({
      success: true,
      data: {
        id: docId,
        filename,
        category,
        sourceUrl,
        summary: analysis.summary,
        key_findings: analysis.key_findings,
        key_facts: analysis.key_facts,
        relevance_score: analysis.relevance_score,
        date_mentioned: analysis.date_mentioned,
        analyzed_at: analyzedAt,
      },
    });
  } catch (error) {
    console.error('Research analysis error:', error);
    return NextResponse.json(
      { success: false, error: 'Research analysis failed' },
      { status: 500 }
    );
  }
}
