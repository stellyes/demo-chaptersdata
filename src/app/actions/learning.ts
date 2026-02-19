'use server';

// ============================================
// LEARNING SERVER ACTIONS
// Server-side actions for triggering learning jobs from the frontend.
// These bypass the API route auth since they run server-side directly.
// The API key auth on /api/ai/learning/run remains for external triggers.
// ============================================

import { dailyLearningService } from '@/lib/services/daily-learning';

interface RunLearningResult {
  success: boolean;
  error?: string;
  data?: {
    message?: string;
    jobId?: string;
    hasDigest?: boolean;
    warnings?: string[];
    currentJob?: unknown;
  };
}

/**
 * Server action to trigger a daily learning job.
 * Called from the frontend LearningProgressTab component.
 * Runs server-side so it can access the learning service directly
 * without needing API key auth (which is for external Lambda triggers).
 */
export async function runLearningJob(options: {
  skipWebResearch?: boolean;
  forceRun?: boolean;
}): Promise<RunLearningResult> {
  const { skipWebResearch = false, forceRun = true } = options;

  try {
    // Check if a job is already running
    const status = await dailyLearningService.getCurrentJobStatus();
    if (status.isRunning) {
      return {
        success: false,
        error: 'A learning job is already running',
        data: { currentJob: status.currentJob },
      };
    }

    // Validate startup requirements synchronously
    let startupValidation;
    try {
      startupValidation = await dailyLearningService.validateStartupRequirements(skipWebResearch);
    } catch (validationError) {
      const errorMessage = validationError instanceof Error ? validationError.message : 'Startup validation failed';
      return {
        success: false,
        error: errorMessage,
      };
    }

    const warnings: string[] = [];
    if (startupValidation.quotaStatus.warning) {
      warnings.push(startupValidation.quotaStatus.warning);
    }

    // Start job async (non-blocking)
    dailyLearningService.runDailyLearning({ forceRun, skipWebResearch })
      .then(result => console.log(`Learning job completed: ${result.jobId}, hasDigest: ${!!result.digest}`))
      .catch(error => {
        console.error('Learning job failed:', error instanceof Error ? error.message : error);
      });

    // Get the newly created job status
    const newStatus = await dailyLearningService.getCurrentJobStatus();

    return {
      success: true,
      data: {
        message: 'Learning job started',
        currentJob: newStatus.currentJob,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  } catch (error) {
    console.error('Error running learning job:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to run learning job';

    return {
      success: false,
      error: errorMessage,
    };
  }
}
