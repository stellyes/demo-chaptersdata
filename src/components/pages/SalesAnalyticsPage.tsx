'use client';

import { memo, useMemo, useState } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable } from '@/components/ui/DataTable';
import { SalesChart } from '@/components/charts/SalesChart';
import { TopBrandsChart, MarginScatterChart } from '@/components/charts/BrandChart';
import { CategoryPieChart, SegmentPieChart } from '@/components/charts/PieChart';
import { useFilteredSalesData, useFilteredProductData, useAppStore, useNormalizedBrandDataCompat } from '@/store/app-store';
import { format, subMonths } from 'date-fns';
import { TrendingUp, TrendingDown, Users, DollarSign, ShoppingCart, Percent, Calendar, User, Search, BarChart3, AlertCircle, Package, FileText, Tag } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { calculateCustomerSummary } from '@/lib/services/data-processor';

// ============================================
// SALES TRENDS TAB
// ============================================
function SalesTrendsTab() {
  const salesData = useFilteredSalesData();

  const salesChartData = useMemo(() => {
    const byDate: Record<string, { date: string; grass_roots: number; barbary_coast: number }> = {};

    for (const record of salesData) {
      const dateKey = record.date;
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey, grass_roots: 0, barbary_coast: 0 };
      }
      if (record.store_id === 'grass_roots') {
        byDate[dateKey].grass_roots += record.net_sales;
      } else if (record.store_id === 'barbary_coast') {
        byDate[dateKey].barbary_coast += record.net_sales;
      }
    }

    return Object.values(byDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((d) => ({
        ...d,
        date: format(new Date(d.date), 'MMM d'),
      }));
  }, [salesData]);

  const customerChartData = useMemo(() => {
    const byDate: Record<string, { date: string; grass_roots: number; barbary_coast: number }> = {};

    for (const record of salesData) {
      const dateKey = record.date;
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey, grass_roots: 0, barbary_coast: 0 };
      }
      if (record.store_id === 'grass_roots') {
        byDate[dateKey].grass_roots += record.customers_count;
      } else if (record.store_id === 'barbary_coast') {
        byDate[dateKey].barbary_coast += record.customers_count;
      }
    }

    return Object.values(byDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((d) => ({
        ...d,
        date: format(new Date(d.date), 'MMM d'),
      }));
  }, [salesData]);

  const marginChartData = useMemo(() => {
    const byDate: Record<string, { date: string; grass_roots: number; barbary_coast: number; count_gr: number; count_bc: number }> = {};

    for (const record of salesData) {
      const dateKey = record.date;
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey, grass_roots: 0, barbary_coast: 0, count_gr: 0, count_bc: 0 };
      }
      if (record.store_id === 'grass_roots') {
        byDate[dateKey].grass_roots += record.gross_margin_pct;
        byDate[dateKey].count_gr++;
      } else if (record.store_id === 'barbary_coast') {
        byDate[dateKey].barbary_coast += record.gross_margin_pct;
        byDate[dateKey].count_bc++;
      }
    }

    return Object.values(byDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((d) => ({
        date: format(new Date(d.date), 'MMM d'),
        grass_roots: d.count_gr > 0 ? d.grass_roots / d.count_gr : 0,
        barbary_coast: d.count_bc > 0 ? d.barbary_coast / d.count_bc : 0,
      }));
  }, [salesData]);

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Daily Performance</SectionLabel>
        <SectionTitle>Net Sales by Store</SectionTitle>
        {salesChartData.length > 0 ? (
          <SalesChart data={salesChartData} metric="revenue" />
        ) : (
          <div className="h-[300px] flex items-center justify-center text-[var(--muted)]">
            No sales data available. Upload data in Data Center.
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <SectionLabel>Customer Traffic</SectionLabel>
          <SectionTitle>Daily Customer Count</SectionTitle>
          {customerChartData.length > 0 ? (
            <SalesChart data={customerChartData} metric="transactions" />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-[var(--muted)]">
              No customer data available.
            </div>
          )}
        </Card>

        <Card>
          <SectionLabel>Margin Trends</SectionLabel>
          <SectionTitle>Gross Margin % Over Time</SectionTitle>
          {marginChartData.length > 0 ? (
            <SalesChart data={marginChartData} metric="margin" />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-[var(--muted)]">
              No margin data available.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ============================================
// BRAND PERFORMANCE TAB
// ============================================
function BrandPerformanceTab() {
  // Use normalized brand data - consolidates aliases under canonical brand names
  const brandData = useNormalizedBrandDataCompat();
  const [topBrandsLimit, setTopBrandsLimit] = useState(20);

  // Calculate low margin brands (< 40% margin with > $1000 sales)
  const lowMarginBrands = useMemo(() => {
    return brandData.filter((b) => b.gross_margin_pct < 40 && b.net_sales > 1000);
  }, [brandData]);

  // Calculate high-margin growth opportunities (> 71% margin with minimum $29k revenue)
  // These are brands with great margins that meet revenue threshold
  const highMarginGrowthBrands = useMemo(() => {
    return brandData
      .filter((b) => b.brand && b.gross_margin_pct > 71 && b.net_sales >= 29000)
      .sort((a, b) => b.gross_margin_pct - a.gross_margin_pct);
  }, [brandData]);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between mb-6">
          <div>
            <SectionLabel>Revenue Leaders</SectionLabel>
            <SectionTitle>Top Brands by Net Sales</SectionTitle>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--muted)]">Show top:</label>
            <select
              value={topBrandsLimit}
              onChange={(e) => setTopBrandsLimit(Number(e.target.value))}
              className="px-3 py-1 border border-[var(--border)] rounded text-sm"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>
        {brandData.length > 0 ? (
          <TopBrandsChart data={brandData} limit={topBrandsLimit} />
        ) : (
          <div className="h-[400px] flex items-center justify-center text-[var(--muted)]">
            No brand data available. Upload data in Data Center.
          </div>
        )}
      </Card>

      <Card>
        <SectionLabel>Margin Analysis</SectionLabel>
        <SectionTitle>Revenue vs Margin Scatter</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-4">
          Brands above the 55% target line are meeting margin goals. Size indicates sales volume.
          <span className="ml-2 text-[var(--success)]">Green = High Margin (65%+)</span>
          <span className="ml-2 text-[var(--warning)]">Yellow = Below 40%</span>
          <span className="ml-2 text-[var(--error)]">Red = Low Margin (&lt;40%)</span>
        </p>
        {brandData.length > 0 ? (
          <MarginScatterChart data={brandData} />
        ) : (
          <div className="h-[400px] flex items-center justify-center text-[var(--muted)]">
            No brand data available.
          </div>
        )}
      </Card>

      {/* Low Margin Brands Alert */}
      {lowMarginBrands.length > 0 && (
        <Card className="border-[var(--warning)] border-2">
          <SectionLabel className="text-[var(--warning)]">Margin Alert</SectionLabel>
          <SectionTitle>Low Margin Brands (&lt;40%)</SectionTitle>
          <p className="text-sm text-[var(--muted)] mb-4">
            These brands have margins below 40% with significant sales volume. Consider price adjustments or vendor negotiations.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {lowMarginBrands.slice(0, 10).map((brand, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-[var(--warning)]/5 rounded">
                <span className="font-medium">{brand.brand}</span>
                <div className="text-right">
                  <p className="text-sm font-medium">${brand.net_sales.toLocaleString()}</p>
                  <p className="text-xs text-[var(--warning)]">{brand.gross_margin_pct.toFixed(1)}% margin</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* High-Margin Growth Opportunities */}
      {highMarginGrowthBrands.length > 0 && (
        <Card className="border-[var(--success)] border-2">
          <SectionLabel className="text-[var(--success)]">Growth Opportunity</SectionLabel>
          <SectionTitle>Untapped High-Margin Brands</SectionTitle>
          <p className="text-sm text-[var(--muted)] mb-4">
            These brands have excellent margins (71%+) and meet the $29k revenue threshold. Promote these through staff recommendations or featured displays.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {highMarginGrowthBrands.slice(0, 10).map((brand, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-[var(--success)]/5 rounded">
                <span className="font-medium">{brand.brand}</span>
                <div className="text-right">
                  <p className="text-sm font-medium text-[var(--success)]">{brand.gross_margin_pct.toFixed(1)}% margin</p>
                  <p className="text-xs text-[var(--muted)]">${brand.net_sales.toLocaleString()} sales</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================
// PRODUCT CATEGORIES TAB
// ============================================
function ProductCategoriesTab() {
  const productData = useFilteredProductData();
  // Use normalized brand data for margin calculations
  const brandData = useNormalizedBrandDataCompat();
  const { brandMappings } = useAppStore();

  // Create a lookup map from brand name (alias) to product type
  // Uses v2 brand mappings structure: { "Canonical Brand": { aliases: { "ALIAS": "PRODUCT_TYPE" } } }
  const brandToProductType = useMemo(() => {
    const map: Record<string, string> = {};
    const safeMappings = brandMappings || {};
    for (const [canonicalBrand, entry] of Object.entries(safeMappings)) {
      if (entry?.aliases) {
        for (const [alias, productType] of Object.entries(entry.aliases)) {
          // Map both the alias and canonical brand to product type
          map[alias.toUpperCase()] = productType;
        }
        // Also map the canonical brand name itself (use first alias's product type)
        const firstProductType = Object.values(entry.aliases)[0];
        if (firstProductType) {
          map[canonicalBrand.toUpperCase()] = firstProductType;
        }
      }
    }
    return map;
  }, [brandMappings]);

  // Calculate margin data from brand data using the brand-to-product-type mapping
  // This gives us accurate margin % per product category
  const marginByProductType = useMemo(() => {
    const categoryMargins: Record<string, { sales: number; marginWeightedSum: number }> = {};

    for (const brand of brandData) {
      // Look up the product type for this brand
      const productType = brandToProductType[brand.brand.toUpperCase()];
      if (productType && brand.gross_margin_pct > 0) {
        if (!categoryMargins[productType]) {
          categoryMargins[productType] = { sales: 0, marginWeightedSum: 0 };
        }
        categoryMargins[productType].sales += brand.net_sales;
        categoryMargins[productType].marginWeightedSum += brand.gross_margin_pct * brand.net_sales;
      }
    }

    // Calculate weighted average margin per product type
    const result: Record<string, number> = {};
    for (const [productType, data] of Object.entries(categoryMargins)) {
      result[productType] = data.sales > 0 ? data.marginWeightedSum / data.sales : 0;
    }
    return result;
  }, [brandData, brandToProductType]);

  // Check if we have margin data available (from brand mappings)
  const hasMarginData = useMemo(() => {
    return Object.keys(marginByProductType).length > 0;
  }, [marginByProductType]);

  // Calculate total sales for percentage calculations
  const totalSales = useMemo(() => {
    return productData.reduce((sum, p) => sum + p.net_sales, 0);
  }, [productData]);

  // Aggregate sales by product type (category) - combines across stores
  // Uses margin data from brand mappings when available
  const aggregatedCategoryData = useMemo(() => {
    const categoryTotals: Record<string, { sales: number }> = {};

    for (const product of productData) {
      if (product.product_type) {
        const category = product.product_type.trim().toUpperCase();
        if (!categoryTotals[category]) {
          categoryTotals[category] = { sales: 0 };
        }
        categoryTotals[category].sales += product.net_sales;
      }
    }

    return Object.entries(categoryTotals)
      .map(([name, data]) => ({
        name,
        value: data.sales,
        // Get margin from brand data mapping, default to 0 if not available
        margin: marginByProductType[name] || 0,
        // Calculate percentage of total sales
        pctOfSales: totalSales > 0 ? (data.sales / totalSales) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [productData, totalSales, marginByProductType]);

  // Data for pie chart - all categories
  const productCategoryData = useMemo(() => {
    return aggregatedCategoryData.map(({ name, value }) => ({ name, value }));
  }, [aggregatedCategoryData]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <SectionLabel>Category Mix</SectionLabel>
          <SectionTitle>Revenue by Product Type</SectionTitle>
          {productCategoryData.length > 0 ? (
            <div className="h-[400px]">
              <CategoryPieChart data={productCategoryData} />
            </div>
          ) : (
            <div className="h-[400px] flex items-center justify-center text-[var(--muted)]">
              No product data available.
            </div>
          )}
        </Card>

        <Card>
          <SectionLabel>Category Details</SectionLabel>
          <SectionTitle>Product Performance</SectionTitle>
          {aggregatedCategoryData.length > 0 ? (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {aggregatedCategoryData.map((cat, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 bg-[var(--paper)] rounded"
                >
                  <div>
                    <span className="font-medium text-[var(--ink)]">{cat.name}</span>
                    <p className="text-xs text-[var(--muted)]">
                      {cat.pctOfSales.toFixed(1)}% of sales
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-[var(--ink)]">
                      ${cat.value.toLocaleString()}
                    </p>
                    {hasMarginData && (
                      <p className="text-xs text-[var(--muted)]">
                        {cat.margin.toFixed(1)}% margin
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[400px] flex items-center justify-center text-[var(--muted)]">
              No product data available.
            </div>
          )}
        </Card>
      </div>

      {/* Full Product Table - shows aggregated categories */}
      {aggregatedCategoryData.length > 0 && (
        <Card>
          <SectionLabel>All Categories</SectionLabel>
          <SectionTitle>Complete Product Performance</SectionTitle>
          <DataTable
            data={aggregatedCategoryData}
            columns={[
              { key: 'name', label: 'Product Type', sortable: true },
              { key: 'pctOfSales', label: '% of Sales', sortable: true, align: 'right', render: (v) => `${Number(v).toFixed(1)}%` },
              { key: 'value', label: 'Net Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
              ...(hasMarginData ? [{ key: 'margin' as const, label: 'Margin %', sortable: true, align: 'right' as const, render: (v: unknown) => `${Number(v).toFixed(1)}%` }] : []),
            ]}
            pageSize={15}
            exportable
            exportFilename="product_categories"
          />
        </Card>
      )}
    </div>
  );
}

// ============================================
// DAILY BREAKDOWN TAB
// ============================================
function DailyBreakdownTab() {
  const salesData = useFilteredSalesData();
  const [storeFilter, setStoreFilter] = useState<'all' | 'grass_roots' | 'barbary_coast'>('all');

  // Group by day of week
  const dayOfWeekData = useMemo(() => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byDay: Record<string, { total: number; count: number }> = {};

    for (const day of days) {
      byDay[day] = { total: 0, count: 0 };
    }

    for (const record of salesData) {
      const date = new Date(record.date);
      const dayName = days[date.getDay()];
      byDay[dayName].total += record.net_sales;
      byDay[dayName].count++;
    }

    return days.map((day) => ({
      day,
      avgSales: byDay[day].count > 0 ? byDay[day].total / byDay[day].count : 0,
      totalSales: byDay[day].total,
    }));
  }, [salesData]);

  // Bar chart data for day of week
  const barChartData = useMemo(() => {
    return dayOfWeekData.map((d) => ({
      name: d.day.slice(0, 3),
      value: d.avgSales,
    }));
  }, [dayOfWeekData]);

  // Filter data by store for the table
  const filteredTableData = useMemo(() => {
    if (storeFilter === 'all') return salesData;
    return salesData.filter((record) => record.store_id === storeFilter);
  }, [salesData, storeFilter]);

  // Format table data with readable dates
  const formattedTableData = useMemo(() => {
    return filteredTableData.map((record) => ({
      ...record,
      formatted_date: format(new Date(record.date), 'MMM d, yyyy'),
    }));
  }, [filteredTableData]);

  // Check if we should show store column (when "all" is selected and both stores have data)
  const showStoreColumn = useMemo(() => {
    if (storeFilter !== 'all') return false;
    const stores = new Set(salesData.map((r) => r.store_id));
    return stores.size > 1;
  }, [salesData, storeFilter]);

  // Build columns dynamically
  const tableColumns = useMemo(() => {
    const cols: Array<{
      key: keyof typeof formattedTableData[0];
      label: string;
      sortable?: boolean;
      align?: 'left' | 'right' | 'center';
      render?: (value: unknown, row: typeof formattedTableData[0]) => React.ReactNode;
    }> = [
      { key: 'formatted_date', label: 'Date', sortable: true },
    ];

    if (showStoreColumn) {
      cols.push({ key: 'store', label: 'Store', sortable: true });
    }

    cols.push(
      { key: 'net_sales', label: 'Net Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
      { key: 'tickets_count', label: 'Transactions', sortable: true, align: 'right' },
      { key: 'customers_count', label: 'Customers', sortable: true, align: 'right' },
      { key: 'avg_order_value', label: 'AOV', sortable: true, align: 'right', render: (v) => `$${Number(v).toFixed(0)}` },
    );

    return cols;
  }, [showStoreColumn]);

  return (
    <div className="space-y-4 md:space-y-6 md:h-[calc(100vh-220px)] md:flex md:flex-col">
      {/* Side by side layout: Weekly Patterns (left) and Day-by-Day (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-stretch md:flex-1 md:min-h-0">
        {/* Weekly Patterns - Left Side */}
        <Card className="flex flex-col md:min-h-0 md:overflow-hidden">
          <SectionLabel>Weekly Patterns</SectionLabel>
          <SectionTitle>Average Sales by Day of Week</SectionTitle>

          {/* Bar Chart - grows to fill space */}
          <div className="flex-1 min-h-[200px] md:min-h-0 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" vertical={false} />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#6b6b6b', fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#6b6b6b', fontSize: 11 }}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                  width={45}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e0ddd8',
                    borderRadius: '8px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                  }}
                  formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Avg Sales']}
                />
                <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Day cards - compact grid at bottom */}
          <div className="grid grid-cols-7 gap-2 mt-auto">
            {dayOfWeekData.map((d, i) => (
              <div key={i} className="text-center p-2 bg-[var(--paper)] rounded">
                <p className="text-xs text-[var(--muted)] mb-1">{d.day.slice(0, 3)}</p>
                <p className="text-sm font-semibold font-serif">${(d.avgSales / 1000).toFixed(1)}k</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Day-by-Day - Right Side */}
        <Card className="flex flex-col md:min-h-0 md:overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <div>
              <SectionLabel>Day-by-Day</SectionLabel>
              <SectionTitle>Daily Sales Records</SectionTitle>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-[var(--muted)]">Store:</label>
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value as 'all' | 'grass_roots' | 'barbary_coast')}
                className="px-3 py-2 border border-[var(--border)] rounded text-sm"
              >
                <option value="all">All Stores</option>
                <option value="grass_roots">Grass Roots</option>
                <option value="barbary_coast">Barbary Coast</option>
              </select>
            </div>
          </div>
          <div className="flex-1 md:min-h-0 md:overflow-auto">
            <DataTable
              data={formattedTableData}
              columns={tableColumns}
              pageSize={10}
              exportable
              exportFilename="daily_sales"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================
// RAW DATA TAB
// ============================================
function RawDataTab() {
  const salesData = useFilteredSalesData();
  // Use normalized brand data - shows canonical brand names with aggregated metrics
  const brandData = useNormalizedBrandDataCompat();
  const productData = useFilteredProductData();
  const [activeSubTab, setActiveSubTab] = useState<'sales' | 'brands' | 'products'>('sales');

  return (
    <div className="space-y-6">
      {/* Sub-tab selector */}
      <div className="flex gap-2">
        {[
          { key: 'sales', label: 'Sales Data' },
          { key: 'brands', label: 'Brand Data' },
          { key: 'products', label: 'Product Data' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key as 'sales' | 'brands' | 'products')}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              activeSubTab === tab.key
                ? 'bg-[var(--ink)] text-[var(--paper)]'
                : 'bg-[var(--paper)] text-[var(--ink)] border border-[var(--border)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'sales' && (
        <Card>
          <SectionLabel>Raw Data</SectionLabel>
          <SectionTitle>Sales Records</SectionTitle>
          <DataTable
            data={salesData}
            columns={[
              { key: 'date', label: 'Date', sortable: true },
              { key: 'store', label: 'Store', sortable: true },
              { key: 'net_sales', label: 'Net Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
              { key: 'tickets_count', label: 'Transactions', sortable: true, align: 'right' },
              { key: 'customers_count', label: 'Customers', sortable: true, align: 'right' },
            ]}
            pageSize={20}
            exportable
            exportFilename="sales_data"
          />
        </Card>
      )}

      {activeSubTab === 'brands' && (
        <Card>
          <SectionLabel>Raw Data</SectionLabel>
          <SectionTitle>Brand Records</SectionTitle>
          <DataTable
            data={brandData}
            columns={[
              { key: 'brand', label: 'Brand', sortable: true },
              { key: 'net_sales', label: 'Net Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
              { key: 'pct_of_total_net_sales', label: '% of Total', sortable: true, align: 'right', render: (v) => `${Number(v).toFixed(2)}%` },
              { key: 'gross_margin_pct', label: 'Margin %', sortable: true, align: 'right', render: (v) => `${Number(v).toFixed(1)}%` },
              { key: 'store_id', label: 'Store' },
            ]}
            pageSize={20}
            exportable
            exportFilename="brand_data"
          />
        </Card>
      )}

      {activeSubTab === 'products' && (
        <Card>
          <SectionLabel>Raw Data</SectionLabel>
          <SectionTitle>Product Records</SectionTitle>
          <DataTable
            data={productData}
            columns={[
              { key: 'product_type', label: 'Product Type', sortable: true },
              { key: 'net_sales', label: 'Net Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
              { key: 'pct_of_total_net_sales', label: '% of Total', sortable: true, align: 'right', render: (v) => `${Number(v).toFixed(2)}%` },
              { key: 'gross_margin_pct', label: 'Margin %', sortable: true, align: 'right', render: (v) => `${Number(v).toFixed(1)}%` },
              { key: 'store_id', label: 'Store' },
            ]}
            pageSize={20}
            exportable
            exportFilename="product_data"
          />
        </Card>
      )}
    </div>
  );
}

// ============================================
// CUSTOMER ANALYTICS TAB
// ============================================
function CustomerAnalyticsTab() {
  const { customerData } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'segments' | 'ltv' | 'recency' | 'search'>('overview');

  const customerSummary = useMemo(() => {
    return calculateCustomerSummary(customerData);
  }, [customerData]);

  const filteredCustomers = useMemo(() => {
    if (!searchQuery) return [];
    const query = searchQuery.toLowerCase();
    return customerData.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.customer_id.toLowerCase().includes(query)
    ).slice(0, 20);
  }, [customerData, searchQuery]);

  if (customerData.length === 0) {
    return (
      <Card>
        <div className="text-center py-12">
          <Users className="w-12 h-12 mx-auto mb-4 text-[var(--muted)] opacity-50" />
          <SectionTitle>No Customer Data</SectionTitle>
          <p className="text-[var(--muted)]">
            Upload customer data in the Data Center to enable customer analytics.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap justify-center md:justify-start">
        {[
          { key: 'overview', label: 'Overview', icon: BarChart3 },
          { key: 'segments', label: 'Segments', icon: Users },
          { key: 'ltv', label: 'Lifetime Value', icon: DollarSign },
          { key: 'recency', label: 'Recency', icon: Calendar },
          { key: 'search', label: 'Customer Search', icon: Search },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key as typeof activeSubTab)}
            className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded text-sm font-medium transition-colors ${
              activeSubTab === tab.key
                ? 'bg-[var(--ink)] text-[var(--paper)]'
                : 'bg-[var(--paper)] text-[var(--ink)] border border-[var(--border)]'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {activeSubTab === 'overview' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <Users className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Total Customers</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">{customerSummary.totalCustomers.toLocaleString()}</p>
                </div>
              </div>
            </Card>
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <DollarSign className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Avg Lifetime Value</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">${customerSummary.avgLifetimeValue.toFixed(0)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <TrendingUp className="w-5 h-5 text-[var(--success)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">VIP + Whale</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">
                    {customerSummary.segmentBreakdown['VIP'] + customerSummary.segmentBreakdown['Whale']}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <TrendingDown className="w-5 h-5 text-[var(--warning)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">At Risk</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">
                    {customerSummary.recencyBreakdown['Cold'] + customerSummary.recencyBreakdown['Lost']}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Segment Distribution */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <Card>
              <SectionLabel>Value Segments</SectionLabel>
              <SectionTitle>Customer LTV Distribution</SectionTitle>
              <SegmentPieChart data={customerSummary.segmentBreakdown} />
            </Card>
            <Card>
              <SectionLabel>Recency Segments</SectionLabel>
              <SectionTitle>Customer Activity Status</SectionTitle>
              <SegmentPieChart data={customerSummary.recencyBreakdown} />
            </Card>
          </div>
        </>
      )}

      {activeSubTab === 'segments' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <Card>
            <SectionLabel>By Lifetime Value</SectionLabel>
            <SectionTitle>Customer Value Segments</SectionTitle>
            <div className="space-y-3">
              {Object.entries(customerSummary.segmentBreakdown).map(([segment, count]) => (
                <div key={segment} className="flex items-center justify-between p-3 bg-[var(--paper)] rounded">
                  <span className="font-medium">{segment}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold font-serif">{count.toLocaleString()}</span>
                    <span className="text-sm text-[var(--muted)]">
                      ({((count / customerSummary.totalCustomers) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <SectionLabel>By Recency</SectionLabel>
            <SectionTitle>Customer Activity Segments</SectionTitle>
            <div className="space-y-3">
              {Object.entries(customerSummary.recencyBreakdown).map(([segment, count]) => (
                <div key={segment} className="flex items-center justify-between p-3 bg-[var(--paper)] rounded">
                  <span className="font-medium">{segment}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold font-serif">{count.toLocaleString()}</span>
                    <span className="text-sm text-[var(--muted)]">
                      ({((count / customerSummary.totalCustomers) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {activeSubTab === 'ltv' && (
        <Card>
          <SectionLabel>All Customers by Value</SectionLabel>
          <SectionTitle>Lifetime Value Rankings</SectionTitle>
          <p className="text-sm text-[var(--muted)] mb-4">
            Showing all {customerData.length.toLocaleString()} customers sorted by lifetime value. Use pagination to browse.
          </p>
          <DataTable
            data={[...customerData].sort((a, b) => b.lifetime_net_sales - a.lifetime_net_sales)}
            columns={[
              { key: 'name', label: 'Name', sortable: true },
              { key: 'lifetime_net_sales', label: 'Lifetime Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
              { key: 'lifetime_visits', label: 'Visits', sortable: true, align: 'right' },
              { key: 'lifetime_aov', label: 'Avg Order', sortable: true, align: 'right', render: (v) => `$${Number(v).toFixed(0)}` },
              { key: 'customer_segment', label: 'Segment' },
              { key: 'recency_segment', label: 'Recency' },
            ]}
            pageSize={25}
            exportable
            exportFilename="all_customers_by_ltv"
          />
        </Card>
      )}

      {activeSubTab === 'recency' && (
        <Card>
          <SectionLabel>At-Risk Customers</SectionLabel>
          <SectionTitle>Cold & Lost Customers (All Values)</SectionTitle>
          <p className="text-sm text-[var(--muted)] mb-4">
            Showing all Cold and Lost customers sorted by lifetime value. These customers haven't visited recently.
          </p>
          <DataTable
            data={customerData
              .filter((c) => c.recency_segment === 'Cold' || c.recency_segment === 'Lost')
              .sort((a, b) => b.lifetime_net_sales - a.lifetime_net_sales)}
            columns={[
              { key: 'name', label: 'Name', sortable: true },
              { key: 'last_visit_date', label: 'Last Visit', sortable: true },
              { key: 'lifetime_net_sales', label: 'Lifetime Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
              { key: 'lifetime_visits', label: 'Visits', sortable: true, align: 'right' },
              { key: 'customer_segment', label: 'Value Segment' },
              { key: 'recency_segment', label: 'Status' },
            ]}
            pageSize={25}
            exportable
            exportFilename="at_risk_customers"
          />
        </Card>
      )}

      {activeSubTab === 'search' && (
        <Card>
          <SectionLabel>Customer Lookup</SectionLabel>
          <SectionTitle>Search Customers</SectionTitle>
          <div className="relative mb-6">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or customer ID..."
              className="w-full pl-10 pr-4 py-3 border border-[var(--border)] rounded text-sm"
            />
          </div>
          {filteredCustomers.length > 0 ? (
            <DataTable
              data={filteredCustomers}
              columns={[
                { key: 'customer_id', label: 'ID', sortable: true },
                { key: 'name', label: 'Name', sortable: true },
                { key: 'store_name', label: 'Store' },
                { key: 'lifetime_net_sales', label: 'Lifetime Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
                { key: 'lifetime_visits', label: 'Visits', sortable: true, align: 'right' },
                { key: 'last_visit_date', label: 'Last Visit', sortable: true },
                { key: 'customer_segment', label: 'Segment' },
              ]}
              pageSize={20}
            />
          ) : searchQuery ? (
            <p className="text-center text-[var(--muted)] py-8">No customers found matching "{searchQuery}"</p>
          ) : (
            <p className="text-center text-[var(--muted)] py-8">Enter a search term to find customers</p>
          )}
        </Card>
      )}
    </div>
  );
}

// ============================================
// BUDTENDER ANALYTICS TAB
// ============================================
function BudtenderAnalyticsTab() {
  const { budtenderData, selectedStore, permanentEmployees } = useAppStore();
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'rankings' | 'details'>('overview');
  const [showAllEmployees, setShowAllEmployees] = useState(false);

  // Get count of permanent employees
  const permanentEmployeeCount = Object.keys(permanentEmployees).length;

  // Filter by permanent employees and selected store
  const filteredBudtenders = useMemo(() => {
    let filtered = budtenderData;

    // Filter by permanent employees only (unless showing all or none assigned)
    if (!showAllEmployees && permanentEmployeeCount > 0) {
      filtered = filtered.filter(b => {
        const assignedStore = permanentEmployees[b.employee_name];
        // Include if employee is assigned to any store
        return assignedStore !== undefined;
      });
    }

    // Filter by selected store
    if (selectedStore !== 'combined') {
      if (!showAllEmployees && permanentEmployeeCount > 0) {
        // Only show employees assigned to this specific store
        filtered = filtered.filter(b => permanentEmployees[b.employee_name] === selectedStore);
      } else {
        // Filter by store_id in the data
        filtered = filtered.filter(b => b.store_id === selectedStore);
      }
    }

    return filtered;
  }, [budtenderData, selectedStore, permanentEmployees, showAllEmployees, permanentEmployeeCount]);

  // Aggregate budtender performance
  const budtenderSummary = useMemo(() => {
    const byEmployee: Record<string, {
      name: string;
      store: string;
      totalSales: number;
      totalTransactions: number;
      totalCustomers: number;
      totalUnits: number;
      marginSum: number;
      dayCount: number;
    }> = {};

    for (const record of filteredBudtenders) {
      const key = `${record.employee_name}_${record.store}`;
      if (!byEmployee[key]) {
        byEmployee[key] = {
          name: record.employee_name,
          store: record.store,
          totalSales: 0,
          totalTransactions: 0,
          totalCustomers: 0,
          totalUnits: 0,
          marginSum: 0,
          dayCount: 0,
        };
      }
      byEmployee[key].totalSales += record.net_sales;
      byEmployee[key].totalTransactions += record.tickets_count; // Use actual transaction count
      byEmployee[key].totalCustomers += record.customers_count;
      byEmployee[key].totalUnits += record.units_sold;
      byEmployee[key].marginSum += record.gross_margin_pct;
      byEmployee[key].dayCount++;
    }

    return Object.values(byEmployee)
      .map(e => ({
        ...e,
        avgMargin: e.dayCount > 0 ? e.marginSum / e.dayCount : 0,
        avgOrderValue: e.totalTransactions > 0 ? e.totalSales / e.totalTransactions : 0,
        avgUnitsPerTransaction: e.totalTransactions > 0 ? e.totalUnits / e.totalTransactions : 0,
      }))
      .sort((a, b) => b.totalSales - a.totalSales);
  }, [filteredBudtenders]);

  // Top performers
  const topBySales = budtenderSummary.slice(0, 10);
  const topByMargin = [...budtenderSummary].sort((a, b) => b.avgMargin - a.avgMargin).slice(0, 10);
  const topByTransactions = [...budtenderSummary].sort((a, b) => b.totalTransactions - a.totalTransactions).slice(0, 10);

  if (budtenderData.length === 0) {
    return (
      <Card>
        <div className="text-center py-12">
          <User className="w-12 h-12 mx-auto mb-4 text-[var(--muted)] opacity-50" />
          <SectionTitle>No Budtender Data</SectionTitle>
          <p className="text-[var(--muted)]">
            Budtender performance data is loading or not available.
          </p>
        </div>
      </Card>
    );
  }

  // Check if we have permanent employees but none match current filter
  const hasPermanentButNoMatch = permanentEmployeeCount > 0 && filteredBudtenders.length === 0 && !showAllEmployees;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Filter Controls - stacked on mobile, side-by-side on desktop */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
        {/* Sub-tabs */}
        <div className="flex gap-2 justify-center md:justify-start">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'rankings', label: 'Rankings' },
            { key: 'details', label: 'All Data' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key as typeof activeSubTab)}
              className={`px-3 md:px-4 py-2 rounded text-sm font-medium transition-colors ${
                activeSubTab === tab.key
                  ? 'bg-[var(--ink)] text-[var(--paper)]'
                  : 'bg-[var(--paper)] text-[var(--ink)] border border-[var(--border)]'
              }`}
            >
              {tab.label}
          </button>
        ))}
        </div>

        {/* Employee count status - centered on mobile */}
        <div className="text-center md:hidden">
          {permanentEmployeeCount > 0 && (
            <span className="text-sm text-[var(--muted)]">
              Showing {showAllEmployees ? 'all employees' : `${permanentEmployeeCount} permanent employees`}
            </span>
          )}
          {permanentEmployeeCount === 0 && (
            <span className="text-sm text-[var(--warning)]">
              No permanent employees assigned
            </span>
          )}
        </div>

        {/* Permanent Employee Toggle */}
        <div className="flex items-center justify-center md:justify-end gap-4">
          {/* Desktop-only status text */}
          <span className="hidden md:inline text-sm text-[var(--muted)]">
            {permanentEmployeeCount > 0
              ? (showAllEmployees ? 'Showing all employees' : `Showing ${permanentEmployeeCount} permanent employees`)
              : ''}
          </span>
          {permanentEmployeeCount === 0 && (
            <span className="hidden md:inline text-sm text-[var(--warning)]">
              No permanent employees assigned
            </span>
          )}
          <label className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showAllEmployees}
              onChange={(e) => setShowAllEmployees(e.target.checked)}
              className="rounded"
            />
            <span className="hidden sm:inline">Show all employees</span>
            <span className="sm:hidden">Show all</span>
          </label>
        </div>
      </div>

      {/* No matching employees warning */}
      {hasPermanentButNoMatch && (
        <Card className="bg-[var(--warning)]/10 border-[var(--warning)]/30">
          <div className="flex items-center gap-3 p-2">
            <AlertCircle className="w-5 h-5 text-[var(--warning)]" />
            <p className="text-sm">
              No permanent employees are assigned to this store. Toggle "Show all employees" or assign employees in Data Center.
            </p>
          </div>
        </Card>
      )}

      {activeSubTab === 'overview' && (
        <>
          {/* KPI Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <User className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Total Budtenders</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">{budtenderSummary.length}</p>
                </div>
              </div>
            </Card>
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <DollarSign className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Total Sales</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">
                    ${budtenderSummary.reduce((sum, b) => sum + b.totalSales, 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <ShoppingCart className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Transactions</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">
                    {budtenderSummary.reduce((sum, b) => sum + b.totalTransactions, 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <Percent className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Avg Margin</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">
                    {budtenderSummary.length > 0
                      ? (budtenderSummary.reduce((sum, b) => sum + b.avgMargin, 0) / budtenderSummary.length).toFixed(1)
                      : 0}%
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Top Performers - stack vertically on mobile */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            <Card>
              <SectionLabel>Revenue Leaders</SectionLabel>
              <SectionTitle>Top by Sales</SectionTitle>
              <div className="space-y-2">
                {topBySales.slice(0, 5).map((b, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-[var(--paper)] rounded">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 flex items-center justify-center bg-[var(--accent)] text-white rounded-full text-xs font-bold">
                        {i + 1}
                      </span>
                      <span className="font-medium text-sm">{b.name}</span>
                    </div>
                    <span className="font-semibold text-sm">${b.totalSales.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionLabel>Margin Champions</SectionLabel>
              <SectionTitle>Top by Margin %</SectionTitle>
              <div className="space-y-2">
                {topByMargin.slice(0, 5).map((b, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-[var(--paper)] rounded">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 flex items-center justify-center bg-[var(--success)] text-white rounded-full text-xs font-bold">
                        {i + 1}
                      </span>
                      <span className="font-medium text-sm">{b.name}</span>
                    </div>
                    <span className="font-semibold text-sm">{b.avgMargin.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionLabel>Volume Leaders</SectionLabel>
              <SectionTitle>Top by Transactions</SectionTitle>
              <div className="space-y-2">
                {topByTransactions.slice(0, 5).map((b, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-[var(--paper)] rounded">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 flex items-center justify-center bg-[var(--warning)] text-white rounded-full text-xs font-bold">
                        {i + 1}
                      </span>
                      <span className="font-medium text-sm">{b.name}</span>
                    </div>
                    <span className="font-semibold text-sm">{b.totalTransactions.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}

      {activeSubTab === 'rankings' && (
        <Card>
          <SectionLabel>Performance Rankings</SectionLabel>
          <SectionTitle>All Budtenders</SectionTitle>
          <DataTable
            data={budtenderSummary}
            columns={[
              { key: 'name', label: 'Name', sortable: true },
              { key: 'store', label: 'Store', sortable: true },
              { key: 'totalSales', label: 'Total Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
              { key: 'totalTransactions', label: 'Transactions', sortable: true, align: 'right', render: (v) => Number(v).toLocaleString() },
              { key: 'avgOrderValue', label: 'Avg Order', sortable: true, align: 'right', render: (v) => `$${Number(v).toFixed(0)}` },
              { key: 'avgMargin', label: 'Avg Margin', sortable: true, align: 'right', render: (v) => `${Number(v).toFixed(1)}%` },
              { key: 'avgUnitsPerTransaction', label: 'Units/Trans', sortable: true, align: 'right', render: (v) => Number(v).toFixed(1) },
            ]}
            pageSize={20}
            exportable
            exportFilename="budtender_rankings"
          />
        </Card>
      )}

      {activeSubTab === 'details' && (
        <Card>
          <SectionLabel>Raw Data</SectionLabel>
          <SectionTitle>Daily Budtender Records</SectionTitle>
          <DataTable
            data={filteredBudtenders}
            columns={[
              { key: 'date', label: 'Date', sortable: true },
              { key: 'employee_name', label: 'Employee', sortable: true },
              { key: 'store', label: 'Store', sortable: true },
              { key: 'net_sales', label: 'Net Sales', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString()}` },
              { key: 'tickets_count', label: 'Tickets', sortable: true, align: 'right' },
              { key: 'customers_count', label: 'Customers', sortable: true, align: 'right' },
              { key: 'gross_margin_pct', label: 'Margin %', sortable: true, align: 'right', render: (v) => `${Number(v).toFixed(1)}%` },
              { key: 'avg_order_value', label: 'AOV', sortable: true, align: 'right', render: (v) => `$${Number(v).toFixed(0)}` },
            ]}
            pageSize={20}
            exportable
            exportFilename="budtender_daily_data"
          />
        </Card>
      )}
    </div>
  );
}

// ============================================
// INVOICE ANALYTICS TAB
// ============================================
const INVOICE_PIE_COLORS = ['#3d5a4c', '#7a9b8a', '#a8c4b8', '#d4e4dc', '#e8f0ec', '#95b3a6', '#6b9680', '#4a7a5f'];

function InvoiceAnalyticsTab() {
  const { invoiceData, dataStatus } = useAppStore();
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'top-products' | 'by-type' | 'all-data'>('overview');

  // Filter out invalid entries (null, Unknown, empty product types)
  const validInvoiceData = useMemo(() => {
    return invoiceData.filter(item => {
      const productType = item.product_type?.trim().toLowerCase();
      const productName = item.product_name?.trim();
      // Exclude null, undefined, empty, or "unknown" product types
      if (!productType || productType === 'unknown' || productType === 'null' || productType === '') {
        return false;
      }
      // Exclude items without a product name
      if (!productName || productName.toLowerCase() === 'unknown') {
        return false;
      }
      return true;
    });
  }, [invoiceData]);

  // Filter to last 12 months
  const twelveMonthsAgo = useMemo(() => subMonths(new Date(), 12), []);

  // Note: Invoice data may not have dates, so we'll use all valid data
  // In future, if invoice_date is added, filter here

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalLineItems = validInvoiceData.length;
    const totalUnits = validInvoiceData.reduce((sum, item) => sum + (item.sku_units || 0), 0);
    const totalCost = validInvoiceData.reduce((sum, item) => sum + (item.total_cost || 0), 0);
    const uniqueInvoices = new Set(validInvoiceData.map(item => item.invoice_id)).size;
    const avgUnitCost = totalUnits > 0 ? totalCost / totalUnits : 0;

    return { totalLineItems, totalUnits, totalCost, uniqueInvoices, avgUnitCost };
  }, [validInvoiceData]);

  // Top products by volume (units purchased)
  const topProductsByVolume = useMemo(() => {
    const productMap: Record<string, { name: string; units: number; cost: number; invoiceCount: number }> = {};

    for (const item of validInvoiceData) {
      const name = item.product_name.trim();
      if (!productMap[name]) {
        productMap[name] = { name, units: 0, cost: 0, invoiceCount: 0 };
      }
      productMap[name].units += item.sku_units || 0;
      productMap[name].cost += item.total_cost || 0;
      productMap[name].invoiceCount += 1;
    }

    return Object.values(productMap)
      .sort((a, b) => b.units - a.units)
      .slice(0, 50)
      .map((p, idx) => ({
        ...p,
        rank: idx + 1,
        avgCostPerUnit: p.units > 0 ? p.cost / p.units : 0,
      }));
  }, [validInvoiceData]);

  // Top products by spend
  const topProductsBySpend = useMemo(() => {
    const productMap: Record<string, { name: string; units: number; cost: number }> = {};

    for (const item of validInvoiceData) {
      const name = item.product_name.trim();
      if (!productMap[name]) {
        productMap[name] = { name, units: 0, cost: 0 };
      }
      productMap[name].units += item.sku_units || 0;
      productMap[name].cost += item.total_cost || 0;
    }

    return Object.values(productMap)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 20);
  }, [validInvoiceData]);

  // Breakdown by product type
  const productTypeBreakdown = useMemo(() => {
    const typeMap: Record<string, { type: string; units: number; cost: number; lineItems: number }> = {};

    for (const item of validInvoiceData) {
      const type = item.product_type.trim().toUpperCase();
      if (!typeMap[type]) {
        typeMap[type] = { type, units: 0, cost: 0, lineItems: 0 };
      }
      typeMap[type].units += item.sku_units || 0;
      typeMap[type].cost += item.total_cost || 0;
      typeMap[type].lineItems += 1;
    }

    return Object.values(typeMap)
      .sort((a, b) => b.cost - a.cost)
      .map(t => ({
        ...t,
        pctOfSpend: summaryStats.totalCost > 0 ? (t.cost / summaryStats.totalCost) * 100 : 0,
        pctOfUnits: summaryStats.totalUnits > 0 ? (t.units / summaryStats.totalUnits) * 100 : 0,
      }));
  }, [validInvoiceData, summaryStats]);

  // Pie chart data for product types
  const typesPieData = useMemo(() => {
    return productTypeBreakdown.slice(0, 8).map(t => ({
      name: t.type,
      value: t.cost,
    }));
  }, [productTypeBreakdown]);

  // Bar chart data for top 10 products
  const topProductsBarData = useMemo(() => {
    return topProductsByVolume.slice(0, 10).map(p => ({
      name: p.name.length > 20 ? p.name.slice(0, 20) + '...' : p.name,
      units: p.units,
      cost: p.cost,
    }));
  }, [topProductsByVolume]);

  if (!dataStatus.invoices.loaded) {
    return (
      <Card>
        <div className="text-center py-12">
          <FileText className="w-12 h-12 mx-auto mb-4 text-[var(--muted)] opacity-50 animate-pulse" />
          <SectionTitle>Loading Invoice Data</SectionTitle>
          <p className="text-[var(--muted)]">
            Invoice data is being loaded from the database...
          </p>
        </div>
      </Card>
    );
  }

  if (validInvoiceData.length === 0) {
    return (
      <Card>
        <div className="text-center py-12">
          <FileText className="w-12 h-12 mx-auto mb-4 text-[var(--muted)] opacity-50" />
          <SectionTitle>No Invoice Data</SectionTitle>
          <p className="text-[var(--muted)]">
            No valid invoice data found. Upload invoices in the Data Center.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap justify-center md:justify-start">
        {[
          { key: 'overview', label: 'Overview', icon: BarChart3 },
          { key: 'top-products', label: 'Top Products', icon: Package },
          { key: 'by-type', label: 'By Category', icon: Tag },
          { key: 'all-data', label: 'All Data', icon: FileText },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key as typeof activeSubTab)}
            className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded text-sm font-medium transition-colors ${
              activeSubTab === tab.key
                ? 'bg-[var(--ink)] text-[var(--paper)]'
                : 'bg-[var(--paper)] text-[var(--ink)] border border-[var(--border)]'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {activeSubTab === 'overview' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <FileText className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Total Invoices</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">{summaryStats.uniqueInvoices.toLocaleString()}</p>
                </div>
              </div>
            </Card>
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <Package className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Units Purchased</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">{summaryStats.totalUnits.toLocaleString()}</p>
                </div>
              </div>
            </Card>
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <DollarSign className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Total Spend</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">${summaryStats.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
              </div>
            </Card>
            <Card className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
                <Tag className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)] truncate">Avg Unit Cost</p>
                  <p className="text-lg md:text-xl font-semibold font-serif">${summaryStats.avgUnitCost.toFixed(2)}</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <Card>
              <SectionLabel>Purchase Volume</SectionLabel>
              <SectionTitle>Top 10 Products by Units</SectionTitle>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProductsBarData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" horizontal={true} vertical={false} />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#6b6b6b', fontSize: 11 }} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={120}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#6b6b6b', fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e0ddd8',
                        borderRadius: '8px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                      }}
                      formatter={(value) => [typeof value === 'number' ? value.toLocaleString() : '0', 'Units']}
                    />
                    <Bar dataKey="units" fill="var(--accent)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <SectionLabel>Spend Distribution</SectionLabel>
              <SectionTitle>Spend by Product Category</SectionTitle>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={typesPieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      outerRadius={120}
                      fill="var(--accent)"
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {typesPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={INVOICE_PIE_COLORS[index % INVOICE_PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e0ddd8',
                        borderRadius: '8px',
                      }}
                      formatter={(value) => [`$${typeof value === 'number' ? value.toLocaleString() : '0'}`, 'Spend']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Top Products Table */}
          <Card>
            <SectionLabel>Most Purchased</SectionLabel>
            <SectionTitle>Top 20 Products by Spend</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              {topProductsBySpend.slice(0, 10).map((product, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-[var(--paper)] rounded">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 flex items-center justify-center bg-[var(--accent)] text-white rounded-full text-xs font-bold">
                      {i + 1}
                    </span>
                    <span className="font-medium text-sm truncate max-w-[180px]">{product.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">${product.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    <p className="text-xs text-[var(--muted)]">{product.units.toLocaleString()} units</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {activeSubTab === 'top-products' && (
        <Card>
          <SectionLabel>Purchase Rankings</SectionLabel>
          <SectionTitle>Top Products by Volume (All Time)</SectionTitle>
          <p className="text-sm text-[var(--muted)] mb-4">
            Products ranked by total units purchased. Excludes unknown and invalid product types.
          </p>
          <DataTable
            data={topProductsByVolume}
            columns={[
              { key: 'rank', label: '#', sortable: true, align: 'center' },
              { key: 'name', label: 'Product Name', sortable: true },
              { key: 'units', label: 'Units Purchased', sortable: true, align: 'right', render: (v) => Number(v).toLocaleString() },
              { key: 'cost', label: 'Total Spend', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
              { key: 'avgCostPerUnit', label: 'Avg Cost/Unit', sortable: true, align: 'right', render: (v) => `$${Number(v).toFixed(2)}` },
              { key: 'invoiceCount', label: 'Line Items', sortable: true, align: 'right' },
            ]}
            pageSize={25}
            exportable
            exportFilename="top_products_by_volume"
          />
        </Card>
      )}

      {activeSubTab === 'by-type' && (
        <>
          <Card>
            <SectionLabel>Category Analysis</SectionLabel>
            <SectionTitle>Purchases by Product Type</SectionTitle>
            <p className="text-sm text-[var(--muted)] mb-4">
              Breakdown of purchasing by product category. Excludes unknown and invalid types.
            </p>
            <DataTable
              data={productTypeBreakdown}
              columns={[
                { key: 'type', label: 'Product Type', sortable: true },
                { key: 'units', label: 'Units', sortable: true, align: 'right', render: (v) => Number(v).toLocaleString() },
                { key: 'pctOfUnits', label: '% of Units', sortable: true, align: 'right', render: (v) => `${Number(v).toFixed(1)}%` },
                { key: 'cost', label: 'Total Spend', sortable: true, align: 'right', render: (v) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                { key: 'pctOfSpend', label: '% of Spend', sortable: true, align: 'right', render: (v) => `${Number(v).toFixed(1)}%` },
                { key: 'lineItems', label: 'Line Items', sortable: true, align: 'right' },
              ]}
              pageSize={20}
              exportable
              exportFilename="purchases_by_type"
            />
          </Card>

          {/* Visual breakdown cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {productTypeBreakdown.slice(0, 6).map((type, i) => (
              <Card key={i} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-[var(--ink)]">{type.type}</span>
                  <span className="text-sm text-[var(--muted)]">{type.pctOfSpend.toFixed(1)}% of spend</span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Units Purchased</span>
                    <span className="font-medium">{type.units.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Total Spend</span>
                    <span className="font-medium">${type.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Avg Cost/Unit</span>
                    <span className="font-medium">${(type.cost / type.units).toFixed(2)}</span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="mt-3 h-2 bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] rounded-full"
                    style={{ width: `${type.pctOfSpend}%` }}
                  />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {activeSubTab === 'all-data' && (
        <Card>
          <SectionLabel>Raw Invoice Data</SectionLabel>
          <SectionTitle>All Line Items</SectionTitle>
          <p className="text-sm text-[var(--muted)] mb-4">
            Showing {validInvoiceData.length.toLocaleString()} valid line items (excluding unknown/invalid entries).
          </p>
          <DataTable
            data={validInvoiceData}
            columns={[
              { key: 'invoice_id', label: 'Invoice', sortable: true },
              { key: 'product_name', label: 'Product', sortable: true },
              { key: 'product_type', label: 'Type', sortable: true },
              { key: 'sku_units', label: 'Units', sortable: true, align: 'right' },
              { key: 'unit_cost', label: 'Unit Cost', sortable: true, align: 'right', render: (v) => `$${Number(v).toFixed(2)}` },
              { key: 'total_cost', label: 'Total', sortable: true, align: 'right', render: (v) => `$${Number(v).toFixed(2)}` },
            ]}
            pageSize={25}
            exportable
            exportFilename="invoice_line_items"
          />
        </Card>
      )}
    </div>
  );
}

// ============================================
// MAIN SALES ANALYTICS PAGE
// ============================================
export const SalesAnalyticsPage = memo(function SalesAnalyticsPage() {
  // All 8 tabs - using render functions for lazy loading (only renders when tab is active)
  const tabs = [
    {
      id: 'trends',
      label: 'Sales Trends',
      render: () => <SalesTrendsTab />,
    },
    {
      id: 'brands',
      label: 'Brand Performance',
      render: () => <BrandPerformanceTab />,
    },
    {
      id: 'categories',
      label: 'Product Categories',
      render: () => <ProductCategoriesTab />,
    },
    {
      id: 'daily',
      label: 'Daily Breakdown',
      render: () => <DailyBreakdownTab />,
    },
    {
      id: 'raw',
      label: 'Raw Data',
      render: () => <RawDataTab />,
    },
    {
      id: 'customers',
      label: 'Customer Analytics',
      render: () => <CustomerAnalyticsTab />,
    },
    {
      id: 'budtenders',
      label: 'Budtender Analytics',
      render: () => <BudtenderAnalyticsTab />,
    },
    {
      id: 'invoices',
      label: 'Invoice Analytics',
      render: () => <InvoiceAnalyticsTab />,
    },
  ];

  return (
    <div>
      <Header title="Sales Performance Analysis" subtitle="Sales Analytics" />
      <Tabs tabs={tabs} />
    </div>
  );
});
