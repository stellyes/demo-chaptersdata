// ============================================
// INSIGHTS API ROUTE
// List and manage business insights from Progressive Learning
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getRelevantInsights, deactivateInsight, validateInsight } from '@/lib/services/knowledge-base';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const categories = searchParams.get('categories')?.split(',').filter(Boolean);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const insights = await getRelevantInsights({
      categories,
      limit,
    });

    return NextResponse.json({
      success: true,
      data: insights,
    });
  } catch (error) {
    console.error('Error fetching insights:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch insights' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action } = body;

    if (!id || !action) {
      return NextResponse.json(
        { success: false, error: 'Missing id or action' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'validate':
        await validateInsight(id);
        return NextResponse.json({ success: true, message: 'Insight validated' });

      case 'deactivate':
        await deactivateInsight(id);
        return NextResponse.json({ success: true, message: 'Insight deactivated' });

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error updating insight:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update insight' },
      { status: 500 }
    );
  }
}
