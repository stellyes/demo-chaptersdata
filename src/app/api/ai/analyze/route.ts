// ============================================
// AI ANALYSIS API ROUTE
// With context-aware analysis support
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeSalesTrends,
  analyzeBrandPerformance,
  analyzeCategoryPerformance,
  analyzeCustomerData,
  generateBusinessInsights,
  type AnalysisOptions,
} from '@/lib/services/claude';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, data, options } = body;

    if (!type || !data) {
      return NextResponse.json(
        { success: false, error: 'Missing type or data' },
        { status: 400 }
      );
    }

    // Analysis options (context injection and insight extraction)
    const analysisOptions: AnalysisOptions = {
      useContext: options?.useContext ?? true,         // Default: use context
      extractInsights: options?.extractInsights ?? true, // Default: extract insights
      storefrontId: options?.storefrontId,
      dataRange: options?.dataRange,
    };

    let analysis: string;

    switch (type) {
      case 'sales':
        analysis = await analyzeSalesTrends(data, analysisOptions);
        break;
      case 'brands':
        analysis = await analyzeBrandPerformance(
          data.brandData,
          data.brandByCategory,
          analysisOptions
        );
        break;
      case 'categories':
        analysis = await analyzeCategoryPerformance(
          data.categoryData,
          data.brandSummary,
          analysisOptions
        );
        break;
      case 'customers':
        analysis = await analyzeCustomerData(data, analysisOptions);
        break;
      case 'insights':
        analysis = await generateBusinessInsights(data, analysisOptions);
        break;
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid analysis type' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      data: {
        analysis,
        contextUsed: analysisOptions.useContext,
        insightsExtracted: analysisOptions.extractInsights,
      },
    });
  } catch (error) {
    console.error('AI analysis error:', error);
    return NextResponse.json(
      { success: false, error: 'AI analysis failed' },
      { status: 500 }
    );
  }
}
