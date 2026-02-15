# Progressive Learning System - Fix Plan

This document outlines issues found during the audit of the 5-phase autonomous learning pipeline and provides implementation plans for each fix.

---

## Critical Issues (Blocking)

### Issue #1: Duplicate Conflicting API Routes ✅ FIXED

**Problem:** Two separate API route implementations exist with different behavior:
- `src/app/api/learning/daily/route.ts` (192 lines) - Has auth check, multiple actions
- `src/app/api/ai/learning/run/route.ts` (78 lines) - No auth, simpler implementation

**Impact:** Unclear which endpoint is used, inconsistent error handling, security gap (one lacks auth).

**Solution Implemented:**
1. Created shared auth utility at `src/app/api/ai/learning/auth.ts` with:
   - `isLearningApiAuthorized()` - Checks Bearer token, X-API-Key header, or localhost access
   - `unauthorizedResponse()` - Returns consistent 401 responses
   - `withLearningAuth()` - HOC wrapper for cleaner route handlers
2. Added auth to `run/route.ts` and `cancel/route.ts` (POST endpoints that modify state)
3. Enhanced `status/route.ts` to include searchBudget info from the deleted route
4. Updated `aws/cloudformation-template.yaml` to use new route path (`/api/ai/learning/run`) and new request format (`sync: true` instead of `action: 'run_sync'`)
5. Deleted `src/app/api/learning/daily/route.ts` and its directory

**Files modified:**
- `src/app/api/ai/learning/auth.ts` - NEW: Shared auth utility
- `src/app/api/ai/learning/run/route.ts` - Added auth check
- `src/app/api/ai/learning/cancel/route.ts` - Added auth check
- `src/app/api/ai/learning/status/route.ts` - Added searchBudget data
- `aws/cloudformation-template.yaml` - Updated Lambda functions to use new route
- `src/app/api/learning/daily/route.ts` - DELETED

---

### Issue #2: Async Jobs Fail Silently (Fire-and-Forget) ✅ FIXED

**Problem:** Both API routes start the learning job without awaiting, using fire-and-forget pattern:
```typescript
dailyLearningService.runDailyLearning({ forceRun, skipWebResearch })
  .then(result => console.log(...))
  .catch(error => console.error(...)); // Error only goes to console

return NextResponse.json({ success: true }); // Returns before job completes
```

**Impact:** Client believes job is running when it may have already failed. No error propagation.

**Solution Implemented:**
1. Added `validateStartupRequirements()` method that runs synchronously before returning success
2. Added `validateEnvironment()` method to check required env vars upfront
3. Added `persistJobError()` method for persisting errors to database
4. Added `createJob()` method for explicit job creation with metadata
5. Added `updateJobMetadata()` method for tracking runtime state
6. Updated run route to validate synchronously before fire-and-forget:
   - Catches env var and quota issues before returning success
   - Returns warnings in response when quota is low
   - Errors are persisted to DB via `runDailyLearning` catch block

**Files modified:**
- `src/lib/services/daily-learning.ts` - Added validation methods and metadata tracking
- `src/app/api/ai/learning/run/route.ts` - Added sync validation before async execution
- `prisma/schema.prisma` - Added `jobMetadata` JSON field to DailyLearningJob

---

### Issue #3: Environment Variables Validated Too Late ✅ FIXED

**Problem:** SerpAPI key check happens at Phase 3 execution, not at startup:
```typescript
// In web-search.ts:348
const apiKey = process.env.SERPAPI_API_KEY;
if (!apiKey) {
  throw new Error('SERPAPI_API_KEY environment variable is not set');
}
```

**Impact:** Phases 1 & 2 complete (consuming Claude tokens) before Phase 3 fails.

**Solution Implemented:**
1. Added `validateEnvironment(skipWebResearch)` method that checks:
   - `ANTHROPIC_API_KEY` (always required)
   - `DATABASE_URL` (always required)
   - `SERPAPI_API_KEY` (required only if !skipWebResearch)
2. Called at the start of `runDailyLearning()` BEFORE any phases execute
3. Also called by `validateStartupRequirements()` for API route validation
4. Validation result tracked in job metadata (`envValidation` field)

**Files modified:**
- `src/lib/services/daily-learning.ts` - Added `validateEnvironment()` called at job start

---

### Issue #4: SerpAPI Quota Exhaustion Fails Silently ✅ FIXED

**Problem:** When monthly limit (250 searches) is exhausted, Phase 3 returns empty array silently:
```typescript
// daily-learning.ts:970
if (availableSearches <= 0) return [];  // Silent failure
```

**Impact:** Web research skipped without warning, digest generated with incomplete data.

**Solution Implemented:**
1. Added `JobMetadata` interface with quota tracking:
```typescript
interface JobMetadata {
  webResearchSkipped: boolean;
  webResearchSkipReason?: 'quota_exhausted' | 'api_key_missing' | 'user_requested' | 'low_quota';
  quotaAtStart?: number;
  quotaWarning?: string;
  envValidation?: { validated: boolean; timestamp: string; skippedChecks?: string[] };
  phaseTimings?: Record<string, { start: string; end?: string; durationMs?: number }>;
}
```
2. Pre-check quota in `validateStartupRequirements()` before job creation:
   - If quota exhausted: automatically skips web research with reason
   - If <3 searches: skips web research with 'low_quota' reason
   - If 80-90% used: logs warning and includes in metadata
   - If 90-100% used: logs critical warning
3. Phase 3 now logs when skipped and updates job metadata
4. API route returns `warnings` array when quota is low
5. Added `jobMetadata` JSON field to DailyLearningJob table

**Files modified:**
- `src/lib/services/daily-learning.ts` - Added `JobMetadata` type, quota pre-check, metadata tracking
- `src/app/api/ai/learning/run/route.ts` - Returns warnings in response
- `prisma/schema.prisma` - Added `jobMetadata` field

---

## High Priority Issues

### Issue #5: JSON Parsing Fragility (3-Level Fallbacks)

**Problem:** Phase 1 data review has 3 fallback levels for JSON parsing (`daily-learning.ts:462-510`), suggesting Claude responses are frequently malformed.

**Impact:** Data loss when fallbacks kick in, reduced digest quality.

**Solution Plan:**
1. Investigate root cause - likely token budget too small or prompt issues
2. Increase Phase 1 token budget from 8,000 to 12,000
3. Add explicit JSON formatting instructions to system prompt:
```typescript
const systemPrompt = `...
IMPORTANT: Your response must be valid JSON only. No markdown, no code blocks, no explanation text.
Start with { and end with }. Ensure all strings are properly escaped.
...`;
```
4. Add response validation before parsing:
```typescript
function cleanClaudeResponse(text: string): string {
  // Remove markdown code blocks if present
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  // Trim whitespace
  text = text.trim();
  // Find JSON boundaries
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    return text.slice(start, end + 1);
  }
  return text;
}
```

**Files to modify:**
- `src/lib/services/daily-learning.ts` - Improve prompts, add response cleaning
- `src/lib/services/claude.ts` - Add global response cleaning utility

---

### Issue #6: Phase 4 Uses Sonnet ✅ DOCUMENTED AS INTENTIONAL

**Original Concern:** Phase 4 uses `CLAUDE_CONFIG.defaultModel` (Sonnet) while all other phases use Haiku. Sonnet is 3-5x more expensive.

**Resolution:** This is an **intentional design choice**, not a bug.

Phase 4 (Correlation Analysis) performs complex cross-domain pattern detection across sales, customer, brand, and market data. Using Sonnet provides:
- More deliberate and accurate correlation identification
- Better reasoning across multiple data dimensions
- Higher quality insight synthesis

The additional cost is justified by the critical nature of the correlation phase in producing actionable business insights.

**Status:** No code changes needed. Documented as a feature.

---

### Issue #7: Stale Job Timeout Too Long (1 Hour) ✅ FIXED

**Problem:** Jobs running >1 hour are marked failed, but Lambda timeout is 15 minutes.

**Impact:** Legitimate failures hang for 45+ minutes before detection.

**Solution Implemented:**
1. Reduced stale timeout from 1 hour to 20 minutes (Lambda timeout + buffer)
2. Added `lastHeartbeat` field to `DailyLearningJob` schema
3. Enhanced `updateJobPhase()` to also update heartbeat timestamp
4. Updated stale detection logic to check `lastHeartbeat` (if available) instead of just `startedAt`
5. Added standalone `updateJobHeartbeat()` method for future use

**Key Changes:**
- Stale timeout reduced: 60 min → 20 min
- Detection now checks time since last heartbeat, not total job age
- Jobs making progress (updating phases) won't be falsely marked stale
- Jobs that crash mid-phase are detected within 20 minutes

**Files modified:**
- `src/lib/services/daily-learning.ts` - Timeout, heartbeat method, stale detection
- `prisma/schema.prisma` - Added `lastHeartbeat DateTime?` field
- `prisma/migrations/20260215_add_last_heartbeat/migration.sql` - Schema migration

---

## Medium Priority Issues

### Issue #8: Historical Context Queries Can Timeout

**Problem:** 6 parallel context queries in Phase 2 use `safeQuery` with 60s timeout. If any timeout, phase proceeds with incomplete history.

**Solution Plan:**
1. Log when context queries return defaults due to timeout
2. Track which contexts were incomplete in job metadata
3. Consider reducing parallel queries or implementing circuit breaker

**Files to modify:**
- `src/lib/services/daily-learning.ts` - Lines 1786-1887, add logging

---

### Issue #9: No Observability/Metrics ✅ FIXED

**Problem:** No logging of data failures, no token tracking, no phase duration metrics.

**Impact:** Difficult to debug failures, understand system health, or optimize performance.

**Solution Implemented:**
1. Added `PhaseMetric` interface for structured phase-level metrics:
```typescript
interface PhaseMetric {
  phase: string;
  status: 'success' | 'failed' | 'skipped';
  startTime: string;
  endTime?: string;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  dataSources?: { loaded: string[]; failed: string[] };
  itemsProcessed?: number;
}
```

2. Extended `JobMetadata` with:
   - `phaseMetrics` array for per-phase tracking
   - `healthSummary` for aggregate job health stats

3. Created `LearningPhaseMetric` Prisma model for persisting phase metrics to database

4. Added observability helper methods:
   - `startPhaseMetric()` - Begin tracking a phase
   - `completePhaseMetric()` - Finalize phase with status and stats
   - `persistPhaseMetric()` - Save to database for historical analysis
   - `calculateHealthSummary()` - Aggregate metrics across phases
   - `logDataSourceResult()` - Structured logging for data source loads

5. Updated `phase1DataReviewWithMetrics()` to track:
   - Which data sources loaded successfully
   - Which data sources failed
   - Per-source timing

6. Enhanced status API (`/api/ai/learning/status`):
   - GET: Returns current job metrics (tokens, phases, data sources)
   - POST: Returns metrics history for dashboard visualization
   - Includes aggregate metrics across recent jobs

**Key Metrics Now Tracked:**
- Per-phase token usage (input/output)
- Per-phase duration in milliseconds
- Phase success/failure/skipped status
- Data sources loaded vs failed
- Items processed per phase (questions, insights, articles)
- Overall job health summary

**Files modified:**
- `src/lib/services/daily-learning.ts` - Added PhaseMetric interface, observability helpers, metrics tracking
- `src/app/api/ai/learning/status/route.ts` - Enhanced with metrics endpoints
- `prisma/schema.prisma` - Added LearningPhaseMetric model
- `prisma/migrations/20260215_add_learning_phase_metrics/migration.sql` - New migration

---

### Issue #10: Model Names Hardcoded as Strings

**Problem:** Model identifiers are hardcoded strings in config. No validation they exist.

**Solution Plan:**
1. Add model validation at startup:
```typescript
const VALID_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001'
] as const;

type ClaudeModel = typeof VALID_MODELS[number];
```
2. Add deprecation warning system for model versions
3. Consider fetching available models from API at startup

**Files to modify:**
- `src/lib/config.ts` - Add type safety
- `src/lib/services/claude.ts` - Add validation

---

## Implementation Order

Recommended sequence for fixes:

1. **Issue #3** - Environment validation (quick win, prevents wasted tokens)
2. **Issue #4** - SerpAPI quota pre-check (quick win, improves reliability)
3. **Issue #2** - Async job error handling (critical for debugging)
4. **Issue #1** - API route consolidation (requires frontend investigation first)
5. **Issue #7** - Reduce stale timeout (quick config change)
6. **Issue #5** - JSON parsing improvements (improves data quality)
7. **Issue #6** - Document/fix Phase 4 model (cost control)
8. **Issues #8-10** - Observability and hardening (ongoing improvement)

---

## Testing Checklist

After implementing fixes, verify:

- [ ] Learning job starts and completes successfully
- [ ] Missing env vars cause immediate failure with clear error
- [ ] SerpAPI quota exhaustion is logged and included in digest metadata
- [ ] Job errors are persisted to database, not just console
- [ ] Status endpoint returns accurate job state
- [ ] Stale jobs are detected within 20 minutes
- [ ] All 5 phases complete and produce valid output
- [ ] Digest contains expected fields with reasonable content
- [ ] Token usage is within expected budgets

---

## Reference: Key File Locations

| Component | Path |
|-----------|------|
| Main learning service | `src/lib/services/daily-learning.ts` |
| Claude integration | `src/lib/services/claude.ts` |
| Web search service | `src/lib/services/web-search.ts` |
| Learning API auth | `src/app/api/ai/learning/auth.ts` |
| API route - run | `src/app/api/ai/learning/run/route.ts` |
| API route - status | `src/app/api/ai/learning/status/route.ts` |
| API route - digest | `src/app/api/ai/learning/digest/route.ts` |
| API route - history | `src/app/api/ai/learning/history/route.ts` |
| API route - cancel | `src/app/api/ai/learning/cancel/route.ts` |
| AWS Lambda config | `aws/cloudformation-template.yaml` |
| Config | `src/lib/config.ts` |
| Prisma schema | `prisma/schema.prisma` |
| Knowledge base | `src/lib/services/knowledge-base.ts` |
| Data correlations | `src/lib/services/data-correlations.ts` |
