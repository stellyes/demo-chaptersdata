'use server';

// ============================================
// LEARNING SERVER ACTIONS
// Server-side actions for triggering learning jobs from the frontend.
// Calls the API route internally with auth headers so the job runs
// in the API route's SSR process (which stays alive for async work).
// Server actions run in isolated Lambda invocations that terminate
// on return, so fire-and-forget async work gets killed immediately.
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
 * This makes an internal HTTP call to the /api/ai/learning/run route
 * (authenticated via X-Internal-Auth header) so that the learning job
 * runs in the API route handler's process context — which stays alive
 * for async background work. Server actions run in ephemeral Lambda
 * invocations that die on return, so we can't run the job directly here.
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

    // Call the API route with internal auth headers
    const authHeaders = getInternalAuthHeaders();
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
    });

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
  } catch (error) {
    console.error('Error running learning job:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to run learning job';

    return {
      success: false,
      error: errorMessage,
    };
  }
}
