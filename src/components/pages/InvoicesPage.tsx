'use client';

import { useState } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { FileUpload } from '@/components/ui/FileUpload';
import { DataTable } from '@/components/ui/DataTable';
import { FileText, Package, DollarSign, Calendar, Loader2 } from 'lucide-react';

interface Invoice {
  [key: string]: string | number;
  id: string;
  invoiceNumber: string;
  vendor: string;
  invoiceDate: string;
  totalCost: number;
  lineItemsCount: number;
  status: 'processed' | 'needs_review';
}

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [processing, setProcessing] = useState(false);

  const handleInvoiceUpload = async (file: File) => {
    setProcessing(true);

    try {
      // In production, this would:
      // 1. Upload PDF to server
      // 2. Parse with pdfplumber/PyMuPDF
      // 3. Extract invoice data
      // 4. Save to DynamoDB

      // Simulated invoice extraction
      const mockInvoice: Invoice = {
        id: `inv_${Date.now()}`,
        invoiceNumber: `INV-${Math.floor(Math.random() * 10000)}`,
        vendor: 'Sample Vendor',
        invoiceDate: new Date().toISOString().split('T')[0],
        totalCost: Math.floor(Math.random() * 5000) + 500,
        lineItemsCount: Math.floor(Math.random() * 20) + 5,
        status: 'processed',
      };

      setInvoices((prev) => [mockInvoice, ...prev]);
    } finally {
      setProcessing(false);
    }
  };

  const summary = {
    totalInvoices: invoices.length,
    totalCost: invoices.reduce((sum, inv) => sum + inv.totalCost, 0),
    totalLineItems: invoices.reduce((sum, inv) => sum + inv.lineItemsCount, 0),
    needsReview: invoices.filter((inv) => inv.status === 'needs_review').length,
  };

  const tabs = [
    {
      id: 'upload',
      label: 'Upload Invoices',
      content: (
        <div className="space-y-6">
          <Card>
            <SectionLabel>PDF Upload</SectionLabel>
            <SectionTitle>Upload Treez Invoices</SectionTitle>
            <p className="text-sm text-[var(--muted)] mb-4">
              Upload invoice PDFs from Treez. The system will automatically extract vendor
              information, product details, pricing, and quantities.
            </p>
            <FileUpload
              onUpload={handleInvoiceUpload}
              accept={{ 'application/pdf': ['.pdf'] }}
              title={processing ? 'Processing invoice...' : 'Drop PDF invoice here'}
              description="Supports Treez invoice PDFs"
            />
            {processing && (
              <div className="flex items-center justify-center gap-2 mt-4 text-[var(--accent)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Extracting invoice data...</span>
              </div>
            )}
          </Card>

          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-[var(--accent)]" />
                <div>
                  <p className="text-xs text-[var(--muted)]">Total Invoices</p>
                  <p className="text-xl font-semibold font-serif">{summary.totalInvoices}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-[var(--accent)]" />
                <div>
                  <p className="text-xs text-[var(--muted)]">Total Cost</p>
                  <p className="text-xl font-semibold font-serif">
                    ${summary.totalCost.toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-[var(--accent)]" />
                <div>
                  <p className="text-xs text-[var(--muted)]">Line Items</p>
                  <p className="text-xl font-semibold font-serif">{summary.totalLineItems}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-[var(--warning)]" />
                <div>
                  <p className="text-xs text-[var(--muted)]">Needs Review</p>
                  <p className="text-xl font-semibold font-serif">{summary.needsReview}</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ),
    },
    {
      id: 'invoices',
      label: 'Invoice List',
      content: (
        <Card>
          <SectionLabel>Processed Invoices</SectionLabel>
          <SectionTitle>Invoice History</SectionTitle>
          {invoices.length === 0 ? (
            <p className="text-[var(--muted)] text-center py-8">
              No invoices uploaded yet. Upload PDF invoices to extract and track purchasing data.
            </p>
          ) : (
            <DataTable
              data={invoices}
              columns={[
                { key: 'invoiceNumber', label: 'Invoice #', sortable: true },
                { key: 'vendor', label: 'Vendor', sortable: true },
                { key: 'invoiceDate', label: 'Date', sortable: true },
                {
                  key: 'totalCost',
                  label: 'Total',
                  sortable: true,
                  align: 'right',
                  render: (v) => `$${Number(v).toLocaleString()}`,
                },
                { key: 'lineItemsCount', label: 'Items', sortable: true, align: 'right' },
                {
                  key: 'status',
                  label: 'Status',
                  render: (v) => (
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        v === 'processed'
                          ? 'bg-[var(--success)]/15 text-[var(--success)]'
                          : 'bg-[var(--warning)]/15 text-[var(--warning)]'
                      }`}
                    >
                      {v === 'processed' ? 'Processed' : 'Needs Review'}
                    </span>
                  ),
                },
              ]}
              pageSize={10}
              exportable
              exportFilename="invoices"
            />
          )}
        </Card>
      ),
    },
    {
      id: 'products',
      label: 'Product Analysis',
      content: (
        <Card>
          <SectionLabel>Purchasing Insights</SectionLabel>
          <SectionTitle>Product Purchase Trends</SectionTitle>
          <p className="text-[var(--muted)]">
            Analyze your purchasing patterns by product, vendor, and category. Identify
            opportunities to optimize your inventory spend.
          </p>
        </Card>
      ),
    },
  ];

  return (
    <div>
      <Header title="Invoice Data Management" subtitle="Invoices" />
      <Tabs tabs={tabs} />
    </div>
  );
}
