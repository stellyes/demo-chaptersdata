// ============================================
// API: COMPLIANCE RULES
// GET - Browse compiled compliance rules
//       Filter by jurisdiction, complianceArea,
//       productType, ruleType, severity
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { initializePrisma } from '@/lib/prisma';
import prisma from '@/lib/prisma';
import { getCorsHeaders } from '@/lib/cors';

// ─── GET: Browse Rules ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await initializePrisma();

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50');
    const jurisdiction = url.searchParams.get('jurisdiction');
    const complianceArea = url.searchParams.get('complianceArea');
    const ruleType = url.searchParams.get('ruleType');
    const severity = url.searchParams.get('severity');
    const isActive = url.searchParams.get('isActive');
    const search = url.searchParams.get('search');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (jurisdiction) where.jurisdiction = jurisdiction;
    if (complianceArea) where.complianceArea = complianceArea;
    if (ruleType) where.ruleType = ruleType;
    if (severity) where.severity = severity;
    if (isActive !== null && isActive !== undefined) {
      where.isActive = isActive !== 'false';
    }
    if (search) {
      where.OR = [
        { ruleId: { contains: search, mode: 'insensitive' } },
        { enforcedBy: { contains: search, mode: 'insensitive' } },
        { penalty: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [totalCount, rules] = await Promise.all([
      prisma.complianceRule.count({ where }),
      prisma.complianceRule.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ severity: 'asc' }, { jurisdiction: 'asc' }, { complianceArea: 'asc' }],
      }),
    ]);

    const totalPages = Math.ceil(totalCount / pageSize);

    // Build filter facets for the UI
    const [jurisdictions, complianceAreas, ruleTypes, severities] = await Promise.all([
      prisma.complianceRule.groupBy({
        by: ['jurisdiction'],
        where: { isActive: true },
        _count: true,
        orderBy: { jurisdiction: 'asc' },
      }),
      prisma.complianceRule.groupBy({
        by: ['complianceArea'],
        where: { isActive: true },
        _count: true,
        orderBy: { complianceArea: 'asc' },
      }),
      prisma.complianceRule.groupBy({
        by: ['ruleType'],
        where: { isActive: true },
        _count: true,
        orderBy: { ruleType: 'asc' },
      }),
      prisma.complianceRule.groupBy({
        by: ['severity'],
        where: { isActive: true },
        _count: true,
      }),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: rules,
        facets: {
          jurisdictions: jurisdictions.map(j => ({ value: j.jurisdiction, count: j._count })),
          complianceAreas: complianceAreas.map(c => ({ value: c.complianceArea, count: c._count })),
          ruleTypes: ruleTypes.map(r => ({ value: r.ruleType, count: r._count })),
          severities: severities.map(s => ({ value: s.severity, count: s._count })),
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
    console.error('[API] Compliance rules list error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load rules' },
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
