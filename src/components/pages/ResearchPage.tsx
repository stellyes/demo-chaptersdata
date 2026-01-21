'use client';

import { useState, useRef, useEffect } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { FileUpload } from '@/components/ui/FileUpload';
import { useAppStore } from '@/store/app-store';
import { FileText, Sparkles, Calendar, Tag, Loader2, ChevronDown, ExternalLink, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { RESEARCH_CATEGORIES } from '@/lib/config';
import { format } from 'date-fns';
import { ResearchDocument } from '@/types';

// Animated collapsible component
function AnimatedCollapse({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>(0);

  useEffect(() => {
    if (isOpen) {
      const contentHeight = contentRef.current?.scrollHeight || 0;
      setHeight(contentHeight);
      const timer = setTimeout(() => setHeight('auto'), 300);
      return () => clearTimeout(timer);
    } else {
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

// Local uploaded document (before saving to S3)
interface LocalDocument {
  id: string;
  filename: string;
  category: string;
  uploadedAt: string;
  summary?: string;
  relevance?: 'high' | 'medium' | 'low';
  key_findings?: Array<{
    finding: string;
    relevance: string;
    category: string;
    action_required: boolean;
    recommended_action?: string;
  }>;
  source?: string;
}

export function ResearchPage() {
  // Get research data from the store (loaded from S3)
  const { researchData, setResearchData, dataStatus } = useAppStore();

  // Local state for newly uploaded documents (before page refresh loads them from S3)
  const [localDocuments, setLocalDocuments] = useState<LocalDocument[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Combine S3 documents with locally uploaded ones
  const allDocuments: LocalDocument[] = [
    ...localDocuments,
    ...researchData.map((doc) => {
      // Extract filename from ID - could be "research-123456" or "research-findings/manual/research-123.json"
      let filename = doc.id;
      if (doc.id.includes('/')) {
        filename = doc.id.split('/').pop()?.replace('.json', '') || doc.id;
      }
      // Format the ID nicely if it's just a timestamp-based ID
      if (filename.startsWith('research-')) {
        const timestamp = filename.replace('research-', '');
        if (!isNaN(Number(timestamp))) {
          try {
            filename = `Research ${format(new Date(Number(timestamp)), 'MMM d, yyyy')}`;
          } catch {
            // Keep original filename
          }
        }
      }

      return {
        id: doc.id,
        filename,
        category: doc.category,
        uploadedAt: doc.date,
        summary: doc.summary,
        relevance: doc.relevance as 'high' | 'medium' | 'low',
        key_findings: doc.key_findings?.map((f) => ({
          finding: f,
          relevance: 'medium',
          category: doc.category,
          action_required: false,
        })),
        source: doc.source,
      };
    }),
  ];

  // Filter documents
  const filteredDocuments = allDocuments.filter((doc) => {
    if (filterCategory && doc.category !== filterCategory) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesFilename = doc.filename.toLowerCase().includes(query);
      const matchesSummary = doc.summary?.toLowerCase().includes(query);
      const matchesCategory = doc.category.toLowerCase().includes(query);
      if (!matchesFilename && !matchesSummary && !matchesCategory) return false;
    }
    return true;
  });

  // Sort by date (newest first)
  const sortedDocuments = filteredDocuments.sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );

  const handleDocumentUpload = async (file: File) => {
    if (!selectedCategory) {
      throw new Error('Please select a category before uploading');
    }

    setAnalyzing(true);

    try {
      const content = await file.text();

      // Call AI analysis API
      const response = await fetch('/api/ai/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          content,
          category: selectedCategory,
          sourceUrl,
        }),
      });

      const result = await response.json();

      if (result.success) {
        const newDoc: LocalDocument = {
          id: result.data.id,
          filename: file.name,
          category: selectedCategory,
          uploadedAt: result.data.analyzed_at,
          summary: result.data.summary,
          relevance: result.data.relevance_score,
          key_findings: result.data.key_findings,
          source: sourceUrl || undefined,
        };

        setLocalDocuments((prev) => [newDoc, ...prev]);

        // Also update the store so it's immediately available
        const storeDoc: ResearchDocument = {
          id: result.data.id,
          date: result.data.analyzed_at,
          category: selectedCategory,
          summary: result.data.summary,
          key_findings: result.data.key_findings?.map((kf: { finding: string }) => kf.finding) || [],
          relevance: result.data.relevance_score,
          source: sourceUrl || undefined,
        };
        setResearchData([storeDoc, ...researchData]);
      } else {
        throw new Error(result.error || 'Analysis failed');
      }

      setSourceUrl('');
    } finally {
      setAnalyzing(false);
    }
  };

  // Get unique categories from documents
  const availableCategories = [...new Set(allDocuments.map((d) => d.category))].filter(Boolean);

  const tabs = [
    {
      id: 'documents',
      label: `Documents (${sortedDocuments.length})`,
      render: () => (
        <div className="space-y-6">
          {/* Filters */}
          <Card>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search documents..."
                    className="w-full pl-10 pr-4 py-2 border border-[var(--border)] rounded text-sm bg-[var(--white)]"
                  />
                </div>
              </div>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="px-3 py-2 border border-[var(--border)] rounded text-sm bg-[var(--white)]"
              >
                <option value="">All Categories</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          {/* Documents List */}
          <Card>
            <SectionLabel>Research Library</SectionLabel>
            <SectionTitle>Industry Research Documents</SectionTitle>

            {!dataStatus.research.loaded && researchData.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[var(--muted)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading research documents...</span>
              </div>
            ) : sortedDocuments.length === 0 ? (
              <p className="text-[var(--muted)] text-center py-8">
                {searchQuery || filterCategory
                  ? 'No documents match your filters.'
                  : 'No documents uploaded yet. Upload HTML articles to get AI-powered insights.'}
              </p>
            ) : (
              <div className="space-y-4 mt-4">
                {sortedDocuments.map((doc) => {
                  const isExpanded = expandedDocId === doc.id;
                  return (
                    <div
                      key={doc.id}
                      className="border border-[var(--border)] rounded-lg overflow-hidden"
                    >
                      <button
                        onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                        className="w-full flex items-start gap-4 p-4 bg-[var(--paper)] hover:bg-[var(--paper)]/80 transition-colors text-left"
                      >
                        <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-[var(--accent)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-[var(--ink)] mb-1 truncate">
                            {doc.filename}
                          </h4>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)] mb-2">
                            <span className="flex items-center gap-1">
                              <Tag className="w-3 h-3" />
                              {doc.category}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {(() => {
                                try {
                                  return format(new Date(doc.uploadedAt), 'MMM d, yyyy');
                                } catch {
                                  return doc.uploadedAt;
                                }
                              })()}
                            </span>
                            {doc.relevance && (
                              <span
                                className={`px-2 py-0.5 rounded text-xs ${
                                  doc.relevance === 'high'
                                    ? 'bg-[var(--success)]/15 text-[var(--success)]'
                                    : doc.relevance === 'medium'
                                    ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
                                    : 'bg-[var(--muted)]/15 text-[var(--muted)]'
                                }`}
                              >
                                {doc.relevance} relevance
                              </span>
                            )}
                            {doc.key_findings && doc.key_findings.length > 0 && (
                              <span className="text-[var(--accent)]">
                                {doc.key_findings.length} findings
                              </span>
                            )}
                          </div>
                          {doc.summary && (
                            <p className="text-sm text-[var(--ink)] line-clamp-2">
                              {doc.summary}
                            </p>
                          )}
                        </div>
                        <ChevronDown
                          className={`w-5 h-5 text-[var(--muted)] transition-transform duration-300 shrink-0 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      <AnimatedCollapse isOpen={isExpanded}>
                        <div className="p-4 border-t border-[var(--border)] bg-[var(--white)]">
                          {/* Source URL */}
                          {doc.source && (
                            <div className="mb-4">
                              <p className="text-xs text-[var(--muted)] mb-1">Source</p>
                              <a
                                href={doc.source}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-[var(--accent)] hover:underline flex items-center gap-1"
                              >
                                {doc.source}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}

                          {/* Full Summary */}
                          {doc.summary && (
                            <div className="mb-4">
                              <p className="text-xs text-[var(--muted)] mb-1">Summary</p>
                              <p className="text-sm text-[var(--ink)]">{doc.summary}</p>
                            </div>
                          )}

                          {/* Key Findings */}
                          {doc.key_findings && doc.key_findings.length > 0 && (
                            <div>
                              <p className="text-xs text-[var(--muted)] mb-2">Key Findings</p>
                              <div className="space-y-3">
                                {doc.key_findings.map((finding, idx) => (
                                  <div
                                    key={idx}
                                    className="p-3 bg-[var(--paper)] rounded-lg border border-[var(--border)]"
                                  >
                                    <div className="flex items-start gap-2">
                                      {finding.action_required ? (
                                        <AlertCircle className="w-4 h-4 text-[var(--warning)] shrink-0 mt-0.5" />
                                      ) : (
                                        <CheckCircle2 className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
                                      )}
                                      <div className="flex-1">
                                        <p className="text-sm text-[var(--ink)]">{finding.finding}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                          <span
                                            className={`text-xs px-1.5 py-0.5 rounded ${
                                              finding.relevance === 'high'
                                                ? 'bg-[var(--success)]/15 text-[var(--success)]'
                                                : finding.relevance === 'medium'
                                                ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
                                                : 'bg-[var(--muted)]/15 text-[var(--muted)]'
                                            }`}
                                          >
                                            {finding.relevance}
                                          </span>
                                          <span className="text-xs text-[var(--muted)]">
                                            {finding.category}
                                          </span>
                                        </div>
                                        {finding.recommended_action && (
                                          <p className="text-xs text-[var(--accent)] mt-2">
                                            Action: {finding.recommended_action}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </AnimatedCollapse>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      ),
    },
    {
      id: 'upload',
      label: 'Upload Documents',
      render: () => (
        <div className="space-y-6">
          <Card>
            <SectionLabel>Document Settings</SectionLabel>
            <SectionTitle>Configure Upload</SectionTitle>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-sm font-medium text-[var(--muted)] block mb-2">
                  Category *
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm bg-[var(--white)]"
                >
                  <option value="">Select category...</option>
                  {RESEARCH_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-[var(--muted)] block mb-2">
                  Source URL (optional)
                </label>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm bg-[var(--white)]"
                />
              </div>
            </div>
          </Card>

          <Card>
            <SectionLabel>Upload HTML Document</SectionLabel>
            <SectionTitle>Add Research Article</SectionTitle>
            <p className="text-sm text-[var(--muted)] mb-4">
              Upload HTML files from web articles. The AI will extract key findings relevant to your
              cannabis retail business.
            </p>
            <FileUpload
              onUpload={handleDocumentUpload}
              accept={{ 'text/html': ['.html', '.htm'], 'text/plain': ['.txt'] }}
              title={analyzing ? 'Analyzing document...' : 'Drop HTML file here'}
              description="Supports HTML and text files"
            />
            {analyzing && (
              <div className="flex items-center justify-center gap-2 mt-4 text-[var(--accent)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">AI is analyzing your document...</span>
              </div>
            )}
          </Card>
        </div>
      ),
    },
    {
      id: 'summary',
      label: 'Monthly Summary',
      render: () => (
        <Card>
          <SectionLabel>Aggregated Insights</SectionLabel>
          <SectionTitle>Monthly Research Summary</SectionTitle>
          <p className="text-[var(--muted)] mb-4">
            Upload multiple research documents to generate a comprehensive monthly summary of
            industry trends, regulatory updates, and competitive insights.
          </p>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Total Documents</p>
              <p className="text-2xl font-semibold font-serif text-[var(--ink)]">
                {allDocuments.length}
              </p>
            </div>
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">High Relevance</p>
              <p className="text-2xl font-semibold font-serif text-[var(--success)]">
                {allDocuments.filter((d) => d.relevance === 'high').length}
              </p>
            </div>
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Categories</p>
              <p className="text-2xl font-semibold font-serif text-[var(--ink)]">
                {availableCategories.length}
              </p>
            </div>
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Key Findings</p>
              <p className="text-2xl font-semibold font-serif text-[var(--ink)]">
                {allDocuments.reduce((sum, d) => sum + (d.key_findings?.length || 0), 0)}
              </p>
            </div>
          </div>

          <button
            disabled={allDocuments.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded text-sm font-medium disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            Generate Monthly Summary
          </button>
        </Card>
      ),
    },
  ];

  return (
    <div>
      <Header title="Industry Research Analysis" subtitle="Manual Research" />
      <Tabs tabs={tabs} />
    </div>
  );
}
