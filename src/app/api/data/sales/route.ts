// ============================================
// SALES DATA API ROUTE
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { loadAllSalesData, uploadSalesData } from '@/lib/aws/s3';
import { parseCSV, cleanSalesData } from '@/lib/services/data-processor';
import { StoreId, UploadMetadata, SalesRecord } from '@/types';

// GET - Load all sales data from S3
export async function GET() {
  try {
    const files = await loadAllSalesData();

    const allRecords: SalesRecord[] = [];

    for (const file of files) {
      const rawData = parseCSV<Record<string, string>>(file.data);
      const cleanedData = cleanSalesData(rawData);
      allRecords.push(...cleanedData);
    }

    // Remove duplicates based on date + store
    const uniqueRecords = allRecords.reduce((acc, record) => {
      const key = `${record.date}_${record.store_id}`;
      if (!acc.has(key) || new Date(record.date) > new Date(acc.get(key)!.date)) {
        acc.set(key, record);
      }
      return acc;
    }, new Map<string, SalesRecord>());

    return NextResponse.json({
      success: true,
      data: Array.from(uniqueRecords.values()).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      ),
    });
  } catch (error) {
    console.error('Error loading sales data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load sales data' },
      { status: 500 }
    );
  }
}

// POST - Upload new sales data
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

    const metadata: UploadMetadata = {
      store: storeId,
      start_date: startDate,
      end_date: endDate,
      uploaded_at: new Date().toISOString(),
      filename: file.name,
    };

    const s3Key = await uploadSalesData(storeId, csvContent, metadata);

    return NextResponse.json({
      success: true,
      data: {
        key: s3Key,
        recordCount: cleanedData.length,
        metadata,
      },
    });
  } catch (error) {
    console.error('Error uploading sales data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload sales data' },
      { status: 500 }
    );
  }
}
