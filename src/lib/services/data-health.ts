// ============================================
// DATA HEALTH & TREND DETECTION SERVICE
// Proactively identifies data gaps and emerging trends
// ============================================

import {
  SalesRecord,
  BrandRecord,
  CustomerRecord,
  InvoiceLineItem,
  DataGap,
  TrendAnomaly,
  DataFreshnessMetric,
  HealthCheckReport,
  HealthCheckSummary,
  DataHealthSeverity,
  DataSourceType,
  BrandMappingData,
} from '@/types';
import { CUSTOMER_SEGMENTS, RECENCY_SEGMENTS } from '@/lib/config';

// ============================================
// CONFIGURATION
// ============================================

// Freshness thresholds (days)
const FRESHNESS_THRESHOLDS = {
  fresh: 3,      // 0-3 days = fresh
  stale: 7,      // 4-7 days = stale
  // >7 days = critical
};

// Trend detection thresholds (percentage)
const TREND_THRESHOLDS = {
  netSales: { warning: 25, critical: 50 },
  grossMargin: { warning: 10, critical: 20 },
  customerCount: { warning: 20, critical: 40 },
  invoiceSpend: { warning: 30, critical: 60 },
  newCustomerPct: { warning: 30, critical: 50 },
};

// ============================================
// DATE UTILITIES
// ============================================

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function daysBetween(date1: Date, date2: Date): number {
  const diff = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function generateDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// ============================================
// SALES DATE GAP DETECTION
// ============================================

export function checkSalesDateGaps(salesData: SalesRecord[]): DataGap[] {
  const gaps: DataGap[] = [];

  if (salesData.length === 0) {
    gaps.push({
      id: `gap-sales-empty-${Date.now()}`,
      type: 'missing_date_range',
      severity: 'critical',
      source: 'sales',
      description: 'No sales data available',
      affectedRecords: 0,
      detectedAt: new Date().toISOString(),
      suggestedAction: 'Upload sales data from POS system',
    });
    return gaps;
  }

  // Get all dates and sort them
  const dates = salesData
    .map(s => s.date)
    .filter(d => d)
    .sort();

  const uniqueDates = [...new Set(dates)];

  if (uniqueDates.length < 2) return gaps;

  const startDate = parseDate(uniqueDates[0]);
  const endDate = parseDate(uniqueDates[uniqueDates.length - 1]);

  if (!startDate || !endDate) return gaps;

  // Generate expected date range
  const expectedDates = generateDateRange(startDate, endDate);
  const actualDatesSet = new Set(uniqueDates);

  // Find missing dates
  const missingDates: string[] = [];
  for (const date of expectedDates) {
    if (!actualDatesSet.has(date)) {
      missingDates.push(date);
    }
  }

  if (missingDates.length > 0) {
    // Group consecutive missing dates
    const missingGroups: string[][] = [];
    let currentGroup: string[] = [missingDates[0]];

    for (let i = 1; i < missingDates.length; i++) {
      const prevDate = parseDate(missingDates[i - 1]);
      const currDate = parseDate(missingDates[i]);

      if (prevDate && currDate && daysBetween(prevDate, currDate) === 1) {
        currentGroup.push(missingDates[i]);
      } else {
        missingGroups.push(currentGroup);
        currentGroup = [missingDates[i]];
      }
    }
    missingGroups.push(currentGroup);

    // Create gaps for each group
    for (const group of missingGroups) {
      const severity: DataHealthSeverity = group.length > 2 ? 'critical' : 'warning';
      const dateRange = group.length === 1
        ? group[0]
        : `${group[0]} to ${group[group.length - 1]}`;

      gaps.push({
        id: `gap-sales-dates-${group[0]}`,
        type: 'missing_date_range',
        severity,
        source: 'sales',
        description: `Missing ${group.length} day(s) of sales data: ${dateRange}`,
        affectedRecords: group.length,
        detectedAt: new Date().toISOString(),
        context: { missingDates: group },
        suggestedAction: `Upload sales data for ${dateRange}`,
      });
    }
  }

  return gaps;
}

// ============================================
// DATA FRESHNESS CHECK
// ============================================

export function checkDataFreshness(data: {
  sales?: SalesRecord[];
  brands?: BrandRecord[];
  customers?: CustomerRecord[];
  invoices?: InvoiceLineItem[];
}): DataFreshnessMetric[] {
  const metrics: DataFreshnessMetric[] = [];
  const now = new Date();

  // Sales freshness
  if (data.sales && data.sales.length > 0) {
    const salesDates = data.sales
      .map(s => parseDate(s.date))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime());

    const lastSalesDate = salesDates[0];
    const lagDays = daysBetween(lastSalesDate, now);

    metrics.push({
      source: 'sales',
      lastDataPoint: formatDate(lastSalesDate),
      dataLagDays: lagDays,
      lastUpdated: new Date().toISOString(),
      recordCount: data.sales.length,
      status: lagDays <= FRESHNESS_THRESHOLDS.fresh ? 'fresh'
            : lagDays <= FRESHNESS_THRESHOLDS.stale ? 'stale'
            : 'critical',
    });
  }

  // Customer freshness (based on last_visit_date)
  if (data.customers && data.customers.length > 0) {
    const visitDates = data.customers
      .map(c => parseDate(c.last_visit_date))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime());

    if (visitDates.length > 0) {
      const lastVisit = visitDates[0];
      const lagDays = daysBetween(lastVisit, now);

      metrics.push({
        source: 'customers',
        lastDataPoint: formatDate(lastVisit),
        dataLagDays: lagDays,
        lastUpdated: new Date().toISOString(),
        recordCount: data.customers.length,
        status: lagDays <= FRESHNESS_THRESHOLDS.fresh ? 'fresh'
              : lagDays <= FRESHNESS_THRESHOLDS.stale ? 'stale'
              : 'critical',
      });
    }
  }

  // Invoice freshness (based on invoice_date)
  if (data.invoices && data.invoices.length > 0) {
    const invoiceDates = data.invoices
      .map(i => parseDate(i.invoice_date || ''))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime());

    if (invoiceDates.length > 0) {
      const lastInvoice = invoiceDates[0];
      const lagDays = daysBetween(lastInvoice, now);

      metrics.push({
        source: 'invoices',
        lastDataPoint: formatDate(lastInvoice),
        dataLagDays: lagDays,
        lastUpdated: new Date().toISOString(),
        recordCount: data.invoices.length,
        status: lagDays <= FRESHNESS_THRESHOLDS.fresh ? 'fresh'
              : lagDays <= FRESHNESS_THRESHOLDS.stale ? 'stale'
              : 'critical',
      });
    }
  }

  // Brand freshness (based on upload dates)
  if (data.brands && data.brands.length > 0) {
    const brandDates = data.brands
      .map(b => parseDate(b.upload_end_date || ''))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime());

    if (brandDates.length > 0) {
      const lastBrand = brandDates[0];
      const lagDays = daysBetween(lastBrand, now);

      metrics.push({
        source: 'brands',
        lastDataPoint: formatDate(lastBrand),
        dataLagDays: lagDays,
        lastUpdated: new Date().toISOString(),
        recordCount: data.brands.length,
        status: lagDays <= FRESHNESS_THRESHOLDS.fresh ? 'fresh'
              : lagDays <= FRESHNESS_THRESHOLDS.stale ? 'stale'
              : 'critical',
      });
    }
  }

  return metrics;
}

// ============================================
// EMPTY/MISSING FIELDS CHECK
// ============================================

export function checkEmptyFields(invoices: InvoiceLineItem[]): DataGap[] {
  const gaps: DataGap[] = [];

  if (invoices.length === 0) return gaps;

  // Check for missing invoice dates
  const missingDates = invoices.filter(i => !i.invoice_date || i.invoice_date === '');
  if (missingDates.length > 0) {
    gaps.push({
      id: `gap-invoice-dates-${Date.now()}`,
      type: 'empty_field',
      severity: 'warning',
      source: 'invoices',
      description: `${missingDates.length} invoice line items have no invoice date`,
      affectedRecords: missingDates.length,
      detectedAt: new Date().toISOString(),
      context: {
        sampleInvoiceIds: missingDates.slice(0, 5).map(i => i.invoice_id),
        percentMissing: ((missingDates.length / invoices.length) * 100).toFixed(1),
      },
      suggestedAction: 'Review invoice extraction process to capture dates',
    });
  }

  // Check for missing product types
  const missingProductType = invoices.filter(i => !i.product_type || i.product_type === 'Unknown');
  if (missingProductType.length > 10) {
    gaps.push({
      id: `gap-product-types-${Date.now()}`,
      type: 'empty_field',
      severity: 'info',
      source: 'invoices',
      description: `${missingProductType.length} invoice items have unknown product type`,
      affectedRecords: missingProductType.length,
      detectedAt: new Date().toISOString(),
      context: {
        percentMissing: ((missingProductType.length / invoices.length) * 100).toFixed(1),
      },
      suggestedAction: 'Update brand mappings to categorize products',
    });
  }

  // Check for zero unit costs
  const zeroCost = invoices.filter(i => i.unit_cost === 0 && i.total_cost > 0);
  if (zeroCost.length > 0) {
    gaps.push({
      id: `gap-unit-costs-${Date.now()}`,
      type: 'empty_field',
      severity: 'info',
      source: 'invoices',
      description: `${zeroCost.length} invoice items have zero unit cost but non-zero total`,
      affectedRecords: zeroCost.length,
      detectedAt: new Date().toISOString(),
      suggestedAction: 'Review invoice parsing for unit cost extraction',
    });
  }

  return gaps;
}

// ============================================
// BRAND ALIAS COVERAGE CHECK
// ============================================

export function checkBrandAliasCoverage(
  invoices: InvoiceLineItem[],
  brandMappings: BrandMappingData | null
): DataGap[] {
  const gaps: DataGap[] = [];

  if (!brandMappings || invoices.length === 0) return gaps;

  // Build set of all known aliases
  const knownAliases = new Set<string>();
  for (const [canonical, entry] of Object.entries(brandMappings)) {
    knownAliases.add(canonical.toUpperCase());
    for (const alias of Object.keys(entry.aliases)) {
      knownAliases.add(alias.toUpperCase());
    }
  }

  // Find brands in invoices not in mappings
  const unmappedBrands = new Map<string, number>();
  for (const inv of invoices) {
    const brand = (inv.brand || 'Unknown').toUpperCase();
    if (brand !== 'UNKNOWN' && !knownAliases.has(brand)) {
      unmappedBrands.set(inv.brand, (unmappedBrands.get(inv.brand) || 0) + 1);
    }
  }

  if (unmappedBrands.size > 0) {
    // Sort by frequency
    const sortedUnmapped = Array.from(unmappedBrands.entries())
      .sort((a, b) => b[1] - a[1]);

    const totalUnmapped = sortedUnmapped.reduce((sum, [, count]) => sum + count, 0);

    gaps.push({
      id: `gap-unmapped-brands-${Date.now()}`,
      type: 'unmapped_brand',
      severity: unmappedBrands.size > 20 ? 'warning' : 'info',
      source: 'invoices',
      description: `${unmappedBrands.size} brands in invoices are not in brand mappings`,
      affectedRecords: totalUnmapped,
      detectedAt: new Date().toISOString(),
      context: {
        topUnmapped: sortedUnmapped.slice(0, 10).map(([brand, count]) => ({ brand, count })),
        totalUniqueUnmapped: unmappedBrands.size,
      },
      suggestedAction: 'Add missing brands to brand_product_mapping.json',
    });
  }

  return gaps;
}

// ============================================
// CONFIGURATION CONSISTENCY CHECK
// ============================================

// This check verifies that config values are being used consistently.
// Now that routes have been aligned with config.ts, this serves as a
// sanity check that the config values are reasonable.
export function checkConfigConsistency(): DataGap[] {
  const gaps: DataGap[] = [];

  // Verify customer segment thresholds make sense
  const segments = Object.entries(CUSTOMER_SEGMENTS);
  for (let i = 1; i < segments.length; i++) {
    const [prevSeg, prevRange] = segments[i - 1];
    const [currSeg, currRange] = segments[i];

    // Check that ranges are contiguous
    if (prevRange.max !== currRange.min) {
      gaps.push({
        id: `gap-config-segment-gap-${Date.now()}`,
        type: 'threshold_mismatch',
        severity: 'warning',
        source: 'config',
        description: `Customer segment gap between ${prevSeg} (max: $${prevRange.max}) and ${currSeg} (min: $${currRange.min})`,
        affectedRecords: 1,
        detectedAt: new Date().toISOString(),
        suggestedAction: 'Review customer segment thresholds in config.ts',
      });
    }
  }

  // Verify recency segment thresholds make sense
  const recencySegments = Object.entries(RECENCY_SEGMENTS);
  for (let i = 1; i < recencySegments.length; i++) {
    const [prevSeg, prevRange] = recencySegments[i - 1];
    const [currSeg, currRange] = recencySegments[i];

    // Check that ranges are contiguous
    if (prevRange.max !== currRange.min) {
      gaps.push({
        id: `gap-config-recency-gap-${Date.now()}`,
        type: 'threshold_mismatch',
        severity: 'warning',
        source: 'config',
        description: `Recency segment gap between ${prevSeg} (max: ${prevRange.max} days) and ${currSeg} (min: ${currRange.min} days)`,
        affectedRecords: 1,
        detectedAt: new Date().toISOString(),
        suggestedAction: 'Review recency segment thresholds in config.ts',
      });
    }
  }

  return gaps;
}

// ============================================
// TREND DETECTION
// ============================================

interface BaselineMetrics {
  avgNetSales: number;
  avgGrossMargin: number;
  avgCustomerCount: number;
  avgNewCustomerPct: number;
  totalInvoiceSpend: number;
  dateRange: { start: string; end: string };
}

function calculateBaselineMetrics(salesData: SalesRecord[]): BaselineMetrics | null {
  if (salesData.length === 0) return null;

  const sortedSales = [...salesData].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Use last 30 days as baseline
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const baselineSales = sortedSales.filter(s => {
    const date = parseDate(s.date);
    return date && date >= thirtyDaysAgo;
  });

  if (baselineSales.length < 7) return null; // Need at least a week of data

  const totalNetSales = baselineSales.reduce((sum, s) => sum + (s.net_sales || 0), 0);
  const totalMargin = baselineSales.reduce((sum, s) => sum + (s.gross_margin_pct || 0), 0);
  const totalCustomers = baselineSales.reduce((sum, s) => sum + (s.customers_count || 0), 0);
  const totalNew = baselineSales.reduce((sum, s) => sum + (s.new_customers || 0), 0);

  return {
    avgNetSales: totalNetSales / baselineSales.length,
    avgGrossMargin: totalMargin / baselineSales.length,
    avgCustomerCount: totalCustomers / baselineSales.length,
    avgNewCustomerPct: totalCustomers > 0 ? (totalNew / totalCustomers) * 100 : 0,
    totalInvoiceSpend: 0, // Will be set separately if invoice data available
    dateRange: {
      start: baselineSales[0].date,
      end: baselineSales[baselineSales.length - 1].date,
    },
  };
}

export function detectTrendAnomalies(
  salesData: SalesRecord[],
  invoiceData?: InvoiceLineItem[]
): TrendAnomaly[] {
  const anomalies: TrendAnomaly[] = [];

  const baseline = calculateBaselineMetrics(salesData);
  if (!baseline) return anomalies;

  // Get most recent 7 days for comparison
  const sortedSales = [...salesData].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const recentSales = sortedSales.slice(0, 7);
  if (recentSales.length < 3) return anomalies;

  const now = new Date().toISOString();
  const recentPeriod = {
    start: recentSales[recentSales.length - 1].date,
    end: recentSales[0].date,
  };

  // Check net sales trend
  const recentAvgSales = recentSales.reduce((sum, s) => sum + (s.net_sales || 0), 0) / recentSales.length;
  const salesChange = ((recentAvgSales - baseline.avgNetSales) / baseline.avgNetSales) * 100;

  if (Math.abs(salesChange) >= TREND_THRESHOLDS.netSales.warning) {
    const severity: DataHealthSeverity = Math.abs(salesChange) >= TREND_THRESHOLDS.netSales.critical ? 'critical' : 'warning';
    anomalies.push({
      id: `trend-sales-${Date.now()}`,
      metric: 'Daily Net Sales',
      source: 'sales',
      currentValue: recentAvgSales,
      baselineValue: baseline.avgNetSales,
      percentChange: salesChange,
      direction: salesChange > 0 ? 'increase' : 'decrease',
      severity,
      period: recentPeriod,
      detectedAt: now,
      context: `Average daily sales ${salesChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(salesChange).toFixed(1)}% vs 30-day baseline`,
    });
  }

  // Check gross margin trend
  const recentAvgMargin = recentSales.reduce((sum, s) => sum + (s.gross_margin_pct || 0), 0) / recentSales.length;
  const marginChange = ((recentAvgMargin - baseline.avgGrossMargin) / baseline.avgGrossMargin) * 100;

  if (Math.abs(marginChange) >= TREND_THRESHOLDS.grossMargin.warning) {
    const severity: DataHealthSeverity = Math.abs(marginChange) >= TREND_THRESHOLDS.grossMargin.critical ? 'critical' : 'warning';
    anomalies.push({
      id: `trend-margin-${Date.now()}`,
      metric: 'Gross Margin',
      source: 'sales',
      currentValue: recentAvgMargin,
      baselineValue: baseline.avgGrossMargin,
      percentChange: marginChange,
      direction: marginChange > 0 ? 'increase' : 'decrease',
      severity,
      period: recentPeriod,
      detectedAt: now,
      context: `Gross margin ${marginChange > 0 ? 'improved' : 'declined'} by ${Math.abs(marginChange).toFixed(1)}% vs baseline`,
    });
  }

  // Check customer count trend
  const recentAvgCustomers = recentSales.reduce((sum, s) => sum + (s.customers_count || 0), 0) / recentSales.length;
  const customerChange = ((recentAvgCustomers - baseline.avgCustomerCount) / baseline.avgCustomerCount) * 100;

  if (customerChange <= -TREND_THRESHOLDS.customerCount.warning) {
    const severity: DataHealthSeverity = customerChange <= -TREND_THRESHOLDS.customerCount.critical ? 'critical' : 'warning';
    anomalies.push({
      id: `trend-customers-${Date.now()}`,
      metric: 'Daily Customer Count',
      source: 'sales',
      currentValue: recentAvgCustomers,
      baselineValue: baseline.avgCustomerCount,
      percentChange: customerChange,
      direction: 'decrease',
      severity,
      period: recentPeriod,
      detectedAt: now,
      context: `Customer traffic declined by ${Math.abs(customerChange).toFixed(1)}% vs baseline`,
    });
  }

  // Check invoice spend trend (if data available)
  if (invoiceData && invoiceData.length > 0) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentInvoices = invoiceData.filter(i => {
      const date = parseDate(i.invoice_date || '');
      return date && date >= sevenDaysAgo;
    });

    const baselineInvoices = invoiceData.filter(i => {
      const date = parseDate(i.invoice_date || '');
      return date && date >= thirtyDaysAgo && date < sevenDaysAgo;
    });

    if (recentInvoices.length > 0 && baselineInvoices.length > 0) {
      const recentSpend = recentInvoices.reduce((sum, i) => sum + (i.total_with_excise || i.total_cost || 0), 0);
      const baselineSpend = baselineInvoices.reduce((sum, i) => sum + (i.total_with_excise || i.total_cost || 0), 0);

      // Normalize by time period
      const baselineDaily = baselineSpend / 23; // ~23 days in baseline
      const recentDaily = recentSpend / 7;

      const spendChange = ((recentDaily - baselineDaily) / baselineDaily) * 100;

      if (spendChange >= TREND_THRESHOLDS.invoiceSpend.warning) {
        const severity: DataHealthSeverity = spendChange >= TREND_THRESHOLDS.invoiceSpend.critical ? 'critical' : 'warning';
        anomalies.push({
          id: `trend-invoices-${Date.now()}`,
          metric: 'Daily Invoice Spend',
          source: 'invoices',
          currentValue: recentDaily,
          baselineValue: baselineDaily,
          percentChange: spendChange,
          direction: 'increase',
          severity,
          period: recentPeriod,
          detectedAt: now,
          context: `Purchasing spend increased by ${spendChange.toFixed(1)}% vs baseline - review if intentional`,
        });
      }
    }
  }

  return anomalies;
}

// ============================================
// STALE DATA GAPS
// ============================================

export function checkStaleData(freshnessMetrics: DataFreshnessMetric[]): DataGap[] {
  const gaps: DataGap[] = [];

  for (const metric of freshnessMetrics) {
    if (metric.status === 'critical') {
      gaps.push({
        id: `gap-stale-${metric.source}-${Date.now()}`,
        type: 'stale_data',
        severity: 'critical',
        source: metric.source,
        description: `${metric.source} data is ${metric.dataLagDays} days old (last: ${metric.lastDataPoint})`,
        affectedRecords: metric.recordCount,
        detectedAt: new Date().toISOString(),
        context: {
          lastDataPoint: metric.lastDataPoint,
          dataLagDays: metric.dataLagDays,
        },
        suggestedAction: `Upload recent ${metric.source} data`,
      });
    } else if (metric.status === 'stale') {
      gaps.push({
        id: `gap-stale-${metric.source}-${Date.now()}`,
        type: 'stale_data',
        severity: 'warning',
        source: metric.source,
        description: `${metric.source} data is ${metric.dataLagDays} days old (last: ${metric.lastDataPoint})`,
        affectedRecords: metric.recordCount,
        detectedAt: new Date().toISOString(),
        context: {
          lastDataPoint: metric.lastDataPoint,
          dataLagDays: metric.dataLagDays,
        },
        suggestedAction: `Consider uploading more recent ${metric.source} data`,
      });
    }
  }

  return gaps;
}

// ============================================
// GENERATE INSIGHTS
// ============================================

function generateInsights(
  gaps: DataGap[],
  trends: TrendAnomaly[],
  freshness: DataFreshnessMetric[]
): string[] {
  const insights: string[] = [];

  // Data coverage insight
  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  if (criticalGaps.length > 0) {
    insights.push(`${criticalGaps.length} critical data issues require immediate attention`);
  }

  // Freshness insight
  const staleData = freshness.filter(f => f.status !== 'fresh');
  if (staleData.length > 0) {
    insights.push(`${staleData.length} data source(s) may be outdated: ${staleData.map(d => d.source).join(', ')}`);
  }

  // Trend insights
  const criticalTrends = trends.filter(t => t.severity === 'critical');
  for (const trend of criticalTrends) {
    insights.push(`ALERT: ${trend.metric} ${trend.direction}d ${Math.abs(trend.percentChange).toFixed(0)}% vs baseline`);
  }

  // Missing date ranges
  const dateGaps = gaps.filter(g => g.type === 'missing_date_range');
  if (dateGaps.length > 0) {
    const totalDaysMissing = dateGaps.reduce((sum, g) => sum + g.affectedRecords, 0);
    insights.push(`${totalDaysMissing} day(s) of sales data missing - analysis may be incomplete`);
  }

  // Unmapped brands
  const unmappedGap = gaps.find(g => g.type === 'unmapped_brand');
  if (unmappedGap) {
    insights.push(`${unmappedGap.affectedRecords} invoice items have brands not in mappings - cost analysis may be incomplete`);
  }

  if (insights.length === 0) {
    insights.push('All data sources are healthy and up to date');
  }

  return insights;
}

// ============================================
// GENERATE RECOMMENDATIONS
// ============================================

function generateRecommendations(gaps: DataGap[], trends: TrendAnomaly[]): string[] {
  const recommendations: string[] = [];

  // Prioritize by severity
  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  const warningGaps = gaps.filter(g => g.severity === 'warning');

  // Add unique recommendations from gaps
  const seenActions = new Set<string>();

  for (const gap of [...criticalGaps, ...warningGaps]) {
    if (gap.suggestedAction && !seenActions.has(gap.suggestedAction)) {
      recommendations.push(gap.suggestedAction);
      seenActions.add(gap.suggestedAction);
    }
  }

  // Add trend-based recommendations
  for (const trend of trends.filter(t => t.severity === 'critical')) {
    if (trend.metric === 'Daily Net Sales' && trend.direction === 'decrease') {
      recommendations.push('Investigate sales decline - check promotions, staffing, and competitor activity');
    }
    if (trend.metric === 'Gross Margin' && trend.direction === 'decrease') {
      recommendations.push('Review pricing and vendor costs - margin erosion detected');
    }
    if (trend.metric === 'Daily Customer Count' && trend.direction === 'decrease') {
      recommendations.push('Launch customer re-engagement campaign - traffic declining');
    }
  }

  return recommendations.slice(0, 10); // Limit to top 10 recommendations
}

// ============================================
// CALCULATE HEALTH SCORE
// ============================================

function calculateHealthScore(
  gaps: DataGap[],
  trends: TrendAnomaly[],
  freshness: DataFreshnessMetric[]
): number {
  let score = 100;

  // Deduct for gaps
  for (const gap of gaps) {
    if (gap.severity === 'critical') score -= 15;
    else if (gap.severity === 'warning') score -= 5;
    else score -= 1;
  }

  // Deduct for trend anomalies
  for (const trend of trends) {
    if (trend.severity === 'critical') score -= 10;
    else if (trend.severity === 'warning') score -= 3;
  }

  // Deduct for stale data
  for (const f of freshness) {
    if (f.status === 'critical') score -= 10;
    else if (f.status === 'stale') score -= 3;
  }

  return Math.max(0, Math.min(100, score));
}

// ============================================
// FULL HEALTH CHECK
// ============================================

export interface HealthCheckInput {
  sales?: SalesRecord[];
  brands?: BrandRecord[];
  customers?: CustomerRecord[];
  invoices?: InvoiceLineItem[];
  brandMappings?: BrandMappingData | null;
}

export async function runFullHealthCheck(
  data: HealthCheckInput
): Promise<HealthCheckReport> {
  const allGaps: DataGap[] = [];
  const allTrends: TrendAnomaly[] = [];

  // 1. Check data freshness
  const freshness = checkDataFreshness(data);

  // 2. Check for stale data
  const staleGaps = checkStaleData(freshness);
  allGaps.push(...staleGaps);

  // 3. Check sales date gaps
  if (data.sales) {
    const salesGaps = checkSalesDateGaps(data.sales);
    allGaps.push(...salesGaps);
  }

  // 4. Check empty fields in invoices
  if (data.invoices) {
    const fieldGaps = checkEmptyFields(data.invoices);
    allGaps.push(...fieldGaps);
  }

  // 5. Check brand alias coverage
  if (data.invoices && data.brandMappings) {
    const aliasGaps = checkBrandAliasCoverage(data.invoices, data.brandMappings);
    allGaps.push(...aliasGaps);
  }

  // 6. Check configuration consistency
  const configGaps = checkConfigConsistency();
  allGaps.push(...configGaps);

  // 7. Detect trend anomalies
  if (data.sales) {
    const trends = detectTrendAnomalies(data.sales, data.invoices);
    allTrends.push(...trends);
  }

  // 8. Generate insights and recommendations
  const insights = generateInsights(allGaps, allTrends, freshness);
  const recommendations = generateRecommendations(allGaps, allTrends);

  // 9. Calculate health score
  const healthScore = calculateHealthScore(allGaps, allTrends, freshness);

  // 10. Build summary
  const summary: HealthCheckSummary = {
    totalGaps: allGaps.length,
    criticalGaps: allGaps.filter(g => g.severity === 'critical').length,
    warningGaps: allGaps.filter(g => g.severity === 'warning').length,
    infoGaps: allGaps.filter(g => g.severity === 'info').length,
    trendAnomalies: allTrends.length,
    overallHealthScore: healthScore,
  };

  return {
    report_id: `health-check-${Date.now()}`,
    timestamp: new Date().toISOString(),
    summary,
    dataFreshness: freshness,
    gaps: allGaps,
    trends: allTrends,
    insights,
    recommendations,
  };
}
