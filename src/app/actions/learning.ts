'use server';

// ============================================
// LEARNING SERVER ACTIONS
// Server-side actions for triggering learning jobs from the frontend.
//
// Architecture (Step Functions):
// 1. Server action calls POST /api/ai/learning/run
// 2. API route starts a Step Functions execution
// 3. Server action returns immediately to the frontend
// 4. Frontend polls /api/ai/learning/status for progress
//
// The Step Functions state machine orchestrates 5 phases,
// each running in a dedicated Lambda with 900s timeout.
// ============================================

import { getInternalAuthHeaders } from '@/app/api/ai/learning/auth';
import { headers } from 'next/headers';

interface RunLearningResult {
  success: boolean;
  error?: string;
  data?: {
    message?: string;
    jobId?: string;
    hasDigest?: boolean;
    warnings?: string[];
    currentJob?: unknown;
    executionStarted?: boolean;
    executionName?: string;
  };
}

/**
 * Server action to trigger a daily learning job.
 * Called from the frontend LearningProgressTab component.
 *
 * With Step Functions: The API route starts a Step Functions execution
 * and returns immediately. The frontend polls /api/ai/learning/status
 * for real-time progress as phases complete.
 */
export async function runLearningJob(options: {
  skipWebResearch?: boolean;
  forceRun?: boolean;
}): Promise<RunLearningResult> {
  const { skipWebResearch = false, forceRun = true } = options;

  try {
    // Build the internal URL from the incoming request headers
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = headersList.get('x-forwarded-proto') || 'https';
    const baseUrl = `${protocol}://${host}`;

    const authHeaders = getInternalAuthHeaders();

    // With Step Functions, the API route returns quickly (no need for abort timeout)
    // But keep a generous timeout for the synchronous fallback (dev mode)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${baseUrl}/api/ai/learning/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          skipWebResearch,
          forceRun,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: result.error || `API returned ${response.status}`,
          data: result.data,
        };
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // AbortError means the request timed out.
      // In dev mode (sync fallback), this means the job is running.
      // In production (Step Functions), this shouldn't happen.
      if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
        return {
          success: true,
          data: {
            message: 'Learning job started (running in background)',
          },
        };
      }

      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return {
          success: true,
          data: {
            message: 'Learning job started (running in background)',
          },
        };
      }

      throw fetchError;
    }
  } catch (error) {
    console.error('Error running learning job:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to run learning job';

    return {
      success: false,
      error: errorMessage,
    };
  }
}
