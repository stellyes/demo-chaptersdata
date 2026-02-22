// ============================================
// BUYER'S INSIGHT INVESTIGATION API ROUTE
// Deep dive investigation into purchasing insights
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getRelevantInsights } from '@/lib/services/knowledge-base';
import { prisma } from '@/lib/prisma';

// Extend function timeout for investigation analysis
export const maxDuration = 120;

const anthropic = new Anthropic();

interface InvestigationRequest {
  insightId?: string;
  insight: string;
  category: string;
  additionalContext?: string;
}

export async function POST(request: NextRequest) {
  // Parse & validate synchronously so we can still return 400.
  let body: InvestigationRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { insightId, insight, category, additionalContext } = body;

  if (!insight) {
    return NextResponse.json(
      { success: false, error: 'Insight text is required' },
      { status: 400 }
    );
  }

  // Use a TransformStream so we can write the SSE comment *immediately*
  // before doing any slow I/O.  The readable side is handed to the Response
  // and the writable side is consumed by our background async function.
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Fire-and-forget: all slow work runs in the background.
  (async () => {
    let fullText = '';

    try {
      // SSE comment — first byte for CloudFront, keeps connection alive.
      await writer.write(encoder.encode(': connected\n\n'));

      // Gather data in parallel
      const [relatedInsights, purchasingContext] = await Promise.all([
        getRelevantInsights({
          categories: ['purchasing', 'vendors', 'inventory', 'brands', category],
          limit: 20,
        }),
        getPurchasingDataContext(),
      ]);

      const contextInsights = relatedInsights
        .filter(i => i.id !== insightId)
        .map(i => `- [${i.confidence}] ${i.insight}`)
        .join('\n');

      const systemPrompt = `You are a senior procurement analyst specializing in cannabis retail purchasing and vendor management.
Your task is to conduct a deep investigation into a specific purchasing insight to provide actionable recommendations.

You have access to:
1. The specific insight to investigate
2. Related insights from the Progressive Learning system
3. Current vendor, invoice, and purchasing data
4. Any additional context provided by the user

Your investigation should:
1. Validate whether the insight is still accurate based on current data
2. Identify root causes and contributing factors
3. Quantify the financial impact where possible
4. Provide specific, actionable recommendations for procurement
5. Suggest vendor negotiation strategies where applicable
6. Identify any supply chain risks or opportunities

Format your response with clear sections using markdown headers.`;

      const userPrompt = `## Insight to Investigate
**Category:** ${category}
**Insight:** ${insight}

${additionalContext ? `## Additional Context from User\n${additionalContext}\n` : ''}

## Related Insights from Progressive Learning
${contextInsights || 'No related insights available.'}

## Current Purchasing Data

${purchasingContext}

---

Please conduct a thorough investigation of this purchasing insight and provide:

1. **Validation Analysis** - Is this insight still accurate? What evidence supports or contradicts it?

2. **Root Cause Analysis** - What are the underlying factors driving this observation?

3. **Financial Impact Assessment** - What is the estimated cost impact? (savings opportunities, risk exposure, etc.)

4. **Vendor Strategy Recommendations** - How should we adjust vendor relationships?

5. **Actionable Next Steps** - Provide 3-5 specific procurement actions, prioritized by impact

6. **Negotiation Talking Points** - Key points for vendor discussions

7. **Risk Mitigation** - What supply chain risks exist and how to address them?

8. **KPIs to Track** - What metrics should be monitored going forward?`;

      // Stream the Anthropic response
      const stream = anthropic.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`));
        }
      }

      const finalMessage = await stream.finalMessage();
      const tokensUsed = finalMessage.usage.input_tokens + finalMessage.usage.output_tokens;

      const savedAnalysis = await prisma.analysisHistory.create({
        data: {
          analysisType: 'buyer-investigation',
          inputSummary: insight.slice(0, 500),
          outputSummary: fullText,
          insightsCount: 1,
          tokensUsed,
          model: 'claude-sonnet-4-20250514',
        },
      });

      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: 'done',
        investigationId: savedAnalysis.id,
        insightId,
        category,
        tokensUsed,
      })}\n\n`));

      await writer.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream failed';
      console.error('Buyer investigation stream error:', message);
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`));
        await writer.close();
      } catch {
        // writer may already be closed/errored
        writer.abort().catch(() => {});
      }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function getPurchasingDataContext(): Promise<string> {
  const sections: string[] = [];

  // Vendor summary
  try {
    const vendors = await prisma.vendor.findMany({
      include: {
        invoices: {
          select: { totalCost: true, invoiceDate: true },
          orderBy: { invoiceDate: 'desc' },
          take: 10,
        },
        vendorBrands: { select: { brandId: true } },
      },
      take: 50,
    });

    const vendorStats = vendors
      .map(v => ({
        name: v.canonicalName,
        invoiceCount: v.invoices.length,
        totalSpend: v.invoices.reduce((sum, inv) => sum + Number(inv.totalCost || 0), 0),
        brandCount: v.vendorBrands.length,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 15);

    const vendorList = vendorStats
      .map(v => `- ${v.name}: $${v.totalSpend.toLocaleString()} (${v.invoiceCount} invoices, ${v.brandCount} brands)`)
      .join('\n');

    sections.push(`### Top Vendors by Spend\n${vendorList}`);
  } catch (error) {
    console.error('Error fetching vendor stats:', error);
    sections.push('### Vendor Data\nUnable to fetch vendor statistics.');
  }

  // Category breakdown
  try {
    const categoryStats = await prisma.invoiceLineItem.groupBy({
      by: ['productType'],
      _sum: { totalCost: true, skuUnits: true },
      _avg: { unitCost: true },
    });

    const categoryList = categoryStats
      .filter(c => c.productType)
      .sort((a, b) => Number(b._sum.totalCost || 0) - Number(a._sum.totalCost || 0))
      .slice(0, 10)
      .map(c => `- ${c.productType}: $${Number(c._sum.totalCost || 0).toLocaleString()} (${c._sum.skuUnits || 0} units, avg $${Number(c._avg.unitCost || 0).toFixed(2)}/unit)`)
      .join('\n');

    sections.push(`### Category Spend Breakdown\n${categoryList}`);
  } catch (error) {
    console.error('Error fetching category stats:', error);
    sections.push('### Category Data\nUnable to fetch category statistics.');
  }

  // Recent invoice trends
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const recentInvoices = await prisma.invoice.findMany({
      where: { invoiceDate: { gte: threeMonthsAgo } },
      select: { totalCost: true, invoiceDate: true },
    });

    const totalSpend = recentInvoices.reduce((sum, inv) => sum + Number(inv.totalCost || 0), 0);
    const avgInvoice = recentInvoices.length > 0 ? totalSpend / recentInvoices.length : 0;

    sections.push(`### Recent Invoice Summary (Last 3 Months)
- Total Invoices: ${recentInvoices.length}
- Total Spend: $${totalSpend.toLocaleString()}
- Average Invoice: $${avgInvoice.toLocaleString()}`);
  } catch (error) {
    console.error('Error fetching invoice trends:', error);
    sections.push('### Invoice Data\nUnable to fetch invoice statistics.');
  }

  // Brand-vendor relationships
  try {
    const vendorBrands = await prisma.vendorBrand.findMany({
      include: {
        vendor: { select: { canonicalName: true } },
        brand: { select: { canonicalName: true } },
      },
      orderBy: { totalCost: 'desc' },
      take: 20,
    });

    const brandList = vendorBrands
      .map(vb => `- ${vb.brand.canonicalName} via ${vb.vendor.canonicalName}: $${Number(vb.totalCost).toLocaleString()} (${vb.totalUnits} units)`)
      .join('\n');

    sections.push(`### Top Brand-Vendor Relationships\n${brandList}`);
  } catch (error) {
    console.error('Error fetching brand-vendor stats:', error);
    sections.push('### Brand-Vendor Data\nUnable to fetch brand-vendor statistics.');
  }

  return sections.join('\n\n');
}
