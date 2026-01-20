// ============================================
// AWS DYNAMODB CLIENT & OPERATIONS
// ============================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { AWS_CONFIG, DYNAMODB_TABLES } from '@/lib/config';
import { InvoiceRecord, InvoiceLineItem, QRCode, QRClick } from '@/types';

// Initialize DynamoDB client (server-side only)
let dynamoClient: DynamoDBDocumentClient | null = null;

export function getDynamoClient(): DynamoDBDocumentClient {
  if (!dynamoClient) {
    const client = new DynamoDBClient({
      region: AWS_CONFIG.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    dynamoClient = DynamoDBDocumentClient.from(client);
  }
  return dynamoClient;
}

// ============================================
// INVOICE OPERATIONS
// ============================================

export async function saveInvoice(invoice: InvoiceRecord): Promise<void> {
  const client = getDynamoClient();

  await client.send(
    new PutCommand({
      TableName: DYNAMODB_TABLES.invoices,
      Item: invoice,
    })
  );
}

export async function saveInvoiceLineItems(items: InvoiceLineItem[]): Promise<void> {
  const client = getDynamoClient();

  for (const item of items) {
    await client.send(
      new PutCommand({
        TableName: DYNAMODB_TABLES.lineItems,
        Item: item,
      })
    );
  }
}

export async function getInvoice(invoiceId: string): Promise<InvoiceRecord | null> {
  const client = getDynamoClient();

  const response = await client.send(
    new GetCommand({
      TableName: DYNAMODB_TABLES.invoices,
      Key: { invoice_id: invoiceId },
    })
  );

  return response.Item as InvoiceRecord | null;
}

export async function getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]> {
  const client = getDynamoClient();

  const response = await client.send(
    new QueryCommand({
      TableName: DYNAMODB_TABLES.lineItems,
      KeyConditionExpression: 'invoice_id = :invoiceId',
      ExpressionAttributeValues: {
        ':invoiceId': invoiceId,
      },
    })
  );

  return (response.Items || []) as InvoiceLineItem[];
}

export async function getAllInvoices(
  startDate?: string,
  endDate?: string
): Promise<InvoiceRecord[]> {
  const client = getDynamoClient();

  const params: {
    TableName: string;
    FilterExpression?: string;
    ExpressionAttributeValues?: Record<string, string>;
  } = {
    TableName: DYNAMODB_TABLES.invoices,
  };

  if (startDate && endDate) {
    params.FilterExpression = 'invoice_date BETWEEN :start AND :end';
    params.ExpressionAttributeValues = {
      ':start': startDate,
      ':end': endDate,
    };
  }

  const response = await client.send(new ScanCommand(params));
  return (response.Items || []) as InvoiceRecord[];
}

export async function getInvoiceSummary(
  startDate?: string,
  endDate?: string
): Promise<{
  totalInvoices: number;
  totalLineItems: number;
  totalCost: number;
  vendorBreakdown: Record<string, { count: number; total: number }>;
}> {
  const invoices = await getAllInvoices(startDate, endDate);

  const vendorBreakdown: Record<string, { count: number; total: number }> = {};
  let totalCost = 0;
  let totalLineItems = 0;

  for (const invoice of invoices) {
    totalCost += invoice.total_cost || 0;
    totalLineItems += invoice.line_items_count || 0;

    const vendor = invoice.vendor || 'Unknown';
    if (!vendorBreakdown[vendor]) {
      vendorBreakdown[vendor] = { count: 0, total: 0 };
    }
    vendorBreakdown[vendor].count++;
    vendorBreakdown[vendor].total += invoice.total_cost || 0;
  }

  return {
    totalInvoices: invoices.length,
    totalLineItems,
    totalCost,
    vendorBreakdown,
  };
}

export async function getInvoicesNeedingReview(): Promise<InvoiceRecord[]> {
  const client = getDynamoClient();

  const response = await client.send(
    new ScanCommand({
      TableName: DYNAMODB_TABLES.invoices,
      FilterExpression: 'attribute_not_exists(invoice_date) OR invoice_date = :empty',
      ExpressionAttributeValues: {
        ':empty': '',
      },
    })
  );

  return (response.Items || []) as InvoiceRecord[];
}

export async function updateInvoiceDate(
  invoiceId: string,
  invoiceDate: string
): Promise<void> {
  const client = getDynamoClient();

  await client.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLES.invoices,
      Key: { invoice_id: invoiceId },
      UpdateExpression: 'SET invoice_date = :date',
      ExpressionAttributeValues: {
        ':date': invoiceDate,
      },
    })
  );
}

// ============================================
// QR CODE OPERATIONS
// ============================================

export async function saveQRCode(qrCode: QRCode): Promise<void> {
  const client = getDynamoClient();

  await client.send(
    new PutCommand({
      TableName: DYNAMODB_TABLES.qrCodes,
      Item: qrCode,
    })
  );
}

export async function getQRCode(shortCode: string): Promise<QRCode | null> {
  const client = getDynamoClient();

  const response = await client.send(
    new GetCommand({
      TableName: DYNAMODB_TABLES.qrCodes,
      Key: { short_code: shortCode },
    })
  );

  return response.Item as QRCode | null;
}

export async function getAllQRCodes(includeDeleted: boolean = false): Promise<QRCode[]> {
  const client = getDynamoClient();

  const params: {
    TableName: string;
    FilterExpression?: string;
    ExpressionAttributeValues?: Record<string, boolean>;
  } = {
    TableName: DYNAMODB_TABLES.qrCodes,
  };

  if (!includeDeleted) {
    params.FilterExpression = 'deleted = :deleted';
    params.ExpressionAttributeValues = {
      ':deleted': false,
    };
  }

  const response = await client.send(new ScanCommand(params));
  return (response.Items || []) as QRCode[];
}

export async function updateQRCodeClicks(shortCode: string): Promise<void> {
  const client = getDynamoClient();

  await client.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLES.qrCodes,
      Key: { short_code: shortCode },
      UpdateExpression: 'SET total_clicks = total_clicks + :inc',
      ExpressionAttributeValues: {
        ':inc': 1,
      },
    })
  );
}

export async function deleteQRCode(shortCode: string): Promise<void> {
  const client = getDynamoClient();

  await client.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLES.qrCodes,
      Key: { short_code: shortCode },
      UpdateExpression: 'SET deleted = :deleted',
      ExpressionAttributeValues: {
        ':deleted': true,
      },
    })
  );
}

export async function restoreQRCode(shortCode: string): Promise<void> {
  const client = getDynamoClient();

  await client.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLES.qrCodes,
      Key: { short_code: shortCode },
      UpdateExpression: 'SET deleted = :deleted',
      ExpressionAttributeValues: {
        ':deleted': false,
      },
    })
  );
}

export async function saveQRClick(click: QRClick): Promise<void> {
  const client = getDynamoClient();

  await client.send(
    new PutCommand({
      TableName: DYNAMODB_TABLES.qrClicks,
      Item: click,
    })
  );
}

export async function getQRClicks(
  shortCode: string,
  startDate?: string,
  endDate?: string
): Promise<QRClick[]> {
  const client = getDynamoClient();

  const params: {
    TableName: string;
    FilterExpression?: string;
    ExpressionAttributeValues: Record<string, string>;
  } = {
    TableName: DYNAMODB_TABLES.qrClicks,
    ExpressionAttributeValues: {
      ':shortCode': shortCode,
    },
  };

  if (startDate && endDate) {
    params.FilterExpression =
      'short_code = :shortCode AND #ts BETWEEN :start AND :end';
    params.ExpressionAttributeValues[':start'] = startDate;
    params.ExpressionAttributeValues[':end'] = endDate;
  } else {
    params.FilterExpression = 'short_code = :shortCode';
  }

  const response = await client.send(
    new ScanCommand({
      ...params,
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
    })
  );

  return (response.Items || []) as QRClick[];
}

export async function getQRAnalytics(shortCode: string): Promise<{
  totalClicks: number;
  uniqueVisitors: number;
  clicksByDay: Record<string, number>;
}> {
  const clicks = await getQRClicks(shortCode);

  const uniqueIPs = new Set(clicks.map(c => c.ip_address));
  const clicksByDay: Record<string, number> = {};

  for (const click of clicks) {
    const day = click.timestamp.split('T')[0];
    clicksByDay[day] = (clicksByDay[day] || 0) + 1;
  }

  return {
    totalClicks: clicks.length,
    uniqueVisitors: uniqueIPs.size,
    clicksByDay,
  };
}
