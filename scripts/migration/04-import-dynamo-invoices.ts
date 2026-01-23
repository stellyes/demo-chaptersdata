/**
 * DynamoDB to Aurora PostgreSQL Invoice Migration Script
 *
 * Imports all invoice data from DynamoDB into Aurora PostgreSQL:
 * - Invoices (retail-invoices table)
 * - Invoice line items (retail-invoice-line-items table)
 *
 * Run with: npx tsx scripts/migration/04-import-dynamo-invoices.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  DynamoDBClient,
  ScanCommand,
  ScanCommandOutput,
} from '@aws-sdk/client-dynamodb';

const prisma = new PrismaClient();

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-west-1',
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});

const INVOICES_TABLE = 'retail-invoices';
const LINE_ITEMS_TABLE = 'retail-invoice-line-items';

interface MigrationStats {
  invoices: number;
  lineItems: number;
  errors: string[];
}

// Helper to get string from DynamoDB attribute
function getString(attr: { S?: string } | undefined): string | null {
  return attr?.S || null;
}

// Helper to get number from DynamoDB attribute
function getNumber(attr: { N?: string } | undefined): number {
  return attr?.N ? parseFloat(attr.N) : 0;
}

// Helper to get boolean from DynamoDB attribute
function getBool(attr: { BOOL?: boolean } | undefined): boolean {
  return attr?.BOOL || false;
}

// Helper to parse date string
function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

async function* scanTable(tableName: string): AsyncGenerator<Record<string, any>[]> {
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const command = new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastEvaluatedKey,
    });

    const response: ScanCommandOutput = await dynamodb.send(command);
    lastEvaluatedKey = response.LastEvaluatedKey;

    if (response.Items && response.Items.length > 0) {
      yield response.Items;
    }
  } while (lastEvaluatedKey);
}

async function importInvoices(stats: MigrationStats): Promise<Map<string, string>> {
  console.log('\n📄 Importing invoices from DynamoDB...');

  // Map of DynamoDB invoice_id -> Aurora UUID
  const invoiceIdMap = new Map<string, string>();
  let batchCount = 0;

  for await (const items of scanTable(INVOICES_TABLE)) {
    batchCount++;
    process.stdout.write(`\r   Processing batch ${batchCount}... (${stats.invoices} invoices)`);

    for (const item of items) {
      const invoiceId = getString(item.invoice_id);
      if (!invoiceId) continue;

      try {
        const invoice = await prisma.invoice.upsert({
          where: { invoiceId },
          create: {
            invoiceId,
            invoiceNumber: getString(item.invoice_number),
            invoiceDate: parseDate(getString(item.invoice_date)),
            downloadDate: parseDate(getString(item.download_date)),
            originalVendorName: getString(item.vendor),
            customerName: getString(item.customer_name),
            subtotal: new Prisma.Decimal(getNumber(item.subtotal)),
            discount: new Prisma.Decimal(getNumber(item.discount)),
            fees: new Prisma.Decimal(getNumber(item.fees)),
            tax: new Prisma.Decimal(getNumber(item.tax)),
            totalCost: new Prisma.Decimal(getNumber(item.total)),
            totalWithExcise: new Prisma.Decimal(getNumber(item.total)),
            balance: new Prisma.Decimal(getNumber(item.balance)),
            lineItemsCount: Math.round(getNumber(item.line_item_count)),
            status: getString(item.status),
            paymentTerms: getString(item.payment_terms),
            createdBy: getString(item.created_by),
            sourceFile: getString(item.source_file),
            extractedAt: parseDate(getString(item.extracted_at)),
          },
          update: {
            invoiceNumber: getString(item.invoice_number),
            invoiceDate: parseDate(getString(item.invoice_date)),
            downloadDate: parseDate(getString(item.download_date)),
            originalVendorName: getString(item.vendor),
            customerName: getString(item.customer_name),
            subtotal: new Prisma.Decimal(getNumber(item.subtotal)),
            discount: new Prisma.Decimal(getNumber(item.discount)),
            fees: new Prisma.Decimal(getNumber(item.fees)),
            tax: new Prisma.Decimal(getNumber(item.tax)),
            totalCost: new Prisma.Decimal(getNumber(item.total)),
            totalWithExcise: new Prisma.Decimal(getNumber(item.total)),
            balance: new Prisma.Decimal(getNumber(item.balance)),
            lineItemsCount: Math.round(getNumber(item.line_item_count)),
            status: getString(item.status),
            paymentTerms: getString(item.payment_terms),
            createdBy: getString(item.created_by),
            sourceFile: getString(item.source_file),
            extractedAt: parseDate(getString(item.extracted_at)),
          },
        });

        invoiceIdMap.set(invoiceId, invoice.id);
        stats.invoices++;
      } catch (err) {
        stats.errors.push(
          `Invoice ${invoiceId}: ${err instanceof Error ? err.message : 'Unknown'}`
        );
      }
    }
  }

  console.log(`\n   Done! (${stats.invoices} invoices)`);
  return invoiceIdMap;
}

async function importLineItems(
  invoiceIdMap: Map<string, string>,
  stats: MigrationStats
): Promise<void> {
  console.log('\n📦 Importing invoice line items from DynamoDB...');

  let batchCount = 0;

  for await (const items of scanTable(LINE_ITEMS_TABLE)) {
    batchCount++;
    process.stdout.write(`\r   Processing batch ${batchCount}... (${stats.lineItems} line items)`);

    for (const item of items) {
      const dynamoInvoiceId = getString(item.invoice_id);
      const lineNumber = Math.round(getNumber(item.line_number));

      if (!dynamoInvoiceId) continue;

      // Get the Aurora UUID for this invoice
      const auroraInvoiceId = invoiceIdMap.get(dynamoInvoiceId);
      if (!auroraInvoiceId) {
        stats.errors.push(`Line item for invoice ${dynamoInvoiceId}: Invoice not found`);
        continue;
      }

      try {
        await prisma.invoiceLineItem.upsert({
          where: {
            invoiceId_lineNumber: {
              invoiceId: auroraInvoiceId,
              lineNumber,
            },
          },
          create: {
            invoiceId: auroraInvoiceId,
            lineNumber,
            originalBrandName: getString(item.brand) || 'UNKNOWN',
            productName: getString(item.product_name),
            productType: getString(item.product_type),
            productSubtype: getString(item.product_subtype),
            skuUnits: Math.round(getNumber(item.sku_units)),
            unitCost: new Prisma.Decimal(getNumber(item.unit_cost)),
            excisePerUnit: new Prisma.Decimal(getNumber(item.excise_per_unit)),
            totalCost: new Prisma.Decimal(getNumber(item.total_cost)),
            totalCostWithExcise: new Prisma.Decimal(getNumber(item.total_cost_with_excise)),
            strain: getString(item.strain),
            unitSize: getString(item.unit_size),
            traceId: getString(item.trace_id),
            isPromo: getBool(item.is_promo),
          },
          update: {
            originalBrandName: getString(item.brand) || 'UNKNOWN',
            productName: getString(item.product_name),
            productType: getString(item.product_type),
            productSubtype: getString(item.product_subtype),
            skuUnits: Math.round(getNumber(item.sku_units)),
            unitCost: new Prisma.Decimal(getNumber(item.unit_cost)),
            excisePerUnit: new Prisma.Decimal(getNumber(item.excise_per_unit)),
            totalCost: new Prisma.Decimal(getNumber(item.total_cost)),
            totalCostWithExcise: new Prisma.Decimal(getNumber(item.total_cost_with_excise)),
            strain: getString(item.strain),
            unitSize: getString(item.unit_size),
            traceId: getString(item.trace_id),
            isPromo: getBool(item.is_promo),
          },
        });
        stats.lineItems++;
      } catch (err) {
        stats.errors.push(
          `Line item ${dynamoInvoiceId}#${lineNumber}: ${err instanceof Error ? err.message : 'Unknown'}`
        );
      }
    }
  }

  console.log(`\n   Done! (${stats.lineItems} line items)`);
}

async function main() {
  console.log('========================================');
  console.log('DynamoDB to Aurora Invoice Migration');
  console.log('========================================\n');

  const stats: MigrationStats = {
    invoices: 0,
    lineItems: 0,
    errors: [],
  };

  try {
    // Import invoices first (returns mapping of IDs)
    const invoiceIdMap = await importInvoices(stats);

    // Import line items using the ID mapping
    await importLineItems(invoiceIdMap, stats);

    console.log('\n========================================');
    console.log('Migration Complete!');
    console.log('========================================');
    console.log(`\n📈 Summary:`);
    console.log(`   Invoices:    ${stats.invoices}`);
    console.log(`   Line items:  ${stats.lineItems}`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors (${stats.errors.length}):`);
      stats.errors.slice(0, 10).forEach((err) => console.log(`   - ${err}`));
      if (stats.errors.length > 10) {
        console.log(`   ... and ${stats.errors.length - 10} more`);
      }
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
