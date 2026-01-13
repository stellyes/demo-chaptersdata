'use client';

import { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { FileUpload } from '@/components/ui/FileUpload';
import { DataTable } from '@/components/ui/DataTable';
import { useAppStore } from '@/store/app-store';
import { parseCSV, cleanSalesData, cleanBrandData, cleanProductData, cleanCustomerData } from '@/lib/services/data-processor';
import { STORES, SEO_SITES, RESEARCH_CATEGORIES, QR_REDIRECT_BASE_URL } from '@/lib/config';
import { StoreId } from '@/types';
import {
  Check,
  AlertCircle,
  Database,
  Cloud,
  RefreshCw,
  FileText,
  Users,
  User,
  MessageSquare,
  Tag,
  Search,
  Globe,
  QrCode,
  Loader2,
  Download,
  ExternalLink,
  Link,
  Upload,
  Trash2,
  Save,
  CheckCircle,
  TrendingUp,
} from 'lucide-react';
import QRCodeLib from 'qrcode';

// ============================================
// DATA STATUS COMPONENT
// ============================================
function DataStatusRow({
  label,
  count,
  loaded,
}: {
  label: string;
  count: number;
  loaded: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium text-[var(--ink)]">{count.toLocaleString()}</span>
        {loaded ? (
          <Check className="w-4 h-4 text-[var(--success)]" />
        ) : (
          <AlertCircle className="w-4 h-4 text-[var(--warning)]" />
        )}
      </div>
    </div>
  );
}

// ============================================
// SALES DATA TAB
// ============================================
function SalesDataTab() {
  const {
    setSalesData,
    setBrandData,
    setProductData,
    salesData,
    brandData,
    productData,
    dataStatus,
  } = useAppStore();

  const [uploadStore, setUploadStore] = useState<StoreId>('grass_roots');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handleSalesUpload = async (file: File) => {
    const text = await file.text();
    const rawData = parseCSV<Record<string, string>>(text);
    const cleaned = cleanSalesData(rawData);
    setSalesData([...salesData, ...cleaned]);
  };

  const handleBrandUpload = async (file: File) => {
    if (!startDate || !endDate) {
      throw new Error('Please set the date range before uploading brand data');
    }
    const text = await file.text();
    const rawData = parseCSV<Record<string, string>>(text);
    const cleaned = cleanBrandData(rawData, uploadStore, startDate, endDate);
    setBrandData([...brandData, ...cleaned]);
  };

  const handleProductUpload = async (file: File) => {
    const text = await file.text();
    const rawData = parseCSV<Record<string, string>>(text);
    const cleaned = cleanProductData(rawData, uploadStore);
    setProductData([...productData, ...cleaned]);
  };

  return (
    <div className="space-y-6">
      {/* Upload Settings */}
      <Card>
        <SectionLabel>Upload Settings</SectionLabel>
        <SectionTitle>Configure Data Upload</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-4">
          Select the store and date range for the data you're uploading from Treez reports.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">Store</label>
            <select
              value={uploadStore}
              onChange={(e) => setUploadStore(e.target.value as StoreId)}
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            >
              {Object.values(STORES)
                .filter((s) => s.id !== 'combined')
                .map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.displayName}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>
        </div>
      </Card>

      {/* Sales by Store Upload */}
      <Card>
        <SectionLabel>Sales by Store</SectionLabel>
        <SectionTitle>Upload Daily Sales Report</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload the "Sales by Store" CSV export from Treez. This report contains daily sales,
          transactions, margins, and other KPIs.
        </p>
        <FileUpload
          onUpload={handleSalesUpload}
          title="Drop Sales by Store CSV here"
          description="Required columns: Date, Store, Net Sales, Tickets Count, Gross Margin %"
        />
        {dataStatus.sales.loaded && (
          <div className="mt-4 p-3 bg-[var(--success)]/10 rounded flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[var(--success)]" />
            <span className="text-sm text-[var(--success)]">
              {dataStatus.sales.count} sales records loaded
            </span>
          </div>
        )}
      </Card>

      {/* Brand Performance Upload */}
      <Card>
        <SectionLabel>Net Sales by Brand</SectionLabel>
        <SectionTitle>Upload Brand Performance Report</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload the "Net Sales by Brand" CSV export from Treez. Set the date range above first.
        </p>
        <FileUpload
          onUpload={handleBrandUpload}
          title="Drop Brand CSV here"
          description="Required: Start and End dates set above"
        />
        {dataStatus.brands.loaded && (
          <div className="mt-4 p-3 bg-[var(--success)]/10 rounded flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[var(--success)]" />
            <span className="text-sm text-[var(--success)]">
              {dataStatus.brands.count} brand records loaded
            </span>
          </div>
        )}
      </Card>

      {/* Product Category Upload */}
      <Card>
        <SectionLabel>Net Sales by Product Type</SectionLabel>
        <SectionTitle>Upload Product Category Report</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload the "Net Sales by Product Type" CSV export from Treez for category analysis.
        </p>
        <FileUpload
          onUpload={handleProductUpload}
          title="Drop Product Type CSV here"
          description="Required columns: Product Type, Net Sales, Gross Margin %"
        />
        {dataStatus.products.loaded && (
          <div className="mt-4 p-3 bg-[var(--success)]/10 rounded flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[var(--success)]" />
            <span className="text-sm text-[var(--success)]">
              {dataStatus.products.count} product records loaded
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================================
// INVOICE DATA TAB
// ============================================
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

function InvoiceDataTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [processing, setProcessing] = useState(false);

  const handleInvoiceUpload = async (file: File) => {
    setProcessing(true);
    try {
      // Simulated invoice extraction - in production uses DynamoDB
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

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>PDF Upload</SectionLabel>
        <SectionTitle>Upload Treez Invoices</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload invoice PDFs from Treez. The system will automatically extract vendor
          information, product details, pricing, and quantities using AI-powered extraction.
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
              <p className="text-xl font-semibold font-serif">{invoices.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Total Cost</p>
              <p className="text-xl font-semibold font-serif">
                ${invoices.reduce((sum, inv) => sum + inv.totalCost, 0).toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Line Items</p>
              <p className="text-xl font-semibold font-serif">
                {invoices.reduce((sum, inv) => sum + inv.lineItemsCount, 0)}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-[var(--warning)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Needs Review</p>
              <p className="text-xl font-semibold font-serif">
                {invoices.filter((inv) => inv.status === 'needs_review').length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Invoice List */}
      {invoices.length > 0 && (
        <Card>
          <SectionLabel>Processed Invoices</SectionLabel>
          <SectionTitle>Invoice History</SectionTitle>
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
        </Card>
      )}
    </div>
  );
}

// ============================================
// CUSTOMER DATA TAB
// ============================================
function CustomerDataTab() {
  const { setCustomerData, customerData, dataStatus } = useAppStore();
  const [uploadStore, setUploadStore] = useState<StoreId>('grass_roots');

  const handleCustomerUpload = async (file: File) => {
    const text = await file.text();
    const rawData = parseCSV<Record<string, string>>(text);
    const cleaned = cleanCustomerData(rawData);
    setCustomerData([...customerData, ...cleaned]);
  };

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Customer Export</SectionLabel>
        <SectionTitle>Upload Customer Data</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload customer data exports from Treez for customer analytics, segmentation,
          and lifetime value analysis.
        </p>
        <div className="mb-4">
          <label className="text-sm font-medium text-[var(--muted)] block mb-2">Store</label>
          <select
            value={uploadStore}
            onChange={(e) => setUploadStore(e.target.value as StoreId)}
            className="w-full max-w-xs px-3 py-2 border border-[var(--border)] rounded text-sm"
          >
            {Object.values(STORES)
              .filter((s) => s.id !== 'combined')
              .map((store) => (
                <option key={store.id} value={store.id}>
                  {store.displayName}
                </option>
              ))}
          </select>
        </div>
        <FileUpload
          onUpload={handleCustomerUpload}
          title="Drop Customer CSV here"
          description="Export from Treez: Customers > Export All"
        />
        {dataStatus.customers.loaded && (
          <div className="mt-4 p-3 bg-[var(--success)]/10 rounded flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[var(--success)]" />
            <span className="text-sm text-[var(--success)]">
              {dataStatus.customers.count} customer records loaded
            </span>
          </div>
        )}
      </Card>

      {customerData.length > 0 && (
        <Card>
          <SectionLabel>Customer Preview</SectionLabel>
          <SectionTitle>Recent Customer Records</SectionTitle>
          <DataTable
            data={customerData.slice(-20)}
            columns={[
              { key: 'name', label: 'Name', sortable: true },
              { key: 'store_name', label: 'Store' },
              {
                key: 'lifetime_net_sales',
                label: 'Lifetime Sales',
                align: 'right',
                sortable: true,
                render: (v) => `$${Number(v).toLocaleString()}`,
              },
              { key: 'lifetime_visits', label: 'Visits', align: 'right', sortable: true },
              { key: 'customer_segment', label: 'Segment' },
              { key: 'recency_segment', label: 'Recency' },
            ]}
            pageSize={10}
          />
        </Card>
      )}
    </div>
  );
}

// ============================================
// BUDTENDER PERFORMANCE TAB
// ============================================
function BudtenderPerformanceTab() {
  const {
    budtenderData,
    setBudtenderData,
    permanentEmployees,
    setPermanentEmployee,
    clearPermanentEmployees,
    dataStatus,
  } = useAppStore();
  const [filterStore, setFilterStore] = useState<StoreId | 'all'>('all');
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Get unique employees with their aggregated stats
  const employeeStats = useMemo(() => {
    const stats: Record<
      string,
      {
        employee_name: string;
        stores: Set<string>;
        total_sales: number;
        total_transactions: number;
        avg_margin: number;
        record_count: number;
      }
    > = {};

    for (const record of budtenderData) {
      const name = record.employee_name;
      if (!stats[name]) {
        stats[name] = {
          employee_name: name,
          stores: new Set(),
          total_sales: 0,
          total_transactions: 0,
          avg_margin: 0,
          record_count: 0,
        };
      }
      stats[name].stores.add(record.store);
      stats[name].total_sales += record.net_sales || 0;
      stats[name].total_transactions += record.tickets_count || 0;
      stats[name].avg_margin += record.gross_margin_pct || 0;
      stats[name].record_count += 1;
    }

    // Calculate average margin
    Object.values(stats).forEach((s) => {
      if (s.record_count > 0) {
        s.avg_margin = s.avg_margin / s.record_count;
      }
    });

    return Object.values(stats);
  }, [budtenderData]);

  // Filter employees
  const filteredEmployees = useMemo(() => {
    let filtered = employeeStats;

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((e) => e.employee_name.toLowerCase().includes(term));
    }

    // Filter by assigned store
    if (filterStore !== 'all') {
      filtered = filtered.filter((e) => {
        const assignedStore = permanentEmployees[e.employee_name];
        return assignedStore === filterStore;
      });
    }

    // Filter unassigned only
    if (showOnlyUnassigned) {
      filtered = filtered.filter((e) => !permanentEmployees[e.employee_name]);
    }

    return filtered.sort((a, b) => b.total_sales - a.total_sales);
  }, [employeeStats, filterStore, showOnlyUnassigned, searchTerm, permanentEmployees]);

  const assignedCount = Object.keys(permanentEmployees).length;
  const unassignedCount = employeeStats.length - assignedCount;

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Total Budtenders</p>
              <p className="text-xl font-semibold font-serif">{employeeStats.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-[var(--success)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Permanent Employees</p>
              <p className="text-xl font-semibold font-serif">{assignedCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-[var(--warning)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Unassigned</p>
              <p className="text-xl font-semibold font-serif">{unassignedCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Performance Records</p>
              <p className="text-xl font-semibold font-serif">
                {dataStatus.budtenders.count.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters and Actions */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <SectionLabel>Employee Management</SectionLabel>
            <SectionTitle>Assign Permanent Employees to Stores</SectionTitle>
          </div>
          {assignedCount > 0 && (
            <button
              onClick={() => {
                if (confirm('Clear all permanent employee assignments?')) {
                  clearPermanentEmployees();
                }
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--error)] border border-[var(--error)]/30 rounded hover:bg-[var(--error)]/10"
            >
              <Trash2 className="w-4 h-4" />
              Clear All Assignments
            </button>
          )}
        </div>

        <div className="flex gap-4 mb-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by employee name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>

          {/* Store Filter */}
          <select
            value={filterStore}
            onChange={(e) => setFilterStore(e.target.value as StoreId | 'all')}
            className="px-3 py-2 border border-[var(--border)] rounded text-sm"
          >
            <option value="all">All Stores</option>
            {Object.values(STORES)
              .filter((s) => s.id !== 'combined')
              .map((store) => (
                <option key={store.id} value={store.id}>
                  {store.displayName}
                </option>
              ))}
          </select>

          {/* Show unassigned toggle */}
          <label className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyUnassigned}
              onChange={(e) => setShowOnlyUnassigned(e.target.checked)}
              className="rounded"
            />
            <span>Unassigned only</span>
          </label>
        </div>

        {/* Employee List */}
        {employeeStats.length > 0 ? (
          <div className="border border-[var(--border)] rounded overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--cream)]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase">
                    Employee Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase">
                    Data From Stores
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase">
                    Total Sales
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase">
                    Transactions
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase">
                    Avg Margin
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase">
                    Permanent Store Assignment
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.slice(0, 100).map((employee) => {
                  const assignedStore = permanentEmployees[employee.employee_name];
                  return (
                    <tr
                      key={employee.employee_name}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--paper)]"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-[var(--muted)]" />
                          <span className="font-medium">{employee.employee_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--muted)]">
                        {Array.from(employee.stores).join(', ')}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        ${employee.total_sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {employee.total_transactions.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {employee.avg_margin.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={assignedStore || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setPermanentEmployee(
                              employee.employee_name,
                              value ? (value as StoreId) : null
                            );
                          }}
                          className={`px-2 py-1 border rounded text-sm w-full ${
                            assignedStore
                              ? 'border-[var(--success)] bg-[var(--success)]/5 text-[var(--success)]'
                              : 'border-[var(--border)]'
                          }`}
                        >
                          <option value="">Not Assigned</option>
                          {Object.values(STORES)
                            .filter((s) => s.id !== 'combined')
                            .map((store) => (
                              <option key={store.id} value={store.id}>
                                {store.displayName}
                              </option>
                            ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredEmployees.length > 100 && (
              <div className="px-4 py-3 bg-[var(--cream)] text-center text-sm text-[var(--muted)]">
                Showing first 100 of {filteredEmployees.length} employees
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 border border-dashed border-[var(--border)] rounded">
            <User className="w-12 h-12 mx-auto mb-4 text-[var(--muted)] opacity-50" />
            <p className="text-[var(--muted)]">
              {dataStatus.budtenders.loaded
                ? 'No employees match the current filters.'
                : 'No budtender data loaded yet. Data will load automatically from S3.'}
            </p>
          </div>
        )}
      </Card>

      {/* Upload Additional Data */}
      <Card>
        <SectionLabel>Manual Upload</SectionLabel>
        <SectionTitle>Upload Additional Budtender Data</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-4">
          Budtender data is automatically loaded from S3. Use this to upload additional reports.
        </p>
        <FileUpload
          onUpload={async (file) => {
            const text = await file.text();
            const rawData = parseCSV<Record<string, string>>(text);
            // Parse and append to existing data
            const newRecords = rawData.map((row) => ({
              store: String(row.store || row.Store || ''),
              store_id: (row.store_id || row.StoreId || 'grass_roots') as StoreId,
              employee_name: String(row.employee_name || row.EmployeeName || row.Employee || ''),
              date: String(row.date || row.Date || ''),
              tickets_count: Number(row.tickets_count || row.TicketsCount || row.Tickets || 0),
              customers_count: Number(row.customers_count || row.CustomersCount || row.Customers || 0),
              net_sales: Number(String(row.net_sales || row.NetSales || row.Sales || 0).replace(/[$,]/g, '')),
              gross_margin_pct: Number(String(row.gross_margin_pct || row.GrossMargin || row.Margin || 0).replace(/%/g, '')),
              avg_order_value: Number(String(row.avg_order_value || row.AOV || 0).replace(/[$,]/g, '')),
              units_sold: Number(row.units_sold || row.UnitsSold || row.Units || 0),
            }));
            setBudtenderData([...budtenderData, ...newRecords]);
          }}
          title="Drop Budtender Performance CSV here"
          description="Export from Treez: Reports > Budtender Performance Lifetime"
        />
      </Card>
    </div>
  );
}

// ============================================
// DEFINE CONTEXT TAB
// ============================================
function DefineContextTab() {
  const [context, setContext] = useState({
    businessDescription: '',
    targetCustomer: '',
    keyGoals: '',
    competitorInfo: '',
    uniqueSellingPoints: '',
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In production, save to S3 or API
    localStorage.setItem('chapters-business-context', JSON.stringify(context));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  useEffect(() => {
    const savedContext = localStorage.getItem('chapters-business-context');
    if (savedContext) {
      setContext(JSON.parse(savedContext));
    }
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Business Context</SectionLabel>
        <SectionTitle>Define Your Business Profile</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-6">
          Provide context about your business to improve AI recommendations and analysis.
          This information helps Claude understand your specific situation.
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">
              Business Description
            </label>
            <textarea
              value={context.businessDescription}
              onChange={(e) => setContext({ ...context, businessDescription: e.target.value })}
              placeholder="Describe your cannabis retail business, locations, and specialties..."
              rows={3}
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">
              Target Customer
            </label>
            <textarea
              value={context.targetCustomer}
              onChange={(e) => setContext({ ...context, targetCustomer: e.target.value })}
              placeholder="Describe your ideal customer demographics, preferences, and behaviors..."
              rows={3}
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">
              Key Business Goals
            </label>
            <textarea
              value={context.keyGoals}
              onChange={(e) => setContext({ ...context, keyGoals: e.target.value })}
              placeholder="What are your primary business objectives for the next quarter/year?"
              rows={3}
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">
              Competitor Information
            </label>
            <textarea
              value={context.competitorInfo}
              onChange={(e) => setContext({ ...context, competitorInfo: e.target.value })}
              placeholder="Who are your main competitors? What are their strengths/weaknesses?"
              rows={3}
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">
              Unique Selling Points
            </label>
            <textarea
              value={context.uniqueSellingPoints}
              onChange={(e) => setContext({ ...context, uniqueSellingPoints: e.target.value })}
              placeholder="What makes your business stand out from competitors?"
              rows={3}
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>

          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded font-medium"
          >
            {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved!' : 'Save Context'}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ============================================
// BRAND MAPPING TAB
// ============================================
function BrandMappingTab() {
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [newProduct, setNewProduct] = useState('');
  const [newBrand, setNewBrand] = useState('');

  const handleAddMapping = () => {
    if (newProduct && newBrand) {
      setMappings({ ...mappings, [newProduct]: newBrand });
      setNewProduct('');
      setNewBrand('');
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Product → Brand Mapping</SectionLabel>
        <SectionTitle>Configure Brand Normalization</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-6">
          Map product names to their normalized brand names for consistent brand analytics.
          This helps consolidate variations like "Stiiizy", "STIIIZY", and "STIIZY" into one brand.
        </p>

        {/* Quick Add */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1">
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">
              Product Name
            </label>
            <input
              type="text"
              value={newProduct}
              onChange={(e) => setNewProduct(e.target.value)}
              placeholder="e.g., STIIIZY Pod"
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">
              Normalized Brand
            </label>
            <input
              type="text"
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value)}
              placeholder="e.g., Stiiizy"
              className="w-full px-3 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleAddMapping}
              className="px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded font-medium"
            >
              Add Mapping
            </button>
          </div>
        </div>

        {/* Current Mappings */}
        {Object.keys(mappings).length > 0 && (
          <div className="border border-[var(--border)] rounded">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--paper)]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase">
                    Product Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase">
                    Mapped Brand
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(mappings).map(([product, brand]) => (
                  <tr key={product} className="border-b border-[var(--border)]">
                    <td className="px-4 py-3 text-sm">{product}</td>
                    <td className="px-4 py-3 text-sm font-medium">{brand}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          const newMappings = { ...mappings };
                          delete newMappings[product];
                          setMappings(newMappings);
                        }}
                        className="text-[var(--error)] text-sm"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {Object.keys(mappings).length === 0 && (
          <div className="text-center py-8 border border-dashed border-[var(--border)] rounded">
            <Tag className="w-12 h-12 mx-auto mb-4 text-[var(--muted)] opacity-50" />
            <p className="text-[var(--muted)]">No brand mappings configured yet.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================================
// INDUSTRY RESEARCH TAB
// ============================================
function IndustryResearchTab() {
  const [documents, setDocuments] = useState<
    { id: string; filename: string; category: string; uploadedAt: string }[]
  >([]);
  const [category, setCategory] = useState(RESEARCH_CATEGORIES[0]);

  const handleUpload = async (file: File) => {
    setDocuments((prev) => [
      {
        id: `doc_${Date.now()}`,
        filename: file.name,
        category,
        uploadedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Manual Research</SectionLabel>
        <SectionTitle>Upload Industry Documents</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload HTML files (saved webpages) for AI-powered analysis. Claude will extract
          key findings relevant to your cannabis retail business.
        </p>
        <div className="mb-4">
          <label className="text-sm font-medium text-[var(--muted)] block mb-2">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full max-w-xs px-3 py-2 border border-[var(--border)] rounded text-sm"
          >
            {RESEARCH_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
        <FileUpload
          onUpload={handleUpload}
          accept={{ 'text/html': ['.html', '.htm'] }}
          title="Drop HTML document here"
          description="Saved webpage for AI analysis"
        />
      </Card>

      {documents.length > 0 && (
        <Card>
          <SectionLabel>Research Library</SectionLabel>
          <SectionTitle>Uploaded Documents</SectionTitle>
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-3 bg-[var(--paper)] rounded"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-[var(--accent)]" />
                  <div>
                    <p className="text-sm font-medium">{doc.filename}</p>
                    <p className="text-xs text-[var(--muted)]">{doc.category}</p>
                  </div>
                </div>
                <span className="text-xs text-[var(--muted)]">
                  {new Date(doc.uploadedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================
// SEO ANALYSIS TAB
// ============================================
function SEOAnalysisTab() {
  const [selectedSite, setSelectedSite] = useState(SEO_SITES[0].id);
  const [seoData, setSeoData] = useState<{
    score: number;
    priorities: string[];
    quickWins: string[];
  } | null>(null);

  useEffect(() => {
    // Mock SEO data - in production loads from S3
    setSeoData({
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
    });
  }, [selectedSite]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-[var(--success)]';
    if (score >= 60) return 'text-[var(--warning)]';
    return 'text-[var(--error)]';
  };

  return (
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
              Last analyzed: {new Date().toLocaleDateString()}
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
  );
}

// ============================================
// QR PORTAL TAB
// ============================================
interface QRCodeRecord {
  [key: string]: string | number | boolean;
  shortCode: string;
  name: string;
  originalUrl: string;
  totalClicks: number;
  createdAt: string;
  active: boolean;
}

function QRPortalTab() {
  const [qrCodes, setQrCodes] = useState<QRCodeRecord[]>([]);
  const [qrImage, setQrImage] = useState<string>('');
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    color: '#1e391f',
    bgColor: '#ffffff',
  });

  const generateQRCode = async () => {
    if (!formData.name || !formData.url) return;

    try {
      const qrDataUrl = await QRCodeLib.toDataURL(formData.url, {
        width: 300,
        margin: 2,
        color: {
          dark: formData.color,
          light: formData.bgColor,
        },
      });

      setQrImage(qrDataUrl);

      const newQR: QRCodeRecord = {
        shortCode: `qr_${Date.now().toString(36)}`,
        name: formData.name,
        originalUrl: formData.url,
        totalClicks: 0,
        createdAt: new Date().toISOString(),
        active: true,
      };

      setQrCodes((prev) => [newQR, ...prev]);
      setFormData({ ...formData, name: '', url: '' });
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    }
  };

  const downloadQR = () => {
    if (!qrImage) return;
    const link = document.createElement('a');
    link.download = `qr-${formData.name || 'code'}.png`;
    link.href = qrImage;
    link.click();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <SectionLabel>QR Code Generator</SectionLabel>
          <SectionTitle>Create New QR Code</SectionTitle>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--muted)] block mb-2">Name *</label>
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
              disabled={!formData.name || !formData.url}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--ink)] text-[var(--paper)] rounded font-medium disabled:opacity-50"
            >
              <QrCode className="w-5 h-5" />
              Generate QR Code
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
                <button
                  onClick={downloadQR}
                  className="flex items-center gap-2 px-4 py-2 border border-[var(--border)] rounded text-sm font-medium hover:bg-[var(--paper)]"
                >
                  <Download className="w-4 h-4" />
                  Download PNG
                </button>
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

      {/* QR Code Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)] mb-1">Total QR Codes</p>
          <p className="text-2xl font-semibold font-serif">{qrCodes.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)] mb-1">Total Scans</p>
          <p className="text-2xl font-semibold font-serif">
            {qrCodes.reduce((sum, qr) => sum + qr.totalClicks, 0)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)] mb-1">Active Codes</p>
          <p className="text-2xl font-semibold font-serif">
            {qrCodes.filter((qr) => qr.active).length}
          </p>
        </Card>
      </div>

      {/* QR Code List */}
      {qrCodes.length > 0 && (
        <Card>
          <SectionLabel>QR Code Library</SectionLabel>
          <SectionTitle>All QR Codes</SectionTitle>
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
                      v
                        ? 'bg-[var(--success)]/15 text-[var(--success)]'
                        : 'bg-[var(--muted)]/15 text-[var(--muted)]'
                    }`}
                  >
                    {v ? 'Active' : 'Inactive'}
                  </span>
                ),
              },
            ]}
            pageSize={10}
          />
        </Card>
      )}
    </div>
  );
}

// ============================================
// MAIN DATA CENTER PAGE
// ============================================
export function DataCenterPage() {
  // Tab configuration matching Streamlit app
  const tabs = [
    {
      id: 'sales',
      label: 'Sales Data',
      content: <SalesDataTab />,
    },
    {
      id: 'invoice',
      label: 'Invoice Data',
      content: <InvoiceDataTab />,
    },
    {
      id: 'customer',
      label: 'Customer Data',
      content: <CustomerDataTab />,
    },
    {
      id: 'budtender',
      label: 'Budtender Performance',
      content: <BudtenderPerformanceTab />,
    },
    {
      id: 'context',
      label: 'Define Context',
      content: <DefineContextTab />,
    },
    {
      id: 'brand-mapping',
      label: 'Brand Mapping',
      content: <BrandMappingTab />,
    },
    {
      id: 'research',
      label: 'Industry Research',
      content: <IndustryResearchTab />,
    },
    {
      id: 'seo',
      label: 'SEO Analysis',
      content: <SEOAnalysisTab />,
    },
    {
      id: 'qr',
      label: 'QR Portal',
      content: <QRPortalTab />,
    },
  ];

  return (
    <div>
      <Header title="Manage Your Data" subtitle="Data Center" />
      <Tabs tabs={tabs} />
    </div>
  );
}
