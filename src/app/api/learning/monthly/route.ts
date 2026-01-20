// ============================================
// MONTHLY OPUS ANALYSIS API ROUTE
// Endpoints for monthly strategic analysis system
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { monthlyAnalysisService } from '@/lib/services/monthly-analysis';

const LEARNING_API_KEY = process.env.LEARNING_API_KEY;

function isAuthorized(request: NextRequest): boolean {
  if (!LEARNING_API_KEY) {
    const host = request.headers.get('host') || '';
    return host.includes('localhost') || host.includes('127.0.0.1');
  }

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7) === LEARNING_API_KEY;
  }

  return request.headers.get('X-API-Key') === LEARNING_API_KEY;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';

    switch (action) {
      case 'status': {
        const jobStatus = await monthlyAnalysisService.getCurrentJobStatus();
        return NextResponse.json({
          success: true,
          data: jobStatus,
        });
      }

      case 'report': {
        const monthYear = searchParams.get('monthYear');
        if (monthYear) {
          // Get specific month's report - would need to add this method
          const result = await monthlyAnalysisService.getLatestReport();
          return NextResponse.json({
            success: true,
            data: result.report ? result : { report: null, message: 'No report available' },
          });
        }
        const result = await monthlyAnalysisService.getLatestReport();
        return NextResponse.json({
          success: true,
          data: result.report ? result : { report: null, message: 'No report available yet' },
        });
      }

      case 'history': {
        const limit = parseInt(searchParams.get('limit') || '12', 10);
        const history = await monthlyAnalysisService.getJobHistory(limit);
        return NextResponse.json({
          success: true,
          data: { jobs: history, count: history.length },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Monthly analysis GET error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve analysis data',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'run': {
        const { monthYear, forceRun = false } = body;

        const status = await monthlyAnalysisService.getCurrentJobStatus();
        if (status.isRunning) {
          return NextResponse.json(
            {
              success: false,
              error: 'A monthly analysis job is already running',
              data: { currentJob: status.currentJob },
            },
            { status: 409 }
          );
        }

        // Run asynchronously
        monthlyAnalysisService
          .runMonthlyAnalysis({ monthYear, forceRun })
          .then((result) => console.log(`Monthly analysis completed: Job ${result.jobId}`))
          .catch((error) => console.error('Monthly analysis failed:', error));

        const newStatus = await monthlyAnalysisService.getCurrentJobStatus();
        return NextResponse.json({
          success: true,
          data: {
            message: 'Monthly analysis started',
            job: newStatus.currentJob,
          },
        });
      }

      case 'run_sync': {
        const { monthYear, forceRun = false } = body;
        const result = await monthlyAnalysisService.runMonthlyAnalysis({ monthYear, forceRun });
        return NextResponse.json({
          success: true,
          data: {
            jobId: result.jobId,
            report: result.report,
          },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Monthly analysis POST error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process analysis action',
      },
      { status: 500 }
    );
  }
}
