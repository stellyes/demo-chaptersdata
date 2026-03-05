'use client';

import { memo, useState, useEffect, useMemo, useRef } from 'react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Tabs } from '@/components/ui/Tabs';
import { FileUpload } from '@/components/ui/FileUpload';
import { DataTable } from '@/components/ui/DataTable';
import { useAppStore } from '@/store/app-store';
import { parseCSV, cleanSalesData, cleanBrandData, cleanProductData, cleanCustomerData } from '@/lib/services/data-processor';
import { STORES, SEO_SITES, RESEARCH_CATEGORIES } from '@/lib/config';
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
  Loader2,
  ExternalLink,
  Upload,
  Trash2,
  Save,
  CheckCircle,
  TrendingUp,
} from 'lucide-react';
import { DataHealthTab } from '@/components/data-health/DataHealthTab';

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
    addNotification,
  } = useAppStore();

  const [uploadStore, setUploadStore] = useState<StoreId>('grass_roots');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handleSalesUpload = async (file: File) => {
    const text = await file.text();
    const rawData = parseCSV<Record<string, string>>(text);
    // Pass uploadStore to ensure correct store assignment
    const cleaned = cleanSalesData(rawData, uploadStore);

    // Update frontend store
    setSalesData([...salesData, ...cleaned]);

    // Also persist to database via API
    const formData = new FormData();
    formData.append('file', file);
    formData.append('store', uploadStore);
    formData.append('startDate', startDate || cleaned[0]?.date || '');
    formData.append('endDate', endDate || cleaned[cleaned.length - 1]?.date || '');

    try {
      const response = await fetch('/api/data/sales', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        addNotification({
          type: 'success',
          title: 'Sales Data Saved',
          message: `${result.data.recordCount} records saved to database.`,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to save sales data to database:', error);
      addNotification({
        type: 'warning',
        title: 'Database Save Issue',
        message: 'Data loaded locally but may not have saved to database.',
      });
    }
  };

  const handleBrandUpload = async (file: File) => {
    if (!startDate || !endDate) {
      throw new Error('Please set the date range before uploading brand data');
    }
    const text = await file.text();
    const rawData = parseCSV<Record<string, string>>(text);
    const cleaned = cleanBrandData(rawData, uploadStore, startDate, endDate);

    // Update frontend store
    setBrandData([...brandData, ...cleaned]);

    // Also persist to database via API
    try {
      const response = await fetch('/api/data/load-aurora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'brands',
          storeId: uploadStore,
          startDate,
          endDate,
          data: cleaned,
        }),
      });
      const result = await response.json();
      if (result.success) {
        addNotification({
          type: 'success',
          title: 'Brand Data Saved',
          message: `${result.recordCount || cleaned.length} brand records saved to database.`,
        });
      } else {
        console.error('Brand data save failed:', result.error);
        addNotification({
          type: 'error',
          title: 'Brand Data Save Failed',
          message: result.error || 'Failed to save brand data to database.',
        });
      }
    } catch (error) {
      console.error('Failed to save brand data to database:', error);
      addNotification({
        type: 'warning',
        title: 'Database Save Issue',
        message: 'Data loaded locally but may not have saved to database.',
      });
    }
  };

  const handleProductUpload = async (file: File) => {
    if (!startDate || !endDate) {
      throw new Error('Please set the date range before uploading product data');
    }
    const text = await file.text();
    const rawData = parseCSV<Record<string, string>>(text);
    const cleaned = cleanProductData(rawData, uploadStore, startDate, endDate);

    // Update frontend store
    setProductData([...productData, ...cleaned]);

    // Also persist to database via API
    try {
      const response = await fetch('/api/data/load-aurora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'products',
          storeId: uploadStore,
          startDate,
          endDate,
          data: cleaned,
        }),
      });
      const result = await response.json();
      if (result.success) {
        addNotification({
          type: 'success',
          title: 'Product Data Saved',
          message: `${result.recordCount || cleaned.length} product records saved to database.`,
        });
      } else {
        console.error('Product data save failed:', result.error);
        addNotification({
          type: 'error',
          title: 'Product Data Save Failed',
          message: result.error || 'Failed to save product data to database.',
        });
      }
    } catch (error) {
      console.error('Failed to save product data to database:', error);
      addNotification({
        type: 'warning',
        title: 'Database Save Issue',
        message: 'Data loaded locally but may not have saved to database.',
      });
    }
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

      {/* Upload Cards Grid - 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Sales by Store Upload */}
        <Card>
          <SectionLabel>Sales by Store</SectionLabel>
          <SectionTitle>Daily Sales Report</SectionTitle>
          <p className="text-sm text-[var(--muted)] mb-4">
            Upload the "Sales by Store" CSV export from Treez.
          </p>
          <FileUpload
            onUpload={handleSalesUpload}
            title="Drop Sales CSV here"
            description="Date, Store, Net Sales, Tickets, Margin %"
          />
          {dataStatus.sales.loaded && (
            <div className="mt-4 p-3 bg-[var(--success)]/10 rounded flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-[var(--success)]" />
              <span className="text-sm text-[var(--success)]">
                {dataStatus.sales.count} records
              </span>
            </div>
          )}
        </Card>

        {/* Brand Performance Upload */}
        <Card>
          <SectionLabel>Net Sales by Brand</SectionLabel>
          <SectionTitle>Brand Performance</SectionTitle>
          <p className="text-sm text-[var(--muted)] mb-4">
            Upload the "Net Sales by Brand" CSV. Set dates above first.
          </p>
          <FileUpload
            onUpload={handleBrandUpload}
            title="Drop Brand CSV here"
            description="Requires Start and End dates above"
          />
          {dataStatus.brands.loaded && (
            <div className="mt-4 p-3 bg-[var(--success)]/10 rounded flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-[var(--success)]" />
              <span className="text-sm text-[var(--success)]">
                {dataStatus.brands.count} records
              </span>
            </div>
          )}
        </Card>

        {/* Product Category Upload */}
        <Card>
          <SectionLabel>Net Sales by Product Type</SectionLabel>
          <SectionTitle>Product Categories</SectionTitle>
          <p className="text-sm text-[var(--muted)] mb-4">
            Upload the "Net Sales by Product Type" CSV. Set dates above first.
          </p>
          <FileUpload
            onUpload={handleProductUpload}
            title="Drop Product CSV here"
            description="Requires Start and End dates above"
          />
          {dataStatus.products.loaded && (
            <div className="mt-4 p-3 bg-[var(--success)]/10 rounded flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-[var(--success)]" />
              <span className="text-sm text-[var(--success)]">
                {dataStatus.products.count} records
              </span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ============================================
// INVOICE DATA TAB
// ============================================
interface InvoiceSummary {
  [key: string]: string | number;
  invoice_id: string;
  invoice_number: string;
  vendor: string;
  invoice_date: string;
  total_cost: number;
  line_items_count: number;
}

function InvoiceDataTab() {
  const { invoiceData, dataStatus } = useAppStore();
  const [processing, setProcessing] = useState(false);

  // Aggregate line items into invoice summaries
  const invoiceSummaries = useMemo(() => {
    const summaryMap: Record<string, InvoiceSummary> = {};

    for (const lineItem of invoiceData) {
      const invoiceId = lineItem.invoice_id;
      if (!summaryMap[invoiceId]) {
        summaryMap[invoiceId] = {
          invoice_id: invoiceId,
          invoice_number: invoiceId, // Use invoice_id as number if not available
          vendor: '', // Will be populated if available in line item data
          invoice_date: '',
          total_cost: 0,
          line_items_count: 0,
        };
      }
      summaryMap[invoiceId].total_cost += lineItem.total_cost || 0;
      summaryMap[invoiceId].line_items_count += 1;
    }

    return Object.values(summaryMap).sort((a, b) =>
      b.invoice_id.localeCompare(a.invoice_id)
    );
  }, [invoiceData]);

  // Calculate totals
  const totalInvoices = invoiceSummaries.length;
  const totalCost = invoiceData.reduce((sum, item) => sum + (item.total_cost || 0), 0);
  const totalLineItems = invoiceData.length;

  const handleInvoiceUpload = async (file: File) => {
    setProcessing(true);
    try {
      // In production, this would upload to S3/DynamoDB
      // For now, just show processing
      await new Promise(resolve => setTimeout(resolve, 1000));
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
        {dataStatus.invoices.loaded && (
          <div className="mt-4 p-3 bg-[var(--success)]/10 rounded flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[var(--success)]" />
            <span className="text-sm text-[var(--success)]">
              {dataStatus.invoices.count.toLocaleString()} invoice line items loaded from S3
            </span>
          </div>
        )}
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card className="p-3 md:p-4">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
            <FileText className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Total Invoices</p>
              <p className="text-xl font-semibold font-serif">{totalInvoices}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
            <TrendingUp className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Total Cost</p>
              <p className="text-xl font-semibold font-serif">
                ${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
            <Database className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Line Items</p>
              <p className="text-xl font-semibold font-serif">
                {totalLineItems.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
            <AlertCircle className="w-5 h-5 text-[var(--muted)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Needs Review</p>
              <p className="text-xl font-semibold font-serif">0</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Invoice List */}
      {invoiceSummaries.length > 0 ? (
        <Card>
          <SectionLabel>Processed Invoices</SectionLabel>
          <SectionTitle>Invoice History</SectionTitle>
          <DataTable
            data={invoiceSummaries}
            columns={[
              { key: 'invoice_id', label: 'Invoice #', sortable: true },
              {
                key: 'total_cost',
                label: 'Total Cost',
                sortable: true,
                align: 'right',
                render: (v) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
              },
              { key: 'line_items_count', label: 'Items', sortable: true, align: 'right' },
            ]}
            pageSize={10}
            exportable
            exportFilename="invoices"
          />
        </Card>
      ) : (
        <Card>
          <div className="text-center py-8">
            <FileText className="w-12 h-12 mx-auto mb-4 text-[var(--muted)] opacity-50" />
            <p className="text-[var(--muted)]">
              {dataStatus.invoices.loaded
                ? 'No invoice data found. Upload invoice PDFs to get started.'
                : 'Invoice data is loading from S3...'}
            </p>
          </div>
        </Card>
      )}

      {/* Line Items Table */}
      {invoiceData.length > 0 && (
        <Card>
          <SectionLabel>All Line Items</SectionLabel>
          <SectionTitle>Invoice Line Item Details</SectionTitle>
          <DataTable
            data={invoiceData}
            columns={[
              { key: 'invoice_id', label: 'Invoice', sortable: true },
              { key: 'product_name', label: 'Product', sortable: true },
              { key: 'product_type', label: 'Type', sortable: true },
              { key: 'sku_units', label: 'Units', sortable: true, align: 'right' },
              {
                key: 'unit_cost',
                label: 'Unit Cost',
                sortable: true,
                align: 'right',
                render: (v) => `$${Number(v).toFixed(2)}`,
              },
              {
                key: 'total_cost',
                label: 'Total',
                sortable: true,
                align: 'right',
                render: (v) => `$${Number(v).toFixed(2)}`,
              },
            ]}
            pageSize={20}
            exportable
            exportFilename="invoice-line-items"
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
  const { setCustomerData, customerData, dataStatus, addNotification } = useAppStore();
  const [uploadStore, setUploadStore] = useState<StoreId>('grass_roots');

  const handleCustomerUpload = async (file: File) => {
    const text = await file.text();
    const rawData = parseCSV<Record<string, string>>(text);
    const cleaned = cleanCustomerData(rawData);

    // Update frontend store
    setCustomerData([...customerData, ...cleaned]);

    // Also persist to database via API
    try {
      const response = await fetch('/api/data/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: uploadStore,
          data: cleaned,
        }),
      });
      const result = await response.json();
      if (result.success) {
        addNotification({
          type: 'success',
          title: 'Customer Data Saved',
          message: `${result.recordCount || cleaned.length} customer records saved to database.`,
        });
      }
    } catch (error) {
      console.error('Failed to save customer data to database:', error);
      addNotification({
        type: 'warning',
        title: 'Database Save Issue',
        message: 'Data loaded locally but may not have saved to database.',
      });
    }
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
    addNotification,
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card className="p-3 md:p-4">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
            <Users className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Total Budtenders</p>
              <p className="text-xl font-semibold font-serif">{employeeStats.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
            <CheckCircle className="w-5 h-5 text-[var(--success)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Permanent Employees</p>
              <p className="text-xl font-semibold font-serif">{assignedCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
            <AlertCircle className="w-5 h-5 text-[var(--warning)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Unassigned</p>
              <p className="text-xl font-semibold font-serif">{unassignedCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
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
              className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-[var(--error)] border border-[var(--error)]/30 rounded hover:bg-[var(--error)]/10 w-full sm:w-auto"
            >
              <Trash2 className="w-4 h-4" />
              Clear All Assignments
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4">
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
            className="w-full sm:w-auto px-3 py-2 border border-[var(--border)] rounded text-sm"
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
          <label className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded text-sm cursor-pointer whitespace-nowrap">
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

            // Update frontend store
            setBudtenderData([...budtenderData, ...newRecords]);

            // Also persist to database via API
            try {
              const response = await fetch('/api/data/load-aurora', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'budtenders',
                  data: newRecords,
                }),
              });
              const result = await response.json();
              if (result.success) {
                addNotification({
                  type: 'success',
                  title: 'Budtender Data Saved',
                  message: `${result.recordCount || newRecords.length} budtender records saved to database.`,
                });
              }
            } catch (error) {
              console.error('Failed to save budtender data to database:', error);
              addNotification({
                type: 'warning',
                title: 'Database Save Issue',
                message: 'Data loaded locally but may not have saved to database.',
              });
            }
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
  const { brandMappings, setBrandMappings } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Safely handle null/undefined brandMappings
  const safeMappings = brandMappings || {};

  // Calculate stats
  const brandCount = Object.keys(safeMappings).length;
  const aliasCount = Object.values(safeMappings).reduce(
    (acc, entry) => acc + (entry?.aliases ? Object.keys(entry.aliases).length : 0),
    0
  );

  // Filter brands based on search
  const filteredBrands = useMemo(() => {
    if (!searchTerm) return Object.entries(safeMappings);

    const term = searchTerm.toLowerCase();
    return Object.entries(safeMappings).filter(([brandName, entry]) => {
      // Match on brand name
      if (brandName.toLowerCase().includes(term)) return true;
      // Match on any alias
      return entry?.aliases && Object.keys(entry.aliases).some(alias =>
        alias.toLowerCase().includes(term)
      );
    });
  }, [safeMappings, searchTerm]);

  const toggleExpand = (brandName: string) => {
    const newExpanded = new Set(expandedBrands);
    if (newExpanded.has(brandName)) {
      newExpanded.delete(brandName);
    } else {
      newExpanded.add(brandName);
    }
    setExpandedBrands(newExpanded);
  };

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Upload to S3
      const response = await fetch('/api/data/brand-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        // Update local store
        setBrandMappings(data);
        setUploadSuccess(`Successfully uploaded ${result.count} brand mappings`);
      } else {
        setUploadError(result.error || 'Failed to upload mappings');
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to parse JSON file');
    } finally {
      setUploading(false);
      // Reset the input
      event.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Brand Normalization</SectionLabel>
        <SectionTitle>Brand → Alias Mappings</SectionTitle>
        <p className="text-sm text-[var(--muted)] mb-6">
          View the canonical brand names and their associated aliases. Each alias maps to a product type.
          This consolidates variations like &quot;STIIIZY&quot;, &quot;Stiiizy&quot;, and &quot;STIIZY&quot; into one brand.
        </p>

        {/* Upload Section */}
        <div className="mb-6 p-4 border border-dashed border-[var(--border)] rounded-lg bg-[var(--paper)]">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-[var(--ink)]">Upload Brand Mappings</h4>
              <p className="text-xs text-[var(--muted)] mt-1">
                Upload a JSON file with v2 format: {`{ "Brand Name": { "aliases": { "ALIAS": "PRODUCT_TYPE" } } }`}
              </p>
            </div>
            <label className={`flex items-center gap-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded cursor-pointer ${uploading ? 'opacity-50' : 'hover:opacity-90'}`}>
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload JSON
                </>
              )}
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
          </div>
          {uploadError && (
            <div className="mt-3 p-2 bg-[var(--error)]/10 border border-[var(--error)]/30 rounded text-sm text-[var(--error)] flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {uploadError}
            </div>
          )}
          {uploadSuccess && (
            <div className="mt-3 p-2 bg-[var(--success)]/10 border border-[var(--success)]/30 rounded text-sm text-[var(--success)] flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              {uploadSuccess}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex gap-6 mb-6">
          <div className="bg-[var(--paper)] border border-[var(--border)] rounded px-4 py-3">
            <div className="text-2xl font-bold">{brandCount}</div>
            <div className="text-xs text-[var(--muted)]">Canonical Brands</div>
          </div>
          <div className="bg-[var(--paper)] border border-[var(--border)] rounded px-4 py-3">
            <div className="text-2xl font-bold">{aliasCount}</div>
            <div className="text-xs text-[var(--muted)]">Total Aliases</div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search brands or aliases..."
              className="w-full pl-10 pr-4 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>
        </div>

        {/* Brand List */}
        {filteredBrands.length > 0 ? (
          <div className="border border-[var(--border)] rounded divide-y divide-[var(--border)] max-h-[600px] overflow-y-auto">
            {filteredBrands.map(([brandName, entry]) => {
              const isExpanded = expandedBrands.has(brandName);
              const aliasEntries = Object.entries(entry.aliases);
              const productTypes = [...new Set(Object.values(entry.aliases))];

              return (
                <div key={brandName} className="bg-[var(--paper)]">
                  <button
                    onClick={() => toggleExpand(brandName)}
                    className="w-full px-4 py-3 flex items-start justify-between hover:bg-[var(--hover)] transition-colors gap-2"
                  >
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="font-medium">{brandName}</span>
                      <span className="text-xs text-[var(--muted)] bg-[var(--hover)] px-2 py-0.5 rounded whitespace-nowrap">
                        {aliasEntries.length} alias{aliasEntries.length !== 1 ? 'es' : ''}
                      </span>
                      {productTypes.map(type => (
                        <span key={type} className="text-xs text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded whitespace-nowrap">
                          {type}
                        </span>
                      ))}
                    </div>
                    <span className="text-[var(--muted)] flex-shrink-0">
                      {isExpanded ? '−' : '+'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-[var(--muted)] uppercase">
                            <th className="pb-2 font-medium">Alias</th>
                            <th className="pb-2 font-medium">Product Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aliasEntries.map(([alias, productType]) => (
                            <tr key={alias} className="border-t border-[var(--border)]">
                              <td className="py-2 font-mono text-xs">{alias}</td>
                              <td className="py-2">
                                <span className="text-xs bg-[var(--hover)] px-2 py-0.5 rounded">
                                  {productType}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 border border-dashed border-[var(--border)] rounded">
            <Tag className="w-12 h-12 mx-auto mb-4 text-[var(--muted)] opacity-50" />
            <p className="text-[var(--muted)]">
              {searchTerm ? 'No brands match your search.' : 'No brand mappings loaded yet.'}
            </p>
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
interface SeoAudit {
  id: string;
  domain: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  summary?: {
    healthScore: number;
    totalPages: number;
    totalIssues: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
  };
  pages?: Array<{
    url: string;
    statusCode: number;
    title?: string;
    issues: Array<{
      id: string;
      code: string;
      category: string;
      priority: string;
      title: string;
      description: string;
      recommendation: string;
    }>;
  }>;
}

function SEOAnalysisTab() {
  const [selectedSite, setSelectedSite] = useState(SEO_SITES[0]);
  const [audits, setAudits] = useState<SeoAudit[]>([]);
  const [selectedAudit, setSelectedAudit] = useState<SeoAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [maxPages, setMaxPages] = useState(50);
  const [customUrl, setCustomUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Load audits on mount
  useEffect(() => {
    loadAudits();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const loadAudits = async () => {
    try {
      const response = await fetch('/api/seo/audits?limit=50');
      const result = await response.json();
      if (result.success) {
        setAudits(result.data);
      }
    } catch (error) {
      console.error('Failed to load audits:', error);
    }
  };

  const startAudit = async (domain: string) => {
    setCrawling(true);
    try {
      const response = await fetch('/api/seo/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, maxPages, async: true }),
      });
      const result = await response.json();
      if (result.success) {
        setSelectedAudit(result.data);
        loadAudits();
        // Start polling for updates if audit is in progress
        if (result.data.status === 'crawling') {
          startPolling(result.data.id);
        }
      } else {
        alert(`Audit failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to start audit:', error);
      alert('Failed to start audit');
    } finally {
      setCrawling(false);
    }
  };

  const startPolling = (auditId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/seo/audits/${auditId}`);
        const result = await response.json();
        if (result.success) {
          setSelectedAudit(result.data);
          loadAudits();
          if (result.data.status === 'completed' || result.data.status === 'failed') {
            if (pollingRef.current) clearInterval(pollingRef.current);
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 3000);
  };

  const deleteAudit = async (auditId: string) => {
    if (!confirm('Are you sure you want to delete this audit?')) return;
    try {
      await fetch(`/api/seo/audits/${auditId}`, { method: 'DELETE' });
      setAudits(audits.filter(a => a.id !== auditId));
      if (selectedAudit?.id === auditId) setSelectedAudit(null);
    } catch (error) {
      console.error('Failed to delete audit:', error);
    }
  };

  const filteredAudits = audits.filter(audit => {
    if (searchQuery && !audit.domain.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (statusFilter && audit.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const loadAuditDetails = async (auditId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/seo/audits/${auditId}`);
      const result = await response.json();
      if (result.success) {
        setSelectedAudit(result.data);
      }
    } catch (error) {
      console.error('Failed to load audit:', error);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-[var(--success)]';
    if (score >= 60) return 'text-[var(--warning)]';
    return 'text-[var(--error)]';
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* New Audit Section */}
      <Card>
        <SectionLabel>New Audit</SectionLabel>
        <SectionTitle>Start SEO Analysis</SectionTitle>
        <div className="space-y-4">
          {/* Site Selector */}
          <div className="flex flex-wrap gap-3">
            {SEO_SITES.map((site) => (
              <button
                key={site.id}
                onClick={() => {
                  setSelectedSite(site);
                  setCustomUrl('');
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded border transition-all ${
                  selectedSite.id === site.id && !customUrl
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                    : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                }`}
              >
                <Globe className="w-4 h-4" />
                <span className="text-sm font-medium">{site.name}</span>
              </button>
            ))}
          </div>

          {/* Custom URL Input */}
          <div className="flex gap-3">
            <input
              type="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="Or enter a custom URL (e.g., https://example.com)"
              className="flex-1 px-4 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>

          {/* Audit Settings with Slider */}
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <label className="text-sm text-[var(--muted)] min-w-[80px]">Max Pages:</label>
              <input
                type="range"
                min={10}
                max={500}
                step={10}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                className="flex-1 h-2 bg-[var(--border)] rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
              />
              <input
                type="number"
                min={10}
                max={500}
                value={maxPages}
                onChange={(e) => setMaxPages(Math.min(500, Math.max(10, Number(e.target.value))))}
                className="w-20 px-2 py-1 border border-[var(--border)] rounded text-sm text-center"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--muted)]">
                Crawl up to {maxPages} pages • Higher values take longer but provide more comprehensive analysis
              </span>
              <button
                onClick={() => startAudit(customUrl || selectedSite.url)}
                disabled={crawling}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded font-medium disabled:opacity-50"
              >
                {crawling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Start Audit
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Search and Filter */}
      {audits.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="Search by domain..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-[var(--border)] rounded text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-[var(--border)] rounded text-sm"
          >
            <option value="">All Status</option>
            <option value="completed">Completed</option>
            <option value="crawling">Crawling</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      )}

      {/* Audit Cards Grid */}
      {filteredAudits.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAudits.map((audit) => (
            <Card
              key={audit.id}
              className={`cursor-pointer transition-all hover:border-[var(--accent)] ${selectedAudit?.id === audit.id ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : ''}`}
              onClick={() => loadAuditDetails(audit.id)}
            >
              {/* Progress bar for active audits */}
              {audit.status === 'crawling' && (
                <div className="absolute inset-x-0 top-0 h-1 bg-[var(--border)] rounded-t">
                  <div
                    className="h-full bg-[var(--accent)] transition-all"
                    style={{ width: `${audit.summary ? (audit.summary.totalPages / maxPages) * 100 : 10}%` }}
                  />
                </div>
              )}
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--ink)] truncate">
                    {audit.domain.replace(/^https?:\/\//, '')}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {new Date(audit.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`ml-2 px-2 py-1 text-xs rounded ${
                  audit.status === 'completed' ? 'bg-green-100 text-green-800' :
                  audit.status === 'crawling' ? 'bg-blue-100 text-blue-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  {audit.status}
                </span>
              </div>
              {audit.summary && (
                <div className="mt-4 grid grid-cols-3 gap-2 pt-3 border-t border-[var(--border)]">
                  <div>
                    <p className="text-xs text-[var(--muted)]">Health</p>
                    <p className={`text-lg font-semibold ${getScoreColor(audit.summary.healthScore)}`}>
                      {audit.summary.healthScore}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)]">Pages</p>
                    <p className="text-lg font-semibold">{audit.summary.totalPages}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)]">Issues</p>
                    <p className="text-lg font-semibold">
                      {(audit.summary.criticalIssues || 0) + (audit.summary.highIssues || 0) + (audit.summary.mediumIssues || 0) + (audit.summary.lowIssues || 0)}
                    </p>
                  </div>
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between">
                <span className="text-sm text-[var(--accent)] font-medium">View Details</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteAudit(audit.id); }}
                  className="p-1.5 rounded hover:bg-red-50 text-[var(--muted)] hover:text-red-600 transition-colors"
                  title="Delete audit"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Selected Audit Results */}
      {selectedAudit && selectedAudit.summary && (
        <>
          {/* Score Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
            <Card className="p-4 text-center">
              <p className={`text-3xl font-bold font-serif ${getScoreColor(selectedAudit.summary.healthScore)}`}>
                {selectedAudit.summary.healthScore}
              </p>
              <p className="text-xs text-[var(--muted)]">Health Score</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-semibold font-serif">{selectedAudit.summary.totalPages}</p>
              <p className="text-xs text-[var(--muted)]">Pages</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-semibold font-serif text-red-600">{selectedAudit.summary.criticalIssues}</p>
              <p className="text-xs text-[var(--muted)]">Critical</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-semibold font-serif text-orange-600">{selectedAudit.summary.highIssues}</p>
              <p className="text-xs text-[var(--muted)]">High</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-semibold font-serif text-yellow-600">{selectedAudit.summary.mediumIssues + selectedAudit.summary.lowIssues}</p>
              <p className="text-xs text-[var(--muted)]">Medium/Low</p>
            </Card>
          </div>

          {/* Page Issues */}
          {selectedAudit.pages && selectedAudit.pages.length > 0 && (
            <Card>
              <SectionLabel>Page Analysis</SectionLabel>
              <SectionTitle>Issues by Page</SectionTitle>
              <div className="mt-4 space-y-4 max-h-[500px] overflow-y-auto">
                {selectedAudit.pages.map((page) => (
                  <div key={page.url} className="border border-[var(--border)] rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-medium text-[var(--ink)] break-all">{page.url}</p>
                        <p className="text-sm text-[var(--muted)]">{page.title || 'No title'}</p>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded ${page.statusCode === 200 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {page.statusCode}
                      </span>
                    </div>
                    {page.issues.length > 0 ? (
                      <div className="space-y-2">
                        {page.issues.map((issue) => (
                          <div key={issue.id} className="flex items-start gap-3 p-2 bg-[var(--paper)] rounded">
                            <span className={`px-2 py-0.5 text-xs rounded ${getPriorityColor(issue.priority)}`}>
                              {issue.priority}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[var(--ink)]">{issue.title}</p>
                              <p className="text-xs text-[var(--muted)]">{issue.description}</p>
                              <p className="text-xs text-[var(--accent)] mt-1">→ {issue.recommendation}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--success)]">No issues found</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {loading && (
        <div className="text-center py-8">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-[var(--accent)]" />
          <p className="text-sm text-[var(--muted)] mt-2">Loading audit details...</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN DATA CENTER PAGE
// ============================================
export const DataCenterPage = memo(function DataCenterPage() {
  // Tab configuration - using render functions for lazy loading (only renders when tab is active)
  const tabs = [
    {
      id: 'sales',
      label: 'Sales Data',
      render: () => <SalesDataTab />,
    },
    {
      id: 'invoice',
      label: 'Invoice Data',
      render: () => <InvoiceDataTab />,
    },
    {
      id: 'customer',
      label: 'Customer Data',
      render: () => <CustomerDataTab />,
    },
    {
      id: 'budtender',
      label: 'Budtender Performance',
      render: () => <BudtenderPerformanceTab />,
    },
    {
      id: 'context',
      label: 'Define Context',
      render: () => <DefineContextTab />,
    },
    {
      id: 'brand-mapping',
      label: 'Brand Mapping',
      render: () => <BrandMappingTab />,
    },
    {
      id: 'research',
      label: 'Industry Research',
      render: () => <IndustryResearchTab />,
    },
    {
      id: 'seo',
      label: 'SEO Analysis',
      render: () => <SEOAnalysisTab />,
    },
    {
      id: 'health',
      label: 'Data Health',
      render: () => <DataHealthTab />,
    },
  ];

  return (
    <div>
      <Header title="Manage Your Data" subtitle="Data Center" />
      <Tabs tabs={tabs} />
    </div>
  );
});
