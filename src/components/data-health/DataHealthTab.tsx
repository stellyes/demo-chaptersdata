'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useFilteredSalesData, useNormalizedBrandDataCompat, useAppStore } from '@/store/app-store';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle,
  Info,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { EXAMPLE_HEALTH_REPORT } from '@/lib/demo-data/example-health';

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

export function DataHealthTab() {
  const salesData = useFilteredSalesData();
  const brandData = useNormalizedBrandDataCompat();
  const { customerData, invoiceData, addNotification, currentOrganization } = useAppStore();

  // Health check state
  const [healthCheckData, setHealthCheckData] = useState<HealthCheckReport | null>(EXAMPLE_HEALTH_REPORT as HealthCheckReport);
  const [healthCheckLoading, setHealthCheckLoading] = useState(false);
  const [healthCheckError, setHealthCheckError] = useState<string | null>(null);

  // Fetch latest health check from API
  const fetchHealthCheck = async () => {
    try {
      const headers: Record<string, string> = {};
      if (currentOrganization?.orgId) {
        headers['X-Org-Id'] = currentOrganization.orgId;
      }
      const response = await fetch('/api/ai/health-check', { headers });
      const result = await response.json();
      if (result.success && result.data.report) {
        setHealthCheckData(result.data.report);
        setHealthCheckError(null);
      }
      // If API returns empty, keep demo data
    } catch (error) {
      console.error('Failed to fetch health check:', error);
      // Keep demo data on error
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
        headers: {
          'Content-Type': 'application/json',
          ...(currentOrganization?.orgId && { 'X-Org-Id': currentOrganization.orgId }),
        },
        // Note: Invoice data is loaded server-side to avoid huge request payloads
        body: JSON.stringify({
          sales: salesData,
          brands: brandData,
          customers: customerData,
          // invoices omitted - loaded from DB server-side
        }),
      });

      const result = await response.json();

      if (result.success && result.data.report) {
        setHealthCheckData(result.data.report);

        const score = result.data.report.summary.overallHealthScore;
        const criticalGaps = result.data.report.summary.criticalGaps;

        addNotification({
          type: score >= 80 ? 'success' : score >= 50 ? 'info' : 'error',
          title: 'Health Check Complete',
          message: `Score: ${score}/100${criticalGaps > 0 ? ` - ${criticalGaps} critical issues found` : ''}`,
        });
      } else {
        // Keep demo data on failure, just show error
        addNotification({
          type: 'error',
          title: 'Health Check Failed',
          message: result.error || 'An error occurred',
        });
      }
    } catch (error) {
      // Keep demo data on error
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

  return (
    <div className="space-y-6">
      {/* Health Score Overview */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
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
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 sm:py-2 bg-[var(--ink)] text-[var(--paper)] rounded text-sm font-medium disabled:opacity-50"
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
  );
}
