// ============================================
// LEARNING PIPELINE CONFIGURATION
// Centralizes all configurable settings for the 5-phase learning pipeline.
// Every value can be overridden via environment variables.
// ============================================

import { CLAUDE_CONFIG } from '@/lib/config';

// Helper: parse int from env with fallback
const envInt = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const parsed = parseInt(v, 10);
  return isNaN(parsed) ? fallback : parsed;
};

// Helper: parse float from env with fallback
const envFloat = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const parsed = parseFloat(v);
  return isNaN(parsed) ? fallback : parsed;
};

// Helper: parse string from env with fallback
const envStr = (key: string, fallback: string): string =>
  process.env[key] || fallback;

// ============================================
// GLOBAL TIMEOUTS & RETRY SETTINGS
// ============================================
export const LEARNING_TIMEOUTS = {
  /** Timeout for individual database queries (ms) */
  queryTimeoutMs: envInt('LEARNING_QUERY_TIMEOUT_MS', 60000),
  /** Timeout for individual Claude API calls (ms) */
  claudeApiTimeoutMs: envInt('LEARNING_CLAUDE_API_TIMEOUT_MS', 2 * 60 * 1000),
  /** Overall Phase 1 timeout — prevents indefinite stalls (ms) */
  phase1OverallTimeoutMs: envInt('LEARNING_PHASE1_OVERALL_TIMEOUT_MS', 5 * 60 * 1000),
  /** Max retries for Claude API calls */
  claudeApiMaxRetries: envInt('LEARNING_CLAUDE_API_MAX_RETRIES', 3),
  /** Stale job timeout for auto-recovery (ms) */
  staleJobTimeoutMs: envInt('LEARNING_STALE_JOB_TIMEOUT_MS', 60 * 60 * 1000),
};

// ============================================
// PER-PHASE CONFIGURATION
// ============================================
export interface PhaseConfig {
  /** Claude model ID to use */
  model: string;
  /** Max output tokens for the Claude API call */
  tokenBudget: number;
  /** Overall timeout for this phase (ms). 0 = no per-phase timeout beyond API call timeout. */
  timeoutMs: number;
  /** Whether this phase is enabled */
  enabled: boolean;
}

export const PHASE_CONFIGS: Record<string, PhaseConfig> = {
  data_review: {
    model: envStr('LEARNING_PHASE1_MODEL', CLAUDE_CONFIG.defaultModel),
    tokenBudget: envInt('LEARNING_PHASE1_TOKEN_BUDGET', 16000),
    timeoutMs: envInt('LEARNING_PHASE1_TIMEOUT_MS', 5 * 60 * 1000),
    enabled: process.env.LEARNING_PHASE1_ENABLED !== 'false',
  },
  question_gen: {
    model: envStr('LEARNING_PHASE2_MODEL', CLAUDE_CONFIG.defaultModel),
    tokenBudget: envInt('LEARNING_PHASE2_TOKEN_BUDGET', 12000),
    timeoutMs: envInt('LEARNING_PHASE2_TIMEOUT_MS', 3 * 60 * 1000),
    enabled: process.env.LEARNING_PHASE2_ENABLED !== 'false',
  },
  web_research: {
    model: envStr('LEARNING_PHASE3_MODEL', CLAUDE_CONFIG.defaultModel),
    tokenBudget: envInt('LEARNING_PHASE3_TOKEN_BUDGET', 12000),
    timeoutMs: envInt('LEARNING_PHASE3_TIMEOUT_MS', 10 * 60 * 1000),
    enabled: process.env.LEARNING_PHASE3_ENABLED !== 'false',
  },
  correlation: {
    model: envStr('LEARNING_PHASE4_MODEL', CLAUDE_CONFIG.defaultModel),
    tokenBudget: envInt('LEARNING_PHASE4_TOKEN_BUDGET', 20000),
    timeoutMs: envInt('LEARNING_PHASE4_TIMEOUT_MS', 5 * 60 * 1000),
    enabled: process.env.LEARNING_PHASE4_ENABLED !== 'false',
  },
  digest_gen: {
    model: envStr('LEARNING_PHASE5_MODEL', CLAUDE_CONFIG.defaultModel),
    tokenBudget: envInt('LEARNING_PHASE5_TOKEN_BUDGET', 16000),
    timeoutMs: envInt('LEARNING_PHASE5_TIMEOUT_MS', 5 * 60 * 1000),
    enabled: process.env.LEARNING_PHASE5_ENABLED !== 'false',
  },
};

// ============================================
// SEARCH & QUOTA SETTINGS
// ============================================
export const LEARNING_SEARCH_CONFIG = {
  maxSearchesPerDay: envInt('LEARNING_MAX_SEARCHES_PER_DAY', 30),
  maxPagesPerSearch: envInt('LEARNING_MAX_PAGES_PER_SEARCH', 5),
  maxWebResearchQuestions: envInt('LEARNING_MAX_WEB_RESEARCH_QUESTIONS', 10),
  questionsPerCycle: envInt('LEARNING_QUESTIONS_PER_CYCLE', 10),
};

// ============================================
// PROGRESSIVE LEARNING CONTEXT LIMITS
// ============================================
export const LEARNING_CONTEXT_LIMITS = {
  maxPastQuestionsForContext: envInt('LEARNING_MAX_PAST_QUESTIONS', 50),
  maxPastInsightsForContext: envInt('LEARNING_MAX_PAST_INSIGHTS', 25),
  maxPastDigestsForContext: envInt('LEARNING_MAX_PAST_DIGESTS', 14),
  maxIndustryHighlightsForContext: envInt('LEARNING_MAX_INDUSTRY_HIGHLIGHTS', 10),
  maxRegulatoryUpdatesForContext: envInt('LEARNING_MAX_REGULATORY_UPDATES', 10),
  maxCollectedUrlsForContext: envInt('LEARNING_MAX_COLLECTED_URLS', 15),
  maxPastInvestigationsForContext: envInt('LEARNING_MAX_PAST_INVESTIGATIONS', 10),
  questionRepeatCooldownDays: envInt('LEARNING_QUESTION_COOLDOWN_DAYS', 7),
  lowQualityThreshold: envFloat('LEARNING_LOW_QUALITY_THRESHOLD', 0.4),
};

// ============================================
// LOG CAPTURE SETTINGS
// ============================================
export const LEARNING_LOG_CONFIG = {
  bufferMaxSize: envInt('LEARNING_LOG_BUFFER_MAX_SIZE', 200),
  flushIntervalMs: envInt('LEARNING_LOG_FLUSH_INTERVAL_MS', 3000),
};

// ============================================
// COMBINED CONFIG — backwards-compatible with DAILY_LEARNING_CONFIG shape
// ============================================
export const DAILY_LEARNING_CONFIG = {
  maxSearchesPerDay: LEARNING_SEARCH_CONFIG.maxSearchesPerDay,
  maxPagesPerSearch: LEARNING_SEARCH_CONFIG.maxPagesPerSearch,
  phase1TokenBudget: PHASE_CONFIGS.data_review.tokenBudget,
  phase2TokenBudget: PHASE_CONFIGS.question_gen.tokenBudget,
  phase3TokenBudget: PHASE_CONFIGS.web_research.tokenBudget,
  phase4TokenBudget: PHASE_CONFIGS.correlation.tokenBudget,
  phase5TokenBudget: PHASE_CONFIGS.digest_gen.tokenBudget,
  questionsPerCycle: LEARNING_SEARCH_CONFIG.questionsPerCycle,
  maxWebResearchQuestions: LEARNING_SEARCH_CONFIG.maxWebResearchQuestions,
  // Progressive learning settings
  maxPastQuestionsForContext: LEARNING_CONTEXT_LIMITS.maxPastQuestionsForContext,
  maxPastInsightsForContext: LEARNING_CONTEXT_LIMITS.maxPastInsightsForContext,
  maxPastDigestsForContext: LEARNING_CONTEXT_LIMITS.maxPastDigestsForContext,
  maxIndustryHighlightsForContext: LEARNING_CONTEXT_LIMITS.maxIndustryHighlightsForContext,
  maxRegulatoryUpdatesForContext: LEARNING_CONTEXT_LIMITS.maxRegulatoryUpdatesForContext,
  maxCollectedUrlsForContext: LEARNING_CONTEXT_LIMITS.maxCollectedUrlsForContext,
  maxPastInvestigationsForContext: LEARNING_CONTEXT_LIMITS.maxPastInvestigationsForContext,
  questionRepeatCooldownDays: LEARNING_CONTEXT_LIMITS.questionRepeatCooldownDays,
  lowQualityThreshold: LEARNING_CONTEXT_LIMITS.lowQualityThreshold,
};

/**
 * Logs the full resolved configuration at startup for debugging.
 * Call once at the beginning of a learning job.
 */
export function logLearningConfig(): void {
  console.log(`[Config] ========== LEARNING PIPELINE CONFIGURATION ==========`);
  console.log(`[Config] Timeouts:`);
  console.log(`[Config]   DB query timeout: ${LEARNING_TIMEOUTS.queryTimeoutMs}ms`);
  console.log(`[Config]   Claude API timeout: ${LEARNING_TIMEOUTS.claudeApiTimeoutMs}ms`);
  console.log(`[Config]   Claude API max retries: ${LEARNING_TIMEOUTS.claudeApiMaxRetries}`);
  console.log(`[Config]   Stale job timeout: ${LEARNING_TIMEOUTS.staleJobTimeoutMs}ms`);
  console.log(`[Config] Phase configs:`);
  for (const [phase, cfg] of Object.entries(PHASE_CONFIGS)) {
    console.log(`[Config]   ${phase}: model=${cfg.model}, tokens=${cfg.tokenBudget}, timeout=${cfg.timeoutMs}ms, enabled=${cfg.enabled}`);
  }
  console.log(`[Config] Search: maxPerDay=${LEARNING_SEARCH_CONFIG.maxSearchesPerDay}, pagesPerSearch=${LEARNING_SEARCH_CONFIG.maxPagesPerSearch}, questionsPerCycle=${LEARNING_SEARCH_CONFIG.questionsPerCycle}`);
  console.log(`[Config] Context limits: questions=${LEARNING_CONTEXT_LIMITS.maxPastQuestionsForContext}, insights=${LEARNING_CONTEXT_LIMITS.maxPastInsightsForContext}, digests=${LEARNING_CONTEXT_LIMITS.maxPastDigestsForContext}`);
  console.log(`[Config] Log capture: bufferMax=${LEARNING_LOG_CONFIG.bufferMaxSize}, flushInterval=${LEARNING_LOG_CONFIG.flushIntervalMs}ms`);
  console.log(`[Config] ======================================================`);
}
