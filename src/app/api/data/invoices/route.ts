// ============================================
// INVOICE DATA LOADING API ROUTE
// Loads invoice line items from DynamoDB separately
// to avoid blocking the main data load
// ============================================

import { NextRequest } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { gzipSync } from 'zlib';

// DynamoDB Client singleton
let dynamoClient: DynamoDBDocumentClient | null = null;

function getDynamoClient(): DynamoDBDocumentClient {
  if (!dynamoClient) {
    const client = new DynamoDBClient({
      region: process.env.CHAPTERS_AWS_REGION || process.env.AWS_REGION || 'us-west-1',
      credentials: {
        accessKeyId: process.env.CHAPTERS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.CHAPTERS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    dynamoClient = DynamoDBDocumentClient.from(client);
  }
  return dynamoClient;
}

const INVOICE_HEADERS_TABLE = 'retail-invoices';
const INVOICE_LINE_ITEMS_TABLE = 'retail-invoice-line-items';

// Cache for invoice data
interface InvoiceCacheEntry {
  data: InvoiceLineItem[];
  timestamp: number;
}

let invoiceCache: InvoiceCacheEntry | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Invoice header from DynamoDB (contains vendor info)
interface InvoiceHeader {
  invoice_id: string;
  vendor: string;
  invoice_date?: string;
  download_date?: string;
}

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

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

// Parse and sanitize SKU units - filters out UPC barcodes that were incorrectly stored as units
// UPC barcodes are 12-digit numbers (800000000000+), real unit quantities are typically under 10000
const MAX_REASONABLE_UNITS = 10000;

function parseSkuUnits(value: unknown): number {
  const num = parseNumber(value);
  // If the value looks like a UPC barcode (12+ digits, starts with 8 or higher first digit pattern)
  // or is unreasonably large, return 0
  if (num > MAX_REASONABLE_UNITS) {
    // This is likely a UPC barcode, not a unit count
    return 0;
  }
  return Math.max(0, Math.round(num)); // Ensure non-negative integer
}

// Vendor normalization mapping - consolidates duplicate vendor names to canonical names
// Based on DynamoDB scan analysis of 798 unique vendors
const VENDOR_NORMALIZATION: Record<string, string> = {
  // NABIS (includes NABITWO and NABIONE variants)
  'NABITWO, LLC A&B': 'Nabis',
  'NABITWO, LLC': 'Nabis',
  'NABITWO, LLC SUITE A&B': 'Nabis',
  'NABITWO, LLC ST. SUITE A&B': 'Nabis',
  'NABITWO, LLC LLC': 'Nabis',
  'NABITWO, LLC C11-0001274-': 'Nabis',
  'NABIONE INC': 'Nabis',
  'NABIONE, INC.': 'Nabis',
  'NABIONE INC INC': 'Nabis',
  'NABIONE, INC. DBA NABIS': 'Nabis',

  // KIVA
  'KIVA SALES & SERVICE': 'Kiva',
  'KIVA SALES & SERVICE, INC.': 'Kiva',
  'KIVA SALES & SERVICE CA 946212013': 'Kiva',
  'KIVA SALES & SERVICE OAKLAND CA 946212013': 'Kiva',
  'KIVA SALES & SERVICE OAKLAND CA': 'Kiva',
  'KIVA DISTRIBUTION': 'Kiva',
  'KIVA SALES': 'Kiva',
  'KIVA': 'Kiva',

  // HERBL
  'HERBL, INC': 'Herbl',
  'HERBL INC': 'Herbl',
  'HERBL INC INC': 'Herbl',
  'HERBL, INC INC': 'Herbl',
  'HERBL, INC DBA HERBL DISTRIBUTION SOLUTIONS': 'Herbl',
  'HERBL DISTRIBUTION SOLUTIONS': 'Herbl',

  // INTEGRAL INNOVATIONS
  'INTEGRAL INNOVATIONS': 'Integral Innovations',
  'INTEGRAL INNOVATIONS, LLC': 'Integral Innovations',
  'INTEGRAL INNOVATIONS, LLC CA 93940': 'Integral Innovations',
  'INTEGRAL INNOVATIONS CA 93940': 'Integral Innovations',
  'INTEGRAL INNOVATIONS, LLC LLC': 'Integral Innovations',

  // BIG PETE'S
  "BIG PETE'S": "Big Pete's",
  "BIG PETE'S LLC": "Big Pete's",
  "BIG PETE'S TREATS": "Big Pete's",
  "BIG PETE'S LLC CA 95062": "Big Pete's",
  'BIG PETES': "Big Pete's",
  "BIG PETE'S LLC LLC": "Big Pete's",

  // KIND HOUSE
  'KIND HOUSE, INC.': 'Kind House',
  'KIND HOUSE DISTRIBUTION': 'Kind House',
  'KIND HOUSE, INC. INC': 'Kind House',

  // RIVER DISTRIBUTING
  'RIVER DISTRIBUTING CO., LLC': 'River Distributing',
  'RIVER DISTRIBUTING CO., LLC LLC': 'River Distributing',
  'RIVER DISTRIBUTING CO': 'River Distributing',
  'RIVER DISTRIBUTING CO.': 'River Distributing',

  // GREENFIELD ORGANIX
  'GREENFIELD ORGANIX': 'Greenfield Organix',
  'GREENFIELD ORGANIX DBA LOUDPACK': 'Greenfield Organix',
  'GREENFIELD ORGANIX 4TH ST.': 'Greenfield Organix',

  // CALYX BRANDS
  'CALYX BRANDS': 'Calyx Brands',
  'CALYX': 'Calyx Brands',
  'CALYX BRANDS OAKLAND CA 94621-2102': 'Calyx Brands',
  'CALYX BRANDS CA 94621-2102': 'Calyx Brands',

  // ACCENTIAN
  'ACCENTIAN INC.': 'Accentian',
  'ACCENTIAN': 'Accentian',

  // ADIRA DISTRIBUTION
  'ADIRA DISTRIBUTION INC': 'Adira Distribution',
  'ADIRA DISTRIBUTION': 'Adira Distribution',
  'ADIRA DISTRIBUTION INC INC': 'Adira Distribution',

  // CYPRESS MANUFACTURING
  'CYPRESS MANUFACTURING CO': 'Cypress Manufacturing',
  'CYPRESS MANUFACTURING CO.': 'Cypress Manufacturing',

  // E&J DISTRIBUTORS
  'E&J DISTRIBUTORS, LLC': 'E&J Distributors',
  'E&J DISTRIBUTORS, LLC.': 'E&J Distributors',
  'E&J DISTRIBUTORS, LLC. LLC': 'E&J Distributors',

  // ELEVATION WELLNESS CENTER
  'ELEVATION WELLNESS CENTER, INC': 'Elevation Wellness Center',
  'ELEVATION WELLNESS CENTER INC.': 'Elevation Wellness Center',

  // FLUIDS MANUFACTURING
  'FLUIDS MANUFACTURING, INC.': 'Fluids Manufacturing',
  'FLUIDS MANUFACTURING, INC. INC': 'Fluids Manufacturing',

  // FOUR STAR DISTRIBUTION
  'FOUR STAR DISTRIBUTION AND DELIVERY, LLC': 'Four Star Distribution',
  'FOUR STAR DISTRIBUTION & DELIVERY': 'Four Star Distribution',
  'FOUR STAR DISTRIBUTION AND DELIVERY LLC': 'Four Star Distribution',

  // GB2
  'GB2, LLC': 'GB2',
  'GB2 LLC': 'GB2',

  // GOLDEN GATE GEN
  'GOLDEN GATE GEN INC': 'Golden Gate Gen',
  'GOLDEN GATE GEN INC CA 94124': 'Golden Gate Gen',
  'GOLDEN GATE GEN INC INC': 'Golden Gate Gen',

  // GRIZZLY PEAK FARMS
  'GRIZZLY PEAK FARMS, LLC': 'Grizzly Peak Farms',
  'GRIZZLY PEAK FARMS, LLC LLC': 'Grizzly Peak Farms',

  // HUMBOLDT GROWERS NETWORK
  'HUMBOLDT GROWERS NETWORK': 'Humboldt Growers Network',
  'HUMBOLDT GROWERS NETWORK INC INC': 'Humboldt Growers Network',
  'HUMBOLDT GROWERS NETWORK INC': 'Humboldt Growers Network',

  // YERBA BUENA
  'YERBA BUENA LOGISTICS SERVICES': 'Yerba Buena Logistics',
  'YERBA BUENA LOGISTICS SERVICES, LLC. LLC': 'Yerba Buena Logistics',

  // BARBARY COAST (internal transfers)
  'BARBARY COAST': 'Barbary Coast',
  'BARBARY COAST c10-0000127': 'Barbary Coast',
  'BARBARY COAST COLLECTIVE': 'Barbary Coast',

  // NORTHWEST CONFECTIONS
  'NORTHWEST CONFECTIONS CALIFORNIA, LLC': 'Northwest Confections',
  'NORTHWEST CONFECTIONS CALIFORNIA, LCC': 'Northwest Confections',

  // UPNORTH
  'UPNORTH DISTRIBUTION': 'UpNorth Distribution',
  'UPNORTH HUMBOLDT': 'UpNorth Distribution',
  'UPNORTH DISTRIBUTION c11-0000061-lic': 'UpNorth Distribution',
};

// Normalize vendor name to canonical form
function normalizeVendor(rawVendor: string): string {
  // Check direct mapping first
  if (VENDOR_NORMALIZATION[rawVendor]) {
    return VENDOR_NORMALIZATION[rawVendor];
  }

  // Try uppercase version
  const upper = rawVendor.toUpperCase();
  for (const [variant, canonical] of Object.entries(VENDOR_NORMALIZATION)) {
    if (variant.toUpperCase() === upper) {
      return canonical;
    }
  }

  // Return original if no mapping found
  return rawVendor;
}

// Load invoice headers from DynamoDB to get vendor info
async function loadInvoiceHeaders(): Promise<Map<string, InvoiceHeader>> {
  const client = getDynamoClient();
  const headers = new Map<string, InvoiceHeader>();
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  console.log('Starting DynamoDB invoice headers scan...');

  try {
    do {
      const command = new ScanCommand({
        TableName: INVOICE_HEADERS_TABLE,
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await client.send(command);

      if (response.Items) {
        for (const item of response.Items) {
          const invoiceId = String(item.invoice_id || item.InvoiceId || item.PK || '');
          headers.set(invoiceId, {
            invoice_id: invoiceId,
            vendor: String(item.vendor || item.Vendor || item.distributor || 'Unknown'),
            invoice_date: item.invoice_date || item.InvoiceDate || undefined,
            download_date: item.download_date || item.DownloadDate || undefined,
          });
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    // Log unique vendors found for debugging
    const uniqueVendors = new Set<string>();
    headers.forEach(h => uniqueVendors.add(h.vendor));
    console.log(`Invoice headers scan complete: ${headers.size} headers loaded`);
    console.log(`Unique vendors found: ${Array.from(uniqueVendors).join(', ')}`);
    return headers;
  } catch (error) {
    console.error('Error loading invoice headers from DynamoDB:', error);
    return headers;
  }
}

// Load invoice line items from DynamoDB and join with headers for vendor info
async function loadInvoiceData(): Promise<InvoiceLineItem[]> {
  const client = getDynamoClient();

  // First, load all invoice headers to get vendor info
  const headers = await loadInvoiceHeaders();

  const items: InvoiceLineItem[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let pageCount = 0;

  console.log('Starting DynamoDB invoice line items scan...');

  try {
    do {
      const command = new ScanCommand({
        TableName: INVOICE_LINE_ITEMS_TABLE,
        ExclusiveStartKey: lastEvaluatedKey,
        // No Limit - let DynamoDB return max items per request (1MB)
      });

      const response = await client.send(command);
      pageCount++;

      if (response.Items) {
        for (const item of response.Items) {
          const invoiceId = String(item.invoice_id || item.InvoiceId || item.PK || '');
          const header = headers.get(invoiceId);

          // Normalize vendor name to canonical form
          const rawVendor = header?.vendor || 'Unknown';
          const normalizedVendor = normalizeVendor(rawVendor);

          items.push({
            invoice_id: invoiceId,
            // Python stores as 'line_number', fallback to other variants
            line_item_id: String(item.line_number || item.line_item_id || item.LineItemId || item.SK || ''),
            vendor: normalizedVendor,  // Normalized vendor name from header
            brand: String(item.brand || item.Brand || 'Unknown'),  // Product brand from line item
            product_name: String(item.product_name || item.ProductName || item.product || ''),
            product_type: String(item.product_type || item.ProductType || item.category || ''),
            product_subtype: item.product_subtype || item.ProductSubtype || undefined,
            sku_units: parseSkuUnits(item.sku_units || item.SkuUnits || item.quantity || item.units || 0),
            unit_cost: parseNumber(item.unit_cost || item.UnitCost || item.cost || 0),
            total_cost: parseNumber(item.total_cost || item.TotalCost || item.total || 0),
            // Python stores as 'total_cost_with_excise', fallback to other variants
            total_with_excise: parseNumber(item.total_cost_with_excise || item.total_with_excise || item.TotalWithExcise || item.total_excise || 0),
            strain: item.strain || item.Strain || undefined,
            unit_size: item.unit_size || item.UnitSize || undefined,
            trace_id: item.trace_id || item.TraceId || item.metrc_id || undefined,
            is_promo: Boolean(item.is_promo || item.IsPromo || item.promo || false),
            invoice_date: header?.invoice_date,
          });
        }
        console.log(`DynamoDB page ${pageCount}: fetched ${response.Items.length} items, total: ${items.length}`);
      }

      lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    // Count items with unknown vendor for debugging
    const unknownVendorCount = items.filter(i => i.vendor === 'Unknown').length;
    const vendorCounts: Record<string, number> = {};
    items.forEach(i => {
      vendorCounts[i.vendor] = (vendorCounts[i.vendor] || 0) + 1;
    });
    console.log(`DynamoDB scan complete: ${items.length} total invoice line items with vendor info`);
    console.log(`Vendor distribution: ${JSON.stringify(vendorCounts)}`);
    if (unknownVendorCount > 0) {
      console.warn(`WARNING: ${unknownVendorCount} line items have Unknown vendor (${((unknownVendorCount / items.length) * 100).toFixed(1)}%)`);
    }
    return items;
  } catch (error) {
    console.error('Error loading invoice data from DynamoDB:', error);
    // Return partial results
    if (items.length > 0) {
      console.log(`Returning partial results: ${items.length} items`);
      return items;
    }
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    let responseData: { success: boolean; data: InvoiceLineItem[]; count: number; cached: boolean };

    // Check cache first
    if (invoiceCache && Date.now() - invoiceCache.timestamp < CACHE_TTL) {
      console.log(`Returning cached invoice data: ${invoiceCache.data.length} items`);
      responseData = {
        success: true,
        data: invoiceCache.data,
        count: invoiceCache.data.length,
        cached: true,
      };
    } else {
      // Load fresh data
      const data = await loadInvoiceData();

      // Update cache
      invoiceCache = {
        data,
        timestamp: Date.now(),
      };

      responseData = {
        success: true,
        data,
        count: data.length,
        cached: false,
      };
    }

    // Compress response if client supports gzip (helps with Lambda 6MB limit)
    if (supportsGzip) {
      const compressed = gzipSync(JSON.stringify(responseData));
      return new Response(compressed, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        },
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
