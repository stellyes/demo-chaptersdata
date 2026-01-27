// ============================================
// CUSTOM AI QUERY API ROUTE
// Loads data server-side to avoid payload size limits
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '@/lib/prisma';
import { buildDataContext, customQuery, DataContextOptions, PastAIReport } from '@/lib/services/claude';

// S3 Client singleton
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const config = {
      region: process.env.CHAPTERS_AWS_REGION || process.env.AWS_REGION || 'us-west-1',
      credentials: {
        accessKeyId: process.env.CHAPTERS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.CHAPTERS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s3Client = new S3Client(config as any);
  }
  return s3Client;
}

const BUCKET = process.env.CHAPTERS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'retail-data-bcgr';

// Health check report type for context
interface HealthCheckReportContext {
  timestamp: string;
  summary: {
    totalGaps: number;
    criticalGaps: number;
    warningGaps: number;
    overallHealthScore: number;
  };
  dataFreshness: Array<{ source: string; lastDataPoint: string; dataLagDays: number; status: string }>;
  gaps: Array<{ type: string; severity: string; source: string; description: string; suggestedAction?: string }>;
  trends: Array<{ metric: string; currentValue: number; baselineValue: number; percentChange: number; direction: string; severity: string }>;
  insights: string[];
}

// Load latest health check from S3
async function loadLatestHealthCheck(): Promise<HealthCheckReportContext | null> {
  try {
    const client = getS3Client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: 'data-health/latest.json',
      })
    );
    const content = await response.Body?.transformToString();
    if (content) {
      return JSON.parse(content) as HealthCheckReportContext;
    }
    return null;
  } catch {
    // Health check not yet run
    return null;
  }
}

// Load past AI reports with feedback for learning context
async function loadPastReportsWithFeedback(limit: number = 10): Promise<PastAIReport[]> {
  try {
    const client = getS3Client();
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: 'ai-reports/',
        MaxKeys: 100,
      })
    );

    if (!response.Contents) return [];

    const reports: PastAIReport[] = [];
    const jsonFiles = response.Contents
      .filter(obj => obj.Key?.endsWith('.json'))
      .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0))
      .slice(0, limit * 2); // Get extra in case some fail

    for (const obj of jsonFiles) {
      if (reports.length >= limit) break;
      if (!obj.Key) continue;

      try {
        const data = await client.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key })
        );
        const content = await data.Body?.transformToString();
        if (content) {
          const report = JSON.parse(content);
          reports.push({
            report_id: report.report_id || obj.Key,
            date: report.timestamp || report.date || '',
            question: report.question || report.summary || '',
            answer: report.answer || report.analysis || '',
            model_type: report.model_type || 'unknown',
            data_sources: report.data_sources,
            feedback: report.feedback,
          });
        }
      } catch {
        // Skip invalid files
      }
    }

    return reports;
  } catch (error) {
    console.error('Error loading past reports:', error);
    return [];
  }
}

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

// Save report to Aurora database
async function saveReportToAurora(report: {
  type: string;
  analysis: string;
  summary?: string;
}): Promise<void> {
  try {
    await prisma.analysisHistory.create({
      data: {
        analysisType: report.type,
        inputSummary: report.summary || 'Custom Query',
        outputSummary: report.analysis,
        model: 'claude-3-5-sonnet',
      },
    });
  } catch (error) {
    console.error('Error saving report to Aurora:', error);
  }
}

// Load data from Aurora based on context options
async function loadDataFromAurora(contextOptions: DataContextOptions) {
  const data: {
    sales: Array<Record<string, unknown>>;
    brands: Array<Record<string, unknown>>;
    products: Array<Record<string, unknown>>;
    customers: Array<Record<string, unknown>>;
    invoices: Array<Record<string, unknown>>;
    research: Array<{ id: string; summary: string; key_findings: string[]; category: string; date: string; source?: string }>;
    seo: Array<{ site: string; score: number; priorities: string[]; quickWins: string[] }>;
    qrCodes: Array<{ name: string; totalClicks: number; shortCode: string }>;
    brandMappings: Record<string, { aliases: Record<string, string> }>;
  } = {
    sales: [],
    brands: [],
    products: [],
    customers: [],
    invoices: [],
    research: [],
    seo: [],
    qrCodes: [],
    brandMappings: {},
  };

  // Load data in parallel based on what's requested
  const loadPromises: Promise<void>[] = [];

  if (contextOptions.includeSales) {
    loadPromises.push(
      prisma.salesRecord.findMany({
        orderBy: { date: 'desc' },
        take: 365, // Last year of daily data
      }).then(records => {
        data.sales = records.map(r => ({
          date: r.date.toISOString().split('T')[0],
          store: r.storeName || r.storeId,
          store_id: r.storeId,
          net_sales: Number(r.netSales),
          gross_margin_pct: Number(r.grossMarginPct),
          tickets_count: r.ticketsCount,
          customers_count: r.customersCount,
          avg_order_value: Number(r.avgOrderValue),
        }));
      })
    );
  }

  if (contextOptions.includeBrands) {
    loadPromises.push(
      prisma.brandRecord.findMany({
        orderBy: { netSales: 'desc' },
        take: 100, // Top 100 brands
        include: { brand: true },
      }).then(records => {
        data.brands = records.map(r => ({
          brand: r.brand?.canonicalName || r.originalBrandName,
          net_sales: Number(r.netSales),
          gross_margin_pct: Number(r.grossMarginPct),
          pct_of_total_net_sales: Number(r.pctOfTotalNetSales),
          store_id: r.storeId,
        }));
      })
    );
  }

  if (contextOptions.includeProducts) {
    loadPromises.push(
      prisma.productRecord.findMany({
        orderBy: { netSales: 'desc' },
        take: 50,
      }).then(records => {
        data.products = records.map(r => ({
          product_type: r.productType,
          net_sales: Number(r.netSales),
          gross_margin_pct: Number(r.grossMarginPct),
          pct_of_total_net_sales: Number(r.pctOfTotalNetSales),
          store_id: r.storeId,
        }));
      })
    );
  }

  if (contextOptions.includeCustomers) {
    loadPromises.push(
      prisma.customer.findMany({
        orderBy: { lifetimeNetSales: 'desc' },
        take: 500, // Top 500 customers by lifetime value
      }).then(records => {
        data.customers = records.map(c => ({
          customer_id: c.customerId,
          store_name: c.storeName,
          lifetime_net_sales: Number(c.lifetimeNetSales),
          lifetime_visits: c.lifetimeVisits,
          customer_segment: c.customerSegment,
          recency_segment: c.recencySegment,
        }));
      })
    );
  }

  if (contextOptions.includeInvoices) {
    loadPromises.push(
      prisma.invoiceLineItem.findMany({
        orderBy: { invoice: { invoiceDate: 'desc' } },
        take: 500, // Recent invoice line items
        include: {
          invoice: { include: { vendor: true } },
          brand: true,
        },
      }).then(records => {
        data.invoices = records.map(item => ({
          vendor: item.invoice.vendor?.canonicalName || item.invoice.originalVendorName || 'Unknown',
          brand: item.brand?.canonicalName || item.originalBrandName,
          product_type: item.productType || 'Unknown',
          total_cost: Number(item.totalCost),
          units: item.skuUnits,
          invoice_date: item.invoice.invoiceDate?.toISOString().split('T')[0],
        }));
      })
    );
  }

  if (contextOptions.includeResearch) {
    loadPromises.push(
      prisma.researchDocument.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { findings: true },
      }).then(records => {
        data.research = records.map(r => ({
          id: r.id,
          summary: r.summary || '',
          key_findings: r.findings.map(f => f.finding),
          category: r.category,
          date: r.createdAt.toISOString().split('T')[0],
          source: r.sourceUrl || undefined,
        }));
      })
    );
  }

  // Always load brand mappings for context
  loadPromises.push(
    prisma.canonicalBrand.findMany({
      include: { aliases: true },
    }).then(brands => {
      for (const brand of brands) {
        const aliases: Record<string, string> = {};
        for (const alias of brand.aliases) {
          aliases[alias.aliasName] = alias.productType || '';
        }
        data.brandMappings[brand.canonicalName] = { aliases };
      }
    })
  );

  await Promise.all(loadPromises);

  return data;
}

interface RequestBody {
  prompt: string;
  contextOptions: DataContextOptions;
  selectedResearchIds?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { prompt, contextOptions, selectedResearchIds } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Prompt is required' },
        { status: 400 }
      );
    }

    console.log('[AI Query] Loading data from Aurora based on context options...');

    // Load data server-side based on context options
    const data = await loadDataFromAurora(contextOptions);

    console.log(`[AI Query] Loaded: ${data.sales.length} sales, ${data.brands.length} brands, ${data.customers.length} customers`);

    // Get selected research documents for full detail
    let selectedResearchDocs: Array<{ id: string; summary: string; key_findings: string[]; category: string; source?: string }> | undefined;
    if (selectedResearchIds && selectedResearchIds.length > 0 && data.research) {
      selectedResearchDocs = data.research.filter(r => selectedResearchIds.includes(r.id));
    }

    // Load past reports with feedback for learning context
    const pastReports = await loadPastReportsWithFeedback(5);

    // Load latest health check for data quality awareness
    const healthCheck = await loadLatestHealthCheck();

    // Auto-enable health check in context if data is available
    const enhancedContextOptions = {
      ...contextOptions,
      includeHealthCheck: healthCheck !== null,
    };

    // Build the data context with token-efficient summaries and learning context
    const dataContext = buildDataContext(
      { ...data, pastReports, healthCheck: healthCheck || undefined },
      enhancedContextOptions,
      selectedResearchDocs
    );

    // Execute the custom query
    const analysis = await customQuery(prompt, dataContext);

    // Generate report metadata
    const reportId = `report-custom-${Date.now()}`;
    const reportDate = new Date().toISOString();

    // Save to S3 in background (non-critical)
    const reportSummary = prompt.slice(0, 200) + (prompt.length > 200 ? '...' : '');
    saveReportToS3({
      id: reportId,
      type: 'custom',
      date: reportDate,
      analysis,
      summary: reportSummary,
    });

    // Save to Aurora - await this to ensure it completes for history
    try {
      await saveReportToAurora({
        type: 'custom',
        analysis,
        summary: reportSummary,
      });
      console.log(`[AI Query] Custom query report saved to Aurora`);
    } catch (error) {
      console.error(`[AI Query] Failed to save report to Aurora:`, error);
    }

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
          sales: contextOptions.includeSales && data.sales.length > 0,
          brands: contextOptions.includeBrands && data.brands.length > 0,
          products: contextOptions.includeProducts && data.products.length > 0,
          customers: contextOptions.includeCustomers && data.customers.length > 0,
          invoices: contextOptions.includeInvoices && data.invoices.length > 0,
          research: contextOptions.includeResearch && data.research.length > 0,
          seo: false, // SEO not loaded from Aurora yet
          qrCodes: false, // QR codes not loaded from Aurora yet
          selectedResearch: selectedResearchDocs?.length || 0,
          healthCheck: healthCheck !== null,
        },
      },
    });
  } catch (error) {
    console.error('Custom AI query error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Custom query failed' },
      { status: 500 }
    );
  }
}
