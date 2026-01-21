// ============================================
// LEARNING RUN API ROUTE
// Trigger a daily learning job
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { DailyLearningService } from '@/lib/services/daily-learning';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { skipWebResearch = false, forceRun = true } = body;

    const service = new DailyLearningService();
    const result = await service.runDailyLearning({
      forceRun,
      skipWebResearch,
    });

    return NextResponse.json({
      success: true,
      data: {
        jobId: result.jobId,
        hasDigest: !!result.digest,
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
