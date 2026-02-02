'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useAppStore } from '@/store/app-store';
import {
  Lightbulb,
  Search,
  Loader2,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Clock,
  Filter,
  X,
  Download,
  History,
  FileText,
  Calendar,
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

interface BusinessInsight {
  id: string;
  category: string;
  subcategory: string | null;
  insight: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  sourceData: string | null;
  dataRange: string | null;
  createdAt: string;
  validatedAt: string | null;
}

interface PastInvestigation {
  id: string;
  type: string;
  date: string;
  analysis: string;
  summary?: string;
}

const CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'sales', label: 'Sales' },
  { id: 'brands', label: 'Brands' },
  { id: 'customers', label: 'Customers' },
  { id: 'market', label: 'Market' },
  { id: 'trends', label: 'Trends' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'operations', label: 'Operations' },
];

export function InsightInvestigationTab() {
  const { addNotification, hideLoadingOverlay, aiRecommendations, addAiRecommendation } = useAppStore();
  const [insights, setInsights] = useState<BusinessInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInsight, setSelectedInsight] = useState<BusinessInsight | null>(null);
  const [selectedPastInvestigation, setSelectedPastInvestigation] = useState<PastInvestigation | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const [investigationResult, setInvestigationResult] = useState<string | null>(null);
  const [additionalContext, setAdditionalContext] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Filter past investigations from aiRecommendations
  const pastInvestigations = useMemo(() => {
    return aiRecommendations
      .filter(r => r.type === 'investigation')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [aiRecommendations]);

  useEffect(() => {
    loadInsights();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  const loadInsights = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') {
        params.set('categories', selectedCategory);
      }
      params.set('limit', '100');

      const response = await fetch(`/api/ai/insights?${params.toString()}`);

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.slice(0, 500));
        throw new Error('Server returned non-JSON response. Please try again.');
      }

      const result = await response.json();

      if (result.success) {
        setInsights(result.data);
      } else {
        throw new Error(result.error || 'Failed to load insights');
      }
    } catch (error) {
      console.error('Failed to load insights:', error);
      addNotification({
        type: 'error',
        title: 'Failed to Load Insights',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      // Set empty array on error so UI doesn't break
      setInsights([]);
    } finally {
      setLoading(false);
      hideLoadingOverlay();
    }
  };

  const investigateInsight = async () => {
    if (!selectedInsight) return;

    setInvestigating(true);
    setInvestigationResult(null);

    addNotification({
      type: 'info',
      title: 'Investigation Started',
      message: `Analyzing: ${selectedInsight.insight.slice(0, 50)}...`,
    });

    try {
      const response = await fetch('/api/ai/insights/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insightId: selectedInsight.id,
          insight: selectedInsight.insight,
          category: selectedInsight.category,
          additionalContext: additionalContext.trim() || undefined,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setInvestigationResult(result.data.investigation);

        // Add the investigation to the local store using the server-generated ID
        // This ensures consistency with the database-persisted record
        addAiRecommendation({
          id: result.data.investigationId,
          type: 'investigation',
          date: new Date().toISOString(),
          analysis: result.data.investigation,
          summary: selectedInsight.insight.slice(0, 200),
        });

        addNotification({
          type: 'success',
          title: 'Investigation Complete',
          message: 'Deep analysis is ready to view and has been saved.',
        });
      } else {
        throw new Error(result.error);
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

  const selectPastInvestigation = (investigation: PastInvestigation) => {
    setSelectedPastInvestigation(investigation);
    setSelectedInsight(null);
    setInvestigationResult(investigation.analysis);
    setAdditionalContext('');
  };

  const clearSelection = () => {
    setSelectedInsight(null);
    setSelectedPastInvestigation(null);
    setInvestigationResult(null);
    setAdditionalContext('');
  };

  const getConfidenceIcon = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'medium':
        return <Clock className="w-4 h-4 text-amber-500" />;
      case 'low':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return 'bg-green-100 text-green-800';
      case 'medium':
        return 'bg-amber-100 text-amber-800';
      case 'low':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleExport = (exportFormat: 'print' | 'markdown') => {
    if (!investigationResult) return;

    const insightText = selectedInsight?.insight || selectedPastInvestigation?.summary || 'Investigation';
    const category = selectedInsight?.category || 'general';

    const timestamp = format(new Date(), 'yyyy-MM-dd-HHmm');
    const content = `# Insight Investigation\n\n**Category:** ${category}\n\n**Original Insight:** ${insightText}\n\n---\n\n${investigationResult}`;

    const options = {
      filename: `insight-investigation-${timestamp}`,
      title: 'Insight Investigation',
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        <span className="ml-3 text-[var(--muted)]">Loading insights...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
            <Lightbulb className="w-6 h-6 text-[var(--accent)]" />
          </div>
          <div className="flex-1">
            <SectionLabel>Progressive Learning</SectionLabel>
            <SectionTitle>Insight Investigation</SectionTitle>
            <p className="text-sm text-[var(--muted)] mt-1">
              Select an insight from the Progressive Learning System to conduct a deep investigation.
              The AI will analyze current data, identify root causes, and provide actionable recommendations.
            </p>
          </div>
        </div>

        {/* Stats in Header */}
        {(insights.length > 0 || pastInvestigations.length > 0) && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mt-6">
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-[var(--ink)]">
                {insights.length}
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">Total Insights</p>
            </div>
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-green-600">
                {insights.filter((i) => i.confidence === 'high').length}
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">High Confidence</p>
            </div>
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-amber-600">
                {insights.filter((i) => i.confidence === 'medium').length}
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">Medium Confidence</p>
            </div>
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-[var(--accent)]">
                {new Set(insights.map((i) => i.category)).size}
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">Categories</p>
            </div>
            <div className="p-3 md:p-4 bg-[var(--paper)] rounded-lg text-center">
              <p className="text-xl md:text-2xl font-semibold font-serif text-blue-600">
                {pastInvestigations.length}
              </p>
              <p className="text-xs md:text-sm text-[var(--muted)]">Investigations</p>
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
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-[var(--ink)] text-[var(--paper)]'
                      : 'bg-[var(--paper)] text-[var(--muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </Card>

          {/* Insights List */}
          <Card>
            <SectionLabel>Available Insights</SectionLabel>
            <SectionTitle>Select an Insight to Investigate</SectionTitle>

            {insights.length === 0 ? (
              <div className="text-center py-8">
                <Lightbulb className="w-12 h-12 text-[var(--muted)] mx-auto mb-3" />
                <p className="text-[var(--muted)]">No insights found.</p>
                <p className="text-sm text-[var(--muted)] mt-1">
                  Run the Progressive Learning System to generate insights.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-2 max-h-[400px] overflow-y-auto">
                {insights.map((insight) => (
                  <button
                    key={insight.id}
                    onClick={() => {
                      setSelectedInsight(insight);
                      setSelectedPastInvestigation(null);
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
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${getConfidenceColor(insight.confidence)}`}>
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
            )}
          </Card>

          {/* Past Investigations */}
          {pastInvestigations.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <History className="w-4 h-4 text-[var(--accent)]" />
                <SectionLabel>Past Investigations</SectionLabel>
              </div>
              <SectionTitle>Previously Completed</SectionTitle>
              <div className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
                {pastInvestigations.map((investigation) => (
                  <button
                    key={investigation.id}
                    onClick={() => selectPastInvestigation(investigation)}
                    className={`w-full text-left p-4 rounded-lg border transition-all ${
                      selectedPastInvestigation?.id === investigation.id
                        ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                        : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-[var(--accent)]" />
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800">
                            Completed
                          </span>
                        </div>
                        <p className="text-sm text-[var(--ink)] line-clamp-2">
                          {investigation.summary || 'Investigation Analysis'}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-[var(--muted)] mt-2">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(investigation.date), 'MMM d, yyyy h:mm a')}
                        </div>
                      </div>
                      <ChevronRight className={`w-5 h-5 shrink-0 transition-colors ${
                        selectedPastInvestigation?.id === investigation.id
                          ? 'text-[var(--accent)]'
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
          {selectedInsight ? (
            <>
              {/* Selected Insight Card */}
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <SectionLabel>Selected Insight</SectionLabel>
                    <div className="flex items-center gap-2 mt-2 mb-3">
                      {getConfidenceIcon(selectedInsight.confidence)}
                      <span className="text-xs font-medium text-[var(--muted)] capitalize">
                        {selectedInsight.confidence} confidence • {selectedInsight.category}
                      </span>
                    </div>
                    <p className="text-[var(--ink)]">{selectedInsight.insight}</p>
                  </div>
                  <button
                    onClick={clearSelection}
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
                    placeholder="Add any specific questions or context you want the investigation to address..."
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
                      <SectionTitle>Deep Analysis</SectionTitle>
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
          ) : selectedPastInvestigation ? (
            <>
              {/* Past Investigation View */}
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <SectionLabel>Past Investigation</SectionLabel>
                    <div className="flex items-center gap-2 mt-2 mb-3">
                      <History className="w-4 h-4 text-[var(--accent)]" />
                      <span className="text-xs font-medium text-[var(--muted)]">
                        {format(new Date(selectedPastInvestigation.date), 'MMM d, yyyy h:mm a')}
                      </span>
                    </div>
                    {selectedPastInvestigation.summary && (
                      <p className="text-[var(--ink)]">{selectedPastInvestigation.summary}</p>
                    )}
                  </div>
                  <button
                    onClick={clearSelection}
                    className="p-1 text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </Card>

              {/* Investigation Results */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <SectionLabel>Investigation Results</SectionLabel>
                    <SectionTitle>Deep Analysis</SectionTitle>
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
                    {investigationResult || ''}
                  </ReactMarkdown>
                </div>
              </Card>
            </>
          ) : (
            <Card>
              <div className="text-center py-12">
                <Search className="w-16 h-16 text-[var(--muted)] mx-auto mb-4" />
                <p className="text-[var(--ink)] font-medium">Select an Insight</p>
                <p className="text-sm text-[var(--muted)] mt-2">
                  Choose an insight from the list to conduct a deep investigation,
                  or select a past investigation to review.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>

    </div>
  );
}
