// ============================================
// DATA LOADING API ROUTE
// Loads all data from S3 bucket
// ============================================

import { NextResponse } from 'next/server';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'crypto';

// S3 Client singleton
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-west-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3Client;
}

// DynamoDB Client singleton
let dynamoClient: DynamoDBDocumentClient | null = null;

function getDynamoClient(): DynamoDBDocumentClient {
  if (!dynamoClient) {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-west-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    dynamoClient = DynamoDBDocumentClient.from(client);
  }
  return dynamoClient;
}

const BUCKET = process.env.S3_BUCKET_NAME || 'retail-data-bcgr';
const INVOICE_LINE_ITEMS_TABLE = 'retail-invoice-line-items';

// In-memory cache for data
interface CacheEntry {
  data: AllDataResponse;
  hash: string;
  timestamp: number;
}

let dataCache: CacheEntry | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface SalesRecord {
  date: string;
  store: string;
  store_id: string;
  week: string;
  tickets_count: number;
  units_sold: number;
  customers_count: number;
  new_customers: number;
  gross_sales: number;
  discounts: number;
  returns: number;
  net_sales: number;
  taxes: number;
  gross_receipts: number;
  cogs_with_excise: number;
  gross_income: number;
  gross_margin_pct: number;
  discount_pct: number;
  cost_pct: number;
  avg_basket_size: number;
  avg_order_value: number;
  avg_order_profit: number;
}

interface BrandRecord {
  brand: string;
  pct_of_total_net_sales: number;
  gross_margin_pct: number;
  avg_cost_wo_excise: number;
  net_sales: number;
  store: string;
  store_id: string;
  upload_start_date?: string;
  upload_end_date?: string;
}

interface ProductRecord {
  product_type: string;
  pct_of_total_net_sales: number;
  gross_margin_pct: number;
  avg_cost_wo_excise: number;
  net_sales: number;
  store: string;
  store_id: string;
}

interface CustomerRecord {
  store_name: string;
  customer_id: string;
  name: string;
  date_of_birth?: string;
  age?: number;
  lifetime_visits: number;
  lifetime_transactions: number;
  lifetime_net_sales: number;
  lifetime_aov: number;
  signup_date: string;
  last_visit_date: string;
  customer_segment: string;
  recency_segment: string;
}

interface BudtenderRecord {
  store: string;
  store_id: string;
  employee_name: string;
  date: string;
  tickets_count: number;
  customers_count: number;
  net_sales: number;
  gross_margin_pct: number;
  avg_order_value: number;
  units_sold: number;
}

interface BrandMapping {
  brand: string;
  product_type: string;
  category?: string;
  vendor?: string;
}

interface InvoiceLineItem {
  invoice_id: string;
  line_item_id: string;
  product_name: string;
  product_type: string;
  sku_units: number;
  unit_cost: number;
  total_cost: number;
  total_with_excise: number;
  strain?: string;
  unit_size?: string;
  trace_id?: string;
  is_promo: boolean;
}

interface AllDataResponse {
  sales: SalesRecord[];
  brands: BrandRecord[];
  products: ProductRecord[];
  customers: CustomerRecord[];
  budtenders: BudtenderRecord[];
  mappings: BrandMapping[];
  invoices: InvoiceLineItem[];
  dataHash: string;
  loadedAt: string;
}

// Parse CSV to objects
function parseCSV<T>(csvString: string): T[] {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[()%]/g, '')
      .replace(/_+/g, '_')
      .replace(/^"|"$/g, '')
  );

  const results: T[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;

    const obj: Record<string, string | number> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[j].replace(/^"|"$/g, '').trim();
    }
    results.push(obj as T);
  }

  return results;
}

// Parse CSV line handling quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Parse number from string
function parseNumber(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = String(value).replace(/[$,%]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Store name to ID mapping
const STORE_NAME_TO_ID: Record<string, string> = {
  'Grass Roots': 'grass_roots',
  'Grass Roots SF': 'grass_roots',
  'grass_roots': 'grass_roots',
  'Barbary Coast': 'barbary_coast',
  'Barbary Coast SF': 'barbary_coast',
  'barbary_coast': 'barbary_coast',
};

// Download file from S3
async function downloadFromS3(key: string): Promise<string> {
  const client = getS3Client();
  const response = await client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  );
  return (await response.Body?.transformToString()) || '';
}

// List files from S3
async function listS3Files(prefix: string): Promise<{ key: string; etag: string }[]> {
  const client = getS3Client();
  const files: { key: string; etag: string }[] = [];

  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of response.Contents || []) {
      if (obj.Key && obj.ETag) {
        files.push({ key: obj.Key, etag: obj.ETag });
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return files;
}

// Compute data hash for cache invalidation
async function computeDataHash(): Promise<string> {
  try {
    const files = await listS3Files('raw-uploads/');
    const hashParts = files
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((f) => `${f.key}:${f.etag}`);

    return createHash('md5').update(hashParts.join('|')).digest('hex');
  } catch (error) {
    console.error('Error computing hash:', error);
    return Date.now().toString();
  }
}

// Extract store ID from S3 path
function extractStoreFromPath(path: string): string {
  const parts = path.split('/');
  if (parts.length >= 2) {
    return parts[1];
  }
  return 'combined';
}

// Extract date range from filename
function extractDateRangeFromPath(path: string): { start: string; end: string } | null {
  const filename = path.split('/').pop() || '';
  const match = filename.match(/(\d{8})-(\d{8})/);
  if (match) {
    const start = `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
    const end = `${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6, 8)}`;
    return { start, end };
  }
  return null;
}

// Clean sales data
function cleanSalesRecord(raw: Record<string, string>, storeId: string): SalesRecord | null {
  const storeName = raw.store || raw['Store'] || '';
  const resolvedStoreId = STORE_NAME_TO_ID[storeName] || storeId;

  const netSales = parseNumber(raw.net_sales || raw['Net Sales']);
  const customersCount = parseNumber(raw.customers_count || raw['Customers Count']);

  // Filter invalid records
  if (netSales <= 0 || customersCount < 5) return null;

  return {
    date: raw.date || raw['Date'] || '',
    store: storeName,
    store_id: resolvedStoreId,
    week: raw.week || raw['Week'] || '',
    tickets_count: parseNumber(raw.tickets_count || raw['Tickets Count']),
    units_sold: parseNumber(raw.units_sold || raw['Units Sold']),
    customers_count: customersCount,
    new_customers: parseNumber(raw.new_customers || raw['New Customers']),
    gross_sales: parseNumber(raw.gross_sales || raw['Gross Sales']),
    discounts: parseNumber(raw.discounts || raw['Discounts']),
    returns: parseNumber(raw.returns || raw['Returns']),
    net_sales: netSales,
    taxes: parseNumber(raw.taxes || raw['Taxes']),
    gross_receipts: parseNumber(raw.gross_receipts || raw['Gross Receipts']),
    cogs_with_excise: parseNumber(raw.cogs_with_excise || raw['COGS (with excise)']),
    gross_income: parseNumber(raw.gross_income || raw['Gross Income']),
    gross_margin_pct: parseNumber(raw.gross_margin_ || raw.gross_margin || raw['Gross Margin %']),
    discount_pct: parseNumber(raw.discount_ || raw.discount || raw['Discount %']),
    cost_pct: parseNumber(raw.cost_ || raw.cost || raw['Cost %']),
    avg_basket_size: parseNumber(raw.avg_basket_size || raw['Avg Basket Size']),
    avg_order_value: parseNumber(raw.avg_order_value || raw['Avg Order Value']),
    avg_order_profit: parseNumber(raw.avg_order_profit || raw['Avg Order Profit']),
  };
}

// Clean brand data
function cleanBrandRecord(
  raw: Record<string, string>,
  storeId: string,
  dateRange?: { start: string; end: string }
): BrandRecord | null {
  const brand = raw.brand || raw['Brand'] || raw.product_brand || raw['Product Brand'] || '';
  const netSales = parseNumber(raw.net_sales || raw['Net Sales']);

  // Filter samples and zero sales
  if (brand.includes('[DS]') || brand.includes('[SS]') || netSales <= 0) return null;

  return {
    brand,
    pct_of_total_net_sales: parseNumber(raw._of_total_net_sales || raw.of_total_net_sales || raw['% of Total Net Sales']),
    gross_margin_pct: parseNumber(raw.gross_margin_ || raw.gross_margin || raw['Gross Margin %']),
    avg_cost_wo_excise: parseNumber(raw.avg_cost_wo_excise || raw['Avg Cost (w/o excise)']),
    net_sales: netSales,
    store: raw.store || raw['Store'] || '',
    store_id: storeId,
    upload_start_date: dateRange?.start,
    upload_end_date: dateRange?.end,
  };
}

// Clean product data
function cleanProductRecord(raw: Record<string, string>, storeId: string): ProductRecord | null {
  const netSales = parseNumber(raw.net_sales || raw['Net Sales']);
  if (netSales <= 0) return null;

  return {
    product_type: raw.product_type || raw['Product Type'] || '',
    pct_of_total_net_sales: parseNumber(raw._of_total_net_sales || raw.of_total_net_sales || raw['% of Total Net Sales']),
    gross_margin_pct: parseNumber(raw.gross_margin_ || raw.gross_margin || raw['Gross Margin %']),
    avg_cost_wo_excise: parseNumber(raw.avg_cost_wo_excise || raw['Avg Cost (w/o excise)']),
    net_sales: netSales,
    store: raw.store || raw['Store'] || '',
    store_id: storeId,
  };
}

// Customer segment thresholds
const CUSTOMER_SEGMENTS: Record<string, { min: number; max: number }> = {
  'New/Low': { min: 0, max: 100 },
  Regular: { min: 100, max: 500 },
  Good: { min: 500, max: 1500 },
  VIP: { min: 1500, max: 5000 },
  Whale: { min: 5000, max: Infinity },
};

const RECENCY_SEGMENTS: Record<string, { min: number; max: number }> = {
  Active: { min: 0, max: 14 },
  Warm: { min: 14, max: 30 },
  Cool: { min: 30, max: 60 },
  Cold: { min: 60, max: 120 },
  Lost: { min: 120, max: Infinity },
};

function getCustomerSegment(lifetimeValue: number): string {
  for (const [segment, range] of Object.entries(CUSTOMER_SEGMENTS)) {
    if (lifetimeValue >= range.min && lifetimeValue < range.max) {
      return segment;
    }
  }
  return 'New/Low';
}

function getRecencySegment(daysSinceVisit: number): string {
  for (const [segment, range] of Object.entries(RECENCY_SEGMENTS)) {
    if (daysSinceVisit >= range.min && daysSinceVisit < range.max) {
      return segment;
    }
  }
  return 'Lost';
}

// Clean customer data
function cleanCustomerRecord(raw: Record<string, string>): CustomerRecord | null {
  const customerId = raw.customer_id || raw['Customer ID'] || '';
  if (!customerId) return null;

  const lifetimeNetSales = parseNumber(raw.lifetime_net_sales || raw['Lifetime Net Sales']);
  const lastVisitDate = raw.last_visit_date || raw['Last Visit Date'] || '';

  let daysSinceVisit = 365;
  if (lastVisitDate) {
    const lastVisit = new Date(lastVisitDate);
    const today = new Date();
    daysSinceVisit = Math.floor((today.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24));
  }

  return {
    store_name: raw.store_name || raw['Store Name'] || '',
    customer_id: customerId,
    name: raw.name || raw['Name'] || '',
    date_of_birth: raw.date_of_birth || raw['Date of Birth'],
    age: raw.age ? parseInt(raw.age) : undefined,
    lifetime_visits: parseNumber(raw.lifetime_visits || raw['Lifetime In-Store Visits']),
    lifetime_transactions: parseNumber(raw.lifetime_transactions || raw['Lifetime Transactions']),
    lifetime_net_sales: lifetimeNetSales,
    lifetime_aov: parseNumber(raw.lifetime_aov || raw['Lifetime Avg Order Value']),
    signup_date: raw.signup_date || raw['Sign-Up Date'] || '',
    last_visit_date: lastVisitDate,
    customer_segment: getCustomerSegment(lifetimeNetSales),
    recency_segment: getRecencySegment(daysSinceVisit),
  };
}

// Clean budtender data
function cleanBudtenderRecord(raw: Record<string, string>): BudtenderRecord | null {
  const employeeName = raw.employee_name || raw['Employee Name'] || raw.employee || raw['Employee'] || '';
  if (!employeeName) return null;

  const storeName = raw.store || raw['Store'] || '';
  const storeId = STORE_NAME_TO_ID[storeName] || 'grass_roots';

  return {
    store: storeName,
    store_id: storeId,
    employee_name: employeeName,
    date: raw.date || raw['Date'] || '',
    tickets_count: parseNumber(raw.tickets_count || raw['Tickets Count'] || raw.tickets || raw['Tickets']),
    customers_count: parseNumber(raw.customers_count || raw['Customers Count'] || raw.customers || raw['Customers']),
    net_sales: parseNumber(raw.net_sales || raw['Net Sales']),
    gross_margin_pct: parseNumber(raw.gross_margin_ || raw.gross_margin || raw['Gross Margin %']),
    avg_order_value: parseNumber(raw.avg_order_value || raw['Avg Order Value'] || raw.aov || raw['AOV']),
    units_sold: parseNumber(raw.units_sold || raw['Units Sold'] || raw.units || raw['Units']),
  };
}

// Load brand mappings from JSON
async function loadBrandMappings(): Promise<BrandMapping[]> {
  try {
    const jsonData = await downloadFromS3('config/brand_product_mapping.json');
    const data = JSON.parse(jsonData);

    // Handle different possible JSON structures
    if (Array.isArray(data)) {
      return data;
    } else if (data.mappings && Array.isArray(data.mappings)) {
      return data.mappings;
    } else if (typeof data === 'object') {
      // If it's a key-value object, convert to array
      return Object.entries(data).map(([brand, info]) => ({
        brand,
        product_type: typeof info === 'string' ? info : (info as Record<string, string>).product_type || '',
        category: typeof info === 'object' ? (info as Record<string, string>).category : undefined,
        vendor: typeof info === 'object' ? (info as Record<string, string>).vendor : undefined,
      }));
    }
    return [];
  } catch (error) {
    console.error('Error loading brand mappings:', error);
    return [];
  }
}

// Helper to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Load invoice line items from DynamoDB with pagination and retry logic
async function loadInvoiceData(): Promise<InvoiceLineItem[]> {
  const client = getDynamoClient();
  const items: InvoiceLineItem[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let pageCount = 0;
  const maxRetries = 8;
  const baseDelay = 1000; // 1 second delay between pages to avoid throttling

  console.log('Starting DynamoDB invoice line items scan...');

  try {
    do {
      let retries = 0;
      let success = false;

      while (!success && retries < maxRetries) {
        try {
          const command = new ScanCommand({
            TableName: INVOICE_LINE_ITEMS_TABLE,
            ExclusiveStartKey: lastEvaluatedKey,
            Limit: 250, // Small batch size to avoid throttling
          });

          const response = await client.send(command);
          pageCount++;

          if (response.Items) {
            for (const item of response.Items) {
              items.push({
                invoice_id: String(item.invoice_id || item.InvoiceId || item.PK || ''),
                line_item_id: String(item.line_item_id || item.LineItemId || item.SK || ''),
                product_name: String(item.product_name || item.ProductName || item.product || ''),
                product_type: String(item.product_type || item.ProductType || item.category || ''),
                sku_units: parseNumber(item.sku_units || item.SkuUnits || item.quantity || item.units || 0),
                unit_cost: parseNumber(item.unit_cost || item.UnitCost || item.cost || 0),
                total_cost: parseNumber(item.total_cost || item.TotalCost || item.total || 0),
                total_with_excise: parseNumber(item.total_with_excise || item.TotalWithExcise || item.total_excise || 0),
                strain: item.strain || item.Strain || undefined,
                unit_size: item.unit_size || item.UnitSize || undefined,
                trace_id: item.trace_id || item.TraceId || item.metrc_id || undefined,
                is_promo: Boolean(item.is_promo || item.IsPromo || item.promo || false),
              });
            }
            console.log(`DynamoDB page ${pageCount}: fetched ${response.Items.length} items, total: ${items.length}`);
          }

          lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
          success = true;

          // Add delay between requests to avoid throttling
          if (lastEvaluatedKey) {
            await delay(baseDelay);
          }
        } catch (error) {
          const isThrottling = error instanceof Error &&
            (error.name === 'ProvisionedThroughputExceededException' ||
             error.message.includes('throughput'));

          if (isThrottling && retries < maxRetries - 1) {
            retries++;
            const backoffDelay = baseDelay * Math.pow(2, retries); // Exponential backoff
            console.log(`DynamoDB throttled, retry ${retries}/${maxRetries} after ${backoffDelay}ms...`);
            await delay(backoffDelay);
          } else {
            throw error;
          }
        }
      }
    } while (lastEvaluatedKey);

    console.log(`DynamoDB scan complete: ${items.length} total invoice line items`);
    return items;
  } catch (error) {
    console.error('Error loading invoice data from DynamoDB:', error);
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
    }
    // Return partial results if we have any
    if (items.length > 0) {
      console.log(`Returning partial results: ${items.length} items`);
      return items;
    }
    return [];
  }
}

// Load all data from S3
async function loadAllDataFromS3(): Promise<AllDataResponse> {
  const files = await listS3Files('raw-uploads/');

  const salesFiles = files.filter((f) => f.key.includes('/sales_') && f.key.endsWith('.csv'));
  const brandFiles = files.filter((f) => f.key.includes('/brand_') && f.key.endsWith('.csv'));
  const productFiles = files.filter((f) => f.key.includes('/product_') && f.key.endsWith('.csv'));
  const customerFiles = files.filter((f) => f.key.includes('/customers_') && f.key.endsWith('.csv'));

  const allSales: SalesRecord[] = [];
  const allBrands: BrandRecord[] = [];
  const allProducts: ProductRecord[] = [];
  const allCustomers: CustomerRecord[] = [];
  const allBudtenders: BudtenderRecord[] = [];

  // Load sales data
  for (const file of salesFiles) {
    try {
      const csvData = await downloadFromS3(file.key);
      const rawRecords = parseCSV<Record<string, string>>(csvData);
      const storeId = extractStoreFromPath(file.key);

      for (const raw of rawRecords) {
        const cleaned = cleanSalesRecord(raw, storeId);
        if (cleaned) allSales.push(cleaned);
      }
    } catch (error) {
      console.error(`Error loading ${file.key}:`, error);
    }
  }

  // Load brand data
  for (const file of brandFiles) {
    try {
      const csvData = await downloadFromS3(file.key);
      const rawRecords = parseCSV<Record<string, string>>(csvData);
      const storeId = extractStoreFromPath(file.key);
      const dateRange = extractDateRangeFromPath(file.key);

      for (const raw of rawRecords) {
        const cleaned = cleanBrandRecord(raw, storeId, dateRange || undefined);
        if (cleaned) allBrands.push(cleaned);
      }
    } catch (error) {
      console.error(`Error loading ${file.key}:`, error);
    }
  }

  // Load product data
  for (const file of productFiles) {
    try {
      const csvData = await downloadFromS3(file.key);
      const rawRecords = parseCSV<Record<string, string>>(csvData);
      const storeId = extractStoreFromPath(file.key);

      for (const raw of rawRecords) {
        const cleaned = cleanProductRecord(raw, storeId);
        if (cleaned) allProducts.push(cleaned);
      }
    } catch (error) {
      console.error(`Error loading ${file.key}:`, error);
    }
  }

  // Load customer data
  for (const file of customerFiles) {
    try {
      const csvData = await downloadFromS3(file.key);
      const rawRecords = parseCSV<Record<string, string>>(csvData);

      for (const raw of rawRecords) {
        const cleaned = cleanCustomerRecord(raw);
        if (cleaned) allCustomers.push(cleaned);
      }
    } catch (error) {
      console.error(`Error loading ${file.key}:`, error);
    }
  }

  // Load budtender performance data from data/ folder
  try {
    const csvData = await downloadFromS3('data/budtender_performance.csv');
    const rawRecords = parseCSV<Record<string, string>>(csvData);

    for (const raw of rawRecords) {
      const cleaned = cleanBudtenderRecord(raw);
      if (cleaned) allBudtenders.push(cleaned);
    }
  } catch (error) {
    console.error('Error loading budtender data:', error);
  }

  // Load brand mappings
  const allMappings = await loadBrandMappings();

  // NOTE: Invoice data is loaded separately via /api/data/invoices endpoint
  // to avoid blocking the main data load (DynamoDB scan is slow due to throttling)
  const allInvoices: InvoiceLineItem[] = [];

  // Sort and deduplicate
  allSales.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  allBrands.sort((a, b) => b.net_sales - a.net_sales);
  allProducts.sort((a, b) => b.net_sales - a.net_sales);
  allBudtenders.sort((a, b) => b.net_sales - a.net_sales);

  // Deduplicate sales by store+date
  const salesMap = new Map<string, SalesRecord>();
  for (const record of allSales) {
    const key = `${record.store_id}_${record.date}`;
    salesMap.set(key, record);
  }

  // Deduplicate customers by ID
  const customerMap = new Map<string, CustomerRecord>();
  for (const record of allCustomers) {
    customerMap.set(record.customer_id, record);
  }

  const dataHash = await computeDataHash();

  return {
    sales: Array.from(salesMap.values()),
    brands: allBrands,
    products: allProducts,
    customers: Array.from(customerMap.values()),
    budtenders: allBudtenders,
    mappings: allMappings,
    invoices: allInvoices,
    dataHash,
    loadedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    // Check cache
    const currentHash = await computeDataHash();

    if (
      dataCache &&
      dataCache.hash === currentHash &&
      Date.now() - dataCache.timestamp < CACHE_TTL
    ) {
      return NextResponse.json({
        success: true,
        data: dataCache.data,
        cached: true,
      });
    }

    // Load fresh data
    const data = await loadAllDataFromS3();

    // Update cache
    dataCache = {
      data,
      hash: currentHash,
      timestamp: Date.now(),
    };

    return NextResponse.json({
      success: true,
      data,
      cached: false,
    });
  } catch (error) {
    console.error('Data loading error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load data',
      },
      { status: 500 }
    );
  }
}
