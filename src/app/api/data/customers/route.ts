// ============================================
// CUSTOMER DATA API ROUTE
// Loads customer data from Aurora PostgreSQL (paginated)
// ============================================

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { gzipSync } from 'zlib';
import { getGzipResponseHeaders } from '@/lib/cors';

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

// Cache
interface CacheEntry {
  data: CustomerRecord[];
  timestamp: number;
  hash: string;
}

let customerCache: CacheEntry | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Compute cache hash based on count
async function computeCustomerHash(): Promise<string> {
  const count = await prisma.customer.count();
  return `customers:${count}`;
}

async function loadCustomerData(): Promise<CustomerRecord[]> {
  console.log('Loading customer data from Aurora PostgreSQL...');
  const startTime = Date.now();

  const customers = await prisma.customer.findMany({
    orderBy: { lifetimeNetSales: 'desc' },
  });

  // Transform to frontend format
  const records: CustomerRecord[] = customers.map((c) => ({
    store_name: c.storeName,
    customer_id: c.customerId,
    name: c.name || '',
    date_of_birth: c.dateOfBirth?.toISOString().split('T')[0],
    age: c.age || undefined,
    lifetime_visits: c.lifetimeVisits,
    lifetime_transactions: c.lifetimeTransactions,
    lifetime_net_sales: Number(c.lifetimeNetSales),
    lifetime_aov: Number(c.lifetimeAov),
    signup_date: c.signupDate?.toISOString().split('T')[0] || '',
    last_visit_date: c.lastVisitDate?.toISOString().split('T')[0] || '',
    customer_segment: c.customerSegment || 'New/Low',
    recency_segment: c.recencySegment || 'Lost',
  }));

  const duration = Date.now() - startTime;
  console.log(`Aurora customer data load complete in ${duration}ms: ${records.length} customers`);

  return records;
}

export async function GET(request: NextRequest) {
  try {
    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    // Get pagination params
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '5000');
    const segment = url.searchParams.get('segment'); // Optional filter

    // Check cache
    const currentHash = await computeCustomerHash();

    if (
      !customerCache ||
      customerCache.hash !== currentHash ||
      Date.now() - customerCache.timestamp > CACHE_TTL
    ) {
      const data = await loadCustomerData();
      customerCache = { data, timestamp: Date.now(), hash: currentHash };
    }

    let filteredData = customerCache.data;

    // Apply segment filter if provided
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
      cached: customerCache.hash === currentHash,
      source: 'aurora',
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
