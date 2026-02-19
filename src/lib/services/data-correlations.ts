// ============================================
// DATA CORRELATIONS SERVICE
// Cross-table analytics for Progressive Learning
// Links sales, brands, invoices, customers, and more
// ============================================

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

// Timeout for individual correlation queries (30 seconds)
const QUERY_TIMEOUT_MS = 30000;

// Helper to add timeout to async operations
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation '${operationName}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface DailyStorePerformance {
  date: string;
  storeId: string;
  storeName: string | null;
  // Sales metrics
  netSales: number;
  grossMarginPct: number;
  ticketsCount: number;
  customersCount: number;
  avgOrderValue: number;
  // Budtender metrics for same day
  budtendersActive: number;
  totalBudtenderTickets: number;
  avgBudtenderSales: number;
  // Purchasing on same day
  invoicesReceived: number;
  purchasingCost: number;
  // Derived metrics
  salesToPurchaseRatio: number;
}

export interface BrandProfitability {
  brandName: string;
  brandId: string | null;
  // Purchasing side
  totalPurchaseCost: number;
  totalUnitsPurchased: number;
  avgUnitCost: number;
  invoiceCount: number;
  vendors: string[];
  // Sales side
  totalNetSales: number;
  salesMarginPct: number;
  // Profitability
  markupRatio: number;
  estimatedProfit: number;
  profitMarginPct: number;
  // Product types this brand sells
  productTypes: string[];
}

export interface ProductCategoryFlow {
  productType: string;
  // Purchasing
  purchaseCost: number;
  unitsPurchased: number;
  avgPurchasePrice: number;
  // Sales
  salesRevenue: number;
  salesMarginPct: number;
  pctOfTotalSales: number;
  // Flow metrics
  markupRatio: number;
  inventoryTurnoverIndicator: number;
}

export interface CustomerSegmentMetrics {
  segment: string;
  customerCount: number;
  totalLifetimeSales: number;
  avgLifetimeValue: number;
  avgVisits: number;
  avgOrderValue: number;
  // Recency breakdown within segment
  activeCount: number;
  atRiskCount: number;
  lapsedCount: number;
}

export interface VendorPerformance {
  vendorName: string;
  vendorId: string;
  // Purchasing metrics
  totalInvoices: number;
  totalPurchaseCost: number;
  totalUnits: number;
  avgInvoiceValue: number;
  // Brand portfolio
  brandsSupplied: string[];
  brandCount: number;
  // Product type breakdown
  productTypesSupplied: string[];
  // Timing
  firstInvoiceDate: Date | null;
  lastInvoiceDate: Date | null;
  avgDaysBetweenOrders: number;
}

export interface DateCorrelation {
  date: string;
  dayOfWeek: string;
  // Sales
  dailySales: number;
  dailyCustomers: number;
  dailyTickets: number;
  // Purchasing (received that day)
  purchasingCost: number;
  invoicesReceived: number;
  // Regulatory events on that day
  regulatoryEvents: Array<{
    title: string;
    impactLevel: string;
    eventType: string;
  }>;
  // Industry news published that day
  newsItems: Array<{
    title: string;
    relevance: number;
  }>;
}

export interface KnowledgeGraphEntry {
  type: 'insight' | 'question' | 'rule' | 'research';
  category: string;
  content: string;
  confidence: string;
  createdAt: Date;
  source?: string;
}

export interface CorrelationSummary {
  dailyPerformance: DailyStorePerformance[];
  brandProfitability: BrandProfitability[];
  productCategoryFlow: ProductCategoryFlow[];
  customerSegments: CustomerSegmentMetrics[];
  vendorPerformance: VendorPerformance[];
  dateCorrelations: DateCorrelation[];
  knowledgeGraph: Record<string, KnowledgeGraphEntry[]>;
  summary: {
    totalBrandsAnalyzed: number;
    totalVendorsAnalyzed: number;
    dateRangeStart: string;
    dateRangeEnd: string;
    topPerformingBrand: string | null;
    topVendor: string | null;
    mostProfitableCategory: string | null;
    largestCustomerSegment: string | null;
  };
}

// ============================================
// CORRELATION QUERIES
// ============================================

export class DataCorrelationsService {
  private lookbackDays: number;

  constructor(lookbackDays: number = 30) {
    this.lookbackDays = lookbackDays;
  }

  /**
   * Get all correlations for Progressive Learning
   * Uses timeouts to prevent any single query from blocking indefinitely
   */
  async getAllCorrelations(): Promise<CorrelationSummary> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - this.lookbackDays);

    // Run all correlation queries with timeouts
    // If any query times out, use empty result to allow processing to continue
    const safeQuery = async <T>(
      queryFn: () => Promise<T>,
      defaultValue: T,
      operationName: string
    ): Promise<T> => {
      try {
        return await withTimeout(queryFn(), QUERY_TIMEOUT_MS, operationName);
      } catch (error) {
        console.warn(`Correlation query '${operationName}' failed:`, error);
        return defaultValue;
      }
    };

    // Run correlation queries SEQUENTIALLY to avoid Prisma connection pool
    // exhaustion in Amplify serverless environment. Parallel Promise.all
    // with 7 concurrent queries can deadlock the connection pool (limit=20).
    const dailyPerformance = await safeQuery(() => this.getDailyStorePerformance(startDate), [], 'dailyStorePerformance');
    const brandProfitability = await safeQuery(() => this.getBrandProfitability(), [], 'brandProfitability');
    const productCategoryFlow = await safeQuery(() => this.getProductCategoryFlow(), [], 'productCategoryFlow');
    const customerSegments = await safeQuery(() => this.getCustomerSegmentMetrics(), [], 'customerSegments');
    const vendorPerformance = await safeQuery(() => this.getVendorPerformance(startDate), [], 'vendorPerformance');
    const dateCorrelations = await safeQuery(() => this.getDateCorrelations(startDate), [], 'dateCorrelations');
    const knowledgeGraph = await safeQuery(() => this.getKnowledgeGraphByCategory(), {}, 'knowledgeGraph');

    // Build summary
    const topBrand = brandProfitability.length > 0
      ? brandProfitability.reduce((a, b) => a.estimatedProfit > b.estimatedProfit ? a : b)
      : null;

    const topVendor = vendorPerformance.length > 0
      ? vendorPerformance.reduce((a, b) => a.totalPurchaseCost > b.totalPurchaseCost ? a : b)
      : null;

    const topCategory = productCategoryFlow.length > 0
      ? productCategoryFlow.reduce((a, b) => a.markupRatio > b.markupRatio ? a : b)
      : null;

    const largestSegment = customerSegments.length > 0
      ? customerSegments.reduce((a, b) => a.customerCount > b.customerCount ? a : b)
      : null;

    return {
      dailyPerformance,
      brandProfitability,
      productCategoryFlow,
      customerSegments,
      vendorPerformance,
      dateCorrelations,
      knowledgeGraph,
      summary: {
        totalBrandsAnalyzed: brandProfitability.length,
        totalVendorsAnalyzed: vendorPerformance.length,
        dateRangeStart: startDate.toISOString().split('T')[0],
        dateRangeEnd: new Date().toISOString().split('T')[0],
        topPerformingBrand: topBrand?.brandName || null,
        topVendor: topVendor?.vendorName || null,
        mostProfitableCategory: topCategory?.productType || null,
        largestCustomerSegment: largestSegment?.segment || null,
      },
    };
  }

  /**
   * Daily Store Performance: Sales + Budtenders + Invoices by date
   */
  async getDailyStorePerformance(startDate: Date): Promise<DailyStorePerformance[]> {
    // Get sales data
    const salesData = await prisma.salesRecord.findMany({
      where: { date: { gte: startDate } },
      orderBy: { date: 'desc' },
    });

    // Get budtender data for same period
    const budtenderData = await prisma.budtenderRecord.findMany({
      where: { date: { gte: startDate } },
    });

    // Get invoices for same period
    const invoiceData = await prisma.invoice.findMany({
      where: { invoiceDate: { gte: startDate } },
      select: {
        invoiceDate: true,
        storefrontId: true,
        totalCost: true,
      },
    });

    // Group by date and store
    const resultMap = new Map<string, DailyStorePerformance>();

    for (const sale of salesData) {
      const key = `${sale.date.toISOString().split('T')[0]}_${sale.storeId}`;
      resultMap.set(key, {
        date: sale.date.toISOString().split('T')[0],
        storeId: sale.storeId,
        storeName: sale.storeName,
        netSales: Number(sale.netSales),
        grossMarginPct: Number(sale.grossMarginPct),
        ticketsCount: sale.ticketsCount,
        customersCount: sale.customersCount,
        avgOrderValue: Number(sale.avgOrderValue),
        budtendersActive: 0,
        totalBudtenderTickets: 0,
        avgBudtenderSales: 0,
        invoicesReceived: 0,
        purchasingCost: 0,
        salesToPurchaseRatio: 0,
      });
    }

    // Add budtender metrics
    for (const bt of budtenderData) {
      const key = `${bt.date.toISOString().split('T')[0]}_${bt.storeId}`;
      const existing = resultMap.get(key);
      if (existing) {
        existing.budtendersActive++;
        existing.totalBudtenderTickets += bt.ticketsCount;
        existing.avgBudtenderSales = (existing.avgBudtenderSales * (existing.budtendersActive - 1) + Number(bt.netSales)) / existing.budtendersActive;
      }
    }

    // Add invoice metrics
    for (const inv of invoiceData) {
      if (!inv.invoiceDate || !inv.storefrontId) continue;
      // Find matching sales record by date (any store if storefrontId doesn't match)
      const dateStr = inv.invoiceDate.toISOString().split('T')[0];
      for (const [key, value] of resultMap) {
        if (key.startsWith(dateStr)) {
          value.invoicesReceived++;
          value.purchasingCost += Number(inv.totalCost);
        }
      }
    }

    // Calculate derived metrics
    for (const perf of resultMap.values()) {
      perf.salesToPurchaseRatio = perf.purchasingCost > 0
        ? perf.netSales / perf.purchasingCost
        : 0;
    }

    return Array.from(resultMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Brand Profitability: Purchase costs vs Sales revenue
   */
  async getBrandProfitability(): Promise<BrandProfitability[]> {
    // Get all canonical brands with their aliases
    const brands = await prisma.canonicalBrand.findMany({
      include: {
        aliases: true,
        vendorBrands: {
          include: { vendor: true },
        },
      },
    });

    // Get invoice line items grouped by brand
    const lineItemsByBrand = await prisma.invoiceLineItem.groupBy({
      by: ['brandId'],
      _sum: {
        totalCost: true,
        skuUnits: true,
      },
      _count: {
        id: true,
      },
      where: {
        brandId: { not: null },
      },
    });

    // Get brand records for sales data
    const brandRecords = await prisma.brandRecord.findMany({
      where: { brandId: { not: null } },
    });

    // Build profitability map
    const profitabilityMap = new Map<string, BrandProfitability>();

    for (const brand of brands) {
      const lineItemData = lineItemsByBrand.find(li => li.brandId === brand.id);
      const salesData = brandRecords.filter(br => br.brandId === brand.id);

      const totalPurchaseCost = Number(lineItemData?._sum.totalCost || 0);
      const totalUnitsPurchased = lineItemData?._sum.skuUnits || 0;
      const invoiceCount = lineItemData?._count.id || 0;

      const totalNetSales = salesData.reduce((sum, br) => sum + Number(br.netSales), 0);
      const avgSalesMargin = salesData.length > 0
        ? salesData.reduce((sum, br) => sum + Number(br.grossMarginPct), 0) / salesData.length
        : 0;

      const productTypes = [...new Set(brand.aliases.map(a => a.productType).filter(Boolean))];
      const vendors = brand.vendorBrands.map(vb => vb.vendor.canonicalName);

      const estimatedProfit = totalNetSales - totalPurchaseCost;
      const markupRatio = totalPurchaseCost > 0 ? totalNetSales / totalPurchaseCost : 0;

      profitabilityMap.set(brand.id, {
        brandName: brand.canonicalName,
        brandId: brand.id,
        totalPurchaseCost,
        totalUnitsPurchased,
        avgUnitCost: totalUnitsPurchased > 0 ? totalPurchaseCost / totalUnitsPurchased : 0,
        invoiceCount,
        vendors,
        totalNetSales,
        salesMarginPct: avgSalesMargin,
        markupRatio,
        estimatedProfit,
        profitMarginPct: totalNetSales > 0 ? (estimatedProfit / totalNetSales) * 100 : 0,
        productTypes: productTypes as string[],
      });
    }

    // Sort by estimated profit and return top 50
    return Array.from(profitabilityMap.values())
      .filter(b => b.totalPurchaseCost > 0 || b.totalNetSales > 0)
      .sort((a, b) => b.estimatedProfit - a.estimatedProfit)
      .slice(0, 50);
  }

  /**
   * Product Category Flow: Purchase → Sale by category
   */
  async getProductCategoryFlow(): Promise<ProductCategoryFlow[]> {
    // Get product records for sales by category
    const productRecords = await prisma.productRecord.findMany();

    // Get invoice line items grouped by product type
    const lineItemsByType = await prisma.invoiceLineItem.groupBy({
      by: ['productType'],
      _sum: {
        totalCost: true,
        skuUnits: true,
      },
      where: {
        productType: { not: null },
      },
    });

    // Aggregate product records by type
    const salesByType = new Map<string, { revenue: number; margin: number; pctTotal: number; count: number }>();
    for (const pr of productRecords) {
      const type = pr.productType.toUpperCase();
      const existing = salesByType.get(type) || { revenue: 0, margin: 0, pctTotal: 0, count: 0 };
      existing.revenue += Number(pr.netSales);
      existing.margin += Number(pr.grossMarginPct);
      existing.pctTotal += Number(pr.pctOfTotalNetSales);
      existing.count++;
      salesByType.set(type, existing);
    }

    // Combine purchase and sales data
    const results: ProductCategoryFlow[] = [];
    const allTypes = new Set([
      ...lineItemsByType.map(li => li.productType?.toUpperCase()).filter(Boolean),
      ...salesByType.keys(),
    ]);

    for (const productType of allTypes) {
      if (!productType) continue;

      const purchaseData = lineItemsByType.find(li => li.productType?.toUpperCase() === productType);
      const salesData = salesByType.get(productType);

      const purchaseCost = Number(purchaseData?._sum.totalCost || 0);
      const unitsPurchased = purchaseData?._sum.skuUnits || 0;
      const salesRevenue = salesData?.revenue || 0;
      const salesMargin = salesData?.count ? salesData.margin / salesData.count : 0;
      const pctOfTotal = salesData?.count ? salesData.pctTotal / salesData.count : 0;

      results.push({
        productType,
        purchaseCost,
        unitsPurchased,
        avgPurchasePrice: unitsPurchased > 0 ? purchaseCost / unitsPurchased : 0,
        salesRevenue,
        salesMarginPct: salesMargin,
        pctOfTotalSales: pctOfTotal,
        markupRatio: purchaseCost > 0 ? salesRevenue / purchaseCost : 0,
        inventoryTurnoverIndicator: purchaseCost > 0 ? salesRevenue / purchaseCost : 0,
      });
    }

    return results.sort((a, b) => b.salesRevenue - a.salesRevenue);
  }

  /**
   * Customer Segment Metrics
   */
  async getCustomerSegmentMetrics(): Promise<CustomerSegmentMetrics[]> {
    const customers = await prisma.customer.findMany({
      select: {
        customerSegment: true,
        recencySegment: true,
        lifetimeNetSales: true,
        lifetimeVisits: true,
        lifetimeAov: true,
      },
    });

    const segmentMap = new Map<string, CustomerSegmentMetrics>();

    for (const customer of customers) {
      const segment = customer.customerSegment || 'Unknown';
      const existing = segmentMap.get(segment) || {
        segment,
        customerCount: 0,
        totalLifetimeSales: 0,
        avgLifetimeValue: 0,
        avgVisits: 0,
        avgOrderValue: 0,
        activeCount: 0,
        atRiskCount: 0,
        lapsedCount: 0,
      };

      existing.customerCount++;
      existing.totalLifetimeSales += Number(customer.lifetimeNetSales);
      existing.avgVisits = (existing.avgVisits * (existing.customerCount - 1) + customer.lifetimeVisits) / existing.customerCount;
      existing.avgOrderValue = (existing.avgOrderValue * (existing.customerCount - 1) + Number(customer.lifetimeAov)) / existing.customerCount;

      // Count recency segments
      const recency = customer.recencySegment?.toLowerCase() || '';
      if (recency.includes('active')) existing.activeCount++;
      else if (recency.includes('risk')) existing.atRiskCount++;
      else if (recency.includes('lapsed')) existing.lapsedCount++;

      segmentMap.set(segment, existing);
    }

    // Calculate averages
    for (const metrics of segmentMap.values()) {
      metrics.avgLifetimeValue = metrics.customerCount > 0
        ? metrics.totalLifetimeSales / metrics.customerCount
        : 0;
    }

    return Array.from(segmentMap.values()).sort((a, b) => b.customerCount - a.customerCount);
  }

  /**
   * Vendor Performance Analysis
   */
  async getVendorPerformance(startDate: Date): Promise<VendorPerformance[]> {
    const vendors = await prisma.vendor.findMany({
      include: {
        invoices: {
          where: { invoiceDate: { gte: startDate } },
          select: {
            invoiceDate: true,
            totalCost: true,
            lineItems: {
              select: {
                productType: true,
                skuUnits: true,
              },
            },
          },
        },
        vendorBrands: {
          include: { brand: true },
        },
      },
    });

    const results: VendorPerformance[] = [];

    for (const vendor of vendors) {
      if (vendor.invoices.length === 0) continue;

      const totalInvoices = vendor.invoices.length;
      const totalPurchaseCost = vendor.invoices.reduce((sum, inv) => sum + Number(inv.totalCost), 0);
      const totalUnits = vendor.invoices.reduce(
        (sum, inv) => sum + inv.lineItems.reduce((s, li) => s + li.skuUnits, 0),
        0
      );

      const productTypes = new Set<string>();
      vendor.invoices.forEach(inv => {
        inv.lineItems.forEach(li => {
          if (li.productType) productTypes.add(li.productType.toUpperCase());
        });
      });

      const invoiceDates = vendor.invoices
        .map(inv => inv.invoiceDate)
        .filter(Boolean)
        .sort((a, b) => a!.getTime() - b!.getTime());

      let avgDaysBetween = 0;
      if (invoiceDates.length > 1) {
        const firstDate = invoiceDates[0]!;
        const lastDate = invoiceDates[invoiceDates.length - 1]!;
        const daysDiff = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
        avgDaysBetween = daysDiff / (invoiceDates.length - 1);
      }

      results.push({
        vendorName: vendor.canonicalName,
        vendorId: vendor.id,
        totalInvoices,
        totalPurchaseCost,
        totalUnits,
        avgInvoiceValue: totalInvoices > 0 ? totalPurchaseCost / totalInvoices : 0,
        brandsSupplied: vendor.vendorBrands.map(vb => vb.brand.canonicalName),
        brandCount: vendor.vendorBrands.length,
        productTypesSupplied: Array.from(productTypes),
        firstInvoiceDate: invoiceDates[0] || null,
        lastInvoiceDate: invoiceDates[invoiceDates.length - 1] || null,
        avgDaysBetweenOrders: avgDaysBetween,
      });
    }

    return results.sort((a, b) => b.totalPurchaseCost - a.totalPurchaseCost);
  }

  /**
   * Date-based correlations: Sales + Regulatory + News
   */
  async getDateCorrelations(startDate: Date): Promise<DateCorrelation[]> {
    const [salesData, invoiceData, regulatoryEvents, feedItems] = await Promise.all([
      prisma.salesRecord.findMany({
        where: { date: { gte: startDate } },
        orderBy: { date: 'asc' },
      }),
      prisma.invoice.findMany({
        where: { invoiceDate: { gte: startDate } },
        select: { invoiceDate: true, totalCost: true },
      }),
      prisma.regulatoryEvent.findMany({
        where: {
          eventDate: { gte: startDate },
          isActive: true,
        },
        select: { eventDate: true, title: true, impactLevel: true, eventType: true },
      }),
      prisma.externalFeedItem.findMany({
        where: {
          publishedAt: { gte: startDate },
          relevanceScore: { gte: 0.5 },
        },
        select: { publishedAt: true, title: true, relevanceScore: true },
        orderBy: { relevanceScore: 'desc' },
        take: 100,
      }),
    ]);

    const dateMap = new Map<string, DateCorrelation>();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Initialize with sales data
    for (const sale of salesData) {
      const dateStr = sale.date.toISOString().split('T')[0];
      const existing = dateMap.get(dateStr) || {
        date: dateStr,
        dayOfWeek: dayNames[sale.date.getDay()],
        dailySales: 0,
        dailyCustomers: 0,
        dailyTickets: 0,
        purchasingCost: 0,
        invoicesReceived: 0,
        regulatoryEvents: [],
        newsItems: [],
      };

      existing.dailySales += Number(sale.netSales);
      existing.dailyCustomers += sale.customersCount;
      existing.dailyTickets += sale.ticketsCount;
      dateMap.set(dateStr, existing);
    }

    // Add invoice data
    for (const inv of invoiceData) {
      if (!inv.invoiceDate) continue;
      const dateStr = inv.invoiceDate.toISOString().split('T')[0];
      const existing = dateMap.get(dateStr);
      if (existing) {
        existing.invoicesReceived++;
        existing.purchasingCost += Number(inv.totalCost);
      }
    }

    // Add regulatory events
    for (const event of regulatoryEvents) {
      const dateStr = event.eventDate.toISOString().split('T')[0];
      const existing = dateMap.get(dateStr);
      if (existing) {
        existing.regulatoryEvents.push({
          title: event.title,
          impactLevel: event.impactLevel,
          eventType: event.eventType,
        });
      }
    }

    // Add news items
    for (const item of feedItems) {
      const dateStr = item.publishedAt.toISOString().split('T')[0];
      const existing = dateMap.get(dateStr);
      if (existing) {
        existing.newsItems.push({
          title: item.title,
          relevance: item.relevanceScore || 0,
        });
      }
    }

    return Array.from(dateMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Knowledge Graph by Category
   */
  async getKnowledgeGraphByCategory(): Promise<Record<string, KnowledgeGraphEntry[]>> {
    const [insights, questions, rules, research] = await Promise.all([
      prisma.businessInsight.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.learningQuestion.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.businessRule.findMany({
        where: { isActive: true },
        orderBy: { priority: 'desc' },
        take: 30,
      }),
      prisma.researchFinding.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    const graph: Record<string, KnowledgeGraphEntry[]> = {};

    // Process insights
    for (const insight of insights) {
      const cat = insight.category || 'general';
      if (!graph[cat]) graph[cat] = [];
      graph[cat].push({
        type: 'insight',
        category: cat,
        content: insight.insight,
        confidence: insight.confidence,
        createdAt: insight.createdAt,
        source: insight.source,
      });
    }

    // Process questions
    for (const question of questions) {
      const cat = question.category || 'general';
      if (!graph[cat]) graph[cat] = [];
      graph[cat].push({
        type: 'question',
        category: cat,
        content: question.question,
        confidence: question.answerQuality ? (question.answerQuality > 0.7 ? 'high' : 'medium') : 'unknown',
        createdAt: question.createdAt,
      });
    }

    // Process rules
    for (const rule of rules) {
      const cat = rule.category || 'general';
      if (!graph[cat]) graph[cat] = [];
      graph[cat].push({
        type: 'rule',
        category: cat,
        content: rule.rule,
        confidence: rule.priority >= 7 ? 'high' : rule.priority >= 4 ? 'medium' : 'low',
        createdAt: rule.createdAt,
      });
    }

    // Process research
    for (const finding of research) {
      const cat = finding.category || 'general';
      if (!graph[cat]) graph[cat] = [];
      graph[cat].push({
        type: 'research',
        category: cat,
        content: finding.finding,
        confidence: finding.relevance,
        createdAt: finding.createdAt,
      });
    }

    return graph;
  }

  /**
   * Get a text summary suitable for AI prompts
   */
  async getCorrelationSummaryForAI(): Promise<string> {
    const correlations = await this.getAllCorrelations();

    const sections: string[] = [];

    // Summary section
    sections.push(`## CROSS-TABLE CORRELATION SUMMARY
Analysis Period: ${correlations.summary.dateRangeStart} to ${correlations.summary.dateRangeEnd}
Brands Analyzed: ${correlations.summary.totalBrandsAnalyzed}
Vendors Analyzed: ${correlations.summary.totalVendorsAnalyzed}
Top Performing Brand: ${correlations.summary.topPerformingBrand || 'N/A'}
Top Vendor: ${correlations.summary.topVendor || 'N/A'}
Most Profitable Category: ${correlations.summary.mostProfitableCategory || 'N/A'}
Largest Customer Segment: ${correlations.summary.largestCustomerSegment || 'N/A'}`);

    // Brand profitability insights
    if (correlations.brandProfitability.length > 0) {
      const topBrands = correlations.brandProfitability.slice(0, 10);
      sections.push(`## BRAND PROFITABILITY (Top 10)
${topBrands.map((b, i) =>
  `${i + 1}. ${b.brandName}: Purchased $${b.totalPurchaseCost.toFixed(0)}, Sold $${b.totalNetSales.toFixed(0)}, ` +
  `Markup ${b.markupRatio.toFixed(2)}x, Margin ${b.profitMarginPct.toFixed(1)}%` +
  `${b.vendors.length > 0 ? ` (via ${b.vendors.slice(0, 2).join(', ')})` : ''}`
).join('\n')}`);
    }

    // Product category flow
    if (correlations.productCategoryFlow.length > 0) {
      sections.push(`## PRODUCT CATEGORY FLOW
${correlations.productCategoryFlow.slice(0, 8).map(c =>
  `${c.productType}: Purchase $${c.purchaseCost.toFixed(0)} → Sales $${c.salesRevenue.toFixed(0)} ` +
  `(${c.markupRatio.toFixed(2)}x markup, ${c.pctOfTotalSales.toFixed(1)}% of sales)`
).join('\n')}`);
    }

    // Customer segments
    if (correlations.customerSegments.length > 0) {
      sections.push(`## CUSTOMER SEGMENTS
${correlations.customerSegments.map(s =>
  `${s.segment}: ${s.customerCount} customers, $${s.avgLifetimeValue.toFixed(0)} avg LTV, ` +
  `${s.avgVisits.toFixed(1)} avg visits (${s.activeCount} active, ${s.atRiskCount} at risk, ${s.lapsedCount} lapsed)`
).join('\n')}`);
    }

    // Vendor performance
    if (correlations.vendorPerformance.length > 0) {
      const topVendors = correlations.vendorPerformance.slice(0, 8);
      sections.push(`## VENDOR PERFORMANCE (Top 8)
${topVendors.map((v, i) =>
  `${i + 1}. ${v.vendorName}: ${v.totalInvoices} invoices, $${v.totalPurchaseCost.toFixed(0)} total, ` +
  `${v.brandCount} brands, ${v.avgDaysBetweenOrders.toFixed(0)} days between orders`
).join('\n')}`);
    }

    // Knowledge graph summary
    const knowledgeCategories = Object.keys(correlations.knowledgeGraph);
    if (knowledgeCategories.length > 0) {
      sections.push(`## KNOWLEDGE BASE BY CATEGORY
${knowledgeCategories.map(cat => {
  const entries = correlations.knowledgeGraph[cat];
  const insights = entries.filter(e => e.type === 'insight').length;
  const questions = entries.filter(e => e.type === 'question').length;
  const rules = entries.filter(e => e.type === 'rule').length;
  return `${cat}: ${insights} insights, ${questions} questions, ${rules} rules`;
}).join('\n')}`);
    }

    // Recent date correlations with events
    const datesWithEvents = correlations.dateCorrelations
      .filter(d => d.regulatoryEvents.length > 0 || d.newsItems.length > 0)
      .slice(0, 5);
    if (datesWithEvents.length > 0) {
      sections.push(`## DATES WITH REGULATORY/NEWS EVENTS
${datesWithEvents.map(d =>
  `${d.date} (${d.dayOfWeek}): Sales $${d.dailySales.toFixed(0)}` +
  `${d.regulatoryEvents.length > 0 ? ` | Regulatory: ${d.regulatoryEvents.map(e => e.title).join('; ')}` : ''}` +
  `${d.newsItems.length > 0 ? ` | News: ${d.newsItems.slice(0, 2).map(n => n.title).join('; ')}` : ''}`
).join('\n')}`);
    }

    return sections.join('\n\n');
  }
}

// Singleton instance
export const dataCorrelationsService = new DataCorrelationsService();
