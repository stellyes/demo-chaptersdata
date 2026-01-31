// ============================================
// LEARNING STATUS API ROUTE
// Get current learning job status with stale detection
// ============================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Maximum time a job can run before being considered stale (1 hour - reduced for faster recovery)
const STALE_JOB_TIMEOUT_MS = 1 * 60 * 60 * 1000;

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

    // Check if the job is stale
    const jobAge = Date.now() - runningJob.startedAt.getTime();
    const isStale = jobAge > STALE_JOB_TIMEOUT_MS;

    if (isStale) {
      // Auto-recover: Mark stale job as failed
      console.warn(`Stale job detected via status API: ${runningJob.id} has been running for ${Math.round(jobAge / 60000)} minutes. Auto-recovering.`);
      await prisma.dailyLearningJob.update({
        where: { id: runningJob.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: `Job stalled and was auto-recovered after ${Math.round(jobAge / 60000)} minutes`,
          errorPhase: runningJob.currentPhase || 'unknown',
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          isRunning: false,
          currentJob: null,
          recovered: {
            jobId: runningJob.id,
            message: `Stale job was auto-recovered after running for ${Math.round(jobAge / 60000)} minutes`,
          },
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
          runningForMinutes: Math.round(jobAge / 60000),
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
