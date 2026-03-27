'use client';

import { useMemo, memo } from 'react';
import { DollarSign, Target, TrendingUp, Activity, Users, User, Award } from 'lucide-react';
import { Header } from '@/components/ui/Header';
import { MetricCard } from '@/components/ui/MetricCard';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SalesChart, TransactionChart } from '@/components/charts/SalesChart';
import { CategoryPieChart } from '@/components/charts/PieChart';
import { useAppStore, useFilteredSalesData, useFilteredProductData, useNormalizedBrandDataCompat, useFilteredCustomerData } from '@/store/app-store';
import { calculateSalesSummary, calculateCustomerSummary } from '@/lib/services/data-processor';
import { needsMarginConversion, normalizeMarginValue } from '@/lib/utils/margin';
import { STORES, getIndividualStoreIds, getStoreColor } from '@/lib/config';
import { format } from 'date-fns';

const storeIds = getIndividualStoreIds();

export const DashboardPage = memo(function DashboardPage() {
  const { dataStatus } = useAppStore();
  const salesData = useFilteredSalesData();
  // Use normalized brand data - consolidates aliases under canonical brand names
  const brandData = useNormalizedBrandDataCompat();
  const productData = useFilteredProductData();
  const { budtenderData: allBudtenderData, selectedStore } = useAppStore();
  // Dashboard shows all budtenders (not filtered by permanent assignment)
  // Only filter by store selection
  const budtenderData = useMemo(() => {
    if (selectedStore === 'combined') return allBudtenderData;
    return allBudtenderData.filter(b => b.store_id === selectedStore);
  }, [allBudtenderData, selectedStore]);
  const customerData = useFilteredCustomerData();

  const summary = useMemo(() => calculateSalesSummary(salesData), [salesData]);
  const customerSummary = useMemo(() => calculateCustomerSummary(customerData), [customerData]);

  // Budtender performance summary
  const budtenderSummary = useMemo(() => {
    if (budtenderData.length === 0) return null;

    // Aggregate by employee
    const byEmployee: Record<string, { sales: number; units: number; margin: number; count: number }> = {};
    for (const record of budtenderData) {
      if (!byEmployee[record.employee_name]) {
        byEmployee[record.employee_name] = { sales: 0, units: 0, margin: 0, count: 0 };
      }
      byEmployee[record.employee_name].sales += record.net_sales;
      byEmployee[record.employee_name].units += record.units_sold;
      byEmployee[record.employee_name].margin += record.gross_margin_pct;
      byEmployee[record.employee_name].count += 1;
    }

    // Calculate averages and find top performers
    const rawMargins = Object.values(byEmployee).map(s => s.count > 0 ? s.margin / s.count : 0);
    const shouldConvertMargins = needsMarginConversion(rawMargins);

    const employees = Object.entries(byEmployee).map(([name, stats]) => {
      const rawAvgMargin = stats.count > 0 ? stats.margin / stats.count : 0;
      return {
        name,
        sales: stats.sales,
        units: stats.units,
        avgMargin: normalizeMarginValue(rawAvgMargin, shouldConvertMargins),
        revenuePerUnit: stats.units > 0 ? stats.sales / stats.units : 0,
      };
    });

    const topBySales = [...employees].sort((a, b) => b.sales - a.sales).slice(0, 5);
    const totalSales = employees.reduce((sum, e) => sum + e.sales, 0);
    const totalUnits = employees.reduce((sum, e) => sum + e.units, 0);

    return {
      totalEmployees: employees.length,
      totalSales,
      totalUnits,
      topBySales,
    };
  }, [budtenderData]);

  // Prepare sales chart data
  const salesChartData = useMemo(() => {
    const byDate: Record<string, Record<string, string | number>> = {};
    for (const record of salesData) {
      const dateKey = record.date;
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey };
        for (const sid of storeIds) byDate[dateKey][sid] = 0;
      }
      if (storeIds.includes(record.store_id)) {
        byDate[dateKey][record.store_id] = (byDate[dateKey][record.store_id] as number) + record.net_sales;
      }
    }
    return Object.values(byDate)
      .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime())
      .map((d) => ({ ...d, date: format(new Date(d.date as string), 'MMM d') }));
  }, [salesData]);

  // Prepare transaction count chart data
  const transactionChartData = useMemo(() => {
    const byDate: Record<string, Record<string, string | number>> = {};
    for (const record of salesData) {
      const dateKey = record.date;
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey };
        for (const sid of storeIds) byDate[dateKey][sid] = 0;
      }
      if (storeIds.includes(record.store_id)) {
        byDate[dateKey][record.store_id] = (byDate[dateKey][record.store_id] as number) + record.tickets_count;
      }
    }
    return Object.values(byDate)
      .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime())
      .map((d) => ({ ...d, date: format(new Date(d.date as string), 'MMM d') }));
  }, [salesData]);

  // Prepare top brands data for pie chart (full brand names)
  const topBrandsData = useMemo(() => {
    const brandTotals: Record<string, number> = {};
    for (const brand of brandData) {
      brandTotals[brand.brand] = (brandTotals[brand.brand] || 0) + brand.net_sales;
    }
    return Object.entries(brandTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [brandData]);

  // Prepare category data for pie chart (from product data)
  const categoryData = useMemo(() => {
    const categoryTotals: Record<string, number> = {};
    for (const product of productData) {
      if (product.product_type) {
        categoryTotals[product.product_type] = (categoryTotals[product.product_type] || 0) + product.net_sales;
      }
    }
    return Object.entries(categoryTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [productData]);

  // Format currency - matches Streamlit format: ${value:,.0f}
  const formatCurrency = (value: number) => {
    return `$${Math.round(value).toLocaleString()}`;
  };

  return (
    <div>
      <Header title="Your Business at a Glance" subtitle="Dashboard" />

      {/* Data Status */}
      {!dataStatus.sales.loaded && (
        <div className="mb-6 p-4 bg-[var(--warning)]/10 border border-[var(--warning)]/20 rounded-lg">
          <p className="text-[var(--warning)] text-sm">
            No sales data loaded. Go to Data Center to upload your data.
          </p>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-6 md:mb-8">
        <MetricCard
          title="Total Net Sales"
          value={formatCurrency(summary.totalRevenue)}
          change={12.5}
          changeType="positive"
          icon={DollarSign}
          subtitle="All time"
        />
        <MetricCard
          title="Total Transactions"
          value={summary.totalTransactions.toLocaleString()}
          change={8.3}
          changeType="positive"
          icon={Activity}
          subtitle="All time"
        />
        <MetricCard
          title="Avg Order Value"
          value={`$${summary.avgOrderValue.toFixed(2)}`}
          change={2.1}
          changeType="positive"
          icon={Target}
          subtitle="Per transaction"
        />
        <MetricCard
          title="Avg Margin"
          value={`${summary.avgMargin.toFixed(1)}%`}
          change={summary.avgMargin > 55 ? 3.2 : -1.5}
          changeType={summary.avgMargin > 55 ? 'positive' : 'negative'}
          icon={TrendingUp}
          subtitle="Gross margin"
        />
      </div>

      {/* Sales Chart Row */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 md:gap-6 mb-6 md:mb-8">
        {/* Sales Trend Chart */}
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 md:mb-6 gap-2">
            <div>
              <SectionLabel>Daily Performance</SectionLabel>
              <SectionTitle>Sales Trend</SectionTitle>
            </div>
            <div className="hidden sm:flex items-center gap-4 md:gap-6 text-sm">
              {storeIds.map((sid) => (
                <div key={sid} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: getStoreColor(sid) }}></div>
                  <span className="text-[var(--muted)]">{STORES[sid]?.name ?? sid}</span>
                </div>
              ))}
            </div>
          </div>
          {salesChartData.length > 0 ? (
            <SalesChart data={salesChartData} showLegend={false} />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-[var(--muted)]">
              No sales data available
            </div>
          )}
        </Card>

        {/* Top Brands Distribution */}
        <Card>
          <SectionLabel>Revenue Mix</SectionLabel>
          <SectionTitle>Top Brands</SectionTitle>
          {topBrandsData.length > 0 ? (
            <CategoryPieChart data={topBrandsData} showLegend={true} />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-[var(--muted)]">
              No brand data available
            </div>
          )}
        </Card>
      </div>

      {/* Transaction Chart Row */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 md:gap-6 mb-6 md:mb-8">
        {/* Transaction Count Chart */}
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 md:mb-6 gap-2">
            <div>
              <SectionLabel>Daily Performance</SectionLabel>
              <SectionTitle>Transaction Count</SectionTitle>
            </div>
            <div className="hidden sm:flex items-center gap-4 md:gap-6 text-sm">
              {storeIds.map((sid) => (
                <div key={sid} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: getStoreColor(sid) }}></div>
                  <span className="text-[var(--muted)]">{STORES[sid]?.name ?? sid}</span>
                </div>
              ))}
            </div>
          </div>
          {transactionChartData.length > 0 ? (
            <TransactionChart data={transactionChartData} showLegend={false} />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-[var(--muted)]">
              No transaction data available
            </div>
          )}
        </Card>

        {/* Category Distribution */}
        <Card>
          <SectionLabel>Revenue Mix</SectionLabel>
          <SectionTitle>By Category</SectionTitle>
          {categoryData.length > 0 ? (
            <CategoryPieChart data={categoryData} showLegend={true} />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-[var(--muted)]">
              No category data available
            </div>
          )}
        </Card>
      </div>

      {/* Store Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {storeIds.map((sid) => {
          const storeData = summary.byStore[sid] || { revenue: 0, transactions: 0, margin: 0 };
          return (
            <Card key={sid}>
              <SectionLabel>Store Performance</SectionLabel>
              <SectionTitle>{STORES[sid]?.displayName ?? sid}</SectionTitle>
              <div className="grid grid-cols-3 gap-2 md:gap-4">
                <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                  <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Revenue</p>
                  <p className="text-base md:text-xl font-semibold text-[var(--ink)] font-serif">
                    {formatCurrency(storeData.revenue)}
                  </p>
                </div>
                <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                  <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Transactions</p>
                  <p className="text-base md:text-xl font-semibold text-[var(--ink)] font-serif">
                    {storeData.transactions.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                  <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Avg Margin</p>
                  <p className="text-base md:text-xl font-semibold text-[var(--ink)] font-serif">
                    {storeData.margin.toFixed(1)}%
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Budtender Performance Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mt-6 md:mt-8">
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <User className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <SectionLabel>Team Performance</SectionLabel>
              <SectionTitle>Top Budtenders</SectionTitle>
            </div>
          </div>
          {budtenderSummary && budtenderSummary.topBySales.length > 0 ? (
            <div className="space-y-3">
              {budtenderSummary.topBySales.map((employee, index) => (
                <div
                  key={employee.name}
                  className="flex items-center justify-between p-3 bg-[var(--paper)] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                      index === 0 ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-[var(--muted)]/10 text-[var(--muted)]'
                    }`}>
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium text-[var(--ink)]">{employee.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {employee.units.toLocaleString()} units sold
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold font-serif text-[var(--ink)]">
                      {formatCurrency(employee.sales)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {employee.avgMargin.toFixed(1)}% margin
                    </p>
                  </div>
                </div>
              ))}
              <div className="pt-3 border-t border-[var(--border)] grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-semibold font-serif">{budtenderSummary.totalEmployees}</p>
                  <p className="text-xs text-[var(--muted)]">Active Staff</p>
                </div>
                <div>
                  <p className="text-lg font-semibold font-serif">{formatCurrency(budtenderSummary.totalSales)}</p>
                  <p className="text-xs text-[var(--muted)]">Total Sales</p>
                </div>
                <div>
                  <p className="text-lg font-semibold font-serif">{budtenderSummary.totalUnits.toLocaleString()}</p>
                  <p className="text-xs text-[var(--muted)]">Units Sold</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-[var(--muted)]">
              <div className="text-center">
                <User className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>No budtender data for selected period</p>
              </div>
            </div>
          )}
        </Card>

        {/* Customer Analytics Section */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <SectionLabel>Customer Insights</SectionLabel>
              <SectionTitle>Active Customers</SectionTitle>
            </div>
          </div>
          {customerSummary.totalCustomers > 0 ? (
            <div className="space-y-4">
              {/* Customer Segment Distribution */}
              <div>
                <p className="text-sm font-medium text-[var(--muted)] mb-2">By Value Segment</p>
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(customerSummary.segmentBreakdown)
                    .filter(([, count]) => count > 0)
                    .slice(0, 5)
                    .map(([segment, count]) => (
                      <div key={segment} className="p-2 bg-[var(--paper)] rounded text-center">
                        <p className="text-lg font-semibold font-serif">{count.toLocaleString()}</p>
                        <p className="text-xs text-[var(--muted)] truncate">{segment}</p>
                      </div>
                    ))}
                </div>
              </div>

              {/* Recency Distribution */}
              <div>
                <p className="text-sm font-medium text-[var(--muted)] mb-2">By Recency</p>
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(customerSummary.recencyBreakdown)
                    .filter(([, count]) => count > 0)
                    .slice(0, 5)
                    .map(([segment, count]) => (
                      <div key={segment} className="p-2 bg-[var(--paper)] rounded text-center">
                        <p className="text-lg font-semibold font-serif">{count.toLocaleString()}</p>
                        <p className="text-xs text-[var(--muted)] truncate">{segment}</p>
                      </div>
                    ))}
                </div>
              </div>

              {/* Summary Stats */}
              <div className="pt-3 border-t border-[var(--border)] grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-semibold font-serif">{customerSummary.totalCustomers.toLocaleString()}</p>
                  <p className="text-xs text-[var(--muted)]">Total Customers</p>
                </div>
                <div>
                  <p className="text-lg font-semibold font-serif">{formatCurrency(customerSummary.avgLifetimeValue)}</p>
                  <p className="text-xs text-[var(--muted)]">Avg LTV</p>
                </div>
                <div>
                  <p className="text-lg font-semibold font-serif">
                    {((customerSummary.segmentBreakdown['VIP'] || 0) + (customerSummary.segmentBreakdown['Whale'] || 0)).toLocaleString()}
                  </p>
                  <p className="text-xs text-[var(--muted)]">VIP/Whale</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-[var(--muted)]">
              <div className="text-center">
                <Users className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>No customer data for selected period</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
});
