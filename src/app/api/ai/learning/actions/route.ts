// ============================================
// ACTION ITEMS API
// GET:   List action items with optional status filter
// PATCH: Update action status and record outcomes
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma, initializePrisma } from '@/lib/prisma';
import { isLearningApiAuthorized, unauthorizedResponse } from '../auth';

export async function GET(request: NextRequest) {
  if (!isLearningApiAuthorized(request)) return unauthorizedResponse();

  await initializePrisma();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const category = searchParams.get('category');
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (status) where.status = status;
  if (category) where.category = category;

  try {
    const actions = await prisma.actionItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });

    return NextResponse.json({
      success: true,
      data: {
        actions,
        count: actions.length,
        filters: { status, category },
      },
    });
  } catch (error) {
    console.error('[Actions API] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch action items' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isLearningApiAuthorized(request)) return unauthorizedResponse();

  await initializePrisma();

  try {
    const body = await request.json();
    const { id, status, outcome, outcomeNotes } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: id' },
        { status: 400 }
      );
    }

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: status' },
        { status: 400 }
      );
    }

    const validStatuses = ['pending', 'in_progress', 'completed', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const validOutcomes = ['success', 'partial', 'failure', 'abandoned'];
    if (outcome && !validOutcomes.includes(outcome)) {
      return NextResponse.json(
        { success: false, error: `Invalid outcome. Must be one of: ${validOutcomes.join(', ')}` },
        { status: 400 }
      );
    }

    const updated = await prisma.actionItem.update({
      where: { id },
      data: {
        status,
        outcome: outcome || undefined,
        outcomeNotes: outcomeNotes || undefined,
        completedAt: ['completed', 'dismissed'].includes(status) ? new Date() : undefined,
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Actions API] PATCH error:', error);
    if (error instanceof Error && error.message.includes('Record to update not found')) {
      return NextResponse.json(
        { success: false, error: 'Action item not found' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to update action item' },
      { status: 500 }
    );
  }
}
