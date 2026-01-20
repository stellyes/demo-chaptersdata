// ============================================
// CLAUDE AI INTEGRATION SERVICE
// With persistent context from knowledge base
// ============================================

import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_CONFIG } from '@/lib/config';
import {
  buildContextForAnalysis,
  saveInsights,
  parseInsightsFromResponse,
  stripInsightsFromResponse,
  recordAnalysis,
  EXTRACTION_PROMPT,
  type InsightInput,
} from './knowledge-base';

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

// Configuration for context-aware analysis
export interface AnalysisOptions {
  useContext?: boolean;        // Whether to inject previous insights (default: true)
  extractInsights?: boolean;   // Whether to extract and save new insights (default: true)
  storefrontId?: string;       // Filter context to specific storefront
  dataRange?: string;          // Date range of the data being analyzed
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

// Generate AI response (basic, without context injection)
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

// Generate AI response with context injection and insight extraction
export async function generateContextAwareResponse(
  prompt: string,
  systemPrompt: string,
  analysisType: string,
  options: AnalysisOptions = {}
): Promise<{ analysis: string; insightsSaved: number }> {
  const {
    useContext = true,
    extractInsights = true,
    storefrontId,
    dataRange
  } = options;

  const client = getAnthropicClient();

  // Build enhanced system prompt with context
  let enhancedSystemPrompt = systemPrompt;

  if (useContext) {
    const context = await buildContextForAnalysis(analysisType, storefrontId);
    if (context) {
      enhancedSystemPrompt = `${systemPrompt}

=== EXISTING KNOWLEDGE BASE ===
Use this context from previous analyses to inform your response. Reference relevant prior findings when applicable.

${context}

=== END KNOWLEDGE BASE ===`;
    }
  }

  // Add insight extraction instructions if enabled
  let enhancedPrompt = prompt;
  if (extractInsights) {
    enhancedPrompt = `${prompt}

${EXTRACTION_PROMPT}`;
  }

  const response = await client.messages.create({
    model: CLAUDE_CONFIG.defaultModel,
    max_tokens: CLAUDE_CONFIG.maxTokens,
    system: enhancedSystemPrompt,
    messages: [{ role: 'user', content: enhancedPrompt }],
  });

  const textContent = response.content.find(c => c.type === 'text');
  const rawResult = textContent?.type === 'text' ? textContent.text : '';

  // Extract and save insights
  let insightsSaved = 0;
  if (extractInsights) {
    const insights = parseInsightsFromResponse(rawResult);
    if (insights.length > 0) {
      // Add metadata to insights
      const enrichedInsights: InsightInput[] = insights.map(i => ({
        ...i,
        source: `${analysisType}-analysis`,
        storefrontId,
        dataRange,
      }));
      insightsSaved = await saveInsights(enrichedInsights);
    }
  }

  // Strip insight tags from response for cleaner output
  const cleanResult = extractInsights ? stripInsightsFromResponse(rawResult) : rawResult;

  // Record this analysis
  await recordAnalysis({
    analysisType,
    storefrontId,
    inputSummary: prompt.slice(0, 500),
    outputSummary: cleanResult.slice(0, 1000),
    insightsCount: insightsSaved,
    tokensUsed: response.usage?.output_tokens,
    model: CLAUDE_CONFIG.defaultModel,
  });

  return { analysis: cleanResult, insightsSaved };
}

// Analyze sales trends (with context)
export async function analyzeSalesTrends(
  salesSummary: {
    totalRevenue: number;
    totalTransactions: number;
    avgOrderValue: number;
    avgMargin: number;
    storeComparison: Array<{ store: string; revenue: number; margin: number }>;
    recentTrends: Array<{ date: string; revenue: number }>;
  },
  options: AnalysisOptions = {}
): Promise<string> {
  const systemPrompt = `You are a retail analytics expert for cannabis dispensaries in San Francisco.
Analyze the provided sales data and provide actionable insights. Focus on:
1. Key observations about performance trends
2. Store-by-store comparisons
3. Areas of concern
4. Specific recommendations for improving sales and margins
5. Promotional strategies

When referencing previous context, be specific about what has changed or remained consistent.`;

  const prompt = `Analyze this sales data and provide insights:

${JSON.stringify(salesSummary, null, 2)}

Provide a concise analysis with specific, actionable recommendations.`;

  const { analysis } = await generateContextAwareResponse(
    prompt,
    systemPrompt,
    'sales',
    options
  );
  return analysis;
}

// Analyze brand performance (with context)
export async function analyzeBrandPerformance(
  brandData: Array<{ brand: string; netSales: number; margin: number; pctOfTotal: number }>,
  brandByCategory: Record<string, Array<{ brand: string; netSales: number }>>,
  options: AnalysisOptions = {}
): Promise<string> {
  const systemPrompt = `You are a retail buying expert for cannabis dispensaries.
Analyze brand performance data and provide recommendations for:
1. Brands to increase orders for (high margin, growing)
2. Brands to consider discontinuing (low margin, declining)
3. Brands requiring margin investigation
4. Brand mix optimization strategies
5. Promotional candidates

Reference any previous brand performance findings to identify trends over time.`;

  const prompt = `Analyze this brand performance data:

Top 50 Brands:
${JSON.stringify(brandData.slice(0, 50), null, 2)}

Brands by Category:
${JSON.stringify(brandByCategory, null, 2)}

Provide specific recommendations for inventory and buying decisions.`;

  const { analysis } = await generateContextAwareResponse(
    prompt,
    systemPrompt,
    'brands',
    options
  );
  return analysis;
}

// Analyze category performance (with context)
export async function analyzeCategoryPerformance(
  categoryData: Array<{ category: string; netSales: number; margin: number; pctOfTotal: number }>,
  brandSummary: Array<{ brand: string; category: string; netSales: number }>,
  options: AnalysisOptions = {}
): Promise<string> {
  const systemPrompt = `You are a retail category manager for cannabis dispensaries.
Analyze category performance and provide recommendations for:
1. Best performing categories and why
2. Categories needing improvement
3. Cross-category opportunities
4. Space allocation recommendations

Compare current category mix to historical patterns when available.`;

  const prompt = `Analyze this category performance data:

Category Performance:
${JSON.stringify(categoryData, null, 2)}

Top Brands by Category:
${JSON.stringify(brandSummary.slice(0, 30), null, 2)}

Provide specific recommendations for category management.`;

  const { analysis } = await generateContextAwareResponse(
    prompt,
    systemPrompt,
    'categories',
    options
  );
  return analysis;
}

// Analyze customer analytics (with context)
export async function analyzeCustomerData(
  customerSummary: {
    totalCustomers: number;
    newCustomers: number;
    segmentBreakdown: Record<string, number>;
    recencyBreakdown: Record<string, number>;
    avgLifetimeValue: number;
  },
  options: AnalysisOptions = {}
): Promise<string> {
  const systemPrompt = `You are a customer retention expert for cannabis retail.
Analyze customer data and provide recommendations for:
1. Customer retention strategies by segment
2. Acquisition opportunities
3. Re-engagement campaigns for lapsed customers
4. VIP program recommendations

Reference customer behavior patterns from previous analyses to track segment migration.`;

  const prompt = `Analyze this customer data:

${JSON.stringify(customerSummary, null, 2)}

Provide specific recommendations for customer retention and growth.`;

  const { analysis } = await generateContextAwareResponse(
    prompt,
    systemPrompt,
    'customers',
    options
  );
  return analysis;
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

// Generate comprehensive business insights (with full context)
export async function generateBusinessInsights(
  data: {
    salesSummary?: Record<string, unknown>;
    invoiceSummary?: Record<string, unknown>;
    researchFindings?: string;
    seoData?: Record<string, unknown>;
  },
  options: AnalysisOptions = {}
): Promise<string> {
  const systemPrompt = `You are a cannabis retail business consultant.
Provide comprehensive business insights combining all available data sources.
Be specific and actionable in your recommendations.

Synthesize current data with historical context to show trends and validate/update previous findings.`;

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

  const { analysis } = await generateContextAwareResponse(
    prompt,
    systemPrompt,
    'insights',
    options
  );
  return analysis;
}
