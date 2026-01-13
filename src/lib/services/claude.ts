// ============================================
// CLAUDE AI INTEGRATION SERVICE
// ============================================

import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_CONFIG } from '@/lib/config';

// Initialize Anthropic client (server-side only)
let anthropicClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    });
  }
  return anthropicClient;
}

// Simple in-memory cache for responses
const responseCache = new Map<string, { response: string; timestamp: number }>();

function getCacheKey(prompt: string, model: string): string {
  // Create a simple hash of the prompt
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${model}_${hash}`;
}

function getCachedResponse(key: string): string | null {
  const cached = responseCache.get(key);
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CLAUDE_CONFIG.cacheTTL * 1000) {
    responseCache.delete(key);
    return null;
  }

  return cached.response;
}

function setCachedResponse(key: string, response: string): void {
  responseCache.set(key, { response, timestamp: Date.now() });
}

// Generate AI response
export async function generateResponse(
  prompt: string,
  systemPrompt?: string,
  model: string = CLAUDE_CONFIG.defaultModel
): Promise<string> {
  const cacheKey = getCacheKey(prompt + (systemPrompt || ''), model);
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return cached;
  }

  const client = getAnthropicClient();

  const response = await client.messages.create({
    model,
    max_tokens: CLAUDE_CONFIG.maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = response.content.find(c => c.type === 'text');
  const result = textContent?.type === 'text' ? textContent.text : '';

  setCachedResponse(cacheKey, result);

  return result;
}

// Analyze sales trends
export async function analyzeSalesTrends(salesSummary: {
  totalRevenue: number;
  totalTransactions: number;
  avgOrderValue: number;
  avgMargin: number;
  storeComparison: Array<{ store: string; revenue: number; margin: number }>;
  recentTrends: Array<{ date: string; revenue: number }>;
}): Promise<string> {
  const systemPrompt = `You are a retail analytics expert for cannabis dispensaries in San Francisco.
Analyze the provided sales data and provide actionable insights. Focus on:
1. Key observations about performance trends
2. Store-by-store comparisons
3. Areas of concern
4. Specific recommendations for improving sales and margins
5. Promotional strategies`;

  const prompt = `Analyze this sales data and provide insights:

${JSON.stringify(salesSummary, null, 2)}

Provide a concise analysis with specific, actionable recommendations.`;

  return generateResponse(prompt, systemPrompt);
}

// Analyze brand performance
export async function analyzeBrandPerformance(
  brandData: Array<{ brand: string; netSales: number; margin: number; pctOfTotal: number }>,
  brandByCategory: Record<string, Array<{ brand: string; netSales: number }>>
): Promise<string> {
  const systemPrompt = `You are a retail buying expert for cannabis dispensaries.
Analyze brand performance data and provide recommendations for:
1. Brands to increase orders for (high margin, growing)
2. Brands to consider discontinuing (low margin, declining)
3. Brands requiring margin investigation
4. Brand mix optimization strategies
5. Promotional candidates`;

  const prompt = `Analyze this brand performance data:

Top 50 Brands:
${JSON.stringify(brandData.slice(0, 50), null, 2)}

Brands by Category:
${JSON.stringify(brandByCategory, null, 2)}

Provide specific recommendations for inventory and buying decisions.`;

  return generateResponse(prompt, systemPrompt);
}

// Analyze category performance
export async function analyzeCategoryPerformance(
  categoryData: Array<{ category: string; netSales: number; margin: number; pctOfTotal: number }>,
  brandSummary: Array<{ brand: string; category: string; netSales: number }>
): Promise<string> {
  const systemPrompt = `You are a retail category manager for cannabis dispensaries.
Analyze category performance and provide recommendations for:
1. Best performing categories and why
2. Categories needing improvement
3. Cross-category opportunities
4. Space allocation recommendations`;

  const prompt = `Analyze this category performance data:

Category Performance:
${JSON.stringify(categoryData, null, 2)}

Top Brands by Category:
${JSON.stringify(brandSummary.slice(0, 30), null, 2)}

Provide specific recommendations for category management.`;

  return generateResponse(prompt, systemPrompt);
}

// Analyze customer analytics
export async function analyzeCustomerData(customerSummary: {
  totalCustomers: number;
  newCustomers: number;
  segmentBreakdown: Record<string, number>;
  recencyBreakdown: Record<string, number>;
  avgLifetimeValue: number;
}): Promise<string> {
  const systemPrompt = `You are a customer retention expert for cannabis retail.
Analyze customer data and provide recommendations for:
1. Customer retention strategies by segment
2. Acquisition opportunities
3. Re-engagement campaigns for lapsed customers
4. VIP program recommendations`;

  const prompt = `Analyze this customer data:

${JSON.stringify(customerSummary, null, 2)}

Provide specific recommendations for customer retention and growth.`;

  return generateResponse(prompt, systemPrompt);
}

// Analyze research document (uses Haiku for cost efficiency)
export async function analyzeResearchDocument(
  content: string,
  filename: string
): Promise<{
  summary: string;
  key_findings: Array<{
    finding: string;
    relevance: 'high' | 'medium' | 'low';
    category: string;
    action_required: boolean;
    recommended_action?: string;
  }>;
  date_mentioned?: string;
  key_facts: string[];
  relevance_score: 'high' | 'medium' | 'low';
}> {
  const systemPrompt = `You are a cannabis industry research analyst.
Extract key information from this document that would be relevant to a San Francisco cannabis dispensary.
Return your analysis as JSON with the following structure:
{
  "summary": "2-3 sentence executive summary",
  "key_findings": [
    {
      "finding": "Brief finding",
      "relevance": "high/medium/low",
      "category": "regulatory/market/competition/products/pricing/other",
      "action_required": true/false,
      "recommended_action": "Optional action"
    }
  ],
  "date_mentioned": "YYYY-MM-DD or null",
  "key_facts": ["fact1", "fact2", "fact3"],
  "relevance_score": "high/medium/low for SF cannabis dispensary"
}`;

  const prompt = `Analyze this document (${filename}):

${content.slice(0, 20000)}

Extract key findings relevant to a San Francisco cannabis dispensary. Return ONLY valid JSON.`;

  const response = await generateResponse(prompt, systemPrompt, CLAUDE_CONFIG.haiku);

  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found in response');
  } catch {
    // Return default structure if parsing fails
    return {
      summary: response.slice(0, 500),
      key_findings: [],
      key_facts: [],
      relevance_score: 'low',
    };
  }
}

// Generate comprehensive business insights
export async function generateBusinessInsights(data: {
  salesSummary?: Record<string, unknown>;
  invoiceSummary?: Record<string, unknown>;
  researchFindings?: string;
  seoData?: Record<string, unknown>;
}): Promise<string> {
  const systemPrompt = `You are a cannabis retail business consultant.
Provide comprehensive business insights combining all available data sources.
Be specific and actionable in your recommendations.`;

  const prompt = `Generate business insights from this data:

Sales Summary:
${data.salesSummary ? JSON.stringify(data.salesSummary, null, 2) : 'Not available'}

Invoice/Purchasing Summary:
${data.invoiceSummary ? JSON.stringify(data.invoiceSummary, null, 2) : 'Not available'}

Recent Industry Research:
${data.researchFindings || 'Not available'}

SEO Performance:
${data.seoData ? JSON.stringify(data.seoData, null, 2) : 'Not available'}

Provide comprehensive, actionable insights for the business.`;

  return generateResponse(prompt, systemPrompt);
}
