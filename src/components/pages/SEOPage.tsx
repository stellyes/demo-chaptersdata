'use client';

import { useState, useMemo } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { SEO_SITES } from '@/lib/config';
import { useAppStore } from '@/store/app-store';
import { Globe, AlertCircle, CheckCircle, ExternalLink, Loader2 } from 'lucide-react';

export function SEOPage() {
  const [selectedSite, setSelectedSite] = useState(SEO_SITES[0].id);
  const { seoData: storeSeoData, dataStatus, isLoading } = useAppStore();

  // Find SEO data for the selected site from the store
  const seoData = useMemo(() => {
    if (!storeSeoData || storeSeoData.length === 0) return null;

    // Map site IDs to display names for matching
    const siteNameMap: Record<string, string> = {
      'barbarycoastsf': 'Barbary Coast',
      'grassrootssf': 'Grass Roots',
    };

    const displayName = siteNameMap[selectedSite];
    return storeSeoData.find(s => s.site === displayName) || null;
  }, [storeSeoData, selectedSite]);

  const loading = isLoading || !dataStatus.seo.loaded;

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-[var(--success)]';
    if (score >= 60) return 'text-[var(--warning)]';
    return 'text-[var(--error)]';
  };

  const tabs = [
    {
      id: 'summary',
      label: 'Summary',
      render: () => (
        <div className="space-y-6">
          {/* Site Selector */}
          <Card>
            <SectionLabel>Website</SectionLabel>
            <SectionTitle>Select Site to Analyze</SectionTitle>
            <div className="flex gap-4">
              {SEO_SITES.map((site) => (
                <button
                  key={site.id}
                  onClick={() => setSelectedSite(site.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded border transition-all ${
                    selectedSite === site.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                      : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                  }`}
                >
                  <Globe
                    className={`w-5 h-5 ${
                      selectedSite === site.id ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                    }`}
                  />
                  <div className="text-left">
                    <p className="font-medium text-[var(--ink)]">{site.name}</p>
                    <p className="text-xs text-[var(--muted)]">{site.url}</p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-[var(--muted)] ml-2" />
                </button>
              ))}
            </div>
          </Card>

          {/* Loading State */}
          {loading && (
            <Card>
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
                <span className="ml-3 text-[var(--muted)]">Loading SEO data from S3...</span>
              </div>
            </Card>
          )}

          {/* No Data State */}
          {!loading && !seoData && (
            <Card>
              <div className="text-center py-12">
                <Globe className="w-12 h-12 mx-auto text-[var(--muted)] mb-4" />
                <SectionTitle>No SEO Data Available</SectionTitle>
                <p className="text-[var(--muted)] mt-2">
                  No SEO analysis has been uploaded for this site yet.
                  <br />
                  Upload SEO analysis JSON files to <code className="bg-[var(--background)] px-1 rounded">seo-analysis/{selectedSite}/</code> in S3.
                </p>
              </div>
            </Card>
          )}

          {/* Score Card */}
          {!loading && seoData && (
            <div className="grid grid-cols-3 gap-6">
              <Card>
                <SectionLabel>Overall Score</SectionLabel>
                <div className="flex items-end gap-2 mt-4">
                  <span className={`text-5xl font-serif font-bold ${getScoreColor(seoData.score)}`}>
                    {seoData.score}
                  </span>
                  <span className="text-2xl text-[var(--muted)] mb-1">/100</span>
                </div>
                <p className="text-sm text-[var(--muted)] mt-2">
                  Last analyzed: {new Date(seoData.lastUpdated).toLocaleDateString()}
                </p>
              </Card>

              <Card>
                <SectionLabel>Top Priorities</SectionLabel>
                <SectionTitle>Action Items</SectionTitle>
                <div className="space-y-3">
                  {seoData.priorities.length > 0 ? (
                    seoData.priorities.slice(0, 3).map((priority, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <AlertCircle className="w-4 h-4 text-[var(--warning)] mt-0.5 shrink-0" />
                        <span className="text-sm text-[var(--ink)]">{priority}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--muted)]">No priorities identified</p>
                  )}
                </div>
              </Card>

              <Card>
                <SectionLabel>Quick Wins</SectionLabel>
                <SectionTitle>Easy Fixes</SectionTitle>
                <div className="space-y-3">
                  {seoData.quickWins.length > 0 ? (
                    seoData.quickWins.map((win, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <CheckCircle className="w-4 h-4 text-[var(--success)] mt-0.5 shrink-0" />
                        <span className="text-sm text-[var(--ink)]">{win}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--muted)]">No quick wins identified</p>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'details',
      label: 'Detailed Analysis',
      render: () => (
        <Card>
          <SectionLabel>SEO Breakdown</SectionLabel>
          <SectionTitle>Detailed Metrics</SectionTitle>
          <p className="text-[var(--muted)]">
            Detailed SEO analysis metrics will be displayed here, including page-by-page scores,
            technical issues, and content recommendations.
          </p>
        </Card>
      ),
    },
    {
      id: 'history',
      label: 'History',
      render: () => (
        <Card>
          <SectionLabel>Score Tracking</SectionLabel>
          <SectionTitle>Historical Performance</SectionTitle>
          <p className="text-[var(--muted)]">
            Track your SEO score improvements over time with historical data visualization.
          </p>
        </Card>
      ),
    },
  ];

  return (
    <div>
      <Header title="Website SEO Performance" subtitle="SEO Analysis" />
      <Tabs tabs={tabs} />
    </div>
  );
}
