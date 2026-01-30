// ============================================
// MONTHLY OPUS STRATEGIC ANALYSIS SERVICE
// Deep strategic analysis using Claude Opus
// Runs once per month for comprehensive review
// ============================================

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { getAnthropicClient } from './claude';

const OPUS_MODEL = 'claude-opus-4-20250514';

export const MONTHLY_ANALYSIS_CONFIG = {
  phase1TokenBudget: 16000,  // Data aggregation
  phase2TokenBudget: 32000,  // Trend analysis
  phase3TokenBudget: 32000,  // Strategy generation
  phase4TokenBudget: 24000,  // Report generation
};

interface MonthlyAnalysisJobState {
  jobId: string;
  monthYear: string;
  inputTokens: number;
  outputTokens: number;
}

interface AggregatedData {
  salesSummary: {
    totalRevenue: number;
    totalTransactions: number;
    avgDailySales: number;
    topDays: Array<{ date: string; revenue: number }>;
    bottomDays: Array<{ date: string; revenue: number }>;
    growthVsPriorMonth: number | null;
  };
  brandPerformance: Array<{
    brand: string;
    revenue: number;
    margin: number;
    trend: string;
  }>;
  customerMetrics: {
    totalCustomers: number;
    activeCustomers: number;
    newCustomers: number;
    churnedCustomers: number;
    avgLifetimeValue: number;
  };
  dailyDigests: Array<{
    date: string;
    summary: string;
    priorityActions: number;
    insights: number;
  }>;
  webResearchHighlights: string[];
}

interface TrendAnalysis {
  salesTrends: Array<{
    trend: string;
    direction: 'up' | 'down' | 'stable';
    confidence: number;
    implication: string;
  }>;
  customerTrends: Array<{
    trend: string;
    direction: 'up' | 'down' | 'stable';
    confidence: number;
    implication: string;
  }>;
  brandTrends: Array<{
    brand: string;
    trend: string;
    recommendation: string;
  }>;
  marketTrends: Array<{
    trend: string;
    source: string;
    relevance: string;
    actionRequired: boolean;
  }>;
}

interface StrategicRecommendations {
  swot: {
    strengths: Array<{ point: string; evidence: string }>;
    weaknesses: Array<{ point: string; evidence: string }>;
    opportunities: Array<{ point: string; evidence: string }>;
    threats: Array<{ point: string; evidence: string }>;
  };
  priorities: Array<{
    priority: string;
    rationale: string;
    timeline: string;
    resources: string;
    expectedOutcome: string;
  }>;
  quarterlyGoals: Array<{
    goal: string;
    metric: string;
    target: string;
    deadline: string;
  }>;
  resourceAllocations: Array<{
    area: string;
    currentAllocation: string;
    recommendedAllocation: string;
    rationale: string;
  }>;
  riskMitigations: Array<{
    risk: string;
    probability: 'high' | 'medium' | 'low';
    impact: 'high' | 'medium' | 'low';
    mitigation: string;
  }>;
}

interface MonthlyReportContent {
  executiveSummary: string;
  performanceGrade: string;
  monthOverMonthChange: Record<string, number>;
  strengthsAnalysis: Array<{ point: string; evidence: string }>;
  weaknessesAnalysis: Array<{ point: string; evidence: string }>;
  opportunitiesAnalysis: Array<{ point: string; evidence: string }>;
  threatsAnalysis: Array<{ point: string; evidence: string }>;
  salesTrends: TrendAnalysis['salesTrends'];
  customerTrends: TrendAnalysis['customerTrends'];
  brandTrends: TrendAnalysis['brandTrends'];
  marketTrends: TrendAnalysis['marketTrends'];
  strategicPriorities: StrategicRecommendations['priorities'];
  quarterlyGoals: StrategicRecommendations['quarterlyGoals'];
  resourceAllocations: StrategicRecommendations['resourceAllocations'];
  riskMitigations: StrategicRecommendations['riskMitigations'];
  competitiveLandscape: Record<string, unknown>;
  marketPositioning: Record<string, unknown>;
  regulatoryOutlook: Record<string, unknown>;
  revenueProjections: Array<{ period: string; projected: number; confidence: number }>;
  growthOpportunities: Array<{ opportunity: string; potential: string; effort: string }>;
  riskFactors: Array<{ factor: string; likelihood: string; mitigation: string }>;
  keyQuestionsNext: Array<{ question: string; priority: number }>;
  dataHealthScore: number;
  confidenceScore: number;
  dailyDigestsIncluded: number;
}

export class MonthlyAnalysisService {
  private client: Anthropic;

  constructor() {
    this.client = getAnthropicClient();
  }

  async runMonthlyAnalysis(options?: {
    monthYear?: string;
    forceRun?: boolean;
  }): Promise<{ jobId: string; report: MonthlyReportContent | null }> {
    const { forceRun = false } = options || {};

    // Clean up any stale jobs before checking for existing jobs
    await this.cleanupStaleJobs();

    // Default to previous month
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() - 1);
    const monthYear = options?.monthYear || `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;

    if (!forceRun) {
      const existingJob = await prisma.monthlyAnalysisJob.findUnique({
        where: { monthYear },
      });

      if (existingJob && existingJob.status === 'completed') {
        throw new Error(`Monthly analysis already completed for ${monthYear}. Job ID: ${existingJob.id}`);
      }
    }

    // Delete any existing job for this month if forcing
    if (forceRun) {
      await prisma.monthlyAnalysisJob.deleteMany({ where: { monthYear } });
    }

    const job = await prisma.monthlyAnalysisJob.create({
      data: {
        status: 'running',
        currentPhase: 'data_aggregation',
        monthYear,
      },
    });

    const state: MonthlyAnalysisJobState = {
      jobId: job.id,
      monthYear,
      inputTokens: 0,
      outputTokens: 0,
    };

    try {
      // Phase 1: Aggregate all data for the month
      await this.updateJobPhase(state.jobId, 'data_aggregation');
      const aggregatedData = await this.phase1DataAggregation(state);
      await this.markPhaseComplete(state.jobId, 'dataAggregationDone');

      // Phase 2: Deep trend analysis with Opus
      await this.updateJobPhase(state.jobId, 'trend_analysis');
      const trendAnalysis = await this.phase2TrendAnalysis(state, aggregatedData);
      await this.markPhaseComplete(state.jobId, 'trendAnalysisDone');

      // Phase 3: Strategic recommendations with Opus
      await this.updateJobPhase(state.jobId, 'strategy_gen');
      const strategies = await this.phase3StrategyGeneration(state, aggregatedData, trendAnalysis);
      await this.markPhaseComplete(state.jobId, 'strategyGenDone');

      // Phase 4: Generate final report with Opus
      await this.updateJobPhase(state.jobId, 'report_gen');
      const report = await this.phase4ReportGeneration(state, aggregatedData, trendAnalysis, strategies);
      await this.markPhaseComplete(state.jobId, 'reportGenDone');

      // Store the report
      const reportRecord = await prisma.monthlyStrategicReport.create({
        data: {
          monthYear,
          executiveSummary: report.executiveSummary,
          performanceGrade: report.performanceGrade,
          monthOverMonthChange: JSON.parse(JSON.stringify(report.monthOverMonthChange)),
          strengthsAnalysis: JSON.parse(JSON.stringify(report.strengthsAnalysis)),
          weaknessesAnalysis: JSON.parse(JSON.stringify(report.weaknessesAnalysis)),
          opportunitiesAnalysis: JSON.parse(JSON.stringify(report.opportunitiesAnalysis)),
          threatsAnalysis: JSON.parse(JSON.stringify(report.threatsAnalysis)),
          salesTrends: JSON.parse(JSON.stringify(report.salesTrends)),
          customerTrends: JSON.parse(JSON.stringify(report.customerTrends)),
          brandTrends: JSON.parse(JSON.stringify(report.brandTrends)),
          marketTrends: JSON.parse(JSON.stringify(report.marketTrends)),
          strategicPriorities: JSON.parse(JSON.stringify(report.strategicPriorities)),
          quarterlyGoals: JSON.parse(JSON.stringify(report.quarterlyGoals)),
          resourceAllocations: JSON.parse(JSON.stringify(report.resourceAllocations)),
          riskMitigations: JSON.parse(JSON.stringify(report.riskMitigations)),
          competitiveLandscape: JSON.parse(JSON.stringify(report.competitiveLandscape)),
          marketPositioning: JSON.parse(JSON.stringify(report.marketPositioning)),
          regulatoryOutlook: JSON.parse(JSON.stringify(report.regulatoryOutlook)),
          revenueProjections: JSON.parse(JSON.stringify(report.revenueProjections)),
          growthOpportunities: JSON.parse(JSON.stringify(report.growthOpportunities)),
          riskFactors: JSON.parse(JSON.stringify(report.riskFactors)),
          keyQuestionsNext: JSON.parse(JSON.stringify(report.keyQuestionsNext)),
          dataHealthScore: report.dataHealthScore,
          confidenceScore: report.confidenceScore,
          dailyDigestsIncluded: report.dailyDigestsIncluded,
        },
      });

      // Update job with completion
      await prisma.monthlyAnalysisJob.update({
        where: { id: state.jobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          reportId: reportRecord.id,
          estimatedCost: this.calculateCost(state.inputTokens, state.outputTokens),
        },
      });

      return { jobId: state.jobId, report };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const currentJob = await prisma.monthlyAnalysisJob.findUnique({ where: { id: state.jobId } });

      await prisma.monthlyAnalysisJob.update({
        where: { id: state.jobId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage,
          errorPhase: currentJob?.currentPhase || 'unknown',
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
        },
      });
      throw error;
    }
  }

  private async phase1DataAggregation(state: MonthlyAnalysisJobState): Promise<AggregatedData> {
    const [year, month] = state.monthYear.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month

    // Get prior month for comparison
    const priorStartDate = new Date(year, month - 2, 1);
    const priorEndDate = new Date(year, month - 1, 0);

    // Aggregate sales data
    const salesRecords = await prisma.salesRecord.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      orderBy: { date: 'asc' },
    });

    const priorSalesRecords = await prisma.salesRecord.findMany({
      where: { date: { gte: priorStartDate, lte: priorEndDate } },
    });

    const totalRevenue = salesRecords.reduce((sum, r) => sum + parseFloat(r.netSales.toString()), 0);
    const priorRevenue = priorSalesRecords.reduce((sum, r) => sum + parseFloat(r.netSales.toString()), 0);
    const totalTransactions = salesRecords.reduce((sum, r) => sum + r.ticketsCount, 0);

    const sortedByRevenue = [...salesRecords].sort((a, b) =>
      parseFloat(b.netSales.toString()) - parseFloat(a.netSales.toString())
    );

    // Get brand performance
    const brandRecords = await prisma.brandRecord.findMany({
      where: { uploadStartDate: { gte: startDate }, uploadEndDate: { lte: endDate } },
      include: { brand: true },
      orderBy: { netSales: 'desc' },
      take: 20,
    });

    // Get customer metrics
    const customers = await prisma.customer.findMany({
      where: { lastVisitDate: { gte: startDate, lte: endDate } },
    });

    const newCustomers = await prisma.customer.count({
      where: { signupDate: { gte: startDate, lte: endDate } },
    });

    // Get daily digests for the month
    const dailyDigests = await prisma.dailyDigest.findMany({
      where: { digestDate: { gte: startDate, lte: endDate } },
      orderBy: { digestDate: 'asc' },
    });

    // Get web research highlights
    const collectedUrls = await prisma.collectedUrl.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        isAnalyzed: true,
        relevanceScore: { gte: 0.7 },
      },
      orderBy: { relevanceScore: 'desc' },
      take: 10,
    });

    return {
      salesSummary: {
        totalRevenue,
        totalTransactions,
        avgDailySales: totalRevenue / Math.max(salesRecords.length, 1),
        topDays: sortedByRevenue.slice(0, 5).map(r => ({
          date: r.date.toISOString().split('T')[0],
          revenue: parseFloat(r.netSales.toString()),
        })),
        bottomDays: sortedByRevenue.slice(-5).reverse().map(r => ({
          date: r.date.toISOString().split('T')[0],
          revenue: parseFloat(r.netSales.toString()),
        })),
        growthVsPriorMonth: priorRevenue > 0 ? ((totalRevenue - priorRevenue) / priorRevenue) * 100 : null,
      },
      brandPerformance: brandRecords.map(b => ({
        brand: b.brand?.canonicalName || b.originalBrandName,
        revenue: parseFloat(b.netSales.toString()),
        margin: parseFloat(b.grossMarginPct.toString()),
        trend: 'stable', // Would need historical data to determine
      })),
      customerMetrics: {
        totalCustomers: customers.length,
        activeCustomers: customers.filter(c => c.lifetimeVisits > 1).length,
        newCustomers,
        churnedCustomers: 0, // Would need prior month data
        avgLifetimeValue: customers.reduce((sum, c) => sum + parseFloat(c.lifetimeNetSales.toString()), 0) / Math.max(customers.length, 1),
      },
      dailyDigests: dailyDigests.map(d => ({
        date: d.digestDate.toISOString().split('T')[0],
        summary: d.executiveSummary.substring(0, 200),
        priorityActions: Array.isArray(d.priorityActions) ? (d.priorityActions as unknown[]).length : 0,
        insights: Array.isArray(d.correlatedInsights) ? (d.correlatedInsights as unknown[]).length : 0,
      })),
      webResearchHighlights: collectedUrls.map(u => u.title || u.url).filter(Boolean) as string[],
    };
  }

  private async phase2TrendAnalysis(
    state: MonthlyAnalysisJobState,
    data: AggregatedData
  ): Promise<TrendAnalysis> {
    const prompt = `You are a strategic business analyst for a San Francisco cannabis dispensary network. Analyze the following monthly data and identify key trends.

## Monthly Data Summary

### Sales Performance
- Total Revenue: $${data.salesSummary.totalRevenue.toFixed(2)}
- Total Transactions: ${data.salesSummary.totalTransactions}
- Avg Daily Sales: $${data.salesSummary.avgDailySales.toFixed(2)}
- Month-over-Month Growth: ${data.salesSummary.growthVsPriorMonth ? data.salesSummary.growthVsPriorMonth.toFixed(1) + '%' : 'N/A'}

Top 5 Days: ${data.salesSummary.topDays.map(d => `${d.date}: $${d.revenue.toFixed(2)}`).join(', ')}
Bottom 5 Days: ${data.salesSummary.bottomDays.map(d => `${d.date}: $${d.revenue.toFixed(2)}`).join(', ')}

### Brand Performance (Top 20)
${data.brandPerformance.map(b => `- ${b.brand}: $${b.revenue.toFixed(2)} (${b.margin.toFixed(1)}% margin)`).join('\n')}

### Customer Metrics
- Total Active: ${data.customerMetrics.totalCustomers}
- New This Month: ${data.customerMetrics.newCustomers}
- Avg Lifetime Value: $${data.customerMetrics.avgLifetimeValue.toFixed(2)}

### Daily Digest Insights (${data.dailyDigests.length} digests)
${data.dailyDigests.slice(0, 10).map(d => `- ${d.date}: ${d.priorityActions} actions, ${d.insights} insights`).join('\n')}

### Industry Research Highlights
${data.webResearchHighlights.join('\n')}

Provide a comprehensive trend analysis. Return JSON:
{
  "salesTrends": [{ "trend": "", "direction": "up|down|stable", "confidence": 0-1, "implication": "" }],
  "customerTrends": [{ "trend": "", "direction": "up|down|stable", "confidence": 0-1, "implication": "" }],
  "brandTrends": [{ "brand": "", "trend": "", "recommendation": "" }],
  "marketTrends": [{ "trend": "", "source": "", "relevance": "", "actionRequired": boolean }]
}`;

    const response = await this.client.messages.create({
      model: OPUS_MODEL,
      max_tokens: MONTHLY_ANALYSIS_CONFIG.phase2TokenBudget,
      messages: [{ role: 'user', content: prompt }],
    });

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('Failed to parse trend analysis response');
    }

    return JSON.parse(jsonMatch[0]) as TrendAnalysis;
  }

  private async phase3StrategyGeneration(
    state: MonthlyAnalysisJobState,
    data: AggregatedData,
    trends: TrendAnalysis
  ): Promise<StrategicRecommendations> {
    const prompt = `You are a strategic advisor for a San Francisco cannabis dispensary network. Based on the data analysis and trends, generate strategic recommendations.

## Context
- Monthly Revenue: $${data.salesSummary.totalRevenue.toFixed(2)}
- MoM Growth: ${data.salesSummary.growthVsPriorMonth?.toFixed(1) || 'N/A'}%
- Active Customers: ${data.customerMetrics.totalCustomers}
- Top Brands: ${data.brandPerformance.slice(0, 5).map(b => b.brand).join(', ')}

## Identified Trends
Sales: ${trends.salesTrends.map(t => `${t.trend} (${t.direction})`).join('; ')}
Customers: ${trends.customerTrends.map(t => `${t.trend} (${t.direction})`).join('; ')}
Market: ${trends.marketTrends.map(t => t.trend).join('; ')}

Generate comprehensive strategic recommendations. Consider:
1. California cannabis regulatory environment
2. San Francisco market dynamics
3. Competitive landscape
4. Operational efficiency opportunities
5. Customer retention strategies
6. Brand portfolio optimization

Return JSON:
{
  "swot": {
    "strengths": [{ "point": "", "evidence": "" }],
    "weaknesses": [{ "point": "", "evidence": "" }],
    "opportunities": [{ "point": "", "evidence": "" }],
    "threats": [{ "point": "", "evidence": "" }]
  },
  "priorities": [{ "priority": "", "rationale": "", "timeline": "", "resources": "", "expectedOutcome": "" }],
  "quarterlyGoals": [{ "goal": "", "metric": "", "target": "", "deadline": "" }],
  "resourceAllocations": [{ "area": "", "currentAllocation": "", "recommendedAllocation": "", "rationale": "" }],
  "riskMitigations": [{ "risk": "", "probability": "high|medium|low", "impact": "high|medium|low", "mitigation": "" }]
}`;

    const response = await this.client.messages.create({
      model: OPUS_MODEL,
      max_tokens: MONTHLY_ANALYSIS_CONFIG.phase3TokenBudget,
      messages: [{ role: 'user', content: prompt }],
    });

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('Failed to parse strategy generation response');
    }

    return JSON.parse(jsonMatch[0]) as StrategicRecommendations;
  }

  private async phase4ReportGeneration(
    state: MonthlyAnalysisJobState,
    data: AggregatedData,
    trends: TrendAnalysis,
    strategies: StrategicRecommendations
  ): Promise<MonthlyReportContent> {
    const prompt = `You are the Chief Strategy Officer for a San Francisco cannabis dispensary network. Generate a comprehensive monthly strategic report.

## Data Summary
${JSON.stringify(data.salesSummary, null, 2)}

## Trends Analysis
${JSON.stringify(trends, null, 2)}

## Strategic Recommendations
${JSON.stringify(strategies, null, 2)}

Generate the final executive report. Include:
1. Executive summary (3-4 paragraphs)
2. Performance grade (A-F based on targets)
3. Month-over-month changes for key metrics
4. Competitive landscape assessment
5. Market positioning recommendations
6. Regulatory outlook for next quarter
7. Revenue projections for next 3 months
8. Growth opportunities ranked by potential
9. Key questions to investigate next month
10. Overall data health and confidence scores

Return JSON:
{
  "executiveSummary": "",
  "performanceGrade": "A|B|C|D|F",
  "monthOverMonthChange": { "revenue": number, "customers": number, "transactions": number },
  "competitiveLandscape": { "position": "", "keyCompetitors": [], "differentiators": [] },
  "marketPositioning": { "currentPosition": "", "targetPosition": "", "gaps": [] },
  "regulatoryOutlook": { "upcomingChanges": [], "riskLevel": "", "preparations": [] },
  "revenueProjections": [{ "period": "", "projected": number, "confidence": number }],
  "growthOpportunities": [{ "opportunity": "", "potential": "", "effort": "" }],
  "riskFactors": [{ "factor": "", "likelihood": "", "mitigation": "" }],
  "keyQuestionsNext": [{ "question": "", "priority": number }],
  "dataHealthScore": 0-100,
  "confidenceScore": 0-1
}`;

    const response = await this.client.messages.create({
      model: OPUS_MODEL,
      max_tokens: MONTHLY_ANALYSIS_CONFIG.phase4TokenBudget,
      messages: [{ role: 'user', content: prompt }],
    });

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('Failed to parse report generation response');
    }

    const reportBase = JSON.parse(jsonMatch[0]);

    // Merge with trends and strategies
    return {
      ...reportBase,
      strengthsAnalysis: strategies.swot.strengths,
      weaknessesAnalysis: strategies.swot.weaknesses,
      opportunitiesAnalysis: strategies.swot.opportunities,
      threatsAnalysis: strategies.swot.threats,
      salesTrends: trends.salesTrends,
      customerTrends: trends.customerTrends,
      brandTrends: trends.brandTrends,
      marketTrends: trends.marketTrends,
      strategicPriorities: strategies.priorities,
      quarterlyGoals: strategies.quarterlyGoals,
      resourceAllocations: strategies.resourceAllocations,
      riskMitigations: strategies.riskMitigations,
      dailyDigestsIncluded: data.dailyDigests.length,
    } as MonthlyReportContent;
  }

  private async updateJobPhase(jobId: string, phase: string): Promise<void> {
    await prisma.monthlyAnalysisJob.update({
      where: { id: jobId },
      data: { currentPhase: phase },
    });
  }

  private async markPhaseComplete(
    jobId: string,
    phaseField: 'dataAggregationDone' | 'trendAnalysisDone' | 'strategyGenDone' | 'reportGenDone'
  ): Promise<void> {
    await prisma.monthlyAnalysisJob.update({
      where: { id: jobId },
      data: { [phaseField]: true },
    });
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    // Opus pricing: $15/1M input, $75/1M output
    const inputCost = (inputTokens / 1000000) * 15;
    const outputCost = (outputTokens / 1000000) * 75;
    return parseFloat((inputCost + outputCost).toFixed(4));
  }

  async getLatestReport(): Promise<{
    report: MonthlyReportContent | null;
    job: { id: string; status: string; monthYear: string; completedAt: Date | null } | null;
  }> {
    const latestJob = await prisma.monthlyAnalysisJob.findFirst({
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' },
      include: { report: true },
    });

    if (!latestJob || !latestJob.report) {
      return { report: null, job: null };
    }

    const r = latestJob.report;
    return {
      report: {
        executiveSummary: r.executiveSummary,
        performanceGrade: r.performanceGrade,
        monthOverMonthChange: r.monthOverMonthChange as Record<string, number>,
        strengthsAnalysis: r.strengthsAnalysis as MonthlyReportContent['strengthsAnalysis'],
        weaknessesAnalysis: r.weaknessesAnalysis as MonthlyReportContent['weaknessesAnalysis'],
        opportunitiesAnalysis: r.opportunitiesAnalysis as MonthlyReportContent['opportunitiesAnalysis'],
        threatsAnalysis: r.threatsAnalysis as MonthlyReportContent['threatsAnalysis'],
        salesTrends: r.salesTrends as MonthlyReportContent['salesTrends'],
        customerTrends: r.customerTrends as MonthlyReportContent['customerTrends'],
        brandTrends: r.brandTrends as MonthlyReportContent['brandTrends'],
        marketTrends: r.marketTrends as MonthlyReportContent['marketTrends'],
        strategicPriorities: r.strategicPriorities as MonthlyReportContent['strategicPriorities'],
        quarterlyGoals: r.quarterlyGoals as MonthlyReportContent['quarterlyGoals'],
        resourceAllocations: r.resourceAllocations as MonthlyReportContent['resourceAllocations'],
        riskMitigations: r.riskMitigations as MonthlyReportContent['riskMitigations'],
        competitiveLandscape: r.competitiveLandscape as Record<string, unknown>,
        marketPositioning: r.marketPositioning as Record<string, unknown>,
        regulatoryOutlook: r.regulatoryOutlook as Record<string, unknown>,
        revenueProjections: r.revenueProjections as MonthlyReportContent['revenueProjections'],
        growthOpportunities: r.growthOpportunities as MonthlyReportContent['growthOpportunities'],
        riskFactors: r.riskFactors as MonthlyReportContent['riskFactors'],
        keyQuestionsNext: r.keyQuestionsNext as MonthlyReportContent['keyQuestionsNext'],
        dataHealthScore: r.dataHealthScore,
        confidenceScore: r.confidenceScore,
        dailyDigestsIncluded: r.dailyDigestsIncluded,
      },
      job: {
        id: latestJob.id,
        status: latestJob.status,
        monthYear: latestJob.monthYear,
        completedAt: latestJob.completedAt,
      },
    };
  }

  async getJobHistory(limit: number = 12): Promise<Array<{
    id: string;
    monthYear: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    estimatedCost: number;
    performanceGrade: string | null;
  }>> {
    const jobs = await prisma.monthlyAnalysisJob.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { report: { select: { performanceGrade: true } } },
    });

    return jobs.map(j => ({
      id: j.id,
      monthYear: j.monthYear,
      status: j.status,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      estimatedCost: parseFloat(j.estimatedCost.toString()),
      performanceGrade: j.report?.performanceGrade || null,
    }));
  }

  // Maximum time a job can run before being considered stale (4 hours for monthly - it's more intensive)
  private static readonly STALE_JOB_TIMEOUT_MS = 4 * 60 * 60 * 1000;

  async getCurrentJobStatus(): Promise<{
    isRunning: boolean;
    currentJob: { id: string; phase: string; monthYear: string; startedAt: Date; progress: number } | null;
  }> {
    const runningJob = await prisma.monthlyAnalysisJob.findFirst({
      where: { status: 'running' },
      orderBy: { startedAt: 'desc' },
    });

    if (!runningJob) {
      return { isRunning: false, currentJob: null };
    }

    // Check if the job is stale (running for too long without completion)
    const jobAge = Date.now() - runningJob.startedAt.getTime();
    if (jobAge > MonthlyAnalysisService.STALE_JOB_TIMEOUT_MS) {
      // Auto-recover: Mark stale job as failed
      console.warn(`Stale monthly job detected: ${runningJob.id} has been running for ${Math.round(jobAge / 60000)} minutes. Auto-recovering.`);
      await prisma.monthlyAnalysisJob.update({
        where: { id: runningJob.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: `Job stalled and was auto-recovered after ${Math.round(jobAge / 60000)} minutes`,
          errorPhase: runningJob.currentPhase || 'unknown',
        },
      });
      return { isRunning: false, currentJob: null };
    }

    const phases = [
      runningJob.dataAggregationDone,
      runningJob.trendAnalysisDone,
      runningJob.strategyGenDone,
      runningJob.reportGenDone,
    ];
    const progress = (phases.filter(Boolean).length / phases.length) * 100;

    return {
      isRunning: true,
      currentJob: {
        id: runningJob.id,
        phase: runningJob.currentPhase || 'starting',
        monthYear: runningJob.monthYear,
        startedAt: runningJob.startedAt,
        progress,
      },
    };
  }

  /**
   * Cleans up any stale monthly jobs that have been running for too long.
   */
  async cleanupStaleJobs(): Promise<number> {
    const staleThreshold = new Date(Date.now() - MonthlyAnalysisService.STALE_JOB_TIMEOUT_MS);

    const staleJobs = await prisma.monthlyAnalysisJob.findMany({
      where: {
        status: 'running',
        startedAt: { lt: staleThreshold },
      },
    });

    if (staleJobs.length === 0) return 0;

    console.warn(`Found ${staleJobs.length} stale monthly job(s). Auto-recovering...`);

    for (const job of staleJobs) {
      const jobAge = Date.now() - job.startedAt.getTime();
      await prisma.monthlyAnalysisJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: `Job stalled and was auto-recovered after ${Math.round(jobAge / 60000)} minutes`,
          errorPhase: job.currentPhase || 'unknown',
        },
      });
      console.warn(`Recovered stale monthly job ${job.id} for ${job.monthYear} (was in phase: ${job.currentPhase || 'unknown'})`);
    }

    return staleJobs.length;
  }
}

export const monthlyAnalysisService = new MonthlyAnalysisService();
