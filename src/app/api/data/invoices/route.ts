// ============================================
// INVOICE DATA LOADING API ROUTE
// Loads invoice line items from Aurora PostgreSQL
// ============================================

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { gzipSync } from 'zlib';
import { getGzipResponseHeaders } from '@/lib/cors';

// Cache for invoice data
interface InvoiceCacheEntry {
  data: InvoiceLineItem[];
  timestamp: number;
  hash: string;
}

let invoiceCache: InvoiceCacheEntry | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface InvoiceLineItem {
  invoice_id: string;
  line_item_id: string;
  vendor: string;  // From invoice header (distributor)
  brand: string;   // From line item (product brand)
  product_name: string;
  product_type: string;
  product_subtype?: string;
  sku_units: number;
  unit_cost: number;
  total_cost: number;
  total_with_excise: number;
  strain?: string;
  unit_size?: string;
  trace_id?: string;
  is_promo: boolean;
  invoice_date?: string;
}

// Compute cache hash based on count
async function computeInvoiceHash(): Promise<string> {
  const count = await prisma.invoiceLineItem.count();
  return `invoices:${count}`;
}

// Load invoice line items from Aurora PostgreSQL
async function loadInvoiceData(): Promise<InvoiceLineItem[]> {
  console.log('Loading invoice data from Aurora PostgreSQL...');
  const startTime = Date.now();

  // Load invoice line items with invoice and brand relations
  const lineItems = await prisma.invoiceLineItem.findMany({
    include: {
      invoice: {
        include: {
          vendor: true,
        },
      },
      brand: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Transform to frontend format
  const items: InvoiceLineItem[] = lineItems.map((item) => ({
    invoice_id: item.invoiceId,
    line_item_id: `${item.invoiceId}-${item.lineNumber}`,
    vendor: item.invoice?.vendor?.canonicalName || item.invoice?.originalVendorName || 'Unknown',
    brand: item.brand?.canonicalName || item.originalBrandName,
    product_name: item.productName || '',
    product_type: item.productType || '',
    product_subtype: item.productSubtype || undefined,
    sku_units: item.skuUnits,
    unit_cost: Number(item.unitCost),
    total_cost: Number(item.totalCost),
    total_with_excise: Number(item.totalCostWithExcise),
    strain: item.strain || undefined,
    unit_size: item.unitSize || undefined,
    trace_id: item.traceId || undefined,
    is_promo: item.isPromo,
    invoice_date: item.invoice?.invoiceDate?.toISOString().split('T')[0],
  }));

  const duration = Date.now() - startTime;
  console.log(`Aurora invoice data load complete in ${duration}ms: ${items.length} line items`);

  // Log vendor distribution for debugging
  const vendorCounts: Record<string, number> = {};
  items.forEach(i => {
    vendorCounts[i.vendor] = (vendorCounts[i.vendor] || 0) + 1;
  });
  console.log(`Vendor distribution: ${JSON.stringify(vendorCounts)}`);

  return items;
}

export async function GET(request: NextRequest) {
  try {
    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    // Get pagination and filter params
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '5000');
    const vendor = url.searchParams.get('vendor'); // Optional filter
    const brand = url.searchParams.get('brand'); // Optional filter

    // Check cache first
    const currentHash = await computeInvoiceHash();

    if (
      !invoiceCache ||
      invoiceCache.hash !== currentHash ||
      Date.now() - invoiceCache.timestamp > CACHE_TTL
    ) {
      // Load fresh data
      const data = await loadInvoiceData();
      invoiceCache = {
        data,
        timestamp: Date.now(),
        hash: currentHash,
      };
    }

    // Apply filters
    let filteredData = invoiceCache.data;

    if (vendor) {
      filteredData = filteredData.filter(i => i.vendor.toLowerCase().includes(vendor.toLowerCase()));
    }

    if (brand) {
      filteredData = filteredData.filter(i => i.brand.toLowerCase().includes(brand.toLowerCase()));
    }

    // Calculate pagination
    const totalCount = filteredData.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedData = filteredData.slice(startIndex, startIndex + pageSize);

    const responseData = {
      success: true,
      data: paginatedData,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasMore: page < totalPages,
      },
      cached: invoiceCache.hash === currentHash,
      source: 'aurora',
    };

    // Compress response if client supports gzip
    if (supportsGzip) {
      const compressed = gzipSync(JSON.stringify(responseData));
      return new Response(compressed, {
        status: 200,
        headers: getGzipResponseHeaders(request),
      });
    }

    return Response.json(responseData);
  } catch (error) {
    console.error('Invoice data loading error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load invoice data',
      },
      { status: 500 }
    );
  }
}
