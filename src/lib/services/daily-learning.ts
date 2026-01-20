// ============================================
// DAILY LEARNING SERVICE
// Autonomous daily learning that reviews data,
// generates questions, researches the web, and
// produces actionable daily digests
// ============================================

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { getAnthropicClient } from './claude';
import { webSearchService, SearchResult } from './web-search';
import { CLAUDE_CONFIG } from '@/lib/config';

// Daily Learning Configuration
export const DAILY_LEARNING_CONFIG = {
  maxSearchesPerDay: 8,
  maxPagesPerSearch: 5,
  phase1TokenBudget: 8000,
  phase2TokenBudget: 6000,
  phase3TokenBudget: 10000,
  phase4TokenBudget: 16000,
  phase5TokenBudget: 12000,
  questionsPerCycle: 10,
  maxWebResearchQuestions: 5,
};

interface DailyLearningJobState {
  jobId: string;
  inputTokens: number;
  outputTokens: number;
  searchesUsed: number;
}

interface DataReviewResult {
  summary: string;
  keyMetrics: {
    salesTrend: string;
    topBrands: string[];
    customerActivity: string;
    recentChanges: string[];
  };
  areasOfConcern: string[];
  areasOfOpportunity: string[];
  anomalies: string[];
  suggestedQuestionTopics: string[];
}

interface GeneratedQuestion {
  question: string;
  category: string;
  priority: number;
  requiresWebResearch: boolean;
  requiresInternalData: boolean;
  context?: string;
}

interface WebResearchResult {
  question: string;
  searchQuery: string;
  findings: Array<{
    title: string;
    url: string;
    snippet: string;
    relevance: number;
    keyPoints: string[];
  }>;
  summary: string;
}

interface CorrelatedInsight {
  internalObservation: string;
  externalEvidence: string;
  correlation: string;
  confidence: number;
  actionItem?: string;
  category: string;
}

interface DailyDigestContent {
  executiveSummary: string;
  priorityActions: Array<{ action: string; timeframe: string; impact: string; category: string }>;
  quickWins: Array<{ action: string; effort: string; impact: string }>;
  watchItems: Array<{ item: string; reason: string; monitorUntil: string }>;
  industryHighlights: Array<{ headline: string; source: string; relevance: string; actionItem?: string }>;
  regulatoryUpdates: Array<{ update: string; source: string; impactLevel: 'high' | 'medium' | 'low'; deadline?: string }>;
  marketTrends: Array<{ trend: string; evidence: string; implication: string }>;
  questionsForTomorrow: Array<{ question: string; priority: number; category: string }>;
  correlatedInsights: CorrelatedInsight[];
  dataHealthScore: number;
  confidenceScore: number;
}

export class DailyLearningService {
  private client: Anthropic;

  constructor() {
    this.client = getAnthropicClient();
  }

  async runDailyLearning(options?: {
    forceRun?: boolean;
    skipWebResearch?: boolean;
  }): Promise<{ jobId: string; digest: DailyDigestContent | null }> {
    const { forceRun = false, skipWebResearch = false } = options || {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!forceRun) {
      const existingJob = await prisma.dailyLearningJob.findFirst({
        where: {
          startedAt: { gte: today },
          status: { in: ['completed', 'running'] },
        },
      });

      if (existingJob) {
        throw new Error(`Daily learning already ${existingJob.status} for today. Job ID: ${existingJob.id}`);
      }
    }

    const job = await prisma.dailyLearningJob.create({
      data: { status: 'running', currentPhase: 'data_review' },
    });

    const state: DailyLearningJobState = {
      jobId: job.id,
      inputTokens: 0,
      outputTokens: 0,
      searchesUsed: 0,
    };

    try {
      await this.updateJobPhase(state.jobId, 'data_review');
      const dataReview = await this.phase1DataReview(state);
      await this.markPhaseComplete(state.jobId, 'dataReviewDone');

      await this.updateJobPhase(state.jobId, 'question_gen');
      const questions = await this.phase2QuestionGeneration(state, dataReview);
      await this.markPhaseComplete(state.jobId, 'questionGenDone');

      let webResearchResults: WebResearchResult[] = [];
      if (!skipWebResearch) {
        await this.updateJobPhase(state.jobId, 'web_research');
        webResearchResults = await this.phase3WebResearch(state, questions);
        await this.markPhaseComplete(state.jobId, 'webResearchDone');
      }

      await this.updateJobPhase(state.jobId, 'correlation');
      const correlatedInsights = await this.phase4Correlation(state, dataReview, webResearchResults);
      await this.markPhaseComplete(state.jobId, 'correlationDone');

      await this.updateJobPhase(state.jobId, 'digest_gen');
      const digest = await this.phase5DigestGeneration(state, dataReview, questions, webResearchResults, correlatedInsights);
      await this.markPhaseComplete(state.jobId, 'digestGenDone');

      const digestRecord = await prisma.dailyDigest.create({
        data: {
          digestDate: today,
          executiveSummary: digest.executiveSummary,
          priorityActions: JSON.parse(JSON.stringify(digest.priorityActions)),
          quickWins: JSON.parse(JSON.stringify(digest.quickWins)),
          watchItems: JSON.parse(JSON.stringify(digest.watchItems)),
          industryHighlights: JSON.parse(JSON.stringify(digest.industryHighlights)),
          regulatoryUpdates: JSON.parse(JSON.stringify(digest.regulatoryUpdates)),
          marketTrends: JSON.parse(JSON.stringify(digest.marketTrends)),
          questionsForTomorrow: JSON.parse(JSON.stringify(digest.questionsForTomorrow)),
          correlatedInsights: JSON.parse(JSON.stringify(digest.correlatedInsights)),
          dataHealthScore: digest.dataHealthScore,
          confidenceScore: digest.confidenceScore,
        },
      });

      await prisma.dailyLearningJob.update({
        where: { id: state.jobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          searchesUsed: state.searchesUsed,
          questionsGenerated: questions.length,
          insightsDiscovered: correlatedInsights.length,
          articlesAnalyzed: webResearchResults.reduce((sum, r) => sum + r.findings.length, 0),
          digestId: digestRecord.id,
          estimatedCost: this.calculateCost(state.inputTokens, state.outputTokens),
        },
      });

      return { jobId: state.jobId, digest };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await prisma.dailyLearningJob.update({
        where: { id: state.jobId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage,
          errorPhase: (await prisma.dailyLearningJob.findUnique({ where: { id: state.jobId } }))?.currentPhase || 'unknown',
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          searchesUsed: state.searchesUsed,
        },
      });
      throw error;
    }
  }

  private async phase1DataReview(state: DailyLearningJobState): Promise<DataReviewResult> {
    const [salesData, brandData, customerData] = await Promise.all([
      this.loadRecentSalesData(),
      this.loadRecentBrandData(),
      this.loadRecentCustomerData(),
    ]);

    const prompt = `Analyze business data for San Francisco cannabis dispensaries.

SALES DATA: ${JSON.stringify(salesData, null, 2)}
BRAND DATA: ${JSON.stringify(brandData, null, 2)}
CUSTOMER DATA: ${JSON.stringify(customerData, null, 2)}

Return JSON:
{
  "summary": "Brief overview",
  "keyMetrics": { "salesTrend": "", "topBrands": [], "customerActivity": "", "recentChanges": [] },
  "areasOfConcern": [],
  "areasOfOpportunity": [],
  "anomalies": [],
  "suggestedQuestionTopics": []
}`;

    const response = await this.client.messages.create({
      model: CLAUDE_CONFIG.haiku,
      max_tokens: DAILY_LEARNING_CONFIG.phase1TokenBudget,
      messages: [{ role: 'user', content: prompt }],
    });

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to parse data review response');

    return JSON.parse(jsonMatch[0]) as DataReviewResult;
  }

  private async phase2QuestionGeneration(
    state: DailyLearningJobState,
    dataReview: DataReviewResult
  ): Promise<GeneratedQuestion[]> {
    const prompt = `Generate ${DAILY_LEARNING_CONFIG.questionsPerCycle} analytical questions for cannabis dispensary analysis.

Data Review: ${dataReview.summary}
Concerns: ${dataReview.areasOfConcern.join(', ')}
Opportunities: ${dataReview.areasOfOpportunity.join(', ')}

Return JSON array:
[{ "question": "", "category": "sales|brands|customers|market|regulatory|operations", "priority": 1-10, "requiresWebResearch": boolean, "requiresInternalData": boolean }]`;

    const response = await this.client.messages.create({
      model: CLAUDE_CONFIG.haiku,
      max_tokens: DAILY_LEARNING_CONFIG.phase2TokenBudget,
      messages: [{ role: 'user', content: prompt }],
    });

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const questions = JSON.parse(jsonMatch[0]) as GeneratedQuestion[];

    for (const q of questions) {
      const questionHash = this.hashString(q.question.toLowerCase());
      await prisma.learningQuestion.upsert({
        where: { questionHash },
        create: {
          question: q.question,
          questionHash,
          category: q.category,
          priority: q.priority,
          requiresWebResearch: q.requiresWebResearch,
          requiresInternalData: q.requiresInternalData,
          generatedBy: 'ai',
        },
        update: { priority: q.priority, isActive: true },
      });
    }

    return questions;
  }

  private async phase3WebResearch(
    state: DailyLearningJobState,
    questions: GeneratedQuestion[]
  ): Promise<WebResearchResult[]> {
    const webQuestions = questions
      .filter(q => q.requiresWebResearch)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, DAILY_LEARNING_CONFIG.maxWebResearchQuestions);

    const throttleStatus = await webSearchService.getThrottleStatus();
    const availableSearches = Math.min(
      throttleStatus.searchesRemaining,
      DAILY_LEARNING_CONFIG.maxSearchesPerDay - state.searchesUsed
    );

    if (availableSearches <= 0) return [];

    const results: WebResearchResult[] = [];
    let searchesUsed = 0;

    for (const question of webQuestions) {
      if (searchesUsed >= availableSearches) break;

      const searchQuery = await this.buildSearchQuery(question, state);

      try {
        const searchResponse = await webSearchService.search(searchQuery, {
          maxPages: DAILY_LEARNING_CONFIG.maxPagesPerSearch,
          sourceJobId: state.jobId,
        });

        searchesUsed++;
        state.searchesUsed++;

        const analysis = await this.analyzeSearchResults(state, question.question, searchResponse.newResults.slice(0, 15));

        results.push({
          question: question.question,
          searchQuery,
          findings: analysis.findings,
          summary: analysis.summary,
        });
      } catch (error) {
        console.error(`Error searching for question: ${question.question}`, error);
      }
    }

    return results;
  }

  private async phase4Correlation(
    state: DailyLearningJobState,
    dataReview: DataReviewResult,
    webResearchResults: WebResearchResult[]
  ): Promise<CorrelatedInsight[]> {
    if (webResearchResults.length === 0) {
      return dataReview.areasOfConcern.map(concern => ({
        internalObservation: concern,
        externalEvidence: 'Internal data analysis',
        correlation: 'identifies',
        confidence: 0.7,
        actionItem: `Investigate: ${concern}`,
        category: 'operations',
      }));
    }

    const prompt = `Correlate internal data with external research for cannabis dispensaries.

Internal: ${dataReview.summary}
Concerns: ${dataReview.areasOfConcern.join(', ')}

External Research:
${webResearchResults.map(r => `Q: ${r.question}\nSummary: ${r.summary}`).join('\n\n')}

Return JSON:
[{ "internalObservation": "", "externalEvidence": "", "correlation": "supports|contradicts|explains", "confidence": 0-1, "actionItem": "", "category": "" }]`;

    const response = await this.client.messages.create({
      model: CLAUDE_CONFIG.defaultModel,
      max_tokens: DAILY_LEARNING_CONFIG.phase4TokenBudget,
      messages: [{ role: 'user', content: prompt }],
    });

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    return JSON.parse(jsonMatch[0]) as CorrelatedInsight[];
  }

  private async phase5DigestGeneration(
    state: DailyLearningJobState,
    dataReview: DataReviewResult,
    questions: GeneratedQuestion[],
    webResearchResults: WebResearchResult[],
    correlatedInsights: CorrelatedInsight[]
  ): Promise<DailyDigestContent> {
    const prompt = `Generate daily business intelligence digest for cannabis dispensaries.

Data Review: ${JSON.stringify(dataReview)}
Questions: ${questions.length}
Web Research: ${webResearchResults.map(r => r.summary).join('\n')}
Insights: ${correlatedInsights.length}

Return JSON with: executiveSummary, priorityActions[], quickWins[], watchItems[], industryHighlights[], regulatoryUpdates[], marketTrends[], questionsForTomorrow[], correlatedInsights, dataHealthScore (0-100), confidenceScore (0-1)`;

    const response = await this.client.messages.create({
      model: CLAUDE_CONFIG.defaultModel,
      max_tokens: DAILY_LEARNING_CONFIG.phase5TokenBudget,
      messages: [{ role: 'user', content: prompt }],
    });

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to parse digest response');

    return JSON.parse(jsonMatch[0]) as DailyDigestContent;
  }

  private async updateJobPhase(jobId: string, phase: string): Promise<void> {
    await prisma.dailyLearningJob.update({ where: { id: jobId }, data: { currentPhase: phase } });
  }

  private async markPhaseComplete(
    jobId: string,
    phaseField: 'dataReviewDone' | 'questionGenDone' | 'webResearchDone' | 'correlationDone' | 'digestGenDone'
  ): Promise<void> {
    await prisma.dailyLearningJob.update({ where: { id: jobId }, data: { [phaseField]: true } });
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1000000) * 3;
    const outputCost = (outputTokens / 1000000) * 15;
    return parseFloat((inputCost + outputCost).toFixed(4));
  }

  private hashString(input: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  private async loadRecentSalesData(): Promise<Record<string, unknown>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const salesRecords = await prisma.salesRecord.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      orderBy: { date: 'desc' },
      take: 30,
    });

    const totalSales = salesRecords.reduce((sum, r) => sum + parseFloat(r.netSales.toString()), 0);
    const avgDaily = totalSales / Math.max(salesRecords.length, 1);

    return {
      periodDays: 30,
      totalNetSales: totalSales.toFixed(2),
      avgDailySales: avgDaily.toFixed(2),
      recordCount: salesRecords.length,
    };
  }

  private async loadRecentBrandData(): Promise<Record<string, unknown>> {
    const brandRecords = await prisma.brandRecord.findMany({
      orderBy: { netSales: 'desc' },
      take: 10,
      include: { brand: true },
    });

    return {
      topBrands: brandRecords.map(b => ({
        name: b.brand?.canonicalName || b.originalBrandName,
        netSales: parseFloat(b.netSales.toString()),
      })),
    };
  }

  private async loadRecentCustomerData(): Promise<Record<string, unknown>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeCustomers = await prisma.customer.count({
      where: { lastVisitDate: { gte: thirtyDaysAgo } },
    });
    const totalCustomers = await prisma.customer.count();

    return {
      activeCustomers30d: activeCustomers,
      totalCustomers,
      activeRate: ((activeCustomers / Math.max(totalCustomers, 1)) * 100).toFixed(1) + '%',
    };
  }

  private async buildSearchQuery(question: GeneratedQuestion, state: DailyLearningJobState): Promise<string> {
    const prompt = `Convert this question into a Google search query (under 60 chars):
"${question.question}"
Focus on California cannabis market. Return ONLY the query.`;

    const response = await this.client.messages.create({
      model: CLAUDE_CONFIG.haiku,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    return textContent?.type === 'text' ? textContent.text.trim() : question.question;
  }

  private async analyzeSearchResults(
    state: DailyLearningJobState,
    question: string,
    results: SearchResult[]
  ): Promise<{ findings: Array<{ title: string; url: string; snippet: string; relevance: number; keyPoints: string[] }>; summary: string }> {
    if (results.length === 0) return { findings: [], summary: 'No new results found.' };

    const prompt = `Analyze search results for: "${question}"

Results:
${results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join('\n\n')}

Return JSON: { "findings": [{ "title": "", "url": "", "snippet": "", "relevance": 0-1, "keyPoints": [] }], "summary": "" }`;

    const response = await this.client.messages.create({
      model: CLAUDE_CONFIG.haiku,
      max_tokens: DAILY_LEARNING_CONFIG.phase3TokenBudget,
      messages: [{ role: 'user', content: prompt }],
    });

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { findings: [], summary: 'Failed to analyze results.' };

    return JSON.parse(jsonMatch[0]);
  }

  async getLatestDigest(): Promise<{
    digest: DailyDigestContent | null;
    job: { id: string; status: string; completedAt: Date | null } | null;
  }> {
    const latestJob = await prisma.dailyLearningJob.findFirst({
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' },
      include: { digest: true },
    });

    if (!latestJob || !latestJob.digest) return { digest: null, job: null };

    return {
      digest: {
        executiveSummary: latestJob.digest.executiveSummary,
        priorityActions: latestJob.digest.priorityActions as unknown as DailyDigestContent['priorityActions'],
        quickWins: latestJob.digest.quickWins as unknown as DailyDigestContent['quickWins'],
        watchItems: latestJob.digest.watchItems as unknown as DailyDigestContent['watchItems'],
        industryHighlights: latestJob.digest.industryHighlights as unknown as DailyDigestContent['industryHighlights'],
        regulatoryUpdates: latestJob.digest.regulatoryUpdates as unknown as DailyDigestContent['regulatoryUpdates'],
        marketTrends: latestJob.digest.marketTrends as unknown as DailyDigestContent['marketTrends'],
        questionsForTomorrow: latestJob.digest.questionsForTomorrow as unknown as DailyDigestContent['questionsForTomorrow'],
        correlatedInsights: latestJob.digest.correlatedInsights as unknown as DailyDigestContent['correlatedInsights'],
        dataHealthScore: latestJob.digest.dataHealthScore,
        confidenceScore: latestJob.digest.confidenceScore,
      },
      job: { id: latestJob.id, status: latestJob.status, completedAt: latestJob.completedAt },
    };
  }

  async getJobHistory(limit: number = 10): Promise<Array<{
    id: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    questionsGenerated: number;
    insightsDiscovered: number;
    searchesUsed: number;
    estimatedCost: number;
  }>> {
    const jobs = await prisma.dailyLearningJob.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return jobs.map(j => ({
      ...j,
      estimatedCost: parseFloat(j.estimatedCost.toString()),
    }));
  }

  async getCurrentJobStatus(): Promise<{
    isRunning: boolean;
    currentJob: { id: string; phase: string; startedAt: Date; progress: number } | null;
  }> {
    const runningJob = await prisma.dailyLearningJob.findFirst({
      where: { status: 'running' },
      orderBy: { startedAt: 'desc' },
    });

    if (!runningJob) return { isRunning: false, currentJob: null };

    const phases = [
      runningJob.dataReviewDone,
      runningJob.questionGenDone,
      runningJob.webResearchDone,
      runningJob.correlationDone,
      runningJob.digestGenDone,
    ];
    const progress = (phases.filter(Boolean).length / phases.length) * 100;

    return {
      isRunning: true,
      currentJob: {
        id: runningJob.id,
        phase: runningJob.currentPhase || 'starting',
        startedAt: runningJob.startedAt,
        progress,
      },
    };
  }
}

export const dailyLearningService = new DailyLearningService();
