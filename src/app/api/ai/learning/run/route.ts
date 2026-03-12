// ============================================
// LEARNING RUN API ROUTE
// Triggers a daily learning job via Step Functions.
//
// Previously ran the job synchronously on Amplify's SSR Lambda,
// but the ~120s hard timeout killed Phase 3 (web research) every time.
// Now starts a Step Functions execution that orchestrates the 5 phases
// across dedicated Lambda invocations with 900s timeout per phase.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { dailyLearningService } from '@/lib/services/daily-learning';
import { isLearningApiAuthorized, unauthorizedResponse } from '../auth';
import { initializePrisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  // Verify authorization before allowing job triggers
  if (!isLearningApiAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { skipWebResearch = false, forceRun = true } = body;

    // Initialize Prisma for status checks
    await initializePrisma();

    // Check if a job is already running
    const status = await dailyLearningService.getCurrentJobStatus();
    if (status.isRunning) {
      return NextResponse.json({
        success: false,
        error: 'A learning job is already running',
        data: { currentJob: status.currentJob },
      }, { status: 409 });
    }

    // Check for Step Functions ARN
    const stateMachineArn = process.env.STEP_FUNCTIONS_ARN;

    if (stateMachineArn) {
      // New path: Start Step Functions execution
      const sfn = new SFNClient({ region: process.env.AWS_REGION || 'us-west-1' });

      const executionName = `learning-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      await sfn.send(new StartExecutionCommand({
        stateMachineArn,
        name: executionName,
        input: JSON.stringify({
          skipWebResearch,
          forceRun,
          source: 'api-trigger',
        }),
      }));

      console.log(`[Learning] Started Step Functions execution: ${executionName}`);

      return NextResponse.json({
        success: true,
        data: {
          executionStarted: true,
          executionName,
          message: 'Learning job started via Step Functions. Poll /api/ai/learning/status for progress.',
        },
      });
    }

    // Fallback: Run synchronously (for dev/local where Step Functions isn't available)
    console.log('[Learning] STEP_FUNCTIONS_ARN not set, running synchronously (dev mode)');

    // Validate startup requirements
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

    const warnings: string[] = [];
    if (startupValidation.quotaStatus.warning) {
      warnings.push(startupValidation.quotaStatus.warning);
    }

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
