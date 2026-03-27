// ============================================
// DATA RECONCILIATION API ROUTE
// Compares sales_line_items against sales_records
// to identify missing or incomplete daily exports.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { initializePrisma } from '@/lib/prisma';

interface MonthlyComparison {
  month: string;
  storeId: string;
  lineItemCount: number;
  lineItemDates: number;
  lineItemNetSales: number;
  salesRecordCount: number;
  salesRecordNetSales: number;
  delta: number;
  deltaPct: number;
  status: 'match' | 'partial' | 'missing';
}

interface DailyGap {
  date: string;
  storeId: string;
  salesRecordNetSales: number;
  lineItemNetSales: number;
  hasSalesRecord: boolean;
  hasLineItems: boolean;
}

import { STORES, getIndividualStoreIds } from '@/lib/config';

// Build store map dynamically from config
const STORE_MAP: Record<string, string> = Object.fromEntries(
  getIndividualStoreIds().map((sid) => [sid, STORES[sid]?.displayName ?? sid])
);

export async function GET(request: NextRequest) {
  try {
    const prisma = await initializePrisma();
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId') || undefined;
    const mode = searchParams.get('mode') || 'monthly'; // monthly | daily-gaps | summary

    if (mode === 'summary') {
      return await getSummary(prisma, storeId);
    }

    if (mode === 'daily-gaps') {
      const limit = parseInt(searchParams.get('limit') || '90');
      return await getDailyGaps(prisma, storeId, limit);
    }

    // Default: monthly comparison
    return await getMonthlyComparison(prisma, storeId);
  } catch (error) {
    console.error('[Reconciliation] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function getSummary(prisma: any, storeId?: string) {
  const storeIds = storeId ? [storeId] : getIndividualStoreIds();
  const results: Record<string, any> = {};

  for (const sid of storeIds) {
    const storeName = STORE_MAP[sid];

    const [srStats, liStats]: any[][] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          COUNT(*)::int as total_days,
          MIN(date)::text as min_date,
          MAX(date)::text as max_date,
          SUM(net_sales)::float as total_net_sales
        FROM sales_records WHERE store_id = ${sid}
      `,
      prisma.$queryRaw`
        SELECT
          COUNT(DISTINCT date_open::date)::int as total_days,
          MIN(date_open)::text as min_date,
          MAX(date_open)::text as max_date,
          SUM(net_sales)::float as total_net_sales,
          COUNT(*)::int as total_rows
        FROM sales_line_items WHERE store_name = ${storeName}
      `,
    ]);

    const sr = srStats[0];
    const li = liStats[0];

    results[sid] = {
      salesRecords: {
        totalDays: sr.total_days || 0,
        dateRange: `${sr.min_date?.split('T')[0] || 'N/A'} → ${sr.max_date?.split('T')[0] || 'N/A'}`,
        totalNetSales: sr.total_net_sales || 0,
      },
      lineItems: {
        totalDays: li.total_days || 0,
        totalRows: li.total_rows || 0,
        dateRange: `${li.min_date?.split('T')[0] || 'N/A'} → ${li.max_date?.split('T')[0] || 'N/A'}`,
        totalNetSales: li.total_net_sales || 0,
      },
      coverage: sr.total_days > 0
        ? ((li.total_days / sr.total_days) * 100).toFixed(1) + '%'
        : 'N/A',
      missingDays: (sr.total_days || 0) - (li.total_days || 0),
    };
  }

  return NextResponse.json({ success: true, data: results });
}

async function getMonthlyComparison(prisma: any, storeId?: string) {
  const storeIds = storeId ? [storeId] : getIndividualStoreIds();
  const comparisons: MonthlyComparison[] = [];

  for (const sid of storeIds) {
    const storeName = STORE_MAP[sid];

    const [monthlyLI, monthlySR]: any[][] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          TO_CHAR(date_open, 'YYYY-MM') as month,
          COUNT(*)::int as line_item_count,
          COUNT(DISTINCT date_open::date)::int as unique_dates,
          SUM(net_sales)::float as net_sales
        FROM sales_line_items
        WHERE store_name = ${storeName}
        GROUP BY TO_CHAR(date_open, 'YYYY-MM')
        ORDER BY month
      `,
      prisma.$queryRaw`
        SELECT
          TO_CHAR(date, 'YYYY-MM') as month,
          COUNT(*)::int as record_count,
          SUM(net_sales)::float as net_sales
        FROM sales_records
        WHERE store_id = ${sid}
        GROUP BY TO_CHAR(date, 'YYYY-MM')
        ORDER BY month
      `,
    ]);

    const allMonths = new Set([
      ...monthlyLI.map((r: any) => r.month),
      ...monthlySR.map((r: any) => r.month),
    ]);

    for (const month of [...allMonths].sort()) {
      const li = monthlyLI.find((r: any) => r.month === month);
      const sr = monthlySR.find((r: any) => r.month === month);

      const liNet = li?.net_sales || 0;
      const srNet = sr?.net_sales || 0;
      const delta = liNet - srNet;
      const deltaPct = srNet !== 0 ? (delta / srNet) * 100 : liNet !== 0 ? 100 : 0;

      let status: 'match' | 'partial' | 'missing' = 'missing';
      if (li && sr) {
        status = Math.abs(deltaPct) <= 5 ? 'match' : 'partial';
      } else if (li) {
        status = 'match'; // line items exist but no aggregate — fine
      }

      comparisons.push({
        month,
        storeId: sid,
        lineItemCount: li?.line_item_count || 0,
        lineItemDates: li?.unique_dates || 0,
        lineItemNetSales: liNet,
        salesRecordCount: sr?.record_count || 0,
        salesRecordNetSales: srNet,
        delta,
        deltaPct: Math.round(deltaPct * 10) / 10,
        status,
      });
    }
  }

  return NextResponse.json({ success: true, data: comparisons });
}

async function getDailyGaps(prisma: any, storeId?: string, limit: number = 90) {
  const storeIds = storeId ? [storeId] : getIndividualStoreIds();
  const gaps: DailyGap[] = [];

  for (const sid of storeIds) {
    const storeName = STORE_MAP[sid];

    const dailyGaps: any[] = await prisma.$queryRaw`
      SELECT
        sr.date::date::text as d,
        sr.net_sales::float as sr_net_sales,
        COALESCE(sli.net_sales, 0)::float as li_net_sales,
        CASE WHEN sli.d IS NOT NULL THEN true ELSE false END as has_line_items
      FROM sales_records sr
      LEFT JOIN (
        SELECT
          date_open::date as d,
          SUM(net_sales) as net_sales
        FROM sales_line_items
        WHERE store_name = ${storeName}
        GROUP BY date_open::date
      ) sli ON sr.date::date = sli.d
      WHERE sr.store_id = ${sid}
        AND sli.d IS NULL
      ORDER BY sr.date DESC
      LIMIT ${limit}
    `;

    for (const row of dailyGaps) {
      gaps.push({
        date: row.d,
        storeId: sid,
        salesRecordNetSales: row.sr_net_sales || 0,
        lineItemNetSales: row.li_net_sales || 0,
        hasSalesRecord: true,
        hasLineItems: row.has_line_items,
      });
    }
  }

  return NextResponse.json({
    success: true,
    data: gaps,
    count: gaps.length,
  });
}
