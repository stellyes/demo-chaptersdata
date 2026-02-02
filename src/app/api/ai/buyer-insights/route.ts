// ============================================
// BUYER'S INSIGHTS API ROUTE
// Analyze purchasing data for procurement insights
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || 'all';

    // Gather comprehensive purchasing data
    const [
      vendorStats,
      categoryStats,
      recentInvoices,
      brandVendorStats,
      purchaseTrends,
    ] = await Promise.all([
      getVendorStats(),
      getCategoryStats(),
      getRecentInvoices(),
      getBrandVendorStats(),
      getPurchaseTrends(),
    ]);

    // Generate insights from the data
    const insights = generateBuyerInsights({
      vendorStats,
      categoryStats,
      recentInvoices,
      brandVendorStats,
      purchaseTrends,
    });

    // Filter by category if specified
    const filteredInsights = category === 'all'
      ? insights
      : insights.filter(i => i.category === category);

    return NextResponse.json({
      success: true,
      data: {
        insights: filteredInsights,
        summary: {
          totalVendors: vendorStats.length,
          totalInvoices: recentInvoices.totalCount,
          totalSpend: recentInvoices.totalSpend,
          topCategories: categoryStats.slice(0, 5),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching buyer insights:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch buyer insights' },
      { status: 500 }
    );
  }
}

interface VendorStat {
  vendorId: string;
  vendorName: string;
  invoiceCount: number;
  totalSpend: number;
  avgInvoiceValue: number;
  brandCount: number;
  lastInvoiceDate: Date | null;
}

async function getVendorStats(): Promise<VendorStat[]> {
  const vendors = await prisma.vendor.findMany({
    include: {
      invoices: {
        select: {
          totalCost: true,
          invoiceDate: true,
        },
        orderBy: { invoiceDate: 'desc' },
      },
      vendorBrands: {
        select: { brandId: true },
      },
    },
  });

  return vendors.map(v => ({
    vendorId: v.id,
    vendorName: v.canonicalName,
    invoiceCount: v.invoices.length,
    totalSpend: v.invoices.reduce((sum, inv) => sum + Number(inv.totalCost || 0), 0),
    avgInvoiceValue: v.invoices.length > 0
      ? v.invoices.reduce((sum, inv) => sum + Number(inv.totalCost || 0), 0) / v.invoices.length
      : 0,
    brandCount: v.vendorBrands.length,
    lastInvoiceDate: v.invoices[0]?.invoiceDate || null,
  })).sort((a, b) => b.totalSpend - a.totalSpend);
}

interface CategoryStat {
  category: string;
  totalUnits: number;
  totalCost: number;
  avgUnitCost: number;
  invoiceCount: number;
}

async function getCategoryStats(): Promise<CategoryStat[]> {
  const lineItems = await prisma.invoiceLineItem.groupBy({
    by: ['productType'],
    _sum: {
      skuUnits: true,
      totalCost: true,
    },
    _count: {
      invoiceId: true,
    },
    _avg: {
      unitCost: true,
    },
  });

  return lineItems
    .filter(item => item.productType)
    .map(item => ({
      category: item.productType || 'Unknown',
      totalUnits: item._sum.skuUnits || 0,
      totalCost: Number(item._sum.totalCost || 0),
      avgUnitCost: Number(item._avg.unitCost || 0),
      invoiceCount: item._count.invoiceId,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);
}

interface RecentInvoiceSummary {
  totalCount: number;
  totalSpend: number;
  avgInvoiceValue: number;
  invoicesByMonth: { month: string; count: number; spend: number }[];
}

async function getRecentInvoices(): Promise<RecentInvoiceSummary> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const invoices = await prisma.invoice.findMany({
    where: {
      invoiceDate: { gte: sixMonthsAgo },
    },
    select: {
      totalCost: true,
      invoiceDate: true,
    },
  });

  const totalSpend = invoices.reduce((sum, inv) => sum + Number(inv.totalCost || 0), 0);

  // Group by month
  const byMonth = invoices.reduce((acc: Record<string, { count: number; spend: number }>, inv) => {
    if (inv.invoiceDate) {
      const month = inv.invoiceDate.toISOString().slice(0, 7); // YYYY-MM
      if (!acc[month]) acc[month] = { count: 0, spend: 0 };
      acc[month].count++;
      acc[month].spend += Number(inv.totalCost || 0);
    }
    return acc;
  }, {});

  return {
    totalCount: invoices.length,
    totalSpend,
    avgInvoiceValue: invoices.length > 0 ? totalSpend / invoices.length : 0,
    invoicesByMonth: Object.entries(byMonth)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

interface BrandVendorStat {
  brandName: string;
  vendorName: string;
  invoiceCount: number;
  totalUnits: number;
  totalCost: number;
  avgUnitCost: number;
}

async function getBrandVendorStats(): Promise<BrandVendorStat[]> {
  const vendorBrands = await prisma.vendorBrand.findMany({
    include: {
      vendor: { select: { canonicalName: true } },
      brand: { select: { canonicalName: true } },
    },
    orderBy: { totalCost: 'desc' },
    take: 100,
  });

  return vendorBrands.map(vb => ({
    brandName: vb.brand.canonicalName,
    vendorName: vb.vendor.canonicalName,
    invoiceCount: vb.invoiceCount,
    totalUnits: vb.totalUnits,
    totalCost: Number(vb.totalCost),
    avgUnitCost: vb.totalUnits > 0 ? Number(vb.totalCost) / vb.totalUnits : 0,
  }));
}

interface PurchaseTrend {
  period: string;
  totalSpend: number;
  invoiceCount: number;
  topCategory: string;
  topVendor: string;
}

async function getPurchaseTrends(): Promise<PurchaseTrend[]> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const invoices = await prisma.invoice.findMany({
    where: {
      invoiceDate: { gte: sixMonthsAgo },
    },
    include: {
      vendor: { select: { canonicalName: true } },
      lineItems: { select: { productType: true, totalCost: true } },
    },
  });

  // Group by month
  const byMonth: Record<string, {
    spend: number;
    count: number;
    categories: Record<string, number>;
    vendors: Record<string, number>;
  }> = {};

  for (const inv of invoices) {
    if (!inv.invoiceDate) continue;
    const month = inv.invoiceDate.toISOString().slice(0, 7);
    if (!byMonth[month]) {
      byMonth[month] = { spend: 0, count: 0, categories: {}, vendors: {} };
    }
    byMonth[month].spend += Number(inv.totalCost || 0);
    byMonth[month].count++;

    if (inv.vendor?.canonicalName) {
      byMonth[month].vendors[inv.vendor.canonicalName] =
        (byMonth[month].vendors[inv.vendor.canonicalName] || 0) + Number(inv.totalCost || 0);
    }

    for (const item of inv.lineItems) {
      if (item.productType) {
        byMonth[month].categories[item.productType] =
          (byMonth[month].categories[item.productType] || 0) + Number(item.totalCost || 0);
      }
    }
  }

  return Object.entries(byMonth)
    .map(([period, data]) => {
      const topCategory = Object.entries(data.categories)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
      const topVendor = Object.entries(data.vendors)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
      return {
        period,
        totalSpend: data.spend,
        invoiceCount: data.count,
        topCategory,
        topVendor,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}

interface BuyerInsight {
  id: string;
  category: 'vendor' | 'pricing' | 'category' | 'trend' | 'opportunity';
  title: string;
  insight: string;
  impact: 'high' | 'medium' | 'low';
  data: Record<string, unknown>;
  createdAt: string;
}

function generateBuyerInsights(data: {
  vendorStats: VendorStat[];
  categoryStats: CategoryStat[];
  recentInvoices: RecentInvoiceSummary;
  brandVendorStats: BrandVendorStat[];
  purchaseTrends: PurchaseTrend[];
}): BuyerInsight[] {
  const insights: BuyerInsight[] = [];
  const now = new Date().toISOString();

  // Vendor concentration insights
  const topVendors = data.vendorStats.slice(0, 5);
  const totalSpend = data.vendorStats.reduce((sum, v) => sum + v.totalSpend, 0);
  const top3Concentration = topVendors.slice(0, 3).reduce((sum, v) => sum + v.totalSpend, 0) / totalSpend;

  if (top3Concentration > 0.6) {
    insights.push({
      id: `vendor-concentration-${Date.now()}`,
      category: 'vendor',
      title: 'High Vendor Concentration Risk',
      insight: `Top 3 vendors account for ${(top3Concentration * 100).toFixed(0)}% of total spend ($${topVendors.slice(0, 3).reduce((sum, v) => sum + v.totalSpend, 0).toLocaleString()}). Consider diversifying supplier base to reduce risk.`,
      impact: 'high',
      data: { topVendors: topVendors.slice(0, 3).map(v => ({ name: v.vendorName, spend: v.totalSpend })) },
      createdAt: now,
    });
  }

  // Inactive vendor opportunities
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const inactiveVendors = data.vendorStats.filter(v =>
    v.lastInvoiceDate && v.lastInvoiceDate < threeMonthsAgo && v.totalSpend > 5000
  );

  if (inactiveVendors.length > 0) {
    insights.push({
      id: `inactive-vendors-${Date.now()}`,
      category: 'vendor',
      title: 'Previously Active Vendors Now Dormant',
      insight: `${inactiveVendors.length} vendor(s) with significant past spend (>${'$5,000'}) haven't had orders in 3+ months. Review if relationships should be reactivated.`,
      impact: 'medium',
      data: { vendors: inactiveVendors.slice(0, 5).map(v => ({ name: v.vendorName, lastSpend: v.totalSpend })) },
      createdAt: now,
    });
  }

  // Category mix insights
  const topCategories = data.categoryStats.slice(0, 3);
  const categoryTotal = data.categoryStats.reduce((sum, c) => sum + c.totalCost, 0);
  if (topCategories.length > 0 && categoryTotal > 0) {
    const topCatShare = topCategories[0].totalCost / categoryTotal;
    if (topCatShare > 0.4) {
      insights.push({
        id: `category-concentration-${Date.now()}`,
        category: 'category',
        title: `${topCategories[0].category} Dominates Purchasing`,
        insight: `${topCategories[0].category} represents ${(topCatShare * 100).toFixed(0)}% of total purchasing. Ensure inventory mix aligns with sales demand across all categories.`,
        impact: 'medium',
        data: { category: topCategories[0].category, share: topCatShare, spend: topCategories[0].totalCost },
        createdAt: now,
      });
    }
  }

  // Pricing variance insights
  const brandsWithMultipleVendors = new Map<string, BrandVendorStat[]>();
  for (const bv of data.brandVendorStats) {
    if (!brandsWithMultipleVendors.has(bv.brandName)) {
      brandsWithMultipleVendors.set(bv.brandName, []);
    }
    brandsWithMultipleVendors.get(bv.brandName)!.push(bv);
  }

  for (const [brand, vendors] of brandsWithMultipleVendors) {
    if (vendors.length >= 2) {
      const costs = vendors.map(v => v.avgUnitCost).filter(c => c > 0);
      if (costs.length >= 2) {
        const minCost = Math.min(...costs);
        const maxCost = Math.max(...costs);
        const variance = (maxCost - minCost) / minCost;
        if (variance > 0.15) {
          insights.push({
            id: `price-variance-${brand}-${Date.now()}`,
            category: 'pricing',
            title: `Price Variance: ${brand}`,
            insight: `${brand} shows ${(variance * 100).toFixed(0)}% price variance across vendors. Low: $${minCost.toFixed(2)}, High: $${maxCost.toFixed(2)}. Consolidate with lower-cost vendor.`,
            impact: variance > 0.25 ? 'high' : 'medium',
            data: { brand, vendors: vendors.map(v => ({ vendor: v.vendorName, avgCost: v.avgUnitCost })) },
            createdAt: now,
          });
        }
      }
    }
  }

  // Spending trend insights
  if (data.purchaseTrends.length >= 2) {
    const recent = data.purchaseTrends[data.purchaseTrends.length - 1];
    const previous = data.purchaseTrends[data.purchaseTrends.length - 2];
    const spendChange = (recent.totalSpend - previous.totalSpend) / previous.totalSpend;

    if (Math.abs(spendChange) > 0.2) {
      insights.push({
        id: `spend-trend-${Date.now()}`,
        category: 'trend',
        title: `Purchasing ${spendChange > 0 ? 'Increased' : 'Decreased'} Significantly`,
        insight: `Month-over-month purchasing ${spendChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(spendChange * 100).toFixed(0)}% ($${Math.abs(recent.totalSpend - previous.totalSpend).toLocaleString()}). Review if aligned with sales forecasts.`,
        impact: Math.abs(spendChange) > 0.3 ? 'high' : 'medium',
        data: { current: recent.totalSpend, previous: previous.totalSpend, change: spendChange },
        createdAt: now,
      });
    }
  }

  // High-value single-source brands
  const singleSourceBrands = Array.from(brandsWithMultipleVendors.entries())
    .filter(([, vendors]) => vendors.length === 1 && vendors[0].totalCost > 10000)
    .map(([brand, vendors]) => ({ brand, vendor: vendors[0].vendorName, spend: vendors[0].totalCost }));

  if (singleSourceBrands.length > 0) {
    insights.push({
      id: `single-source-risk-${Date.now()}`,
      category: 'opportunity',
      title: 'Single-Source Brand Dependencies',
      insight: `${singleSourceBrands.length} high-value brand(s) (>${'$10,000'} spend) have only one vendor. Consider identifying backup suppliers.`,
      impact: 'medium',
      data: { brands: singleSourceBrands.slice(0, 5) },
      createdAt: now,
    });
  }

  // Low invoice frequency high-value vendors
  const lowFreqHighValue = data.vendorStats.filter(v =>
    v.invoiceCount < 5 && v.avgInvoiceValue > 5000
  );
  if (lowFreqHighValue.length > 0) {
    insights.push({
      id: `bulk-order-opportunity-${Date.now()}`,
      category: 'opportunity',
      title: 'Potential Bulk Order Savings',
      insight: `${lowFreqHighValue.length} vendor(s) have high average invoice values (>${'$5,000'}) but low order frequency. Negotiate volume discounts or optimize order timing.`,
      impact: 'medium',
      data: { vendors: lowFreqHighValue.slice(0, 5).map(v => ({ name: v.vendorName, avgInvoice: v.avgInvoiceValue })) },
      createdAt: now,
    });
  }

  return insights.sort((a, b) => {
    const impactOrder = { high: 0, medium: 1, low: 2 };
    return impactOrder[a.impact] - impactOrder[b.impact];
  });
}
