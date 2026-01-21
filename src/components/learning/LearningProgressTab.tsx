'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useAppStore } from '@/store/app-store';
import {
  Activity,
  Brain,
  Calendar,
  CheckCircle,
  ChevronDown,
  Clock,
  FileText,
  Loader2,
  PlayCircle,
  Search,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';

interface DailyDigest {
  executiveSummary: string;
  priorityActions: Array<{ action: string; timeframe: string; impact: string; category: string }>;
  quickWins: Array<{ action: string; effort: string; impact: string }>;
  watchItems: Array<{ item: string; reason: string; monitorUntil: string }>;
  industryHighlights: Array<{ headline: string; source: string; relevance: string; actionItem?: string }>;
  regulatoryUpdates: Array<{ update: string; source: string; impactLevel: 'high' | 'medium' | 'low'; deadline?: string }>;
  marketTrends: Array<{ trend: string; evidence: string; implication: string }>;
  questionsForTomorrow: Array<{ question: string; priority: number; category: string }>;
  correlatedInsights: Array<{
    internalObservation: string;
    externalEvidence: string;
    correlation: string;
    confidence: number;
    actionItem?: string;
    category: string;
  }>;
  dataHealthScore: number;
  confidenceScore: number;
}

interface LearningJob {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  currentPhase: string | null;
  questionsGenerated: number;
  insightsDiscovered: number;
  searchesUsed: number;
  estimatedCost: number;
  dataReviewDone: boolean;
  questionGenDone: boolean;
  webResearchDone: boolean;
  correlationDone: boolean;
  digestGenDone: boolean;
}

interface CurrentJobStatus {
  isRunning: boolean;
  currentJob: {
    id: string;
    phase: string;
    startedAt: string;
    progress: number;
  } | null;
}

export function LearningProgressTab() {
  const { hideLoadingOverlay } = useAppStore();
  const [latestDigest, setLatestDigest] = useState<DailyDigest | null>(null);
  const [latestJob, setLatestJob] = useState<{ id: string; status: string; completedAt: string | null } | null>(null);
  const [jobHistory, setJobHistory] = useState<LearningJob[]>([]);
  const [currentStatus, setCurrentStatus] = useState<CurrentJobStatus>({ isRunning: false, currentJob: null });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['summary', 'actions']));

  // Load data on mount
  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [digestRes, historyRes, statusRes] = await Promise.all([
        fetch('/api/ai/learning/digest'),
        fetch('/api/ai/learning/history'),
        fetch('/api/ai/learning/status'),
      ]);

      const [digestData, historyData, statusData] = await Promise.all([
        digestRes.json(),
        historyRes.json(),
        statusRes.json(),
      ]);

      if (digestData.success && digestData.data.digest) {
        setLatestDigest(digestData.data.digest);
        setLatestJob(digestData.data.job);
      }

      if (historyData.success) {
        setJobHistory(historyData.data);
      }

      if (statusData.success) {
        setCurrentStatus(statusData.data);
      }
    } catch (error) {
      console.error('Failed to load learning data:', error);
    } finally {
      setLoading(false);
      hideLoadingOverlay();
    }
  };

  const triggerLearning = async (skipWebResearch: boolean = false) => {
    setRunning(true);
    try {
      const response = await fetch('/api/ai/learning/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipWebResearch }),
      });

      const result = await response.json();
      if (result.success) {
        await loadData();
      } else {
        alert(result.error || 'Failed to run learning');
      }
    } catch (error) {
      console.error('Failed to trigger learning:', error);
      alert('Failed to trigger learning');
    } finally {
      setRunning(false);
    }
  };

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const getPhaseLabel = (phase: string | null): string => {
    switch (phase) {
      case 'data_review': return 'Reviewing Data';
      case 'question_gen': return 'Generating Questions';
      case 'web_research': return 'Researching Web';
      case 'correlation': return 'Finding Correlations';
      case 'digest_gen': return 'Creating Digest';
      default: return 'Processing';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'running': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getImpactColor = (level: string) => {
    switch (level) {
      case 'high': return 'text-red-600 bg-red-50';
      case 'medium': return 'text-amber-600 bg-amber-50';
      case 'low': return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        <span className="ml-3 text-[var(--muted)]">Loading learning progress...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <Card>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
              <Brain className="w-6 h-6 text-[var(--accent)]" />
            </div>
            <div>
              <SectionLabel>Progressive Learning</SectionLabel>
              <SectionTitle>Daily Intelligence System</SectionTitle>
              <p className="text-sm text-[var(--muted)] mt-1">
                Autonomous daily analysis of your data combined with web research
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => triggerLearning(true)}
              disabled={running || currentStatus.isRunning}
              className="flex items-center gap-2 px-4 py-2 border border-[var(--border)] rounded text-sm font-medium hover:bg-[var(--paper)] disabled:opacity-50"
            >
              <PlayCircle className="w-4 h-4" />
              Quick Run
            </button>
            <button
              onClick={() => triggerLearning(false)}
              disabled={running || currentStatus.isRunning}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded text-sm font-medium disabled:opacity-50"
            >
              {running || currentStatus.isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <PlayCircle className="w-4 h-4" />
                  Full Run
                </>
              )}
            </button>
          </div>
        </div>

        {/* Current Job Progress */}
        {currentStatus.isRunning && currentStatus.currentJob && (
          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-800">
                {getPhaseLabel(currentStatus.currentJob.phase)}
              </span>
              <span className="text-sm text-blue-600">
                {Math.round(currentStatus.currentJob.progress)}%
              </span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${currentStatus.currentJob.progress}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Latest Digest Summary */}
      {latestDigest && (
        <>
          {/* Scores */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 text-center">
              <p className="text-3xl font-bold font-serif text-[var(--accent)]">
                {latestDigest.dataHealthScore}
              </p>
              <p className="text-xs text-[var(--muted)]">Data Health Score</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-3xl font-bold font-serif">
                {Math.round(latestDigest.confidenceScore * 100)}%
              </p>
              <p className="text-xs text-[var(--muted)]">Confidence</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-3xl font-bold font-serif text-amber-600">
                {latestDigest.priorityActions.length}
              </p>
              <p className="text-xs text-[var(--muted)]">Priority Actions</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-3xl font-bold font-serif text-green-600">
                {latestDigest.quickWins.length}
              </p>
              <p className="text-xs text-[var(--muted)]">Quick Wins</p>
            </Card>
          </div>

          {/* Executive Summary */}
          <Card>
            <button
              onClick={() => toggleSection('summary')}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-[var(--accent)]" />
                <SectionTitle>Executive Summary</SectionTitle>
              </div>
              <ChevronDown className={`w-5 h-5 transition-transform ${expandedSections.has('summary') ? 'rotate-180' : ''}`} />
            </button>
            {expandedSections.has('summary') && (
              <div className="mt-4 p-4 bg-[var(--paper)] rounded-lg">
                <p className="text-sm text-[var(--ink)] whitespace-pre-wrap">{latestDigest.executiveSummary}</p>
                {latestJob?.completedAt && (
                  <p className="text-xs text-[var(--muted)] mt-4">
                    Generated: {format(new Date(latestJob.completedAt), 'MMM d, yyyy h:mm a')}
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Priority Actions */}
          {latestDigest.priorityActions.length > 0 && (
            <Card>
              <button
                onClick={() => toggleSection('actions')}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-[var(--accent)]" />
                  <SectionTitle>Priority Actions ({latestDigest.priorityActions.length})</SectionTitle>
                </div>
                <ChevronDown className={`w-5 h-5 transition-transform ${expandedSections.has('actions') ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.has('actions') && (
                <div className="mt-4 space-y-3">
                  {latestDigest.priorityActions.map((action, i) => (
                    <div key={i} className="p-4 bg-[var(--paper)] rounded-lg border-l-4 border-l-amber-500">
                      <p className="font-medium text-[var(--ink)]">{action.action}</p>
                      <div className="flex gap-4 mt-2 text-xs text-[var(--muted)]">
                        <span>Timeframe: {action.timeframe}</span>
                        <span>Impact: {action.impact}</span>
                        <span className="px-2 py-0.5 bg-[var(--accent)]/10 text-[var(--accent)] rounded">{action.category}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Quick Wins */}
          {latestDigest.quickWins.length > 0 && (
            <Card>
              <button
                onClick={() => toggleSection('quickwins')}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <SectionTitle>Quick Wins ({latestDigest.quickWins.length})</SectionTitle>
                </div>
                <ChevronDown className={`w-5 h-5 transition-transform ${expandedSections.has('quickwins') ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.has('quickwins') && (
                <div className="mt-4 space-y-2">
                  {latestDigest.quickWins.map((win, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-[var(--ink)]">{win.action}</p>
                        <p className="text-xs text-[var(--muted)]">Effort: {win.effort} | Impact: {win.impact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Industry & Market */}
          {(latestDigest.industryHighlights.length > 0 || latestDigest.marketTrends.length > 0) && (
            <Card>
              <button
                onClick={() => toggleSection('market')}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <Search className="w-5 h-5 text-[var(--accent)]" />
                  <SectionTitle>Market Intelligence</SectionTitle>
                </div>
                <ChevronDown className={`w-5 h-5 transition-transform ${expandedSections.has('market') ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.has('market') && (
                <div className="mt-4 space-y-4">
                  {latestDigest.industryHighlights.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-[var(--muted)] mb-2">Industry Highlights</h4>
                      <div className="space-y-2">
                        {latestDigest.industryHighlights.map((item, i) => (
                          <div key={i} className="p-3 bg-[var(--paper)] rounded-lg">
                            <p className="text-sm font-medium text-[var(--ink)]">{item.headline}</p>
                            <p className="text-xs text-[var(--muted)] mt-1">Source: {item.source} | {item.relevance}</p>
                            {item.actionItem && (
                              <p className="text-xs text-[var(--accent)] mt-1">→ {item.actionItem}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {latestDigest.marketTrends.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-[var(--muted)] mb-2">Market Trends</h4>
                      <div className="space-y-2">
                        {latestDigest.marketTrends.map((trend, i) => (
                          <div key={i} className="p-3 bg-[var(--paper)] rounded-lg">
                            <p className="text-sm font-medium text-[var(--ink)]">{trend.trend}</p>
                            <p className="text-xs text-[var(--muted)] mt-1">{trend.evidence}</p>
                            <p className="text-xs text-[var(--accent)] mt-1">Implication: {trend.implication}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Regulatory Updates */}
          {latestDigest.regulatoryUpdates.length > 0 && (
            <Card>
              <button
                onClick={() => toggleSection('regulatory')}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <Activity className="w-5 h-5 text-red-500" />
                  <SectionTitle>Regulatory Updates ({latestDigest.regulatoryUpdates.length})</SectionTitle>
                </div>
                <ChevronDown className={`w-5 h-5 transition-transform ${expandedSections.has('regulatory') ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.has('regulatory') && (
                <div className="mt-4 space-y-2">
                  {latestDigest.regulatoryUpdates.map((update, i) => (
                    <div key={i} className="p-3 bg-[var(--paper)] rounded-lg">
                      <div className="flex items-start justify-between">
                        <p className="text-sm font-medium text-[var(--ink)]">{update.update}</p>
                        <span className={`px-2 py-0.5 text-xs rounded ${getImpactColor(update.impactLevel)}`}>
                          {update.impactLevel}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--muted)] mt-1">
                        Source: {update.source}
                        {update.deadline && ` | Deadline: ${update.deadline}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {/* No Digest Message */}
      {!latestDigest && (
        <Card>
          <div className="text-center py-8">
            <Brain className="w-16 h-16 text-[var(--muted)] mx-auto mb-4" />
            <p className="text-[var(--muted)]">No learning digest available yet.</p>
            <p className="text-sm text-[var(--muted)] mt-2">
              Click "Full Run" to generate your first daily intelligence digest.
            </p>
          </div>
        </Card>
      )}

      {/* Job History */}
      {jobHistory.length > 0 && (
        <Card>
          <SectionLabel>Job History</SectionLabel>
          <SectionTitle>Recent Learning Jobs</SectionTitle>
          <div className="mt-4 space-y-2">
            {jobHistory.slice(0, 10).map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between p-3 bg-[var(--paper)] rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {getStatusIcon(job.status)}
                  <div>
                    <p className="text-sm font-medium text-[var(--ink)]">
                      {format(new Date(job.startedAt), 'MMM d, yyyy h:mm a')}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {job.questionsGenerated} questions • {job.insightsDiscovered} insights • {job.searchesUsed} searches
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded ${
                    job.status === 'completed' ? 'bg-green-100 text-green-800' :
                    job.status === 'failed' ? 'bg-red-100 text-red-800' :
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {job.status}
                  </span>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    ${job.estimatedCost.toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
