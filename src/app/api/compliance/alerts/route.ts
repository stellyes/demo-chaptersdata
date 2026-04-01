// ============================================
// API: COMPLIANCE ALERTS
// GET   - List alerts with filtering + pagination
// PATCH - Resolve/unresolve alerts (feedback loop)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { initializePrisma } from '@/lib/prisma';
import prisma from '@/lib/prisma';
import { getCorsHeaders } from '@/lib/cors';
import { isLearningApiAuthorized, unauthorizedResponse } from '@/app/api/ai/learning/auth';

// ─── GET: List Alerts ───────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await initializePrisma();

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50');
    const scanId = url.searchParams.get('scanId');
    const riskLevel = url.searchParams.get('riskLevel'); // critical | high | medium | low
    const detectionMethod = url.searchParams.get('detectionMethod'); // rules_engine | ml_model | hybrid
    const isResolved = url.searchParams.get('isResolved'); // true | false
    const storefrontId = url.searchParams.get('storefrontId');
    const sortBy = url.searchParams.get('sortBy') || 'createdAt';
    const sortOrder = url.searchParams.get('sortOrder') || 'desc';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (scanId) where.scanId = scanId;
    if (riskLevel) where.riskLevel = riskLevel;
    if (detectionMethod) where.detectionMethod = detectionMethod;
    if (isResolved !== null && isResolved !== undefined) {
      where.isResolved = isResolved === 'true';
    }
    if (storefrontId) where.storefrontId = storefrontId;

    const [totalCount, alerts] = await Promise.all([
      prisma.complianceAlert.count({ where }),
      prisma.complianceAlert.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
    ]);

    const totalPages = Math.ceil(totalCount / pageSize);

    // Build summary stats
    const stats = await prisma.complianceAlert.groupBy({
      by: ['riskLevel'],
      where: { ...where, isResolved: false },
      _count: true,
    });

    const riskSummary = Object.fromEntries(
      stats.map(s => [s.riskLevel, s._count])
    );

    return NextResponse.json(
      {
        success: true,
        data: alerts,
        summary: {
          unresolvedByRisk: riskSummary,
          totalUnresolved: Object.values(riskSummary).reduce((a: number, b: number) => a + b, 0),
        },
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
          hasMore: page < totalPages,
        },
      },
      { headers: getCorsHeaders(request) }
    );
  } catch (error) {
    console.error('[API] Compliance alerts list error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load alerts' },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
}

// ─── PATCH: Resolve/Unresolve Alerts ────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  if (!isLearningApiAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    await initializePrisma();

    const body = await request.json().catch(() => ({}));
    const { alertIds, isResolved, resolvedBy, resolvedNote } = body;

    if (!alertIds || !Array.isArray(alertIds) || alertIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'alertIds must be a non-empty array' },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    if (typeof isResolved !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'isResolved must be a boolean' },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    const updateData = isResolved
      ? {
          isResolved: true,
          resolvedAt: new Date(),
          resolvedBy: resolvedBy || 'api',
          resolvedNote: resolvedNote || null,
        }
      : {
          isResolved: false,
          resolvedAt: null,
          resolvedBy: null,
          resolvedNote: null,
        };

    const result = await prisma.complianceAlert.updateMany({
      where: { id: { in: alertIds } },
      data: updateData,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          updatedCount: result.count,
          isResolved,
          message: `${result.count} alert(s) ${isResolved ? 'resolved' : 'reopened'}`,
        },
      },
      { headers: getCorsHeaders(request) }
    );
  } catch (error) {
    console.error('[API] Compliance alert update error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update alerts' },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
}

// ─── OPTIONS: CORS Preflight ────────────────────────────────────────────────

export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: { ...getCorsHeaders(request), 'Access-Control-Max-Age': '86400' },
  });
}
