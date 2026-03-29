// ============================================
// SALES DATA API ROUTE
// Loads sales data from Aurora PostgreSQL
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseCSV, cleanSalesData } from '@/lib/services/data-processor';
import { StoreId, SalesRecord } from '@/types';
import { getActiveStorefrontIds } from '@/lib/utils/org-scope';

// Helper to normalize margin percentage
// If value is <= 1 and >= -1, it's stored as a decimal (e.g., 0.55 for 55%) and needs to be multiplied by 100
// If value is > 1 or < -1, it's already a percentage (e.g., 55 for 55%)
function normalizeMarginPct(value: number): number {
  if (value <= 1 && value >= -1) {
    return value * 100;
  }
  return value;
}

// GET - Load all sales data from Aurora
export async function GET() {
  try {
    const storefrontIds = await getActiveStorefrontIds();
    const salesRecords = await prisma.salesRecord.findMany({
      where: { storeId: { in: storefrontIds } },
      orderBy: { date: 'asc' },
    });

    // Transform to frontend format
    const records: SalesRecord[] = salesRecords.map((r) => ({
      date: r.date.toISOString().split('T')[0],
      store: r.storeName || r.storeId,
      store_id: r.storeId as StoreId,
      week: r.week || '',
      tickets_count: r.ticketsCount,
      units_sold: r.unitsSold,
      customers_count: r.customersCount,
      new_customers: r.newCustomers,
      gross_sales: Number(r.grossSales),
      discounts: Number(r.discounts),
      returns: Number(r.returns),
      net_sales: Number(r.netSales),
      taxes: Number(r.taxes),
      gross_receipts: Number(r.grossReceipts),
      cogs_with_excise: Number(r.cogsWithExcise),
      gross_income: Number(r.grossIncome),
      gross_margin_pct: normalizeMarginPct(Number(r.grossMarginPct)),
      discount_pct: normalizeMarginPct(Number(r.discountPct)),
      cost_pct: normalizeMarginPct(Number(r.costPct)),
      avg_basket_size: Number(r.avgBasketSize),
      avg_order_value: Number(r.avgOrderValue),
      avg_order_profit: Number(r.avgOrderProfit),
    }));

    return NextResponse.json({
      success: true,
      data: records,
      source: 'aurora',
    });
  } catch (error) {
    console.error('Error loading sales data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load sales data' },
      { status: 500 }
    );
  }
}

// POST - Upload new sales data to Aurora
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const storeId = formData.get('store') as StoreId;
    const startDate = formData.get('startDate') as string;
    const endDate = formData.get('endDate') as string;

    if (!file || !storeId || !startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const csvContent = await file.text();

    // Validate CSV
    const rawData = parseCSV<Record<string, string>>(csvContent);
    if (rawData.length === 0) {
      return NextResponse.json(
        { success: false, error: 'CSV file is empty or invalid' },
        { status: 400 }
      );
    }

    // Clean and validate data
    const cleanedData = cleanSalesData(rawData);

    // Insert into Aurora
    let insertedCount = 0;
    for (const record of cleanedData) {
      const dateObj = new Date(record.date);

      await prisma.salesRecord.upsert({
        where: {
          storeId_date: {
            storeId: record.store_id,
            date: dateObj,
          },
        },
        create: {
          storeId: record.store_id,
          storeName: record.store,
          date: dateObj,
          week: record.week,
          ticketsCount: record.tickets_count,
          unitsSold: record.units_sold,
          customersCount: record.customers_count,
          newCustomers: record.new_customers,
          grossSales: record.gross_sales,
          discounts: record.discounts,
          returns: record.returns,
          netSales: record.net_sales,
          taxes: record.taxes,
          grossReceipts: record.gross_receipts,
          cogsWithExcise: record.cogs_with_excise,
          grossIncome: record.gross_income,
          grossMarginPct: record.gross_margin_pct,
          discountPct: record.discount_pct,
          costPct: record.cost_pct,
          avgBasketSize: record.avg_basket_size,
          avgOrderValue: record.avg_order_value,
          avgOrderProfit: record.avg_order_profit,
        },
        update: {
          storeName: record.store,
          week: record.week,
          ticketsCount: record.tickets_count,
          unitsSold: record.units_sold,
          customersCount: record.customers_count,
          newCustomers: record.new_customers,
          grossSales: record.gross_sales,
          discounts: record.discounts,
          returns: record.returns,
          netSales: record.net_sales,
          taxes: record.taxes,
          grossReceipts: record.gross_receipts,
          cogsWithExcise: record.cogs_with_excise,
          grossIncome: record.gross_income,
          grossMarginPct: record.gross_margin_pct,
          discountPct: record.discount_pct,
          costPct: record.cost_pct,
          avgBasketSize: record.avg_basket_size,
          avgOrderValue: record.avg_order_value,
          avgOrderProfit: record.avg_order_profit,
        },
      });
      insertedCount++;
    }

    return NextResponse.json({
      success: true,
      data: {
        recordCount: insertedCount,
        storeId,
        startDate,
        endDate,
      },
      source: 'aurora',
    });
  } catch (error) {
    console.error('Error uploading sales data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload sales data' },
      { status: 500 }
    );
  }
}
