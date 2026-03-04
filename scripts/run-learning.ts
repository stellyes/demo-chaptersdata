/**
 * Run & Monitor Progressive Learning Job
 *
 * Usage:
 *   npx tsx scripts/run-learning.ts                  # Run new job + monitor
 *   npx tsx scripts/run-learning.ts --monitor        # Monitor existing running job
 *   npx tsx scripts/run-learning.ts --skip-research   # Run without web research
 *   npx tsx scripts/run-learning.ts --monitor --tail   # Tail logs only (minimal UI)
 *
 * Environment:
 *   LEARNING_API_BASE  Base URL for the status API (default: http://localhost:3000)
 */

import { dailyLearningService } from '../src/lib/services/daily-learning';

// ============================================
// Configuration
// ============================================
const API_BASE = process.env.LEARNING_API_BASE || 'http://localhost:3000';
const STATUS_URL = `${API_BASE}/api/ai/learning/status`;
const POLL_INTERVAL_MS = 3000;

// ============================================
// Types mirroring the status API response
// ============================================
interface StatusResponse {
  success: boolean;
  data: {
    isRunning: boolean;
    currentJob: {
      id: string;
      phase: string;
      startedAt: string;
      lastHeartbeat: string | null;
      progress: number;
      runningForMinutes: number;
    } | null;
    metrics?: {
      inputTokens: number;
      outputTokens: number;
      searchesUsed: number;
      quotaAtStart?: number;
      webResearchSkipped: boolean;
      webResearchSkipReason?: string;
      phaseMetrics?: Array<{
        phase: string;
        status: string;
        durationMs?: number;
        inputTokens: number;
        outputTokens: number;
        itemsProcessed?: number;
        dataSourcesLoaded?: number;
        dataSourcesFailed?: number;
      }>;
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
      jsonParseIssues: number;
    };
    searchBudget: {
      searchesUsed: number;
      searchesRemaining: number;
      monthlyLimit: number;
      dailyBudget: number;
      isThrottled: boolean;
    };
    logs?: Array<{ ts: string; level: string; msg: string }>;
    recovered?: { jobId: string; message: string };
  };
}

// ============================================
// CLI helpers
// ============================================
const PHASE_NAMES: Record<string, string> = {
  data_review: 'Phase 1: Data Review',
  question_gen: 'Phase 2: Question Generation',
  web_research: 'Phase 3: Web Research',
  correlation: 'Phase 4: Correlation Analysis',
  digest_gen: 'Phase 5: Digest Generation',
};

const PHASE_ORDER = ['data_review', 'question_gen', 'web_research', 'correlation', 'digest_gen'];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function progressBar(percent: number, width = 30): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'='.repeat(filled)}${' '.repeat(empty)}] ${percent.toFixed(0)}%`;
}

function logLevelColor(level: string): string {
  if (level === 'error') return '\x1b[31m'; // red
  if (level === 'warn') return '\x1b[33m';  // yellow
  return '\x1b[36m';                         // cyan
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

// ============================================
// Status API client
// ============================================
async function fetchStatus(logsSince?: string): Promise<StatusResponse | null> {
  try {
    const params = new URLSearchParams();
    params.set('include_logs', 'true');
    if (logsSince) params.set('logs_since', logsSince);

    const res = await fetch(`${STATUS_URL}?${params}`);
    if (!res.ok) {
      console.error(`${RED}Status API returned ${res.status}${RESET}`);
      return null;
    }
    return await res.json() as StatusResponse;
  } catch (err) {
    console.error(`${RED}Failed to reach status API: ${err instanceof Error ? err.message : err}${RESET}`);
    return null;
  }
}

// ============================================
// Monitoring loop
// ============================================
async function monitorJob(options: { tailOnly?: boolean } = {}): Promise<void> {
  const { tailOnly = false } = options;
  let lastLogTs: string | undefined;
  let lastPhase: string | undefined;
  let startTime = Date.now();
  let jobId: string | undefined;
  let consecutiveErrors = 0;

  if (!tailOnly) {
    console.log(`\n${BOLD}Monitoring learning job...${RESET}`);
    console.log(`${DIM}Polling ${STATUS_URL} every ${POLL_INTERVAL_MS / 1000}s${RESET}\n`);
  }

  while (true) {
    const status = await fetchStatus(lastLogTs);

    if (!status) {
      consecutiveErrors++;
      if (consecutiveErrors > 10) {
        console.error(`\n${RED}Lost connection to status API after 10 retries. Exiting.${RESET}`);
        process.exit(1);
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    consecutiveErrors = 0;

    const { data } = status;

    // Handle recovery
    if (data.recovered) {
      console.log(`\n${YELLOW}Job recovered: ${data.recovered.message}${RESET}`);
    }

    // Print new logs
    if (data.logs && data.logs.length > 0) {
      for (const log of data.logs) {
        const color = logLevelColor(log.level);
        const ts = new Date(log.ts).toLocaleTimeString();
        if (tailOnly) {
          console.log(`${DIM}${ts}${RESET} ${color}${log.msg}${RESET}`);
        } else {
          console.log(`  ${DIM}${ts}${RESET} ${color}${log.msg}${RESET}`);
        }
        lastLogTs = log.ts;
      }
    }

    if (!data.isRunning) {
      // Job just finished or no job running
      if (jobId) {
        // We were tracking a job — it just completed
        console.log(`\n${BOLD}${GREEN}Job finished.${RESET}`);
        await printFinalSummary();
        return;
      }

      // No job running at all
      if (!tailOnly) {
        console.log(`${DIM}No running job found. Waiting...${RESET}`);
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Active job
    const job = data.currentJob!;
    if (!jobId) {
      jobId = job.id;
      startTime = new Date(job.startedAt).getTime();
      console.log(`${BOLD}Job ID: ${job.id}${RESET}`);
      console.log(`${DIM}Started: ${new Date(job.startedAt).toLocaleString()}${RESET}`);
    }

    // Phase transition
    if (job.phase !== lastPhase) {
      lastPhase = job.phase;
      if (!tailOnly) {
        const phaseName = PHASE_NAMES[job.phase] || job.phase;
        console.log(`\n${BOLD}${CYAN}>> ${phaseName}${RESET}`);
      }
    }

    // Progress summary (non-tail mode)
    if (!tailOnly) {
      const elapsed = Date.now() - startTime;
      const bar = progressBar(job.progress);
      const tokens = data.metrics
        ? ` | Tokens: ${formatTokens(data.metrics.inputTokens + data.metrics.outputTokens)}`
        : '';
      const searches = data.metrics
        ? ` | Searches: ${data.metrics.searchesUsed}`
        : '';
      process.stdout.write(`\r  ${bar}  ${formatDuration(elapsed)}${tokens}${searches}  `);
    }

    // Print completed phase metrics inline
    if (data.metrics?.phaseMetrics && !tailOnly) {
      const completedPhases = data.metrics.phaseMetrics;
      // Only show phases that have just completed (not already shown)
      // We use a simple approach: just re-render the compact summary on each poll
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function printFinalSummary(): Promise<void> {
  // Give the API a moment to finalize
  await sleep(1500);
  const status = await fetchStatus();
  if (!status) return;

  // Try to get the most recent completed job from the POST endpoint
  try {
    const metricsRes = await fetch(STATUS_URL, { method: 'POST' });
    if (metricsRes.ok) {
      const metricsData = await metricsRes.json() as {
        success: boolean;
        data: {
          recentJobs: Array<{
            id: string;
            status: string;
            startedAt: string;
            completedAt: string;
            durationMs: number;
            inputTokens: number;
            outputTokens: number;
            searchesUsed: number;
            estimatedCost: number;
            questionsGenerated: number;
            insightsDiscovered: number;
            articlesAnalyzed: number;
            errorPhase?: string;
            errorMessage?: string;
            phaseMetrics: Array<{
              phase: string;
              status: string;
              durationMs?: number;
              inputTokens: number;
              outputTokens: number;
              itemsProcessed?: number;
            }>;
          }>;
        };
      };

      if (metricsData.success && metricsData.data.recentJobs.length > 0) {
        const job = metricsData.data.recentJobs[0];
        console.log(`\n${BOLD}========================================${RESET}`);
        console.log(`${BOLD}  LEARNING JOB SUMMARY${RESET}`);
        console.log(`${BOLD}========================================${RESET}`);
        console.log(`  Job ID:     ${job.id}`);
        console.log(`  Status:     ${job.status === 'completed' ? `${GREEN}${job.status}${RESET}` : `${RED}${job.status}${RESET}`}`);
        console.log(`  Duration:   ${formatDuration(job.durationMs)}`);
        console.log(`  Tokens:     ${formatTokens(job.inputTokens)} in / ${formatTokens(job.outputTokens)} out (${formatTokens(job.inputTokens + job.outputTokens)} total)`);
        console.log(`  Cost:       $${job.estimatedCost.toFixed(4)}`);
        console.log(`  Searches:   ${job.searchesUsed}`);
        console.log(`  Questions:  ${job.questionsGenerated}`);
        console.log(`  Insights:   ${job.insightsDiscovered}`);
        console.log(`  Articles:   ${job.articlesAnalyzed}`);

        if (job.errorPhase) {
          console.log(`  ${RED}Error in:   ${job.errorPhase}${RESET}`);
          console.log(`  ${RED}Error:      ${job.errorMessage}${RESET}`);
        }

        if (job.phaseMetrics.length > 0) {
          console.log(`\n${BOLD}  Phase Breakdown:${RESET}`);
          for (const phase of PHASE_ORDER) {
            const pm = job.phaseMetrics.find(p => p.phase === phase);
            if (!pm) continue;
            const statusIcon = pm.status === 'success' ? `${GREEN}OK${RESET}` :
                               pm.status === 'skipped' ? `${YELLOW}SKIP${RESET}` :
                               `${RED}FAIL${RESET}`;
            const name = PHASE_NAMES[phase] || phase;
            const dur = pm.durationMs ? formatDuration(pm.durationMs) : '—';
            const tok = `${formatTokens(pm.inputTokens + pm.outputTokens)} tok`;
            const items = pm.itemsProcessed !== undefined ? ` | ${pm.itemsProcessed} items` : '';
            console.log(`    ${statusIcon}  ${name.padEnd(32)} ${dur.padStart(8)}  ${tok.padStart(10)}${items}`);
          }
        }

        console.log(`${BOLD}========================================${RESET}\n`);
      }
    }
  } catch {
    // Fall back to basic summary from GET endpoint
    const budget = status.data.searchBudget;
    console.log(`\n  Search budget: ${budget.searchesUsed}/${budget.monthlyLimit} used, ${budget.searchesRemaining} remaining`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Main
// ============================================
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const monitorOnly = args.includes('--monitor');
  const tailOnly = args.includes('--tail');
  const skipResearch = args.includes('--skip-research');

  console.log(`${BOLD}========================================${RESET}`);
  console.log(`${BOLD}  Progressive Learning Pipeline${RESET}`);
  console.log(`${BOLD}========================================${RESET}`);
  console.log(`  Mode: ${monitorOnly ? 'Monitor existing job' : 'Run + Monitor'}`);
  console.log(`  API:  ${STATUS_URL}`);
  if (skipResearch) console.log(`  Web research: SKIPPED`);
  console.log('');

  if (monitorOnly) {
    // Just poll the status API — don't trigger a new job
    await monitorJob({ tailOnly });
    return;
  }

  // Check if a job is already running
  const preCheck = await fetchStatus();
  if (preCheck?.data?.isRunning) {
    console.log(`${YELLOW}A job is already running (${preCheck.data.currentJob?.id}). Switching to monitor mode.${RESET}\n`);
    await monitorJob({ tailOnly });
    return;
  }

  // Start the job in the background and monitor via the API
  console.log(`Starting new learning job...\n`);

  // Run the job — this is a long-running promise
  const jobPromise = dailyLearningService.runDailyLearning({
    forceRun: true,
    skipWebResearch: skipResearch,
  });

  // Give the job a moment to create its DB record
  await sleep(2000);

  // Monitor progress while the job runs
  const monitorPromise = monitorJob({ tailOnly });

  // Wait for the job to finish (monitor loop will detect completion and exit)
  try {
    const result = await jobPromise;

    // Wait for the monitor to catch up and print the summary
    // It will exit on its own once it sees isRunning=false
    await Promise.race([
      monitorPromise,
      sleep(15000), // safety timeout
    ]);

    // Print digest summary if available
    if (result.digest) {
      console.log(`${BOLD}Digest Highlights:${RESET}`);
      if (result.digest.executiveSummary) {
        console.log(`  ${result.digest.executiveSummary.substring(0, 200)}...`);
      }
      console.log(`  Priority Actions: ${result.digest.priorityActions?.length || 0}`);
      console.log(`  Quick Wins: ${result.digest.quickWins?.length || 0}`);
      console.log(`  Watch Items: ${result.digest.watchItems?.length || 0}`);
      console.log(`  Confidence: ${result.digest.confidenceScore || 0}`);
      console.log(`  Data Health: ${result.digest.dataHealthScore || 0}`);
    }
  } catch (err) {
    // The monitor loop may have already printed the error via logs
    console.error(`\n${RED}Job failed: ${err instanceof Error ? err.message : err}${RESET}`);
    // Still try to print summary
    await printFinalSummary();
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(`${RED}Fatal: ${err.message}${RESET}`);
    process.exit(1);
  });
