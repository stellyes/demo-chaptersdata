// ============================================
// KNOWLEDGE BASE API ROUTES
// Manage insights, rules, and analysis history
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getRelevantInsights,
  getRules,
  saveInsight,
  saveRule,
  validateInsight,
  deactivateInsight,
  deactivateRule,
  getRecentAnalyses,
  seedDefaultRules,
  type InsightInput,
  type RuleInput,
} from '@/lib/services/knowledge-base';

// GET /api/knowledge-base
// Retrieve insights, rules, or analysis history
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'insights';
    const categories = searchParams.get('categories')?.split(',').filter(Boolean);
    const storefrontId = searchParams.get('storefrontId') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    switch (type) {
      case 'insights': {
        const insights = await getRelevantInsights({
          categories,
          storefrontId,
          limit,
        });
        return NextResponse.json({
          success: true,
          data: { insights, count: insights.length },
        });
      }

      case 'rules': {
        const rules = await getRules(categories);
        return NextResponse.json({
          success: true,
          data: { rules, count: rules.length },
        });
      }

      case 'history': {
        const analysisType = searchParams.get('analysisType') || undefined;
        const history = await getRecentAnalyses(analysisType, limit);
        return NextResponse.json({
          success: true,
          data: { history, count: history.length },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid type. Use: insights, rules, or history' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Knowledge base GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve data' },
      { status: 500 }
    );
  }
}

// POST /api/knowledge-base
// Create new insights or rules
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, data } = body;

    if (!type || !data) {
      return NextResponse.json(
        { success: false, error: 'Missing type or data' },
        { status: 400 }
      );
    }

    switch (type) {
      case 'insight': {
        const insightData = data as InsightInput;
        if (!insightData.category || !insightData.insight || !insightData.source) {
          return NextResponse.json(
            { success: false, error: 'Insight requires category, insight, and source' },
            { status: 400 }
          );
        }
        const id = await saveInsight(insightData);
        return NextResponse.json({
          success: true,
          data: { id },
        });
      }

      case 'rule': {
        const ruleData = data as RuleInput;
        if (!ruleData.category || !ruleData.name || !ruleData.rule) {
          return NextResponse.json(
            { success: false, error: 'Rule requires category, name, and rule' },
            { status: 400 }
          );
        }
        const id = await saveRule(ruleData);
        return NextResponse.json({
          success: true,
          data: { id },
        });
      }

      case 'seed-rules': {
        await seedDefaultRules();
        return NextResponse.json({
          success: true,
          message: 'Default rules seeded successfully',
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid type. Use: insight, rule, or seed-rules' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Knowledge base POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create data' },
      { status: 500 }
    );
  }
}

// PATCH /api/knowledge-base
// Update insights or rules (validate, deactivate)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, id, action } = body;

    if (!type || !id || !action) {
      return NextResponse.json(
        { success: false, error: 'Missing type, id, or action' },
        { status: 400 }
      );
    }

    switch (type) {
      case 'insight': {
        if (action === 'validate') {
          await validateInsight(id);
          return NextResponse.json({
            success: true,
            message: 'Insight validated',
          });
        } else if (action === 'deactivate') {
          await deactivateInsight(id);
          return NextResponse.json({
            success: true,
            message: 'Insight deactivated',
          });
        }
        break;
      }

      case 'rule': {
        if (action === 'deactivate') {
          await deactivateRule(id);
          return NextResponse.json({
            success: true,
            message: 'Rule deactivated',
          });
        }
        break;
      }
    }

    return NextResponse.json(
      { success: false, error: 'Invalid type or action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Knowledge base PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update data' },
      { status: 500 }
    );
  }
}
