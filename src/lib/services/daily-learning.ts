// ============================================
// DAILY LEARNING SERVICE
// Autonomous daily learning that reviews data,
// generates questions, researches the web, and
// produces actionable daily digests
// ============================================

import Anthropic from '@anthropic-ai/sdk';
import { prisma, initializePrisma } from '@/lib/prisma';
import { getAnthropicClient } from './claude';
import { webSearchService, SearchResult } from './web-search';
import { saveInsights, InsightInput } from './knowledge-base';
import { dataCorrelationsService, CorrelationSummary } from './data-correlations';
import { CLAUDE_CONFIG } from '@/lib/config';
import { parseClaudeJson, ParseJsonResult } from '@/lib/utils/json-response';

// Default org ID for autonomous learning (set via env var or use fallback)
const DEFAULT_LEARNING_ORG_ID = process.env.DEFAULT_ORG_ID || 'chapters-primary';

// Timeout for database queries (60 seconds)
const QUERY_TIMEOUT_MS = 60000;

// Timeout for Claude API calls (2 minutes per attempt - shorter for retry)
const CLAUDE_API_TIMEOUT_MS = 2 * 60 * 1000;

// Overall Phase 1 timeout (5 minutes) - prevents indefinite stalls
// Phase 1 includes: 11 sequential data loads + correlation summary + Claude analysis
const PHASE1_OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

// Max retries for Claude API calls
const CLAUDE_API_MAX_RETRIES = 3;

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

// Safe query helper with timeout and default fallback
async function safeQuery<T>(
  queryFn: () => Promise<T>,
  defaultValue: T,
  operationName: string
): Promise<T> {
  const start = Date.now();
  try {
    const result = await withTimeout(queryFn(), QUERY_TIMEOUT_MS, operationName);
    console.log(`[safeQuery] ✓ ${operationName} completed in ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    console.warn(`[safeQuery] ✗ ${operationName} FAILED after ${elapsed}ms:`, error instanceof Error ? error.message : error);
    return defaultValue;
  }
}

// Retry helper with exponential backoff for Claude API calls
async function withRetry<T>(
  fn: () => Promise<T>,
  operationName: string,
  maxRetries: number = CLAUDE_API_MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`${operationName}: attempt ${attempt}/${maxRetries}`);
      return await withTimeout(fn(), CLAUDE_API_TIMEOUT_MS, `${operationName} (attempt ${attempt})`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`${operationName}: attempt ${attempt} failed:`, lastError.message);

      // Don't wait after the last attempt
      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s...
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`${operationName}: waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`${operationName} failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
}

// Daily Learning Configuration
export const DAILY_LEARNING_CONFIG = {
  maxSearchesPerDay: 30, // Generous budget: 1000/month ≈ 33/day
  maxPagesPerSearch: 5,
  // ISSUE #5 FIX: Increased token budgets for better JSON response quality & accuracy
  phase1TokenBudget: 16000, // Doubled: large data input requires space for thorough analysis
  phase2TokenBudget: 12000, // Increased: progressive context continues to grow
  phase3TokenBudget: 12000, // Increased: better analysis of search results
  phase4TokenBudget: 20000, // Increased: complex cross-correlation work (Sonnet)
  phase5TokenBudget: 16000, // Increased: critical digest output quality
  questionsPerCycle: 10,
  maxWebResearchQuestions: 10, // Increased: more thorough research coverage
  // Progressive learning settings
  maxPastQuestionsForContext: 50, // Expanded from 20 for deeper historical context
  maxPastInsightsForContext: 25, // Expanded from 10 for richer context
  maxPastDigestsForContext: 14, // 2 weeks of digests for trend analysis
  maxIndustryHighlightsForContext: 10, // NEW: Include industry news from past digests
  maxRegulatoryUpdatesForContext: 10, // NEW: Include regulatory updates from past digests
  maxCollectedUrlsForContext: 15, // NEW: Include analyzed web research URLs
  maxPastInvestigationsForContext: 10, // Include recent investigations for learning continuity
  questionRepeatCooldownDays: 7, // Don't repeat questions asked within this period
  lowQualityThreshold: 0.4, // Questions below this quality may be re-asked
};

// ISSUE #5 FIX: System prompt for enforcing valid JSON responses
const JSON_SYSTEM_PROMPT = `You are a precise cannabis retail data analyst. Your responses must be valid JSON only.

CRITICAL JSON RULES:
1. Return ONLY valid JSON - no markdown, no code blocks, no explanation text
2. Start your response with { or [ as appropriate
3. Ensure all strings are properly escaped (use \\" for quotes inside strings)
4. Do not include any text before or after the JSON
5. All property names must be in double quotes
6. Do not truncate your response - complete the full JSON structure`;

// ISSUE #9: Phase metric interface for structured observability
export interface PhaseMetric {
  phase: string;
  status: 'success' | 'failed' | 'skipped';
  startTime: string;
  endTime?: string;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  // Phase-specific data
  dataSources?: {
    loaded: string[];
    failed: string[];
  };
  itemsProcessed?: number; // questions generated, insights found, etc.
}

// Job metadata for tracking runtime state and quota issues
export interface JobMetadata {
  webResearchSkipped: boolean;
  webResearchSkipReason?: 'quota_exhausted' | 'api_key_missing' | 'user_requested' | 'low_quota';
  quotaAtStart?: number;
  quotaWarning?: string;
  envValidation?: {
    validated: boolean;
    timestamp: string;
    skippedChecks?: string[];
  };
  phaseTimings?: Record<string, { start: string; end?: string; durationMs?: number }>;
  // ISSUE #5 FIX: Track JSON parse issues for observability
  jsonParseIssues?: Array<{
    phase: string;
    timestamp: string;
    fallbackUsed: boolean;
    error?: string;
  }>;
  // ISSUE #9 FIX: Structured phase metrics for observability
  phaseMetrics?: PhaseMetric[];
  // ISSUE #9 FIX: Overall job health summary
  healthSummary?: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
    phasesSucceeded: number;
    phasesFailed: number;
    phasesSkipped: number;
    dataSourcesLoaded: number;
    dataSourcesFailed: number;
  };
}

interface DailyLearningJobState {
  jobId: string;
  inputTokens: number;
  outputTokens: number;
  searchesUsed: number;
  metadata: JobMetadata;
}

// ============================================
// LOG CAPTURE SYSTEM
// Intercepts console.log/warn/error during job execution
// to provide real-time log streaming via the status API.
// Stores last N log entries in-memory and periodically
// flushes them to the job's metadata in the database.
// ============================================
const LOG_BUFFER_MAX_SIZE = 200; // Keep last 200 log entries

interface LogEntry {
  ts: string;    // ISO timestamp
  level: 'info' | 'warn' | 'error';
  msg: string;   // The log message
}

// Module-level log buffer — active during a job run
let _logBuffer: LogEntry[] = [];
let _logBufferActive = false;
let _logBufferJobId: string | null = null;
let _originalConsoleLog: typeof console.log | null = null;
let _originalConsoleWarn: typeof console.warn | null = null;
let _originalConsoleError: typeof console.error | null = null;
let _logFlushTimer: NodeJS.Timeout | null = null;

function formatLogArgs(args: unknown[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.message}`;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

function startLogCapture(jobId: string): void {
  if (_logBufferActive) {
    console.log(`[LogCapture] Already active for job ${_logBufferJobId}, skipping`);
    return;
  }
  console.log(`[LogCapture] Starting log capture for job ${jobId}`);
  _logBuffer = [];
  _logBufferActive = true;
  _logBufferJobId = jobId;
  _originalConsoleLog = console.log;
  _originalConsoleWarn = console.warn;
  _originalConsoleError = console.error;

  console.log = (...args: unknown[]) => {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level: 'info',
      msg: formatLogArgs(args),
    };
    _logBuffer.push(entry);
    if (_logBuffer.length > LOG_BUFFER_MAX_SIZE) {
      _logBuffer = _logBuffer.slice(-LOG_BUFFER_MAX_SIZE);
    }
    _originalConsoleLog!.apply(console, args as [unknown, ...unknown[]]);
  };

  console.warn = (...args: unknown[]) => {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level: 'warn',
      msg: formatLogArgs(args),
    };
    _logBuffer.push(entry);
    if (_logBuffer.length > LOG_BUFFER_MAX_SIZE) {
      _logBuffer = _logBuffer.slice(-LOG_BUFFER_MAX_SIZE);
    }
    _originalConsoleWarn!.apply(console, args as [unknown, ...unknown[]]);
  };

  console.error = (...args: unknown[]) => {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level: 'error',
      msg: formatLogArgs(args),
    };
    _logBuffer.push(entry);
    if (_logBuffer.length > LOG_BUFFER_MAX_SIZE) {
      _logBuffer = _logBuffer.slice(-LOG_BUFFER_MAX_SIZE);
    }
    _originalConsoleError!.apply(console, args as [unknown, ...unknown[]]);
  };

  // Flush logs to DB every 3 seconds so the status API can serve them
  _logFlushTimer = setInterval(() => {
    flushLogBufferToDb().catch((err) => {
      const logFn = _originalConsoleLog || console.log;
      logFn(`[LogFlush] Interval flush error:`, err);
    });
  }, 3000);

  // Also log that capture is active (this goes into the buffer itself)
  console.log(`[LogCapture] Log capture active — buffer max ${LOG_BUFFER_MAX_SIZE}, flush every 3s`);
}

function stopLogCapture(): void {
  if (!_logBufferActive) return;

  // Restore original console methods
  if (_originalConsoleLog) console.log = _originalConsoleLog;
  if (_originalConsoleWarn) console.warn = _originalConsoleWarn;
  if (_originalConsoleError) console.error = _originalConsoleError;
  _originalConsoleLog = null;
  _originalConsoleWarn = null;
  _originalConsoleError = null;

  if (_logFlushTimer) {
    clearInterval(_logFlushTimer);
    _logFlushTimer = null;
  }

  _logBufferActive = false;
  _logBufferJobId = null;
}

async function flushLogBufferToDb(): Promise<void> {
  if (!_logBufferActive || !_logBufferJobId || _logBuffer.length === 0) return;
  const logFn = _originalConsoleLog || console.log;

  try {
    // Read current metadata, merge log buffer, write back
    const snapshot = [..._logBuffer];
    const job = await prisma.dailyLearningJob.findUnique({
      where: { id: _logBufferJobId },
      select: { jobMetadata: true },
    });
    if (job) {
      const metadata = (job.jobMetadata as Record<string, unknown>) || {};
      metadata.logBuffer = snapshot;
      await prisma.dailyLearningJob.update({
        where: { id: _logBufferJobId },
        data: { jobMetadata: metadata as object },
      });
    } else {
      logFn(`[LogFlush] Job ${_logBufferJobId} not found in DB — skipping flush`);
    }
  } catch (err) {
    // Best-effort — don't crash the job for log persistence failures
    // But DO log the error so we can debug
    logFn(`[LogFlush] ERROR flushing ${_logBuffer.length} logs to DB:`, err instanceof Error ? err.message : err);
  }
}

/** Get current log buffer (for status API to read in-process) */
export function getActiveJobLogs(): { jobId: string | null; logs: LogEntry[] } {
  return {
    jobId: _logBufferJobId,
    logs: [..._logBuffer],
  };
}

interface DataReviewResult {
  summary: string;
  keyMetrics: {
    salesTrend: string;
    topBrands: string[];
    customerActivity: string;
    recentChanges: string[];
  };
  costStructureInsights?: string[];
  customerSegmentInsights?: string[];
  areasOfConcern: string[];
  areasOfOpportunity: string[];
  anomalies: string[];
  dataQualityIssues?: string[];
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
  // NEW: Past investigations (user deep-dives) for learning continuity
  pastInvestigations: Array<{
    type: string;
    summary: string;
    analysis: string;
    createdAt: Date;
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

  /**
   * Validates that all required environment variables are present.
   * Called before starting any phases to fail fast and save API tokens.
   *
   * @param skipWebResearch - If true, SERPAPI_API_KEY is not required
   * @throws Error if required environment variables are missing
   */
  validateEnvironment(skipWebResearch: boolean = false): void {
    const required: string[] = [
      'ANTHROPIC_API_KEY',
      'DATABASE_URL',
    ];

    // Only require SERPAPI_API_KEY if we're doing web research
    if (!skipWebResearch) {
      required.push('SERPAPI_API_KEY');
    }

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  /**
   * Validates startup requirements before creating a job.
   * Checks environment, quota status, and other prerequisites.
   *
   * @returns Quota status and warnings for job metadata
   * @throws Error if validation fails
   */
  async validateStartupRequirements(skipWebResearch: boolean = false): Promise<{
    quotaStatus: { remaining: number; isLow: boolean; warning?: string };
  }> {
    // Validate environment variables first
    this.validateEnvironment(skipWebResearch);

    // Check quota status
    const throttleStatus = await webSearchService.getThrottleStatus();
    const remaining = throttleStatus.searchesRemaining;

    let warning: string | undefined;
    let isLow = false;

    if (!skipWebResearch) {
      // Check quota thresholds
      const percentUsed = (throttleStatus.searchesUsed / throttleStatus.limit) * 100;

      if (remaining <= 0) {
        warning = `SerpAPI quota exhausted (${throttleStatus.searchesUsed}/${throttleStatus.limit} searches used this month). Web research will be skipped.`;
        isLow = true;
      } else if (percentUsed >= 90) {
        warning = `SerpAPI quota critical: only ${remaining} searches remaining (${Math.round(percentUsed)}% used)`;
        isLow = true;
      } else if (percentUsed >= 80) {
        warning = `SerpAPI quota warning: ${remaining} searches remaining (${Math.round(percentUsed)}% used)`;
        isLow = true;
      } else if (remaining < 10) {
        warning = `SerpAPI quota low: only ${remaining} searches remaining`;
        isLow = true;
      }

      if (warning) {
        console.warn(`[Learning Job] ${warning}`);
      }
    }

    return {
      quotaStatus: { remaining, isLow, warning },
    };
  }

  /**
   * Creates a new learning job record in the database.
   * This is separated from execution to allow proper error handling in async mode.
   *
   * @param metadata - Initial job metadata
   * @returns The created job ID
   */
  async createJob(metadata: JobMetadata): Promise<string> {
    const job = await prisma.dailyLearningJob.create({
      data: {
        status: 'running',
        currentPhase: 'initializing',
        jobMetadata: metadata as object,
      },
    });
    return job.id;
  }

  /**
   * Persists an error to a job record. Used for fire-and-forget error handling.
   *
   * @param jobId - The job ID to update
   * @param error - The error that occurred
   * @param phase - The phase where the error occurred
   */
  async persistJobError(jobId: string, error: Error | unknown, phase?: string): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorPhase = phase || 'unknown';

    try {
      await prisma.dailyLearningJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage,
          errorPhase,
        },
      });
      console.error(`[Learning Job ${jobId}] Failed in phase '${errorPhase}': ${errorMessage}`);
    } catch (dbError) {
      // If we can't even persist the error, log it
      console.error(`[Learning Job ${jobId}] Failed to persist error:`, dbError);
      console.error(`[Learning Job ${jobId}] Original error:`, errorMessage);
    }
  }

  /**
   * Updates job metadata with additional information.
   */
  async updateJobMetadata(jobId: string, updates: Partial<JobMetadata>): Promise<void> {
    const job = await prisma.dailyLearningJob.findUnique({
      where: { id: jobId },
      select: { jobMetadata: true },
    });

    const currentMetadata = (job?.jobMetadata as unknown as Partial<JobMetadata>) || {};
    const newMetadata: JobMetadata = {
      webResearchSkipped: currentMetadata.webResearchSkipped ?? false,
      webResearchSkipReason: currentMetadata.webResearchSkipReason,
      quotaAtStart: currentMetadata.quotaAtStart,
      quotaWarning: currentMetadata.quotaWarning,
      envValidation: currentMetadata.envValidation,
      phaseTimings: currentMetadata.phaseTimings,
      ...updates,
    };

    await prisma.dailyLearningJob.update({
      where: { id: jobId },
      data: { jobMetadata: newMetadata as object },
    });
  }

  // ============================================
  // ISSUE #9: OBSERVABILITY & METRICS HELPERS
  // Structured logging and metric persistence
  // ============================================

  /**
   * Starts tracking metrics for a phase.
   * Returns a PhaseMetric object to be updated as the phase progresses.
   */
  private startPhaseMetric(phase: string): PhaseMetric {
    const metric: PhaseMetric = {
      phase,
      status: 'success', // Will be updated if failure occurs
      startTime: new Date().toISOString(),
      inputTokens: 0,
      outputTokens: 0,
    };
    console.log(`[Phase Start] ${phase} - ${metric.startTime}`);
    return metric;
  }

  /**
   * Completes a phase metric with final timing and status.
   */
  private completePhaseMetric(
    metric: PhaseMetric,
    status: 'success' | 'failed' | 'skipped',
    options?: {
      error?: string;
      itemsProcessed?: number;
      dataSources?: { loaded: string[]; failed: string[] };
    }
  ): PhaseMetric {
    metric.endTime = new Date().toISOString();
    metric.durationMs = new Date(metric.endTime).getTime() - new Date(metric.startTime).getTime();
    metric.status = status;

    if (options?.error) metric.error = options.error;
    if (options?.itemsProcessed !== undefined) metric.itemsProcessed = options.itemsProcessed;
    if (options?.dataSources) metric.dataSources = options.dataSources;

    // Structured log output
    const logData = {
      phase: metric.phase,
      status: metric.status,
      durationMs: metric.durationMs,
      inputTokens: metric.inputTokens,
      outputTokens: metric.outputTokens,
      ...(metric.error && { error: metric.error }),
      ...(metric.itemsProcessed !== undefined && { itemsProcessed: metric.itemsProcessed }),
      ...(metric.dataSources && {
        dataSourcesLoaded: metric.dataSources.loaded.length,
        dataSourcesFailed: metric.dataSources.failed.length,
      }),
    };

    if (status === 'failed') {
      console.error(`[Phase Failed] ${metric.phase}`, JSON.stringify(logData));
    } else if (status === 'skipped') {
      console.log(`[Phase Skipped] ${metric.phase}`, JSON.stringify(logData));
    } else {
      console.log(`[Phase Complete] ${metric.phase}`, JSON.stringify(logData));
    }

    return metric;
  }

  /**
   * Persists a phase metric to the database for later analysis.
   */
  private async persistPhaseMetric(jobId: string, metric: PhaseMetric): Promise<void> {
    try {
      await prisma.learningPhaseMetric.create({
        data: {
          jobId,
          phase: metric.phase,
          status: metric.status,
          startTime: new Date(metric.startTime),
          endTime: metric.endTime ? new Date(metric.endTime) : undefined,
          durationMs: metric.durationMs,
          inputTokens: metric.inputTokens,
          outputTokens: metric.outputTokens,
          errorMessage: metric.error,
          dataSources: metric.dataSources || undefined,
          itemsProcessed: metric.itemsProcessed,
        },
      });
    } catch (error) {
      // Don't fail the job if metric persistence fails
      console.warn(`[Metrics] Failed to persist phase metric for ${metric.phase}:`, error);
    }
  }

  /**
   * Calculates and returns the health summary from phase metrics.
   */
  private calculateHealthSummary(metrics: PhaseMetric[]): JobMetadata['healthSummary'] {
    const summary = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDurationMs: 0,
      phasesSucceeded: 0,
      phasesFailed: 0,
      phasesSkipped: 0,
      dataSourcesLoaded: 0,
      dataSourcesFailed: 0,
    };

    for (const metric of metrics) {
      summary.totalInputTokens += metric.inputTokens;
      summary.totalOutputTokens += metric.outputTokens;
      summary.totalDurationMs += metric.durationMs || 0;

      if (metric.status === 'success') summary.phasesSucceeded++;
      else if (metric.status === 'failed') summary.phasesFailed++;
      else if (metric.status === 'skipped') summary.phasesSkipped++;

      if (metric.dataSources) {
        summary.dataSourcesLoaded += metric.dataSources.loaded.length;
        summary.dataSourcesFailed += metric.dataSources.failed.length;
      }
    }

    return summary;
  }

  /**
   * Logs a structured data source loading result.
   */
  private logDataSourceResult(
    sourceName: string,
    success: boolean,
    recordCount?: number,
    durationMs?: number
  ): void {
    const logData = {
      source: sourceName,
      success,
      ...(recordCount !== undefined && { records: recordCount }),
      ...(durationMs !== undefined && { durationMs }),
    };

    if (success) {
      console.log(`[DataSource] Loaded ${sourceName}`, JSON.stringify(logData));
    } else {
      console.warn(`[DataSource] Failed to load ${sourceName}`, JSON.stringify(logData));
    }
  }

  async runDailyLearning(options?: {
    forceRun?: boolean;
    skipWebResearch?: boolean;
  }): Promise<{ jobId: string; digest: DailyDigestContent | null }> {
    const { forceRun = false, skipWebResearch: userSkipWebResearch = false } = options || {};
    const jobStartTime = Date.now();

    console.log(`[Learning] ========== STARTING DAILY LEARNING ==========`);
    console.log(`[Learning] Options: forceRun=${forceRun}, skipWebResearch=${userSkipWebResearch}`);
    console.log(`[Learning] Timestamp: ${new Date().toISOString()}`);

    // Initialize Prisma with proper connection pool settings
    let stepStart = Date.now();
    console.log(`[Learning] Step 1/6: Initializing Prisma (Secrets Manager + DB connect)...`);
    await initializePrisma();
    console.log(`[Learning] Step 1/6: Prisma initialized in ${Date.now() - stepStart}ms`);

    // ISSUE #3 FIX: Validate environment variables BEFORE consuming any API tokens
    stepStart = Date.now();
    console.log(`[Learning] Step 2/6: Validating environment variables...`);
    this.validateEnvironment(userSkipWebResearch);
    console.log(`[Learning] Step 2/6: Environment validated in ${Date.now() - stepStart}ms`);

    // Check quota status for metadata tracking (Issue #4)
    stepStart = Date.now();
    console.log(`[Learning] Step 3/6: Validating startup requirements (quota check)...`);
    const { quotaStatus } = await this.validateStartupRequirements(userSkipWebResearch);
    console.log(`[Learning] Step 3/6: Startup validated in ${Date.now() - stepStart}ms (quota remaining: ${quotaStatus.remaining})`);

    // Determine if we should skip web research due to quota exhaustion
    let skipWebResearch = userSkipWebResearch;
    let webResearchSkipReason: JobMetadata['webResearchSkipReason'] | undefined;

    if (userSkipWebResearch) {
      webResearchSkipReason = 'user_requested';
    } else if (quotaStatus.remaining <= 0) {
      skipWebResearch = true;
      webResearchSkipReason = 'quota_exhausted';
      console.warn(`[Learning Job] Skipping web research: quota exhausted`);
    } else if (quotaStatus.remaining < 3) {
      // Less than 3 searches - not enough for meaningful research
      skipWebResearch = true;
      webResearchSkipReason = 'low_quota';
      console.warn(`[Learning Job] Skipping web research: only ${quotaStatus.remaining} searches remaining`);
    }

    // Clean up any stale jobs before checking for existing jobs
    stepStart = Date.now();
    console.log(`[Learning] Step 4/6: Cleaning up stale jobs...`);
    await this.cleanupStaleJobs();
    console.log(`[Learning] Step 4/6: Stale job cleanup in ${Date.now() - stepStart}ms`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!forceRun) {
      stepStart = Date.now();
      console.log(`[Learning] Step 5/6: Checking for existing jobs today...`);
      const existingJob = await prisma.dailyLearningJob.findFirst({
        where: {
          startedAt: { gte: today },
          status: { in: ['completed', 'running'] },
        },
      });
      console.log(`[Learning] Step 5/6: Duplicate check in ${Date.now() - stepStart}ms (found: ${!!existingJob})`);

      if (existingJob) {
        throw new Error(`Daily learning already ${existingJob.status} for today. Job ID: ${existingJob.id}`);
      }
    } else {
      console.log(`[Learning] Step 5/6: Skipped duplicate check (forceRun=true)`);
    }

    // ISSUE #2 FIX: Initialize metadata to track job state
    const initialMetadata: JobMetadata = {
      webResearchSkipped: skipWebResearch,
      webResearchSkipReason,
      quotaAtStart: quotaStatus.remaining,
      quotaWarning: quotaStatus.warning,
      envValidation: {
        validated: true,
        timestamp: new Date().toISOString(),
        skippedChecks: skipWebResearch ? ['SERPAPI_API_KEY'] : undefined,
      },
      phaseTimings: {},
    };

    stepStart = Date.now();
    console.log(`[Learning] Step 6/6: Creating job record in database...`);
    const job = await prisma.dailyLearningJob.create({
      data: {
        status: 'running',
        currentPhase: 'data_review',
        jobMetadata: initialMetadata as object,
      },
    });
    console.log(`[Learning] Step 6/6: Job created in ${Date.now() - stepStart}ms — ID: ${job.id}`);
    console.log(`[Learning] ========== STARTUP COMPLETE (${Date.now() - jobStartTime}ms) ==========`);

    const state: DailyLearningJobState = {
      jobId: job.id,
      inputTokens: 0,
      outputTokens: 0,
      searchesUsed: 0,
      metadata: initialMetadata,
    };

    // ISSUE #9 FIX: Initialize phase metrics array for observability
    state.metadata.phaseMetrics = [];

    // Start capturing console.log/warn/error to an in-memory buffer
    // so the status API can stream logs to the monitoring script
    startLogCapture(job.id);

    try {
      // ============================================
      // PHASE 1: Data Review
      // ============================================
      const phase1Metric = this.startPhaseMetric('data_review');
      const tokensBefore1 = { input: state.inputTokens, output: state.outputTokens };
      state.metadata.phaseTimings!['data_review'] = { start: new Date().toISOString() };
      await this.updateJobPhase(state.jobId, 'data_review');

      let dataReview: DataReviewResult;
      let phase1DataSources: { loaded: string[]; failed: string[] } | undefined;
      try {
        console.log(`[Phase1] ========== STARTING PHASE 1: DATA REVIEW ==========`);
        console.log(`[Phase1] Overall timeout: ${PHASE1_OVERALL_TIMEOUT_MS / 1000}s, Per-query timeout: ${QUERY_TIMEOUT_MS / 1000}s`);
        const phase1Start = Date.now();
        // Wrap entire Phase 1 with an overall timeout guard to prevent indefinite stalls.
        // Individual queries have their own 60s timeouts, but this catches scenarios where
        // the overall phase hangs (e.g., connection pool deadlock, Prisma hangs).
        const { result, dataSources } = await withTimeout(
          this.phase1DataReviewWithMetrics(state),
          PHASE1_OVERALL_TIMEOUT_MS,
          'Phase 1 Data Review (overall)'
        );
        console.log(`[Phase1] ========== PHASE 1 COMPLETE (${Date.now() - phase1Start}ms) ==========`);
        console.log(`[Phase1] Data sources loaded: ${dataSources.loaded.join(', ')}`);
        console.log(`[Phase1] Data sources failed: ${dataSources.failed.length > 0 ? dataSources.failed.join(', ') : 'none'}`);
        dataReview = result;
        phase1DataSources = dataSources;
        phase1Metric.inputTokens = state.inputTokens - tokensBefore1.input;
        phase1Metric.outputTokens = state.outputTokens - tokensBefore1.output;
        this.completePhaseMetric(phase1Metric, 'success', { dataSources: phase1DataSources });
      } catch (error) {
        phase1Metric.inputTokens = state.inputTokens - tokensBefore1.input;
        phase1Metric.outputTokens = state.outputTokens - tokensBefore1.output;
        this.completePhaseMetric(phase1Metric, 'failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          dataSources: phase1DataSources,
        });
        throw error;
      }
      state.metadata.phaseTimings!['data_review'].end = new Date().toISOString();
      state.metadata.phaseMetrics.push(phase1Metric);
      await this.persistPhaseMetric(state.jobId, phase1Metric);
      await this.markPhaseComplete(state.jobId, 'dataReviewDone');

      // ============================================
      // PHASE 2: Question Generation
      // ============================================
      console.log(`[Phase2] ========== STARTING PHASE 2: QUESTION GENERATION ==========`);
      const phase2Start = Date.now();
      const phase2Metric = this.startPhaseMetric('question_gen');
      const tokensBefore2 = { input: state.inputTokens, output: state.outputTokens };
      state.metadata.phaseTimings!['question_gen'] = { start: new Date().toISOString() };
      await this.updateJobPhase(state.jobId, 'question_gen');

      let questions: GeneratedQuestion[];
      try {
        questions = await this.phase2QuestionGeneration(state, dataReview);
        console.log(`[Phase2] ========== PHASE 2 COMPLETE (${Date.now() - phase2Start}ms) — ${questions.length} questions generated ==========`);
        phase2Metric.inputTokens = state.inputTokens - tokensBefore2.input;
        phase2Metric.outputTokens = state.outputTokens - tokensBefore2.output;
        this.completePhaseMetric(phase2Metric, 'success', { itemsProcessed: questions.length });
      } catch (error) {
        phase2Metric.inputTokens = state.inputTokens - tokensBefore2.input;
        phase2Metric.outputTokens = state.outputTokens - tokensBefore2.output;
        this.completePhaseMetric(phase2Metric, 'failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
      state.metadata.phaseTimings!['question_gen'].end = new Date().toISOString();
      state.metadata.phaseMetrics.push(phase2Metric);
      await this.persistPhaseMetric(state.jobId, phase2Metric);
      await this.markPhaseComplete(state.jobId, 'questionGenDone');

      // ============================================
      // PHASE 3: Web Research
      // ============================================
      console.log(`[Phase3] ========== STARTING PHASE 3: WEB RESEARCH (skip=${skipWebResearch}) ==========`);
      const phase3Start = Date.now();
      let webResearchResults: WebResearchResult[] = [];
      const phase3Metric = this.startPhaseMetric('web_research');
      const tokensBefore3 = { input: state.inputTokens, output: state.outputTokens };

      if (!skipWebResearch) {
        state.metadata.phaseTimings!['web_research'] = { start: new Date().toISOString() };
        await this.updateJobPhase(state.jobId, 'web_research');
        try {
          webResearchResults = await this.phase3WebResearch(state, questions);
          phase3Metric.inputTokens = state.inputTokens - tokensBefore3.input;
          phase3Metric.outputTokens = state.outputTokens - tokensBefore3.output;
          const articlesFound = webResearchResults.reduce((sum, r) => sum + r.findings.length, 0);
          console.log(`[Phase3] ========== PHASE 3 COMPLETE (${Date.now() - phase3Start}ms) — ${articlesFound} articles found ==========`);
          this.completePhaseMetric(phase3Metric, 'success', { itemsProcessed: articlesFound });
        } catch (error) {
          phase3Metric.inputTokens = state.inputTokens - tokensBefore3.input;
          phase3Metric.outputTokens = state.outputTokens - tokensBefore3.output;
          this.completePhaseMetric(phase3Metric, 'failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          throw error;
        }
        state.metadata.phaseTimings!['web_research'].end = new Date().toISOString();
        await this.markPhaseComplete(state.jobId, 'webResearchDone');
      } else {
        // Mark web research as skipped with reason
        console.log(`[Phase3] ========== PHASE 3 SKIPPED (${Date.now() - phase3Start}ms) — reason: ${webResearchSkipReason || 'user_requested'} ==========`);
        this.completePhaseMetric(phase3Metric, 'skipped', {
          error: webResearchSkipReason || 'user_requested',
        });
        await this.markPhaseComplete(state.jobId, 'webResearchDone');
      }
      state.metadata.phaseMetrics.push(phase3Metric);
      await this.persistPhaseMetric(state.jobId, phase3Metric);

      // ============================================
      // PHASE 4: Correlation Analysis
      // ============================================
      console.log(`[Phase4] ========== STARTING PHASE 4: CORRELATION ANALYSIS ==========`);
      const phase4Start = Date.now();
      const phase4Metric = this.startPhaseMetric('correlation');
      const tokensBefore4 = { input: state.inputTokens, output: state.outputTokens };
      state.metadata.phaseTimings!['correlation'] = { start: new Date().toISOString() };
      await this.updateJobPhase(state.jobId, 'correlation');

      let correlatedInsights: CorrelatedInsight[];
      try {
        correlatedInsights = await this.phase4Correlation(state, dataReview, webResearchResults);
        console.log(`[Phase4] ========== PHASE 4 COMPLETE (${Date.now() - phase4Start}ms) — ${correlatedInsights.length} insights ==========`);
        phase4Metric.inputTokens = state.inputTokens - tokensBefore4.input;
        phase4Metric.outputTokens = state.outputTokens - tokensBefore4.output;
        this.completePhaseMetric(phase4Metric, 'success', { itemsProcessed: correlatedInsights.length });
      } catch (error) {
        phase4Metric.inputTokens = state.inputTokens - tokensBefore4.input;
        phase4Metric.outputTokens = state.outputTokens - tokensBefore4.output;
        this.completePhaseMetric(phase4Metric, 'failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
      state.metadata.phaseTimings!['correlation'].end = new Date().toISOString();
      state.metadata.phaseMetrics.push(phase4Metric);
      await this.persistPhaseMetric(state.jobId, phase4Metric);
      await this.markPhaseComplete(state.jobId, 'correlationDone');

      // ============================================
      // PHASE 5: Digest Generation
      // ============================================
      console.log(`[Phase5] ========== STARTING PHASE 5: DIGEST GENERATION ==========`);
      const phase5Start = Date.now();
      const phase5Metric = this.startPhaseMetric('digest_gen');
      const tokensBefore5 = { input: state.inputTokens, output: state.outputTokens };
      state.metadata.phaseTimings!['digest_gen'] = { start: new Date().toISOString() };
      await this.updateJobPhase(state.jobId, 'digest_gen');

      let digest: DailyDigestContent;
      try {
        digest = await this.phase5DigestGeneration(state, dataReview, questions, webResearchResults, correlatedInsights);
        console.log(`[Phase5] ========== PHASE 5 COMPLETE (${Date.now() - phase5Start}ms) — actions: ${digest.priorityActions.length}, quickWins: ${digest.quickWins.length} ==========`);
        phase5Metric.inputTokens = state.inputTokens - tokensBefore5.input;
        phase5Metric.outputTokens = state.outputTokens - tokensBefore5.output;
        this.completePhaseMetric(phase5Metric, 'success', {
          itemsProcessed: digest.priorityActions.length + digest.quickWins.length,
        });
      } catch (error) {
        phase5Metric.inputTokens = state.inputTokens - tokensBefore5.input;
        phase5Metric.outputTokens = state.outputTokens - tokensBefore5.output;
        this.completePhaseMetric(phase5Metric, 'failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
      state.metadata.phaseTimings!['digest_gen'].end = new Date().toISOString();
      state.metadata.phaseMetrics.push(phase5Metric);
      await this.persistPhaseMetric(state.jobId, phase5Metric);
      await this.markPhaseComplete(state.jobId, 'digestGenDone');

      // ISSUE #9 FIX: Calculate health summary from metrics
      state.metadata.healthSummary = this.calculateHealthSummary(state.metadata.phaseMetrics);

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
      console.log(`[Learning] Extracting and saving insights to knowledge base...`);
      const savedInsightsCount = await this.extractAndSaveInsights(digest, state.jobId);
      console.log(`[Learning] Saved ${savedInsightsCount} insights to knowledge base`);

      // Calculate phase durations
      for (const [phase, timing] of Object.entries(state.metadata.phaseTimings || {})) {
        if (timing.start && timing.end) {
          timing.durationMs = new Date(timing.end).getTime() - new Date(timing.start).getTime();
        }
      }

      console.log(`[Learning] Saving final job record...`);
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
          jobMetadata: state.metadata as object,
        },
      });

      const totalElapsed = Date.now() - jobStartTime;
      const totalTokens = state.inputTokens + state.outputTokens;
      const cost = this.calculateCost(state.inputTokens, state.outputTokens);
      console.log(`[Learning] ========== JOB COMPLETE ==========`);
      console.log(`[Learning] Job ID: ${state.jobId}`);
      console.log(`[Learning] Total time: ${(totalElapsed / 1000).toFixed(1)}s`);
      console.log(`[Learning] Tokens: ${totalTokens} (in: ${state.inputTokens}, out: ${state.outputTokens})`);
      console.log(`[Learning] Cost: $${cost?.toFixed(4) || 'unknown'}`);
      console.log(`[Learning] Questions: ${questions.length}, Insights: ${correlatedInsights.length}, Articles: ${webResearchResults.reduce((sum, r) => sum + r.findings.length, 0)}`);
      console.log(`[Learning] ================================`);

      // Final log flush before stopping capture
      await flushLogBufferToDb().catch(() => {});
      stopLogCapture();

      return { jobId: state.jobId, digest };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const totalElapsed = Date.now() - jobStartTime;
      console.error(`[Learning] ========== JOB FAILED ==========`);
      console.error(`[Learning] Job ID: ${state.jobId}`);
      console.error(`[Learning] Failed after: ${(totalElapsed / 1000).toFixed(1)}s`);
      console.error(`[Learning] Error: ${errorMessage}`);
      console.error(`[Learning] Tokens used: in=${state.inputTokens}, out=${state.outputTokens}`);
      console.error(`[Learning] ================================`);
      const currentJob = await prisma.dailyLearningJob.findUnique({ where: { id: state.jobId } });
      await prisma.dailyLearningJob.update({
        where: { id: state.jobId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage,
          errorPhase: currentJob?.currentPhase || 'unknown',
          jobMetadata: state.metadata as object,
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          searchesUsed: state.searchesUsed,
        },
      });

      // Final log flush before stopping capture
      await flushLogBufferToDb().catch(() => {});
      stopLogCapture();

      throw error;
    }
  }

  /**
   * ISSUE #9 FIX: Phase 1 with data source tracking for observability.
   * Tracks which data sources loaded successfully and which failed.
   */
  private async phase1DataReviewWithMetrics(
    state: DailyLearningJobState
  ): Promise<{ result: DataReviewResult; dataSources: { loaded: string[]; failed: string[] } }> {
    const dataSources = { loaded: [] as string[], failed: [] as string[] };
    const dataLoadStart = Date.now();

    console.log('[Phase1] Starting data source loading (sequential)...');

    // Ensure Prisma is initialized before querying
    let stepStart = Date.now();
    console.log('[Phase1] Re-initializing Prisma connection...');
    await initializePrisma();
    console.log(`[Phase1] Prisma re-initialized in ${Date.now() - stepStart}ms`);

    // Helper to track data source loading
    let dataSourceIndex = 0;
    const totalDataSources = 11;
    const loadAndTrack = async <T>(
      name: string,
      loader: () => Promise<T>,
      defaultValue: T
    ): Promise<T> => {
      dataSourceIndex++;
      const elapsed = Date.now() - dataLoadStart;
      console.log(`[Phase1] [${dataSourceIndex}/${totalDataSources}] Loading ${name}... (elapsed: ${elapsed}ms)`);
      const result = await safeQuery(loader, defaultValue, name);
      const isEmpty = result === defaultValue ||
        (typeof result === 'object' && Object.keys(result as object).length === 0) ||
        (typeof result === 'string' && result === '');
      if (isEmpty) {
        dataSources.failed.push(name);
        console.warn(`[Phase1] [${dataSourceIndex}/${totalDataSources}] ${name} returned EMPTY`);
      } else {
        dataSources.loaded.push(name);
        const size = typeof result === 'string' ? result.length : JSON.stringify(result).length;
        console.log(`[Phase1] [${dataSourceIndex}/${totalDataSources}] ${name} loaded (${(size / 1024).toFixed(1)}KB)`);
      }
      return result;
    };

    // Load each data source sequentially
    const salesData = await loadAndTrack('sales', () => this.loadRecentSalesData(), {});
    const brandData = await loadAndTrack('brands', () => this.loadRecentBrandData(), {});
    const customerData = await loadAndTrack('customers', () => this.loadRecentCustomerData(), {});
    const invoiceData = await loadAndTrack('invoices', () => this.loadRecentInvoiceData(), {});
    const qrData = await loadAndTrack('qr_codes', () => this.loadQrCodeData(), {});
    const seoData = await loadAndTrack('seo_audits', () => this.loadSeoAuditData(), {});
    const budtenderData = await loadAndTrack('budtenders', () => this.loadBudtenderData(), {});
    const productData = await loadAndTrack('products', () => this.loadProductData(), {});
    const researchData = await loadAndTrack('research', () => this.loadResearchData(), {});
    const dataFlagData = await loadAndTrack('data_flags', () => this.loadDataFlagSummary(), {});
    const correlationSummary = await loadAndTrack('correlations',
      () => dataCorrelationsService.getCorrelationSummaryForAI(), '');

    const dataLoadElapsed = Date.now() - dataLoadStart;
    console.log(`[Phase1] ---- All data sources loaded in ${dataLoadElapsed}ms ----`);
    console.log(`[Phase1] Loaded: ${dataSources.loaded.length}, Failed: ${dataSources.failed.length}`);
    if (dataSources.failed.length > 0) {
      console.warn(`[Phase1] Failed data sources: ${dataSources.failed.join(', ')}`);
    }

    // Call the original analysis logic (sends data to Claude)
    console.log(`[Phase1] Sending data to Claude for analysis...`);
    const claudeStart = Date.now();
    const result = await this.phase1DataReviewAnalysis(
      state,
      salesData,
      brandData,
      customerData,
      invoiceData,
      qrData,
      seoData,
      budtenderData,
      productData,
      researchData,
      dataFlagData,
      correlationSummary
    );
    const claudeElapsed = Date.now() - claudeStart;
    console.log(`[Phase1] Claude analysis complete in ${claudeElapsed}ms`);
    console.log(`[Phase1] Tokens used — input: ${state.inputTokens}, output: ${state.outputTokens}`);
    console.log(`[Phase1] ---- Total phase1DataReviewWithMetrics: ${Date.now() - dataLoadStart}ms ----`);

    return { result, dataSources };
  }

  /**
   * Phase 1 analysis logic (extracted for metrics wrapper).
   */
  private async phase1DataReviewAnalysis(
    state: DailyLearningJobState,
    salesData: unknown,
    brandData: unknown,
    customerData: unknown,
    invoiceData: unknown,
    qrData: unknown,
    seoData: unknown,
    budtenderData: unknown,
    productData: unknown,
    researchData: unknown,
    dataFlagData: unknown,
    correlationSummary: string
  ): Promise<DataReviewResult> {
    console.log(`[Phase1:Analysis] Building Claude prompt...`);
    const prompt = `Analyze business data for San Francisco cannabis dispensaries.

## INDIVIDUAL DATA SOURCES

SALES DATA (daily detail with cost structure): ${JSON.stringify(salesData, null, 2)}
BRAND PERFORMANCE (all brands with margin/cost analysis): ${JSON.stringify(brandData, null, 2)}
CUSTOMER SEGMENTATION (spending tiers, recency, at-risk): ${JSON.stringify(customerData, null, 2)}
INVOICE/PURCHASING DATA (full vendor & cost breakdown): ${JSON.stringify(invoiceData, null, 2)}
BUDTENDER PERFORMANCE: ${JSON.stringify(budtenderData, null, 2)}
PRODUCT CATEGORY DATA: ${JSON.stringify(productData, null, 2)}
MARKET RESEARCH: ${JSON.stringify(researchData, null, 2)}
QR CODE ENGAGEMENT: ${JSON.stringify(qrData, null, 2)}
WEBSITE SEO DATA: ${JSON.stringify(seoData, null, 2)}
DATA QUALITY FLAGS (unresolved issues): ${JSON.stringify(dataFlagData, null, 2)}

## CROSS-TABLE CORRELATIONS & ANALYTICS
The following links data across multiple tables to reveal deeper insights:

${correlationSummary}

## ANALYSIS INSTRUCTIONS
1. Perform cost structure analysis: compare COGS, excise burden, and gross margins across brands and product types
2. Identify brand profitability: cross-reference brand purchasing costs with brand sales revenue and margins
3. Analyze product category profitability: which categories yield the highest markup and margin
4. Perform customer segmentation analysis: LTV by tier, at-risk high-value customers, retention gaps
5. Evaluate vendor cost efficiency: compare pricing across vendors supplying the same brands
6. Look for daily trend patterns: margin compression, discount trends, cost percentage changes
7. Note data quality issues: unresolved data flags that may affect analysis accuracy
8. Cross-reference the knowledge base insights with current data
9. Look for patterns in dates with regulatory events vs sales performance
10. Analyze the long-tail of brands (beyond top 10) for emerging opportunities

Return JSON:
{
  "summary": "Brief overview including key cross-table insights",
  "keyMetrics": { "salesTrend": "", "topBrands": [], "customerActivity": "", "recentChanges": [] },
  "costStructureInsights": [],
  "customerSegmentInsights": [],
  "areasOfConcern": [],
  "areasOfOpportunity": [],
  "anomalies": [],
  "dataQualityIssues": [],
  "suggestedQuestionTopics": []
}`;

    // ISSUE #5 FIX: Add system prompt and assistant prefilling for reliable JSON
    const promptSizeKB = (prompt.length / 1024).toFixed(1);
    console.log(`[Phase1:Claude] Prompt size: ${promptSizeKB}KB, Model: ${CLAUDE_CONFIG.haiku}, Max tokens: ${DAILY_LEARNING_CONFIG.phase1TokenBudget}`);
    const apiCallStart = Date.now();
    const response = await withRetry(
      () => this.client.messages.create({
        model: CLAUDE_CONFIG.haiku,
        max_tokens: DAILY_LEARNING_CONFIG.phase1TokenBudget,
        system: JSON_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' }, // Prefill to ensure JSON object start
        ],
      }),
      'phase1DataReview'
    );
    console.log(`[Phase1:Claude] API response received in ${Date.now() - apiCallStart}ms`);
    console.log(`[Phase1:Claude] Usage — input: ${response.usage.input_tokens}, output: ${response.usage.output_tokens}, stop: ${response.stop_reason}`);

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    // Prepend the prefilled '{' since it won't be in the response
    const responseText = '{' + (textContent?.type === 'text' ? textContent.text : '');
    console.log(`[Phase1:Claude] Response text size: ${(responseText.length / 1024).toFixed(1)}KB`);

    // ISSUE #5 FIX: Use centralized JSON parsing utility
    const parseResult = parseClaudeJson<DataReviewResult>(responseText, false);
    console.log(`[Phase1:Claude] JSON parse: success=${parseResult.success}, fallback=${parseResult.fallbackUsed}`);

    if (!parseResult.success || !parseResult.data) {
      console.error(`[Phase1:Claude] JSON parse FAILED: ${parseResult.error}`);
      // Track parse issue in job metadata
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase1DataReview',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
        error: parseResult.error,
      });

      throw new Error(`Failed to parse data review JSON: ${parseResult.error}`);
    }

    // Track if fallback parsing was used (for observability)
    if (parseResult.fallbackUsed) {
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase1DataReview',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
      });
      console.warn('[phase1DataReview] Used fallback JSON parsing');
    }

    console.log(`[Phase1:Analysis] Analysis complete, returning result`);
    return parseResult.data;
  }

  /**
   * @deprecated Use phase1DataReviewWithMetrics instead for observability tracking.
   */
  private async phase1DataReview(state: DailyLearningJobState): Promise<DataReviewResult> {
    // Delegate to metrics version but ignore the metrics
    const { result } = await this.phase1DataReviewWithMetrics(state);
    return result;
  }

  // Legacy code kept for reference - remove after confirming new method works
  private async _legacyPhase1DataReview(state: DailyLearningJobState): Promise<DataReviewResult> {
    // Load all data sources in parallel with timeouts
    // Each data loader has a 60-second timeout and returns empty data on failure
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
      dataFlagData,
      correlationSummary,
    ] = await Promise.all([
      safeQuery(() => this.loadRecentSalesData(), {}, 'loadRecentSalesData'),
      safeQuery(() => this.loadRecentBrandData(), {}, 'loadRecentBrandData'),
      safeQuery(() => this.loadRecentCustomerData(), {}, 'loadRecentCustomerData'),
      safeQuery(() => this.loadRecentInvoiceData(), {}, 'loadRecentInvoiceData'),
      safeQuery(() => this.loadQrCodeData(), {}, 'loadQrCodeData'),
      safeQuery(() => this.loadSeoAuditData(), {}, 'loadSeoAuditData'),
      safeQuery(() => this.loadBudtenderData(), {}, 'loadBudtenderData'),
      safeQuery(() => this.loadProductData(), {}, 'loadProductData'),
      safeQuery(() => this.loadResearchData(), {}, 'loadResearchData'),
      safeQuery(() => this.loadDataFlagSummary(), {}, 'loadDataFlagSummary'),
      safeQuery(() => dataCorrelationsService.getCorrelationSummaryForAI(), '', 'getCorrelationSummaryForAI'),
    ]);

    const prompt = `Analyze business data for San Francisco cannabis dispensaries.

## INDIVIDUAL DATA SOURCES

SALES DATA (daily detail with cost structure): ${JSON.stringify(salesData, null, 2)}
BRAND PERFORMANCE (all brands with margin/cost analysis): ${JSON.stringify(brandData, null, 2)}
CUSTOMER SEGMENTATION (spending tiers, recency, at-risk): ${JSON.stringify(customerData, null, 2)}
INVOICE/PURCHASING DATA (full vendor & cost breakdown): ${JSON.stringify(invoiceData, null, 2)}
BUDTENDER PERFORMANCE: ${JSON.stringify(budtenderData, null, 2)}
PRODUCT CATEGORY DATA: ${JSON.stringify(productData, null, 2)}
MARKET RESEARCH: ${JSON.stringify(researchData, null, 2)}
QR CODE ENGAGEMENT: ${JSON.stringify(qrData, null, 2)}
WEBSITE SEO DATA: ${JSON.stringify(seoData, null, 2)}
DATA QUALITY FLAGS (unresolved issues): ${JSON.stringify(dataFlagData, null, 2)}

## CROSS-TABLE CORRELATIONS & ANALYTICS
The following links data across multiple tables to reveal deeper insights:

${correlationSummary}

## ANALYSIS INSTRUCTIONS
1. Perform cost structure analysis: compare COGS, excise burden, and gross margins across brands and product types
2. Identify brand profitability: cross-reference brand purchasing costs with brand sales revenue and margins
3. Analyze product category profitability: which categories yield the highest markup and margin
4. Perform customer segmentation analysis: LTV by tier, at-risk high-value customers, retention gaps
5. Evaluate vendor cost efficiency: compare pricing across vendors supplying the same brands
6. Look for daily trend patterns: margin compression, discount trends, cost percentage changes
7. Note data quality issues: unresolved data flags that may affect analysis accuracy
8. Cross-reference the knowledge base insights with current data
9. Look for patterns in dates with regulatory events vs sales performance
10. Analyze the long-tail of brands (beyond top 10) for emerging opportunities

Return JSON:
{
  "summary": "Brief overview including key cross-table insights",
  "keyMetrics": { "salesTrend": "", "topBrands": [], "customerActivity": "", "recentChanges": [] },
  "costStructureInsights": [],
  "customerSegmentInsights": [],
  "areasOfConcern": [],
  "areasOfOpportunity": [],
  "anomalies": [],
  "dataQualityIssues": [],
  "suggestedQuestionTopics": []
}`;

    // ISSUE #5 FIX: Add system prompt and assistant prefilling for reliable JSON
    const response = await withRetry(
      () => this.client.messages.create({
        model: CLAUDE_CONFIG.haiku,
        max_tokens: DAILY_LEARNING_CONFIG.phase1TokenBudget,
        system: JSON_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' }, // Prefill to ensure JSON object start
        ],
      }),
      'phase1DataReview'
    );

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    // Prepend the prefilled '{' since it won't be in the response
    const responseText = '{' + (textContent?.type === 'text' ? textContent.text : '');

    // ISSUE #5 FIX: Use centralized JSON parsing utility
    const parseResult = parseClaudeJson<DataReviewResult>(responseText, false);

    if (!parseResult.success || !parseResult.data) {
      // Track parse issue in job metadata
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase1DataReview',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
        error: parseResult.error,
      });

      throw new Error(`Failed to parse data review JSON: ${parseResult.error}`);
    }

    // Track if fallback parsing was used (for observability)
    if (parseResult.fallbackUsed) {
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase1DataReview',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
      });
      console.warn('[phase1DataReview] Used fallback JSON parsing');
    }

    return parseResult.data;
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

    // ISSUE #5 FIX: Add system prompt and assistant prefilling for reliable JSON
    const response = await withRetry(
      () => this.client.messages.create({
        model: CLAUDE_CONFIG.haiku,
        max_tokens: DAILY_LEARNING_CONFIG.phase2TokenBudget,
        system: JSON_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '[' }, // Prefill to ensure JSON array start
        ],
      }),
      'phase2QuestionGeneration'
    );

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    // Prepend the prefilled '[' since it won't be in the response
    const responseText = '[' + (textContent?.type === 'text' ? textContent.text : '');

    // ISSUE #5 FIX: Use centralized JSON parsing utility
    const parseResult = parseClaudeJson<GeneratedQuestion[]>(responseText, true);

    if (!parseResult.success || !parseResult.data) {
      // Track parse issue in job metadata
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase2QuestionGeneration',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
        error: parseResult.error,
      });
      console.error('[phase2QuestionGeneration] JSON parse failed:', parseResult.error);
      return [];
    }

    // Track if fallback parsing was used
    if (parseResult.fallbackUsed) {
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase2QuestionGeneration',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
      });
      console.warn('[phase2QuestionGeneration] Used fallback JSON parsing');
    }

    const questions = parseResult.data;

    // Update question tracking in database - run in parallel with timeouts
    await Promise.all(
      questions.map((q) => {
        const questionHash = this.hashString(q.question.toLowerCase());
        return safeQuery(
          () => prisma.learningQuestion.upsert({
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
          }),
          null,
          `upsertQuestion-${questionHash.substring(0, 8)}`
        );
      })
    );

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

    // Past investigations - user deep-dives that should inform future learning
    if (context.pastInvestigations.length > 0) {
      sections.push(`## PAST USER INVESTIGATIONS (Deep-Dives)
Users have conducted detailed investigations on these topics - build on their findings:
${context.pastInvestigations
  .slice(0, 5)
  .map((inv, i) => {
    const typeLabel = inv.type === 'buyer-investigation' ? 'Buyer/Procurement' : 'General';
    // Extract key findings from analysis (first 200 chars)
    const keyFinding = inv.analysis.substring(0, 200).replace(/\n/g, ' ').trim();
    return `${i + 1}. [${typeLabel}] Topic: "${inv.summary}" - Key finding: "${keyFinding}..."`;
  })
  .join('\n')}
IMPORTANT: Follow up on unresolved questions or recommendations from these investigations.`);
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
      // Add retry with timeout to Claude API call to handle transient failures
      const response = await withRetry(
        () => this.client.messages.create({
          model: CLAUDE_CONFIG.haiku,
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
        'analyzeSearchResult'
      );

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

    // ISSUE #4 FIX: Don't fail silently when quota is exhausted during phase 3
    if (availableSearches <= 0) {
      const reason = throttleStatus.searchesRemaining <= 0 ? 'quota_exhausted' : 'daily_limit_reached';
      console.warn(`[Learning Job ${state.jobId}] Phase 3 skipped: ${reason} (${throttleStatus.searchesUsed}/${throttleStatus.limit} monthly searches used)`);

      // Update job metadata to reflect the skip reason
      state.metadata.webResearchSkipped = true;
      state.metadata.webResearchSkipReason = 'quota_exhausted';
      await this.updateJobMetadata(state.jobId, {
        webResearchSkipped: true,
        webResearchSkipReason: 'quota_exhausted',
        quotaWarning: `Web research skipped: ${throttleStatus.searchesUsed}/${throttleStatus.limit} monthly searches used`,
      });

      return [];
    }

    // Log available budget
    console.log(`[Learning Job ${state.jobId}] Phase 3: ${availableSearches} searches available for ${webQuestions.length} questions`);

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

    // ISSUE #5 FIX: Add system prompt and assistant prefilling for reliable JSON
    // NOTE: Phase 4 intentionally uses Sonnet (defaultModel) instead of Haiku.
    // Correlation analysis requires more deliberate reasoning across multiple data
    // dimensions (sales, customer, brand, market) to identify accurate patterns.
    // The higher cost is justified by the critical nature of insight quality.
    const response = await withRetry(
      () => this.client.messages.create({
        model: CLAUDE_CONFIG.defaultModel,
        max_tokens: DAILY_LEARNING_CONFIG.phase4TokenBudget,
        system: JSON_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '[' }, // Prefill to ensure JSON array start
        ],
      }),
      'phase4Correlation'
    );

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    // Prepend the prefilled '[' since it won't be in the response
    const responseText = '[' + (textContent?.type === 'text' ? textContent.text : '');

    // ISSUE #5 FIX: Use centralized JSON parsing utility
    const parseResult = parseClaudeJson<CorrelatedInsight[]>(responseText, true);

    if (!parseResult.success || !parseResult.data) {
      // Track parse issue in job metadata
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase4Correlation',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
        error: parseResult.error,
      });
      console.error('[phase4Correlation] JSON parse failed:', parseResult.error);
      return [];
    }

    // Track if fallback parsing was used
    if (parseResult.fallbackUsed) {
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase4Correlation',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
      });
      console.warn('[phase4Correlation] Used fallback JSON parsing');
    }

    return parseResult.data;
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

    // ISSUE #5 FIX: Add system prompt and assistant prefilling for reliable JSON
    // NOTE: Phase 5 intentionally uses Sonnet (defaultModel) instead of Haiku.
    // The digest is the primary user-facing deliverable and requires the highest
    // quality synthesis of all insights, correlations, and recommendations.
    const response = await withRetry(
      () => this.client.messages.create({
        model: CLAUDE_CONFIG.defaultModel,
        max_tokens: DAILY_LEARNING_CONFIG.phase5TokenBudget,
        system: JSON_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' }, // Prefill to ensure JSON object start
        ],
      }),
      'phase5DigestGeneration'
    );

    state.inputTokens += response.usage.input_tokens;
    state.outputTokens += response.usage.output_tokens;

    const textContent = response.content.find(c => c.type === 'text');
    // Prepend the prefilled '{' since it won't be in the response
    const responseText = '{' + (textContent?.type === 'text' ? textContent.text : '');

    // ISSUE #5 FIX: Use centralized JSON parsing utility
    const parseResult = parseClaudeJson<DailyDigestContent>(responseText, false);

    if (!parseResult.success || !parseResult.data) {
      // Track parse issue in job metadata
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase5DigestGeneration',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
        error: parseResult.error,
      });

      throw new Error(`Failed to parse digest JSON: ${parseResult.error}`);
    }

    // Track if fallback parsing was used
    if (parseResult.fallbackUsed) {
      if (!state.metadata.jsonParseIssues) {
        state.metadata.jsonParseIssues = [];
      }
      state.metadata.jsonParseIssues.push({
        phase: 'phase5DigestGeneration',
        timestamp: new Date().toISOString(),
        fallbackUsed: true,
      });
      console.warn('[phase5DigestGeneration] Used fallback JSON parsing');
    }

    return parseResult.data;
  }

  // ISSUE #7 FIX: Also updates lastHeartbeat to track job activity
  private async updateJobPhase(jobId: string, phase: string): Promise<void> {
    await prisma.dailyLearningJob.update({
      where: { id: jobId },
      data: {
        currentPhase: phase,
        lastHeartbeat: new Date(),
      },
    });
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

    console.log(`[DataLoader:sales] Querying salesRecord (last 30 days)...`);
    const queryStart = Date.now();
    const salesRecords = await prisma.salesRecord.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      orderBy: { date: 'desc' },
    });
    console.log(`[DataLoader:sales] Query returned ${salesRecords.length} rows in ${Date.now() - queryStart}ms`);

    const totalSales = salesRecords.reduce((sum, r) => sum + parseFloat(r.netSales.toString()), 0);
    const totalGrossSales = salesRecords.reduce((sum, r) => sum + parseFloat(r.grossSales.toString()), 0);
    const totalCogs = salesRecords.reduce((sum, r) => sum + parseFloat(r.cogsWithExcise.toString()), 0);
    const totalDiscounts = salesRecords.reduce((sum, r) => sum + parseFloat(r.discounts.toString()), 0);
    const totalReturns = salesRecords.reduce((sum, r) => sum + parseFloat(r.returns.toString()), 0);
    const totalGrossIncome = salesRecords.reduce((sum, r) => sum + parseFloat(r.grossIncome.toString()), 0);
    const avgDaily = totalSales / Math.max(salesRecords.length, 1);
    const avgMargin = salesRecords.length > 0
      ? salesRecords.reduce((sum, r) => sum + parseFloat(r.grossMarginPct.toString()), 0) / salesRecords.length
      : 0;
    const avgDiscountPct = salesRecords.length > 0
      ? salesRecords.reduce((sum, r) => sum + parseFloat(r.discountPct.toString()), 0) / salesRecords.length
      : 0;
    const avgCostPct = salesRecords.length > 0
      ? salesRecords.reduce((sum, r) => sum + parseFloat(r.costPct.toString()), 0) / salesRecords.length
      : 0;
    const totalCustomers = salesRecords.reduce((sum, r) => sum + r.customersCount, 0);
    const totalNewCustomers = salesRecords.reduce((sum, r) => sum + r.newCustomers, 0);
    const totalTickets = salesRecords.reduce((sum, r) => sum + r.ticketsCount, 0);
    const totalUnits = salesRecords.reduce((sum, r) => sum + r.unitsSold, 0);

    // Per-day detail for trend analysis (include cost structure)
    const dailyDetail = salesRecords.map(r => ({
      date: r.date.toISOString().split('T')[0],
      store: r.storeName || r.storeId,
      netSales: parseFloat(r.netSales.toString()),
      grossSales: parseFloat(r.grossSales.toString()),
      cogs: parseFloat(r.cogsWithExcise.toString()),
      grossIncome: parseFloat(r.grossIncome.toString()),
      grossMarginPct: parseFloat(r.grossMarginPct.toString()),
      costPct: parseFloat(r.costPct.toString()),
      discountPct: parseFloat(r.discountPct.toString()),
      tickets: r.ticketsCount,
      customers: r.customersCount,
      newCustomers: r.newCustomers,
      avgOrderValue: parseFloat(r.avgOrderValue.toString()),
      avgOrderProfit: parseFloat(r.avgOrderProfit.toString()),
      avgBasketSize: parseFloat(r.avgBasketSize.toString()),
    }));

    return {
      periodDays: 30,
      totalNetSales: totalSales.toFixed(2),
      totalGrossSales: totalGrossSales.toFixed(2),
      totalCOGS: totalCogs.toFixed(2),
      totalGrossIncome: totalGrossIncome.toFixed(2),
      totalDiscounts: totalDiscounts.toFixed(2),
      totalReturns: totalReturns.toFixed(2),
      avgDailySales: avgDaily.toFixed(2),
      avgGrossMarginPct: avgMargin.toFixed(1),
      avgCostPct: avgCostPct.toFixed(1),
      avgDiscountPct: avgDiscountPct.toFixed(1),
      totalCustomers,
      totalNewCustomers,
      totalTickets,
      totalUnitsSold: totalUnits,
      avgOrderValue: totalTickets > 0 ? (totalSales / totalTickets).toFixed(2) : '0.00',
      avgOrderProfit: totalTickets > 0 ? (totalGrossIncome / totalTickets).toFixed(2) : '0.00',
      recordCount: salesRecords.length,
      dailyDetail,
    };
  }

  private async loadRecentBrandData(): Promise<Record<string, unknown>> {
    // Load top brand records ordered by sales for portfolio analysis.
    // We only send top 50 to Claude, but load 200 to also cover margin analysis.
    // Previously loaded ALL 10K+ records which created a 1MB+ prompt that exceeded Claude's context.
    console.log(`[DataLoader:brands] Querying brandRecord (top 200 by sales)...`);
    let queryStart = Date.now();
    const brandRecords = await prisma.brandRecord.findMany({
      orderBy: { netSales: 'desc' },
      take: 200,
      include: { brand: true },
    });
    console.log(`[DataLoader:brands] brandRecord returned ${brandRecords.length} rows in ${Date.now() - queryStart}ms`);

    // Get total count and aggregate for the long tail summary
    const totalBrandCount = await prisma.brandRecord.count();
    const totalSalesAgg = await prisma.brandRecord.aggregate({
      _sum: { netSales: true },
      _avg: { grossMarginPct: true },
    });
    console.log(`[DataLoader:brands] Total brands in DB: ${totalBrandCount}`);

    // Load ALL vendor-brand relationships for complete supply chain visibility
    console.log(`[DataLoader:brands] Querying vendorBrand (all)...`);
    queryStart = Date.now();
    const vendorBrands = await prisma.vendorBrand.findMany({
      orderBy: { invoiceCount: 'desc' },
      include: {
        vendor: true,
        brand: true,
      },
    });
    console.log(`[DataLoader:brands] vendorBrand returned ${vendorBrands.length} rows in ${Date.now() - queryStart}ms`);

    // Group by vendor to show which brands each vendor supplies
    const vendorBrandMap: Record<string, { brands: string[]; totalInvoices: number; totalUnits: number; totalCost: number }> = {};
    for (const vb of vendorBrands) {
      const vendorName = vb.vendor.canonicalName;
      if (!vendorBrandMap[vendorName]) {
        vendorBrandMap[vendorName] = { brands: [], totalInvoices: 0, totalUnits: 0, totalCost: 0 };
      }
      vendorBrandMap[vendorName].brands.push(vb.brand.canonicalName);
      vendorBrandMap[vendorName].totalInvoices += vb.invoiceCount;
      vendorBrandMap[vendorName].totalUnits += vb.totalUnits;
      vendorBrandMap[vendorName].totalCost += parseFloat(vb.totalCost.toString());
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

    // Use aggregate for accurate total (includes brands not in our top-200 sample)
    const totalBrandSales = parseFloat((totalSalesAgg._sum.netSales || 0).toString());

    // Provide ALL brands with full margin and cost data
    const allBrands = brandRecords.map(b => ({
      name: b.brand?.canonicalName || b.originalBrandName,
      netSales: parseFloat(b.netSales.toString()),
      pctOfTotalSales: parseFloat(b.pctOfTotalNetSales.toString()),
      grossMarginPct: parseFloat(b.grossMarginPct.toString()),
      avgCostWoExcise: parseFloat(b.avgCostWoExcise.toString()),
      suppliers: brandVendorMap[b.brand?.canonicalName || ''] || [],
      store: b.storeName || b.storeId,
    }));

    // Identify underperforming brands (low margin or declining)
    const lowMarginBrands = allBrands
      .filter(b => b.grossMarginPct < 40 && b.netSales > 0)
      .sort((a, b) => a.grossMarginPct - b.grossMarginPct);

    // Identify high-margin opportunity brands
    const highMarginBrands = allBrands
      .filter(b => b.grossMarginPct >= 55)
      .sort((a, b) => b.grossMarginPct - a.grossMarginPct);

    // Limit data sent to Claude to avoid exceeding context window.
    // With 10K+ brands, sending all of them creates a 1MB+ prompt.
    // Top 50 brands + summaries provide more than enough for analysis.
    const topN = 50;
    const topBrandsDetailed = allBrands.slice(0, topN);
    const tailBrands = allBrands.slice(topN);
    const tailSummary = tailBrands.length > 0 ? {
      count: tailBrands.length,
      totalNetSales: tailBrands.reduce((sum, b) => sum + b.netSales, 0).toFixed(2),
      avgMargin: (tailBrands.reduce((sum, b) => sum + b.grossMarginPct, 0) / tailBrands.length).toFixed(1),
      pctOfTotal: tailBrands.reduce((sum, b) => sum + b.pctOfTotalSales, 0).toFixed(2),
    } : null;

    // Limit vendor relationships to top 30 by invoice count
    const topVendorRelationships = Object.entries(vendorBrandMap)
      .sort(([, a], [, b]) => b.totalInvoices - a.totalInvoices)
      .slice(0, 30)
      .map(([vendor, data]) => ({
        vendor,
        brands: data.brands.slice(0, 10), // Cap brands per vendor
        brandCount: data.brands.length,
        totalInvoices: data.totalInvoices,
        totalUnits: data.totalUnits,
        totalCost: data.totalCost.toFixed(2),
      }));

    return {
      totalBrandsTracked: allBrands.length,
      totalBrandSales: totalBrandSales.toFixed(2),
      // Top brands for detailed analysis
      topBrands: topBrandsDetailed,
      // Summary of remaining long-tail brands (not individual rows)
      longTailSummary: tailSummary,
      // Margin analysis
      lowMarginBrands: lowMarginBrands.slice(0, 10),
      highMarginBrands: highMarginBrands.slice(0, 10),
      avgBrandMargin: allBrands.length > 0
        ? (allBrands.reduce((sum, b) => sum + b.grossMarginPct, 0) / allBrands.length).toFixed(1)
        : '0.0',
      vendorBrandRelationships: topVendorRelationships,
      totalVendors: Object.keys(vendorBrandMap).length,
      totalVendorBrandLinks: vendorBrands.length,
    };
  }

  private async loadRecentCustomerData(): Promise<Record<string, unknown>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Run all customer queries in parallel
    console.log(`[DataLoader:customers] Running 8 parallel customer queries...`);
    const queryStart = Date.now();
    const [
      activeCustomers,
      totalCustomers,
      newCustomers30d,
      segmentCounts,
      recencyCounts,
      avgMetrics,
      topCustomers,
      atRiskCustomers,
    ] = await Promise.all([
      prisma.customer.count({
        where: { lastVisitDate: { gte: thirtyDaysAgo } },
      }),
      prisma.customer.count(),
      prisma.customer.count({
        where: { signupDate: { gte: thirtyDaysAgo } },
      }),
      // Group by customer segment (spending tier)
      prisma.customer.groupBy({
        by: ['customerSegment'],
        _count: { id: true },
        _sum: { lifetimeNetSales: true },
        _avg: { lifetimeNetSales: true, lifetimeVisits: true, lifetimeAov: true },
      }),
      // Group by recency segment (visit freshness)
      prisma.customer.groupBy({
        by: ['recencySegment'],
        _count: { id: true },
        _sum: { lifetimeNetSales: true },
        _avg: { lifetimeNetSales: true },
      }),
      // Overall averages
      prisma.customer.aggregate({
        _avg: { lifetimeNetSales: true, lifetimeVisits: true, lifetimeAov: true },
      }),
      // Top 20 customers by LTV
      prisma.customer.findMany({
        orderBy: { lifetimeNetSales: 'desc' },
        take: 20,
        select: {
          customerSegment: true,
          recencySegment: true,
          lifetimeNetSales: true,
          lifetimeVisits: true,
          lifetimeAov: true,
          lastVisitDate: true,
        },
      }),
      // At-risk high-value customers (VIP/Whale who haven't visited in 30+ days)
      prisma.customer.findMany({
        where: {
          customerSegment: { in: ['VIP', 'Whale', 'Good'] },
          lastVisitDate: { lt: thirtyDaysAgo },
        },
        orderBy: { lifetimeNetSales: 'desc' },
        take: 20,
        select: {
          customerSegment: true,
          recencySegment: true,
          lifetimeNetSales: true,
          lifetimeVisits: true,
          lastVisitDate: true,
        },
      }),
    ]);
    console.log(`[DataLoader:customers] All queries completed in ${Date.now() - queryStart}ms (total: ${totalCustomers}, active30d: ${activeCustomers}, atRisk: ${atRiskCustomers.length})`);

    return {
      activeCustomers30d: activeCustomers,
      totalCustomers,
      newCustomers30d,
      activeRate: ((activeCustomers / Math.max(totalCustomers, 1)) * 100).toFixed(1) + '%',
      avgLifetimeValue: parseFloat(avgMetrics._avg.lifetimeNetSales?.toString() || '0').toFixed(2),
      avgLifetimeVisits: parseFloat(avgMetrics._avg.lifetimeVisits?.toString() || '0').toFixed(1),
      avgAov: parseFloat(avgMetrics._avg.lifetimeAov?.toString() || '0').toFixed(2),
      // Full spending-tier segmentation (New/Low, Regular, Good, VIP, Whale)
      spendingSegments: segmentCounts.map(s => ({
        segment: s.customerSegment || 'Unknown',
        count: s._count.id,
        totalRevenue: parseFloat(s._sum.lifetimeNetSales?.toString() || '0').toFixed(2),
        avgLtv: parseFloat(s._avg.lifetimeNetSales?.toString() || '0').toFixed(2),
        avgVisits: parseFloat(s._avg.lifetimeVisits?.toString() || '0').toFixed(1),
        avgAov: parseFloat(s._avg.lifetimeAov?.toString() || '0').toFixed(2),
      })),
      // Full recency segmentation (Active, Warm, Cool, Cold, Lost)
      recencySegments: recencyCounts.map(s => ({
        segment: s.recencySegment || 'Unknown',
        count: s._count.id,
        totalRevenue: parseFloat(s._sum.lifetimeNetSales?.toString() || '0').toFixed(2),
        avgLtv: parseFloat(s._avg.lifetimeNetSales?.toString() || '0').toFixed(2),
      })),
      // Top 20 customers by lifetime value
      topCustomers: topCustomers.map(c => ({
        segment: c.customerSegment,
        recency: c.recencySegment,
        ltv: parseFloat(c.lifetimeNetSales.toString()),
        visits: c.lifetimeVisits,
        aov: parseFloat(c.lifetimeAov.toString()),
        lastVisit: c.lastVisitDate?.toISOString().split('T')[0] || null,
      })),
      // At-risk high-value customers needing retention attention
      atRiskHighValueCustomers: atRiskCustomers.map(c => ({
        segment: c.customerSegment,
        recency: c.recencySegment,
        ltv: parseFloat(c.lifetimeNetSales.toString()),
        visits: c.lifetimeVisits,
        lastVisit: c.lastVisitDate?.toISOString().split('T')[0] || null,
      })),
      atRiskHighValueCount: atRiskCustomers.length,
    };
  }

  private async loadRecentInvoiceData(): Promise<Record<string, unknown>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Load ALL invoices in 30-day window (not just 50)
    console.log(`[DataLoader:invoices] Querying invoices with lineItems (last 30 days)...`);
    const queryStart = Date.now();
    const invoices = await prisma.invoice.findMany({
      where: { invoiceDate: { gte: thirtyDaysAgo } },
      include: {
        vendor: true,
        lineItems: {
          include: { brand: true },
        },
      },
      orderBy: { invoiceDate: 'desc' },
    });
    const totalLineItems = invoices.reduce((sum, inv) => sum + inv.lineItems.length, 0);
    console.log(`[DataLoader:invoices] Query returned ${invoices.length} invoices (${totalLineItems} line items) in ${Date.now() - queryStart}ms`);

    const totalCost = invoices.reduce((sum, inv) => sum + parseFloat(inv.totalCost.toString()), 0);
    const totalWithExcise = invoices.reduce((sum, inv) => sum + parseFloat(inv.totalWithExcise.toString()), 0);
    const totalDiscount = invoices.reduce((sum, inv) => sum + parseFloat(inv.discount.toString()), 0);
    const totalFees = invoices.reduce((sum, inv) => sum + parseFloat(inv.fees.toString()), 0);
    const totalTax = invoices.reduce((sum, inv) => sum + parseFloat(inv.tax.toString()), 0);

    // Track ALL vendors (not just top 5)
    const vendorStats: Record<string, { count: number; cost: number; costWithExcise: number; brands: Set<string> }> = {};
    // Track ALL brands purchased with full cost detail
    const brandCosts: Record<string, { count: number; cost: number; costWithExcise: number; units: number; avgUnitCost: number; excisePerUnit: number }> = {};
    // Track by product type for category-level cost analysis
    const productTypeCosts: Record<string, { count: number; cost: number; units: number }> = {};

    invoices.forEach(inv => {
      const vendorName = inv.vendor?.canonicalName || inv.originalVendorName || 'Unknown';
      if (!vendorStats[vendorName]) {
        vendorStats[vendorName] = { count: 0, cost: 0, costWithExcise: 0, brands: new Set() };
      }
      vendorStats[vendorName].count++;
      vendorStats[vendorName].cost += parseFloat(inv.totalCost.toString());
      vendorStats[vendorName].costWithExcise += parseFloat(inv.totalWithExcise.toString());

      inv.lineItems.forEach(item => {
        const brandName = item.brand?.canonicalName || item.originalBrandName || 'Unknown';
        vendorStats[vendorName].brands.add(brandName);

        if (!brandCosts[brandName]) {
          brandCosts[brandName] = { count: 0, cost: 0, costWithExcise: 0, units: 0, avgUnitCost: 0, excisePerUnit: 0 };
        }
        brandCosts[brandName].count++;
        brandCosts[brandName].cost += parseFloat(item.totalCost.toString());
        brandCosts[brandName].costWithExcise += parseFloat(item.totalCostWithExcise.toString());
        brandCosts[brandName].units += item.skuUnits;

        // Track product type costs
        const productType = item.productType || 'Unknown';
        if (!productTypeCosts[productType]) {
          productTypeCosts[productType] = { count: 0, cost: 0, units: 0 };
        }
        productTypeCosts[productType].count++;
        productTypeCosts[productType].cost += parseFloat(item.totalCost.toString());
        productTypeCosts[productType].units += item.skuUnits;
      });
    });

    // Compute derived metrics for brands
    Object.values(brandCosts).forEach(b => {
      b.avgUnitCost = b.units > 0 ? b.cost / b.units : 0;
      b.excisePerUnit = b.units > 0 ? (b.costWithExcise - b.cost) / b.units : 0;
    });

    // ALL vendors sorted by spend (not just top 5)
    const allVendors = Object.entries(vendorStats)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .map(([name, data]) => ({
        name,
        invoiceCount: data.count,
        totalCost: data.cost.toFixed(2),
        totalWithExcise: data.costWithExcise.toFixed(2),
        brandCount: data.brands.size,
        brands: Array.from(data.brands).slice(0, 10),
      }));

    // ALL brands purchased sorted by cost
    const allBrandsPurchased = Object.entries(brandCosts)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .map(([name, data]) => ({
        name,
        lineItems: data.count,
        totalCost: data.cost.toFixed(2),
        totalWithExcise: data.costWithExcise.toFixed(2),
        units: data.units,
        avgUnitCost: data.avgUnitCost.toFixed(2),
        excisePerUnit: data.excisePerUnit.toFixed(2),
      }));

    // Product type cost breakdown
    const productTypeSummary = Object.entries(productTypeCosts)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .map(([type, data]) => ({
        productType: type,
        lineItems: data.count,
        totalCost: data.cost.toFixed(2),
        units: data.units,
        avgUnitCost: data.units > 0 ? (data.cost / data.units).toFixed(2) : '0.00',
        pctOfTotalCost: ((data.cost / Math.max(totalCost, 1)) * 100).toFixed(1) + '%',
      }));

    return {
      recentInvoiceCount: invoices.length,
      totalPurchasingCost30d: totalCost.toFixed(2),
      totalWithExcise30d: totalWithExcise.toFixed(2),
      totalDiscounts30d: totalDiscount.toFixed(2),
      totalFees30d: totalFees.toFixed(2),
      totalTax30d: totalTax.toFixed(2),
      exciseBurden: (totalWithExcise - totalCost).toFixed(2),
      // Full vendor breakdown (not capped at 5)
      allVendors,
      vendorCount: allVendors.length,
      // Full brand cost breakdown
      allBrandsPurchased,
      brandsPurchasedCount: allBrandsPurchased.length,
      // Product type cost structure
      productTypeCostBreakdown: productTypeSummary,
      lineItemsCount: invoices.reduce((sum, inv) => sum + inv.lineItems.length, 0),
      lineItemsWithBrand: invoices.reduce((sum, inv) =>
        sum + inv.lineItems.filter(li => li.brandId !== null).length, 0),
    };
  }

  private async loadQrCodeData(): Promise<Record<string, unknown>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    console.log(`[DataLoader:qr] Running QR code queries...`);
    const queryStart = Date.now();
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
    console.log(`[DataLoader:qr] Queries completed in ${Date.now() - queryStart}ms (total: ${totalCodes}, active: ${activeCodes}, clicks30d: ${recentClicks})`);

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
    console.log(`[DataLoader:seo] Querying latest SEO audit...`);
    const queryStart = Date.now();
    const latestAudit = await prisma.seoAudit.findFirst({
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' },
      include: {
        _count: { select: { pages: true } },
      },
    });

    console.log(`[DataLoader:seo] Query completed in ${Date.now() - queryStart}ms (found: ${!!latestAudit})`);

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

    console.log(`[DataLoader:budtenders] Querying budtenderRecord (last 30 days)...`);
    const queryStart = Date.now();
    const budtenderRecords = await prisma.budtenderRecord.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      orderBy: { date: 'desc' },
    });
    console.log(`[DataLoader:budtenders] Query returned ${budtenderRecords.length} rows in ${Date.now() - queryStart}ms`);

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
    console.log(`[DataLoader:products] Querying productRecord (all)...`);
    const queryStart = Date.now();
    const productRecords = await prisma.productRecord.findMany({
      orderBy: { netSales: 'desc' },
    });
    console.log(`[DataLoader:products] Query returned ${productRecords.length} rows in ${Date.now() - queryStart}ms`);

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
    console.log(`[DataLoader:research] Querying researchDocument with findings...`);
    const queryStart = Date.now();
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

    console.log(`[DataLoader:research] researchDocument returned ${researchDocs.length} docs in ${Date.now() - queryStart}ms`);

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
    console.log(`[DataLoader:research] Querying action items...`);
    const actionItems = await prisma.researchFinding.findMany({
      where: {
        actionRequired: true,
        relevance: 'high',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { document: true },
    });
    console.log(`[DataLoader:research] Found ${actionItems.length} action items`);

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
   * Loads data quality flags to surface unresolved data issues to the learning model.
   * DataFlags capture brand mismatches, data anomalies, and quality concerns.
   */
  private async loadDataFlagSummary(): Promise<Record<string, unknown>> {
    console.log(`[DataLoader:dataFlags] Querying data flags...`);
    const queryStart = Date.now();
    const [pendingFlags, recentFlags] = await Promise.all([
      // Count pending flags by severity
      prisma.dataFlag.groupBy({
        by: ['severity', 'flagType'],
        where: { status: 'pending' },
        _count: { id: true },
      }),
      // Recent unresolved flags with details
      prisma.dataFlag.findMany({
        where: { status: { in: ['pending', 'in_review'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          flagType: true,
          severity: true,
          status: true,
          sourceTable: true,
          title: true,
          description: true,
          rawValue: true,
          suggestedMatch: true,
          similarityScore: true,
          createdAt: true,
        },
      }),
    ]);

    console.log(`[DataLoader:dataFlags] Queries completed in ${Date.now() - queryStart}ms (pending groups: ${pendingFlags.length}, recent flags: ${recentFlags.length})`);

    if (pendingFlags.length === 0 && recentFlags.length === 0) {
      return { dataAvailable: false, pendingIssueCount: 0 };
    }

    // Summarize by severity
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const group of pendingFlags) {
      bySeverity[group.severity] = (bySeverity[group.severity] || 0) + group._count.id;
      byType[group.flagType] = (byType[group.flagType] || 0) + group._count.id;
    }

    return {
      dataAvailable: true,
      pendingIssueCount: Object.values(bySeverity).reduce((a, b) => a + b, 0),
      bySeverity,
      byType,
      recentFlags: recentFlags.map(f => ({
        type: f.flagType,
        severity: f.severity,
        title: f.title,
        description: f.description.substring(0, 200),
        sourceTable: f.sourceTable,
        rawValue: f.rawValue,
        suggestedMatch: f.suggestedMatch,
        similarityScore: f.similarityScore ? parseFloat(f.similarityScore.toString()) : null,
        createdAt: f.createdAt.toISOString().split('T')[0],
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

    // Run all queries in parallel with timeouts to prevent any single query from blocking
    const [pastQuestions, recentlyAskedQuestions, recentDigests, collectedUrls, pastInvestigations, monthlyContext] = await Promise.all([
      // Fetch past questions with their performance data
      safeQuery(
        () => prisma.learningQuestion.findMany({
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
        }),
        [],
        'pastQuestions'
      ),

      // Get questions asked recently (within cooldown) to avoid repetition
      safeQuery(
        () => prisma.learningQuestion.findMany({
          where: {
            lastAsked: { gte: cooldownDate },
            answerQuality: { gte: DAILY_LEARNING_CONFIG.lowQualityThreshold },
          },
          select: { question: true },
        }),
        [],
        'recentlyAskedQuestions'
      ),

      // Fetch past digests with expanded fields for industry/regulatory context
      safeQuery(
        () => prisma.dailyDigest.findMany({
          orderBy: { digestDate: 'desc' },
          take: DAILY_LEARNING_CONFIG.maxPastDigestsForContext,
          select: {
            digestDate: true,
            correlatedInsights: true,
            questionsForTomorrow: true,
            industryHighlights: true,
            regulatoryUpdates: true,
          },
        }),
        [],
        'recentDigests'
      ),

      // Fetch collected URLs with high relevance for web research memory
      safeQuery(
        () => prisma.collectedUrl.findMany({
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
        }),
        [],
        'collectedUrls'
      ),

      // Fetch past investigations (user deep-dives) for learning continuity
      safeQuery(
        () => prisma.analysisHistory.findMany({
          where: {
            analysisType: {
              in: ['investigation', 'buyer-investigation'],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: DAILY_LEARNING_CONFIG.maxPastInvestigationsForContext,
          select: {
            analysisType: true,
            inputSummary: true,
            outputSummary: true,
            createdAt: true,
          },
        }),
        [],
        'pastInvestigations'
      ),

      // Fetch monthly strategic context
      this.getMonthlyStrategicContext(),
    ]);

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

    // Extract monthly context from the parallel fetched result
    const { monthlyStrategicQuestions, strategicPriorities } = monthlyContext;

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
      // Include past user investigations for learning continuity
      pastInvestigations: pastInvestigations.map(inv => ({
        type: inv.analysisType,
        summary: inv.inputSummary,
        analysis: inv.outputSummary,
        createdAt: inv.createdAt,
      })),
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
    const latestReport = await safeQuery(
      () => prisma.monthlyStrategicReport.findFirst({
        orderBy: { createdAt: 'desc' },
        select: {
          keyQuestionsNext: true,
          strategicPriorities: true,
        },
      }),
      null,
      'monthlyStrategicReport'
    );

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
    const lowQualityQuestions = await safeQuery(
      () => prisma.learningQuestion.findMany({
        where: {
          isActive: true,
          answerQuality: { lt: DAILY_LEARNING_CONFIG.lowQualityThreshold },
          timesAsked: { gte: 1 },
        },
        orderBy: { answerQuality: 'asc' },
        take: 3,
        select: { question: true },
      }),
      [],
      'lowQualityQuestions'
    );

    return lowQualityQuestions.map(q => q.question);
  }

  private async buildSearchQuery(question: GeneratedQuestion, state: DailyLearningJobState): Promise<string> {
    const prompt = `Convert this question into a Google search query (under 60 chars):
"${question.question}"
Focus on California cannabis market. Return ONLY the query.`;

    // Add retry with timeout to Claude API call to handle transient failures
    const response = await withRetry(
      () => this.client.messages.create({
        model: CLAUDE_CONFIG.haiku,
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
      'buildSearchQuery'
    );

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

    // Add retry with timeout to Claude API call to handle transient failures
    const response = await withRetry(
      () => this.client.messages.create({
        model: CLAUDE_CONFIG.haiku,
        max_tokens: DAILY_LEARNING_CONFIG.phase3TokenBudget,
        messages: [{ role: 'user', content: prompt }],
      }),
      'analyzeSearchResults'
    );

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

  // Maximum time a job can run before being considered stale
  // Lambda/Amplify timeout is 15 minutes, so 20 minutes allows for buffer
  // ISSUE #7 FIX: Reduced from 1 hour to detect failures faster
  private static readonly STALE_JOB_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

  async getCurrentJobStatus(): Promise<{
    isRunning: boolean;
    currentJob: { id: string; phase: string; startedAt: Date; progress: number } | null;
  }> {
    const runningJob = await prisma.dailyLearningJob.findFirst({
      where: { status: 'running' },
      orderBy: { startedAt: 'desc' },
    });

    if (!runningJob) return { isRunning: false, currentJob: null };

    // ISSUE #7 FIX: Check if the job is stale based on lastHeartbeat (if available) or startedAt
    // This allows long-running but active jobs to continue, while detecting crashed jobs faster
    const lastActivity = runningJob.lastHeartbeat || runningJob.startedAt;
    const timeSinceActivity = Date.now() - lastActivity.getTime();
    const totalJobAge = Date.now() - runningJob.startedAt.getTime();

    if (timeSinceActivity > DailyLearningService.STALE_JOB_TIMEOUT_MS) {
      // Auto-recover: Mark stale job as failed
      const hasHeartbeat = !!runningJob.lastHeartbeat;
      console.warn(
        `Stale job detected: ${runningJob.id} - no activity for ${Math.round(timeSinceActivity / 60000)} minutes ` +
        `(total age: ${Math.round(totalJobAge / 60000)} min, heartbeat: ${hasHeartbeat}). Auto-recovering.`
      );
      await prisma.dailyLearningJob.update({
        where: { id: runningJob.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: `Job stalled - no activity for ${Math.round(timeSinceActivity / 60000)} minutes (phase: ${runningJob.currentPhase || 'unknown'})`,
          errorPhase: runningJob.currentPhase || 'unknown',
        },
      });
      return { isRunning: false, currentJob: null };
    }

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
   * Updates the heartbeat timestamp for a running job.
   * ISSUE #7 FIX: Called at the start of each phase to track progress.
   * This allows stale job detection to differentiate between:
   * - Jobs that crashed (no heartbeat updates)
   * - Jobs that are legitimately taking time (recent heartbeat)
   */
  async updateJobHeartbeat(jobId: string, phase: string): Promise<void> {
    try {
      await prisma.dailyLearningJob.update({
        where: { id: jobId },
        data: {
          lastHeartbeat: new Date(),
          currentPhase: phase,
        },
      });
    } catch (error) {
      // Don't fail the job if heartbeat update fails, just log it
      console.warn(`[heartbeat] Failed to update heartbeat for job ${jobId}:`, error);
    }
  }

  /**
   * Cleans up any stale jobs that have been running for too long.
   * ISSUE #7 FIX: Uses lastHeartbeat when available to determine staleness.
   * This should be called before starting a new job to ensure we don't
   * block on jobs that crashed or stalled.
   */
  async cleanupStaleJobs(): Promise<number> {
    const staleThreshold = new Date(Date.now() - DailyLearningService.STALE_JOB_TIMEOUT_MS);

    // Find all running jobs (we'll filter by activity time in application code
    // since we need to check lastHeartbeat OR startedAt)
    const runningJobs = await prisma.dailyLearningJob.findMany({
      where: { status: 'running' },
    });

    // Filter to truly stale jobs (no activity within threshold)
    const staleJobs = runningJobs.filter(job => {
      const lastActivity = job.lastHeartbeat || job.startedAt;
      return lastActivity < staleThreshold;
    });

    if (staleJobs.length === 0) return 0;

    console.warn(`Found ${staleJobs.length} stale job(s). Auto-recovering...`);

    for (const job of staleJobs) {
      const lastActivity = job.lastHeartbeat || job.startedAt;
      const timeSinceActivity = Date.now() - lastActivity.getTime();
      const totalJobAge = Date.now() - job.startedAt.getTime();

      await prisma.dailyLearningJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: `Job stalled - no activity for ${Math.round(timeSinceActivity / 60000)} minutes (total: ${Math.round(totalJobAge / 60000)} min)`,
          errorPhase: job.currentPhase || 'unknown',
        },
      });
      console.warn(`Recovered stale job ${job.id} (was in phase: ${job.currentPhase || 'unknown'}, no activity for ${Math.round(timeSinceActivity / 60000)} min)`);
    }

    return staleJobs.length;
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
