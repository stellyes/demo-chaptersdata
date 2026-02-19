'use server';

// ============================================
// LEARNING SERVER ACTIONS
// Server-side actions for triggering learning jobs from the frontend.
//
// Architecture:
// 1. Server action fires HTTP request to /api/ai/learning/run
// 2. Server action returns immediately to the frontend (doesn't await the full job)
// 3. The API route Lambda stays alive because it awaits runDailyLearning()
// 4. Frontend polls /api/ai/learning/status for progress
//
// We validate and create the job synchronously, then let the API route
// Lambda continue running the job in the background while we return.
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
  };
}

/**
 * Server action to trigger a daily learning job.
 * Called from the frontend LearningProgressTab component.
 *
 * Makes an internal HTTP call to the /api/ai/learning/run route which
 * runs the job synchronously (keeping its Lambda alive). This server
 * action does NOT await the full response — it fires the request then
 * returns immediately so the frontend can start polling for status.
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

    // Fire the request to the API route. Use AbortController with a short
    // timeout so we don't wait for the full job to complete — we just need
    // to confirm the request was accepted (job created in DB).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s to validate + create job

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

      // If we got a response, the job either completed (fast) or there was an error
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

      // AbortError means the request timed out — which is EXPECTED.
      // It means the API route accepted the request and is now running
      // the job synchronously. The job has been created in the DB and
      // the frontend can poll /api/ai/learning/status for progress.
      if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
        return {
          success: true,
          data: {
            message: 'Learning job started (running in background)',
          },
        };
      }

      // For Node.js fetch abort errors (different error type)
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
