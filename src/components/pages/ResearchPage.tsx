'use client';

import { useState } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { FileUpload } from '@/components/ui/FileUpload';
import { FileText, Sparkles, Calendar, Tag, Loader2 } from 'lucide-react';
import { RESEARCH_CATEGORIES } from '@/lib/config';

interface ResearchDocument {
  id: string;
  filename: string;
  category: string;
  uploadedAt: string;
  summary?: string;
  relevance?: 'high' | 'medium' | 'low';
}

export function ResearchPage() {
  const [documents, setDocuments] = useState<ResearchDocument[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

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

      const newDoc: ResearchDocument = {
        id: `doc_${Date.now()}`,
        filename: file.name,
        category: selectedCategory,
        uploadedAt: new Date().toISOString(),
        summary: result.success ? result.data?.summary : 'Analysis pending',
        relevance: result.success ? result.data?.relevance_score : 'medium',
      };

      setDocuments((prev) => [newDoc, ...prev]);
      setSourceUrl('');
    } finally {
      setAnalyzing(false);
    }
  };

  const tabs = [
    {
      id: 'upload',
      label: 'Upload Documents',
      content: (
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
                  className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
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
                  className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
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
      id: 'documents',
      label: 'Documents',
      content: (
        <div className="space-y-4">
          <Card>
            <SectionLabel>Research Library</SectionLabel>
            <SectionTitle>Uploaded Documents</SectionTitle>
            {documents.length === 0 ? (
              <p className="text-[var(--muted)] text-center py-8">
                No documents uploaded yet. Upload HTML articles to get AI-powered insights.
              </p>
            ) : (
              <div className="space-y-4">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-4 bg-[var(--paper)] rounded-lg border border-[var(--border)]"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5 text-[var(--accent)]" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-[var(--ink)] mb-1">{doc.filename}</h4>
                        <div className="flex items-center gap-4 text-xs text-[var(--muted)] mb-2">
                          <span className="flex items-center gap-1">
                            <Tag className="w-3 h-3" />
                            {doc.category}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(doc.uploadedAt).toLocaleDateString()}
                          </span>
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
                        </div>
                        {doc.summary && (
                          <p className="text-sm text-[var(--ink)]">{doc.summary}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ),
    },
    {
      id: 'summary',
      label: 'Monthly Summary',
      content: (
        <Card>
          <SectionLabel>Aggregated Insights</SectionLabel>
          <SectionTitle>Monthly Research Summary</SectionTitle>
          <p className="text-[var(--muted)]">
            Upload multiple research documents to generate a comprehensive monthly summary of
            industry trends, regulatory updates, and competitive insights.
          </p>
          <button
            disabled={documents.length === 0}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded text-sm font-medium disabled:opacity-50"
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
