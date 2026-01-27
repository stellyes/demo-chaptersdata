// ============================================
// LEARNING JOB CANCEL API ROUTE
// Cancel a stuck or running learning job
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { jobId } = body;

    if (!jobId) {
      // If no jobId provided, cancel all running jobs
      const runningJobs = await prisma.dailyLearningJob.findMany({
        where: { status: 'running' },
        select: { id: true, startedAt: true, currentPhase: true },
      });

      if (runningJobs.length === 0) {
        return NextResponse.json({
          success: true,
          data: {
            message: 'No running jobs found to cancel',
            cancelled: 0,
          },
        });
      }

      // Cancel all running jobs
      const result = await prisma.dailyLearningJob.updateMany({
        where: { status: 'running' },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: 'Manually cancelled by user',
          errorPhase: 'cancelled',
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          message: `Cancelled ${result.count} running job(s)`,
          cancelled: result.count,
          jobs: runningJobs.map(j => ({
            id: j.id,
            startedAt: j.startedAt.toISOString(),
            phase: j.currentPhase,
          })),
        },
      });
    }

    // Cancel specific job
    const job = await prisma.dailyLearningJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, currentPhase: true, startedAt: true },
    });

    if (!job) {
      return NextResponse.json(
        { success: false, error: `Job ${jobId} not found` },
        { status: 404 }
      );
    }

    if (job.status !== 'running') {
      return NextResponse.json({
        success: true,
        data: {
          message: `Job ${jobId} is already ${job.status}, no action needed`,
          job: {
            id: job.id,
            status: job.status,
            phase: job.currentPhase,
          },
        },
      });
    }

    // Cancel the job
    await prisma.dailyLearningJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: 'Manually cancelled by user',
        errorPhase: job.currentPhase || 'cancelled',
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        message: `Job ${jobId} cancelled successfully`,
        job: {
          id: job.id,
          previousStatus: 'running',
          newStatus: 'failed',
          phase: job.currentPhase,
          startedAt: job.startedAt.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('Error cancelling learning job:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel learning job' },
      { status: 500 }
    );
  }
}
