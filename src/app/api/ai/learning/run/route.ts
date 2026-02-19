// ============================================
// LEARNING RUN API ROUTE
// Trigger a daily learning job.
// On Amplify SSR, all handlers run as Lambda invocations that terminate
// when the response is sent. Fire-and-forget async work gets killed.
// Therefore we ALWAYS await the job synchronously to keep the Lambda alive.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { dailyLearningService } from '@/lib/services/daily-learning';
import { isLearningApiAuthorized, unauthorizedResponse } from '../auth';

// Extend function timeout to 900 seconds (15 minutes) for long-running learning jobs
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  // Verify authorization before allowing job triggers
  if (!isLearningApiAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { skipWebResearch = false, forceRun = true } = body;

    // Check if a job is already running
    const status = await dailyLearningService.getCurrentJobStatus();
    if (status.isRunning) {
      return NextResponse.json({
        success: false,
        error: 'A learning job is already running',
        data: { currentJob: status.currentJob },
      }, { status: 409 });
    }

    // Validate startup requirements SYNCHRONOUSLY before starting
    // This catches env var issues and quota problems before consuming tokens
    let startupValidation;
    try {
      startupValidation = await dailyLearningService.validateStartupRequirements(skipWebResearch);
    } catch (validationError) {
      const errorMessage = validationError instanceof Error ? validationError.message : 'Startup validation failed';
      return NextResponse.json({
        success: false,
        error: errorMessage,
        data: { phase: 'startup_validation' },
      }, { status: 400 });
    }

    // Include quota warnings in response if applicable
    const warnings: string[] = [];
    if (startupValidation.quotaStatus.warning) {
      warnings.push(startupValidation.quotaStatus.warning);
    }

    // Run the learning job synchronously. This keeps the Lambda alive for the
    // full duration of the job. The frontend polls /api/ai/learning/status
    // for real-time progress updates while this request is in flight.
    const result = await dailyLearningService.runDailyLearning({
      forceRun,
      skipWebResearch,
    });

    return NextResponse.json({
      success: true,
      data: {
        jobId: result.jobId,
        hasDigest: !!result.digest,
        warnings: warnings.length > 0 ? warnings : undefined,
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
