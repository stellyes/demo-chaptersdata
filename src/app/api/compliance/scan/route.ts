// ============================================
// API: COMPLIANCE SCAN
// GET  - List scan history with pagination
// POST - Trigger an on-demand compliance scan
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { initializePrisma } from '@/lib/prisma';
import prisma from '@/lib/prisma';
import { getCorsHeaders } from '@/lib/cors';
import { isLearningApiAuthorized, unauthorizedResponse } from '@/app/api/ai/learning/auth';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const PIPELINE_ARN = process.env.COMPLIANCE_PIPELINE_ARN || '';

// ─── GET: List Scan History ─────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await initializePrisma();

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const status = url.searchParams.get('status'); // running | completed | failed
    const storefrontId = url.searchParams.get('storefrontId');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (status) where.status = status;
    if (storefrontId) where.storefrontId = storefrontId;

    const [totalCount, scans] = await Promise.all([
      prisma.complianceScan.count({ where }),
      prisma.complianceScan.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { startedAt: 'desc' },
        include: {
          _count: {
            select: { alerts: true },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalCount / pageSize);

    return NextResponse.json(
      {
        success: true,
        data: scans.map(scan => ({
          id: scan.id,
          storefrontId: scan.storefrontId,
          scanType: scan.scanType,
          status: scan.status,
          startedAt: scan.startedAt,
          completedAt: scan.completedAt,
          recordsScanned: scan.recordsScanned,
          risksFound: scan.risksFound,
          criticalRisks: scan.criticalRisks,
          highRisks: scan.highRisks,
          alertCount: scan._count.alerts,
          s3ResultsPath: scan.s3ResultsPath,
        })),
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
    console.error('[API] Compliance scan list error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load scans' },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
}

// ─── POST: Trigger On-Demand Scan ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isLearningApiAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    await initializePrisma();

    const body = await request.json().catch(() => ({}));
    const { scanType = 'on_demand', lookbackDays = 7 } = body;

    // Check for already-running scan
    const running = await prisma.complianceScan.findFirst({
      where: { status: 'running' },
      orderBy: { startedAt: 'desc' },
    });

    if (running) {
      return NextResponse.json(
        {
          success: false,
          error: 'A compliance scan is already running',
          data: { scanId: running.id, startedAt: running.startedAt },
        },
        { status: 409, headers: getCorsHeaders(request) }
      );
    }

    // Try to trigger via Step Functions if ARN is configured
    if (PIPELINE_ARN) {
      const sfn = new SFNClient({ region: process.env.AWS_REGION || 'us-west-1' });
      const executionName = `on-demand-${Date.now()}`;

      await sfn.send(new StartExecutionCommand({
        stateMachineArn: PIPELINE_ARN,
        name: executionName,
        input: JSON.stringify({
          scanType,
          dateRange: { lookbackDays },
          source: 'api-on-demand',
        }),
      }));

      return NextResponse.json(
        {
          success: true,
          data: {
            executionStarted: true,
            executionName,
            message: `Compliance scan triggered (${lookbackDays} day lookback)`,
          },
        },
        { headers: getCorsHeaders(request) }
      );
    }

    // Fallback: create scan record directly for monitoring
    const scan = await prisma.complianceScan.create({
      data: {
        scanType,
        status: 'running',
        scanMetadata: { lookbackDays, source: 'api-on-demand', note: 'Step Functions ARN not configured' },
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          scanId: scan.id,
          message: 'Scan record created. Configure COMPLIANCE_PIPELINE_ARN to trigger full pipeline.',
        },
      },
      { headers: getCorsHeaders(request) }
    );
  } catch (error) {
    console.error('[API] Compliance scan trigger error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to trigger scan' },
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
