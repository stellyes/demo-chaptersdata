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

### Issue #6: Phase 4 Uses Sonnet (Undocumented Cost Difference)

**Problem:** Phase 4 uses `CLAUDE_CONFIG.defaultModel` (Sonnet) while all other phases use Haiku. Sonnet is 3-5x more expensive.

**Impact:** Unexpected cost spike, not budgeted.

**Solution Plan:**
1. Document the intentional choice (if intentional) in code comments
2. OR switch to Haiku for consistency:
```typescript
// Phase 4 - use Haiku like other phases
const model = CLAUDE_CONFIG.haiku;
```
3. Add cost tracking per phase to monitor actual spend:
```typescript
interface PhaseMetrics {
  phase: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  duration: number;
}
```

**Files to modify:**
- `src/lib/services/daily-learning.ts` - Line ~1118, change model or add comment
- Consider adding cost tracking throughout

---

### Issue #7: Stale Job Timeout Too Long (1 Hour)

**Problem:** Jobs running >1 hour are marked failed, but Lambda timeout is 15 minutes.

**Impact:** Legitimate failures hang for 45+ minutes before detection.

**Solution Plan:**
1. Reduce stale timeout to 20 minutes (Lambda timeout + buffer):
```typescript
// daily-learning.ts:109
private readonly STALE_JOB_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
```
2. Add phase-level heartbeat updates to track progress:
```typescript
async updateJobHeartbeat(jobId: string, phase: string): Promise<void> {
  await prisma.dailyLearningJob.update({
    where: { id: jobId },
    data: { lastHeartbeat: new Date(), currentPhase: phase }
  });
}
```

**Files to modify:**
- `src/lib/services/daily-learning.ts` - Reduce timeout, add heartbeat
- `prisma/schema.prisma` - Add `lastHeartbeat DateTime?` field to DailyLearningJob (if not present)

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

### Issue #9: No Observability/Metrics

**Problem:** No logging of data failures, no token tracking, no phase duration metrics.

**Solution Plan:**
1. Add structured logging for each phase:
```typescript
interface PhaseLog {
  jobId: string;
  phase: number;
  startTime: Date;
  endTime: Date;
  success: boolean;
  tokensUsed?: number;
  error?: string;
  dataSourcesLoaded?: string[];
  dataSourcesFailed?: string[];
}
```
2. Persist to `AnalysisHistory` table or new `LearningMetrics` table
3. Add dashboard component to visualize learning health

**Files to modify:**
- `src/lib/services/daily-learning.ts` - Add logging throughout
- Consider new Prisma model for metrics

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
