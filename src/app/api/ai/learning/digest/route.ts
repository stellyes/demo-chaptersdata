// ============================================
// LEARNING DIGEST API ROUTE
// Get daily learning digests (latest, by date, or list available dates)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const date = searchParams.get('date'); // YYYY-MM-DD

    // List available digest dates
    if (action === 'list') {
      const digests = await prisma.dailyDigest.findMany({
        select: { digestDate: true, dataHealthScore: true, confidenceScore: true },
        orderBy: { digestDate: 'desc' },
        take: 90,
      });

      return NextResponse.json({
        success: true,
        data: digests.map(d => ({
          date: d.digestDate.toISOString().split('T')[0],
          dataHealthScore: d.dataHealthScore,
          confidenceScore: d.confidenceScore,
        })),
      });
    }

    // Fetch a specific date's digest
    if (date) {
      const targetDate = new Date(date + 'T00:00:00Z');
      const digest = await prisma.dailyDigest.findFirst({
        where: { digestDate: targetDate },
      });

      if (!digest) {
        return NextResponse.json({
          success: true,
          data: { digest: null, job: null },
        });
      }

      // Find the associated job
      const job = await prisma.dailyLearningJob.findFirst({
        where: { digestId: digest.id },
      });

      return NextResponse.json({
        success: true,
        data: {
          digest: {
            executiveSummary: digest.executiveSummary,
            priorityActions: digest.priorityActions,
            quickWins: digest.quickWins,
            watchItems: digest.watchItems,
            industryHighlights: digest.industryHighlights,
            regulatoryUpdates: digest.regulatoryUpdates,
            marketTrends: digest.marketTrends,
            questionsForTomorrow: digest.questionsForTomorrow,
            correlatedInsights: digest.correlatedInsights,
            dataHealthScore: digest.dataHealthScore,
            confidenceScore: digest.confidenceScore,
          },
          job: job ? {
            id: job.id,
            status: job.status,
            completedAt: job.completedAt?.toISOString() || null,
          } : null,
        },
      });
    }

    // Default: Get the latest completed job with its digest
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
