import { NextRequest, NextResponse } from 'next/server';
import { getMonthlyBilling, getRecentEvents } from '@/lib/services/billing';

// CORS headers for cross-origin requests from chapters-website
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

/**
 * GET /api/billing
 * Get billing summary for an organization
 *
 * Query params:
 * - orgId: Organization ID (required)
 * - month: Billing month in YYYY-MM format (optional, defaults to current)
 * - includeRecent: Include recent events (optional, default false)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const month = searchParams.get('month') || undefined;
    const includeRecent = searchParams.get('includeRecent') === 'true';

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'orgId is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const billing = await getMonthlyBilling(orgId, month);

    let recentEvents;
    if (includeRecent) {
      recentEvents = await getRecentEvents(orgId, 10);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          orgId,
          billingMonth: month || new Date().toISOString().slice(0, 7),
          totalBilled: billing.totalBilled,
          actionCount: billing.actionCount,
          awsActions: billing.awsActions,
          claudeActions: billing.claudeActions,
          breakdown: billing.breakdown,
          ...(recentEvents && { recentEvents }),
        },
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[Billing API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch billing data' },
      { status: 500, headers: corsHeaders }
    );
  }
}
