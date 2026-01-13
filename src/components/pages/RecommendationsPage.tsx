'use client';

import { useState, useMemo } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { useFilteredSalesData, useFilteredBrandData } from '@/store/app-store';
import { calculateSalesSummary, calculateBrandSummary } from '@/lib/services/data-processor';
import { Sparkles, TrendingUp, ShoppingBag, Users, RefreshCw, Loader2 } from 'lucide-react';

type AnalysisType = 'sales' | 'brands' | 'categories' | 'insights';

export function RecommendationsPage() {
  const salesData = useFilteredSalesData();
  const brandData = useFilteredBrandData();

  const [activeAnalysis, setActiveAnalysis] = useState<AnalysisType | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<AnalysisType, string>>({
    sales: '',
    brands: '',
    categories: '',
    insights: '',
  });
  const [loading, setLoading] = useState(false);

  const salesSummary = useMemo(() => calculateSalesSummary(salesData), [salesData]);
  const brandSummary = useMemo(() => calculateBrandSummary(brandData), [brandData]);

  const runAnalysis = async (type: AnalysisType) => {
    setLoading(true);
    setActiveAnalysis(type);

    try {
      let data: Record<string, unknown> = {};

      switch (type) {
        case 'sales':
          data = {
            totalRevenue: salesSummary.totalRevenue,
            totalTransactions: salesSummary.totalTransactions,
            avgOrderValue: salesSummary.avgOrderValue,
            avgMargin: salesSummary.avgMargin,
            storeComparison: Object.entries(salesSummary.byStore).map(([store, stats]) => ({
              store,
              revenue: stats.revenue,
              margin: stats.margin,
            })),
          };
          break;
        case 'brands':
          data = {
            brandData: brandSummary.topBrands.slice(0, 50).map((b) => ({
              brand: b.brand,
              netSales: b.net_sales,
              margin: b.gross_margin_pct,
              pctOfTotal: b.pct_of_total_net_sales,
            })),
            brandByCategory: brandSummary.byCategory,
          };
          break;
        case 'categories':
          data = {
            categoryData: Object.entries(brandSummary.byCategory).map(([category, brands]) => ({
              category,
              netSales: brands.reduce((sum, b) => sum + b.net_sales, 0),
              brandCount: brands.length,
            })),
            brandSummary: brandSummary.topBrands.slice(0, 30),
          };
          break;
        case 'insights':
          data = {
            salesSummary,
            brandHighlights: {
              topBrands: brandSummary.topBrands.slice(0, 10).map((b) => b.brand),
              lowMarginBrands: brandSummary.lowMarginBrands.slice(0, 5).map((b) => b.brand),
            },
          };
          break;
      }

      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data }),
      });

      const result = await response.json();

      if (result.success) {
        setAnalysisResults((prev) => ({
          ...prev,
          [type]: result.data.analysis,
        }));
      } else {
        setAnalysisResults((prev) => ({
          ...prev,
          [type]: `Error: ${result.error}`,
        }));
      }
    } catch (error) {
      setAnalysisResults((prev) => ({
        ...prev,
        [type]: `Error: ${error instanceof Error ? error.message : 'Analysis failed'}`,
      }));
    } finally {
      setLoading(false);
    }
  };

  const analysisCards = [
    {
      type: 'sales' as AnalysisType,
      title: 'Sales Trends Analysis',
      description: 'Get AI insights on your sales performance and trends',
      icon: TrendingUp,
    },
    {
      type: 'brands' as AnalysisType,
      title: 'Brand Performance Analysis',
      description: 'Recommendations on which brands to stock or discontinue',
      icon: ShoppingBag,
    },
    {
      type: 'categories' as AnalysisType,
      title: 'Category Analysis',
      description: 'Product category optimization recommendations',
      icon: Users,
    },
    {
      type: 'insights' as AnalysisType,
      title: 'Business Intelligence',
      description: 'Comprehensive business insights combining all data',
      icon: Sparkles,
    },
  ];

  const tabs = [
    {
      id: 'ai',
      label: 'AI Analysis',
      content: (
        <div className="space-y-6">
          {/* Analysis Cards */}
          <div className="grid grid-cols-2 gap-6">
            {analysisCards.map((card) => (
              <Card key={card.type}>
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                    <card.icon className="w-6 h-6 text-[var(--accent)]" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-serif text-lg font-medium text-[var(--ink)] mb-1">
                      {card.title}
                    </h4>
                    <p className="text-sm text-[var(--muted)] mb-4">{card.description}</p>
                    <button
                      onClick={() => runAnalysis(card.type)}
                      disabled={loading}
                      className="flex items-center gap-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded text-sm font-medium disabled:opacity-50"
                    >
                      {loading && activeAnalysis === card.type ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Run Analysis
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Results */}
                {analysisResults[card.type] && (
                  <div className="mt-6 pt-6 border-t border-[var(--border)]">
                    <div className="flex items-center justify-between mb-4">
                      <SectionLabel>AI Recommendations</SectionLabel>
                      <button
                        onClick={() => runAnalysis(card.type)}
                        className="text-[var(--muted)] hover:text-[var(--ink)]"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="prose prose-sm max-w-none text-[var(--ink)]">
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {analysisResults[card.type]}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>

          {/* Data Summary */}
          <Card>
            <SectionLabel>Data Summary</SectionLabel>
            <SectionTitle>Analysis Input Data</SectionTitle>
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-sm text-[var(--muted)] mb-1">Sales Records</p>
                <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                  {salesData.length.toLocaleString()}
                </p>
              </div>
              <div className="p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-sm text-[var(--muted)] mb-1">Brand Records</p>
                <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                  {brandData.length.toLocaleString()}
                </p>
              </div>
              <div className="p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-sm text-[var(--muted)] mb-1">Total Revenue</p>
                <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                  ${(salesSummary.totalRevenue / 1000).toFixed(0)}K
                </p>
              </div>
              <div className="p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-sm text-[var(--muted)] mb-1">Avg Margin</p>
                <p className="text-xl font-semibold text-[var(--ink)] font-serif">
                  {salesSummary.avgMargin.toFixed(1)}%
                </p>
              </div>
            </div>
          </Card>
        </div>
      ),
    },
    {
      id: 'history',
      label: 'Past Reports',
      content: (
        <Card>
          <SectionLabel>Analysis History</SectionLabel>
          <SectionTitle>Past AI Recommendations</SectionTitle>
          <p className="text-[var(--muted)]">
            Historical analysis reports will be stored here for future reference.
          </p>
        </Card>
      ),
    },
  ];

  return (
    <div>
      <Header title="AI-Powered Insights" subtitle="Recommendations" />
      <Tabs tabs={tabs} />
    </div>
  );
}
