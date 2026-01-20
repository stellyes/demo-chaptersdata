'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { SEO_SITES } from '@/lib/config';
import { Globe, TrendingUp, AlertCircle, CheckCircle, ExternalLink } from 'lucide-react';

interface SEOData {
  site: string;
  score: number;
  priorities: string[];
  quickWins: string[];
  lastUpdated: string;
}

export function SEOPage() {
  const [selectedSite, setSelectedSite] = useState(SEO_SITES[0].id);
  const [seoData, setSeoData] = useState<SEOData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // In production, this would load from S3
    setSeoData({
      site: selectedSite,
      score: 72,
      priorities: [
        'Improve page load speed on mobile devices',
        'Add more internal links between product pages',
        'Optimize meta descriptions for key landing pages',
        'Fix broken links in footer navigation',
      ],
      quickWins: [
        'Add alt text to product images',
        'Create XML sitemap',
        'Add structured data for products',
      ],
      lastUpdated: new Date().toISOString(),
    });
  }, [selectedSite]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-[var(--success)]';
    if (score >= 60) return 'text-[var(--warning)]';
    return 'text-[var(--error)]';
  };

  const tabs = [
    {
      id: 'summary',
      label: 'Summary',
      content: (
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

          {/* Score Card */}
          {seoData && (
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
                  {seoData.priorities.slice(0, 3).map((priority, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <AlertCircle className="w-4 h-4 text-[var(--warning)] mt-0.5 shrink-0" />
                      <span className="text-sm text-[var(--ink)]">{priority}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <SectionLabel>Quick Wins</SectionLabel>
                <SectionTitle>Easy Fixes</SectionTitle>
                <div className="space-y-3">
                  {seoData.quickWins.map((win, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-[var(--success)] mt-0.5 shrink-0" />
                      <span className="text-sm text-[var(--ink)]">{win}</span>
                    </div>
                  ))}
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
      content: (
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
      content: (
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
