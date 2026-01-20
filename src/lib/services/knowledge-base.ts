// ============================================
// KNOWLEDGE BASE SERVICE
// Manages persistent context for Claude analyses
// ============================================

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Types for the knowledge base
export interface InsightInput {
  category: string;
  subcategory?: string;
  insight: string;
  confidence?: 'high' | 'medium' | 'low';
  source: string;
  sourceData?: string;
  dataRange?: string;
  storefrontId?: string;
  expiresAt?: Date;
}

export interface RuleInput {
  category: string;
  name: string;
  description: string;
  rule: string;
  priority?: number;
  createdBy?: string;
}

export interface ContextQuery {
  categories?: string[];
  storefrontId?: string;
  limit?: number;
  includeRules?: boolean;
}

// ============================================
// INSIGHT MANAGEMENT
// ============================================

export async function saveInsight(input: InsightInput): Promise<string> {
  const insight = await prisma.businessInsight.create({
    data: {
      category: input.category,
      subcategory: input.subcategory,
      insight: input.insight,
      confidence: input.confidence || 'medium',
      source: input.source,
      sourceData: input.sourceData,
      dataRange: input.dataRange,
      storefrontId: input.storefrontId,
      expiresAt: input.expiresAt,
    },
  });
  return insight.id;
}

export async function saveInsights(inputs: InsightInput[]): Promise<number> {
  const result = await prisma.businessInsight.createMany({
    data: inputs.map(input => ({
      category: input.category,
      subcategory: input.subcategory,
      insight: input.insight,
      confidence: input.confidence || 'medium',
      source: input.source,
      sourceData: input.sourceData,
      dataRange: input.dataRange,
      storefrontId: input.storefrontId,
      expiresAt: input.expiresAt,
    })),
  });
  return result.count;
}

export async function getRelevantInsights(query: ContextQuery) {
  const where: Prisma.BusinessInsightWhereInput = {
    isActive: true,
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
    ],
  };

  if (query.categories?.length) {
    where.category = { in: query.categories };
  }

  if (query.storefrontId) {
    where.OR = [
      { storefrontId: query.storefrontId },
      { storefrontId: null }, // Include global insights
    ];
  }

  const insights = await prisma.businessInsight.findMany({
    where,
    orderBy: [
      { confidence: 'desc' },
      { createdAt: 'desc' },
    ],
    take: query.limit || 50,
  });

  return insights;
}

export async function validateInsight(id: string): Promise<void> {
  await prisma.businessInsight.update({
    where: { id },
    data: { validatedAt: new Date() },
  });
}

export async function deactivateInsight(id: string): Promise<void> {
  await prisma.businessInsight.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function deactivateOldInsights(
  category: string,
  beforeDate: Date
): Promise<number> {
  const result = await prisma.businessInsight.updateMany({
    where: {
      category,
      createdAt: { lt: beforeDate },
      isActive: true,
    },
    data: { isActive: false },
  });
  return result.count;
}

// ============================================
// BUSINESS RULES MANAGEMENT
// ============================================

export async function saveRule(input: RuleInput): Promise<string> {
  const rule = await prisma.businessRule.upsert({
    where: {
      category_name: {
        category: input.category,
        name: input.name,
      },
    },
    update: {
      description: input.description,
      rule: input.rule,
      priority: input.priority || 5,
    },
    create: {
      category: input.category,
      name: input.name,
      description: input.description,
      rule: input.rule,
      priority: input.priority || 5,
      createdBy: input.createdBy || 'system',
    },
  });
  return rule.id;
}

export async function getRules(categories?: string[]) {
  const where: Prisma.BusinessRuleWhereInput = { isActive: true };

  if (categories?.length) {
    where.category = { in: categories };
  }

  const rules = await prisma.businessRule.findMany({
    where,
    orderBy: [
      { priority: 'desc' },
      { category: 'asc' },
    ],
  });

  return rules;
}

export async function deactivateRule(id: string): Promise<void> {
  await prisma.businessRule.update({
    where: { id },
    data: { isActive: false },
  });
}

// ============================================
// CONTEXT BUILDING
// ============================================

export async function buildContextForAnalysis(
  analysisType: string,
  storefrontId?: string
): Promise<string> {
  // Map analysis types to relevant categories
  const categoryMap: Record<string, string[]> = {
    sales: ['sales', 'trends', 'seasonality', 'market'],
    brands: ['brands', 'products', 'purchasing', 'margins'],
    categories: ['categories', 'products', 'inventory'],
    customers: ['customers', 'retention', 'segments'],
    insights: ['sales', 'brands', 'customers', 'market', 'trends'],
  };

  const categories = categoryMap[analysisType] || [analysisType];

  // Get relevant insights
  const insights = await getRelevantInsights({
    categories,
    storefrontId,
    limit: 30,
  });

  // Get relevant rules
  const rules = await getRules(categories);

  // Build context string
  const contextParts: string[] = [];

  if (rules.length > 0) {
    contextParts.push('=== BUSINESS RULES & GUIDELINES ===');
    rules.forEach(rule => {
      contextParts.push(`[${rule.category}] ${rule.name}: ${rule.rule}`);
    });
  }

  if (insights.length > 0) {
    contextParts.push('\n=== PREVIOUS FINDINGS & CONTEXT ===');

    // Group insights by category
    const byCategory = insights.reduce((acc, insight) => {
      if (!acc[insight.category]) acc[insight.category] = [];
      acc[insight.category].push(insight);
      return acc;
    }, {} as Record<string, typeof insights>);

    for (const [category, categoryInsights] of Object.entries(byCategory)) {
      contextParts.push(`\n[${category.toUpperCase()}]`);
      categoryInsights.forEach(insight => {
        const confidence = insight.confidence === 'high' ? '★' : insight.confidence === 'medium' ? '○' : '·';
        contextParts.push(`${confidence} ${insight.insight}`);
      });
    }
  }

  return contextParts.join('\n');
}

// ============================================
// ANALYSIS HISTORY
// ============================================

export async function recordAnalysis(data: {
  analysisType: string;
  storefrontId?: string;
  inputSummary: string;
  outputSummary: string;
  insightsCount: number;
  tokensUsed?: number;
  model?: string;
}): Promise<string> {
  const record = await prisma.analysisHistory.create({
    data,
  });
  return record.id;
}

export async function getRecentAnalyses(
  analysisType?: string,
  limit: number = 10
) {
  const where: Prisma.AnalysisHistoryWhereInput = {};
  if (analysisType) where.analysisType = analysisType;

  return prisma.analysisHistory.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ============================================
// INSIGHT EXTRACTION PROMPTS
// ============================================

export const EXTRACTION_PROMPT = `
After providing your analysis, extract key insights that should be remembered for future analyses.
Return them in JSON format at the end of your response:

<insights>
[
  {
    "category": "sales|brands|categories|customers|purchasing|market|trends",
    "subcategory": "optional more specific category",
    "insight": "A clear, actionable insight that will be useful for future analyses",
    "confidence": "high|medium|low"
  }
]
</insights>

Only include insights that are:
1. Durable (likely to remain true over weeks/months)
2. Actionable (can inform business decisions)
3. Specific (not generic business advice)
4. Based on the actual data provided
`;

export function parseInsightsFromResponse(response: string): InsightInput[] {
  const match = response.match(/<insights>([\s\S]*?)<\/insights>/);
  if (!match) return [];

  try {
    const insights = JSON.parse(match[1]);
    return insights.map((i: { category: string; subcategory?: string; insight: string; confidence?: string }) => ({
      category: i.category,
      subcategory: i.subcategory,
      insight: i.insight,
      confidence: (i.confidence || 'medium') as 'high' | 'medium' | 'low',
      source: 'claude-analysis',
    }));
  } catch {
    return [];
  }
}

export function stripInsightsFromResponse(response: string): string {
  return response.replace(/<insights>[\s\S]*?<\/insights>/, '').trim();
}

// ============================================
// SEED DEFAULT RULES
// ============================================

export async function seedDefaultRules(): Promise<void> {
  const defaultRules: RuleInput[] = [
    {
      category: 'margins',
      name: 'minimum_acceptable_margin',
      description: 'Minimum gross margin threshold for products',
      rule: 'Products with gross margins below 30% should be flagged for review. Target margin for flower is 40%+, concentrates 45%+, edibles 50%+.',
      priority: 8,
    },
    {
      category: 'brands',
      name: 'brand_performance_threshold',
      description: 'When to consider discontinuing a brand',
      rule: 'Brands representing less than 0.5% of sales for 3+ months with margins under 35% are candidates for discontinuation.',
      priority: 7,
    },
    {
      category: 'inventory',
      name: 'reorder_timing',
      description: 'When to reorder products',
      rule: 'Reorder when inventory reaches 2 weeks of supply. Fast-moving items (top 20% by velocity) should maintain 3 weeks supply.',
      priority: 8,
    },
    {
      category: 'customers',
      name: 'churn_definition',
      description: 'When a customer is considered churned',
      rule: 'Customers with no visit in 90 days are at-risk. Customers with no visit in 180 days are considered churned.',
      priority: 7,
    },
    {
      category: 'pricing',
      name: 'discount_limits',
      description: 'Guardrails on discounting',
      rule: 'Total discount percentage should not exceed 15% of gross sales. Daily deals should target 10-20% off, not more.',
      priority: 8,
    },
    {
      category: 'sales',
      name: 'store_comparison',
      description: 'How to compare store performance',
      rule: 'Barbary Coast typically has 60% higher foot traffic than Grass Roots. Compare per-customer metrics, not totals.',
      priority: 6,
    },
  ];

  for (const rule of defaultRules) {
    await saveRule(rule);
  }
}
