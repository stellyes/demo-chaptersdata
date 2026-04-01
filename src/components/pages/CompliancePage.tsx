'use client';

import { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from '@/components/ui/Header';
import { Tabs } from '@/components/ui/Tabs';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Activity,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  Filter,
  XCircle,
  Eye,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ComplianceScan {
  id: string;
  storefrontId: string | null;
  scanType: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  recordsScanned: number;
  risksFound: number;
  criticalRisks: number;
  highRisks: number;
  alertCount: number;
  s3ResultsPath: string | null;
}

interface ComplianceAlert {
  id: string;
  scanId: string;
  storefrontId: string | null;
  ruleId: string | null;
  riskLevel: string;
  riskScore: number;
  detectionMethod: string;
  violation: string;
  salesLineItemId: string | null;
  productName: string | null;
  productType: string | null;
  field: string | null;
  actualValue: string | null;
  limitValue: string | null;
  recommendation: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedNote: string | null;
  createdAt: string;
}

interface ComplianceRule {
  id: string;
  ruleId: string;
  jurisdiction: string;
  complianceArea: string;
  productTypes: string[];
  ruleType: string;
  condition: Record<string, unknown>;
  enforcedBy: string | null;
  penalty: string | null;
  severity: string;
  isActive: boolean;
  version: number;
  lastVerified: string;
}

interface RuleFacets {
  jurisdictions: { value: string; count: number }[];
  complianceAreas: { value: string; count: number }[];
  ruleTypes: { value: string; count: number }[];
  severities: { value: string; count: number }[];
}

// ─── Helper Components ──────────────────────────────────────────────────────

const RiskBadge = ({ level }: { level: string }) => {
  const colors: Record<string, string> = {
    critical: 'bg-red-100 text-red-800 border-red-200',
    high: 'bg-orange-100 text-orange-800 border-orange-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-green-100 text-green-800 border-green-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors[level] || 'bg-gray-100 text-gray-800 border-gray-200'}`}>
      {level}
    </span>
  );
};

const MethodBadge = ({ method }: { method: string }) => {
  const colors: Record<string, string> = {
    rules_engine: 'bg-blue-50 text-blue-700 border-blue-200',
    ml_model: 'bg-purple-50 text-purple-700 border-purple-200',
    hybrid: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  };
  const labels: Record<string, string> = {
    rules_engine: 'Rules',
    ml_model: 'ML',
    hybrid: 'Hybrid',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors[method] || 'bg-gray-50 text-gray-700 border-gray-200'}`}>
      {labels[method] || method}
    </span>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    running: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status === 'running' && <Activity className="w-3 h-3 mr-1 animate-pulse" />}
      {status}
    </span>
  );
};

const MetricCard = ({ label, value, icon: Icon, color = 'var(--ink)' }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
}) => (
  <div className="bg-[var(--paper)] border border-[var(--border)] rounded-lg p-4">
    <div className="flex items-center gap-2 mb-1">
      <Icon className="w-4 h-4" style={{ color }} />
      <span className="text-xs text-[var(--muted)] uppercase tracking-wider">{label}</span>
    </div>
    <div className="text-2xl font-serif font-semibold" style={{ color }}>{value}</div>
  </div>
);

const EmptyState = ({ message }: { message: string }) => (
  <div className="flex flex-col items-center justify-center py-16 text-[var(--muted)]">
    <ShieldAlert className="w-12 h-12 mb-3 opacity-30" />
    <p className="text-sm">{message}</p>
  </div>
);

// ─── Scan History Tab ───────────────────────────────────────────────────────

const ScanHistoryTab = memo(function ScanHistoryTab() {
  const [scans, setScans] = useState<ComplianceScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadScans = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/compliance/scan?page=${p}&pageSize=10`);
      const json = await res.json();
      if (json.success) {
        setScans(json.data);
        setTotalPages(json.pagination.totalPages);
      }
    } catch (err) {
      console.error('Failed to load scans:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadScans(page); }, [page, loadScans]);

  // Summary metrics from latest scan
  const latestScan = scans[0];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {latestScan && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Last Scan"
            value={new Date(latestScan.startedAt).toLocaleDateString()}
            icon={Clock}
          />
          <MetricCard
            label="Records Scanned"
            value={latestScan.recordsScanned.toLocaleString()}
            icon={Activity}
          />
          <MetricCard
            label="Critical Risks"
            value={latestScan.criticalRisks}
            icon={AlertTriangle}
            color="var(--error)"
          />
          <MetricCard
            label="Total Alerts"
            value={latestScan.alertCount}
            icon={ShieldAlert}
            color="var(--warning)"
          />
        </div>
      )}

      {/* Scan Table */}
      <div className="bg-[var(--paper)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium text-[var(--ink)]">Scan History</h3>
          <button
            onClick={() => loadScans(page)}
            className="p-1.5 rounded hover:bg-[var(--accent)]/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 text-[var(--muted)] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading && scans.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-[var(--muted)]" />
          </div>
        ) : scans.length === 0 ? (
          <EmptyState message="No compliance scans yet. Trigger a scan to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
                  <th className="text-left px-4 py-2 text-xs text-[var(--muted)] uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2 text-xs text-[var(--muted)] uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-2 text-xs text-[var(--muted)] uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-2 text-xs text-[var(--muted)] uppercase tracking-wider">Scanned</th>
                  <th className="text-right px-4 py-2 text-xs text-[var(--muted)] uppercase tracking-wider">Critical</th>
                  <th className="text-right px-4 py-2 text-xs text-[var(--muted)] uppercase tracking-wider">High</th>
                  <th className="text-right px-4 py-2 text-xs text-[var(--muted)] uppercase tracking-wider">Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {scans.map(scan => (
                  <tr key={scan.id} className="hover:bg-[var(--accent)]/5 transition-colors">
                    <td className="px-4 py-3 text-[var(--ink)]">
                      {new Date(scan.startedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">{scan.scanType}</td>
                    <td className="px-4 py-3"><StatusBadge status={scan.status} /></td>
                    <td className="px-4 py-3 text-right text-[var(--ink)]">{scan.recordsScanned.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={scan.criticalRisks > 0 ? 'text-red-600 font-medium' : 'text-[var(--muted)]'}>
                        {scan.criticalRisks}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={scan.highRisks > 0 ? 'text-orange-600 font-medium' : 'text-[var(--muted)]'}>
                        {scan.highRisks}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--ink)]">{scan.alertCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-xs text-[var(--muted)]">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Active Alerts Tab ──────────────────────────────────────────────────────

const ActiveAlertsTab = memo(function ActiveAlertsTab() {
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [riskFilter, setRiskFilter] = useState<string>('');
  const [methodFilter, setMethodFilter] = useState<string>('');
  const [showResolved, setShowResolved] = useState(false);
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ unresolvedByRisk: Record<string, number>; totalUnresolved: number }>({
    unresolvedByRisk: {},
    totalUnresolved: 0,
  });

  const loadAlerts = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        pageSize: '25',
        isResolved: String(showResolved),
        sortBy: 'riskScore',
        sortOrder: 'desc',
      });
      if (riskFilter) params.set('riskLevel', riskFilter);
      if (methodFilter) params.set('detectionMethod', methodFilter);

      const res = await fetch(`/api/compliance/alerts?${params}`);
      const json = await res.json();
      if (json.success) {
        setAlerts(json.data);
        setTotalPages(json.pagination.totalPages);
        setTotalCount(json.pagination.totalCount);
        if (json.summary) setSummary(json.summary);
      }
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setLoading(false);
    }
  }, [riskFilter, methodFilter, showResolved]);

  useEffect(() => { loadAlerts(page); }, [page, loadAlerts]);
  useEffect(() => { setPage(1); }, [riskFilter, methodFilter, showResolved]);

  const handleResolve = async (alertId: string, note: string = '') => {
    try {
      const res = await fetch('/api/compliance/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertIds: [alertId],
          isResolved: true,
          resolvedBy: 'dashboard',
          resolvedNote: note || 'Resolved via compliance dashboard',
        }),
      });
      const json = await res.json();
      if (json.success) {
        loadAlerts(page);
      }
    } catch (err) {
      console.error('Failed to resolve alert:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Risk Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard
          label="Total Unresolved"
          value={summary.totalUnresolved}
          icon={ShieldAlert}
        />
        <MetricCard
          label="Critical"
          value={summary.unresolvedByRisk.critical || 0}
          icon={XCircle}
          color="var(--error)"
        />
        <MetricCard
          label="High"
          value={summary.unresolvedByRisk.high || 0}
          icon={AlertTriangle}
          color="#ea580c"
        />
        <MetricCard
          label="Medium"
          value={summary.unresolvedByRisk.medium || 0}
          icon={Eye}
          color="#ca8a04"
        />
        <MetricCard
          label="Low"
          value={summary.unresolvedByRisk.low || 0}
          icon={CheckCircle2}
          color="var(--success)"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter:</span>
        </div>
        <select
          value={riskFilter}
          onChange={e => setRiskFilter(e.target.value)}
          className="text-xs border border-[var(--border)] rounded px-2 py-1 bg-[var(--paper)] text-[var(--ink)]"
        >
          <option value="">All Risk Levels</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={methodFilter}
          onChange={e => setMethodFilter(e.target.value)}
          className="text-xs border border-[var(--border)] rounded px-2 py-1 bg-[var(--paper)] text-[var(--ink)]"
        >
          <option value="">All Methods</option>
          <option value="rules_engine">Rules Engine</option>
          <option value="ml_model">ML Classifier</option>
          <option value="hybrid">Hybrid</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={e => setShowResolved(e.target.checked)}
            className="rounded"
          />
          Show Resolved
        </label>
        <span className="text-xs text-[var(--muted)] ml-auto">{totalCount} alerts</span>
      </div>

      {/* Alert List */}
      <div className="space-y-2">
        {loading && alerts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-[var(--muted)]" />
          </div>
        ) : alerts.length === 0 ? (
          <EmptyState message={showResolved ? 'No resolved alerts found.' : 'No active compliance alerts. Looking good!'} />
        ) : (
          alerts.map(alert => (
            <div
              key={alert.id}
              className={`border rounded-lg transition-colors ${
                alert.isResolved
                  ? 'border-[var(--border)] bg-[var(--paper)] opacity-60'
                  : alert.riskLevel === 'critical'
                  ? 'border-red-200 bg-red-50/50'
                  : alert.riskLevel === 'high'
                  ? 'border-orange-200 bg-orange-50/30'
                  : 'border-[var(--border)] bg-[var(--paper)]'
              }`}
            >
              {/* Alert Header */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
              >
                <RiskBadge level={alert.riskLevel} />
                <MethodBadge method={alert.detectionMethod} />
                <p className="flex-1 text-sm text-[var(--ink)] truncate">{alert.violation}</p>
                {alert.productType && (
                  <span className="hidden md:inline text-xs text-[var(--muted)]">{alert.productType}</span>
                )}
                <span className="text-xs text-[var(--muted)]">
                  {(alert.riskScore * 100).toFixed(0)}%
                </span>
                {expandedAlert === alert.id ? (
                  <ChevronUp className="w-4 h-4 text-[var(--muted)] shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[var(--muted)] shrink-0" />
                )}
              </div>

              {/* Expanded Detail */}
              {expandedAlert === alert.id && (
                <div className="px-4 pb-4 pt-1 border-t border-[var(--border)] space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-[var(--muted)]">Rule ID</span>
                      <p className="text-[var(--ink)] font-mono">{alert.ruleId || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Field</span>
                      <p className="text-[var(--ink)]">{alert.field || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Actual Value</span>
                      <p className="text-[var(--ink)] font-mono">{alert.actualValue || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Limit</span>
                      <p className="text-[var(--ink)] font-mono">{alert.limitValue || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Product</span>
                      <p className="text-[var(--ink)]">{alert.productName || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Detected</span>
                      <p className="text-[var(--ink)]">{new Date(alert.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[var(--muted)]">Recommendation</span>
                      <p className="text-[var(--ink)]">{alert.recommendation || '—'}</p>
                    </div>
                  </div>

                  {/* Resolution */}
                  {alert.isResolved ? (
                    <div className="bg-green-50 border border-green-200 rounded p-2 text-xs">
                      <span className="text-green-800">
                        Resolved by {alert.resolvedBy} on {alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleString() : '—'}
                        {alert.resolvedNote && ` — ${alert.resolvedNote}`}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolve(alert.id); }}
                        className="text-xs bg-[var(--accent)] text-white px-3 py-1.5 rounded hover:opacity-90 transition-opacity"
                      >
                        Mark Resolved
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const note = prompt('Resolution note (optional):');
                          if (note !== null) handleResolve(alert.id, note);
                        }}
                        className="text-xs border border-[var(--border)] text-[var(--ink)] px-3 py-1.5 rounded hover:bg-[var(--accent)]/5 transition-colors"
                      >
                        Resolve with Note
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-xs text-[var(--muted)]">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
});

// ─── Rules Browser Tab ──────────────────────────────────────────────────────

const RulesBrowserTab = memo(function RulesBrowserTab() {
  const [rules, setRules] = useState<ComplianceRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [facets, setFacets] = useState<RuleFacets | null>(null);
  const [jurisdictionFilter, setJurisdictionFilter] = useState<string>('');
  const [areaFilter, setAreaFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedRule, setExpandedRule] = useState<string | null>(null);

  const loadRules = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        pageSize: '25',
        isActive: 'true',
      });
      if (jurisdictionFilter) params.set('jurisdiction', jurisdictionFilter);
      if (areaFilter) params.set('complianceArea', areaFilter);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`/api/compliance/rules?${params}`);
      const json = await res.json();
      if (json.success) {
        setRules(json.data);
        setTotalPages(json.pagination.totalPages);
        setTotalCount(json.pagination.totalCount);
        if (json.facets) setFacets(json.facets);
      }
    } catch (err) {
      console.error('Failed to load rules:', err);
    } finally {
      setLoading(false);
    }
  }, [jurisdictionFilter, areaFilter, searchQuery]);

  useEffect(() => { loadRules(page); }, [page, loadRules]);
  useEffect(() => { setPage(1); }, [jurisdictionFilter, areaFilter, searchQuery]);

  const severityColors: Record<string, string> = {
    critical: 'text-red-700 bg-red-50 border-red-200',
    high: 'text-orange-700 bg-orange-50 border-orange-200',
    medium: 'text-yellow-700 bg-yellow-50 border-yellow-200',
    low: 'text-green-700 bg-green-50 border-green-200',
  };

  return (
    <div className="space-y-6">
      {/* Facet Summary */}
      {facets && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total Active Rules" value={totalCount} icon={ShieldAlert} />
          <MetricCard label="Jurisdictions" value={facets.jurisdictions.length} icon={Activity} />
          <MetricCard label="Compliance Areas" value={facets.complianceAreas.length} icon={Search} />
          <MetricCard label="Rule Types" value={facets.ruleTypes.length} icon={Filter} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter:</span>
        </div>
        {facets && (
          <>
            <select
              value={jurisdictionFilter}
              onChange={e => setJurisdictionFilter(e.target.value)}
              className="text-xs border border-[var(--border)] rounded px-2 py-1 bg-[var(--paper)] text-[var(--ink)]"
            >
              <option value="">All Jurisdictions</option>
              {facets.jurisdictions.map(j => (
                <option key={j.value} value={j.value}>{j.value} ({j.count})</option>
              ))}
            </select>
            <select
              value={areaFilter}
              onChange={e => setAreaFilter(e.target.value)}
              className="text-xs border border-[var(--border)] rounded px-2 py-1 bg-[var(--paper)] text-[var(--ink)]"
            >
              <option value="">All Areas</option>
              {facets.complianceAreas.map(c => (
                <option key={c.value} value={c.value}>{c.value} ({c.count})</option>
              ))}
            </select>
          </>
        )}
        <div className="relative ml-auto">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search rules..."
            className="text-xs border border-[var(--border)] rounded pl-7 pr-2 py-1 bg-[var(--paper)] text-[var(--ink)] w-48"
          />
        </div>
      </div>

      {/* Rules List */}
      <div className="space-y-2">
        {loading && rules.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-[var(--muted)]" />
          </div>
        ) : rules.length === 0 ? (
          <EmptyState message="No compliance rules found. Run the rule compiler to extract rules from the corpus." />
        ) : (
          rules.map(rule => (
            <div
              key={rule.id}
              className="border border-[var(--border)] rounded-lg bg-[var(--paper)]"
            >
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--accent)]/5 transition-colors"
                onClick={() => setExpandedRule(expandedRule === rule.id ? null : rule.id)}
              >
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${severityColors[rule.severity] || ''}`}>
                  {rule.severity}
                </span>
                <span className="text-xs font-mono text-[var(--muted)]">{rule.ruleId}</span>
                <span className="text-xs bg-[var(--accent)]/10 text-[var(--accent)] px-1.5 py-0.5 rounded">
                  {rule.complianceArea}
                </span>
                <span className="flex-1 text-xs text-[var(--muted)]">{rule.ruleType}</span>
                <span className="text-xs text-[var(--muted)]">{rule.jurisdiction}</span>
                {expandedRule === rule.id ? (
                  <ChevronUp className="w-4 h-4 text-[var(--muted)]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[var(--muted)]" />
                )}
              </div>

              {expandedRule === rule.id && (
                <div className="px-4 pb-4 pt-1 border-t border-[var(--border)] space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-[var(--muted)]">Product Types</span>
                      <p className="text-[var(--ink)]">{rule.productTypes.join(', ') || 'All'}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Enforced By</span>
                      <p className="text-[var(--ink)]">{rule.enforcedBy || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Penalty</span>
                      <p className="text-[var(--ink)]">{rule.penalty || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Version</span>
                      <p className="text-[var(--ink)]">v{rule.version}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Last Verified</span>
                      <p className="text-[var(--ink)]">{new Date(rule.lastVerified).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Status</span>
                      <p className={rule.isActive ? 'text-green-700' : 'text-red-700'}>
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Condition</span>
                    <pre className="mt-1 text-xs bg-[var(--ink)]/5 rounded p-2 overflow-x-auto font-mono text-[var(--ink)]">
                      {JSON.stringify(rule.condition, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-xs text-[var(--muted)]">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
});

// ─── Main Page ──────────────────────────────────────────────────────────────

export const CompliancePage = memo(function CompliancePage() {
  const tabs = [
    {
      id: 'alerts',
      label: 'Active Alerts',
      render: () => <ActiveAlertsTab />,
    },
    {
      id: 'scans',
      label: 'Scan History',
      render: () => <ScanHistoryTab />,
    },
    {
      id: 'rules',
      label: 'Rule Browser',
      render: () => <RulesBrowserTab />,
    },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <Header
        title="Compliance Intelligence"
        subtitle="AI-Powered Risk Detection"
      />
      <Tabs tabs={tabs} />
    </div>
  );
});
