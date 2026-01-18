// ============================================
// CUSTOM AI QUERY API ROUTE
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { buildDataContext, customQuery, DataContextOptions } from '@/lib/services/claude';

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

// Save report to S3
async function saveReportToS3(report: {
  id: string;
  type: string;
  date: string;
  analysis: string;
  summary?: string;
}): Promise<boolean> {
  try {
    const client = getS3Client();
    const key = `ai-reports/${report.id}.json`;

    const reportData = {
      report_id: report.id,
      model_type: report.type,
      timestamp: report.date,
      date: report.date,
      answer: report.analysis,
      question: report.summary || 'Custom Query',
      model_name: 'claude',
    };

    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(reportData, null, 2),
        ContentType: 'application/json',
      })
    );

    return true;
  } catch (error) {
    console.error('Error saving report to S3:', error);
    return false;
  }
}

// Brand mapping type (from S3 config/brand_product_mapping.json)
interface BrandMappingData {
  [canonicalBrand: string]: {
    aliases: { [aliasName: string]: string }; // alias -> product_type
  };
}

interface RequestBody {
  prompt: string;
  contextOptions: DataContextOptions;
  data: {
    sales?: Array<Record<string, unknown>>;
    brands?: Array<Record<string, unknown>>;
    products?: Array<Record<string, unknown>>;
    customers?: Array<Record<string, unknown>>;
    invoices?: Array<Record<string, unknown>>;
    research?: Array<{ id: string; summary: string; key_findings: string[]; category: string; date: string; source?: string }>;
    seo?: Array<{ site: string; score: number; priorities: string[]; quickWins: string[] }>;
    qrCodes?: Array<{ name: string; totalClicks: number; shortCode: string }>;
    brandMappings?: BrandMappingData;
  };
  selectedResearchIds?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { prompt, contextOptions, data, selectedResearchIds } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Get selected research documents for full detail
    let selectedResearchDocs: Array<{ id: string; summary: string; key_findings: string[]; category: string; source?: string }> | undefined;
    if (selectedResearchIds && selectedResearchIds.length > 0 && data.research) {
      selectedResearchDocs = data.research.filter(r => selectedResearchIds.includes(r.id));
    }

    // Build the data context with token-efficient summaries
    const dataContext = buildDataContext(data, contextOptions, selectedResearchDocs);

    // Execute the custom query
    const analysis = await customQuery(prompt, dataContext);

    // Generate report metadata
    const reportId = `report-custom-${Date.now()}`;
    const reportDate = new Date().toISOString();

    // Save to S3 (don't block response on this)
    saveReportToS3({
      id: reportId,
      type: 'custom',
      date: reportDate,
      analysis,
      summary: prompt.slice(0, 200) + (prompt.length > 200 ? '...' : ''),
    });

    return NextResponse.json({
      success: true,
      data: {
        analysis,
        report: {
          id: reportId,
          type: 'custom',
          date: reportDate,
          analysis,
          summary: prompt.slice(0, 200) + (prompt.length > 200 ? '...' : ''),
        },
        contextUsed: {
          sales: contextOptions.includeSales && (data.sales?.length || 0) > 0,
          brands: contextOptions.includeBrands && (data.brands?.length || 0) > 0,
          products: contextOptions.includeProducts && (data.products?.length || 0) > 0,
          customers: contextOptions.includeCustomers && (data.customers?.length || 0) > 0,
          invoices: contextOptions.includeInvoices && (data.invoices?.length || 0) > 0,
          research: contextOptions.includeResearch && (data.research?.length || 0) > 0,
          seo: contextOptions.includeSeo && (data.seo?.length || 0) > 0,
          qrCodes: contextOptions.includeQrCodes && (data.qrCodes?.length || 0) > 0,
          selectedResearch: selectedResearchDocs?.length || 0,
        },
      },
    });
  } catch (error) {
    console.error('Custom AI query error:', error);
    return NextResponse.json(
      { success: false, error: 'Custom query failed' },
      { status: 500 }
    );
  }
}
