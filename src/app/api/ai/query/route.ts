// ============================================
// CUSTOM AI QUERY API ROUTE
// Creates async query jobs and returns immediately
// Frontend polls /api/ai/query/status for results
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DataContextOptions } from '@/lib/services/claude';

interface RequestBody {
  prompt: string;
  contextOptions: DataContextOptions;
  selectedResearchIds?: string[];
}

// Get base URL for internal API calls
function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { prompt, contextOptions, selectedResearchIds } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Prompt is required' },
        { status: 400 }
      );
    }

    console.log('[AI Query] Creating async query job...');

    // Create the job record
    const job = await prisma.customQueryJob.create({
      data: {
        prompt,
        status: 'pending',
        contextOptions: contextOptions as object,
        selectedResearchIds: selectedResearchIds || [],
      },
    });

    console.log(`[AI Query] Created job ${job.id}, triggering background processing...`);

    // Trigger background processing (fire-and-forget)
    // Using fetch with no await so we return immediately
    const baseUrl = getBaseUrl(request);
    fetch(`${baseUrl}/api/ai/query/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.id }),
    }).catch(err => {
      console.error('[AI Query] Background trigger failed (will retry on poll):', err);
    });

    // Return immediately with job ID
    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        status: 'pending',
        message: 'Query submitted. Poll /api/ai/query/status?jobId=... for results.',
      },
    });
  } catch (error) {
    console.error('Custom AI query error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create query job' },
      { status: 500 }
    );
  }
}
