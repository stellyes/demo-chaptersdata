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

// ============================================
// CUSTOM QUERY FUNCTIONALITY
// ============================================

// Options for what data to include in context
export interface DataContextOptions {
  includeSales?: boolean;
  includeBrands?: boolean;
  includeProducts?: boolean;
  includeCustomers?: boolean;
  includeInvoices?: boolean;
  includeResearch?: boolean;
  includeSeo?: boolean;
  includeQrCodes?: boolean;
  // Specific research document IDs to include with full text
  selectedResearchIds?: string[];
}

// Summary structures for token-efficient context
interface SalesSummaryContext {
  totalRevenue: number;
  totalTransactions: number;
  avgOrderValue: number;
  avgMargin: number;
  dateRange: { start: string; end: string };
  byStore: Record<string, { revenue: number; margin: number; transactions: number }>;
  topDays: Array<{ date: string; revenue: number }>;
}

interface BrandSummaryContext {
  totalBrands: number;
  topBrands: Array<{ brand: string; netSales: number; margin: number; pctOfTotal: number }>;
  lowMarginBrands: Array<{ brand: string; margin: number; netSales: number }>;
  byCategory: Record<string, number>;
}

interface CustomerSummaryContext {
  totalCustomers: number;
  avgLifetimeValue: number;
  segmentBreakdown: Record<string, number>;
  recencyBreakdown: Record<string, number>;
  newVsReturning: { new: number; returning: number };
}

interface InvoiceSummaryContext {
  totalInvoices: number;
  totalSpend: number;
  avgInvoiceValue: number;
  topVendors: Array<{ vendor: string; totalSpend: number; invoiceCount: number }>;
  topProducts: Array<{ product: string; quantity: number; totalCost: number }>;
}

// Brand mapping type (from S3 config/brand_product_mapping.json)
interface BrandMappingData {
  [canonicalBrand: string]: {
    aliases: { [aliasName: string]: string }; // alias -> product_type
  };
}

// Build token-efficient data context from raw data
export function buildDataContext(
  data: {
    sales?: Array<Record<string, unknown>>;
    brands?: Array<Record<string, unknown>>;
    products?: Array<Record<string, unknown>>;
    customers?: Array<Record<string, unknown>>;
    invoices?: Array<Record<string, unknown>>;
    research?: Array<{ id: string; summary: string; key_findings: string[]; category: string; date: string }>;
    seo?: Array<{ site: string; score: number; priorities: string[]; quickWins: string[] }>;
    qrCodes?: Array<{ name: string; totalClicks: number; shortCode: string }>;
    brandMappings?: BrandMappingData;
  },
  options: DataContextOptions,
  selectedResearchDocs?: Array<{ id: string; summary: string; key_findings: string[]; category: string; source?: string }>
): string {
  const contextParts: string[] = [];

  // Sales summary (token-efficient)
  if (options.includeSales && data.sales && data.sales.length > 0) {
    const salesSummary = buildSalesSummary(data.sales);
    contextParts.push(`## Sales Data Summary
- Total Revenue: $${salesSummary.totalRevenue.toLocaleString()}
- Total Transactions: ${salesSummary.totalTransactions.toLocaleString()}
- Average Order Value: $${salesSummary.avgOrderValue.toFixed(2)}
- Average Margin: ${salesSummary.avgMargin.toFixed(1)}%
- Date Range: ${salesSummary.dateRange.start} to ${salesSummary.dateRange.end}

By Store:
${Object.entries(salesSummary.byStore).map(([store, stats]) =>
  `- ${store}: $${stats.revenue.toLocaleString()} revenue, ${stats.margin.toFixed(1)}% margin, ${stats.transactions} transactions`
).join('\n')}`);
  }

  // Brand summary
  if (options.includeBrands && data.brands && data.brands.length > 0) {
    const brandSummary = buildBrandSummary(data.brands);
    contextParts.push(`## Brand Performance Summary
- Total Brands: ${brandSummary.totalBrands}

Top 15 Brands by Revenue:
${brandSummary.topBrands.slice(0, 15).map((b, i) =>
  `${i + 1}. ${b.brand}: $${b.netSales.toLocaleString()} (${b.margin.toFixed(1)}% margin, ${b.pctOfTotal.toFixed(1)}% of total)`
).join('\n')}

Low Margin Brands (below 35%):
${brandSummary.lowMarginBrands.slice(0, 10).map(b =>
  `- ${b.brand}: ${b.margin.toFixed(1)}% margin, $${b.netSales.toLocaleString()}`
).join('\n')}

Sales by Category:
${Object.entries(brandSummary.byCategory).map(([cat, sales]) =>
  `- ${cat}: $${sales.toLocaleString()}`
).join('\n')}`);
  }

  // Product summary
  if (options.includeProducts && data.products && data.products.length > 0) {
    const productTypes: Record<string, number> = {};
    for (const p of data.products) {
      const type = String(p.product_type || 'Unknown');
      const sales = Number(p.net_sales) || 0;
      productTypes[type] = (productTypes[type] || 0) + sales;
    }

    const sortedProducts = Object.entries(productTypes)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([type, sales]) => `- ${type}: $${(sales as number).toLocaleString()}`);

    contextParts.push(`## Product Category Performance
${sortedProducts.join('\n')}`);
  }

  // Customer summary
  if (options.includeCustomers && data.customers && data.customers.length > 0) {
    const customerSummary = buildCustomerSummary(data.customers);
    contextParts.push(`## Customer Analytics Summary
- Total Customers: ${customerSummary.totalCustomers.toLocaleString()}
- Average Lifetime Value: $${customerSummary.avgLifetimeValue.toFixed(2)}

Customer Segments:
${Object.entries(customerSummary.segmentBreakdown).map(([seg, count]) =>
  `- ${seg}: ${count.toLocaleString()} customers`
).join('\n')}

Recency (Last Visit):
${Object.entries(customerSummary.recencyBreakdown).map(([seg, count]) =>
  `- ${seg}: ${count.toLocaleString()} customers`
).join('\n')}`);
  }

  // Invoice summary with detailed breakdowns
  if (options.includeInvoices && data.invoices && data.invoices.length > 0) {
    const invoiceSummary = buildInvoiceSummary(data.invoices);

    // Build brand-by-vendor breakdown for more detail
    const brandByVendor = new Map<string, Map<string, { cost: number; units: number }>>();
    // Build product type breakdown
    const productTypeStats = new Map<string, { cost: number; units: number; lineItems: number }>();
    // Build overall brand breakdown
    const brandStats = new Map<string, { cost: number; units: number; vendor: string }>();
    // Build vendor scoring data
    const vendorScoring = new Map<string, {
      totalSpend: number;
      invoiceCount: number;
      uniqueBrands: Set<string>;
      productTypes: Map<string, { cost: number; units: number; avgUnitCost: number }>;
      lineItems: number;
    }>();
    // Track product type costs by vendor for comparison
    const productTypeByVendor = new Map<string, Map<string, { cost: number; units: number }>>();

    for (const lineItem of data.invoices) {
      const vendor = String(lineItem.vendor || 'Unknown');
      const brand = String(lineItem.brand || 'Unknown');
      const productType = String(lineItem.product_type || 'Unknown').toUpperCase();
      const cost = Number(lineItem.total_cost_with_excise) || Number(lineItem.total_with_excise) || Number(lineItem.total_cost) || 0;
      const units = Number(lineItem.sku_units) || 0;
      const invoiceId = String(lineItem.invoice_id || '');

      // Vendor -> Brand breakdown
      if (!brandByVendor.has(vendor)) {
        brandByVendor.set(vendor, new Map());
      }
      const vendorBrands = brandByVendor.get(vendor)!;
      const existing = vendorBrands.get(brand) || { cost: 0, units: 0 };
      vendorBrands.set(brand, { cost: existing.cost + cost, units: existing.units + units });

      // Product type breakdown
      const typeStats = productTypeStats.get(productType) || { cost: 0, units: 0, lineItems: 0 };
      productTypeStats.set(productType, {
        cost: typeStats.cost + cost,
        units: typeStats.units + units,
        lineItems: typeStats.lineItems + 1,
      });

      // Overall brand breakdown
      const brandStat = brandStats.get(brand) || { cost: 0, units: 0, vendor };
      brandStats.set(brand, { cost: brandStat.cost + cost, units: brandStat.units + units, vendor });

      // Vendor scoring - track comprehensive vendor metrics
      if (!vendorScoring.has(vendor)) {
        vendorScoring.set(vendor, {
          totalSpend: 0,
          invoiceCount: 0,
          uniqueBrands: new Set(),
          productTypes: new Map(),
          lineItems: 0,
        });
      }
      const vendorScore = vendorScoring.get(vendor)!;
      vendorScore.totalSpend += cost;
      vendorScore.uniqueBrands.add(brand);
      vendorScore.lineItems += 1;

      // Track product type stats per vendor
      const vendorProductType = vendorScore.productTypes.get(productType) || { cost: 0, units: 0, avgUnitCost: 0 };
      vendorScore.productTypes.set(productType, {
        cost: vendorProductType.cost + cost,
        units: vendorProductType.units + units,
        avgUnitCost: units > 0 ? (vendorProductType.cost + cost) / (vendorProductType.units + units) : 0,
      });

      // Product type by vendor for price comparison
      if (!productTypeByVendor.has(productType)) {
        productTypeByVendor.set(productType, new Map());
      }
      const typeVendors = productTypeByVendor.get(productType)!;
      const vendorTypeStats = typeVendors.get(vendor) || { cost: 0, units: 0 };
      typeVendors.set(vendor, { cost: vendorTypeStats.cost + cost, units: vendorTypeStats.units + units });
    }

    // Calculate unique invoices per vendor from invoice IDs
    const vendorInvoices = new Map<string, Set<string>>();
    for (const lineItem of data.invoices) {
      const vendor = String(lineItem.vendor || 'Unknown');
      const invoiceId = String(lineItem.invoice_id || '');
      if (!vendorInvoices.has(vendor)) {
        vendorInvoices.set(vendor, new Set());
      }
      vendorInvoices.get(vendor)!.add(invoiceId);
    }
    for (const [vendor, invoiceIds] of vendorInvoices.entries()) {
      const score = vendorScoring.get(vendor);
      if (score) {
        score.invoiceCount = invoiceIds.size;
      }
    }

    // Get top brands per top vendor
    const vendorBrandDetails = invoiceSummary.topVendors.slice(0, 10).map(v => {
      const brands = brandByVendor.get(v.vendor);
      if (!brands) return { vendor: v, topBrands: [] };
      const sortedBrands = Array.from(brands.entries())
        .sort(([,a], [,b]) => b.cost - a.cost)
        .slice(0, 5)
        .map(([brand, stats]) => `${brand}: $${stats.cost.toLocaleString()} (${stats.units.toLocaleString()} units)`);
      return { vendor: v, topBrands: sortedBrands };
    });

    // Sort product types by cost
    const sortedProductTypes = Array.from(productTypeStats.entries())
      .sort(([,a], [,b]) => b.cost - a.cost)
      .slice(0, 15);

    // Sort brands by cost and get top 20
    const topBrandsByPurchase = Array.from(brandStats.entries())
      .sort(([,a], [,b]) => b.cost - a.cost)
      .slice(0, 20);

    contextParts.push(`## Purchasing/Invoice Summary (Line Item Detail)
- Total Line Items: ${data.invoices.length.toLocaleString()}
- Unique Invoices: ${invoiceSummary.totalInvoices.toLocaleString()}
- Total Spend: $${invoiceSummary.totalSpend.toLocaleString()}
- Average Invoice Value: $${invoiceSummary.avgInvoiceValue.toFixed(2)}

### Top Vendors (Distributors/Wholesalers):
${vendorBrandDetails.map(vd =>
  `- **${vd.vendor.vendor}**: $${vd.vendor.totalSpend.toLocaleString()} (${vd.vendor.invoiceCount} invoices)
  Top Brands: ${vd.topBrands.join(', ') || 'N/A'}`
).join('\n')}

### Purchasing by Product Type:
${sortedProductTypes.map(([type, stats]) =>
  `- ${type}: $${stats.cost.toLocaleString()} (${stats.units.toLocaleString()} units, ${stats.lineItems} line items)`
).join('\n')}

### Top 20 Brands by Purchase Volume:
${topBrandsByPurchase.map(([brand, stats], i) =>
  `${i + 1}. ${brand}: $${stats.cost.toLocaleString()} (${stats.units.toLocaleString()} units) via ${stats.vendor}`
).join('\n')}`);

    // Vendor Scoring Section - comprehensive vendor performance metrics
    const vendorScores = Array.from(vendorScoring.entries())
      .map(([vendor, stats]) => {
        // Calculate diversity score (more product types = more versatile vendor)
        const productTypeDiversity = stats.productTypes.size;
        // Calculate brand diversity
        const brandDiversity = stats.uniqueBrands.size;
        // Calculate average order size
        const avgOrderSize = stats.invoiceCount > 0 ? stats.totalSpend / stats.invoiceCount : 0;
        // Calculate items per invoice (reliability indicator)
        const itemsPerInvoice = stats.invoiceCount > 0 ? stats.lineItems / stats.invoiceCount : 0;

        return {
          vendor,
          totalSpend: stats.totalSpend,
          invoiceCount: stats.invoiceCount,
          brandCount: brandDiversity,
          productTypeCount: productTypeDiversity,
          avgOrderSize,
          itemsPerInvoice,
          productTypes: stats.productTypes,
        };
      })
      .filter(v => v.totalSpend > 1000) // Only vendors with significant spend
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 15);

    if (vendorScores.length > 0) {
      contextParts.push(`## Vendor Performance Scorecard
Comprehensive vendor metrics for supplier evaluation:

| Vendor | Total Spend | Orders | Brands | Categories | Avg Order | Items/Order |
|--------|-------------|--------|--------|------------|-----------|-------------|
${vendorScores.map(v =>
  `| ${v.vendor} | $${v.totalSpend.toLocaleString()} | ${v.invoiceCount} | ${v.brandCount} | ${v.productTypeCount} | $${v.avgOrderSize.toFixed(0)} | ${v.itemsPerInvoice.toFixed(1)} |`
).join('\n')}

**Vendor Insights:**
- Higher Items/Order suggests better fulfillment efficiency
- More Brands/Categories indicates a versatile supplier
- Compare Avg Order size for bulk ordering opportunities`);
    }

    // Product-Level Cost Comparison by Vendor
    // Find product types with multiple vendors for price comparison
    const multiVendorProductTypes = Array.from(productTypeByVendor.entries())
      .filter(([, vendors]) => vendors.size >= 2)
      .map(([productType, vendors]) => {
        const vendorPricing = Array.from(vendors.entries())
          .filter(([, stats]) => stats.units > 0)
          .map(([vendor, stats]) => ({
            vendor,
            totalCost: stats.cost,
            units: stats.units,
            avgUnitCost: stats.cost / stats.units,
          }))
          .sort((a, b) => a.avgUnitCost - b.avgUnitCost); // Sort by price (cheapest first)

        if (vendorPricing.length < 2) return null;

        const cheapest = vendorPricing[0];
        const mostExpensive = vendorPricing[vendorPricing.length - 1];
        const priceDiff = mostExpensive.avgUnitCost - cheapest.avgUnitCost;
        const priceDiffPct = cheapest.avgUnitCost > 0 ? (priceDiff / cheapest.avgUnitCost) * 100 : 0;

        return {
          productType,
          vendorCount: vendorPricing.length,
          cheapestVendor: cheapest.vendor,
          cheapestPrice: cheapest.avgUnitCost,
          mostExpensiveVendor: mostExpensive.vendor,
          mostExpensivePrice: mostExpensive.avgUnitCost,
          priceDiffPct,
          totalSpend: vendorPricing.reduce((sum, v) => sum + v.totalCost, 0),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.priceDiffPct - a.priceDiffPct) // Sort by biggest price difference
      .slice(0, 10);

    if (multiVendorProductTypes.length > 0) {
      contextParts.push(`## Product Category Price Comparison by Vendor
Identifies pricing opportunities where multiple vendors supply the same product type:

| Category | Vendors | Cheapest | Price | Most Expensive | Price | Diff % |
|----------|---------|----------|-------|----------------|-------|--------|
${multiVendorProductTypes.map(p =>
  `| ${p.productType} | ${p.vendorCount} | ${p.cheapestVendor} | $${p.cheapestPrice.toFixed(2)} | ${p.mostExpensiveVendor} | $${p.mostExpensivePrice.toFixed(2)} | ${p.priceDiffPct.toFixed(0)}% |`
).join('\n')}

**Actionable Insights:**
- Categories with high price differences (>20%) present negotiation opportunities
- Consider consolidating orders with cheapest vendor where quality is equivalent
- Use this data when renegotiating vendor contracts`);
    }

    // Cross-reference with brand sales data if available for profitability analysis
    if (options.includeBrands && data.brands && data.brands.length > 0) {
      // Build sales lookup by brand name (case-insensitive)
      const brandSalesLookup = new Map<string, { netSales: number; margin: number }>();
      for (const b of data.brands) {
        const brandName = String(b.brand || '').toUpperCase();
        const netSales = Number(b.net_sales) || 0;
        const margin = Number(b.gross_margin_pct) || 0;
        const existing = brandSalesLookup.get(brandName);
        if (existing) {
          brandSalesLookup.set(brandName, {
            netSales: existing.netSales + netSales,
            margin: (existing.margin + margin) / 2, // Average margin across stores
          });
        } else {
          brandSalesLookup.set(brandName, { netSales, margin });
        }
      }

      // Match invoice costs to sales for profitability analysis
      const profitabilityAnalysis: Array<{
        brand: string;
        purchaseCost: number;
        salesRevenue: number;
        reportedMargin: number;
        vendor: string;
        units: number;
      }> = [];

      for (const [brand, costStats] of brandStats.entries()) {
        const brandUpper = brand.toUpperCase();
        const salesData = brandSalesLookup.get(brandUpper);
        if (salesData && salesData.netSales > 0) {
          profitabilityAnalysis.push({
            brand,
            purchaseCost: costStats.cost,
            salesRevenue: salesData.netSales,
            reportedMargin: salesData.margin,
            vendor: costStats.vendor,
            units: costStats.units,
          });
        }
      }

      if (profitabilityAnalysis.length > 0) {
        // Sort by revenue for most impactful brands
        profitabilityAnalysis.sort((a, b) => b.salesRevenue - a.salesRevenue);

        // Calculate cost-to-revenue ratios
        const withRatios = profitabilityAnalysis.slice(0, 15).map(p => ({
          ...p,
          costToRevenueRatio: p.purchaseCost / p.salesRevenue,
        }));

        contextParts.push(`## Brand Profitability Analysis (Cost vs. Revenue)
This cross-references purchasing costs from invoices with sales revenue to identify true profitability:

| Brand | Revenue | Cost | Ratio | Margin | Vendor |
|-------|---------|------|-------|--------|--------|
${withRatios.map(p =>
  `| ${p.brand} | $${p.salesRevenue.toLocaleString()} | $${p.purchaseCost.toLocaleString()} | ${(p.costToRevenueRatio * 100).toFixed(0)}% | ${p.reportedMargin.toFixed(1)}% | ${p.vendor} |`
).join('\n')}

**Key Insights:**
- Cost/Revenue Ratio: Lower is better (indicates higher markup)
- Brands with high ratio (>60%) may need price increases or vendor renegotiation
- Compare reported margin with cost ratio for discrepancies`);
      }
    }
  }

  // Brand mappings with product-level cost matching
  if (data.brandMappings && Object.keys(data.brandMappings).length > 0) {
    const mappingEntries = Object.entries(data.brandMappings);

    // If we have invoice data, cross-reference for product-level cost analysis
    if (options.includeInvoices && data.invoices && data.invoices.length > 0) {
      // Build a lookup from product name (alias) to canonical brand and product type
      const aliasLookup = new Map<string, { canonicalBrand: string; productType: string }>();
      for (const [canonicalBrand, entry] of mappingEntries) {
        for (const [alias, productType] of Object.entries(entry.aliases)) {
          aliasLookup.set(alias.toUpperCase(), { canonicalBrand, productType: String(productType) });
        }
      }

      // Match invoice line items to product mappings for detailed cost breakdown
      const productCostByBrand = new Map<string, Map<string, { cost: number; units: number; lineItems: number }>>();

      for (const lineItem of data.invoices) {
        const productName = String(lineItem.product_name || '').toUpperCase();
        const brand = String(lineItem.brand || 'Unknown').toUpperCase();
        const cost = Number(lineItem.total_cost_with_excise) || Number(lineItem.total_with_excise) || Number(lineItem.total_cost) || 0;
        const units = Number(lineItem.sku_units) || 0;

        // Try to find product type from mapping
        let productType = String(lineItem.product_type || 'Unknown').toUpperCase();
        const aliasMatch = aliasLookup.get(productName);
        if (aliasMatch) {
          productType = aliasMatch.productType.toUpperCase();
        }

        // Group by brand then by product type
        if (!productCostByBrand.has(brand)) {
          productCostByBrand.set(brand, new Map());
        }
        const brandProducts = productCostByBrand.get(brand)!;
        const existing = brandProducts.get(productType) || { cost: 0, units: 0, lineItems: 0 };
        brandProducts.set(productType, {
          cost: existing.cost + cost,
          units: existing.units + units,
          lineItems: existing.lineItems + 1,
        });
      }

      // Generate product-level cost breakdown for top brands
      const topBrandProductCosts = Array.from(productCostByBrand.entries())
        .map(([brand, products]) => ({
          brand,
          totalCost: Array.from(products.values()).reduce((sum, p) => sum + p.cost, 0),
          products: Array.from(products.entries())
            .map(([type, stats]) => ({ type, ...stats, avgUnitCost: stats.units > 0 ? stats.cost / stats.units : 0 }))
            .sort((a, b) => b.cost - a.cost),
        }))
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, 10);

      if (topBrandProductCosts.length > 0) {
        contextParts.push(`## Product-Level Cost Analysis by Brand
Detailed cost breakdown showing what product types are being purchased from each brand:

${topBrandProductCosts.map(b => {
  const productBreakdown = b.products.slice(0, 5).map(p =>
    `  - ${p.type}: $${p.cost.toLocaleString()} (${p.units.toLocaleString()} units @ $${p.avgUnitCost.toFixed(2)}/unit)`
  ).join('\n');
  return `**${b.brand}** - Total: $${b.totalCost.toLocaleString()}
${productBreakdown}`;
}).join('\n\n')}

**Use This For:**
- Identify which product types drive costs for each brand
- Compare unit costs across similar products
- Spot opportunities to consolidate or renegotiate by product category`);
      }
    }

    // Only include brands that have multiple aliases or are in top purchased brands
    const relevantMappings = mappingEntries
      .filter(([, entry]) => Object.keys(entry.aliases).length >= 1)
      .slice(0, 30); // Limit to top 30 for token efficiency

    if (relevantMappings.length > 0) {
      contextParts.push(`## Brand Product Mappings (${mappingEntries.length} total brands)
This maps canonical brand names to their product aliases and types:
${relevantMappings.map(([canonical, entry]) => {
  const aliases = Object.entries(entry.aliases)
    .slice(0, 5) // Limit aliases shown
    .map(([alias, productType]) => `${alias} (${productType})`)
    .join(', ');
  const moreCount = Object.keys(entry.aliases).length - 5;
  return `- **${canonical}**: ${aliases}${moreCount > 0 ? ` +${moreCount} more` : ''}`;
}).join('\n')}`);
    }
  }

  // Research summaries (brief unless selected)
  if (options.includeResearch && data.research && data.research.length > 0) {
    const researchBrief = data.research.slice(0, 10).map(r =>
      `- [${r.category}] ${r.summary.slice(0, 150)}...`
    ).join('\n');
    contextParts.push(`## Recent Industry Research (${data.research.length} documents)
${researchBrief}`);
  }

  // Selected research documents with full detail
  if (selectedResearchDocs && selectedResearchDocs.length > 0) {
    const detailedResearch = selectedResearchDocs.map(doc =>
      `### ${doc.category} Research${doc.source ? ` (Source: ${doc.source})` : ''}
Summary: ${doc.summary}

Key Findings:
${doc.key_findings.map(f => `- ${f}`).join('\n')}`
    ).join('\n\n');
    contextParts.push(`## Selected Research Documents (Full Detail)
${detailedResearch}`);
  }

  // SEO data
  if (options.includeSeo && data.seo && data.seo.length > 0) {
    const seoContext = data.seo.map(s =>
      `### ${s.site} (Score: ${s.score}/100)
Priorities: ${s.priorities.slice(0, 3).join(', ')}
Quick Wins: ${s.quickWins.slice(0, 3).join(', ')}`
    ).join('\n\n');
    contextParts.push(`## SEO Performance
${seoContext}`);
  }

  // QR Codes
  if (options.includeQrCodes && data.qrCodes && data.qrCodes.length > 0) {
    const activeQr = data.qrCodes.filter(q => q.totalClicks > 0);
    contextParts.push(`## QR Code Tracking (${data.qrCodes.length} total, ${activeQr.length} with clicks)
${activeQr.slice(0, 10).map(q =>
  `- ${q.name}: ${q.totalClicks} clicks (${q.shortCode})`
).join('\n')}`);
  }

  return contextParts.join('\n\n');
}

// Helper to build sales summary
function buildSalesSummary(sales: Array<Record<string, unknown>>): SalesSummaryContext {
  let totalRevenue = 0;
  let totalTransactions = 0;
  const byStore: Record<string, { revenue: number; margin: number; transactions: number; marginSum: number }> = {};
  const dates: string[] = [];

  for (const record of sales) {
    const revenue = Number(record.net_sales) || 0;
    const transactions = Number(record.tickets_count) || 0;
    const margin = Number(record.gross_margin_pct) || 0;
    const store = String(record.store || 'Unknown');
    const date = String(record.date || '');

    totalRevenue += revenue;
    totalTransactions += transactions;
    if (date) dates.push(date);

    if (!byStore[store]) {
      byStore[store] = { revenue: 0, margin: 0, transactions: 0, marginSum: 0 };
    }
    byStore[store].revenue += revenue;
    byStore[store].transactions += transactions;
    byStore[store].marginSum += margin * revenue;
  }

  // Calculate weighted average margin
  const avgMargin = totalRevenue > 0
    ? Object.values(byStore).reduce((sum, s) => sum + s.marginSum, 0) / totalRevenue
    : 0;

  // Clean up byStore margins
  const cleanByStore: Record<string, { revenue: number; margin: number; transactions: number }> = {};
  for (const [store, stats] of Object.entries(byStore)) {
    cleanByStore[store] = {
      revenue: stats.revenue,
      margin: stats.revenue > 0 ? stats.marginSum / stats.revenue : 0,
      transactions: stats.transactions,
    };
  }

  dates.sort();

  return {
    totalRevenue,
    totalTransactions,
    avgOrderValue: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
    avgMargin,
    dateRange: { start: dates[0] || 'N/A', end: dates[dates.length - 1] || 'N/A' },
    byStore: cleanByStore,
    topDays: [],
  };
}

// Helper to build brand summary
function buildBrandSummary(brands: Array<Record<string, unknown>>): BrandSummaryContext {
  const brandMap = new Map<string, { netSales: number; marginSum: number; count: number }>();
  const categoryTotals: Record<string, number> = {};
  let totalSales = 0;

  for (const record of brands) {
    const brand = String(record.brand || 'Unknown');
    const netSales = Number(record.net_sales) || 0;
    const margin = Number(record.gross_margin_pct) || 0;

    totalSales += netSales;

    const existing = brandMap.get(brand) || { netSales: 0, marginSum: 0, count: 0 };
    existing.netSales += netSales;
    existing.marginSum += margin * netSales;
    existing.count += 1;
    brandMap.set(brand, existing);
  }

  const topBrands = Array.from(brandMap.entries())
    .map(([brand, stats]) => ({
      brand,
      netSales: stats.netSales,
      margin: stats.netSales > 0 ? stats.marginSum / stats.netSales : 0,
      pctOfTotal: totalSales > 0 ? (stats.netSales / totalSales) * 100 : 0,
    }))
    .sort((a, b) => b.netSales - a.netSales);

  const lowMarginBrands = topBrands
    .filter(b => b.margin < 35 && b.netSales > 1000)
    .sort((a, b) => a.margin - b.margin);

  return {
    totalBrands: brandMap.size,
    topBrands,
    lowMarginBrands,
    byCategory: categoryTotals,
  };
}

// Helper to build customer summary
function buildCustomerSummary(customers: Array<Record<string, unknown>>): CustomerSummaryContext {
  const segmentBreakdown: Record<string, number> = {};
  const recencyBreakdown: Record<string, number> = {};
  let totalLtv = 0;

  for (const customer of customers) {
    const segment = String(customer.customer_segment || 'Unknown');
    const recency = String(customer.recency_segment || 'Unknown');
    const ltv = Number(customer.lifetime_net_sales) || 0;

    segmentBreakdown[segment] = (segmentBreakdown[segment] || 0) + 1;
    recencyBreakdown[recency] = (recencyBreakdown[recency] || 0) + 1;
    totalLtv += ltv;
  }

  return {
    totalCustomers: customers.length,
    avgLifetimeValue: customers.length > 0 ? totalLtv / customers.length : 0,
    segmentBreakdown,
    recencyBreakdown,
    newVsReturning: {
      new: segmentBreakdown['New/Low'] || 0,
      returning: customers.length - (segmentBreakdown['New/Low'] || 0),
    },
  };
}

// Helper to build invoice summary
// Note: invoices are actually line items with vendor info joined from headers
function buildInvoiceSummary(invoices: Array<Record<string, unknown>>): InvoiceSummaryContext {
  const vendorMap = new Map<string, { totalSpend: number; invoiceCount: number; lineItemCount: number; brands: Set<string> }>();
  const invoiceIds = new Set<string>();
  let totalSpend = 0;

  for (const lineItem of invoices) {
    const vendor = String(lineItem.vendor || 'Unknown');
    const invoiceId = String(lineItem.invoice_id || '');
    const brand = String(lineItem.brand || 'Unknown');
    // Handle both field name variants from Python storage
    const cost = Number(lineItem.total_cost_with_excise) || Number(lineItem.total_with_excise) || Number(lineItem.total_cost) || 0;

    totalSpend += cost;
    invoiceIds.add(invoiceId);

    const existing = vendorMap.get(vendor) || { totalSpend: 0, invoiceCount: 0, lineItemCount: 0, brands: new Set<string>() };
    existing.totalSpend += cost;
    existing.lineItemCount += 1;
    existing.brands.add(brand);
    vendorMap.set(vendor, existing);
  }

  // Count unique invoices per vendor
  const invoicesByVendor = new Map<string, Set<string>>();
  for (const lineItem of invoices) {
    const vendor = String(lineItem.vendor || 'Unknown');
    const invoiceId = String(lineItem.invoice_id || '');
    if (!invoicesByVendor.has(vendor)) {
      invoicesByVendor.set(vendor, new Set<string>());
    }
    invoicesByVendor.get(vendor)!.add(invoiceId);
  }

  const topVendors = Array.from(vendorMap.entries())
    .map(([vendor, stats]) => ({
      vendor,
      totalSpend: stats.totalSpend,
      invoiceCount: invoicesByVendor.get(vendor)?.size || 0,
      lineItemCount: stats.lineItemCount,
      brandCount: stats.brands.size,
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend);

  return {
    totalInvoices: invoiceIds.size,
    totalSpend,
    avgInvoiceValue: invoiceIds.size > 0 ? totalSpend / invoiceIds.size : 0,
    topVendors: topVendors.map(v => ({ vendor: v.vendor, totalSpend: v.totalSpend, invoiceCount: v.invoiceCount })),
    topProducts: [],
  };
}

// Execute custom query with data context
export async function customQuery(
  userPrompt: string,
  dataContext: string,
  model: string = CLAUDE_CONFIG.defaultModel
): Promise<string> {
  const systemPrompt = `You are a cannabis retail business intelligence analyst for two San Francisco dispensaries: Barbary Coast and Grass Roots.

You have access to the following business data which has been summarized for efficiency. Use this data to answer the user's questions with specific, actionable insights.

${dataContext}

Guidelines:
- Be specific and reference actual numbers from the data
- Provide actionable recommendations when appropriate
- If the data doesn't contain information to answer the question, say so clearly
- Format your response with clear headings and bullet points where appropriate
- Focus on insights that would help a dispensary owner/manager make better decisions`;

  const prompt = userPrompt;

  // Don't cache custom queries as they're unique user prompts
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model,
    max_tokens: CLAUDE_CONFIG.maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = response.content.find(c => c.type === 'text');
  return textContent?.type === 'text' ? textContent.text : '';
}
