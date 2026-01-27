// ============================================
// AI REPORT FEEDBACK API ROUTE
// Saves user feedback on AI recommendations for learning
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

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

interface ReportFeedback {
  helpful?: boolean;
  rating?: number; // 1-5
  implemented?: boolean;
  outcome?: 'positive' | 'negative' | 'neutral' | 'unknown';
  notes?: string;
  feedbackDate?: string;
}

interface FeedbackRequest {
  reportId: string;
  feedback: ReportFeedback;
}

// Find the report file by ID across date-organized folders
async function findReportFile(reportId: string): Promise<string | null> {
  const client = getS3Client();

  // Try common date patterns
  const now = new Date();
  const searchPaths = [
    `ai-reports/${reportId}.json`,
    `ai-reports/report-${reportId}.json`,
  ];

  // Add recent month/year paths
  for (let i = 0; i < 3; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    searchPaths.push(`ai-reports/${yyyy}/${mm}/${reportId}.json`);
  }

  for (const path of searchPaths) {
    try {
      await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: path }));
      return path;
    } catch {
      // File not found at this path, try next
    }
  }

  return null;
}

// POST - Save feedback for a report
export async function POST(request: NextRequest) {
  try {
    const body: FeedbackRequest = await request.json();
    const { reportId, feedback } = body;

    if (!reportId || !feedback) {
      return NextResponse.json(
        { success: false, error: 'Report ID and feedback are required' },
        { status: 400 }
      );
    }

    const client = getS3Client();

    // Find the report file
    const reportPath = await findReportFile(reportId);

    if (!reportPath) {
      // Report not found - create a feedback-only entry
      const feedbackEntry = {
        report_id: reportId,
        feedback: {
          ...feedback,
          feedbackDate: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      };

      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: `ai-reports/feedback/${reportId}.json`,
          Body: JSON.stringify(feedbackEntry, null, 2),
          ContentType: 'application/json',
        })
      );

      return NextResponse.json({
        success: true,
        message: 'Feedback saved (report not found, created feedback entry)',
        data: { reportId, feedbackPath: `ai-reports/feedback/${reportId}.json` },
      });
    }

    // Load existing report
    const response = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: reportPath })
    );
    const existingContent = await response.Body?.transformToString();

    if (!existingContent) {
      return NextResponse.json(
        { success: false, error: 'Failed to read report' },
        { status: 500 }
      );
    }

    const reportData = JSON.parse(existingContent);

    // Add feedback to the report
    reportData.feedback = {
      ...feedback,
      feedbackDate: new Date().toISOString(),
    };

    // Save updated report back to S3
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: reportPath,
        Body: JSON.stringify(reportData, null, 2),
        ContentType: 'application/json',
      })
    );

    return NextResponse.json({
      success: true,
      message: 'Feedback saved successfully',
      data: { reportId, reportPath },
    });
  } catch (error) {
    console.error('Error saving feedback:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save feedback' },
      { status: 500 }
    );
  }
}

// GET - Retrieve feedback summary for learning
export async function GET() {
  try {
    const client = getS3Client();

    // Load all reports with feedback for analysis
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: 'ai-reports/',
      })
    );

    const reportsWithFeedback: Array<{
      reportId: string;
      date: string;
      modelType: string;
      question: string;
      feedback: ReportFeedback;
    }> = [];

    const summaryStats = {
      totalReports: 0,
      reportsWithFeedback: 0,
      implemented: 0,
      positiveOutcomes: 0,
      negativeOutcomes: 0,
      averageRating: 0,
      ratingSum: 0,
      ratingCount: 0,
    };

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key?.endsWith('.json')) {
          try {
            const data = await client.send(
              new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key })
            );
            const content = await data.Body?.transformToString();
            if (content) {
              const report = JSON.parse(content);
              summaryStats.totalReports++;

              if (report.feedback) {
                summaryStats.reportsWithFeedback++;

                if (report.feedback.implemented) {
                  summaryStats.implemented++;
                }

                if (report.feedback.outcome === 'positive') {
                  summaryStats.positiveOutcomes++;
                } else if (report.feedback.outcome === 'negative') {
                  summaryStats.negativeOutcomes++;
                }

                if (report.feedback.rating) {
                  summaryStats.ratingSum += report.feedback.rating;
                  summaryStats.ratingCount++;
                }

                reportsWithFeedback.push({
                  reportId: report.report_id || obj.Key,
                  date: report.date || report.timestamp,
                  modelType: report.model_type,
                  question: report.question?.slice(0, 100) || '',
                  feedback: report.feedback,
                });
              }
            }
          } catch {
            // Skip invalid files
          }
        }
      }
    }

    summaryStats.averageRating = summaryStats.ratingCount > 0
      ? summaryStats.ratingSum / summaryStats.ratingCount
      : 0;

    return NextResponse.json({
      success: true,
      data: {
        summary: summaryStats,
        reportsWithFeedback: reportsWithFeedback.slice(0, 20), // Last 20
        learningInsights: generateLearningInsights(summaryStats, reportsWithFeedback),
      },
    });
  } catch (error) {
    console.error('Error loading feedback:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load feedback' },
      { status: 500 }
    );
  }
}

// Generate insights for Claude to learn from
function generateLearningInsights(
  stats: typeof summaryStats,
  reports: Array<{ feedback: ReportFeedback; modelType: string }>
): string[] {
  const insights: string[] = [];

  if (stats.reportsWithFeedback === 0) {
    return ['No feedback has been provided yet. Encourage users to rate recommendations.'];
  }

  const implementationRate = (stats.implemented / stats.reportsWithFeedback) * 100;
  insights.push(`Implementation rate: ${implementationRate.toFixed(0)}% of recommendations were acted upon`);

  if (stats.positiveOutcomes > 0 || stats.negativeOutcomes > 0) {
    const successRate = stats.positiveOutcomes / (stats.positiveOutcomes + stats.negativeOutcomes) * 100;
    insights.push(`Success rate: ${successRate.toFixed(0)}% of implemented recommendations had positive outcomes`);
  }

  if (stats.averageRating > 0) {
    insights.push(`Average helpfulness rating: ${stats.averageRating.toFixed(1)}/5`);
  }

  // Analyze by model type
  const byModelType: Record<string, { positive: number; total: number }> = {};
  for (const report of reports) {
    const type = report.modelType || 'unknown';
    if (!byModelType[type]) {
      byModelType[type] = { positive: 0, total: 0 };
    }
    byModelType[type].total++;
    if (report.feedback.outcome === 'positive') {
      byModelType[type].positive++;
    }
  }

  for (const [type, data] of Object.entries(byModelType)) {
    if (data.total >= 2) {
      const rate = (data.positive / data.total) * 100;
      insights.push(`${type} analysis: ${rate.toFixed(0)}% positive outcome rate (${data.total} reports)`);
    }
  }

  return insights;
}

const summaryStats = {
  totalReports: 0,
  reportsWithFeedback: 0,
  implemented: 0,
  positiveOutcomes: 0,
  negativeOutcomes: 0,
  averageRating: 0,
  ratingSum: 0,
  ratingCount: 0,
};
