// ============================================
// DATA HEALTH CHECK API ROUTE
// Runs proactive data gap and trend detection
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { runFullHealthCheck, HealthCheckInput } from '@/lib/services/data-health';
import { HealthCheckReport, BrandMappingData } from '@/types';

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
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // Accept data directly in request body or load from other endpoints
    const inputData: HealthCheckInput = {};

    // If data provided in body, use it
    if (body.sales) inputData.sales = body.sales;
    if (body.brands) inputData.brands = body.brands;
    if (body.customers) inputData.customers = body.customers;
    if (body.invoices) inputData.invoices = body.invoices;

    // Load brand mappings from S3 for alias checking
    inputData.brandMappings = await loadBrandMappings();

    // If no data provided, we need to fetch it
    // In a real scenario, this would call the other API endpoints
    // For now, we'll run with whatever data is provided
    if (!inputData.sales && !inputData.invoices && !inputData.customers) {
      // Return instructions for the client to provide data
      return NextResponse.json({
        success: true,
        data: {
          message: 'Health check requires data. Please provide sales, invoices, and/or customers in the request body.',
          example: {
            sales: '[array of sales records]',
            invoices: '[array of invoice line items]',
            customers: '[array of customer records]',
            brands: '[array of brand records]',
          },
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
