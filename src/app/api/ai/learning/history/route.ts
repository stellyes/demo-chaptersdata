// ============================================
// LEARNING HISTORY API ROUTE
// Get history of daily learning jobs
// ============================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const jobs = await prisma.dailyLearningJob.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        currentPhase: true,
        questionsGenerated: true,
        insightsDiscovered: true,
        searchesUsed: true,
        estimatedCost: true,
        dataReviewDone: true,
        questionGenDone: true,
        webResearchDone: true,
        correlationDone: true,
        digestGenDone: true,
      },
    });

    const formattedJobs = jobs.map((job) => ({
      id: job.id,
      status: job.status,
      startedAt: job.startedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() || null,
      currentPhase: job.currentPhase,
      questionsGenerated: job.questionsGenerated,
      insightsDiscovered: job.insightsDiscovered,
      searchesUsed: job.searchesUsed,
      estimatedCost: Number(job.estimatedCost),
      dataReviewDone: job.dataReviewDone,
      questionGenDone: job.questionGenDone,
      webResearchDone: job.webResearchDone,
      correlationDone: job.correlationDone,
      digestGenDone: job.digestGenDone,
    }));

    return NextResponse.json({
      success: true,
      data: formattedJobs,
    });
  } catch (error) {
    console.error('Error fetching learning history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch learning history' },
      { status: 500 }
    );
  }
}
