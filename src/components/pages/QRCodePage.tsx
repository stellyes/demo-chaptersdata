'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable } from '@/components/ui/DataTable';
import { QrCode, Link, Download, Loader2, Copy, Check, Trash2, Monitor, Smartphone, Tablet, Globe, Clock, RefreshCw } from 'lucide-react';
import QRCodeLib from 'qrcode';
import { useAppStore } from '@/store/app-store';
import { QRCode } from '@/types';

// ---- Analytics types ----
interface AnalyticsData {
  totalClicks: number;
  period: { days: number; since: string };
  dailyClicks: { date: string; clicks: number }[];
  topCodes: { shortCode: string; name: string; clicks: number }[];
  devices: Record<string, number>;
  browsers: Record<string, number>;
  operatingSystems: Record<string, number>;
  topReferrers: { source: string; clicks: number }[];
  recentClicks: {
    shortCode: string;
    name: string;
    clickedAt: string;
    device: string;
    browser: string;
    os: string;
    referrer: string | null;
  }[];
}

// ---- Analytics sub-component ----
function AnalyticsTab({ qrCount, activeCount }: { qrCount: number; activeCount: number }) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/qr/analytics?days=${days}`);
      const result = await res.json();
      if (result.success) {
        setAnalytics(result.data);
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)] mb-3" />
          <p className="text-sm text-[var(--muted)]">Loading analytics...</p>
        </div>
      </Card>
    );
  }

  if (!analytics) {
    return (
      <Card>
        <p className="text-[var(--muted)] text-center py-8">Failed to load analytics data.</p>
      </Card>
    );
  }

  const maxDaily = Math.max(...analytics.dailyClicks.map((d) => d.clicks), 1);
  const totalDevices = Object.values(analytics.devices).reduce((a, b) => a + b, 0) || 1;

  const deviceIcon = (type: string) => {
    if (type === 'mobile') return <Smartphone className="w-4 h-4" />;
    if (type === 'tablet') return <Tablet className="w-4 h-4" />;
    return <Monitor className="w-4 h-4" />;
  };

  return (
    <div className="space-y-6">
      {/* Period selector + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
                days === d
                  ? 'bg-[var(--ink)] text-[var(--paper)]'
                  : 'bg-[var(--paper)] text-[var(--muted)] border border-[var(--border)] hover:bg-[var(--cream)]'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <button
          onClick={fetchAnalytics}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--muted)] border border-[var(--border)] rounded hover:bg-[var(--cream)] transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-[var(--muted)] mb-1">Total Scans</p>
          <p className="text-2xl font-semibold font-serif">{analytics.totalClicks}</p>
          <p className="text-xs text-[var(--muted)] mt-1">last {days} days</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--muted)] mb-1">Avg / Day</p>
          <p className="text-2xl font-semibold font-serif">
            {days > 0 ? (analytics.totalClicks / days).toFixed(1) : '0'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--muted)] mb-1">QR Codes</p>
          <p className="text-2xl font-semibold font-serif">{qrCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--muted)] mb-1">Active</p>
          <p className="text-2xl font-semibold font-serif">{activeCount}</p>
        </Card>
      </div>

      {/* Daily clicks chart (bar chart via CSS) */}
      <Card>
        <SectionLabel>Scan Activity</SectionLabel>
        <SectionTitle>Daily Scans</SectionTitle>
        {analytics.totalClicks === 0 ? (
          <p className="text-[var(--muted)] text-center py-8 text-sm">No scans recorded in this period.</p>
        ) : (
          <div className="mt-4">
            <div className="flex items-end gap-[2px] h-40">
              {analytics.dailyClicks.map((day) => (
                <div
                  key={day.date}
                  className="flex-1 group relative"
                  title={`${day.date}: ${day.clicks} scan${day.clicks !== 1 ? 's' : ''}`}
                >
                  <div
                    className="w-full bg-[var(--accent)] rounded-t opacity-80 hover:opacity-100 transition-opacity min-h-[2px]"
                    style={{ height: `${(day.clicks / maxDaily) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-[var(--muted)]">
              <span>{analytics.dailyClicks[0]?.date}</span>
              <span>{analytics.dailyClicks[analytics.dailyClicks.length - 1]?.date}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Two-column: Top codes + Devices */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top performing QR codes */}
        <Card>
          <SectionLabel>Performance</SectionLabel>
          <SectionTitle>Top QR Codes</SectionTitle>
          {analytics.topCodes.length === 0 ? (
            <p className="text-[var(--muted)] text-center py-6 text-sm">No data yet.</p>
          ) : (
            <div className="space-y-3 mt-4">
              {analytics.topCodes.map((code, i) => (
                <div key={code.shortCode} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[var(--muted)] w-5 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{code.name}</p>
                    <div className="w-full bg-[var(--border)] rounded-full h-1.5 mt-1">
                      <div
                        className="bg-[var(--accent)] h-1.5 rounded-full"
                        style={{ width: `${(code.clicks / (analytics.topCodes[0]?.clicks || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{code.clicks}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Device breakdown */}
        <Card>
          <SectionLabel>Devices</SectionLabel>
          <SectionTitle>Scan Devices</SectionTitle>
          {analytics.totalClicks === 0 ? (
            <p className="text-[var(--muted)] text-center py-6 text-sm">No data yet.</p>
          ) : (
            <div className="space-y-4 mt-4">
              {Object.entries(analytics.devices)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <div key={type} className="flex items-center gap-3">
                    <span className="text-[var(--muted)]">{deviceIcon(type)}</span>
                    <span className="text-sm capitalize flex-1">{type}</span>
                    <span className="text-sm font-semibold tabular-nums">{count}</span>
                    <span className="text-xs text-[var(--muted)] w-10 text-right">
                      {((count / totalDevices) * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}

              {/* Browser breakdown */}
              <div className="border-t border-[var(--border)] pt-4 mt-4">
                <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">Browsers</p>
                {Object.entries(analytics.browsers)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5)
                  .map(([browser, count]) => (
                    <div key={browser} className="flex items-center gap-3 mb-2">
                      <Globe className="w-3.5 h-3.5 text-[var(--muted)]" />
                      <span className="text-sm flex-1">{browser}</span>
                      <span className="text-sm font-semibold tabular-nums">{count}</span>
                    </div>
                  ))}
              </div>

              {/* OS breakdown */}
              <div className="border-t border-[var(--border)] pt-4 mt-4">
                <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">Operating Systems</p>
                {Object.entries(analytics.operatingSystems)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5)
                  .map(([os, count]) => (
                    <div key={os} className="flex items-center gap-3 mb-2">
                      <Monitor className="w-3.5 h-3.5 text-[var(--muted)]" />
                      <span className="text-sm flex-1">{os}</span>
                      <span className="text-sm font-semibold tabular-nums">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Top referrers */}
      {analytics.topReferrers.length > 0 && (
        <Card>
          <SectionLabel>Traffic Sources</SectionLabel>
          <SectionTitle>Top Referrers</SectionTitle>
          <div className="space-y-3 mt-4">
            {analytics.topReferrers.map((ref) => (
              <div key={ref.source} className="flex items-center gap-3">
                <Globe className="w-4 h-4 text-[var(--muted)] shrink-0" />
                <span className="text-sm flex-1 truncate">{ref.source}</span>
                <span className="text-sm font-semibold tabular-nums">{ref.clicks}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent clicks */}
      {analytics.recentClicks.length > 0 && (
        <Card>
          <SectionLabel>Activity</SectionLabel>
          <SectionTitle>Recent Scans</SectionTitle>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="pb-2 pr-4 font-medium text-[var(--muted)]">QR Code</th>
                  <th className="pb-2 pr-4 font-medium text-[var(--muted)]">Time</th>
                  <th className="pb-2 pr-4 font-medium text-[var(--muted)]">Device</th>
                  <th className="pb-2 pr-4 font-medium text-[var(--muted)]">Browser</th>
                  <th className="pb-2 font-medium text-[var(--muted)]">Referrer</th>
                </tr>
              </thead>
              <tbody>
                {analytics.recentClicks.map((click, i) => (
                  <tr key={i} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{click.name}</td>
                    <td className="py-2.5 pr-4 text-[var(--muted)] whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(click.clickedAt).toLocaleString()}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 capitalize">
                      <span className="flex items-center gap-1.5">
                        {deviceIcon(click.device)}
                        {click.device}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">{click.browser} / {click.os}</td>
                    <td className="py-2.5 text-[var(--muted)] truncate max-w-[200px]">
                      {click.referrer || 'Direct'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export function QRCodePage() {
  const { qrCodesData, setQrCodesData } = useAppStore();
  const [qrImage, setQrImage] = useState<string>('');
  const [trackingUrl, setTrackingUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    color: '#1e391f',
    bgColor: '#ffffff',
  });

  // Use store data with proper typing for DataTable
  const qrCodes = qrCodesData.map(qr => ({
    ...qr,
    [Symbol.iterator]: undefined, // DataTable compatibility
  })) as Array<QRCode & { [key: string]: string | number | boolean | undefined }>;

  const generateQRCode = async () => {
    if (!formData.name || !formData.url) return;

    try {
      setSaving(true);

      // Save to API first to get the tracking URL
      const response = await fetch('/api/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          originalUrl: formData.url,
        }),
      });

      const result = await response.json();
      if (result.success && result.data) {
        // Use tracking URL for QR code (this is what gets scanned and tracked)
        const urlToEncode = result.data.trackingUrl || formData.url;
        setTrackingUrl(urlToEncode);

        // Generate QR code image with tracking URL
        const qrDataUrl = await QRCodeLib.toDataURL(urlToEncode, {
          width: 300,
          margin: 2,
          color: {
            dark: formData.color,
            light: formData.bgColor,
          },
        });

        setQrImage(qrDataUrl);

        // Add to store
        setQrCodesData([result.data, ...qrCodesData]);
        setFormData({ ...formData, name: '', url: '' });
      }
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    } finally {
      setSaving(false);
    }
  };

  const downloadQR = () => {
    if (!qrImage) return;
    const link = document.createElement('a');
    link.download = `qr-${formData.name || 'code'}.png`;
    link.href = qrImage;
    link.click();
  };

  const copyTrackingUrl = async () => {
    if (!trackingUrl) return;
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const deleteQRCode = async (id: string) => {
    try {
      setDeleting(id);
      const response = await fetch(`/api/qr?id=${id}`, { method: 'DELETE' });
      const result = await response.json();

      // Remove from UI if deleted successfully or if it no longer exists in the database
      if (result.success || response.status === 404) {
        setQrCodesData(qrCodesData.filter((qr) => qr.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete QR code:', error);
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  };

  const tabs = [
    {
      id: 'generate',
      label: 'Generate QR Code',
      render: () => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <SectionLabel>QR Code Generator</SectionLabel>
            <SectionTitle>Create New QR Code</SectionTitle>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-[var(--muted)] block mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Menu Link, Promo Page"
                  className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-[var(--muted)] block mb-2">
                  Destination URL *
                </label>
                <div className="relative">
                  <Link className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    placeholder="https://..."
                    className="w-full pl-10 pr-3 py-2 border border-[var(--border)] rounded text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-[var(--muted)] block mb-2">
                    QR Color
                  </label>
                  <input
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-full h-10 rounded border border-[var(--border)] cursor-pointer"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--muted)] block mb-2">
                    Background
                  </label>
                  <input
                    type="color"
                    value={formData.bgColor}
                    onChange={(e) => setFormData({ ...formData, bgColor: e.target.value })}
                    className="w-full h-10 rounded border border-[var(--border)] cursor-pointer"
                  />
                </div>
              </div>

              <button
                onClick={generateQRCode}
                disabled={!formData.name || !formData.url || saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--ink)] text-[var(--paper)] rounded font-medium disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <QrCode className="w-5 h-5" />
                    Generate QR Code
                  </>
                )}
              </button>
            </div>
          </Card>

          <Card>
            <SectionLabel>Preview</SectionLabel>
            <SectionTitle>QR Code Output</SectionTitle>

            <div className="flex flex-col items-center justify-center min-h-[300px]">
              {qrImage ? (
                <>
                  <img src={qrImage} alt="Generated QR Code" className="mb-4 rounded-lg shadow-lg" />

                  {/* Tracking URL Display */}
                  {trackingUrl && (
                    <div className="w-full mb-4 p-3 bg-[var(--paper)] rounded-lg">
                      <p className="text-xs text-[var(--muted)] mb-1">Tracking URL (encoded in QR)</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs text-[var(--ink)] truncate">{trackingUrl}</code>
                        <button
                          onClick={copyTrackingUrl}
                          className="p-1.5 hover:bg-[var(--border)] rounded transition-colors"
                          title="Copy tracking URL"
                        >
                          {copied ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4 text-[var(--muted)]" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={downloadQR}
                      className="flex items-center gap-2 px-4 py-2 border border-[var(--border)] rounded text-sm font-medium hover:bg-[var(--paper)]"
                    >
                      <Download className="w-4 h-4" />
                      Download PNG
                    </button>
                    <button
                      onClick={copyTrackingUrl}
                      disabled={!trackingUrl}
                      className="flex items-center gap-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded text-sm font-medium disabled:opacity-50"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center text-[var(--muted)]">
                  <QrCode className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p>Enter URL and click generate to create QR code</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      ),
    },
    {
      id: 'analytics',
      label: 'Analytics',
      render: () => (
        <AnalyticsTab
          qrCount={qrCodes.length}
          activeCount={qrCodes.filter((qr) => qr.active).length}
        />
      ),
    },
    {
      id: 'manage',
      label: 'Manage QR Codes',
      render: () => (
        <Card>
          <SectionLabel>QR Code Library</SectionLabel>
          <SectionTitle>All QR Codes</SectionTitle>
          {qrCodes.length === 0 ? (
            <p className="text-[var(--muted)] text-center py-8">
              No QR codes created yet. Generate your first QR code above.
            </p>
          ) : (
            <DataTable
              data={qrCodes}
              columns={[
                { key: 'name', label: 'Name', sortable: true },
                {
                  key: 'originalUrl',
                  label: 'URL',
                  render: (v) => (
                    <span className="text-xs text-[var(--muted)] truncate max-w-[200px] block">
                      {String(v)}
                    </span>
                  ),
                },
                { key: 'totalClicks', label: 'Scans', sortable: true, align: 'right' },
                {
                  key: 'createdAt',
                  label: 'Created',
                  sortable: true,
                  render: (v) => new Date(String(v)).toLocaleDateString(),
                },
                {
                  key: 'active',
                  label: 'Status',
                  render: (v) => (
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        v ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--muted)]/15 text-[var(--muted)]'
                      }`}
                    >
                      {v ? 'Active' : 'Inactive'}
                    </span>
                  ),
                },
                {
                  key: 'id',
                  label: '',
                  align: 'right',
                  render: (_v, row) => {
                    const id = String(row.id);
                    const isConfirming = confirmDelete === id;
                    const isDeleting = deleting === id;

                    if (isDeleting) {
                      return <Loader2 className="w-4 h-4 animate-spin text-[var(--muted)]" />;
                    }

                    if (isConfirming) {
                      return (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteQRCode(id)}
                            className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="px-2 py-1 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      );
                    }

                    return (
                      <button
                        onClick={() => setConfirmDelete(id)}
                        className="p-1.5 text-[var(--muted)] hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                        title="Delete QR code"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    );
                  },
                },
              ]}
              pageSize={10}
            />
          )}
        </Card>
      ),
    },
  ];

  return (
    <div>
      <Header title="QR Code Generator & Tracker" subtitle="QR Codes" />
      <Tabs tabs={tabs} />
    </div>
  );
}
