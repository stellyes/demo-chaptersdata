'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { useFilteredSalesData, useNormalizedBrandDataCompat, useAppStore } from '@/store/app-store';
import { calculateSalesSummary, calculateBrandSummary } from '@/lib/services/data-processor';
import { Sparkles, TrendingUp, ShoppingBag, Users, RefreshCw, Loader2, FileText, Calendar, ChevronDown, MessageSquare, Check, Database, Activity, AlertTriangle, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { format } from 'date-fns';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Custom components for ReactMarkdown to handle table overflow on mobile
const markdownComponents: Components = {
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
      <table {...props} className="min-w-full">{children}</table>
    </div>
  ),
};

type AnalysisType = 'sales' | 'brands' | 'categories' | 'insights';

// Health check types
interface HealthCheckGap {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  source: string;
  description: string;
  affectedRecords: number;
  suggestedAction?: string;
}

interface HealthCheckTrend {
  id: string;
  metric: string;
  currentValue: number;
  baselineValue: number;
  percentChange: number;
  direction: 'increase' | 'decrease';
  severity: 'critical' | 'warning' | 'info';
}

interface HealthCheckFreshness {
  source: string;
  lastDataPoint: string;
  dataLagDays: number;
  status: 'fresh' | 'stale' | 'critical';
}

interface HealthCheckReport {
  report_id: string;
  timestamp: string;
  summary: {
    totalGaps: number;
    criticalGaps: number;
    warningGaps: number;
    infoGaps: number;
    trendAnomalies: number;
    overallHealthScore: number;
  };
  dataFreshness: HealthCheckFreshness[];
  gaps: HealthCheckGap[];
  trends: HealthCheckTrend[];
  insights: string[];
  recommendations: string[];
}

// Data context options for custom queries
interface DataContextOptions {
  includeSales: boolean;
  includeBrands: boolean;
  includeBrandMappings: boolean;
  includeProducts: boolean;
  includeCustomers: boolean;
  includeInvoices: boolean;
  includeResearch: boolean;
  includeSeo: boolean;
  includeQrCodes: boolean;
}

// Animated collapsible component
function AnimatedCollapse({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>(0);

  useEffect(() => {
    if (isOpen) {
      const contentHeight = contentRef.current?.scrollHeight || 0;
      setHeight(contentHeight);
      // After animation completes, set to auto for dynamic content
      const timer = setTimeout(() => setHeight('auto'), 300);
      return () => clearTimeout(timer);
    } else {
      // First set explicit height, then animate to 0
      if (contentRef.current) {
        setHeight(contentRef.current.scrollHeight);
        requestAnimationFrame(() => {
          setHeight(0);
        });
      }
    }
  }, [isOpen]);

  return (
    <div
      style={{
        height: height === 'auto' ? 'auto' : `${height}px`,
        overflow: 'hidden',
        transition: 'height 300ms ease-in-out',
      }}
    >
      <div ref={contentRef}>
        {children}
      </div>
    </div>
  );
}

export function RecommendationsPage() {
  const salesData = useFilteredSalesData();
  const brandData = useNormalizedBrandDataCompat(); // Use normalized brand data with aliases consolidated
  const {
    aiRecommendations,
    addAiRecommendation,
    addNotification,
    productData,
    customerData,
    invoiceData,
    researchData,
    seoData,
    qrCodesData,
    dataStatus,
    brandMappings,
  } = useAppStore();

  const [activeAnalysis, setActiveAnalysis] = useState<AnalysisType | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<AnalysisType, string>>({
    sales: '',
    brands: '',
    categories: '',
    insights: '',
  });
  const [loading, setLoading] = useState(false);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);

  // Custom query state
  const [customPrompt, setCustomPrompt] = useState('');
  const [customQueryResult, setCustomQueryResult] = useState('');
  const [customQueryLoading, setCustomQueryLoading] = useState(false);
  const [selectedResearchIds, setSelectedResearchIds] = useState<string[]>([]);

  // Health check state
  const [healthCheckData, setHealthCheckData] = useState<HealthCheckReport | null>(null);
  const [healthCheckLoading, setHealthCheckLoading] = useState(false);
  const [healthCheckError, setHealthCheckError] = useState<string | null>(null);
  const [lastHealthCheckFetch, setLastHealthCheckFetch] = useState<Date | null>(null);
  const [contextOptions, setContextOptions] = useState<DataContextOptions>({
    includeSales: true,
    includeBrands: true,
    includeBrandMappings: true, // Include brand mappings by default for proper normalization context
    includeProducts: true,
    includeCustomers: false,
    includeInvoices: false,
    includeResearch: true,
    includeSeo: false,
    includeQrCodes: false,
  });

  const salesSummary = useMemo(() => calculateSalesSummary(salesData), [salesData]);
  // brandData is already normalized via useNormalizedBrandDataCompat, so we just pass it directly
  const brandSummary = useMemo(() => calculateBrandSummary(brandData), [brandData]);

  // Prepare brand mappings summary for AI context
  const brandMappingsSummary = useMemo(() => {
    const mappingCount = Object.keys(brandMappings || {}).length;
    if (mappingCount === 0) return null;

    // Get top canonical brands with their alias counts
    const topBrands = Object.entries(brandMappings || {})
      .slice(0, 20)
      .map(([brand, entry]) => ({
        canonicalBrand: brand,
        aliasCount: Object.keys(entry.aliases || {}).length,
        productTypes: [...new Set(Object.values(entry.aliases || {}))],
      }));

    return {
      totalCanonicalBrands: mappingCount,
      totalAliases: Object.values(brandMappings || {}).reduce(
        (sum, entry) => sum + Object.keys(entry.aliases || {}).length, 0
      ),
      topBrands,
    };
  }, [brandMappings]);

  // Get human-readable analysis type names
  const getAnalysisTypeName = (type: AnalysisType): string => {
    switch (type) {
      case 'sales': return 'Sales Trends Analysis';
      case 'brands': return 'Brand Performance Analysis';
      case 'categories': return 'Category Analysis';
      case 'insights': return 'Business Intelligence';
      default: return 'Analysis';
    }
  };

  const runAnalysis = async (type: AnalysisType) => {
    setLoading(true);
    setActiveAnalysis(type);

    // Show "Analysis Started" notification
    const analysisName = getAnalysisTypeName(type);
    addNotification({
      type: 'info',
      title: 'Analysis Started',
      message: analysisName,
    });

    try {
      let data: Record<string, unknown> = {};

      // Include brand mappings context for all analysis types
      // This helps AI understand brand relationships and provide better recommendations
      const brandMappingsContext = brandMappingsSummary ? {
        note: 'Brand data has been normalized using brand mappings. Multiple brand name variations have been consolidated under canonical names.',
        totalCanonicalBrands: brandMappingsSummary.totalCanonicalBrands,
        totalAliases: brandMappingsSummary.totalAliases,
      } : null;

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
            brandMappingsContext,
          };
          break;
        case 'brands':
          // Transform brandByCategory to use camelCase field names for the API
          const brandByCategory: Record<string, Array<{ brand: string; netSales: number }>> = {};
          for (const [category, brands] of Object.entries(brandSummary.byCategory)) {
            brandByCategory[category] = brands.slice(0, 10).map((b) => ({
              brand: b.brand,
              netSales: b.net_sales,
            }));
          }
          data = {
            brandData: brandSummary.topBrands.slice(0, 50).map((b) => ({
              brand: b.brand,
              netSales: b.net_sales,
              margin: b.gross_margin_pct,
              pctOfTotal: b.pct_of_total_net_sales,
            })),
            brandByCategory,
            brandMappingsContext,
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
            brandMappingsContext,
          };
          break;
        case 'insights':
          data = {
            salesSummary,
            brandHighlights: {
              topBrands: brandSummary.topBrands.slice(0, 10).map((b) => b.brand),
              lowMarginBrands: brandSummary.lowMarginBrands.slice(0, 5).map((b) => b.brand),
            },
            brandMappingsContext,
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

        // Add the new report to the store so it appears in Past Reports immediately
        if (result.data.report) {
          addAiRecommendation(result.data.report);
        }

        // Show "Analysis Complete" notification with link to view
        addNotification({
          type: 'success',
          title: 'Analysis Complete!',
          message: `${analysisName} is ready to view.`,
          actionLabel: 'View Results',
          actionPage: 'recommendations',
          actionTab: 'history',
        });
      } else {
        setAnalysisResults((prev) => ({
          ...prev,
          [type]: `Error: ${result.error}`,
        }));

        // Show error notification
        addNotification({
          type: 'error',
          title: 'Analysis Failed',
          message: result.error || 'An error occurred during analysis.',
        });
      }
    } catch (error) {
      setAnalysisResults((prev) => ({
        ...prev,
        [type]: `Error: ${error instanceof Error ? error.message : 'Analysis failed'}`,
      }));

      // Show error notification
      addNotification({
        type: 'error',
        title: 'Analysis Failed',
        message: error instanceof Error ? error.message : 'An error occurred during analysis.',
      });
    } finally {
      setLoading(false);
    }
  };

  // Run custom query
  const runCustomQuery = async () => {
    if (!customPrompt.trim()) return;

    setCustomQueryLoading(true);
    setCustomQueryResult('');

    // Truncate prompt for notification display (max 50 chars)
    const truncatedPrompt = customPrompt.length > 50
      ? customPrompt.substring(0, 47) + '...'
      : customPrompt;

    // Show "Query Started" notification
    addNotification({
      type: 'info',
      title: 'Custom Query Started',
      message: truncatedPrompt,
    });

    try {
      const response = await fetch('/api/ai/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: customPrompt,
          contextOptions,
          data: {
            sales: contextOptions.includeSales ? salesData : [],
            brands: contextOptions.includeBrands ? brandData : [],
            brandMappings: contextOptions.includeBrandMappings ? brandMappings : null,
            products: contextOptions.includeProducts ? productData : [],
            customers: contextOptions.includeCustomers ? customerData : [],
            invoices: contextOptions.includeInvoices ? invoiceData : [],
            research: contextOptions.includeResearch ? researchData : [],
            seo: contextOptions.includeSeo ? seoData : [],
            qrCodes: contextOptions.includeQrCodes ? qrCodesData : [],
          },
          selectedResearchIds,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setCustomQueryResult(result.data.analysis);

        // Add the report to store for immediate visibility
        if (result.data.report) {
          addAiRecommendation(result.data.report);
        }

        // Show "Query Complete" notification with link to view
        addNotification({
          type: 'success',
          title: 'Custom Query Complete!',
          message: 'Your analysis is ready to view.',
          actionLabel: 'View Results',
          actionPage: 'recommendations',
          actionTab: 'history',
        });
      } else {
        setCustomQueryResult(`Error: ${result.error}`);

        // Show error notification
        addNotification({
          type: 'error',
          title: 'Query Failed',
          message: result.error || 'An error occurred during the query.',
        });
      }
    } catch (error) {
      setCustomQueryResult(`Error: ${error instanceof Error ? error.message : 'Query failed'}`);

      // Show error notification
      addNotification({
        type: 'error',
        title: 'Query Failed',
        message: error instanceof Error ? error.message : 'An error occurred during the query.',
      });
    } finally {
      setCustomQueryLoading(false);
    }
  };

  // Toggle context option
  const toggleContextOption = (key: keyof DataContextOptions) => {
    setContextOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Toggle research document selection
  const toggleResearchSelection = (id: string) => {
    setSelectedResearchIds((prev) =>
      prev.includes(id) ? prev.filter((rid) => rid !== id) : [...prev, id]
    );
  };

  // Fetch latest health check from API
  const fetchHealthCheck = async () => {
    try {
      const response = await fetch('/api/ai/health-check');
      const result = await response.json();
      if (result.success && result.data.report) {
        setHealthCheckData(result.data.report);
        setHealthCheckError(null);
      } else if (result.success && !result.data.report) {
        setHealthCheckData(null);
        setHealthCheckError(null);
      }
      setLastHealthCheckFetch(new Date());
    } catch (error) {
      console.error('Failed to fetch health check:', error);
      setHealthCheckError('Failed to load health check data');
    }
  };

  // Run a new health check
  const runHealthCheck = async () => {
    setHealthCheckLoading(true);
    setHealthCheckError(null);

    addNotification({
      type: 'info',
      title: 'Health Check Started',
      message: 'Analyzing data quality and trends...',
    });

    try {
      const response = await fetch('/api/ai/health-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales: salesData,
          brands: brandData,
          customers: customerData,
          invoices: invoiceData,
        }),
      });

      const result = await response.json();

      if (result.success && result.data.report) {
        setHealthCheckData(result.data.report);
        setLastHealthCheckFetch(new Date());

        const score = result.data.report.summary.overallHealthScore;
        const criticalGaps = result.data.report.summary.criticalGaps;

        addNotification({
          type: score >= 80 ? 'success' : score >= 50 ? 'info' : 'error',
          title: 'Health Check Complete',
          message: `Score: ${score}/100${criticalGaps > 0 ? ` - ${criticalGaps} critical issues found` : ''}`,
        });
      } else {
        setHealthCheckError(result.error || 'Health check failed');
        addNotification({
          type: 'error',
          title: 'Health Check Failed',
          message: result.error || 'An error occurred',
        });
      }
    } catch (error) {
      setHealthCheckError(error instanceof Error ? error.message : 'Health check failed');
      addNotification({
        type: 'error',
        title: 'Health Check Failed',
        message: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setHealthCheckLoading(false);
    }
  };

  // Fetch health check on mount
  useEffect(() => {
    fetchHealthCheck();
  }, []);

  // Get severity icon
  const getSeverityIcon = (severity: 'critical' | 'warning' | 'info') => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'info':
        return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  // Get status color
  const getStatusColor = (status: 'fresh' | 'stale' | 'critical') => {
    switch (status) {
      case 'fresh':
        return 'text-green-600 bg-green-50';
      case 'stale':
        return 'text-amber-600 bg-amber-50';
      case 'critical':
        return 'text-red-600 bg-red-50';
    }
  };

  // Get health score color
  const getHealthScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 50) return 'text-amber-600';
    return 'text-red-600';
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

  // Check if any analysis has results
  const hasAnyResults = Object.values(analysisResults).some((result) => result !== '');

  // Get the most recent analysis result
  const latestResult = activeAnalysis && analysisResults[activeAnalysis]
    ? { type: activeAnalysis, content: analysisResults[activeAnalysis] }
    : null;

  const tabs = [
    {
      id: 'ai',
      label: 'AI Analysis',
      content: (
        <div className="space-y-4 md:space-y-6">
          {/* Analysis Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
            {analysisCards.map((card) => (
              <Card key={card.type}>
                <div className="flex items-start gap-3 md:gap-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                    <card.icon className="w-5 h-5 md:w-6 md:h-6 text-[var(--accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-serif text-base md:text-lg font-medium text-[var(--ink)] mb-1">
                      {card.title}
                    </h4>
                    <p className="text-xs md:text-sm text-[var(--muted)] mb-3 md:mb-4">{card.description}</p>
                    <div className="flex flex-wrap items-center gap-2 md:gap-3">
                      <button
                        onClick={() => runAnalysis(card.type)}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 md:px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded text-xs md:text-sm font-medium disabled:opacity-50"
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
                      {analysisResults[card.type] && (
                        <span className="text-xs text-[var(--accent)] font-medium">
                          ✓ Generated
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Generated Report Section */}
          {hasAnyResults && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <SectionLabel>Generated Report</SectionLabel>
                  <SectionTitle>
                    {latestResult ? `${analysisCards.find(c => c.type === latestResult.type)?.title}` : 'AI Analysis Results'}
                  </SectionTitle>
                </div>
                {latestResult && (
                  <button
                    onClick={() => runAnalysis(latestResult.type)}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--paper)] rounded transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Regenerate
                  </button>
                )}
              </div>

              {/* Report tabs for switching between generated reports */}
              {Object.entries(analysisResults).filter(([, content]) => content).length > 1 && (
                <div className="flex gap-2 mb-4 pb-4 border-b border-[var(--border)]">
                  {Object.entries(analysisResults)
                    .filter(([, content]) => content)
                    .map(([type]) => (
                      <button
                        key={type}
                        onClick={() => setActiveAnalysis(type as AnalysisType)}
                        className={`px-3 py-1.5 text-sm rounded transition-colors ${
                          activeAnalysis === type
                            ? 'bg-[var(--ink)] text-[var(--paper)]'
                            : 'bg-[var(--paper)] text-[var(--muted)] hover:text-[var(--ink)]'
                        }`}
                      >
                        {analysisCards.find(c => c.type === type)?.title.replace(' Analysis', '')}
                      </button>
                    ))}
                </div>
              )}

              {latestResult && (
                <div className="prose prose-sm max-w-none text-[var(--ink)]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{latestResult.content}</ReactMarkdown>
                </div>
              )}
            </Card>
          )}

          {/* Data Summary */}
          <Card>
            <SectionLabel>Data Summary</SectionLabel>
            <SectionTitle>Analysis Input Data</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Sales Records</p>
                <p className="text-lg md:text-xl font-semibold text-[var(--ink)] font-serif">
                  {salesData.length.toLocaleString()}
                </p>
              </div>
              <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Brand Records</p>
                <p className="text-lg md:text-xl font-semibold text-[var(--ink)] font-serif">
                  {brandData.length.toLocaleString()}
                </p>
              </div>
              <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Total Revenue</p>
                <p className="text-lg md:text-xl font-semibold text-[var(--ink)] font-serif">
                  ${(salesSummary.totalRevenue / 1000).toFixed(0)}K
                </p>
              </div>
              <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Avg Margin</p>
                <p className="text-lg md:text-xl font-semibold text-[var(--ink)] font-serif">
                  {salesSummary.avgMargin.toFixed(1)}%
                </p>
              </div>
            </div>
          </Card>
        </div>
      ),
    },
    {
      id: 'custom',
      label: 'Custom Query',
      content: (
        <div className="space-y-6">
          {/* Custom Query Input */}
          <Card>
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                <MessageSquare className="w-6 h-6 text-[var(--accent)]" />
              </div>
              <div className="flex-1">
                <h4 className="font-serif text-lg font-medium text-[var(--ink)] mb-1">
                  Ask Claude Anything
                </h4>
                <p className="text-sm text-[var(--muted)]">
                  Query your business data with custom questions. Select which data sources to include for context.
                </p>
              </div>
            </div>

            {/* Data Context Selection */}
            <div className="mb-6">
              <SectionLabel>Data Context</SectionLabel>
              <p className="text-xs md:text-sm text-[var(--muted)] mb-3">
                Select which data sources to include in the query. More data = more context but higher token usage.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 md:gap-3">
                {[
                  { key: 'includeSales', label: 'Sales', count: salesData.length || dataStatus.sales.count },
                  { key: 'includeBrands', label: 'Brands', count: brandData.length || dataStatus.brands.count },
                  { key: 'includeBrandMappings', label: 'Brand Map', count: brandMappingsSummary?.totalCanonicalBrands || dataStatus.mappings.count },
                  { key: 'includeProducts', label: 'Products', count: productData.length || dataStatus.products.count },
                  { key: 'includeCustomers', label: 'Customers', count: customerData.length || dataStatus.customers.count },
                  { key: 'includeInvoices', label: 'Invoices', count: invoiceData.length || dataStatus.invoices.count },
                  { key: 'includeResearch', label: 'Research', count: researchData.length || dataStatus.research.count },
                  { key: 'includeSeo', label: 'SEO', count: seoData.length || dataStatus.seo.count },
                  { key: 'includeQrCodes', label: 'QR Codes', count: qrCodesData.length || dataStatus.qrCodes.count },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => toggleContextOption(item.key as keyof DataContextOptions)}
                    className={`flex items-center justify-between p-2 md:p-3 rounded-lg border transition-colors ${
                      contextOptions[item.key as keyof DataContextOptions]
                        ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--ink)]'
                        : 'bg-[var(--paper)] border-[var(--border)] text-[var(--muted)]'
                    }`}
                  >
                    <span className="text-xs md:text-sm font-medium truncate">{item.label}</span>
                    <div className="flex items-center gap-1 md:gap-2 ml-1">
                      <span className="text-xs">{item.count > 0 ? item.count.toLocaleString() : '0'}</span>
                      {contextOptions[item.key as keyof DataContextOptions] && (
                        <Check className="w-3 h-3 md:w-4 md:h-4 text-[var(--accent)] shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Research Document Selection */}
            {contextOptions.includeResearch && researchData.length > 0 && (
              <div className="mb-6">
                <SectionLabel>Select Research Documents (Optional)</SectionLabel>
                <p className="text-sm text-[var(--muted)] mb-3">
                  Select specific documents to include full details. Unselected documents will only include brief summaries.
                </p>
                <div className="max-h-48 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                  {researchData.slice(0, 20).map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => toggleResearchSelection(doc.id)}
                      className={`w-full flex items-start gap-3 p-3 text-left transition-colors ${
                        selectedResearchIds.includes(doc.id)
                          ? 'bg-[var(--accent)]/5'
                          : 'hover:bg-[var(--paper)]'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 ${
                          selectedResearchIds.includes(doc.id)
                            ? 'bg-[var(--accent)] border-[var(--accent)]'
                            : 'border-[var(--border)]'
                        }`}
                      >
                        {selectedResearchIds.includes(doc.id) && (
                          <Check className="w-3 h-3 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--ink)] truncate">
                          [{doc.category}] {doc.summary.slice(0, 80)}...
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {doc.key_findings?.length || 0} findings
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                {selectedResearchIds.length > 0 && (
                  <p className="mt-2 text-xs text-[var(--accent)]">
                    {selectedResearchIds.length} document{selectedResearchIds.length > 1 ? 's' : ''} selected for full detail
                  </p>
                )}
              </div>
            )}

            {/* Query Input */}
            <div className="mb-4">
              <SectionLabel>Your Question</SectionLabel>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g., What are our best performing brands in terms of margin? Which products should we consider discontinuing? How can we improve customer retention?"
                className="w-full h-32 p-4 border border-[var(--border)] rounded-lg text-sm text-[var(--ink)] bg-[var(--white)] resize-none focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* Submit Button */}
            <button
              onClick={runCustomQuery}
              disabled={customQueryLoading || !customPrompt.trim()}
              className="flex items-center gap-2 px-6 py-3 bg-[var(--ink)] text-[var(--paper)] rounded-lg text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              {customQueryLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Run Custom Query
                </>
              )}
            </button>
          </Card>

          {/* Custom Query Result */}
          {customQueryResult && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <SectionLabel>Query Result</SectionLabel>
                  <SectionTitle>Claude&apos;s Analysis</SectionTitle>
                </div>
                <button
                  onClick={runCustomQuery}
                  disabled={customQueryLoading}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--paper)] rounded transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${customQueryLoading ? 'animate-spin' : ''}`} />
                  Regenerate
                </button>
              </div>
              <div className="prose prose-sm max-w-none text-[var(--ink)]">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{customQueryResult}</ReactMarkdown>
              </div>
            </Card>
          )}

          {/* Context Summary */}
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-5 h-5 text-[var(--accent)]" />
              <div>
                <SectionLabel>Available Data</SectionLabel>
                <SectionTitle>Data Sources Summary</SectionTitle>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Sales Records</p>
                <p className="text-lg md:text-xl font-semibold text-[var(--ink)] font-serif">
                  {salesData.length.toLocaleString()}
                </p>
              </div>
              <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Brand Records</p>
                <p className="text-lg md:text-xl font-semibold text-[var(--ink)] font-serif">
                  {brandData.length.toLocaleString()}
                </p>
              </div>
              <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Customer Records</p>
                <p className="text-lg md:text-xl font-semibold text-[var(--ink)] font-serif">
                  {customerData.length.toLocaleString()}
                </p>
              </div>
              <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-xs md:text-sm text-[var(--muted)] mb-1">Research Docs</p>
                <p className="text-lg md:text-xl font-semibold text-[var(--ink)] font-serif">
                  {researchData.length.toLocaleString()}
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
        <div className="space-y-6">
          <Card>
            <SectionLabel>Analysis History</SectionLabel>
            <SectionTitle>Past AI Recommendations</SectionTitle>
            {aiRecommendations.length === 0 ? (
              <p className="text-[var(--muted)] py-8 text-center">
                No past recommendations found. Run an analysis above to generate recommendations.
              </p>
            ) : (
              <div className="space-y-4 mt-4">
                {aiRecommendations
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((report) => {
                    const isExpanded = expandedReportId === report.id;
                    return (
                      <div
                        key={report.id}
                        className="border border-[var(--border)] rounded-lg overflow-hidden"
                      >
                        <button
                          onClick={() => setExpandedReportId(isExpanded ? null : report.id)}
                          className="w-full flex items-center justify-between p-4 bg-[var(--paper)] hover:bg-[var(--paper)]/80 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center">
                              <FileText className="w-5 h-5 text-[var(--accent)]" />
                            </div>
                            <div className="text-left">
                              <p className="font-medium text-[var(--ink)] capitalize">
                                {report.type} Analysis
                              </p>
                              <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                                <Calendar className="w-3 h-3" />
                                {(() => {
                                  try {
                                    return format(new Date(report.date), 'MMM d, yyyy h:mm a');
                                  } catch {
                                    return report.date;
                                  }
                                })()}
                              </div>
                            </div>
                          </div>
                          <ChevronDown
                            className={`w-5 h-5 text-[var(--muted)] transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        </button>
                        <AnimatedCollapse isOpen={isExpanded}>
                          <div className="p-4 border-t border-[var(--border)] bg-[var(--white)]">
                            {report.summary && (
                              <div className="mb-4 p-3 bg-[var(--accent)]/5 rounded-lg">
                                <p className="text-sm font-medium text-[var(--ink)]">Question</p>
                                <p className="text-sm text-[var(--muted)]">{report.summary}</p>
                              </div>
                            )}
                            <div className="prose prose-sm max-w-none text-[var(--ink)] prose-headings:text-[var(--ink)] prose-headings:font-serif prose-headings:font-semibold prose-h1:text-2xl prose-h1:mt-6 prose-h1:mb-4 prose-h2:text-xl prose-h2:mt-5 prose-h2:mb-3 prose-h3:text-lg prose-h3:mt-4 prose-h3:mb-2 prose-h4:text-base prose-h4:font-semibold prose-p:text-sm prose-p:leading-relaxed prose-ul:text-sm prose-ol:text-sm prose-li:my-1 prose-strong:text-[var(--ink)] prose-code:bg-[var(--paper)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-[var(--paper)] prose-pre:text-xs prose-pre:overflow-x-auto">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{report.analysis}</ReactMarkdown>
                            </div>
                          </div>
                        </AnimatedCollapse>
                      </div>
                    );
                  })}
              </div>
            )}
          </Card>

          {/* Stats */}
          {aiRecommendations.length > 0 && (
            <Card>
              <SectionLabel>Report Statistics</SectionLabel>
              <SectionTitle>Analysis Overview</SectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-4">
                <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
                  <p className="text-xl md:text-2xl font-semibold font-serif text-[var(--ink)]">
                    {aiRecommendations.length}
                  </p>
                  <p className="text-xs md:text-sm text-[var(--muted)]">Total Reports</p>
                </div>
                <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
                  <p className="text-xl md:text-2xl font-semibold font-serif text-[var(--ink)]">
                    {aiRecommendations.filter(r => r.type === 'sales').length}
                  </p>
                  <p className="text-xs md:text-sm text-[var(--muted)]">Sales Reports</p>
                </div>
                <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
                  <p className="text-xl md:text-2xl font-semibold font-serif text-[var(--ink)]">
                    {aiRecommendations.filter(r => r.type === 'brands').length}
                  </p>
                  <p className="text-xs md:text-sm text-[var(--muted)]">Brand Reports</p>
                </div>
                <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
                  <p className="text-xl md:text-2xl font-semibold font-serif text-[var(--ink)]">
                    {aiRecommendations.filter(r => r.type === 'insights').length}
                  </p>
                  <p className="text-xs md:text-sm text-[var(--muted)]">Insights Reports</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      ),
    },
    {
      id: 'health',
      label: 'Data Health',
      content: (
        <div className="space-y-6">
          {/* Health Score Overview */}
          <Card>
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                  <Activity className="w-6 h-6 text-[var(--accent)]" />
                </div>
                <div>
                  <SectionLabel>Data Quality</SectionLabel>
                  <SectionTitle>Health Check Dashboard</SectionTitle>
                  <p className="text-sm text-[var(--muted)] mt-1">
                    Monitor data gaps, staleness, and emerging trends
                  </p>
                </div>
              </div>
              <button
                onClick={runHealthCheck}
                disabled={healthCheckLoading}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded text-sm font-medium disabled:opacity-50"
              >
                {healthCheckLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Run Health Check
                  </>
                )}
              </button>
            </div>

            {healthCheckError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
                <p className="text-sm text-red-600">{healthCheckError}</p>
              </div>
            )}

            {healthCheckData ? (
              <div className="space-y-6">
                {/* Health Score Card */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="col-span-2 md:col-span-1 p-4 bg-[var(--paper)] rounded-lg text-center">
                    <p className={`text-3xl font-bold font-serif ${getHealthScoreColor(healthCheckData.summary.overallHealthScore)}`}>
                      {healthCheckData.summary.overallHealthScore}
                    </p>
                    <p className="text-xs text-[var(--muted)]">Health Score</p>
                  </div>
                  <div className="p-4 bg-[var(--paper)] rounded-lg text-center">
                    <p className="text-xl font-semibold font-serif text-red-600">
                      {healthCheckData.summary.criticalGaps}
                    </p>
                    <p className="text-xs text-[var(--muted)]">Critical</p>
                  </div>
                  <div className="p-4 bg-[var(--paper)] rounded-lg text-center">
                    <p className="text-xl font-semibold font-serif text-amber-600">
                      {healthCheckData.summary.warningGaps}
                    </p>
                    <p className="text-xs text-[var(--muted)]">Warnings</p>
                  </div>
                  <div className="p-4 bg-[var(--paper)] rounded-lg text-center">
                    <p className="text-xl font-semibold font-serif text-blue-600">
                      {healthCheckData.summary.infoGaps}
                    </p>
                    <p className="text-xs text-[var(--muted)]">Info</p>
                  </div>
                  <div className="p-4 bg-[var(--paper)] rounded-lg text-center">
                    <p className="text-xl font-semibold font-serif text-purple-600">
                      {healthCheckData.summary.trendAnomalies}
                    </p>
                    <p className="text-xs text-[var(--muted)]">Trends</p>
                  </div>
                </div>

                {/* Last Check Time */}
                <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                  <Calendar className="w-4 h-4" />
                  Last checked: {(() => {
                    try {
                      return format(new Date(healthCheckData.timestamp), 'MMM d, yyyy h:mm a');
                    } catch {
                      return healthCheckData.timestamp;
                    }
                  })()}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Activity className="w-12 h-12 text-[var(--muted)] mx-auto mb-4" />
                <p className="text-[var(--muted)]">
                  No health check data available. Run a health check to analyze your data quality.
                </p>
              </div>
            )}
          </Card>

          {/* Data Freshness */}
          {healthCheckData && healthCheckData.dataFreshness.length > 0 && (
            <Card>
              <SectionLabel>Data Freshness</SectionLabel>
              <SectionTitle>Last Updated by Source</SectionTitle>
              <div className="mt-4 space-y-3">
                {healthCheckData.dataFreshness.map((f) => (
                  <div
                    key={f.source}
                    className="flex items-center justify-between p-3 bg-[var(--paper)] rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(f.status)}`}>
                        {f.status.toUpperCase()}
                      </span>
                      <span className="font-medium text-[var(--ink)] capitalize">{f.source}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-[var(--ink)]">{f.lastDataPoint}</p>
                      <p className="text-xs text-[var(--muted)]">{f.dataLagDays} days ago</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Data Gaps */}
          {healthCheckData && healthCheckData.gaps.length > 0 && (
            <Card>
              <SectionLabel>Data Gaps</SectionLabel>
              <SectionTitle>Issues Found</SectionTitle>
              <div className="mt-4 space-y-3">
                {healthCheckData.gaps
                  .sort((a, b) => {
                    const severityOrder = { critical: 0, warning: 1, info: 2 };
                    return severityOrder[a.severity] - severityOrder[b.severity];
                  })
                  .map((gap) => (
                    <div
                      key={gap.id}
                      className="p-4 bg-[var(--paper)] rounded-lg border-l-4 border-l-transparent"
                      style={{
                        borderLeftColor: gap.severity === 'critical' ? '#ef4444' : gap.severity === 'warning' ? '#f59e0b' : '#3b82f6',
                      }}
                    >
                      <div className="flex items-start gap-3">
                        {getSeverityIcon(gap.severity)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-[var(--muted)] uppercase">{gap.source}</span>
                            <span className="text-xs text-[var(--muted)]">•</span>
                            <span className="text-xs text-[var(--muted)]">{gap.affectedRecords} affected</span>
                          </div>
                          <p className="text-sm text-[var(--ink)]">{gap.description}</p>
                          {gap.suggestedAction && (
                            <p className="text-xs text-[var(--accent)] mt-2">
                              → {gap.suggestedAction}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          {/* Trend Anomalies */}
          {healthCheckData && healthCheckData.trends.length > 0 && (
            <Card>
              <SectionLabel>Trend Anomalies</SectionLabel>
              <SectionTitle>Significant Changes Detected</SectionTitle>
              <div className="mt-4 space-y-3">
                {healthCheckData.trends.map((trend) => (
                  <div
                    key={trend.id}
                    className="p-4 bg-[var(--paper)] rounded-lg"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        {getSeverityIcon(trend.severity)}
                        <div>
                          <p className="font-medium text-[var(--ink)]">{trend.metric}</p>
                          <p className="text-sm text-[var(--muted)] mt-1">
                            {trend.direction === 'increase' ? '↑' : '↓'}{' '}
                            <span className={trend.percentChange > 0 ? 'text-green-600' : 'text-red-600'}>
                              {trend.percentChange > 0 ? '+' : ''}{trend.percentChange.toFixed(1)}%
                            </span>
                            {' '}vs baseline
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-[var(--ink)]">
                          {trend.currentValue > 100 ? `$${trend.currentValue.toLocaleString()}` : trend.currentValue.toFixed(1)}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          was {trend.baselineValue > 100 ? `$${trend.baselineValue.toLocaleString()}` : trend.baselineValue.toFixed(1)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Insights & Recommendations */}
          {healthCheckData && (healthCheckData.insights.length > 0 || healthCheckData.recommendations.length > 0) && (
            <Card>
              <SectionLabel>Insights & Actions</SectionLabel>
              <SectionTitle>Recommendations</SectionTitle>
              <div className="mt-4 space-y-4">
                {healthCheckData.insights.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-[var(--ink)] mb-2">Key Insights</h4>
                    <ul className="space-y-2">
                      {healthCheckData.insights.map((insight, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-[var(--muted)]">
                          <CheckCircle className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
                          {insight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {healthCheckData.recommendations.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-[var(--ink)] mb-2">Recommended Actions</h4>
                    <ul className="space-y-2">
                      {healthCheckData.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-[var(--muted)]">
                          <span className="text-[var(--accent)] shrink-0">→</span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
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
