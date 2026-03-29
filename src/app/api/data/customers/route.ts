// ============================================
// CUSTOMER DATA API ROUTE
// Loads customer data from Aurora PostgreSQL
// Uses true server-side pagination (skip/take) to avoid
// loading 830k+ records into memory on cold starts.
// ============================================

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActiveStorefrontIds } from '@/lib/utils/org-scope';
import { gzipSync } from 'zlib';
import { getGzipResponseHeaders, shouldUseGzip } from '@/lib/cors';

interface CustomerRecord {
  store_name: string;
  customer_id: string;
  name: string;
  date_of_birth?: string;
  age?: number;
  lifetime_visits: number;
  lifetime_transactions: number;
  lifetime_net_sales: number;
  lifetime_aov: number;
  signup_date: string;
  last_visit_date: string;
  customer_segment: string;
  recency_segment: string;
}

// Lightweight count cache to avoid repeated COUNT queries within a short window
let countCache: { key: string; count: number; timestamp: number } | null = null;
const COUNT_CACHE_TTL = 60 * 1000; // 1 minute

// Transform Prisma customer to frontend format
function transformCustomer(c: {
  storeName: string;
  customerId: string;
  name: string | null;
  dateOfBirth: Date | null;
  age: number | null;
  lifetimeVisits: number;
  lifetimeTransactions: number;
  lifetimeNetSales: number | { toNumber(): number };
  lifetimeAov: number | { toNumber(): number };
  signupDate: Date | null;
  lastVisitDate: Date | null;
  customerSegment: string | null;
  recencySegment: string | null;
}): CustomerRecord {
  return {
    store_name: c.storeName,
    customer_id: c.customerId,
    name: c.name || '',
    date_of_birth: c.dateOfBirth?.toISOString().split('T')[0],
    age: c.age || undefined,
    lifetime_visits: c.lifetimeVisits,
    lifetime_transactions: c.lifetimeTransactions,
    lifetime_net_sales: typeof c.lifetimeNetSales === 'number' ? c.lifetimeNetSales : Number(c.lifetimeNetSales),
    lifetime_aov: typeof c.lifetimeAov === 'number' ? c.lifetimeAov : Number(c.lifetimeAov),
    signup_date: c.signupDate?.toISOString().split('T')[0] || '',
    last_visit_date: c.lastVisitDate?.toISOString().split('T')[0] || '',
    customer_segment: c.customerSegment || 'New/Low',
    recency_segment: c.recencySegment || 'Lost',
  };
}

// Build Prisma where clause from query parameters
async function buildWhereClause(startDate?: string, endDate?: string, segment?: string): Promise<Prisma.CustomerWhereInput> {
  const storefrontIds = await getActiveStorefrontIds();
  const storeNameMap: Record<string, string> = { greenleaf: 'Greenleaf Market', emerald: 'Emerald Collective' };
  const storeNames = storefrontIds.map(id => storeNameMap[id] || id);

  const where: Prisma.CustomerWhereInput = {
    storeName: { in: storeNames },
  };

  if (startDate && endDate) {
    where.lastVisitDate = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }

  if (segment) {
    where.OR = [
      { customerSegment: segment },
      { recencySegment: segment },
    ];
  }

  return where;
}

// Get total count with lightweight caching
async function getFilteredCount(where: Prisma.CustomerWhereInput): Promise<number> {
  const cacheKey = JSON.stringify(where);
  if (countCache && countCache.key === cacheKey && Date.now() - countCache.timestamp < COUNT_CACHE_TTL) {
    return countCache.count;
  }

  const count = await prisma.customer.count({ where });
  countCache = { key: cacheKey, count, timestamp: Date.now() };
  return count;
}

// POST - Save customer data to database
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { storeId, data } = body;

    if (!data || !Array.isArray(data)) {
      return Response.json(
        { success: false, error: 'Missing required field: data' },
        { status: 400 }
      );
    }

    // Transform to database format
    const customerRecords = data.map((record: CustomerRecord) => ({
      customerId: record.customer_id || `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      storeName: record.store_name || storeId || 'unknown',
      name: record.name || null,
      dateOfBirth: record.date_of_birth ? new Date(record.date_of_birth) : null,
      age: record.age || null,
      lifetimeVisits: record.lifetime_visits || 0,
      lifetimeTransactions: record.lifetime_transactions || 0,
      lifetimeNetSales: record.lifetime_net_sales || 0,
      lifetimeAov: record.lifetime_aov || 0,
      signupDate: record.signup_date ? new Date(record.signup_date) : null,
      lastVisitDate: record.last_visit_date ? new Date(record.last_visit_date) : null,
      customerSegment: record.customer_segment || null,
      recencySegment: record.recency_segment || null,
    }));

    // Use createMany for bulk insert
    const result = await prisma.customer.createMany({
      data: customerRecords,
      skipDuplicates: true,
    });

    // Invalidate count cache
    countCache = null;

    return Response.json({
      success: true,
      recordCount: result.count,
      storeId,
    });
  } catch (error) {
    console.error('Error saving customer data:', error);
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to save customer data' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check gzip support (disabled for iOS due to Safari PWA bugs)
    const supportsGzip = shouldUseGzip(request);

    // Get pagination and filter params
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') || '5000'), 50000); // Cap at 50k
    const segment = url.searchParams.get('segment') || undefined;
    const startDate = url.searchParams.get('startDate') || undefined;
    const endDate = url.searchParams.get('endDate') || undefined;

    const startTime = Date.now();

    // Build where clause with all filters pushed to the database
    const where = await buildWhereClause(startDate, endDate, segment);

    // Run count and paginated query in parallel
    // Both are lightweight: COUNT uses index, findMany uses LIMIT/OFFSET
    const [totalCount, customers] = await Promise.all([
      getFilteredCount(where),
      prisma.customer.findMany({
        where,
        orderBy: { lifetimeNetSales: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // Transform only the page we fetched (not 830k records)
    const paginatedData = customers.map(transformCustomer);

    const totalPages = Math.ceil(totalCount / pageSize);
    const duration = Date.now() - startTime;
    console.log(`Customer page ${page} loaded in ${duration}ms: ${paginatedData.length}/${totalCount} records`);

    const responseData = {
      success: true,
      data: paginatedData,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasMore: page < totalPages,
      },
      cached: false,
      source: 'aurora',
      dateFilter: startDate && endDate ? { startDate, endDate } : null,
    };

    if (supportsGzip) {
      const compressed = gzipSync(JSON.stringify(responseData));
      return new Response(compressed, {
        status: 200,
        headers: getGzipResponseHeaders(request),
      });
    }

    return Response.json(responseData);
  } catch (error) {
    console.error('Customer data loading error:', error);
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load customer data' },
      { status: 500 }
    );
  }
}
