// ============================================
// DATA PROCESSING UTILITIES
// ============================================

import Papa from 'papaparse';
import { format, parse, differenceInDays } from 'date-fns';
import {
  SalesRecord,
  BrandRecord,
  ProductRecord,
  CustomerRecord,
  StoreId,
  CustomerSegment,
  RecencySegment,
  BrandMappingData,
} from '@/types';
import {
  STORE_NAME_TO_ID,
  CUSTOMER_SEGMENTS,
  RECENCY_SEGMENTS,
  getIndividualStoreIds,
} from '@/lib/config';

// ============================================
// BRAND NORMALIZATION UTILITIES
// ============================================

// Build a reverse lookup map: alias (uppercase) -> canonical brand name
export function buildAliasLookup(mappings: BrandMappingData): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const [canonicalBrand, entry] of Object.entries(mappings)) {
    // Also add the canonical brand name itself as an alias
    // This ensures brands matching the canonical name exactly are also normalized
    lookup.set(canonicalBrand.toUpperCase(), canonicalBrand);

    for (const alias of Object.keys(entry.aliases)) {
      // Store uppercase for case-insensitive matching
      lookup.set(alias.toUpperCase(), canonicalBrand);
    }
  }

  return lookup;
}

// Get canonical brand name for a given alias
export function getCanonicalBrand(
  brandName: string,
  aliasLookup: Map<string, string>
): string {
  // Try exact match first (uppercase)
  const exactMatch = aliasLookup.get(brandName.toUpperCase());
  if (exactMatch) return exactMatch;

  // Try trimmed version
  const trimmed = brandName.trim().toUpperCase();
  const trimmedMatch = aliasLookup.get(trimmed);
  if (trimmedMatch) return trimmedMatch;

  // Return original if no match found
  return brandName;
}

// Normalized brand record with aggregated data
export interface NormalizedBrandRecord {
  canonicalBrand: string;
  originalBrands: string[]; // All original brand names that were consolidated
  net_sales: number;
  gross_margin_pct: number; // Weighted average by net_sales
  pct_of_total_net_sales: number;
  avg_cost_wo_excise: number; // Weighted average by net_sales
  store_id: StoreId;
  store: string;
  productTypes: string[]; // All product types this brand appears in
}

// Normalize brand data by consolidating aliases under canonical names
export function normalizeBrandData(
  brandData: BrandRecord[],
  mappings: BrandMappingData
): NormalizedBrandRecord[] {
  const mappingCount = mappings ? Object.keys(mappings).length : 0;

  if (!mappings || mappingCount === 0) {
    // No mappings - return data as-is, converted to NormalizedBrandRecord format
    console.warn('[normalizeBrandData] No brand mappings loaded - skipping normalization');
    return brandData.map(b => ({
      canonicalBrand: b.brand,
      originalBrands: [b.brand],
      net_sales: b.net_sales,
      gross_margin_pct: b.gross_margin_pct,
      pct_of_total_net_sales: b.pct_of_total_net_sales,
      avg_cost_wo_excise: b.avg_cost_wo_excise,
      store_id: b.store_id,
      store: b.store,
      productTypes: [],
    }));
  }

  console.log(`[normalizeBrandData] Normalizing ${brandData.length} brands using ${mappingCount} canonical mappings`);

  const aliasLookup = buildAliasLookup(mappings);

  // Group brand records by canonical name
  const groupedBrands = new Map<string, {
    records: BrandRecord[];
    productTypes: Set<string>;
  }>();

  for (const record of brandData) {
    const canonicalName = getCanonicalBrand(record.brand, aliasLookup);

    if (!groupedBrands.has(canonicalName)) {
      groupedBrands.set(canonicalName, {
        records: [],
        productTypes: new Set(),
      });
    }

    const group = groupedBrands.get(canonicalName)!;
    group.records.push(record);

    // Try to find the product type for this brand from mappings
    const brandUpper = record.brand.toUpperCase();
    for (const [, entry] of Object.entries(mappings)) {
      const productType = entry.aliases[brandUpper] || entry.aliases[record.brand];
      if (productType) {
        group.productTypes.add(productType);
        break;
      }
    }
  }

  // Aggregate each group into a single normalized record
  const normalizedRecords: NormalizedBrandRecord[] = [];

  for (const [canonicalBrand, group] of groupedBrands) {
    const { records, productTypes } = group;

    // Sum net sales
    const totalNetSales = records.reduce((sum, r) => sum + r.net_sales, 0);

    // Weighted average for margin (weighted by net_sales)
    const weightedMargin = totalNetSales > 0
      ? records.reduce((sum, r) => sum + (r.gross_margin_pct * r.net_sales), 0) / totalNetSales
      : 0;

    // Weighted average for cost (weighted by net_sales)
    const weightedCost = totalNetSales > 0
      ? records.reduce((sum, r) => sum + (r.avg_cost_wo_excise * r.net_sales), 0) / totalNetSales
      : 0;

    // Sum percentage of total (will recalculate later)
    const totalPct = records.reduce((sum, r) => sum + r.pct_of_total_net_sales, 0);

    // Use first record's store info (they should all be same after filtering)
    const firstRecord = records[0];

    normalizedRecords.push({
      canonicalBrand,
      originalBrands: records.map(r => r.brand),
      net_sales: totalNetSales,
      gross_margin_pct: weightedMargin,
      pct_of_total_net_sales: totalPct,
      avg_cost_wo_excise: weightedCost,
      store_id: firstRecord.store_id,
      store: firstRecord.store,
      productTypes: Array.from(productTypes),
    });
  }

  // Sort by net sales descending
  normalizedRecords.sort((a, b) => b.net_sales - a.net_sales);

  // Recalculate percentage of total based on consolidated data
  const grandTotal = normalizedRecords.reduce((sum, r) => sum + r.net_sales, 0);
  for (const record of normalizedRecords) {
    record.pct_of_total_net_sales = grandTotal > 0
      ? (record.net_sales / grandTotal) * 100
      : 0;
  }

  // Log consolidation results
  const consolidatedCount = normalizedRecords.filter(r => r.originalBrands.length > 1).length;
  console.log(`[normalizeBrandData] Result: ${normalizedRecords.length} unique brands (${consolidatedCount} consolidated from multiple aliases)`);

  return normalizedRecords;
}

// Convert NormalizedBrandRecord back to BrandRecord format for compatibility
export function toCompatibleBrandRecords(normalized: NormalizedBrandRecord[]): BrandRecord[] {
  return normalized.map(n => ({
    brand: n.canonicalBrand,
    net_sales: n.net_sales,
    gross_margin_pct: n.gross_margin_pct,
    pct_of_total_net_sales: n.pct_of_total_net_sales,
    avg_cost_wo_excise: n.avg_cost_wo_excise,
    store_id: n.store_id,
    store: n.store,
  }));
}

// ============================================
// CSV PARSING UTILITIES
// ============================================

// Parse CSV string to objects
export function parseCSV<T>(csvString: string): T[] {
  // Strip BOM (Byte Order Mark) from the beginning of the CSV if present
  // BOM can cause the first column header to be misread
  const cleanedCsv = csvString.replace(/^\uFEFF/, '');

  const result = Papa.parse<T>(cleanedCsv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => {
      // Normalize headers: trim, lowercase, replace spaces with underscores
      // Also remove any stray BOM characters that might appear mid-file
      return header
        .trim()
        .replace(/\uFEFF/g, '')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[()%]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
    },
  });

  return result.data;
}

// Convert to CSV string
export function toCSV<T extends Record<string, unknown>>(data: T[]): string {
  return Papa.unparse(data);
}

// Clean and validate sales data
// If overrideStoreId is provided, it will be used for all records
export function cleanSalesData(
  rawData: Record<string, string>[],
  overrideStoreId?: StoreId
): SalesRecord[] {
  return rawData
    .map((row) => {
      const storeName = row.store || row.Store || '';
      // Use override if provided, otherwise try to detect from CSV, fallback to first configured store
      const storeId = overrideStoreId || STORE_NAME_TO_ID[storeName] || getIndividualStoreIds()[0] || 'combined';

      const record: SalesRecord = {
        date: formatDate(row.date || row.Date || ''),
        store: storeName,
        store_id: storeId,
        week: row.week || row.Week || '',
        tickets_count: parseNumber(row.tickets_count || row['Tickets Count'] || '0'),
        units_sold: parseNumber(row.units_sold || row['Units Sold'] || '0'),
        customers_count: parseNumber(row.customers_count || row['Customers Count'] || '0'),
        new_customers: parseNumber(row.new_customers || row['New Customers'] || '0'),
        gross_sales: parseNumber(row.gross_sales || row['Gross Sales'] || '0'),
        discounts: parseNumber(row.discounts || row.Discounts || '0'),
        returns: parseNumber(row.returns || row.Returns || '0'),
        net_sales: parseNumber(row.net_sales || row['Net Sales'] || '0'),
        taxes: parseNumber(row.taxes || row.Taxes || '0'),
        gross_receipts: parseNumber(row.gross_receipts || row['Gross Receipts'] || '0'),
        cogs_with_excise: parseNumber(row.cogs_with_excise || row['COGS (with excise)'] || '0'),
        gross_income: parseNumber(row.gross_income || row['Gross Income'] || '0'),
        gross_margin_pct: parseNumber(row.gross_margin || row['Gross Margin %'] || '0'),
        discount_pct: parseNumber(row.discount || row['Discount %'] || '0'),
        cost_pct: parseNumber(row.cost || row['Cost %'] || '0'),
        avg_basket_size: parseNumber(row.avg_basket_size || row['Avg Basket Size'] || '0'),
        avg_order_value: parseNumber(row.avg_order_value || row['Avg Order Value'] || '0'),
        avg_order_profit: parseNumber(row.avg_order_profit || row['Avg Order Profit'] || '0'),
      };

      return record;
    })
    .filter((record) => {
      // Filter out invalid records
      return (
        record.date &&
        record.net_sales > 0 &&
        record.customers_count >= 5
      );
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// Clean and validate brand data
export function cleanBrandData(
  rawData: Record<string, string>[],
  storeId: StoreId,
  startDate: string,
  endDate: string
): BrandRecord[] {
  return rawData
    .map((row) => {
      // Handle column name change: 'Product Brand' → 'Brand'
      const brand = row.brand || row.Brand || row.product_brand || row['Product Brand'] || '';

      const record: BrandRecord = {
        brand,
        pct_of_total_net_sales: parseNumber(row.of_total_net_sales || row['% of Total Net Sales'] || '0'),
        gross_margin_pct: parseNumber(row.gross_margin || row['Gross Margin %'] || '0'),
        avg_cost_wo_excise: parseNumber(row.avg_cost_wo_excise || row['Avg Cost (w/o excise)'] || '0'),
        net_sales: parseNumber(row.net_sales || row['Net Sales'] || '0'),
        store: row.store || row.Store || '',
        store_id: storeId,
        upload_start_date: startDate,
        upload_end_date: endDate,
      };

      return record;
    })
    .filter((record) => {
      // Filter out sample records and zero/negative sales
      const isSample = record.brand.includes('[DS]') || record.brand.includes('[SS]');
      return !isSample && record.net_sales > 0;
    })
    .sort((a, b) => b.net_sales - a.net_sales);
}

// Clean and validate product data
export function cleanProductData(
  rawData: Record<string, string>[],
  storeId: StoreId,
  startDate?: string,
  endDate?: string
): ProductRecord[] {
  return rawData
    .map((row) => {
      const record: ProductRecord = {
        product_type: row.product_type || row['Product Type'] || '',
        pct_of_total_net_sales: parseNumber(row.of_total_net_sales || row['% of Total Net Sales'] || '0'),
        gross_margin_pct: parseNumber(row.gross_margin || row['Gross Margin %'] || '0'),
        avg_cost_wo_excise: parseNumber(row.avg_cost_wo_excise || row['Avg Cost (w/o excise)'] || '0'),
        net_sales: parseNumber(row.net_sales || row['Net Sales'] || '0'),
        store: row.store || row.Store || '',
        store_id: storeId,
        upload_start_date: startDate,
        upload_end_date: endDate,
      };

      return record;
    })
    .filter((record) => record.net_sales > 0)
    .sort((a, b) => b.net_sales - a.net_sales);
}

// Clean and validate customer data
export function cleanCustomerData(rawData: Record<string, string>[]): CustomerRecord[] {
  const today = new Date();

  return rawData
    .map((row) => {
      const lifetimeNetSales = parseNumber(row.lifetime_net_sales || row['Lifetime Net Sales'] || '0');
      const lastVisitDate = row.last_visit_date || row['Last Visit Date'] || '';
      const lastVisit = lastVisitDate ? new Date(lastVisitDate) : today;
      const daysSinceVisit = differenceInDays(today, lastVisit);

      const record: CustomerRecord = {
        store_name: row.store_name || row['Store Name'] || '',
        customer_id: row.customer_id || row['Customer ID'] || '',
        name: row.name || row.Name || '',
        date_of_birth: row.date_of_birth || row['Date of Birth'],
        age: row.age ? parseInt(row.age) : undefined,
        lifetime_visits: parseNumber(row.lifetime_visits || row['Lifetime In-Store Visits'] || '0'),
        lifetime_transactions: parseNumber(row.lifetime_transactions || row['Lifetime Transactions'] || '0'),
        lifetime_net_sales: lifetimeNetSales,
        lifetime_aov: parseNumber(row.lifetime_aov || row['Lifetime Avg Order Value'] || '0'),
        signup_date: row.signup_date || row['Sign-Up Date'] || '',
        last_visit_date: lastVisitDate,
        customer_segment: getCustomerSegment(lifetimeNetSales),
        recency_segment: getRecencySegment(daysSinceVisit),
      };

      return record;
    })
    .filter((record) => record.customer_id);
}

// Helper: Parse number from string
function parseNumber(value: string | number): number {
  if (typeof value === 'number') return value;

  // Remove currency symbols, commas, and percent signs
  const cleaned = value
    .replace(/[$,%]/g, '')
    .replace(/,/g, '')
    .trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Helper: Format date string
function formatDate(dateStr: string): string {
  if (!dateStr) return '';

  try {
    // Try various date formats
    const formats = ['MM/dd/yyyy', 'yyyy-MM-dd', 'M/d/yyyy', 'MM-dd-yyyy'];

    for (const fmt of formats) {
      try {
        const parsed = parse(dateStr, fmt, new Date());
        if (!isNaN(parsed.getTime())) {
          return format(parsed, 'yyyy-MM-dd');
        }
      } catch {
        continue;
      }
    }

    // Fallback: try native Date parsing
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return format(date, 'yyyy-MM-dd');
    }

    return dateStr;
  } catch {
    return dateStr;
  }
}

// Helper: Get customer segment based on lifetime value
function getCustomerSegment(lifetimeValue: number): CustomerSegment {
  for (const [segment, range] of Object.entries(CUSTOMER_SEGMENTS)) {
    if (lifetimeValue >= range.min && lifetimeValue < range.max) {
      return segment as CustomerSegment;
    }
  }
  return 'New/Low';
}

// Helper: Get recency segment based on days since last visit
function getRecencySegment(daysSinceVisit: number): RecencySegment {
  for (const [segment, range] of Object.entries(RECENCY_SEGMENTS)) {
    if (daysSinceVisit >= range.min && daysSinceVisit < range.max) {
      return segment as RecencySegment;
    }
  }
  return 'Lost';
}

// Calculate sales summary metrics
// Matches Streamlit app calculations exactly (see app.py lines 4824-4827):
// - Total Net Sales: sum of all stores' total_net_sales
// - Total Transactions: sum of all stores' total_transactions
// - Avg Order Value: average of each store's mean AOV (NOT overall mean)
// - Avg Gross Margin: average of each store's mean margin (NOT overall mean)
//
// The Streamlit logic is:
//   metrics = analytics.calculate_store_metrics(df)  # calculates per-store metrics
//   total_sales = sum(m['total_net_sales'] for m in metrics.values())
//   total_transactions = sum(m['total_transactions'] for m in metrics.values())
//   avg_aov = sum(m['avg_order_value'] for m in metrics.values()) / len(metrics)
//   avg_margin = sum(m['avg_margin'] for m in metrics.values()) / len(metrics)
export function calculateSalesSummary(salesData: SalesRecord[]): {
  totalRevenue: number;
  totalTransactions: number;
  totalCustomers: number;
  avgOrderValue: number;
  avgMargin: number;
  byStore: Record<StoreId, { revenue: number; transactions: number; margin: number }>;
} {
  const byStore: Record<StoreId, { revenue: number; transactions: number; margin: number; aovSum: number; count: number }> = {};
  for (const sid of [...getIndividualStoreIds(), 'combined']) {
    byStore[sid] = { revenue: 0, transactions: 0, margin: 0, aovSum: 0, count: 0 };
  }

  let totalRevenue = 0;
  let totalTransactions = 0;
  let totalCustomers = 0;

  for (const record of salesData) {
    totalRevenue += record.net_sales;
    totalTransactions += record.tickets_count;
    totalCustomers += record.customers_count;

    const storeId = record.store_id;
    if (!byStore[storeId]) {
      byStore[storeId] = { revenue: 0, transactions: 0, margin: 0, aovSum: 0, count: 0 };
    }
    byStore[storeId].revenue += record.net_sales;
    byStore[storeId].transactions += record.tickets_count;
    byStore[storeId].margin += record.gross_margin_pct;
    byStore[storeId].aovSum += record.avg_order_value;
    byStore[storeId].count++;
  }

  const activeStores: { id: StoreId; aov: number; margin: number }[] = [];
  const byStoreResult: Record<StoreId, { revenue: number; transactions: number; margin: number }> = {};

  for (const sid of getIndividualStoreIds()) {
    const store = byStore[sid] || { revenue: 0, transactions: 0, margin: 0, aovSum: 0, count: 0 };
    const marginDecimal = store.count > 0 ? store.margin / store.count : 0;
    const margin = marginDecimal <= 1 ? marginDecimal * 100 : marginDecimal;
    const aov = store.count > 0 ? store.aovSum / store.count : 0;

    byStoreResult[sid] = { revenue: store.revenue, transactions: store.transactions, margin };

    if (store.count > 0) {
      activeStores.push({ id: sid, aov, margin });
    }
  }

  const numStores = activeStores.length || 1;
  const avgOrderValue = activeStores.reduce((sum, s) => sum + s.aov, 0) / numStores;
  const avgMargin = activeStores.reduce((sum, s) => sum + s.margin, 0) / numStores;

  byStoreResult['combined'] = { revenue: totalRevenue, transactions: totalTransactions, margin: avgMargin };

  return {
    totalRevenue,
    totalTransactions,
    totalCustomers,
    avgOrderValue,
    avgMargin,
    byStore: byStoreResult,
  };
}

// Calculate brand summary metrics
export function calculateBrandSummary(brandData: BrandRecord[]): {
  topBrands: BrandRecord[];
  lowMarginBrands: BrandRecord[];
  byCategory: Record<string, BrandRecord[]>;
} {
  const topBrands = brandData.slice(0, 50);

  const lowMarginBrands = brandData.filter(
    (b) => b.gross_margin_pct < 40 && b.net_sales > 1000
  );

  // Group by first letter (simplified category)
  const byCategory: Record<string, BrandRecord[]> = {};
  for (const brand of brandData) {
    const category = brand.brand.charAt(0).toUpperCase();
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(brand);
  }

  return {
    topBrands,
    lowMarginBrands,
    byCategory,
  };
}

// Calculate customer summary metrics
export function calculateCustomerSummary(customerData: CustomerRecord[]): {
  totalCustomers: number;
  segmentBreakdown: Record<string, number>;
  recencyBreakdown: Record<string, number>;
  avgLifetimeValue: number;
} {
  // Initialize with known segments, but also count any others that appear
  const segmentBreakdown: Record<string, number> = {
    'New/Low': 0,
    'Regular': 0,
    'Good': 0,
    'VIP': 0,
    'Whale': 0,
    'Occasional': 0,
  };

  const recencyBreakdown: Record<string, number> = {
    'Active': 0,
    'Warm': 0,
    'Cool': 0,
    'Cold': 0,
    'Lost': 0,
    'Dormant': 0,
    'At Risk': 0,
  };

  let totalLTV = 0;

  for (const customer of customerData) {
    // Handle customer segment - initialize if not present
    const segment = customer.customer_segment;
    if (segment) {
      if (!(segment in segmentBreakdown)) {
        segmentBreakdown[segment] = 0;
      }
      segmentBreakdown[segment]++;
    }

    // Handle recency segment - initialize if not present
    const recency = customer.recency_segment;
    if (recency) {
      if (!(recency in recencyBreakdown)) {
        recencyBreakdown[recency] = 0;
      }
      recencyBreakdown[recency]++;
    }

    totalLTV += customer.lifetime_net_sales;
  }

  return {
    totalCustomers: customerData.length,
    segmentBreakdown,
    recencyBreakdown,
    avgLifetimeValue: customerData.length > 0 ? totalLTV / customerData.length : 0,
  };
}
