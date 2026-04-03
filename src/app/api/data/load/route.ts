// ============================================
// DATA LOADING API ROUTE
// Loads all data from Aurora PostgreSQL
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { getCorsHeaders, getGzipResponseHeaders } from '@/lib/cors';

// In-memory cache for data
interface CacheEntry {
  data: AllDataResponse;
  hash: string;
  timestamp: number;
}

let dataCache: CacheEntry | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface SalesRecord {
  date: string;
  store: string;
  store_id: string;
  week: string;
  tickets_count: number;
  units_sold: number;
  customers_count: number;
  new_customers: number;
  gross_sales: number;
  discounts: number;
  returns: number;
  net_sales: number;
  taxes: number;
  gross_receipts: number;
  cogs_with_excise: number;
  gross_income: number;
  gross_margin_pct: number;
  discount_pct: number;
  cost_pct: number;
  avg_basket_size: number;
  avg_order_value: number;
  avg_order_profit: number;
}

interface BrandRecord {
  brand: string;
  pct_of_total_net_sales: number;
  gross_margin_pct: number;
  avg_cost_wo_excise: number;
  net_sales: number;
  store: string;
  store_id: string;
  upload_start_date?: string;
  upload_end_date?: string;
}

interface ProductRecord {
  product_type: string;
  pct_of_total_net_sales: number;
  gross_margin_pct: number;
  avg_cost_wo_excise: number;
  net_sales: number;
  store: string;
  store_id: string;
  upload_start_date?: string;
  upload_end_date?: string;
}

interface BudtenderRecord {
  store: string;
  store_id: string;
  employee_name: string;
  date: string;
  tickets_count: number;
  customers_count: number;
  net_sales: number;
  gross_margin_pct: number;
  avg_order_value: number;
  units_sold: number;
}

// Brand mapping v2 structure types
interface BrandAliases {
  [aliasName: string]: string; // alias -> product_type
}

interface BrandEntry {
  aliases: BrandAliases;
}

interface BrandMappingData {
  [canonicalBrand: string]: BrandEntry;
}

interface AllDataResponse {
  sales: SalesRecord[];
  brands: BrandRecord[];
  products: ProductRecord[];
  // Customers excluded from main load due to size (load via /api/data/customers)
  budtenders: BudtenderRecord[];
  brandMappings: BrandMappingData;
  // Invoices excluded from main load (load via /api/data/invoices)
  dataHash: string;
  loadedAt: string;
}

// Helper to normalize margin percentage
// If value is <= 1 and >= -1, it's stored as a decimal (e.g., 0.55 for 55%) and needs to be multiplied by 100
// If value is > 1 or < -1, it's already a percentage (e.g., 55 for 55%)
function normalizeMarginPct(value: number): number {
  if (value <= 1 && value >= -1) {
    return value * 100;
  }
  return value;
}

// Compute a data hash directly from loaded record counts — no extra DB queries.
function computeDataHashFromCounts(
  salesCount: number,
  brandsCount: number,
  productsCount: number,
  budtendersCount: number,
): string {
  const hashInput = `sales:${salesCount}|brands:${brandsCount}|products:${productsCount}|budtenders:${budtendersCount}|v2`;
  return createHash('md5').update(hashInput).digest('hex').slice(0, 12);
}

// Load all data from Aurora PostgreSQL
async function loadAllDataFromAurora(startDate?: string, endDate?: string, storeId?: string): Promise<AllDataResponse> {
  console.log('Loading data from Aurora PostgreSQL...');
  const startTime = Date.now();

  // Build date filter for sales and budtender records
  const dateFilter = startDate && endDate ? {
    date: {
      gte: new Date(startDate),
      lte: new Date(endDate),
    },
  } : {};

  // Brand records are snapshot-based (uploadStartDate / uploadEndDate).
  // Filter to snapshots whose period overlaps the selected date range so we
  // don't load every historical snapshot when only the current window matters.
  const brandDateFilter = startDate && endDate ? {
    uploadStartDate: { lte: new Date(endDate) },
    uploadEndDate:   { gte: new Date(startDate) },
  } : {};

  // Build store filter (reduces response size by ~50% when filtering)
  const storeFilter = storeId && storeId !== 'combined' ? { storeId } : {};

  console.log(`Date filter: ${startDate} to ${endDate}, Store filter: ${storeId || 'all'}`);

  // Load all data in parallel for maximum speed.
  // Brand records: use select to avoid fetching unused columns and to keep the
  // canonical-brand JOIN minimal (only the name field, not the full object).
  // Budtender records: aggregate server-side by employee+store so the client
  // receives ~60-80 rows instead of 14 000+ daily rows.
  const [
    salesRecords,
    brandRecords,
    productRecords,
    budtenderAgg,
    canonicalBrands,
  ] = await Promise.all([
    prisma.salesRecord.findMany({
      where: { ...dateFilter, ...storeFilter },
      orderBy: { date: 'asc' },
    }),
    prisma.brandRecord.findMany({
      where: { ...brandDateFilter, ...storeFilter },
      orderBy: { netSales: 'desc' },
      select: {
        storeId: true,
        storeName: true,
        originalBrandName: true,
        pctOfTotalNetSales: true,
        grossMarginPct: true,
        avgCostWoExcise: true,
        netSales: true,
        uploadStartDate: true,
        uploadEndDate: true,
        brand: { select: { canonicalName: true } },
      },
    }),
    prisma.productRecord.findMany({
      where: storeFilter,
      orderBy: { netSales: 'desc' },
    }),
    // Pre-aggregate budtender performance per employee+store at the DB level.
    // Both DashboardPage and SalesAnalyticsPage immediately reduce raw daily rows
    // to per-employee totals — moving this work to the DB cuts the payload from
    // ~14 000 rows to ~60-80 rows and eliminates client-side O(n) aggregation.
    prisma.budtenderRecord.groupBy({
      by: ['storeId', 'storeName', 'employeeName'],
      where: { ...dateFilter, ...storeFilter },
      _sum: {
        netSales: true,
        unitsSold: true,
        ticketsCount: true,
        customersCount: true,
      },
      _avg: {
        grossMarginPct: true,
        avgOrderValue: true,
      },
      orderBy: { _sum: { netSales: 'desc' } },
    }),
    prisma.canonicalBrand.findMany({
      include: { aliases: true },
    }),
  ]);

  // Transform sales records to frontend format
  // Note: gross_margin_pct, discount_pct, and cost_pct may be stored as decimals (0.55) or percentages (55)
  // We normalize them to always be percentages for display
  const sales: SalesRecord[] = salesRecords.map((r) => ({
    date: r.date.toISOString().split('T')[0],
    store: r.storeName || r.storeId,
    store_id: r.storeId,
    week: r.week || '',
    tickets_count: r.ticketsCount,
    units_sold: r.unitsSold,
    customers_count: r.customersCount,
    new_customers: r.newCustomers,
    gross_sales: Number(r.grossSales),
    discounts: Number(r.discounts),
    returns: Number(r.returns),
    net_sales: Number(r.netSales),
    taxes: Number(r.taxes),
    gross_receipts: Number(r.grossReceipts),
    cogs_with_excise: Number(r.cogsWithExcise),
    gross_income: Number(r.grossIncome),
    gross_margin_pct: normalizeMarginPct(Number(r.grossMarginPct)),
    discount_pct: normalizeMarginPct(Number(r.discountPct)),
    cost_pct: normalizeMarginPct(Number(r.costPct)),
    avg_basket_size: Number(r.avgBasketSize),
    avg_order_value: Number(r.avgOrderValue),
    avg_order_profit: Number(r.avgOrderProfit),
  }));

  // Transform brand records
  const brands: BrandRecord[] = brandRecords.map((r) => ({
    brand: r.brand?.canonicalName || r.originalBrandName,
    pct_of_total_net_sales: Number(r.pctOfTotalNetSales),
    gross_margin_pct: Number(r.grossMarginPct),
    avg_cost_wo_excise: Number(r.avgCostWoExcise),
    net_sales: Number(r.netSales),
    store: r.storeName || r.storeId,
    store_id: r.storeId,
    upload_start_date: r.uploadStartDate?.toISOString().split('T')[0],
    upload_end_date: r.uploadEndDate?.toISOString().split('T')[0],
  }));

  // Transform product records
  const products: ProductRecord[] = productRecords.map((r) => ({
    product_type: r.productType,
    pct_of_total_net_sales: Number(r.pctOfTotalNetSales),
    gross_margin_pct: Number(r.grossMarginPct),
    avg_cost_wo_excise: Number(r.avgCostWoExcise),
    net_sales: Number(r.netSales),
    store: r.storeName || r.storeId,
    store_id: r.storeId,
    upload_start_date: r.uploadStartDate?.toISOString().split('T')[0],
    upload_end_date: r.uploadEndDate?.toISOString().split('T')[0],
  }));

  // Transform pre-aggregated budtender records (one row per employee+store).
  // The `date` field is set to '' since these are period totals, not daily rows.
  // Frontend aggregation code (byEmployee loops) works identically on 60 rows
  // as it did on 14 000 — just faster.
  const budtenders: BudtenderRecord[] = budtenderAgg.map((r) => ({
    date: '',
    store: r.storeName || r.storeId,
    store_id: r.storeId,
    employee_name: r.employeeName,
    tickets_count: r._sum.ticketsCount ?? 0,
    customers_count: r._sum.customersCount ?? 0,
    net_sales: Number(r._sum.netSales ?? 0),
    gross_margin_pct: normalizeMarginPct(Number(r._avg.grossMarginPct ?? 0)),
    avg_order_value: Number(r._avg.avgOrderValue ?? 0),
    units_sold: r._sum.unitsSold ?? 0,
  }));

  // Build brand mappings from canonical brands with aliases
  const brandMappings: BrandMappingData = {};
  for (const brand of canonicalBrands) {
    const aliases: { [aliasName: string]: string } = {};
    for (const alias of brand.aliases) {
      aliases[alias.aliasName] = alias.productType || '';
    }
    brandMappings[brand.canonicalName] = { aliases };
  }

  // Hash computed from loaded counts — no extra DB round-trips.
  const dataHash = computeDataHashFromCounts(
    salesRecords.length,
    brandRecords.length,
    productRecords.length,
    budtenderAgg.length,
  );
  const loadedAt = new Date().toISOString();

  const duration = Date.now() - startTime;
  console.log(`Aurora data load complete in ${duration}ms: ${sales.length} sales, ${brands.length} brands, ${products.length} products, ${budtenders.length} budtender employees`);

  return {
    sales,
    brands,
    products,
    budtenders,
    brandMappings,
    dataHash,
    loadedAt,
  };
}

export async function GET(request: NextRequest) {
  try {
    // Extract query parameters
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const storeId = searchParams.get('storeId') || undefined; // Optional store filter

    // Cache key is based purely on params + TTL — no DB COUNT queries on every
    // request. The in-memory cache is already invalidated on server restart and
    // expires after 5 minutes, which is sufficient for the demo environment.
    const dateRangeKey = startDate && endDate ? `${startDate}-${endDate}` : 'all';
    const storeKey = storeId || 'combined';
    const cacheKey = `${dateRangeKey}-${storeKey}`;

    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    let responseData: { success: boolean; data: AllDataResponse; cached: boolean; source: string };

    if (
      dataCache &&
      dataCache.hash === cacheKey &&
      Date.now() - dataCache.timestamp < CACHE_TTL
    ) {
      console.log('Returning cached Aurora data');
      responseData = {
        success: true,
        data: dataCache.data,
        cached: true,
        source: 'aurora',
      };
    } else {
      // Load fresh data from Aurora with date and store filters
      const data = await loadAllDataFromAurora(startDate, endDate, storeId);

      // Update cache (include date range in hash for proper cache invalidation)
      dataCache = {
        data,
        hash: cacheKey,
        timestamp: Date.now(),
      };

      responseData = {
        success: true,
        data,
        cached: false,
        source: 'aurora',
      };
    }

    // Compress response if client supports gzip (helps with large payloads)
    if (supportsGzip) {
      const jsonString = JSON.stringify(responseData);
      const compressed = gzipSync(jsonString);

      return new Response(compressed, {
        status: 200,
        headers: {
          ...getGzipResponseHeaders(request),
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    return NextResponse.json(responseData, {
      headers: getCorsHeaders(request),
    });
  } catch (error) {
    console.error('Data loading error:', error);
    const corsHeaders = getCorsHeaders(request);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load data',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

// Handle preflight OPTIONS requests
export async function OPTIONS(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      'Access-Control-Max-Age': '86400',
    },
  });
}
