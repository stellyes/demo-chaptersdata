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
import { saveInsights, InsightInput } from './knowledge-base';
import { dataCorrelationsService, CorrelationSummary } from './data-correlations';
import { CLAUDE_CONFIG } from '@/lib/config';

// Default org ID for autonomous learning (set via env var or use fallback)
const DEFAULT_LEARNING_ORG_ID = process.env.DEFAULT_ORG_ID || 'chapters-primary';

// Daily Learning Configuration
export const DAILY_LEARNING_CONFIG = {
  maxSearchesPerDay: 8,
  maxPagesPerSearch: 5,
  phase1TokenBudget: 8000,
  phase2TokenBudget: 10000, // Increased for expanded historical context
  phase3TokenBudget: 10000,
  phase4TokenBudget: 16000,
  phase5TokenBudget: 12000,
  questionsPerCycle: 10,
  maxWebResearchQuestions: 5,
  // Progressive learning settings
  maxPastQuestionsForContext: 50, // Expanded from 20 for deeper historical context
  maxPastInsightsForContext: 25, // Expanded from 10 for richer context
  maxPastDigestsForContext: 14, // 2 weeks of digests for trend analysis
  maxIndustryHighlightsForContext: 10, // NEW: Include industry news from past digests
  maxRegulatoryUpdatesForContext: 10, // NEW: Include regulatory updates from past digests
  maxCollectedUrlsForContext: 15, // NEW: Include analyzed web research URLs
  questionRepeatCooldownDays: 7, // Don't repeat questions asked within this period
  lowQualityThreshold: 0.4, // Questions below this quality may be re-asked
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

interface HistoricalLearningContext {
  pastQuestions: Array<{
    question: string;
    category: string;
    timesAsked: number;
    lastAsked: Date | null;
    answerQuality: number | null;
    isActive: boolean;
  }>;
  pastInsights: Array<{
    insight: string;
    category: string;
    confidence: number;
    digestDate: Date;
  }>;
  questionsForToday: Array<{
    question: string;
    priority: number;
    category: string;
  }>;
  recentlyAskedQuestions: string[]; // Questions asked within cooldown period (to avoid)
  // NEW: Industry and regulatory context from past digests
  industryHighlights: Array<{
    headline: string;
    source: string;
    relevance: string;
    actionItem?: string;
    digestDate: Date;
  }>;
  regulatoryUpdates: Array<{
    update: string;
    source: string;
    impactLevel: string;
    deadline?: string;
    digestDate: Date;
  }>;
  // NEW: Web research memory
  collectedUrls: Array<{
    title: string;
    url: string;
    snippet: string;
    domain: string;
    sourceQuery: string | null;
    relevanceScore: number;
    categories: string[];
  }>;
  // NEW: Monthly strategic context
  monthlyStrategicQuestions: Array<{
    question: string;
    priority: number;
  }>;
  strategicPriorities: Array<{
    priority: string;
    timeline?: string;
  }>;
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

      const digestData = {
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
      };

      const digestRecord = await prisma.dailyDigest.upsert({
        where: { digestDate: today },
        create: { digestDate: today, ...digestData },
        update: digestData,
      });

      // Clear any existing job's link to this digest (unique constraint)
      await prisma.dailyLearningJob.updateMany({
        where: { digestId: digestRecord.id, id: { not: state.jobId } },
        data: { digestId: null },
      });

      // NEW: Extract and save insights to BusinessInsight table for persistent knowledge
      const savedInsightsCount = await this.extractAndSaveInsights(digest, state.jobId);
      console.log(`Saved ${savedInsightsCount} insights to knowledge base`);

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
    // Load all data sources in parallel, including cross-table correlations
    const [
      salesData,
      brandData,
      customerData,
      invoiceData,
      qrData,
      seoData,
      budtenderData,
      productData,
      researchData,
      correlationSummary,
    ] = await Promise.all([
      this.loadRecentSalesData(),
      this.loadRecentBrandData(),
      this.loadRecentCustomerData(),
      this.loadRecentInvoiceData(),
      this.loadQrCodeData(),
      this.loadSeoAuditData(),
      this.loadBudtenderData(),
      this.loadProductData(),
      this.loadResearchData(),
      dataCorrelationsService.getCorrelationSummaryForAI(),
    ]);

    const prompt = `Analyze business data for San Francisco cannabis dispensaries.

## INDIVIDUAL DATA SOURCES

SALES DATA: ${JSON.stringify(salesData, null, 2)}
BRAND DATA: ${JSON.stringify(brandData, null, 2)}
CUSTOMER DATA: ${JSON.stringify(customerData, null, 2)}
INVOICE/PURCHASING DATA: ${JSON.stringify(invoiceData, null, 2)}
BUDTENDER PERFORMANCE: ${JSON.stringify(budtenderData, null, 2)}
PRODUCT CATEGORY DATA: ${JSON.stringify(productData, null, 2)}
MARKET RESEARCH: ${JSON.stringify(researchData, null, 2)}
QR CODE ENGAGEMENT: ${JSON.stringify(qrData, null, 2)}
WEBSITE SEO DATA: ${JSON.stringify(seoData, null, 2)}

## CROSS-TABLE CORRELATIONS & ANALYTICS
The following links data across multiple tables to reveal deeper insights:

${correlationSummary}

## ANALYSIS INSTRUCTIONS
1. Look for correlations between purchasing costs and sales revenue by brand
2. Identify which product categories have the best markup ratios
3. Note any discrepancies between vendor costs and sales performance
4. Identify customer segments that may need attention (at-risk, lapsed)
5. Look for patterns in dates with regulatory events vs sales performance
6. Cross-reference the knowledge base insights with current data

Return JSON:
{
  "summary": "Brief overview including key cross-table insights",
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
    // Fetch historical learning context for progressive question generation
    const [historicalContext, lowQualityToRevisit] = await Promise.all([
      this.getHistoricalLearningContext(),
      this.getLowQualityQuestionsToRevisit(),
    ]);

    // Build progressive learning context section
    const progressiveContext = this.buildProgressiveLearningPrompt(
      historicalContext,
      lowQualityToRevisit
    );

    const prompt = `Generate ${DAILY_LEARNING_CONFIG.questionsPerCycle} analytical questions for cannabis dispensary analysis.

## CURRENT DATA ANALYSIS
Data Review: ${dataReview.summary}
Concerns: ${dataReview.areasOfConcern.join(', ')}
Opportunities: ${dataReview.areasOfOpportunity.join(', ')}
Suggested Topics: ${dataReview.suggestedQuestionTopics.join(', ')}

${progressiveContext}

## INSTRUCTIONS
1. PRIORITIZE questions suggested from previous learning cycles (questionsForToday) - include at least 2-3 of these if they're still relevant
2. AVOID questions that are too similar to recently asked questions (within ${DAILY_LEARNING_CONFIG.questionRepeatCooldownDays} days)
3. INCLUDE at least 1-2 questions that follow up on past insights to deepen understanding
4. CONSIDER re-asking low-quality questions in a different way to get better answers
5. MIX question types: some building on past learnings, some exploring new areas from current data
6. Each question should be specific, actionable, and tied to business outcomes

Return JSON array:
[{ "question": "", "category": "sales|brands|customers|market|regulatory|operations", "priority": 1-10, "requiresWebResearch": boolean, "requiresInternalData": boolean, "context": "why this question matters based on learning history" }]`;

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

    // Update question tracking in database with enhanced metadata
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
          timesAsked: 1,
          lastAsked: new Date(),
        },
        update: {
          priority: q.priority,
          isActive: true,
          timesAsked: { increment: 1 },
          lastAsked: new Date(),
        },
      });
    }

    return questions;
  }

  /**
   * Builds the progressive learning section of the prompt with historical context
   */
  private buildProgressiveLearningPrompt(
    context: HistoricalLearningContext,
    lowQualityToRevisit: string[]
  ): string {
    const sections: string[] = [];

    // Monthly strategic questions (highest priority - from strategic analysis)
    if (context.monthlyStrategicQuestions.length > 0) {
      sections.push(`## STRATEGIC QUESTIONS FROM MONTHLY ANALYSIS
These questions were identified as strategically important for deep investigation:
${context.monthlyStrategicQuestions
  .slice(0, 5)
  .map((q, i) => `${i + 1}. [Strategic Priority ${q.priority}] ${q.question}`)
  .join('\n')}
IMPORTANT: At least 1-2 questions should address these strategic concerns.`);
    }

    // Questions suggested from previous day's digest
    if (context.questionsForToday.length > 0) {
      sections.push(`## QUESTIONS SUGGESTED FROM PREVIOUS LEARNING CYCLE
These questions were flagged as important to investigate today:
${context.questionsForToday
  .map((q, i) => `${i + 1}. [Priority ${q.priority}] ${q.question} (${q.category})`)
  .join('\n')}`);
    }

    // Past insights to build upon
    if (context.pastInsights.length > 0) {
      sections.push(`## PAST INSIGHTS TO BUILD UPON
Recent discoveries that may warrant deeper investigation:
${context.pastInsights
  .slice(0, 8)
  .map((insight, i) => `${i + 1}. [${insight.category}] ${insight.insight} (confidence: ${(insight.confidence * 100).toFixed(0)}%)`)
  .join('\n')}`);
    }

    // Industry highlights - external knowledge we've gathered
    if (context.industryHighlights.length > 0) {
      sections.push(`## INDUSTRY KNOWLEDGE FROM PREVIOUS RESEARCH
Recent industry developments we've tracked (use to inform questions):
${context.industryHighlights
  .slice(0, 6)
  .map((h, i) => `${i + 1}. ${h.headline} (Source: ${h.source})${h.actionItem ? ` - Action: ${h.actionItem}` : ''}`)
  .join('\n')}`);
    }

    // Regulatory updates - compliance and legal context
    if (context.regulatoryUpdates.length > 0) {
      sections.push(`## REGULATORY CONTEXT
Active regulatory updates to consider (may need follow-up questions):
${context.regulatoryUpdates
  .slice(0, 5)
  .map((r, i) => `${i + 1}. [${r.impactLevel.toUpperCase()}] ${r.update} (Source: ${r.source})${r.deadline ? ` Deadline: ${r.deadline}` : ''}`)
  .join('\n')}`);
    }

    // Web research memory - sources we've already researched
    if (context.collectedUrls.length > 0) {
      sections.push(`## WEB RESEARCH MEMORY
Sources we've already researched (reference when relevant, avoid redundant searches):
${context.collectedUrls
  .slice(0, 8)
  .map((u, i) => `${i + 1}. [${u.domain}] ${u.title || 'Untitled'} - "${u.snippet?.substring(0, 100)}..."`)
  .join('\n')}`);
    }

    // Strategic priorities from monthly analysis
    if (context.strategicPriorities.length > 0) {
      sections.push(`## CURRENT STRATEGIC PRIORITIES
Business priorities that should inform question generation:
${context.strategicPriorities
  .map((p, i) => `${i + 1}. ${p.priority}${p.timeline ? ` (Timeline: ${p.timeline})` : ''}`)
  .join('\n')}`);
    }

    // Questions to AVOID (recently asked with good quality)
    if (context.recentlyAskedQuestions.length > 0) {
      sections.push(`## QUESTIONS TO AVOID (recently asked within ${DAILY_LEARNING_CONFIG.questionRepeatCooldownDays} days)
Do NOT generate questions too similar to these:
${context.recentlyAskedQuestions.slice(0, 10).map((q, i) => `- ${q}`).join('\n')}`);
    }

    // Low quality questions to re-investigate differently
    if (lowQualityToRevisit.length > 0) {
      sections.push(`## QUESTIONS TO RE-INVESTIGATE (previous answers were low quality)
Consider asking these in a different way or breaking them into smaller parts:
${lowQualityToRevisit.map((q, i) => `- ${q}`).join('\n')}`);
    }

    // Historical question performance summary
    if (context.pastQuestions.length > 0) {
      const highPerformers = context.pastQuestions
        .filter(q => q.answerQuality !== null && q.answerQuality >= 0.7)
        .slice(0, 5);

      if (highPerformers.length > 0) {
        sections.push(`## HIGH-VALUE QUESTION PATTERNS (these yielded good insights)
Categories and styles that have worked well:
${highPerformers.map(q => `- [${q.category}] ${q.question.substring(0, 80)}...`).join('\n')}`);
      }
    }

    return sections.length > 0
      ? `## PROGRESSIVE LEARNING CONTEXT\n${sections.join('\n\n')}`
      : '## PROGRESSIVE LEARNING CONTEXT\nNo historical learning data available - this appears to be the first learning cycle.';
  }

  // ============================================
  // QUESTION THREADING METHODS
  // Enable investigation chains and follow-up questions
  // ============================================

  /**
   * Analyzes web research results to determine if the answer is partial
   * and identifies aspects that need further investigation.
   */
  private async identifyPartialAnswer(
    question: string,
    researchResults: WebResearchResult,
    state: DailyLearningJobState
  ): Promise<{
    isPartial: boolean;
    answerSummary: string;
    unansweredAspects: string[];
    suggestedFollowUps: string[];
    confidence: number;
  }> {
    const prompt = `Analyze if this research fully answers the question.

QUESTION: ${question}

RESEARCH FINDINGS:
${researchResults.findings.slice(0, 8).map((f, i) =>
  `${i + 1}. ${f.title}\n   ${f.snippet}\n   Key points: ${f.keyPoints.join('; ')}`
).join('\n\n')}

RESEARCH SUMMARY: ${researchResults.summary}

Analyze:
1. Does this research provide a complete answer to the question?
2. What aspects of the question remain unanswered or unclear?
3. What follow-up questions would help get a more complete answer?

Return JSON:
{
  "isPartial": boolean,
  "answerSummary": "2-3 sentence summary of what we learned",
  "unansweredAspects": ["aspect 1", "aspect 2"],
  "suggestedFollowUps": ["follow-up question 1", "follow-up question 2"],
  "confidence": 0.0-1.0
}

Return ONLY valid JSON.`;

    try {
      const response = await this.client.messages.create({
        model: CLAUDE_CONFIG.haiku,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });

      state.inputTokens += response.usage.input_tokens;
      state.outputTokens += response.usage.output_tokens;

      const textContent = response.content.find(c => c.type === 'text');
      const text = textContent?.type === 'text' ? textContent.text : '{}';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isPartial: parsed.isPartial ?? false,
          answerSummary: parsed.answerSummary ?? researchResults.summary,
          unansweredAspects: parsed.unansweredAspects ?? [],
          suggestedFollowUps: parsed.suggestedFollowUps ?? [],
          confidence: parsed.confidence ?? 0.5,
        };
      }
    } catch (error) {
      console.error('Error identifying partial answer:', error);
    }

    return {
      isPartial: false,
      answerSummary: researchResults.summary,
      unansweredAspects: [],
      suggestedFollowUps: [],
      confidence: 0.5,
    };
  }

  /**
   * Creates a follow-up question linked to a parent question.
   * Used to build investigation chains for deeper research.
   */
  private async createFollowUpQuestion(
    parentQuestionId: string,
    followUpText: string,
    reason: string,
    category: string
  ): Promise<string | null> {
    const { createHash } = await import('crypto');
    const questionHash = createHash('sha256')
      .update(followUpText.toLowerCase().trim())
      .digest('hex');

    // Get parent question to determine thread info
    const parent = await prisma.learningQuestion.findUnique({
      where: { id: parentQuestionId },
      select: { threadId: true, threadDepth: true },
    });

    if (!parent) return null;

    const threadId = parent.threadId || parentQuestionId;
    const threadDepth = (parent.threadDepth || 0) + 1;

    try {
      const question = await prisma.learningQuestion.upsert({
        where: { questionHash },
        create: {
          question: followUpText,
          questionHash,
          category,
          priority: 8, // High priority for follow-ups
          requiresWebResearch: true,
          requiresInternalData: true,
          generatedBy: 'follow_up',
          parentQuestionId,
          threadId,
          threadDepth,
          followUpReason: reason,
          timesAsked: 1,
          lastAsked: new Date(),
        },
        update: {
          priority: 8,
          isActive: true,
          timesAsked: { increment: 1 },
          lastAsked: new Date(),
        },
      });

      // Update parent question status
      await prisma.learningQuestion.update({
        where: { id: parentQuestionId },
        data: {
          threadStatus: 'needs_followup',
          threadId: threadId,
        },
      });

      return question.id;
    } catch (error) {
      console.error('Error creating follow-up question:', error);
      return null;
    }
  }

  /**
   * Gets active investigation threads that need follow-up.
   */
  private async getActiveInvestigationThreads(): Promise<Array<{
    threadId: string;
    rootQuestion: string;
    currentDepth: number;
    lastQuestion: string;
    status: string;
    unansweredAspects: string[];
  }>> {
    // Get questions that are part of active threads needing follow-up
    const activeThreads = await prisma.learningQuestion.findMany({
      where: {
        isActive: true,
        threadStatus: 'needs_followup',
        threadDepth: { lte: 3 }, // Max depth of 3 to prevent infinite chains
      },
      orderBy: { lastAsked: 'desc' },
      take: 5,
      select: {
        id: true,
        question: true,
        threadId: true,
        threadDepth: true,
        threadStatus: true,
        answerSummary: true,
        followUpReason: true,
        parentQuestion: {
          select: { question: true },
        },
      },
    });

    return activeThreads.map(t => ({
      threadId: t.threadId || t.id,
      rootQuestion: t.parentQuestion?.question || t.question,
      currentDepth: t.threadDepth,
      lastQuestion: t.question,
      status: t.threadStatus,
      unansweredAspects: t.followUpReason ? [t.followUpReason] : [],
    }));
  }

  /**
   * Updates a question with answer information after research.
   */
  private async updateQuestionWithAnswer(
    questionHash: string,
    answerSummary: string,
    isPartial: boolean,
    confidence: number
  ): Promise<void> {
    try {
      await prisma.learningQuestion.update({
        where: { questionHash },
        data: {
          answerSummary,
          partialAnswer: isPartial,
          answerQuality: confidence,
          lastAnswered: new Date(),
          threadStatus: isPartial ? 'needs_followup' : 'answered',
        },
      });
    } catch (error) {
      console.error('Error updating question with answer:', error);
    }
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

        const result: WebResearchResult = {
          question: question.question,
          searchQuery,
          findings: analysis.findings,
          summary: analysis.summary,
        };

        results.push(result);

        // Update question quality based on research results
        await this.updateQuestionQuality(question.question, analysis);

        // NEW: Detect partial answers and create follow-up questions
        if (analysis.findings.length > 0) {
          const partialAnalysis = await this.identifyPartialAnswer(
            question.question,
            result,
            state
          );

          // Get question hash for database updates
          const questionHash = this.hashString(question.question.toLowerCase());

          // Update question with answer details
          await this.updateQuestionWithAnswer(
            questionHash,
            partialAnalysis.answerSummary,
            partialAnalysis.isPartial,
            partialAnalysis.confidence
          );

          // Create follow-up questions if answer is partial
          if (partialAnalysis.isPartial && partialAnalysis.suggestedFollowUps.length > 0) {
            const parentQuestion = await prisma.learningQuestion.findUnique({
              where: { questionHash },
              select: { id: true },
            });

            if (parentQuestion) {
              // Create top 2 follow-up questions (to avoid explosion)
              for (const followUp of partialAnalysis.suggestedFollowUps.slice(0, 2)) {
                await this.createFollowUpQuestion(
                  parentQuestion.id,
                  followUp,
                  partialAnalysis.unansweredAspects.join('; '),
                  question.category
                );
              }
              console.log(`Created ${Math.min(2, partialAnalysis.suggestedFollowUps.length)} follow-up questions for partial answer`);
            }
          }
        }
      } catch (error) {
        console.error(`Error searching for question: ${question.question}`, error);
      }
    }

    return results;
  }

  /**
   * Updates question quality score based on research results.
   * This creates a feedback loop for progressive learning.
   */
  private async updateQuestionQuality(
    questionText: string,
    analysis: { findings: Array<{ relevance: number }>; summary: string }
  ): Promise<void> {
    const questionHash = this.hashString(questionText.toLowerCase());

    // Calculate quality score based on:
    // 1. Number of relevant findings
    // 2. Average relevance score
    // 3. Summary length (proxy for depth of answer)
    const findingsCount = analysis.findings.length;
    const avgRelevance = findingsCount > 0
      ? analysis.findings.reduce((sum, f) => sum + f.relevance, 0) / findingsCount
      : 0;
    const summaryDepth = Math.min(analysis.summary.length / 500, 1); // Max 1.0 for 500+ chars

    // Weighted quality score
    const qualityScore = (
      (findingsCount > 0 ? 0.3 : 0) + // Found any results
      (avgRelevance * 0.4) + // Relevance quality
      (summaryDepth * 0.3) // Depth of answer
    );

    try {
      await prisma.learningQuestion.update({
        where: { questionHash },
        data: {
          answerQuality: qualityScore,
          lastAnswered: new Date(),
        },
      });
    } catch {
      // Question may not exist if it was new this cycle - that's okay
    }
  }

  private async phase4Correlation(
    state: DailyLearningJobState,
    dataReview: DataReviewResult,
    webResearchResults: WebResearchResult[]
  ): Promise<CorrelatedInsight[]> {
    // Load structured correlation data for deep analysis
    const correlations = await dataCorrelationsService.getAllCorrelations();

    // Build correlation insights summary
    const correlationInsights = this.buildCorrelationInsights(correlations);

    if (webResearchResults.length === 0) {
      // Even without web research, use cross-table correlations for insights
      const internalInsights = dataReview.areasOfConcern.map(concern => ({
        internalObservation: concern,
        externalEvidence: 'Internal cross-table analysis',
        correlation: 'identifies' as const,
        confidence: 0.7,
        actionItem: `Investigate: ${concern}`,
        category: 'operations',
      }));

      // Add insights from cross-table correlations
      const crossTableInsights = this.extractCrossTableInsights(correlations);
      return [...internalInsights, ...crossTableInsights];
    }

    const prompt = `Correlate internal data with external research for cannabis dispensaries.

## INTERNAL DATA SUMMARY
${dataReview.summary}

## AREAS OF CONCERN
${dataReview.areasOfConcern.join('\n')}

## CROSS-TABLE CORRELATION INSIGHTS
These insights were derived from linking data across multiple database tables:

${correlationInsights}

## EXTERNAL RESEARCH FINDINGS
${webResearchResults.map(r => `Q: ${r.question}\nSummary: ${r.summary}`).join('\n\n')}

## ANALYSIS INSTRUCTIONS
1. Correlate internal business performance with external market trends
2. Link brand profitability insights with industry news about those brands
3. Connect customer segment data with market research on consumer behavior
4. Relate purchasing patterns with vendor/supply chain news
5. Match regulatory updates with compliance-related internal data

For each correlation, explain HOW the internal data connects to external evidence.

Return JSON array:
[{
  "internalObservation": "specific finding from internal data or cross-table analysis",
  "externalEvidence": "supporting external research or market trend",
  "correlation": "supports|contradicts|explains|validates|warns",
  "confidence": 0.0-1.0,
  "actionItem": "specific recommended action",
  "category": "sales|brands|customers|market|regulatory|operations|purchasing"
}]

Generate 5-10 high-quality correlations.`;

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

  /**
   * Build a text summary of correlation insights for AI prompts
   */
  private buildCorrelationInsights(correlations: CorrelationSummary): string {
    const insights: string[] = [];

    // Brand profitability insights
    if (correlations.brandProfitability.length > 0) {
      const topProfit = correlations.brandProfitability[0];
      const lowProfit = correlations.brandProfitability
        .filter(b => b.markupRatio > 0 && b.markupRatio < 1.5)
        .slice(0, 3);

      insights.push(`BRAND PROFITABILITY:
- Top performer: ${topProfit.brandName} with ${topProfit.markupRatio.toFixed(2)}x markup ($${topProfit.totalPurchaseCost.toFixed(0)} cost → $${topProfit.totalNetSales.toFixed(0)} sales)
${lowProfit.length > 0 ? `- Low margin brands needing review: ${lowProfit.map(b => `${b.brandName} (${b.markupRatio.toFixed(2)}x)`).join(', ')}` : ''}`);
    }

    // Product category insights
    if (correlations.productCategoryFlow.length > 0) {
      const categories = correlations.productCategoryFlow.slice(0, 5);
      insights.push(`PRODUCT CATEGORY FLOW:
${categories.map(c => `- ${c.productType}: ${c.markupRatio.toFixed(2)}x markup, ${c.pctOfTotalSales.toFixed(1)}% of sales`).join('\n')}`);
    }

    // Customer segment insights
    if (correlations.customerSegments.length > 0) {
      const atRiskTotal = correlations.customerSegments.reduce((sum, s) => sum + s.atRiskCount, 0);
      const lapsedTotal = correlations.customerSegments.reduce((sum, s) => sum + s.lapsedCount, 0);
      insights.push(`CUSTOMER HEALTH:
- At-risk customers: ${atRiskTotal}
- Lapsed customers: ${lapsedTotal}
- Top segment: ${correlations.customerSegments[0]?.segment} (${correlations.customerSegments[0]?.customerCount} customers)`);
    }

    // Vendor concentration insights
    if (correlations.vendorPerformance.length > 0) {
      const topVendor = correlations.vendorPerformance[0];
      const totalPurchasing = correlations.vendorPerformance.reduce((sum, v) => sum + v.totalPurchaseCost, 0);
      const topVendorPct = (topVendor.totalPurchaseCost / totalPurchasing) * 100;

      insights.push(`VENDOR CONCENTRATION:
- Top vendor: ${topVendor.vendorName} (${topVendorPct.toFixed(1)}% of purchasing, ${topVendor.brandCount} brands)
- Reorder frequency: ${topVendor.avgDaysBetweenOrders.toFixed(0)} days average`);
    }

    return insights.join('\n\n');
  }

  /**
   * Extract actionable insights from cross-table correlations
   */
  private extractCrossTableInsights(correlations: CorrelationSummary): CorrelatedInsight[] {
    const insights: CorrelatedInsight[] = [];

    // Identify low-margin brands
    const lowMarginBrands = correlations.brandProfitability.filter(b => b.markupRatio > 0 && b.markupRatio < 1.3);
    if (lowMarginBrands.length > 0) {
      insights.push({
        internalObservation: `${lowMarginBrands.length} brands have markup ratios below 1.3x: ${lowMarginBrands.slice(0, 3).map(b => b.brandName).join(', ')}`,
        externalEvidence: 'Cross-table analysis of purchase costs vs sales revenue',
        correlation: 'identifies',
        confidence: 0.85,
        actionItem: 'Review pricing or vendor negotiations for low-margin brands',
        category: 'purchasing',
      });
    }

    // Identify at-risk customer segments
    const totalAtRisk = correlations.customerSegments.reduce((sum, s) => sum + s.atRiskCount, 0);
    if (totalAtRisk > 50) {
      insights.push({
        internalObservation: `${totalAtRisk} customers are in "at-risk" status across all segments`,
        externalEvidence: 'Customer recency and visit pattern analysis',
        correlation: 'warns',
        confidence: 0.8,
        actionItem: 'Launch re-engagement campaign targeting at-risk customers',
        category: 'customers',
      });
    }

    // Identify vendor concentration risk
    if (correlations.vendorPerformance.length > 0) {
      const totalPurchasing = correlations.vendorPerformance.reduce((sum, v) => sum + v.totalPurchaseCost, 0);
      const topVendor = correlations.vendorPerformance[0];
      const concentration = (topVendor.totalPurchaseCost / totalPurchasing) * 100;

      if (concentration > 40) {
        insights.push({
          internalObservation: `${topVendor.vendorName} accounts for ${concentration.toFixed(1)}% of all purchasing`,
          externalEvidence: 'Vendor-invoice correlation analysis',
          correlation: 'warns',
          confidence: 0.75,
          actionItem: 'Consider diversifying vendor relationships to reduce supply chain risk',
          category: 'purchasing',
        });
      }
    }

    // Identify high-performing product categories
    const topCategory = correlations.productCategoryFlow.find(c => c.markupRatio > 2);
    if (topCategory) {
      insights.push({
        internalObservation: `${topCategory.productType} has exceptional markup ratio of ${topCategory.markupRatio.toFixed(2)}x`,
        externalEvidence: 'Purchase-to-sales flow analysis by category',
        correlation: 'validates',
        confidence: 0.9,
        actionItem: `Consider expanding ${topCategory.productType} inventory and marketing`,
        category: 'sales',
      });
    }

    return insights;
  }

  private async phase5DigestGeneration(
    state: DailyLearningJobState,
    dataReview: DataReviewResult,
    questions: GeneratedQuestion[],
    webResearchResults: WebResearchResult[],
    correlatedInsights: CorrelatedInsight[]
  ): Promise<DailyDigestContent> {
    const prompt = `Generate a daily business intelligence digest for cannabis dispensaries based on the provided data.

DATA REVIEW:
${JSON.stringify(dataReview, null, 2)}

GENERATED QUESTIONS (${questions.length}):
${questions.map(q => `- ${q.question} [${q.category}]`).join('\n')}

WEB RESEARCH FINDINGS:
${webResearchResults.length > 0 ? webResearchResults.map(r => `Query: ${r.searchQuery}\nSummary: ${r.summary}`).join('\n\n') : 'No web research conducted (quick run mode)'}

CORRELATED INSIGHTS (${correlatedInsights.length}):
${correlatedInsights.map(i => `- ${i.correlation} (confidence: ${i.confidence})`).join('\n')}

Return a JSON object with this EXACT structure (all arrays must contain objects with the specified properties):

{
  "executiveSummary": "string - 2-3 paragraph executive summary",
  "priorityActions": [
    { "action": "string - what to do", "timeframe": "string - e.g. 'This week', '30 days'", "impact": "string - expected result", "category": "string - e.g. 'Operations', 'Marketing', 'Compliance'" }
  ],
  "quickWins": [
    { "action": "string - what to do", "effort": "string - e.g. 'Low', 'Medium'", "impact": "string - expected result" }
  ],
  "watchItems": [
    { "item": "string - what to monitor", "reason": "string - why it matters", "monitorUntil": "string - timeframe" }
  ],
  "industryHighlights": [
    { "headline": "string - news/trend headline", "source": "string - where from", "relevance": "string - why it matters", "actionItem": "string - optional suggested action" }
  ],
  "regulatoryUpdates": [
    { "update": "string - regulatory change", "source": "string - regulatory body", "impactLevel": "high|medium|low", "deadline": "string - optional date" }
  ],
  "marketTrends": [
    { "trend": "string - market trend", "evidence": "string - supporting data", "implication": "string - what it means for business" }
  ],
  "questionsForTomorrow": [
    { "question": "string - question to investigate", "priority": 1-5, "category": "string - topic area" }
  ],
  "correlatedInsights": [
    { "internalObservation": "string - what internal data shows", "externalEvidence": "string - supporting external info", "correlation": "string - the connection", "confidence": 0.0-1.0, "actionItem": "string - optional action", "category": "string - topic area" }
  ],
  "dataHealthScore": 0-100,
  "confidenceScore": 0.0-1.0
}

Generate 3-5 items for priorityActions, quickWins, watchItems, and questionsForTomorrow.
Generate 2-4 items for industryHighlights, regulatoryUpdates, marketTrends, and correlatedInsights.
If web research was not conducted, base industryHighlights, regulatoryUpdates, and marketTrends on general cannabis industry knowledge.
Return ONLY valid JSON, no markdown or explanation.`;

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

    // Load vendor-brand relationships (which vendors supply which brands)
    const vendorBrands = await prisma.vendorBrand.findMany({
      orderBy: { invoiceCount: 'desc' },
      take: 30,
      include: {
        vendor: true,
        brand: true,
      },
    });

    // Group by vendor to show which brands each vendor supplies
    const vendorBrandMap: Record<string, { brands: string[]; totalInvoices: number; totalUnits: number }> = {};
    for (const vb of vendorBrands) {
      const vendorName = vb.vendor.canonicalName;
      if (!vendorBrandMap[vendorName]) {
        vendorBrandMap[vendorName] = { brands: [], totalInvoices: 0, totalUnits: 0 };
      }
      vendorBrandMap[vendorName].brands.push(vb.brand.canonicalName);
      vendorBrandMap[vendorName].totalInvoices += vb.invoiceCount;
      vendorBrandMap[vendorName].totalUnits += vb.totalUnits;
    }

    // Group by brand to show which vendors supply each brand
    const brandVendorMap: Record<string, string[]> = {};
    for (const vb of vendorBrands) {
      const brandName = vb.brand.canonicalName;
      if (!brandVendorMap[brandName]) {
        brandVendorMap[brandName] = [];
      }
      brandVendorMap[brandName].push(vb.vendor.canonicalName);
    }

    return {
      topBrands: brandRecords.map(b => ({
        name: b.brand?.canonicalName || b.originalBrandName,
        netSales: parseFloat(b.netSales.toString()),
        suppliers: brandVendorMap[b.brand?.canonicalName || ''] || [],
      })),
      vendorBrandRelationships: Object.entries(vendorBrandMap).map(([vendor, data]) => ({
        vendor,
        brands: data.brands,
        totalInvoices: data.totalInvoices,
        totalUnits: data.totalUnits,
      })),
      totalVendorBrandLinks: vendorBrands.length,
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

  private async loadRecentInvoiceData(): Promise<Record<string, unknown>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const invoices = await prisma.invoice.findMany({
      where: { invoiceDate: { gte: thirtyDaysAgo } },
      include: {
        vendor: true,
        lineItems: {
          include: { brand: true },
        },
      },
      orderBy: { invoiceDate: 'desc' },
      take: 50,
    });

    const totalCost = invoices.reduce((sum, inv) => sum + parseFloat(inv.totalCost.toString()), 0);
    const vendorCounts: Record<string, number> = {};
    const brandCounts: Record<string, { count: number; cost: number; units: number }> = {};

    invoices.forEach(inv => {
      const vendorName = inv.vendor?.canonicalName || inv.originalVendorName || 'Unknown';
      vendorCounts[vendorName] = (vendorCounts[vendorName] || 0) + 1;

      // Track brands purchased
      inv.lineItems.forEach(item => {
        const brandName = item.brand?.canonicalName || item.originalBrandName || 'Unknown';
        if (!brandCounts[brandName]) {
          brandCounts[brandName] = { count: 0, cost: 0, units: 0 };
        }
        brandCounts[brandName].count++;
        brandCounts[brandName].cost += parseFloat(item.totalCost.toString());
        brandCounts[brandName].units += item.skuUnits;
      });
    });

    const topVendors = Object.entries(vendorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, invoiceCount: count }));

    const topBrandsPurchased = Object.entries(brandCounts)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .slice(0, 10)
      .map(([name, data]) => ({
        name,
        lineItems: data.count,
        totalCost: data.cost.toFixed(2),
        units: data.units,
      }));

    return {
      recentInvoiceCount: invoices.length,
      totalPurchasingCost30d: totalCost.toFixed(2),
      topVendors,
      topBrandsPurchased,
      lineItemsCount: invoices.reduce((sum, inv) => sum + inv.lineItems.length, 0),
      lineItemsWithBrand: invoices.reduce((sum, inv) =>
        sum + inv.lineItems.filter(li => li.brandId !== null).length, 0),
    };
  }

  private async loadQrCodeData(): Promise<Record<string, unknown>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [totalCodes, activeCodes, recentClicks] = await Promise.all([
      prisma.qrCode.count({ where: { deleted: false } }),
      prisma.qrCode.count({ where: { active: true, deleted: false } }),
      prisma.qrClick.count({ where: { clickedAt: { gte: thirtyDaysAgo } } }),
    ]);

    const topPerformers = await prisma.qrCode.findMany({
      where: { deleted: false },
      orderBy: { totalClicks: 'desc' },
      take: 5,
      select: { name: true, totalClicks: true, shortCode: true },
    });

    return {
      totalQrCodes: totalCodes,
      activeQrCodes: activeCodes,
      clicksLast30Days: recentClicks,
      topPerformers: topPerformers.map(qr => ({
        name: qr.name,
        clicks: qr.totalClicks,
      })),
    };
  }

  private async loadSeoAuditData(): Promise<Record<string, unknown>> {
    const latestAudit = await prisma.seoAudit.findFirst({
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' },
      include: {
        _count: { select: { pages: true } },
      },
    });

    if (!latestAudit || !latestAudit.summary) {
      return { auditAvailable: false };
    }

    const summary = latestAudit.summary as {
      healthScore?: number;
      totalIssues?: number;
      criticalIssues?: number;
    };

    return {
      auditAvailable: true,
      domain: latestAudit.domain,
      healthScore: summary.healthScore || 0,
      totalIssues: summary.totalIssues || 0,
      criticalIssues: summary.criticalIssues || 0,
      pagesAnalyzed: latestAudit._count.pages,
      lastAuditDate: latestAudit.completedAt?.toISOString().split('T')[0],
    };
  }

  private async loadBudtenderData(): Promise<Record<string, unknown>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const budtenderRecords = await prisma.budtenderRecord.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      orderBy: { date: 'desc' },
    });

    if (budtenderRecords.length === 0) {
      return { dataAvailable: false };
    }

    // Aggregate by employee
    const employeeStats: Record<string, {
      netSales: number;
      tickets: number;
      customers: number;
      units: number;
      days: number;
    }> = {};

    for (const record of budtenderRecords) {
      const name = record.employeeName;
      if (!employeeStats[name]) {
        employeeStats[name] = { netSales: 0, tickets: 0, customers: 0, units: 0, days: 0 };
      }
      employeeStats[name].netSales += Number(record.netSales);
      employeeStats[name].tickets += record.ticketsCount;
      employeeStats[name].customers += record.customersCount;
      employeeStats[name].units += record.unitsSold;
      employeeStats[name].days++;
    }

    // Rank by performance
    const rankedBudtenders = Object.entries(employeeStats)
      .map(([name, stats]) => ({
        name,
        totalNetSales: stats.netSales.toFixed(2),
        avgDailySales: (stats.netSales / Math.max(stats.days, 1)).toFixed(2),
        totalTickets: stats.tickets,
        avgTicketValue: stats.tickets > 0 ? (stats.netSales / stats.tickets).toFixed(2) : '0.00',
        daysWorked: stats.days,
      }))
      .sort((a, b) => parseFloat(b.totalNetSales) - parseFloat(a.totalNetSales));

    return {
      dataAvailable: true,
      periodDays: 30,
      totalBudtenders: rankedBudtenders.length,
      topPerformers: rankedBudtenders.slice(0, 5),
      bottomPerformers: rankedBudtenders.slice(-3),
      averageTicketValue: (
        rankedBudtenders.reduce((sum, b) => sum + parseFloat(b.avgTicketValue), 0) /
        Math.max(rankedBudtenders.length, 1)
      ).toFixed(2),
    };
  }

  private async loadProductData(): Promise<Record<string, unknown>> {
    // Get product category performance data
    const productRecords = await prisma.productRecord.findMany({
      orderBy: { netSales: 'desc' },
    });

    if (productRecords.length === 0) {
      return { dataAvailable: false };
    }

    // Aggregate by product type
    const productStats: Record<string, {
      netSales: number;
      marginPct: number;
      count: number;
    }> = {};

    for (const record of productRecords) {
      const type = record.productType;
      if (!productStats[type]) {
        productStats[type] = { netSales: 0, marginPct: 0, count: 0 };
      }
      productStats[type].netSales += Number(record.netSales);
      productStats[type].marginPct += Number(record.grossMarginPct);
      productStats[type].count++;
    }

    const totalSales = Object.values(productStats).reduce((sum, s) => sum + s.netSales, 0);

    const productCategories = Object.entries(productStats)
      .map(([type, stats]) => ({
        productType: type,
        netSales: stats.netSales.toFixed(2),
        percentOfTotal: ((stats.netSales / Math.max(totalSales, 1)) * 100).toFixed(1) + '%',
        avgMargin: (stats.marginPct / Math.max(stats.count, 1)).toFixed(1) + '%',
      }))
      .sort((a, b) => parseFloat(b.netSales) - parseFloat(a.netSales));

    return {
      dataAvailable: true,
      productCategories,
      topCategory: productCategories[0]?.productType || 'Unknown',
      categoryCount: productCategories.length,
    };
  }

  private async loadResearchData(): Promise<Record<string, unknown>> {
    // Load research documents and their key findings
    const researchDocs = await prisma.researchDocument.findMany({
      orderBy: { analyzedAt: 'desc' },
      take: 20,
      include: {
        findings: {
          where: { relevance: 'high' },
          orderBy: { actionRequired: 'desc' },
          take: 5,
        },
      },
    });

    if (researchDocs.length === 0) {
      return { dataAvailable: false };
    }

    // Group findings by category
    const findingsByCategory: Record<string, Array<{ finding: string; action?: string | null }>> = {};

    for (const doc of researchDocs) {
      for (const finding of doc.findings) {
        if (!findingsByCategory[finding.category]) {
          findingsByCategory[finding.category] = [];
        }
        findingsByCategory[finding.category].push({
          finding: finding.finding,
          action: finding.recommendedAction,
        });
      }
    }

    // Get action items requiring attention
    const actionItems = await prisma.researchFinding.findMany({
      where: {
        actionRequired: true,
        relevance: 'high',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { document: true },
    });

    return {
      dataAvailable: true,
      totalDocuments: researchDocs.length,
      recentDocuments: researchDocs.slice(0, 5).map(d => ({
        category: d.category,
        summary: d.summary.substring(0, 200) + '...',
        relevance: d.relevanceScore,
        analyzedAt: d.analyzedAt.toISOString().split('T')[0],
      })),
      findingsByCategory: Object.entries(findingsByCategory).map(([category, findings]) => ({
        category,
        findingsCount: findings.length,
        topFindings: findings.slice(0, 3),
      })),
      actionItemsCount: actionItems.length,
      priorityActions: actionItems.slice(0, 5).map(a => ({
        finding: a.finding.substring(0, 150) + '...',
        action: a.recommendedAction?.substring(0, 100) + '...',
        category: a.category,
      })),
    };
  }

  /**
   * Fetches historical learning context to inform progressive question generation.
   * Includes past questions, insights, industry highlights, regulatory updates,
   * collected URLs, and monthly strategic context for comprehensive learning.
   */
  private async getHistoricalLearningContext(): Promise<HistoricalLearningContext> {
    const cooldownDate = new Date();
    cooldownDate.setDate(cooldownDate.getDate() - DAILY_LEARNING_CONFIG.questionRepeatCooldownDays);

    // Fetch past questions with their performance data
    const pastQuestions = await prisma.learningQuestion.findMany({
      where: { isActive: true },
      orderBy: [
        { answerQuality: 'desc' },
        { timesAsked: 'asc' },
      ],
      take: DAILY_LEARNING_CONFIG.maxPastQuestionsForContext,
      select: {
        question: true,
        category: true,
        timesAsked: true,
        lastAsked: true,
        answerQuality: true,
        isActive: true,
      },
    });

    // Get questions asked recently (within cooldown) to avoid repetition
    const recentlyAskedQuestions = await prisma.learningQuestion.findMany({
      where: {
        lastAsked: { gte: cooldownDate },
        answerQuality: { gte: DAILY_LEARNING_CONFIG.lowQualityThreshold },
      },
      select: { question: true },
    });

    // Fetch past digests with expanded fields for industry/regulatory context
    const recentDigests = await prisma.dailyDigest.findMany({
      orderBy: { digestDate: 'desc' },
      take: DAILY_LEARNING_CONFIG.maxPastDigestsForContext,
      select: {
        digestDate: true,
        correlatedInsights: true,
        questionsForTomorrow: true,
        industryHighlights: true,
        regulatoryUpdates: true,
      },
    });

    // Extract insights from past digests
    const pastInsights: HistoricalLearningContext['pastInsights'] = [];
    for (const digest of recentDigests) {
      const insights = digest.correlatedInsights as CorrelatedInsight[] | null;
      if (insights && Array.isArray(insights)) {
        for (const insight of insights.slice(0, 3)) { // Top 3 insights per digest
          pastInsights.push({
            insight: insight.internalObservation + ' - ' + insight.correlation,
            category: insight.category,
            confidence: insight.confidence,
            digestDate: digest.digestDate,
          });
        }
      }
    }

    // Get suggested questions from the most recent digest (questionsForTomorrow)
    const questionsForToday: HistoricalLearningContext['questionsForToday'] = [];
    if (recentDigests.length > 0) {
      const latestDigest = recentDigests[0];
      const suggestedQuestions = latestDigest.questionsForTomorrow as Array<{
        question: string;
        priority: number;
        category: string;
      }> | null;

      if (suggestedQuestions && Array.isArray(suggestedQuestions)) {
        questionsForToday.push(...suggestedQuestions);
      }
    }

    // NEW: Extract industry highlights from past digests
    const industryHighlights: HistoricalLearningContext['industryHighlights'] = [];
    for (const digest of recentDigests) {
      const highlights = digest.industryHighlights as Array<{
        headline: string;
        source: string;
        relevance: string;
        actionItem?: string;
      }> | null;
      if (highlights && Array.isArray(highlights)) {
        for (const h of highlights.slice(0, 2)) { // Top 2 per digest
          industryHighlights.push({
            ...h,
            digestDate: digest.digestDate,
          });
        }
      }
    }

    // NEW: Extract regulatory updates from past digests
    const regulatoryUpdates: HistoricalLearningContext['regulatoryUpdates'] = [];
    for (const digest of recentDigests) {
      const updates = digest.regulatoryUpdates as Array<{
        update: string;
        source: string;
        impactLevel: string;
        deadline?: string;
      }> | null;
      if (updates && Array.isArray(updates)) {
        for (const u of updates) { // All regulatory updates (important to track)
          regulatoryUpdates.push({
            ...u,
            digestDate: digest.digestDate,
          });
        }
      }
    }

    // NEW: Fetch collected URLs with high relevance for web research memory
    const collectedUrls = await prisma.collectedUrl.findMany({
      where: {
        relevanceScore: { gte: 0.6 },
      },
      orderBy: [
        { relevanceScore: 'desc' },
        { createdAt: 'desc' },
      ],
      take: DAILY_LEARNING_CONFIG.maxCollectedUrlsForContext,
      select: {
        title: true,
        url: true,
        snippet: true,
        domain: true,
        sourceQuery: true,
        relevanceScore: true,
        categories: true,
      },
    });

    // NEW: Fetch monthly strategic context
    const { monthlyStrategicQuestions, strategicPriorities } = await this.getMonthlyStrategicContext();

    return {
      pastQuestions,
      pastInsights: pastInsights.slice(0, DAILY_LEARNING_CONFIG.maxPastInsightsForContext),
      questionsForToday,
      recentlyAskedQuestions: recentlyAskedQuestions.map(q => q.question),
      industryHighlights: industryHighlights.slice(0, DAILY_LEARNING_CONFIG.maxIndustryHighlightsForContext),
      regulatoryUpdates: regulatoryUpdates.slice(0, DAILY_LEARNING_CONFIG.maxRegulatoryUpdatesForContext),
      collectedUrls: collectedUrls.map(u => ({
        title: u.title || '',
        url: u.url,
        snippet: u.snippet || '',
        domain: u.domain,
        sourceQuery: u.sourceQuery,
        relevanceScore: u.relevanceScore,
        categories: u.categories,
      })),
      monthlyStrategicQuestions,
      strategicPriorities,
    };
  }

  /**
   * Fetches strategic context from the most recent monthly analysis.
   * Enables monthly insights to inform daily learning.
   */
  private async getMonthlyStrategicContext(): Promise<{
    monthlyStrategicQuestions: HistoricalLearningContext['monthlyStrategicQuestions'];
    strategicPriorities: HistoricalLearningContext['strategicPriorities'];
  }> {
    const latestReport = await prisma.monthlyStrategicReport.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        keyQuestionsNext: true,
        strategicPriorities: true,
      },
    });

    if (!latestReport) {
      return { monthlyStrategicQuestions: [], strategicPriorities: [] };
    }

    const keyQuestions = latestReport.keyQuestionsNext as Array<{
      question: string;
      priority: number;
    }> | null;

    const priorities = latestReport.strategicPriorities as Array<{
      priority: string;
      timeline?: string;
      rationale?: string;
    }> | null;

    return {
      monthlyStrategicQuestions: keyQuestions || [],
      strategicPriorities: (priorities || []).slice(0, 5).map(p => ({
        priority: p.priority,
        timeline: p.timeline,
      })),
    };
  }

  /**
   * Identifies low-quality questions that should be re-investigated
   */
  private async getLowQualityQuestionsToRevisit(): Promise<string[]> {
    const lowQualityQuestions = await prisma.learningQuestion.findMany({
      where: {
        isActive: true,
        answerQuality: { lt: DAILY_LEARNING_CONFIG.lowQualityThreshold },
        timesAsked: { gte: 1 },
      },
      orderBy: { answerQuality: 'asc' },
      take: 3,
      select: { question: true },
    });

    return lowQualityQuestions.map(q => q.question);
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

  /**
   * Extracts insights from the daily digest and saves them to the BusinessInsight table.
   * This enables persistent knowledge that accumulates over time.
   */
  private async extractAndSaveInsights(
    digest: DailyDigestContent,
    jobId: string
  ): Promise<number> {
    const insightsToSave: InsightInput[] = [];
    const source = `daily-learning-${jobId}`;

    // Extract from high-confidence correlated insights
    for (const ci of digest.correlatedInsights) {
      if (ci.confidence >= 0.7) {
        insightsToSave.push({
          category: ci.category || 'general',
          subcategory: 'correlated_insight',
          insight: `${ci.internalObservation} - ${ci.correlation}: ${ci.externalEvidence}`,
          confidence: ci.confidence >= 0.85 ? 'high' : 'medium',
          source,
          sourceData: ci.actionItem || undefined,
          expiresAt: this.calculateExpirationDate(ci.category || 'general'),
        });
      }
    }

    // Extract from market trends
    for (const trend of digest.marketTrends) {
      insightsToSave.push({
        category: 'market',
        subcategory: 'trend',
        insight: `${trend.trend}: ${trend.implication}`,
        confidence: 'medium',
        source,
        sourceData: trend.evidence,
        expiresAt: this.calculateExpirationDate('market'),
      });
    }

    // Extract from high-impact regulatory updates
    for (const reg of digest.regulatoryUpdates) {
      if (reg.impactLevel === 'high') {
        // Safely parse deadline - it might be text like "soon" or "TBD" instead of a date
        let expiresAt = this.calculateExpirationDate('regulatory');
        if (reg.deadline) {
          const parsedDate = new Date(reg.deadline);
          if (!isNaN(parsedDate.getTime())) {
            expiresAt = parsedDate;
          }
        }

        insightsToSave.push({
          category: 'regulatory',
          subcategory: 'update',
          insight: reg.update,
          confidence: 'high',
          source: reg.source || source,
          expiresAt,
        });
      }
    }

    // Extract from priority actions (high confidence items only)
    for (const action of digest.priorityActions.slice(0, 3)) {
      insightsToSave.push({
        category: action.category || 'operations',
        subcategory: 'action_item',
        insight: `${action.action} (Impact: ${action.impact}, Timeframe: ${action.timeframe})`,
        confidence: 'medium',
        source,
        expiresAt: this.calculateExpirationDate(action.category || 'operations'),
      });
    }

    if (insightsToSave.length === 0) {
      return 0;
    }

    return await saveInsights(insightsToSave);
  }

  /**
   * Calculates the expiration date for insights based on their category.
   * Different insight types have different relevance windows.
   */
  private calculateExpirationDate(category: string): Date {
    const now = new Date();
    switch (category.toLowerCase()) {
      case 'regulatory':
        // Regulatory insights stay relevant for 6 months
        return new Date(now.setMonth(now.getMonth() + 6));
      case 'market':
        // Market insights valid for 3 months
        return new Date(now.setMonth(now.getMonth() + 3));
      case 'sales':
        // Sales insights valid for 1 month
        return new Date(now.setMonth(now.getMonth() + 1));
      case 'brands':
      case 'products':
        // Brand/product insights valid for 2 months
        return new Date(now.setMonth(now.getMonth() + 2));
      case 'customers':
        // Customer insights valid for 2 months
        return new Date(now.setMonth(now.getMonth() + 2));
      default:
        // Default: 3 months
        return new Date(now.setMonth(now.getMonth() + 3));
    }
  }
}

export const dailyLearningService = new DailyLearningService();
