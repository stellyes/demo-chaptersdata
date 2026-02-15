// ============================================
// LEARNING STATUS API ROUTE
// Get current learning job status with stale detection
// Includes search budget information for monitoring quota usage
// ISSUE #9: Enhanced with observability metrics
// ============================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { webSearchService } from '@/lib/services/web-search';
import { JobMetadata } from '@/lib/services/daily-learning';

// Maximum time a job can run before being considered stale (1 hour - reduced for faster recovery)
const STALE_JOB_TIMEOUT_MS = 1 * 60 * 60 * 1000;

export async function GET() {
  try {
    // Get search quota status for monitoring
    const throttleStatus = await webSearchService.getThrottleStatus();
    const searchBudget = {
      searchesUsed: throttleStatus.searchesUsed,
      searchesRemaining: throttleStatus.searchesRemaining,
      monthlyLimit: throttleStatus.limit,
      dailyBudget: throttleStatus.dailyBudget,
      isThrottled: throttleStatus.isThrottled,
    };

    // Check for any running job
    const runningJob = await prisma.dailyLearningJob.findFirst({
      where: { status: 'running' },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        currentPhase: true,
        startedAt: true,
        lastHeartbeat: true,
        dataReviewDone: true,
        questionGenDone: true,
        webResearchDone: true,
        correlationDone: true,
        digestGenDone: true,
        inputTokens: true,
        outputTokens: true,
        searchesUsed: true,
        jobMetadata: true,
      },
    });

    if (!runningJob) {
      return NextResponse.json({
        success: true,
        data: {
          isRunning: false,
          currentJob: null,
          searchBudget,
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
          searchBudget,
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

    // ISSUE #9: Extract metrics from job metadata
    const metadata = runningJob.jobMetadata as unknown as JobMetadata | null;
    const metrics = metadata ? {
      inputTokens: runningJob.inputTokens,
      outputTokens: runningJob.outputTokens,
      searchesUsed: runningJob.searchesUsed,
      quotaAtStart: metadata.quotaAtStart,
      webResearchSkipped: metadata.webResearchSkipped,
      webResearchSkipReason: metadata.webResearchSkipReason,
      phaseMetrics: metadata.phaseMetrics?.map(p => ({
        phase: p.phase,
        status: p.status,
        durationMs: p.durationMs,
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        itemsProcessed: p.itemsProcessed,
        dataSourcesLoaded: p.dataSources?.loaded.length,
        dataSourcesFailed: p.dataSources?.failed.length,
      })),
      healthSummary: metadata.healthSummary,
      jsonParseIssues: metadata.jsonParseIssues?.length || 0,
    } : undefined;

    return NextResponse.json({
      success: true,
      data: {
        isRunning: true,
        currentJob: {
          id: runningJob.id,
          phase: runningJob.currentPhase,
          startedAt: runningJob.startedAt.toISOString(),
          lastHeartbeat: runningJob.lastHeartbeat?.toISOString(),
          progress,
          runningForMinutes: Math.round(jobAge / 60000),
        },
        metrics,
        searchBudget,
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

// ISSUE #9: GET endpoint for learning metrics history
export async function POST() {
  try {
    // Get recent job metrics for dashboard visualization
    const recentJobs = await prisma.dailyLearningJob.findMany({
      where: {
        status: { in: ['completed', 'failed'] },
      },
      orderBy: { startedAt: 'desc' },
      take: 14, // Last 2 weeks
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        inputTokens: true,
        outputTokens: true,
        searchesUsed: true,
        estimatedCost: true,
        questionsGenerated: true,
        insightsDiscovered: true,
        articlesAnalyzed: true,
        errorPhase: true,
        errorMessage: true,
        jobMetadata: true,
        phaseMetrics: {
          select: {
            phase: true,
            status: true,
            durationMs: true,
            inputTokens: true,
            outputTokens: true,
            itemsProcessed: true,
            dataSources: true,
          },
        },
      },
    });

    // Calculate aggregate metrics
    const completedJobs = recentJobs.filter(j => j.status === 'completed');
    const failedJobs = recentJobs.filter(j => j.status === 'failed');

    const aggregateMetrics = {
      totalJobs: recentJobs.length,
      completedJobs: completedJobs.length,
      failedJobs: failedJobs.length,
      successRate: recentJobs.length > 0 ? (completedJobs.length / recentJobs.length) * 100 : 0,
      avgDurationMs: completedJobs.length > 0
        ? completedJobs.reduce((sum, j) => {
            const duration = j.completedAt && j.startedAt
              ? j.completedAt.getTime() - j.startedAt.getTime()
              : 0;
            return sum + duration;
          }, 0) / completedJobs.length
        : 0,
      totalInputTokens: recentJobs.reduce((sum, j) => sum + j.inputTokens, 0),
      totalOutputTokens: recentJobs.reduce((sum, j) => sum + j.outputTokens, 0),
      totalSearchesUsed: recentJobs.reduce((sum, j) => sum + j.searchesUsed, 0),
      totalEstimatedCost: recentJobs.reduce((sum, j) => sum + Number(j.estimatedCost), 0),
      avgQuestionsGenerated: completedJobs.length > 0
        ? completedJobs.reduce((sum, j) => sum + j.questionsGenerated, 0) / completedJobs.length
        : 0,
      avgInsightsDiscovered: completedJobs.length > 0
        ? completedJobs.reduce((sum, j) => sum + j.insightsDiscovered, 0) / completedJobs.length
        : 0,
    };

    // Phase-level aggregates
    const phaseMetricsAggregate: Record<string, {
      totalRuns: number;
      successCount: number;
      failedCount: number;
      avgDurationMs: number;
      avgInputTokens: number;
      avgOutputTokens: number;
    }> = {};

    for (const job of recentJobs) {
      for (const pm of job.phaseMetrics) {
        if (!phaseMetricsAggregate[pm.phase]) {
          phaseMetricsAggregate[pm.phase] = {
            totalRuns: 0,
            successCount: 0,
            failedCount: 0,
            avgDurationMs: 0,
            avgInputTokens: 0,
            avgOutputTokens: 0,
          };
        }
        const agg = phaseMetricsAggregate[pm.phase];
        agg.totalRuns++;
        if (pm.status === 'success') agg.successCount++;
        else if (pm.status === 'failed') agg.failedCount++;
        agg.avgDurationMs += pm.durationMs || 0;
        agg.avgInputTokens += pm.inputTokens;
        agg.avgOutputTokens += pm.outputTokens;
      }
    }

    // Calculate averages
    for (const phase of Object.keys(phaseMetricsAggregate)) {
      const agg = phaseMetricsAggregate[phase];
      if (agg.totalRuns > 0) {
        agg.avgDurationMs = Math.round(agg.avgDurationMs / agg.totalRuns);
        agg.avgInputTokens = Math.round(agg.avgInputTokens / agg.totalRuns);
        agg.avgOutputTokens = Math.round(agg.avgOutputTokens / agg.totalRuns);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        recentJobs: recentJobs.map(j => ({
          id: j.id,
          status: j.status,
          startedAt: j.startedAt.toISOString(),
          completedAt: j.completedAt?.toISOString(),
          durationMs: j.completedAt && j.startedAt
            ? j.completedAt.getTime() - j.startedAt.getTime()
            : null,
          inputTokens: j.inputTokens,
          outputTokens: j.outputTokens,
          searchesUsed: j.searchesUsed,
          estimatedCost: Number(j.estimatedCost),
          questionsGenerated: j.questionsGenerated,
          insightsDiscovered: j.insightsDiscovered,
          articlesAnalyzed: j.articlesAnalyzed,
          errorPhase: j.errorPhase,
          errorMessage: j.errorMessage,
          phaseMetrics: j.phaseMetrics,
        })),
        aggregateMetrics,
        phaseMetricsAggregate,
      },
    });
  } catch (error) {
    console.error('Error fetching learning metrics:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch learning metrics' },
      { status: 500 }
    );
  }
}
