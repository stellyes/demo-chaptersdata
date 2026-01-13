// ============================================
// INVOICE DATA LOADING API ROUTE
// Loads invoice line items from DynamoDB separately
// to avoid blocking the main data load
// ============================================

import { NextResponse } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

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

const INVOICE_LINE_ITEMS_TABLE = 'retail-invoice-line-items';

// Cache for invoice data
interface InvoiceCacheEntry {
  data: InvoiceLineItem[];
  timestamp: number;
}

let invoiceCache: InvoiceCacheEntry | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

// Load invoice line items from DynamoDB (on-demand billing - no throttling)
async function loadInvoiceData(): Promise<InvoiceLineItem[]> {
  const client = getDynamoClient();
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
    } while (lastEvaluatedKey);

    console.log(`DynamoDB scan complete: ${items.length} total invoice line items`);
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

export async function GET() {
  try {
    // Check cache first
    if (invoiceCache && Date.now() - invoiceCache.timestamp < CACHE_TTL) {
      console.log(`Returning cached invoice data: ${invoiceCache.data.length} items`);
      return NextResponse.json({
        success: true,
        data: invoiceCache.data,
        count: invoiceCache.data.length,
        cached: true,
      });
    }

    // Load fresh data
    const data = await loadInvoiceData();

    // Update cache
    invoiceCache = {
      data,
      timestamp: Date.now(),
    };

    return NextResponse.json({
      success: true,
      data,
      count: data.length,
      cached: false,
    });
  } catch (error) {
    console.error('Invoice data loading error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load invoice data',
      },
      { status: 500 }
    );
  }
}
