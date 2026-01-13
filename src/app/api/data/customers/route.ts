// ============================================
// CUSTOMER DATA API ROUTE
// Loads customer data from S3 bucket (paginated)
// ============================================

import { NextRequest } from 'next/server';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { gzipSync } from 'zlib';

// S3 Client singleton
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.CHAPTERS_AWS_REGION || process.env.AWS_REGION || 'us-west-1',
      credentials: {
        accessKeyId: process.env.CHAPTERS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.CHAPTERS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3Client;
}

const BUCKET = process.env.CHAPTERS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'retail-data-bcgr';

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

// Cache
interface CacheEntry {
  data: CustomerRecord[];
  timestamp: number;
}

let customerCache: CacheEntry | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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

// Parse CSV
function parseCSV<T>(csvString: string): T[] {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[()%]/g, '').replace(/_+/g, '_').replace(/^"|"$/g, '')
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

function parseNumber(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = String(value).replace(/[$,%]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

async function downloadFromS3(key: string): Promise<string> {
  const client = getS3Client();
  const response = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return (await response.Body?.transformToString()) || '';
}

async function listS3Files(prefix: string): Promise<{ key: string }[]> {
  const client = getS3Client();
  const files: { key: string }[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken })
    );
    for (const obj of response.Contents || []) {
      if (obj.Key) files.push({ key: obj.Key });
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return files;
}

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

async function loadCustomerData(): Promise<CustomerRecord[]> {
  const files = await listS3Files('raw-uploads/');
  const customerFiles = files.filter((f) => f.key.includes('/customers_') && f.key.endsWith('.csv'));

  const allCustomers: CustomerRecord[] = [];

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

  // Deduplicate by customer ID
  const customerMap = new Map<string, CustomerRecord>();
  for (const record of allCustomers) {
    customerMap.set(record.customer_id, record);
  }

  return Array.from(customerMap.values());
}

export async function GET(request: NextRequest) {
  try {
    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    // Get pagination params
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '5000');
    const segment = url.searchParams.get('segment'); // Optional filter

    // Check cache
    if (!customerCache || Date.now() - customerCache.timestamp > CACHE_TTL) {
      const data = await loadCustomerData();
      customerCache = { data, timestamp: Date.now() };
    }

    let filteredData = customerCache.data;

    // Apply segment filter if provided
    if (segment) {
      filteredData = filteredData.filter(c => c.customer_segment === segment || c.recency_segment === segment);
    }

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
      cached: true,
    };

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
    console.error('Customer data loading error:', error);
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load customer data' },
      { status: 500 }
    );
  }
}
