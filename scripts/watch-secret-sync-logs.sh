#!/bin/bash
# =============================================================================
# Watch Secret Sync Lambda Logs
#
# Tails CloudWatch logs from the chapters-secret-sync Lambda in real time.
# Useful for monitoring password rotation events end-to-end.
#
# Usage:
#   ./scripts/watch-secret-sync-logs.sh              # Live tail (follow mode)
#   ./scripts/watch-secret-sync-logs.sh --recent     # Last 30 minutes of logs
#   ./scripts/watch-secret-sync-logs.sh --last-hour  # Last hour of logs
#   ./scripts/watch-secret-sync-logs.sh --since 2h   # Last 2 hours
# =============================================================================

set -euo pipefail

REGION="us-west-1"
LOG_GROUP="/aws/lambda/chapters-secret-sync"
FUNCTION_NAME="chapters-secret-sync"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}${CYAN}=====================================${NC}"
echo -e "${BOLD}${CYAN} Secret Sync Lambda Log Monitor${NC}"
echo -e "${BOLD}${CYAN}=====================================${NC}"
echo ""

# Verify AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI not found. Install it with: brew install awscli${NC}"
    exit 1
fi

# Verify credentials
echo -e "${DIM}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity --region "$REGION" &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured or expired.${NC}"
    echo -e "${YELLOW}Run: aws configure${NC}"
    exit 1
fi

CALLER=$(aws sts get-caller-identity --region "$REGION" --output text --query 'Arn' 2>/dev/null)
echo -e "${GREEN}Authenticated as: ${CALLER}${NC}"
echo ""

# Check the Lambda function exists
echo -e "${DIM}Verifying Lambda function...${NC}"
if ! aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &> /dev/null; then
    echo -e "${RED}Error: Lambda function '${FUNCTION_NAME}' not found in ${REGION}.${NC}"
    echo -e "${YELLOW}Has the secret-sync Lambda been deployed?${NC}"
    exit 1
fi
echo -e "${GREEN}Lambda function '${FUNCTION_NAME}' found.${NC}"

# Check log group exists
echo -e "${DIM}Checking log group...${NC}"
if ! aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$REGION" --query "logGroups[?logGroupName=='$LOG_GROUP']" --output text 2>/dev/null | grep -q "$LOG_GROUP"; then
    echo -e "${YELLOW}Warning: Log group '${LOG_GROUP}' not found.${NC}"
    echo -e "${YELLOW}The Lambda may not have been invoked yet. Waiting for logs...${NC}"
    echo ""
fi

# Parse arguments
MODE="follow"
SINCE="30m"

case "${1:-}" in
    --recent)
        MODE="historical"
        SINCE="30m"
        echo -e "${CYAN}Showing logs from the last 30 minutes...${NC}"
        ;;
    --last-hour)
        MODE="historical"
        SINCE="1h"
        echo -e "${CYAN}Showing logs from the last hour...${NC}"
        ;;
    --since)
        MODE="historical"
        SINCE="${2:-1h}"
        echo -e "${CYAN}Showing logs from the last ${SINCE}...${NC}"
        ;;
    --follow|"")
        MODE="follow"
        echo -e "${CYAN}Live tailing logs (Ctrl+C to stop)...${NC}"
        echo -e "${DIM}Tip: Trigger a rotation in another terminal to see events flow through.${NC}"
        ;;
    --help|-h)
        echo "Usage: $0 [--recent | --last-hour | --since <duration> | --follow]"
        echo ""
        echo "Options:"
        echo "  --follow      Live tail logs (default)"
        echo "  --recent      Show last 30 minutes"
        echo "  --last-hour   Show last hour"
        echo "  --since <dur> Show last <dur> (e.g., 2h, 45m, 1d)"
        exit 0
        ;;
    *)
        echo -e "${RED}Unknown option: $1${NC}"
        echo "Run with --help for usage."
        exit 1
        ;;
esac

echo ""
echo -e "${DIM}Log group: ${LOG_GROUP}${NC}"
echo -e "${DIM}Region:    ${REGION}${NC}"
echo -e "${DIM}────────────────────────────────────────────────${NC}"
echo ""

# Colorize a stream of log lines via sed (no buffering issues unlike while-read pipes)
colorize() {
    sed -E \
        -e "s/^(.*ERROR.*|.*FAIL.*|.*Error.*|.*raise.*)$/${RED}\1${NC}/" \
        -e "s/^(.*SUCCESS.*|.*Successfully.*|.*complete.*)$/${GREEN}\1${NC}/" \
        -e "s/^(.*SKIP.*|.*Skipping.*)$/${YELLOW}\1${NC}/" \
        -e "s/^(.*=====.*)$/${BOLD}${CYAN}\1${NC}/" \
        -e "s/^(.*ACTION.*|.*Processing.*)$/${BOLD}${GREEN}\1${NC}/"
}

if [ "$MODE" = "follow" ]; then
    # Live tail — run aws logs tail directly (no pipe) so output streams in real time.
    # Piping through while-read or sed causes the AWS CLI to buffer when it detects
    # stdout is not a TTY, which prevents live streaming.
    aws logs tail "$LOG_GROUP" \
        --region "$REGION" \
        --follow \
        --since "${SINCE}" \
        --format short
else
    # Historical logs — safe to colorize since all output is available at once
    aws logs tail "$LOG_GROUP" \
        --region "$REGION" \
        --since "${SINCE}" \
        --format short 2>&1 | colorize

    echo ""
    echo -e "${DIM}────────────────────────────────────────────────${NC}"
    echo -e "${DIM}End of logs. Run with --follow for live tailing.${NC}"
fi
