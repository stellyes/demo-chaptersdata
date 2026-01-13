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
} from '@/types';
import {
  STORE_NAME_TO_ID,
  CUSTOMER_SEGMENTS,
  RECENCY_SEGMENTS,
} from '@/lib/config';

// Parse CSV string to objects
export function parseCSV<T>(csvString: string): T[] {
  const result = Papa.parse<T>(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => {
      // Normalize headers: trim, lowercase, replace spaces with underscores
      return header
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[()%]/g, '')
        .replace(/_+/g, '_');
    },
  });

  return result.data;
}

// Convert to CSV string
export function toCSV<T extends Record<string, unknown>>(data: T[]): string {
  return Papa.unparse(data);
}

// Clean and validate sales data
export function cleanSalesData(rawData: Record<string, string>[]): SalesRecord[] {
  return rawData
    .map((row) => {
      const storeName = row.store || row.Store || '';
      const storeId = STORE_NAME_TO_ID[storeName] || 'grass_roots';

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
  storeId: StoreId
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
  const byStore: Record<StoreId, { revenue: number; transactions: number; margin: number; aovSum: number; count: number }> = {
    grass_roots: { revenue: 0, transactions: 0, margin: 0, aovSum: 0, count: 0 },
    barbary_coast: { revenue: 0, transactions: 0, margin: 0, aovSum: 0, count: 0 },
    combined: { revenue: 0, transactions: 0, margin: 0, aovSum: 0, count: 0 },
  };

  let totalRevenue = 0;
  let totalTransactions = 0;
  let totalCustomers = 0;

  for (const record of salesData) {
    totalRevenue += record.net_sales;
    totalTransactions += record.tickets_count;
    totalCustomers += record.customers_count;

    const storeId = record.store_id;
    if (byStore[storeId]) {
      byStore[storeId].revenue += record.net_sales;
      byStore[storeId].transactions += record.tickets_count;
      byStore[storeId].margin += record.gross_margin_pct;
      byStore[storeId].aovSum += record.avg_order_value;
      byStore[storeId].count++;
    }
  }

  // Calculate per-store averages first (matching Streamlit's calculate_store_metrics)
  // Margin: store_df['Gross Margin %'].mean() * 100 (source data is decimal like 0.708)
  // AOV: store_df['Avg Order Value'].mean()
  const grMarginDecimal = byStore.grass_roots.count > 0 ? byStore.grass_roots.margin / byStore.grass_roots.count : 0;
  const bcMarginDecimal = byStore.barbary_coast.count > 0 ? byStore.barbary_coast.margin / byStore.barbary_coast.count : 0;
  const grMargin = grMarginDecimal <= 1 ? grMarginDecimal * 100 : grMarginDecimal;
  const bcMargin = bcMarginDecimal <= 1 ? bcMarginDecimal * 100 : bcMarginDecimal;

  const grAvgOrderValue = byStore.grass_roots.count > 0 ? byStore.grass_roots.aovSum / byStore.grass_roots.count : 0;
  const bcAvgOrderValue = byStore.barbary_coast.count > 0 ? byStore.barbary_coast.aovSum / byStore.barbary_coast.count : 0;

  // Count active stores (stores with data)
  const activeStores: { aov: number; margin: number }[] = [];
  if (byStore.grass_roots.count > 0) {
    activeStores.push({ aov: grAvgOrderValue, margin: grMargin });
  }
  if (byStore.barbary_coast.count > 0) {
    activeStores.push({ aov: bcAvgOrderValue, margin: bcMargin });
  }

  // Calculate combined averages by averaging per-store metrics (matching Streamlit exactly)
  // avg_aov = sum(m['avg_order_value'] for m in metrics.values()) / len(metrics)
  // avg_margin = sum(m['avg_margin'] for m in metrics.values()) / len(metrics)
  const numStores = activeStores.length || 1;
  const avgOrderValue = activeStores.reduce((sum, s) => sum + s.aov, 0) / numStores;
  const avgMargin = activeStores.reduce((sum, s) => sum + s.margin, 0) / numStores;

  const byStoreResult: Record<StoreId, { revenue: number; transactions: number; margin: number }> = {
    grass_roots: {
      revenue: byStore.grass_roots.revenue,
      transactions: byStore.grass_roots.transactions,
      margin: grMargin,
    },
    barbary_coast: {
      revenue: byStore.barbary_coast.revenue,
      transactions: byStore.barbary_coast.transactions,
      margin: bcMargin,
    },
    combined: {
      revenue: totalRevenue,
      transactions: totalTransactions,
      margin: avgMargin,
    },
  };

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
  segmentBreakdown: Record<CustomerSegment, number>;
  recencyBreakdown: Record<RecencySegment, number>;
  avgLifetimeValue: number;
} {
  const segmentBreakdown: Record<CustomerSegment, number> = {
    'New/Low': 0,
    'Regular': 0,
    'Good': 0,
    'VIP': 0,
    'Whale': 0,
  };

  const recencyBreakdown: Record<RecencySegment, number> = {
    'Active': 0,
    'Warm': 0,
    'Cool': 0,
    'Cold': 0,
    'Lost': 0,
  };

  let totalLTV = 0;

  for (const customer of customerData) {
    segmentBreakdown[customer.customer_segment]++;
    recencyBreakdown[customer.recency_segment]++;
    totalLTV += customer.lifetime_net_sales;
  }

  return {
    totalCustomers: customerData.length,
    segmentBreakdown,
    recencyBreakdown,
    avgLifetimeValue: customerData.length > 0 ? totalLTV / customerData.length : 0,
  };
}
