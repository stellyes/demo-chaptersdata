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

### Issue #2: Async Jobs Fail Silently (Fire-and-Forget)

**Problem:** Both API routes start the learning job without awaiting, using fire-and-forget pattern:
```typescript
dailyLearningService.runDailyLearning({ forceRun, skipWebResearch })
  .then(result => console.log(...))
  .catch(error => console.error(...)); // Error only goes to console

return NextResponse.json({ success: true }); // Returns before job completes
```

**Impact:** Client believes job is running when it may have already failed. No error propagation.

**Solution Plan:**
1. Modify `runDailyLearning()` to persist errors to database immediately on failure
2. Add a `startupValidation()` method that runs synchronously before returning success
3. Return job ID immediately, but ensure startup errors are caught:
```typescript
// New pattern
try {
  const jobId = await dailyLearningService.createJob(); // Sync - creates DB record
  await dailyLearningService.validateStartupRequirements(); // Sync - checks env vars, quotas

  // Only now fire-and-forget
  dailyLearningService.executeJob(jobId)
    .catch(error => dailyLearningService.persistJobError(jobId, error));

  return NextResponse.json({ success: true, jobId });
} catch (error) {
  return NextResponse.json({ success: false, error: error.message }, { status: 500 });
}
```

**Files to modify:**
- `src/lib/services/daily-learning.ts` - Add `createJob()`, `validateStartupRequirements()`, `persistJobError()` methods
- `src/app/api/ai/learning/run/route.ts` - Use new pattern

---

### Issue #3: Environment Variables Validated Too Late

**Problem:** SerpAPI key check happens at Phase 3 execution, not at startup:
```typescript
// In web-search.ts:348
const apiKey = process.env.SERPAPI_API_KEY;
if (!apiKey) {
  throw new Error('SERPAPI_API_KEY environment variable is not set');
}
```

**Impact:** Phases 1 & 2 complete (consuming Claude tokens) before Phase 3 fails.

**Solution Plan:**
1. Add a `validateEnvironment()` function in `daily-learning.ts`:
```typescript
private validateEnvironment(): void {
  const required = [
    'ANTHROPIC_API_KEY',
    'SERPAPI_API_KEY',
    'DATABASE_URL'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
```
2. Call this in constructor or at job start (before Phase 1)
3. Add optional `skipWebResearch` flag to bypass SerpAPI requirement when intentionally skipping

**Files to modify:**
- `src/lib/services/daily-learning.ts` - Add validation in constructor or `runDailyLearning()`

---

### Issue #4: SerpAPI Quota Exhaustion Fails Silently

**Problem:** When monthly limit (250 searches) is exhausted, Phase 3 returns empty array silently:
```typescript
// daily-learning.ts:970
if (availableSearches <= 0) return [];  // Silent failure
```

**Impact:** Web research skipped without warning, digest generated with incomplete data.

**Solution Plan:**
1. Add quota status to job metadata:
```typescript
interface JobMetadata {
  webResearchSkipped: boolean;
  webResearchSkipReason?: 'quota_exhausted' | 'api_key_missing' | 'user_requested';
  quotaRemaining?: number;
}
```
2. Include warning in Phase 5 digest when web research was skipped
3. Pre-check quota before Phase 1 and warn if <10 searches remaining
4. Add quota warnings at 80%, 90%, 100% thresholds (log + persist to job)

**Files to modify:**
- `src/lib/services/daily-learning.ts` - Add quota pre-check, metadata tracking
- `src/lib/services/web-search.ts` - Add `getQuotaStatus()` method with warning thresholds

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
