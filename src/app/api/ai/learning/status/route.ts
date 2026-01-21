// ============================================
// LEARNING STATUS API ROUTE
// Get current learning job status
// ============================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Check for any running job
    const runningJob = await prisma.dailyLearningJob.findFirst({
      where: { status: 'running' },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        currentPhase: true,
        startedAt: true,
        dataReviewDone: true,
        questionGenDone: true,
        webResearchDone: true,
        correlationDone: true,
        digestGenDone: true,
      },
    });

    if (!runningJob) {
      return NextResponse.json({
        success: true,
        data: {
          isRunning: false,
          currentJob: null,
        },
      });
    }

    // Calculate progress based on completed phases
    const phases = [
      runningJob.dataReviewDone,
      runningJob.questionGenDone,
      runningJob.webResearchDone,
      runningJob.correlationDone,
      runningJob.digestGenDone,
    ];
    const completedCount = phases.filter(Boolean).length;
    const progress = (completedCount / phases.length) * 100;

    return NextResponse.json({
      success: true,
      data: {
        isRunning: true,
        currentJob: {
          id: runningJob.id,
          phase: runningJob.currentPhase,
          startedAt: runningJob.startedAt.toISOString(),
          progress,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching learning status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch learning status' },
      { status: 500 }
    );
  }
}
