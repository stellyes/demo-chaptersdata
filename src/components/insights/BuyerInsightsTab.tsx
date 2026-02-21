'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useAppStore } from '@/store/app-store';
import {
  ShoppingCart,
  Search,
  Loader2,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Truck,
  Filter,
  X,
  Download,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadAsMarkdown, openPrintWindow } from '@/lib/export-utils';

// Custom components for ReactMarkdown
const markdownComponents: Components = {
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
      <table {...props} className="min-w-full">{children}</table>
    </div>
  ),
};

interface BuyerInsight {
  id: string;
  category: 'vendor' | 'pricing' | 'category' | 'trend' | 'opportunity';
  title: string;
  insight: string;
  impact: 'high' | 'medium' | 'low';
  data: Record<string, unknown>;
  createdAt: string;
}

interface KnowledgeBaseInsight {
  id: string;
  category: string;
  subcategory: string | null;
  insight: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  createdAt: string;
}

interface BuyerSummary {
  totalVendors: number;
  totalInvoices: number;
  totalSpend: number;
  topCategories: Array<{ category: string; totalCost: number }>;
}

const CATEGORIES = [
  { id: 'all', label: 'All Categories', icon: Package },
  { id: 'vendor', label: 'Vendor', icon: Truck },
  { id: 'pricing', label: 'Pricing', icon: DollarSign },
  { id: 'trend', label: 'Trends', icon: TrendingUp },
  { id: 'opportunity', label: 'Opportunities', icon: ShoppingCart },
];

export function BuyerInsightsTab() {
  const { addNotification, hideLoadingOverlay, aiRecommendations, addAiRecommendation } = useAppStore();
  const [buyerInsights, setBuyerInsights] = useState<BuyerInsight[]>([]);
  const [knowledgeInsights, setKnowledgeInsights] = useState<KnowledgeBaseInsight[]>([]);
  const [summary, setSummary] = useState<BuyerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState<BuyerInsight | KnowledgeBaseInsight | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const [investigationResult, setInvestigationResult] = useState<string | null>(null);
  const [additionalContext, setAdditionalContext] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<'realtime' | 'learned'>('realtime');
  const [viewingPastInvestigation, setViewingPastInvestigation] = useState<{ id: string; analysis: string; summary?: string; date: string } | null>(null);

  // Filter past buyer investigations from saved recommendations
  const pastBuyerInvestigations = useMemo(() => {
    return aiRecommendations
      .filter(r => r.type === 'buyer-investigation')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [aiRecommendations]);

  useEffect(() => {
    loadAllInsights();
  }, []);

  const loadAllInsights = async () => {
    setLoading(true);
    await Promise.all([loadBuyerInsights(), loadKnowledgeBaseInsights()]);
    setLoading(false);
    hideLoadingOverlay();
  };

  const loadBuyerInsights = async () => {
    try {
      const response = await fetch('/api/ai/buyer-insights');

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response from buyer-insights:', text.slice(0, 500));
        throw new Error('Server returned non-JSON response. Please try again.');
      }

      const result = await response.json();

      if (result.success) {
        setBuyerInsights(result.data.insights);
        setSummary(result.data.summary);
      } else {
        throw new Error(result.error || 'Failed to load buyer insights');
      }
    } catch (error) {
      console.error('Failed to load buyer insights:', error);
      addNotification({
        type: 'error',
        title: 'Failed to Load Buyer Insights',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      setBuyerInsights([]);
    }
  };

  const loadKnowledgeBaseInsights = async () => {
    try {
      // Fetch purchasing-related insights from the knowledge base
      const categories = ['purchasing', 'vendors', 'inventory', 'brands', 'margins'];
      const params = new URLSearchParams();
      params.set('categories', categories.join(','));
      params.set('limit', '50');

      const response = await fetch(`/api/ai/insights?${params.toString()}`);

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response from insights:', text.slice(0, 500));
        throw new Error('Server returned non-JSON response. Please try again.');
      }

      const result = await response.json();

      if (result.success) {
        setKnowledgeInsights(result.data);
      } else {
        throw new Error(result.error || 'Failed to load knowledge insights');
      }
    } catch (error) {
      console.error('Failed to load knowledge base insights:', error);
      setKnowledgeInsights([]);
    }
  };

  const refreshInsights = async () => {
    setRefreshing(true);
    await loadAllInsights();
    setRefreshing(false);
    addNotification({
      type: 'success',
      title: 'Insights Refreshed',
      message: 'Buyer insights have been updated with latest data.',
    });
  };

  const investigateInsight = async () => {
    if (!selectedInsight) return;

    setInvestigating(true);
    setInvestigationResult(null);

    const insightText = 'insight' in selectedInsight ? selectedInsight.insight : '';
    const category = selectedInsight.category;

    addNotification({
      type: 'info',
      title: 'Investigation Started',
      message: `Analyzing purchasing insight...`,
    });

    try {
      const response = await fetch('/api/ai/buyer-insights/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insightId: selectedInsight.id,
          insight: insightText,
          category,
          additionalContext: additionalContext.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Handle streaming SSE response
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text') {
              accumulated += event.content;
              setInvestigationResult(accumulated);
            } else if (event.type === 'done') {
              addAiRecommendation({
                id: event.investigationId,
                type: 'buyer-investigation',
                date: new Date().toISOString(),
                analysis: accumulated,
                summary: insightText.slice(0, 200),
              });
              addNotification({
                type: 'success',
                title: 'Investigation Complete',
                message: 'Procurement analysis is ready to view and has been saved.',
              });
            } else if (event.type === 'error') {
              throw new Error(event.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } catch (error) {
      console.error('Investigation failed:', error);
      addNotification({
        type: 'error',
        title: 'Investigation Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setInvestigating(false);
    }
  };

  const getImpactIcon = (impact: string) => {
    switch (impact) {
      case 'high':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'medium':
        return <TrendingUp className="w-4 h-4 text-amber-500" />;
      case 'low':
        return <TrendingDown className="w-4 h-4 text-green-500" />;
      default:
        return <Package className="w-4 h-4 text-gray-400" />;
    }
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high':
        return 'bg-red-100 text-red-800';
      case 'medium':
        return 'bg-amber-100 text-amber-800';
      case 'low':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryIcon = (category: string) => {
    const cat = CATEGORIES.find(c => c.id === category);
    const Icon = cat?.icon || Package;
    return <Icon className="w-4 h-4" />;
  };

  const handleExport = (exportFormat: 'print' | 'markdown') => {
    if (!investigationResult || !selectedInsight) return;

    const insightText = 'insight' in selectedInsight ? selectedInsight.insight : '';
    const timestamp = format(new Date(), 'yyyy-MM-dd-HHmm');
    const content = `# Buyer's Insight Investigation\n\n**Category:** ${selectedInsight.category}\n\n**Original Insight:** ${insightText}\n\n---\n\n${investigationResult}`;

    const options = {
      filename: `buyer-insight-investigation-${timestamp}`,
      title: "Buyer's Insight Investigation",
      subtitle: insightText.slice(0, 100),
      generatedAt: new Date(),
    };

    if (exportFormat === 'markdown') {
      downloadAsMarkdown(content, options);
    } else {
      openPrintWindow(content, options);
    }

    setShowExportMenu(false);
  };

  // Filter insights based on category
  const filteredBuyerInsights = selectedCategory === 'all'
    ? buyerInsights
    : buyerInsights.filter(i => i.category === selectedCategory);

  const filteredKnowledgeInsights = selectedCategory === 'all'
    ? knowledgeInsights
    : knowledgeInsights.filter(i =>
        i.category === selectedCategory ||
        i.category === 'purchasing' ||
        i.category === 'vendors'
      );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        <span className="ml-3 text-[var(--muted)]">Loading buyer insights...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
              <ShoppingCart className="w-6 h-6 text-[var(--accent)]" />
            </div>
            <div className="flex-1">
              <SectionLabel>Progressive Learning</SectionLabel>
              <SectionTitle>Buyer&apos;s Insights</SectionTitle>
              <p className="text-sm text-[var(--muted)] mt-1">
                Procurement intelligence powered by the Progressive Learning System.
                Analyze vendor relationships, pricing trends, and purchasing opportunities.
              </p>
            </div>
          </div>
          <button
            onClick={refreshInsights}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--paper)] rounded transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mt-6">
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-[var(--ink)]">
                {summary.totalVendors}
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">Active Vendors</p>
            </div>
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-[var(--ink)]">
                {summary.totalInvoices}
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">Recent Invoices</p>
            </div>
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-green-600">
                ${(summary.totalSpend / 1000).toFixed(0)}K
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">6-Month Spend</p>
            </div>
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-[var(--accent)]">
                {buyerInsights.filter(i => i.impact === 'high').length}
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">High Priority</p>
            </div>
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-purple-600">
                {pastBuyerInvestigations.length}
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">Past Investigations</p>
            </div>
          </div>
        )}
      </Card>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Insights List */}
        <div className="space-y-4">
          {/* Category Filter */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="w-4 h-4 text-[var(--muted)]" />
              <span className="text-sm font-medium text-[var(--ink)]">Filter by Category</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-[var(--ink)] text-[var(--paper)]'
                      : 'bg-[var(--paper)] text-[var(--muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  <cat.icon className="w-3 h-3" />
                  {cat.label}
                </button>
              ))}
            </div>
          </Card>

          {/* Insights Source Tabs */}
          <Card>
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setActiveTab('realtime')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded transition-colors ${
                  activeTab === 'realtime'
                    ? 'bg-[var(--ink)] text-[var(--paper)]'
                    : 'bg-[var(--paper)] text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                Real-time Analysis ({filteredBuyerInsights.length})
              </button>
              <button
                onClick={() => setActiveTab('learned')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded transition-colors ${
                  activeTab === 'learned'
                    ? 'bg-[var(--ink)] text-[var(--paper)]'
                    : 'bg-[var(--paper)] text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                Progressive Learning ({filteredKnowledgeInsights.length})
              </button>
            </div>

            <SectionLabel>{activeTab === 'realtime' ? 'Current Data Insights' : 'Learned Insights'}</SectionLabel>
            <SectionTitle>Select to Investigate</SectionTitle>

            {activeTab === 'realtime' ? (
              filteredBuyerInsights.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="w-12 h-12 text-[var(--muted)] mx-auto mb-3" />
                  <p className="text-[var(--muted)]">No insights found for this category.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-2 max-h-[500px] overflow-y-auto">
                  {filteredBuyerInsights.map((insight) => (
                    <button
                      key={insight.id}
                      onClick={() => {
                        setSelectedInsight(insight);
                        setInvestigationResult(null);
                        setAdditionalContext('');
                      }}
                      className={`w-full text-left p-4 rounded-lg border transition-all ${
                        selectedInsight?.id === insight.id
                          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                          : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            {getCategoryIcon(insight.category)}
                            <span className="text-xs font-medium text-[var(--muted)] capitalize">
                              {insight.category}
                            </span>
                            <span className={`px-2 py-0.5 text-xs font-medium rounded ${getImpactColor(insight.impact)}`}>
                              {insight.impact}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-[var(--ink)] mb-1">
                            {insight.title}
                          </p>
                          <p className="text-xs text-[var(--muted)] line-clamp-2">
                            {insight.insight}
                          </p>
                        </div>
                        <ChevronRight className={`w-5 h-5 shrink-0 transition-colors ${
                          selectedInsight?.id === insight.id
                            ? 'text-[var(--accent)]'
                            : 'text-[var(--muted)]'
                        }`} />
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : (
              filteredKnowledgeInsights.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="w-12 h-12 text-[var(--muted)] mx-auto mb-3" />
                  <p className="text-[var(--muted)]">No learned insights available yet.</p>
                  <p className="text-sm text-[var(--muted)] mt-1">
                    Run the Progressive Learning System to generate insights.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-2 max-h-[500px] overflow-y-auto">
                  {filteredKnowledgeInsights.map((insight) => (
                    <button
                      key={insight.id}
                      onClick={() => {
                        setSelectedInsight(insight);
                        setInvestigationResult(null);
                        setAdditionalContext('');
                      }}
                      className={`w-full text-left p-4 rounded-lg border transition-all ${
                        selectedInsight?.id === insight.id
                          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                          : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-[var(--paper)] text-[var(--muted)] capitalize">
                              {insight.category}
                            </span>
                            <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                              insight.confidence === 'high' ? 'bg-green-100 text-green-800' :
                              insight.confidence === 'medium' ? 'bg-amber-100 text-amber-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {insight.confidence}
                            </span>
                          </div>
                          <p className="text-sm text-[var(--ink)] line-clamp-2">
                            {insight.insight}
                          </p>
                          <p className="text-xs text-[var(--muted)] mt-2">
                            {format(new Date(insight.createdAt), 'MMM d, yyyy')}
                          </p>
                        </div>
                        <ChevronRight className={`w-5 h-5 shrink-0 transition-colors ${
                          selectedInsight?.id === insight.id
                            ? 'text-[var(--accent)]'
                            : 'text-[var(--muted)]'
                        }`} />
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}
          </Card>

          {/* Past Investigations Section */}
          {pastBuyerInvestigations.length > 0 && (
            <Card>
              <SectionLabel>Saved</SectionLabel>
              <SectionTitle>Past Buyer Investigations</SectionTitle>
              <div className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
                {pastBuyerInvestigations.map((investigation) => (
                  <button
                    key={investigation.id}
                    onClick={() => {
                      setViewingPastInvestigation(investigation);
                      setSelectedInsight(null);
                      setInvestigationResult(null);
                    }}
                    className={`w-full text-left p-4 rounded-lg border transition-all ${
                      viewingPastInvestigation?.id === investigation.id
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-[var(--border)] hover:border-purple-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-800">
                            Buyer Investigation
                          </span>
                        </div>
                        <p className="text-sm text-[var(--ink)] line-clamp-2">
                          {investigation.summary || 'Buyer insight investigation'}
                        </p>
                        <p className="text-xs text-[var(--muted)] mt-2">
                          {format(new Date(investigation.date), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                      <ChevronRight className={`w-5 h-5 shrink-0 transition-colors ${
                        viewingPastInvestigation?.id === investigation.id
                          ? 'text-purple-500'
                          : 'text-[var(--muted)]'
                      }`} />
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Right Column - Investigation Panel */}
        <div className="space-y-4">
          {viewingPastInvestigation ? (
            // Viewing a past investigation
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <SectionLabel>Past Investigation</SectionLabel>
                  <SectionTitle>Saved Buyer Analysis</SectionTitle>
                </div>
                <button
                  onClick={() => setViewingPastInvestigation(null)}
                  className="p-1 text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-[var(--muted)] mb-4">
                {viewingPastInvestigation.summary || 'Buyer insight investigation'}
              </p>
              <p className="text-xs text-[var(--muted)] mb-4">
                Saved on {format(new Date(viewingPastInvestigation.date), 'MMM d, yyyy h:mm a')}
              </p>
              <div className="prose prose-sm max-w-none text-[var(--ink)] prose-headings:text-[var(--ink)] prose-headings:font-serif">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {viewingPastInvestigation.analysis}
                </ReactMarkdown>
              </div>
            </Card>
          ) : selectedInsight ? (
            <>
              {/* Selected Insight Card */}
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <SectionLabel>Selected Insight</SectionLabel>
                    <div className="flex items-center gap-2 mt-2 mb-3">
                      {getImpactIcon('impact' in selectedInsight ? selectedInsight.impact : selectedInsight.confidence)}
                      <span className="text-xs font-medium text-[var(--muted)] capitalize">
                        {'impact' in selectedInsight ? `${selectedInsight.impact} impact` : `${selectedInsight.confidence} confidence`} • {selectedInsight.category}
                      </span>
                    </div>
                    {'title' in selectedInsight && (
                      <p className="font-medium text-[var(--ink)] mb-2">{selectedInsight.title}</p>
                    )}
                    <p className="text-[var(--ink)]">
                      {'insight' in selectedInsight ? selectedInsight.insight : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedInsight(null);
                      setInvestigationResult(null);
                    }}
                    className="p-1 text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Additional Context Input */}
                <div className="mt-4 pt-4 border-t border-[var(--border)]">
                  <label className="block text-sm font-medium text-[var(--ink)] mb-2">
                    Additional Context (Optional)
                  </label>
                  <textarea
                    value={additionalContext}
                    onChange={(e) => setAdditionalContext(e.target.value)}
                    placeholder="Add specific questions about vendors, pricing, or purchasing strategy..."
                    className="w-full h-24 p-3 border border-[var(--border)] rounded-lg text-sm text-[var(--ink)] bg-[var(--white)] resize-none focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                {/* Investigate Button */}
                <button
                  onClick={investigateInsight}
                  disabled={investigating}
                  className="w-full mt-4 flex items-center justify-center gap-2 px-6 py-3 bg-[var(--ink)] text-[var(--paper)] rounded-lg text-sm font-medium disabled:opacity-50 transition-opacity"
                >
                  {investigating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Investigating...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      Deep Investigate
                    </>
                  )}
                </button>
              </Card>

              {/* Investigation Results */}
              {investigationResult && (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <SectionLabel>Investigation Results</SectionLabel>
                      <SectionTitle>Procurement Analysis</SectionTitle>
                    </div>
                    {/* Export Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--paper)] rounded transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Export
                      </button>
                      {showExportMenu && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setShowExportMenu(false)}
                          />
                          <div className="absolute right-0 top-full mt-1 bg-[var(--white)] border border-[var(--border)] rounded-lg shadow-lg z-20 py-1 min-w-[160px]">
                            <button
                              onClick={() => handleExport('print')}
                              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
                            >
                              Print / Save PDF
                            </button>
                            <button
                              onClick={() => handleExport('markdown')}
                              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
                            >
                              Markdown (.md)
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="prose prose-sm max-w-none text-[var(--ink)] prose-headings:text-[var(--ink)] prose-headings:font-serif">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {investigationResult}
                    </ReactMarkdown>
                  </div>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <div className="text-center py-12">
                <Search className="w-16 h-16 text-[var(--muted)] mx-auto mb-4" />
                <p className="text-[var(--ink)] font-medium">Select an Insight</p>
                <p className="text-sm text-[var(--muted)] mt-2">
                  Choose a buyer insight from the list to conduct a deep procurement investigation
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
