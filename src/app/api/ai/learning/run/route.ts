// ============================================
// LEARNING RUN API ROUTE
// Trigger a daily learning job (async - returns immediately)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { dailyLearningService } from '@/lib/services/daily-learning';

// Extend function timeout to 900 seconds (15 minutes) for long-running learning jobs
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { skipWebResearch = false, forceRun = true, sync = false } = body;

    // Check if a job is already running
    const status = await dailyLearningService.getCurrentJobStatus();
    if (status.isRunning) {
      return NextResponse.json({
        success: false,
        error: 'A learning job is already running',
        data: { currentJob: status.currentJob },
      }, { status: 409 });
    }

    // If sync mode requested, wait for completion (for local testing)
    if (sync) {
      const result = await dailyLearningService.runDailyLearning({
        forceRun,
        skipWebResearch,
      });

      return NextResponse.json({
        success: true,
        data: {
          jobId: result.jobId,
          hasDigest: !!result.digest,
          digest: result.digest,
        },
      });
    }

    // Default: Async mode - start job and return immediately (for Lambda/scheduled triggers)
    dailyLearningService.runDailyLearning({ forceRun, skipWebResearch })
      .then(result => console.log(`Learning job completed: ${result.jobId}, hasDigest: ${!!result.digest}`))
      .catch(error => console.error('Learning job failed:', error));

    // Get the newly created job status
    const newStatus = await dailyLearningService.getCurrentJobStatus();

    return NextResponse.json({
      success: true,
      data: {
        message: 'Learning job started',
        job: newStatus.currentJob,
      },
    });
  } catch (error) {
    console.error('Error running learning job:', error);

    const errorMessage = error instanceof Error ? error.message : 'Failed to run learning job';

    // Check if it's a "already running" error
    if (errorMessage.includes('already')) {
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
