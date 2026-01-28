// ============================================
// CUSTOM QUERY STATUS API ROUTE
// Get status and result of async custom query jobs
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'jobId is required' },
        { status: 400 }
      );
    }

    const job = await prisma.customQueryJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        result: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        prompt: true,
      },
    });

    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        result: job.result,
        error: job.errorMessage,
        startedAt: job.startedAt.toISOString(),
        completedAt: job.completedAt?.toISOString() || null,
        promptPreview: job.prompt.slice(0, 100) + (job.prompt.length > 100 ? '...' : ''),
      },
    });
  } catch (error) {
    console.error('Error fetching query status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch query status' },
      { status: 500 }
    );
  }
}

// Get all recent query jobs for history/listing
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { limit = 10 } = body;

    const jobs = await prisma.customQueryJob.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        prompt: true,
        errorMessage: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        jobs: jobs.map(job => ({
          id: job.id,
          status: job.status,
          startedAt: job.startedAt.toISOString(),
          completedAt: job.completedAt?.toISOString() || null,
          promptPreview: job.prompt.slice(0, 100) + (job.prompt.length > 100 ? '...' : ''),
          error: job.errorMessage,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching query history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch query history' },
      { status: 500 }
    );
  }
}
