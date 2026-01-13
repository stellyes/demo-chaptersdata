// ============================================
// AI ANALYSIS API ROUTE
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeSalesTrends,
  analyzeBrandPerformance,
  analyzeCategoryPerformance,
  analyzeCustomerData,
  generateBusinessInsights,
} from '@/lib/services/claude';

export async function POST(request: NextRequest) {
  try {
    const { type, data } = await request.json();

    if (!type || !data) {
      return NextResponse.json(
        { success: false, error: 'Missing type or data' },
        { status: 400 }
      );
    }

    let analysis: string;

    switch (type) {
      case 'sales':
        analysis = await analyzeSalesTrends(data);
        break;
      case 'brands':
        analysis = await analyzeBrandPerformance(data.brandData, data.brandByCategory);
        break;
      case 'categories':
        analysis = await analyzeCategoryPerformance(data.categoryData, data.brandSummary);
        break;
      case 'customers':
        analysis = await analyzeCustomerData(data);
        break;
      case 'insights':
        analysis = await generateBusinessInsights(data);
        break;
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid analysis type' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      data: { analysis },
    });
  } catch (error) {
    console.error('AI analysis error:', error);
    return NextResponse.json(
      { success: false, error: 'AI analysis failed' },
      { status: 500 }
    );
  }
}
