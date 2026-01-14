// ============================================
// AI ANALYSIS API ROUTE
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  analyzeSalesTrends,
  analyzeBrandPerformance,
  analyzeCategoryPerformance,
  analyzeCustomerData,
  generateBusinessInsights,
} from '@/lib/services/claude';

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
      question: report.summary || `${report.type} analysis`,
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

// Generate analysis title based on type
function getAnalysisTitle(type: string): string {
  switch (type) {
    case 'sales':
      return 'Sales Trends Analysis';
    case 'brands':
      return 'Brand Performance Analysis';
    case 'categories':
      return 'Category Analysis';
    case 'insights':
      return 'Business Intelligence';
    default:
      return `${type} Analysis`;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { type, data } = await request.json();

    if (!type || !data) {
      return NextResponse.json(
        { success: false, error: 'Missing type or data' },
        { status: 400 }
      );
    }

    let analysis: string;

    switch (type) {
      case 'sales':
        analysis = await analyzeSalesTrends(data);
        break;
      case 'brands':
        analysis = await analyzeBrandPerformance(data.brandData, data.brandByCategory);
        break;
      case 'categories':
        analysis = await analyzeCategoryPerformance(data.categoryData, data.brandSummary);
        break;
      case 'customers':
        analysis = await analyzeCustomerData(data);
        break;
      case 'insights':
        analysis = await generateBusinessInsights(data);
        break;
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid analysis type' },
          { status: 400 }
        );
    }

    // Generate report metadata
    const reportId = `report-${type}-${Date.now()}`;
    const reportDate = new Date().toISOString();
    const reportSummary = getAnalysisTitle(type);

    // Save to S3 (don't block response on this)
    saveReportToS3({
      id: reportId,
      type,
      date: reportDate,
      analysis,
      summary: reportSummary,
    });

    return NextResponse.json({
      success: true,
      data: {
        analysis,
        report: {
          id: reportId,
          type,
          date: reportDate,
          analysis,
          summary: reportSummary,
        },
      },
    });
  } catch (error) {
    console.error('AI analysis error:', error);
    return NextResponse.json(
      { success: false, error: 'AI analysis failed' },
      { status: 500 }
    );
  }
}
