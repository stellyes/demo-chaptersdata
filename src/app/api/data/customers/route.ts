// ============================================
// CUSTOMER DATA API ROUTE
// Loads customer data from Aurora PostgreSQL (paginated)
// ============================================

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
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

// Cache - keyed by date range for filtered queries
interface CacheEntry {
  data: CustomerRecord[];
  timestamp: number;
  hash: string;
}

const customerCacheByKey = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Compute cache hash based on count for the given filter
async function computeCustomerHash(startDate?: string, endDate?: string): Promise<string> {
  if (startDate && endDate) {
    const count = await prisma.customer.count({
      where: {
        lastVisitDate: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
    });
    return `customers:${startDate}:${endDate}:${count}`;
  }
  const count = await prisma.customer.count();
  return `customers:all:${count}`;
}

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

async function loadCustomerData(startDate?: string, endDate?: string): Promise<CustomerRecord[]> {
  const filterDesc = startDate && endDate ? `with last visit between ${startDate} and ${endDate}` : 'all';
  console.log(`Loading customer data from Aurora PostgreSQL (${filterDesc})...`);
  const startTime = Date.now();

  // Build where clause for date filtering
  const whereClause = startDate && endDate ? {
    lastVisitDate: {
      gte: new Date(startDate),
      lte: new Date(endDate),
    },
  } : {};

  const customers = await prisma.customer.findMany({
    where: whereClause,
    orderBy: { lifetimeNetSales: 'desc' },
  });

  // Transform to frontend format
  const records: CustomerRecord[] = customers.map(transformCustomer);

  const duration = Date.now() - startTime;
  console.log(`Aurora customer data load complete in ${duration}ms: ${records.length} customers`);

  return records;
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

    // Invalidate cache
    customerCacheByKey.clear();

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
    const pageSize = parseInt(url.searchParams.get('pageSize') || '5000');
    const segment = url.searchParams.get('segment'); // Optional segment filter
    const startDate = url.searchParams.get('startDate'); // Date range filter (YYYY-MM-DD)
    const endDate = url.searchParams.get('endDate'); // Date range filter (YYYY-MM-DD)

    // Create cache key based on date filter
    const cacheKey = startDate && endDate ? `${startDate}:${endDate}` : 'all';

    // Check cache for this specific query
    const currentHash = await computeCustomerHash(startDate || undefined, endDate || undefined);
    let cacheEntry = customerCacheByKey.get(cacheKey);

    if (
      !cacheEntry ||
      cacheEntry.hash !== currentHash ||
      Date.now() - cacheEntry.timestamp > CACHE_TTL
    ) {
      const data = await loadCustomerData(startDate || undefined, endDate || undefined);
      cacheEntry = { data, timestamp: Date.now(), hash: currentHash };
      customerCacheByKey.set(cacheKey, cacheEntry);

      // Limit cache size - keep only last 5 date range queries
      if (customerCacheByKey.size > 5) {
        const oldestKey = customerCacheByKey.keys().next().value;
        if (oldestKey) customerCacheByKey.delete(oldestKey);
      }
    }

    let filteredData = cacheEntry.data;

    // Apply segment filter if provided (post-cache filter)
    if (segment) {
      filteredData = filteredData.filter(c => c.customer_segment === segment || c.recency_segment === segment);
    }

    const totalCount = filteredData.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedData = filteredData.slice(startIndex, startIndex + pageSize);

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
      cached: cacheEntry.hash === currentHash,
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
