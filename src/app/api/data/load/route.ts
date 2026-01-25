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

// Compute a hash based on record counts for cache invalidation
async function computeDataHash(): Promise<string> {
  try {
    const [salesCount, brandsCount, productsCount, budtendersCount] = await Promise.all([
      prisma.salesRecord.count(),
      prisma.brandRecord.count(),
      prisma.productRecord.count(),
      prisma.budtenderRecord.count(),
    ]);

    const hashInput = `sales:${salesCount}|brands:${brandsCount}|products:${productsCount}|budtenders:${budtendersCount}|v2`;
    return createHash('md5').update(hashInput).digest('hex').slice(0, 12);
  } catch (error) {
    console.error('Error computing hash:', error);
    return Date.now().toString();
  }
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

  // Build store filter (reduces response size by ~50% when filtering)
  const storeFilter = storeId && storeId !== 'combined' ? { storeId } : {};

  console.log(`Date filter: ${startDate} to ${endDate}, Store filter: ${storeId || 'all'}`);

  // Load all data in parallel for maximum speed
  // Apply store filter to reduce response size when a specific store is selected
  const [
    salesRecords,
    brandRecords,
    productRecords,
    budtenderRecords,
    canonicalBrands,
  ] = await Promise.all([
    prisma.salesRecord.findMany({
      where: { ...dateFilter, ...storeFilter },
      orderBy: { date: 'asc' },
    }),
    prisma.brandRecord.findMany({
      where: storeFilter,
      orderBy: { netSales: 'desc' },
      include: { brand: true },
    }),
    prisma.productRecord.findMany({
      where: storeFilter,
      orderBy: { netSales: 'desc' },
    }),
    prisma.budtenderRecord.findMany({
      where: { ...dateFilter, ...storeFilter },
      orderBy: [{ date: 'desc' }, { netSales: 'desc' }],
    }),
    prisma.canonicalBrand.findMany({
      include: { aliases: true },
    }),
  ]);

  // Transform sales records to frontend format
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
    gross_margin_pct: Number(r.grossMarginPct),
    discount_pct: Number(r.discountPct),
    cost_pct: Number(r.costPct),
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
  }));

  // Transform budtender records
  const budtenders: BudtenderRecord[] = budtenderRecords.map((r) => ({
    date: r.date.toISOString().split('T')[0],
    store: r.storeName || r.storeId,
    store_id: r.storeId,
    employee_name: r.employeeName,
    tickets_count: r.ticketsCount,
    customers_count: r.customersCount,
    net_sales: Number(r.netSales),
    gross_margin_pct: Number(r.grossMarginPct),
    avg_order_value: Number(r.avgOrderValue),
    units_sold: r.unitsSold,
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

  const dataHash = await computeDataHash();
  const loadedAt = new Date().toISOString();

  const duration = Date.now() - startTime;
  console.log(`Aurora data load complete in ${duration}ms: ${sales.length} sales, ${brands.length} brands, ${products.length} products, ${budtenders.length} budtenders`);

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

    // Include date range and store in cache key for proper cache invalidation
    const dateRangeKey = startDate && endDate ? `${startDate}-${endDate}` : 'all';
    const storeKey = storeId || 'combined';
    const currentHash = await computeDataHash();
    const cacheKey = `${currentHash}-${dateRangeKey}-${storeKey}`;

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
