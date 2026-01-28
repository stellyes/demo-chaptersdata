'use client';

import { useState } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable } from '@/components/ui/DataTable';
import { QrCode, Link, Download, Loader2, Copy, Check } from 'lucide-react';
import QRCodeLib from 'qrcode';
import { useAppStore } from '@/store/app-store';
import { QRCode } from '@/types';

export function QRCodePage() {
  const { qrCodesData, setQrCodesData } = useAppStore();
  const [qrImage, setQrImage] = useState<string>('');
  const [trackingUrl, setTrackingUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
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
        <Card>
          <SectionLabel>Click Tracking</SectionLabel>
          <SectionTitle>QR Code Performance</SectionTitle>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Total QR Codes</p>
              <p className="text-2xl font-semibold font-serif">{qrCodes.length}</p>
            </div>
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Total Scans</p>
              <p className="text-2xl font-semibold font-serif">
                {qrCodes.reduce((sum, qr) => sum + (qr.totalClicks || 0), 0)}
              </p>
            </div>
            <div className="p-4 bg-[var(--paper)] rounded-lg">
              <p className="text-sm text-[var(--muted)] mb-1">Active Codes</p>
              <p className="text-2xl font-semibold font-serif">
                {qrCodes.filter((qr) => qr.active).length}
              </p>
            </div>
          </div>

          <p className="text-[var(--muted)] text-center py-8">
            Connect to the QR tracking API to view detailed click analytics.
          </p>
        </Card>
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
