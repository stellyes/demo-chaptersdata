'use client';

import { useMemo } from 'react';
import { DollarSign, Target, TrendingUp, Activity } from 'lucide-react';
import { Header } from '@/components/ui/Header';
import { MetricCard } from '@/components/ui/MetricCard';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SalesChart, TransactionChart } from '@/components/charts/SalesChart';
import { CategoryPieChart } from '@/components/charts/PieChart';
import { useAppStore, useFilteredSalesData, useFilteredBrandData, useFilteredProductData } from '@/store/app-store';
import { calculateSalesSummary } from '@/lib/services/data-processor';
import { format } from 'date-fns';

export function DashboardPage() {
  const { dataStatus } = useAppStore();
  const salesData = useFilteredSalesData();
  const brandData = useFilteredBrandData();
  const productData = useFilteredProductData();

  const summary = useMemo(() => calculateSalesSummary(salesData), [salesData]);

  // Prepare sales chart data
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

  // Prepare transaction count chart data
  const transactionChartData = useMemo(() => {
    const byDate: Record<string, { date: string; grass_roots: number; barbary_coast: number }> = {};

    for (const record of salesData) {
      const dateKey = record.date;
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey, grass_roots: 0, barbary_coast: 0 };
      }
      if (record.store_id === 'grass_roots') {
        byDate[dateKey].grass_roots += record.tickets_count;
      } else if (record.store_id === 'barbary_coast') {
        byDate[dateKey].barbary_coast += record.tickets_count;
      }
    }

    return Object.values(byDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((d) => ({
        ...d,
        date: format(new Date(d.date), 'MMM d'),
      }));
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
      <div className="grid grid-cols-4 gap-6 mb-8">
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
      <div className="grid grid-cols-[2fr_1fr] gap-6 mb-8">
        {/* Sales Trend Chart */}
        <Card>
          <div className="flex items-center justify-between mb-6">
            <div>
              <SectionLabel>Daily Performance</SectionLabel>
              <SectionTitle>Sales Trend</SectionTitle>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#1e391f]"></div>
                <span className="text-[var(--muted)]">Grass Roots</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#3d6b3e]"></div>
                <span className="text-[var(--muted)]">Barbary Coast</span>
              </div>
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
      <div className="grid grid-cols-[2fr_1fr] gap-6 mb-8">
        {/* Transaction Count Chart */}
        <Card>
          <div className="flex items-center justify-between mb-6">
            <div>
              <SectionLabel>Daily Performance</SectionLabel>
              <SectionTitle>Transaction Count</SectionTitle>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#1e391f]"></div>
                <span className="text-[var(--muted)]">Grass Roots</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#3d6b3e]"></div>
                <span className="text-[var(--muted)]">Barbary Coast</span>
              </div>
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
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <SectionLabel>Store Performance</SectionLabel>
          <SectionTitle>Grass Roots SF</SectionTitle>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Revenue</p>
              <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                {formatCurrency(summary.byStore.grass_roots.revenue)}
              </p>
            </div>
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Transactions</p>
              <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                {summary.byStore.grass_roots.transactions.toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Avg Margin</p>
              <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                {summary.byStore.grass_roots.margin.toFixed(1)}%
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <SectionLabel>Store Performance</SectionLabel>
          <SectionTitle>Barbary Coast SF</SectionTitle>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Revenue</p>
              <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                {formatCurrency(summary.byStore.barbary_coast.revenue)}
              </p>
            </div>
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Transactions</p>
              <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                {summary.byStore.barbary_coast.transactions.toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Avg Margin</p>
              <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                {summary.byStore.barbary_coast.margin.toFixed(1)}%
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
