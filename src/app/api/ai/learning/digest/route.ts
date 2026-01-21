// ============================================
// LEARNING DIGEST API ROUTE
// Get latest daily learning digest
// ============================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Get the latest completed job with its digest
    const latestJob = await prisma.dailyLearningJob.findFirst({
      where: { status: 'completed', digestId: { not: null } },
      orderBy: { completedAt: 'desc' },
      include: { digest: true },
    });

    if (!latestJob || !latestJob.digest) {
      return NextResponse.json({
        success: true,
        data: { digest: null, job: null },
      });
    }

    const digest = {
      executiveSummary: latestJob.digest.executiveSummary,
      priorityActions: latestJob.digest.priorityActions,
      quickWins: latestJob.digest.quickWins,
      watchItems: latestJob.digest.watchItems,
      industryHighlights: latestJob.digest.industryHighlights,
      regulatoryUpdates: latestJob.digest.regulatoryUpdates,
      marketTrends: latestJob.digest.marketTrends,
      questionsForTomorrow: latestJob.digest.questionsForTomorrow,
      correlatedInsights: latestJob.digest.correlatedInsights,
      dataHealthScore: latestJob.digest.dataHealthScore,
      confidenceScore: latestJob.digest.confidenceScore,
    };

    return NextResponse.json({
      success: true,
      data: {
        digest,
        job: {
          id: latestJob.id,
          status: latestJob.status,
          completedAt: latestJob.completedAt?.toISOString() || null,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching learning digest:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch learning digest' },
      { status: 500 }
    );
  }
}
