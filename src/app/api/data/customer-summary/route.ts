// ============================================
// CUSTOMER SUMMARY API ROUTE
// Returns pre-aggregated customer analytics —
// segment breakdowns, top-25 customers by LTV,
// and KPI metrics — computed via server-side SQL.
// No raw customer records are returned.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActiveStorefrontIds } from '@/lib/utils/org-scope';

export interface CustomerSummary {
  totalCustomers: number;
  segmentBreakdown: Record<string, number>;
  recencyBreakdown: Record<string, number>;
  avgLifetimeValue: number;
  totalRevenue: number;
  avgVisits: number;
  topCustomers: TopCustomer[];
}

interface TopCustomer {
  customerId: string;
  name: string;
  lifetimeNetSales: number;
  lifetimeVisits: number;
  lastVisitDate: string;
  customerSegment: string;
}

// Short server-side memory cache (5 min) to absorb repeated
// requests within a single Lambda warm period.
let memCache: { key: string; data: CustomerSummary; ts: number } | null = null;
const MEM_CACHE_TTL = 5 * 60 * 1000;

async function buildWhere(
  startDate?: string,
  endDate?: string,
  storeId?: string
): Promise<Prisma.CustomerWhereInput> {
  const storefrontIds = await getActiveStorefrontIds();
  const storeNameMap: Record<string, string> = {
    greenleaf: 'Greenleaf Market',
    emerald: 'Emerald Collective',
  };
  let storeNames = storefrontIds.map((id) => storeNameMap[id] || id);

  // Narrow to a single store when one is explicitly selected
  if (storeId && storeId !== 'combined') {
    storeNames = storeNames.filter((n) =>
      n.toLowerCase().includes(storeId.toLowerCase())
    );
  }

  const where: Prisma.CustomerWhereInput = {
    storeName: { in: storeNames },
  };

  if (startDate && endDate) {
    where.lastVisitDate = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }

  return where;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate   = searchParams.get('endDate')   || undefined;
    const storeId   = searchParams.get('storeId')   || undefined;

    const cacheKey = `${startDate || 'all'}_${endDate || 'all'}_${storeId || 'combined'}`;

    // Return server-side memory cache if still fresh
    if (memCache && memCache.key === cacheKey && Date.now() - memCache.ts < MEM_CACHE_TTL) {
      return NextResponse.json({ success: true, data: memCache.data, cached: true });
    }

    const where = await buildWhere(startDate, endDate, storeId);

    // Run all DB aggregations in parallel — no raw record transfer
    const [totalCustomers, segmentGroups, recencyGroups, topCustomers, aggregates] =
      await Promise.all([
        prisma.customer.count({ where }),

        prisma.customer.groupBy({
          by: ['customerSegment'],
          where,
          _count: { customerSegment: true },
        }),

        prisma.customer.groupBy({
          by: ['recencySegment'],
          where,
          _count: { recencySegment: true },
        }),

        prisma.customer.findMany({
          where,
          select: {
            customerId:      true,
            name:            true,
            lifetimeNetSales:true,
            lifetimeVisits:  true,
            lastVisitDate:   true,
            customerSegment: true,
          },
          orderBy: { lifetimeNetSales: 'desc' },
          take: 25,
        }),

        prisma.customer.aggregate({
          where,
          _avg: { lifetimeNetSales: true, lifetimeVisits: true },
          _sum: { lifetimeNetSales: true },
        }),
      ]);

    // Build segment breakdown — seed with known labels so chart order is stable
    const segmentBreakdown: Record<string, number> = {
      'New/Low': 0, Regular: 0, Good: 0, VIP: 0, Whale: 0, Occasional: 0,
    };
    for (const g of segmentGroups) {
      const seg = g.customerSegment || 'New/Low';
      segmentBreakdown[seg] = (segmentBreakdown[seg] ?? 0) + g._count.customerSegment;
    }

    const recencyBreakdown: Record<string, number> = {
      Active: 0, Warm: 0, Cool: 0, Cold: 0, Lost: 0, Dormant: 0, 'At Risk': 0,
    };
    for (const g of recencyGroups) {
      const seg = g.recencySegment || 'Lost';
      recencyBreakdown[seg] = (recencyBreakdown[seg] ?? 0) + g._count.recencySegment;
    }

    const summary: CustomerSummary = {
      totalCustomers,
      segmentBreakdown,
      recencyBreakdown,
      avgLifetimeValue: Number(aggregates._avg.lifetimeNetSales) || 0,
      totalRevenue:     Number(aggregates._sum.lifetimeNetSales) || 0,
      avgVisits:        Number(aggregates._avg.lifetimeVisits)   || 0,
      topCustomers: topCustomers.map((c) => ({
        customerId:       c.customerId,
        name:             c.name || '',
        lifetimeNetSales: Number(c.lifetimeNetSales),
        lifetimeVisits:   c.lifetimeVisits,
        lastVisitDate:    c.lastVisitDate?.toISOString().split('T')[0] || '',
        customerSegment:  c.customerSegment || 'New/Low',
      })),
    };

    memCache = { key: cacheKey, data: summary, ts: Date.now() };

    return NextResponse.json({ success: true, data: summary, cached: false });
  } catch (error) {
    console.error('[customer-summary] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to compute summary',
      },
      { status: 500 }
    );
  }
}
