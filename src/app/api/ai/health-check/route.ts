// ============================================
// DATA HEALTH CHECK API ROUTE
// Runs proactive data gap and trend detection
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { runFullHealthCheck, HealthCheckInput } from '@/lib/services/data-health';
import { HealthCheckReport, BrandMappingData, InvoiceLineItem } from '@/types';
import { prisma } from '@/lib/prisma';

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
const HEALTH_CHECK_PREFIX = 'data-health';

// Load latest health check from S3
async function loadLatestHealthCheck(): Promise<HealthCheckReport | null> {
  try {
    const client = getS3Client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: `${HEALTH_CHECK_PREFIX}/latest.json`,
      })
    );
    const content = await response.Body?.transformToString();
    if (content) {
      return JSON.parse(content) as HealthCheckReport;
    }
    return null;
  } catch {
    // File doesn't exist yet
    return null;
  }
}

// Save health check to S3
async function saveHealthCheck(report: HealthCheckReport): Promise<void> {
  const client = getS3Client();

  // Save as latest
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${HEALTH_CHECK_PREFIX}/latest.json`,
      Body: JSON.stringify(report, null, 2),
      ContentType: 'application/json',
    })
  );

  // Also save to history
  const date = new Date(report.timestamp);
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const historyKey = `${HEALTH_CHECK_PREFIX}/history/${yearMonth}/${report.report_id}.json`;

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: historyKey,
      Body: JSON.stringify(report, null, 2),
      ContentType: 'application/json',
    })
  );
}

// Minimal sales data needed for health check (only fields used by data-health.ts)
interface HealthCheckSalesData {
  date: string;
  store: string;
  store_id: string;
  net_sales: number;
  gross_margin_pct: number;
  tickets_count: number;
  customers_count: number;
}

// Minimal customer data needed for health check (only fields used by data-health.ts)
interface HealthCheckCustomerData {
  customer_id: string;
  store_name: string;
  lifetime_net_sales: number;
  lifetime_visits: number;
  customer_segment: string | null;
  recency_segment: string | null;
  last_visit_date: string;
}

// Load recent sales data from database (last 60 days for trend analysis)
async function loadRecentSalesData(): Promise<HealthCheckSalesData[]> {
  try {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const records = await prisma.salesRecord.findMany({
      where: { date: { gte: sixtyDaysAgo } },
      orderBy: { date: 'desc' },
    });

    return records.map((r) => ({
      date: r.date.toISOString().split('T')[0],
      store: r.storeName || r.storeId,
      store_id: r.storeId,
      net_sales: Number(r.netSales),
      gross_margin_pct: Number(r.grossMarginPct),
      tickets_count: r.ticketsCount,
      customers_count: r.customersCount,
    }));
  } catch (error) {
    console.error('Error loading sales data for health check:', error);
    return [];
  }
}

// Load customer data from database
async function loadCustomerData(): Promise<HealthCheckCustomerData[]> {
  try {
    const records = await prisma.customer.findMany({
      orderBy: { lifetimeNetSales: 'desc' },
      take: 1000, // Top 1000 customers
    });

    return records.map((c) => ({
      customer_id: c.customerId,
      store_name: c.storeName,
      lifetime_net_sales: Number(c.lifetimeNetSales),
      lifetime_visits: c.lifetimeVisits,
      customer_segment: c.customerSegment,
      recency_segment: c.recencySegment,
      last_visit_date: c.lastVisitDate?.toISOString().split('T')[0] || '',
    }));
  } catch (error) {
    console.error('Error loading customer data for health check:', error);
    return [];
  }
}

// Load recent invoice data from database (last 60 days for trend analysis)
async function loadRecentInvoiceData(): Promise<InvoiceLineItem[]> {
  try {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const lineItems = await prisma.invoiceLineItem.findMany({
      where: {
        invoice: {
          invoiceDate: { gte: sixtyDaysAgo },
        },
      },
      include: {
        invoice: {
          include: { vendor: true },
        },
        brand: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transform to frontend format
    return lineItems.map((item) => ({
      invoice_id: item.invoiceId,
      line_item_id: `${item.invoiceId}-${item.lineNumber}`,
      vendor: item.invoice?.vendor?.canonicalName || item.invoice?.originalVendorName || 'Unknown',
      brand: item.brand?.canonicalName || item.originalBrandName,
      product_name: item.productName || '',
      product_type: item.productType || '',
      product_subtype: item.productSubtype || undefined,
      sku_units: item.skuUnits,
      unit_cost: Number(item.unitCost),
      total_cost: Number(item.totalCost),
      total_with_excise: Number(item.totalCostWithExcise),
      strain: item.strain || undefined,
      unit_size: item.unitSize || undefined,
      trace_id: item.traceId || undefined,
      is_promo: item.isPromo,
      invoice_date: item.invoice?.invoiceDate?.toISOString().split('T')[0],
    }));
  } catch (error) {
    console.error('Error loading invoice data for health check:', error);
    return [];
  }
}

// Load brand mappings from S3
async function loadBrandMappings(): Promise<BrandMappingData | null> {
  try {
    const client = getS3Client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: 'config/brand_product_mapping.json',
      })
    );
    const content = await response.Body?.transformToString();
    if (content) {
      return JSON.parse(content) as BrandMappingData;
    }
    return null;
  } catch {
    return null;
  }
}

// GET - Retrieve latest health check
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeHistory = searchParams.get('history') === 'true';

    const latestReport = await loadLatestHealthCheck();

    if (!latestReport) {
      return NextResponse.json({
        success: true,
        data: {
          report: null,
          message: 'No health check has been run yet. Trigger one with POST.',
        },
      });
    }

    // Calculate time since last check
    const lastCheckTime = new Date(latestReport.timestamp);
    const hoursSinceCheck = Math.floor(
      (Date.now() - lastCheckTime.getTime()) / (1000 * 60 * 60)
    );

    const response: {
      success: boolean;
      data: {
        report: HealthCheckReport;
        meta: {
          hoursSinceCheck: number;
          isStale: boolean;
        };
        history?: unknown;
      };
    } = {
      success: true,
      data: {
        report: latestReport,
        meta: {
          hoursSinceCheck,
          isStale: hoursSinceCheck > 24,
        },
      },
    };

    // Optionally load history
    if (includeHistory) {
      // For now, just return the latest - history loading could be added later
      response.data.history = [];
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error loading health check:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load health check' },
      { status: 500 }
    );
  }
}

// POST - Trigger new health check
export async function POST() {
  try {
    // Load all data directly from Aurora database (server-side)
    // This ensures health check works regardless of frontend state
    const [salesData, customerData, invoiceData, brandMappings] = await Promise.all([
      loadRecentSalesData(),
      loadCustomerData(),
      loadRecentInvoiceData(),
      loadBrandMappings(),
    ]);

    // Cast to expected types - our minimal data includes all fields used by health check
    const inputData: HealthCheckInput = {
      sales: salesData as unknown as HealthCheckInput['sales'],
      customers: customerData as unknown as HealthCheckInput['customers'],
      invoices: invoiceData,
      brandMappings,
    };

    // Check if we have any data to analyze
    if (salesData.length === 0 && invoiceData.length === 0 && customerData.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          report: null,
          message: 'No data available in the database to analyze. Upload sales, invoice, or customer data first.',
        },
      });
    }

    // Run the health check
    const report = await runFullHealthCheck(inputData);

    // Save to S3
    await saveHealthCheck(report);

    return NextResponse.json({
      success: true,
      data: {
        report,
        saved: true,
        message: `Health check complete. Score: ${report.summary.overallHealthScore}/100`,
      },
    });
  } catch (error) {
    console.error('Error running health check:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to run health check' },
      { status: 500 }
    );
  }
}
