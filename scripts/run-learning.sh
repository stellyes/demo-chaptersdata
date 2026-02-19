#!/usr/bin/env bash
# ============================================
# LEARNING JOB RUNNER & MONITOR
# Triggers a learning job, streams real-time console
# logs + status updates, and cancels gracefully on Ctrl+C.
#
# Usage:
#   ./scripts/run-learning.sh                    # Normal run
#   ./scripts/run-learning.sh --skip-web         # Skip web research
#   ./scripts/run-learning.sh --monitor-only     # Don't start, just monitor existing job
#   ./scripts/run-learning.sh --no-logs          # Status only (no console log streaming)
# ============================================

set -euo pipefail

# ---- Configuration ----
API_BASE="https://bcsf.chaptersdata.com"
API_KEY="${LEARNING_API_KEY:-bb444ef29df30751f946d965d6ec0e21d67464ad7e113cac1678b4fa1d621c1a}"
POLL_INTERVAL=4
SKIP_WEB=false
MONITOR_ONLY=false
SHOW_LOGS=true

# ---- Parse args ----
for arg in "$@"; do
  case "$arg" in
    --skip-web)       SKIP_WEB=true ;;
    --monitor-only)   MONITOR_ONLY=true ;;
    --no-logs)        SHOW_LOGS=false ;;
    --help|-h)
      echo "Usage: $0 [--skip-web] [--monitor-only] [--no-logs]"
      echo ""
      echo "  --skip-web       Skip web research phase"
      echo "  --monitor-only   Don't start a new job, just monitor any running job"
      echo "  --no-logs        Don't stream console logs (just show phase progress)"
      exit 0
      ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ---- State ----
JOB_ID=""
RUN_PID=""
CANCELLED=false
LAST_PHASE=""
START_TIME=""
SEEN_PHASES=""  # comma-separated list of phases we've printed completion for
LAST_LOG_TS=""  # ISO timestamp of last log we displayed — for incremental fetching

# ---- Helpers ----
timestamp() {
  date '+%H:%M:%S'
}

log_info() {
  echo -e "${DIM}$(timestamp)${NC} ${BLUE}INFO${NC}  $1"
}

log_ok() {
  echo -e "${DIM}$(timestamp)${NC} ${GREEN} OK ${NC}  $1"
}

log_warn() {
  echo -e "${DIM}$(timestamp)${NC} ${YELLOW}WARN${NC}  $1"
}

log_err() {
  echo -e "${DIM}$(timestamp)${NC} ${RED}FAIL${NC}  $1"
}

log_phase() {
  echo -e "${DIM}$(timestamp)${NC} ${CYAN}━━━━${NC}  $1"
}

elapsed_str() {
  if [ -z "$START_TIME" ]; then echo "0s"; return; fi
  local now
  now=$(date +%s)
  local diff=$((now - START_TIME))
  local mins=$((diff / 60))
  local secs=$((diff % 60))
  if [ "$mins" -gt 0 ]; then
    echo "${mins}m ${secs}s"
  else
    echo "${secs}s"
  fi
}

phase_label() {
  case "$1" in
    data_review)    echo "Phase 1: Data Review" ;;
    question_gen)   echo "Phase 2: Question Generation" ;;
    web_research)   echo "Phase 3: Web Research" ;;
    correlation)    echo "Phase 4: Correlation Analysis" ;;
    digest_gen)     echo "Phase 5: Digest Generation" ;;
    *)              echo "$1" ;;
  esac
}

has_seen_phase() {
  echo "$SEEN_PHASES" | grep -q ",$1," 2>/dev/null
}

mark_phase_seen() {
  SEEN_PHASES="${SEEN_PHASES},$1,"
}

# Display a single log entry with color based on level
display_log_entry() {
  local log_ts="$1"
  local log_level="$2"
  local log_msg="$3"

  # Extract just the time portion from the ISO timestamp
  local time_part
  time_part=$(echo "$log_ts" | python3 -c "
import sys
ts = sys.stdin.read().strip()
if 'T' in ts:
    t = ts.split('T')[1].split('.')[0]
    print(t)
else:
    print(ts[:8])
" 2>/dev/null || echo "??:??:??")

  # Color based on level
  local level_color=""
  local level_tag=""
  case "$log_level" in
    error) level_color="$RED";    level_tag="ERR " ;;
    warn)  level_color="$YELLOW"; level_tag="WARN" ;;
    *)     level_color="$DIM";    level_tag="    " ;;
  esac

  # Colorize well-known log prefixes in the message
  local display_msg="$log_msg"

  echo -e "${DIM}${time_part}${NC} ${level_color}${level_tag}${NC} ${display_msg}"
}

# Build the status URL with optional log params
build_status_url() {
  local url="${API_BASE}/api/ai/learning/status"
  if [ "$SHOW_LOGS" = "true" ]; then
    if [ -n "$LAST_LOG_TS" ]; then
      # URL-encode the timestamp (replace + with %2B, : with %3A)
      local encoded_ts
      encoded_ts=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$LAST_LOG_TS" 2>/dev/null || echo "$LAST_LOG_TS")
      url="${url}?logs_since=${encoded_ts}"
    else
      url="${url}?include_logs=true"
    fi
  fi
  echo "$url"
}

# ---- Cleanup on Ctrl+C ----
cleanup() {
  echo ""
  CANCELLED=true

  if [ -n "$JOB_ID" ]; then
    log_warn "Ctrl+C received — cancelling job ${JOB_ID}..."
    local result
    result=$(curl -s -S --max-time 15 \
      -H "X-API-Key: $API_KEY" \
      -H "Content-Type: application/json" \
      -X POST -d "{\"jobId\":\"${JOB_ID}\"}" \
      "${API_BASE}/api/ai/learning/cancel" 2>/dev/null || echo '{}')

    local success
    success=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "false")

    if [ "$success" = "True" ] || [ "$success" = "true" ]; then
      log_ok "Job cancelled successfully"
    else
      log_err "Failed to cancel job (may have already finished)"
    fi
  else
    log_info "No active job to cancel"
  fi

  # Kill background curl if still running
  if [ -n "$RUN_PID" ] && kill -0 "$RUN_PID" 2>/dev/null; then
    kill "$RUN_PID" 2>/dev/null || true
    wait "$RUN_PID" 2>/dev/null || true
  fi

  rm -f /tmp/learning-run-response.json
  echo ""
  log_info "Exiting."
  exit 0
}

trap cleanup SIGINT SIGTERM

# ---- Banner ----
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     ${CYAN}Chapters Learning Job Runner${NC}${BOLD}              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ---- Check current status ----
log_info "Checking current job status..."
STATUS_RESPONSE=$(curl -s -S --max-time 10 \
  -H "X-API-Key: $API_KEY" \
  "${API_BASE}/api/ai/learning/status" 2>/dev/null || echo '{"data":{"isRunning":false}}')

IS_RUNNING=$(echo "$STATUS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print(d.get('isRunning', False))
" 2>/dev/null || echo "False")

if [ "$IS_RUNNING" = "True" ]; then
  JOB_ID=$(echo "$STATUS_RESPONSE" | python3 -c "
import sys,json
print(json.load(sys.stdin)['data']['currentJob']['id'])
" 2>/dev/null || echo "")

  CURRENT_PHASE=$(echo "$STATUS_RESPONSE" | python3 -c "
import sys,json
print(json.load(sys.stdin)['data']['currentJob'].get('phase','unknown'))
" 2>/dev/null || echo "unknown")

  log_warn "A job is already running: ${JOB_ID} (phase: ${CURRENT_PHASE})"

  if [ "$MONITOR_ONLY" = "false" ]; then
    log_info "Attaching to existing job instead of starting a new one..."
  fi
else
  if [ "$MONITOR_ONLY" = "true" ]; then
    log_info "No running job found. Nothing to monitor."
    exit 0
  fi

  # ---- Start the job ----
  log_info "Starting learning job (skipWebResearch=${SKIP_WEB})..."
  echo ""

  # Fire the request in background — the API route runs the full job synchronously
  # and won't respond until it's done (up to 15 min). We poll status instead.
  RUN_BODY="{\"forceRun\":true,\"skipWebResearch\":${SKIP_WEB}}"
  curl -s -S --max-time 900 \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -X POST -d "$RUN_BODY" \
    "${API_BASE}/api/ai/learning/run" > /tmp/learning-run-response.json 2>&1 &
  RUN_PID=$!

  # Give the API a few seconds to create the job record
  sleep 4

  # Poll for job creation
  for attempt in 1 2 3; do
    STATUS_RESPONSE=$(curl -s -S --max-time 10 \
      -H "X-API-Key: $API_KEY" \
      "${API_BASE}/api/ai/learning/status" 2>/dev/null || echo '{"data":{"isRunning":false}}')

    IS_RUNNING=$(echo "$STATUS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print(d.get('isRunning', False))
" 2>/dev/null || echo "False")

    if [ "$IS_RUNNING" = "True" ]; then
      JOB_ID=$(echo "$STATUS_RESPONSE" | python3 -c "
import sys,json
print(json.load(sys.stdin)['data']['currentJob']['id'])
" 2>/dev/null || echo "")
      log_ok "Job started: ${BOLD}${JOB_ID}${NC}"
      break
    fi

    if [ "$attempt" -lt 3 ]; then
      sleep 3
    fi
  done

  if [ -z "$JOB_ID" ]; then
    log_err "Job failed to start. Checking API response..."
    echo ""

    # Wait for background curl to finish
    wait "$RUN_PID" 2>/dev/null || true
    RUN_PID=""

    if [ -f /tmp/learning-run-response.json ]; then
      python3 -m json.tool < /tmp/learning-run-response.json 2>/dev/null || cat /tmp/learning-run-response.json
    fi
    rm -f /tmp/learning-run-response.json
    exit 1
  fi
fi

START_TIME=$(date +%s)
echo ""
if [ "$SHOW_LOGS" = "true" ]; then
  log_info "Streaming console logs (poll every ${POLL_INTERVAL}s)..."
  echo -e "${DIM}─────────────────────────────────────────────────────────────${NC}"
fi

# ---- Monitor loop ----
while true; do
  if [ "$CANCELLED" = "true" ]; then break; fi

  STATUS_URL=$(build_status_url)
  RESPONSE=$(curl -s -S --max-time 10 \
    -H "X-API-Key: $API_KEY" \
    "$STATUS_URL" 2>/dev/null || echo '{}')

  # Parse everything in one python call — including logs
  PARSED=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin).get('data', {})
    running = data.get('isRunning', False)
    job = data.get('currentJob') or {}
    metrics = data.get('metrics') or {}
    pm_list = metrics.get('phaseMetrics') or []
    logs = data.get('logs') or []

    phase = job.get('phase', '')
    progress = int(job.get('progress', 0))
    in_tok = metrics.get('inputTokens', 0)
    out_tok = metrics.get('outputTokens', 0)
    searches = metrics.get('searchesUsed', 0)

    # Build completed phase lines
    pm_lines = []
    for pm in pm_list:
        pm_lines.append('{name}:{status}:{dur}:{it}:{ot}:{items}'.format(
            name=pm.get('phase','?'),
            status=pm.get('status','?'),
            dur=pm.get('durationMs',0),
            it=pm.get('inputTokens',0),
            ot=pm.get('outputTokens',0),
            items=pm.get('itemsProcessed',0)
        ))

    # Build log entry lines: ts|level|msg
    log_lines = []
    last_ts = ''
    for log in logs:
        ts = log.get('ts', '')
        level = log.get('level', 'info')
        msg = log.get('msg', '')
        # Escape pipe characters in msg so our parsing doesn't break
        msg = msg.replace('|', '\\u007c')
        log_lines.append(f'{ts}|{level}|{msg}')
        last_ts = ts

    lines = [
        str(running),
        str(phase),
        str(progress),
        str(in_tok),
        str(out_tok),
        str(searches),
        ','.join(pm_lines),
        str(len(log_lines)),
        last_ts,
    ]
    print('\\n'.join(lines))
    # Print log lines after the main data
    for ll in log_lines:
        print(ll)
except Exception as e:
    print('ERROR')
    print(str(e))
    for _ in range(7):
        print('')
" 2>/dev/null || echo "ERROR")

  # Read parsed values
  LINE_NUM=0
  IS_RUNNING=""
  PHASE=""
  PROGRESS=""
  IN_TOK=""
  OUT_TOK=""
  SEARCHES=""
  PM_DATA=""
  LOG_COUNT=""
  NEW_LAST_TS=""
  LOG_LINES=""

  while IFS= read -r line; do
    case $LINE_NUM in
      0) IS_RUNNING="$line" ;;
      1) PHASE="$line" ;;
      2) PROGRESS="$line" ;;
      3) IN_TOK="$line" ;;
      4) OUT_TOK="$line" ;;
      5) SEARCHES="$line" ;;
      6) PM_DATA="$line" ;;
      7) LOG_COUNT="$line" ;;
      8) NEW_LAST_TS="$line" ;;
      *)
        # Lines 9+ are log entries
        if [ -z "$LOG_LINES" ]; then
          LOG_LINES="$line"
        else
          LOG_LINES="${LOG_LINES}
${line}"
        fi
        ;;
    esac
    LINE_NUM=$((LINE_NUM + 1))
  done <<< "$PARSED"

  # Check for parse errors
  if [ "$IS_RUNNING" = "ERROR" ]; then
    log_warn "Status parse error, retrying..."
    sleep "$POLL_INTERVAL"
    continue
  fi

  # ---- Display new log entries ----
  if [ "$SHOW_LOGS" = "true" ] && [ -n "$LOG_LINES" ] && [ "${LOG_COUNT:-0}" != "0" ]; then
    while IFS= read -r log_line; do
      if [ -z "$log_line" ]; then continue; fi
      # Parse ts|level|msg
      local_ts=$(echo "$log_line" | cut -d'|' -f1)
      local_level=$(echo "$log_line" | cut -d'|' -f2)
      local_msg=$(echo "$log_line" | cut -d'|' -f3-)
      # Unescape pipes
      local_msg=$(echo "$local_msg" | sed 's/\\u007c/|/g')
      display_log_entry "$local_ts" "$local_level" "$local_msg"
    done <<< "$LOG_LINES"
  fi

  # Update the last-seen timestamp for incremental fetching
  if [ -n "$NEW_LAST_TS" ] && [ "$NEW_LAST_TS" != "None" ]; then
    LAST_LOG_TS="$NEW_LAST_TS"
  fi

  # ---- Job finished ----
  if [ "$IS_RUNNING" != "True" ]; then
    echo ""
    echo -e "${DIM}─────────────────────────────────────────────────────────────${NC}"

    # Show any final completed phases we missed
    if [ -n "$PM_DATA" ]; then
      IFS=',' read -ra PM_ENTRIES <<< "$PM_DATA"
      for entry in "${PM_ENTRIES[@]}"; do
        IFS=':' read -r p_name p_status p_dur p_in p_out p_items <<< "$entry"
        if ! has_seen_phase "$p_name"; then
          mark_phase_seen "$p_name"
          local_label=$(phase_label "$p_name")
          dur_sec=$(python3 -c "print(f'{${p_dur:-0}/1000:.1f}')" 2>/dev/null || echo "?")

          if [ "$p_status" = "success" ]; then
            log_ok "${local_label} ${DIM}(${dur_sec}s, ${p_in}+${p_out} tokens, ${p_items} items)${NC}"
          elif [ "$p_status" = "skipped" ]; then
            log_info "${local_label} ${DIM}(skipped)${NC}"
          else
            log_err "${local_label} ${DIM}(${p_status}, ${dur_sec}s)${NC}"
          fi
        fi
      done
    fi

    # Check for auto-recovery
    RECOVERED=$(echo "$RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
r=d.get('recovered')
print(r.get('message','') if r else '')
" 2>/dev/null || echo "")

    echo ""
    if [ -n "$RECOVERED" ]; then
      log_err "Job auto-recovered: ${RECOVERED}"
    else
      log_ok "${BOLD}Job complete!${NC}"
    fi

    # Wait for background curl response for final details
    if [ -n "$RUN_PID" ] && kill -0 "$RUN_PID" 2>/dev/null; then
      log_info "Waiting for API response..."
      wait "$RUN_PID" 2>/dev/null || true
      RUN_PID=""
    fi

    if [ -f /tmp/learning-run-response.json ]; then
      python3 -c "
import json
try:
    with open('/tmp/learning-run-response.json') as f:
        data = json.load(f)
    if not data.get('success', False):
        print(f\"  Error: {data.get('error', 'unknown')}\")
    else:
        d = data.get('data', {})
        if d.get('jobId'):
            print(f\"  Job ID:     {d['jobId']}\")
        print(f\"  Has Digest: {d.get('hasDigest', False)}\")
        for w in d.get('warnings', []):
            print(f\"  Warning:    {w}\")
except:
    pass
" 2>/dev/null || true
    fi

    echo ""
    echo -e "  ${DIM}Total time: $(elapsed_str)${NC}"
    TOK_TOTAL=$(( ${IN_TOK:-0} + ${OUT_TOK:-0} ))
    echo -e "  ${DIM}Tokens: ${TOK_TOTAL} (in=${IN_TOK:-0} out=${OUT_TOK:-0})${NC}"
    echo -e "  ${DIM}Searches: ${SEARCHES:-0}${NC}"
    echo ""
    break
  fi

  # ---- Show new phase transition (only when not streaming logs, to avoid noise) ----
  if [ "$SHOW_LOGS" = "false" ]; then
    if [ -n "$PHASE" ] && [ "$PHASE" != "$LAST_PHASE" ]; then
      LAST_PHASE="$PHASE"
      LABEL=$(phase_label "$PHASE")
      echo ""
      log_phase "${BOLD}${LABEL}${NC}"
    fi

    # Show completed phases we haven't printed yet
    if [ -n "$PM_DATA" ]; then
      IFS=',' read -ra PM_ENTRIES <<< "$PM_DATA"
      for entry in "${PM_ENTRIES[@]}"; do
        IFS=':' read -r p_name p_status p_dur p_in p_out p_items <<< "$entry"
        if ! has_seen_phase "$p_name"; then
          mark_phase_seen "$p_name"
          local_label=$(phase_label "$p_name")
          dur_sec=$(python3 -c "print(f'{${p_dur:-0}/1000:.1f}')" 2>/dev/null || echo "?")

          if [ "$p_status" = "success" ]; then
            log_ok "${local_label} ${DIM}(${dur_sec}s, ${p_in}+${p_out} tokens, ${p_items} items)${NC}"
          elif [ "$p_status" = "skipped" ]; then
            log_info "${local_label} ${DIM}(skipped)${NC}"
          else
            log_err "${local_label} ${DIM}(${p_status}, ${dur_sec}s)${NC}"
          fi
        fi
      done
    fi

    # Progress line (overwrites itself each poll)
    ELAPSED=$(elapsed_str)
    TOK_TOTAL=$(( ${IN_TOK:-0} + ${OUT_TOK:-0} ))
    printf "\r  ${DIM}%s${NC}  ${DIM}%s elapsed | %d tokens | %d searches${NC}    " \
      "$(timestamp)" "$ELAPSED" "$TOK_TOTAL" "${SEARCHES:-0}"
  fi

  sleep "$POLL_INTERVAL"
done

# ---- Cleanup ----
if [ -n "$RUN_PID" ] && kill -0 "$RUN_PID" 2>/dev/null; then
  kill "$RUN_PID" 2>/dev/null || true
  wait "$RUN_PID" 2>/dev/null || true
fi
rm -f /tmp/learning-run-response.json
