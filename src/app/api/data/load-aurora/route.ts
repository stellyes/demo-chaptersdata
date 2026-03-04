// ============================================
// AURORA POSTGRESQL DATA LOADING API ROUTE
// Fast data loading from Aurora instead of S3/DynamoDB
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createHash } from 'crypto';

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

interface CustomerRecord {
  customer_id: string;
  name: string;
  store: string;
  date_of_birth?: string;
  age?: number;
  lifetime_visits: number;
  lifetime_transactions: number;
  lifetime_net_sales: number;
  lifetime_aov: number;
  signup_date?: string;
  last_visit_date?: string;
  customer_segment?: string;
  recency_segment?: string;
}

interface BudtenderRecord {
  date: string;
  store: string;
  store_id: string;
  employee_name: string;
  tickets_count: number;
  customers_count: number;
  net_sales: number;
  gross_margin_pct: number;
  avg_order_value: number;
  units_sold: number;
}

interface InvoiceLineItem {
  invoice_id: string;
  line_item_id: string;
  product_name: string;
  product_type: string;
  sku_units: number;
  unit_cost: number;
  total_cost: number;
  total_with_excise: number;
  strain?: string;
  unit_size?: string;
  trace_id?: string;
  is_promo: boolean;
}

interface BrandMappingData {
  [canonicalBrand: string]: {
    aliases: { [aliasName: string]: string };
  };
}

interface AllDataResponse {
  sales: SalesRecord[];
  brands: BrandRecord[];
  products: ProductRecord[];
  customers: CustomerRecord[];
  budtenders: BudtenderRecord[];
  brandMappings: BrandMappingData;
  invoices: InvoiceLineItem[];
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

// Compute a hash based on record counts and latest timestamps
async function computeDataHash(): Promise<string> {
  const [salesCount, brandsCount, customersCount, invoicesCount] = await Promise.all([
    prisma.salesRecord.count(),
    prisma.brandRecord.count(),
    prisma.customer.count(),
    prisma.invoiceLineItem.count(),
  ]);

  const hashInput = `sales:${salesCount}|brands:${brandsCount}|customers:${customersCount}|invoices:${invoicesCount}`;
  return createHash('md5').update(hashInput).digest('hex').slice(0, 12);
}

// Load all data from Aurora PostgreSQL
async function loadAllDataFromAurora(): Promise<AllDataResponse> {
  console.log('Loading data from Aurora PostgreSQL...');
  const startTime = Date.now();

  // Load all data in parallel for maximum speed
  const [
    salesRecords,
    brandRecords,
    productRecords,
    customerRecords,
    budtenderRecords,
    canonicalBrands,
    invoiceLineItems,
  ] = await Promise.all([
    prisma.salesRecord.findMany({
      orderBy: { date: 'asc' },
    }),
    prisma.brandRecord.findMany({
      orderBy: { netSales: 'desc' },
      include: { brand: true },
    }),
    prisma.productRecord.findMany({
      orderBy: { netSales: 'desc' },
    }),
    prisma.customer.findMany({
      orderBy: { lifetimeNetSales: 'desc' },
    }),
    prisma.budtenderRecord.findMany({
      orderBy: [{ date: 'desc' }, { netSales: 'desc' }],
    }),
    prisma.canonicalBrand.findMany({
      include: { aliases: true },
    }),
    prisma.invoiceLineItem.findMany({
      orderBy: { createdAt: 'desc' },
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
  }));

  // Transform customer records
  const customers: CustomerRecord[] = customerRecords.map((r) => ({
    customer_id: r.customerId,
    name: r.name || '',
    store: r.storeName,
    date_of_birth: r.dateOfBirth?.toISOString().split('T')[0],
    age: r.age || undefined,
    lifetime_visits: r.lifetimeVisits,
    lifetime_transactions: r.lifetimeTransactions,
    lifetime_net_sales: Number(r.lifetimeNetSales),
    lifetime_aov: Number(r.lifetimeAov),
    signup_date: r.signupDate?.toISOString().split('T')[0],
    last_visit_date: r.lastVisitDate?.toISOString().split('T')[0],
    customer_segment: r.customerSegment || undefined,
    recency_segment: r.recencySegment || undefined,
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

  // Transform invoice line items
  const invoices: InvoiceLineItem[] = invoiceLineItems.map((r) => ({
    invoice_id: r.invoiceId,
    line_item_id: `${r.invoiceId}-${r.lineNumber}`,
    product_name: r.productName || '',
    product_type: r.productType || '',
    sku_units: r.skuUnits,
    unit_cost: Number(r.unitCost),
    total_cost: Number(r.totalCost),
    total_with_excise: Number(r.totalCostWithExcise),
    strain: r.strain || undefined,
    unit_size: r.unitSize || undefined,
    trace_id: r.traceId || undefined,
    is_promo: r.isPromo,
  }));

  const dataHash = await computeDataHash();
  const loadedAt = new Date().toISOString();

  const duration = Date.now() - startTime;
  console.log(`Aurora data load complete in ${duration}ms: ${sales.length} sales, ${brands.length} brands, ${customers.length} customers, ${invoices.length} invoices`);

  return {
    sales,
    brands,
    products,
    customers,
    budtenders,
    brandMappings,
    invoices,
    dataHash,
    loadedAt,
  };
}

export async function GET() {
  try {
    // Check cache first
    const currentHash = await computeDataHash();

    if (
      dataCache &&
      dataCache.hash === currentHash &&
      Date.now() - dataCache.timestamp < CACHE_TTL
    ) {
      console.log('Returning cached Aurora data');
      return NextResponse.json({
        success: true,
        data: dataCache.data,
        cached: true,
        source: 'aurora',
      });
    }

    // Load fresh data from Aurora
    const data = await loadAllDataFromAurora();

    // Update cache
    dataCache = {
      data,
      hash: data.dataHash,
      timestamp: Date.now(),
    };

    return NextResponse.json({
      success: true,
      data,
      cached: false,
      source: 'aurora',
    });
  } catch (error) {
    console.error('Aurora data loading error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load data from Aurora',
      },
      { status: 500 }
    );
  }
}

// POST - Save brand or product data to Aurora
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, storeId, startDate, endDate, data } = body;

    if (!type || !storeId || !data || !Array.isArray(data)) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: type, storeId, data' },
        { status: 400 }
      );
    }

    // Invalidate cache so next GET reflects new data
    dataCache = null;

    if (type === 'brands') {
      let insertedCount = 0;

      for (const record of data) {
        const brandName = record.brand || '';
        if (!brandName) continue;

        // Find or create the canonical brand
        let canonicalBrand = await prisma.canonicalBrand.findFirst({
          where: { canonicalName: brandName.toUpperCase() },
        });

        if (!canonicalBrand) {
          canonicalBrand = await prisma.canonicalBrand.create({
            data: { canonicalName: brandName.toUpperCase() },
          });
        }

        await prisma.brandRecord.create({
          data: {
            storeId,
            storeName: record.store || storeId,
            brandId: canonicalBrand.id,
            originalBrandName: brandName,
            pctOfTotalNetSales: record.pct_of_total_net_sales || 0,
            grossMarginPct: record.gross_margin_pct || 0,
            avgCostWoExcise: record.avg_cost_wo_excise || 0,
            netSales: record.net_sales || 0,
            uploadStartDate: startDate ? new Date(startDate) : null,
            uploadEndDate: endDate ? new Date(endDate) : null,
          },
        });
        insertedCount++;
      }

      return NextResponse.json({
        success: true,
        recordCount: insertedCount,
        type: 'brands',
        source: 'aurora',
      });
    }

    if (type === 'products') {
      let insertedCount = 0;

      for (const record of data) {
        const productType = record.product_type || '';
        if (!productType) continue;

        await prisma.productRecord.create({
          data: {
            storeId,
            storeName: record.store || storeId,
            productType,
            pctOfTotalNetSales: record.pct_of_total_net_sales || 0,
            grossMarginPct: record.gross_margin_pct || 0,
            avgCostWoExcise: record.avg_cost_wo_excise || 0,
            netSales: record.net_sales || 0,
            uploadStartDate: startDate ? new Date(startDate) : null,
            uploadEndDate: endDate ? new Date(endDate) : null,
          },
        });
        insertedCount++;
      }

      return NextResponse.json({
        success: true,
        recordCount: insertedCount,
        type: 'products',
        source: 'aurora',
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown data type: ${type}` },
      { status: 400 }
    );
  } catch (error) {
    console.error('Aurora data save error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save data to Aurora',
      },
      { status: 500 }
    );
  }
}
