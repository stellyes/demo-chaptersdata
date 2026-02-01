// ============================================
// DAILY LEARNING API ROUTE
// Endpoints for autonomous daily learning system
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { dailyLearningService } from '@/lib/services/daily-learning';
import { webSearchService } from '@/lib/services/web-search';

// Extend function timeout to 900 seconds (15 minutes) for long-running learning jobs
export const maxDuration = 900;

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
        const jobStatus = await dailyLearningService.getCurrentJobStatus();
        const throttleStatus = await webSearchService.getThrottleStatus();

        return NextResponse.json({
          success: true,
          data: {
            ...jobStatus,
            searchBudget: {
              searchesUsed: throttleStatus.searchesUsed,
              searchesRemaining: throttleStatus.searchesRemaining,
              monthlyLimit: throttleStatus.limit,
              dailyBudget: throttleStatus.dailyBudget,
              isThrottled: throttleStatus.isThrottled,
            },
          },
        });
      }

      case 'digest': {
        const result = await dailyLearningService.getLatestDigest();
        return NextResponse.json({
          success: true,
          data: result.digest ? result : { digest: null, message: 'No digest available yet' },
        });
      }

      case 'history': {
        const limit = parseInt(searchParams.get('limit') || '10', 10);
        const history = await dailyLearningService.getJobHistory(limit);
        return NextResponse.json({ success: true, data: { jobs: history, count: history.length } });
      }

      case 'throttle': {
        const throttleStatus = await webSearchService.getThrottleStatus();
        return NextResponse.json({ success: true, data: throttleStatus });
      }

      case 'collection': {
        const stats = await webSearchService.getCollectionStats();
        return NextResponse.json({ success: true, data: stats });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Daily learning GET error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to retrieve learning data',
    }, { status: 500 });
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
        const { forceRun = false, skipWebResearch = false } = body;

        const status = await dailyLearningService.getCurrentJobStatus();
        if (status.isRunning) {
          return NextResponse.json({
            success: false,
            error: 'A learning job is already running',
            data: { currentJob: status.currentJob },
          }, { status: 409 });
        }

        dailyLearningService.runDailyLearning({ forceRun, skipWebResearch })
          .then(result => console.log(`Daily learning completed: Job ${result.jobId}`))
          .catch(error => console.error('Daily learning failed:', error));

        const newStatus = await dailyLearningService.getCurrentJobStatus();
        return NextResponse.json({
          success: true,
          data: { message: 'Daily learning started', job: newStatus.currentJob },
        });
      }

      case 'run_sync': {
        const { forceRun = false, skipWebResearch = false } = body;
        const result = await dailyLearningService.runDailyLearning({ forceRun, skipWebResearch });
        return NextResponse.json({ success: true, data: { jobId: result.jobId, digest: result.digest } });
      }

      case 'search': {
        const { query, maxPages = 3 } = body;
        if (!query) {
          return NextResponse.json({ success: false, error: 'Query is required' }, { status: 400 });
        }

        const canSearch = await webSearchService.canSearch();
        if (!canSearch) {
          const throttle = await webSearchService.getThrottleStatus();
          return NextResponse.json({
            success: false,
            error: 'Monthly search limit reached',
            data: { throttle },
          }, { status: 429 });
        }

        const result = await webSearchService.search(query, { maxPages });
        return NextResponse.json({
          success: true,
          data: {
            query: result.query,
            totalResults: result.totalResults,
            newResultsCount: result.newResultsCount,
            fromCache: result.fromCache,
            searchesRemaining: result.searchesRemaining,
            results: result.results.slice(0, 20),
          },
        });
      }

      case 'cleanup': {
        const deletedCount = await webSearchService.cleanupExpiredCache();
        return NextResponse.json({
          success: true,
          data: { message: 'Cache cleanup completed', deletedCacheEntries: deletedCount },
        });
      }

      case 'recover_stale': {
        // Manually trigger cleanup of stale jobs
        const recoveredCount = await dailyLearningService.cleanupStaleJobs();
        return NextResponse.json({
          success: true,
          data: {
            message: recoveredCount > 0
              ? `Recovered ${recoveredCount} stale job(s)`
              : 'No stale jobs found',
            recoveredCount,
          },
        });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Daily learning POST error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process learning action',
    }, { status: 500 });
  }
}
