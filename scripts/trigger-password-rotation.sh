#!/bin/bash
# =============================================================================
# Manually Trigger RDS Password Rotation
#
# Triggers an immediate password rotation on the chapters-data Aurora cluster
# via AWS Secrets Manager. Use this to test the full rotation workflow:
#
#   1. Secrets Manager rotates the RDS password
#   2. EventBridge fires UpdateSecretVersionStage event
#   3. Lambda syncs new DATABASE_URL to Amplify env vars
#   4. Apps pick up fresh credentials via background refresh
#
# Usage:
#   ./scripts/trigger-password-rotation.sh             # Trigger rotation
#   ./scripts/trigger-password-rotation.sh --dry-run   # Show what would happen
#   ./scripts/trigger-password-rotation.sh --status     # Check rotation status
#
# Monitoring:
#   In a second terminal, run:
#     ./scripts/watch-secret-sync-logs.sh --follow
# =============================================================================

set -euo pipefail

REGION="us-west-1"
SECRET_ARN="arn:aws:secretsmanager:us-west-1:716121312511:secret:rds!cluster-f89505b1-a495-4483-b282-15d58e2df95e-vOlOPD"
LAMBDA_NAME="chapters-secret-sync"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${CYAN}=====================================${NC}"
echo -e "${BOLD}${CYAN} RDS Password Rotation Trigger${NC}"
echo -e "${BOLD}${CYAN}=====================================${NC}"
echo ""

# Verify AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI not found. Install it with: brew install awscli${NC}"
    exit 1
fi

# Verify credentials
echo -e "${DIM}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity --region "$REGION" &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured or expired.${NC}"
    exit 1
fi

CALLER=$(aws sts get-caller-identity --region "$REGION" --output text --query 'Arn' 2>/dev/null)
echo -e "${GREEN}Authenticated as: ${CALLER}${NC}"
echo ""

# Function to show current secret status
show_status() {
    echo -e "${CYAN}Current Secret Status:${NC}"
    echo -e "${DIM}────────────────────────────────────────────────${NC}"

    # Get secret metadata
    echo -e "${DIM}Fetching secret metadata...${NC}"
    SECRET_INFO=$(aws secretsmanager describe-secret \
        --secret-id "$SECRET_ARN" \
        --region "$REGION" 2>/dev/null)

    ROTATION_ENABLED=$(echo "$SECRET_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('RotationEnabled', False))")
    LAST_ROTATED=$(echo "$SECRET_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('LastRotatedDate', 'Never'))" 2>/dev/null || echo "Never")
    LAST_CHANGED=$(echo "$SECRET_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('LastChangedDate', 'Unknown'))" 2>/dev/null || echo "Unknown")
    ROTATION_RULES=$(echo "$SECRET_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('RotationRules',{}); print(f\"Every {r.get('AutomaticallyAfterDays','?')} days\")" 2>/dev/null || echo "Unknown")

    # Get version info
    VERSIONS=$(echo "$SECRET_INFO" | python3 -c "
import sys, json
d = json.load(sys.stdin)
versions = d.get('VersionIdsToStages', {})
for vid, stages in versions.items():
    print(f'  {vid[:12]}... -> {stages}')
" 2>/dev/null || echo "  Unable to parse versions")

    echo -e "  Rotation enabled:  ${BOLD}${ROTATION_ENABLED}${NC}"
    echo -e "  Rotation schedule: ${ROTATION_RULES}"
    echo -e "  Last rotated:      ${LAST_ROTATED}"
    echo -e "  Last changed:      ${LAST_CHANGED}"
    echo ""
    echo -e "  ${CYAN}Version stages:${NC}"
    echo "$VERSIONS"
    echo ""

    # Get current credentials (just username, not password)
    echo -e "${DIM}Fetching current AWSCURRENT credentials...${NC}"
    CURRENT_SECRET=$(aws secretsmanager get-secret-value \
        --secret-id "$SECRET_ARN" \
        --version-stage "AWSCURRENT" \
        --region "$REGION" \
        --query 'SecretString' \
        --output text 2>/dev/null)

    CURRENT_USER=$(echo "$CURRENT_SECRET" | python3 -c "import sys,json; print(json.load(sys.stdin)['username'])" 2>/dev/null)
    CURRENT_PASS_LEN=$(echo "$CURRENT_SECRET" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['password']))" 2>/dev/null)
    CURRENT_PASS_PREVIEW=$(echo "$CURRENT_SECRET" | python3 -c "
import sys,json
p = json.load(sys.stdin)['password']
print(p[:3] + '***' + p[-2:] if len(p) > 5 else '***')
" 2>/dev/null)

    echo -e "  Current user:     ${BOLD}${CURRENT_USER}${NC}"
    echo -e "  Current password: ${CURRENT_PASS_PREVIEW} (${CURRENT_PASS_LEN} chars)"
    echo -e "${DIM}────────────────────────────────────────────────${NC}"
    echo ""
}

# Function to check EventBridge rule
check_eventbridge() {
    echo -e "${CYAN}EventBridge Rule Status:${NC}"
    echo -e "${DIM}────────────────────────────────────────────────${NC}"

    RULE_INFO=$(aws events describe-rule \
        --name "chapters-secret-rotation" \
        --region "$REGION" 2>/dev/null || echo "NOT_FOUND")

    if [ "$RULE_INFO" = "NOT_FOUND" ]; then
        echo -e "  ${RED}Rule 'chapters-secret-rotation' NOT FOUND${NC}"
        echo -e "  ${YELLOW}The Lambda won't be triggered. Deploy with Terraform first.${NC}"
    else
        RULE_STATE=$(echo "$RULE_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('State','UNKNOWN'))" 2>/dev/null)
        RULE_PATTERN=$(echo "$RULE_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('EventPattern','{}'))" 2>/dev/null)

        echo -e "  Rule state:   ${BOLD}${RULE_STATE}${NC}"

        # Check if UpdateSecretVersionStage is in the pattern
        if echo "$RULE_PATTERN" | grep -q "UpdateSecretVersionStage"; then
            echo -e "  Event names:  ${GREEN}Includes UpdateSecretVersionStage (correct)${NC}"
        elif echo "$RULE_PATTERN" | grep -q "FinishSecret"; then
            echo -e "  Event names:  ${RED}Still has FinishSecret (NEEDS UPDATE — deploy Terraform)${NC}"
        else
            echo -e "  Event names:  ${YELLOW}$(echo "$RULE_PATTERN" | python3 -c "import sys,json; print(json.loads(json.load(sys.stdin) if isinstance(json.load(open('/dev/stdin')), str) else '{}').get('detail',{}).get('eventName','unknown'))" 2>/dev/null || echo "unable to parse")${NC}"
        fi
    fi

    echo -e "${DIM}────────────────────────────────────────────────${NC}"
    echo ""
}

# Parse arguments
case "${1:-}" in
    --dry-run)
        echo -e "${YELLOW}DRY RUN — showing current state without triggering rotation${NC}"
        echo ""
        show_status
        check_eventbridge

        echo -e "${CYAN}What would happen:${NC}"
        echo -e "  1. aws secretsmanager rotate-secret --secret-id <ARN>"
        echo -e "  2. Secrets Manager creates new password (AWSPENDING)"
        echo -e "  3. RDS is updated with new password"
        echo -e "  4. New password is tested"
        echo -e "  5. AWSPENDING is promoted to AWSCURRENT (UpdateSecretVersionStage)"
        echo -e "  6. EventBridge triggers chapters-secret-sync Lambda"
        echo -e "  7. Lambda updates Amplify env vars for both apps"
        echo -e "  8. Apps pick up fresh credentials via background refresh (within 4 min)"
        echo ""
        echo -e "${DIM}Run without --dry-run to trigger rotation.${NC}"
        exit 0
        ;;
    --status)
        show_status
        check_eventbridge
        exit 0
        ;;
    --help|-h)
        echo "Usage: $0 [--dry-run | --status | --help]"
        echo ""
        echo "Options:"
        echo "  (no args)   Trigger password rotation"
        echo "  --dry-run   Show current state without triggering"
        echo "  --status    Show secret and EventBridge status"
        echo "  --help      Show this help"
        exit 0
        ;;
esac

# Show current state before rotation
show_status
check_eventbridge

# Confirm
echo -e "${BOLD}${YELLOW}This will rotate the RDS master password immediately.${NC}"
echo -e "${YELLOW}Both chapters-data and chapters-website will be affected.${NC}"
echo ""
read -p "$(echo -e "${BOLD}Proceed with rotation? [y/N]: ${NC}")" -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${DIM}Aborted.${NC}"
    exit 0
fi

# Trigger rotation
echo -e "${CYAN}Step 1/3: Triggering password rotation...${NC}"
ROTATE_OUTPUT=$(aws secretsmanager rotate-secret \
    --secret-id "$SECRET_ARN" \
    --region "$REGION" 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to trigger rotation:${NC}"
    echo "$ROTATE_OUTPUT"
    exit 1
fi

VERSION_ID=$(echo "$ROTATE_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('VersionId','unknown'))" 2>/dev/null || echo "unknown")
echo -e "${GREEN}Rotation triggered. New version: ${VERSION_ID}${NC}"
echo ""

# Wait for rotation to complete
echo -e "${CYAN}Step 2/3: Waiting for rotation to complete...${NC}"
echo -e "${DIM}(This typically takes 10-30 seconds)${NC}"
echo ""

MAX_WAIT=120
ELAPSED=0
INTERVAL=5

while [ $ELAPSED -lt $MAX_WAIT ]; do
    # Check if rotation is complete.
    # With RDS-managed rotation (manage_master_user_password=true), AWS often leaves
    # AWSPENDING on the same version as AWSCURRENT after completion. So we can't just
    # check "is AWSPENDING gone?" — instead we check whether AWSPENDING is on a
    # DIFFERENT version than AWSCURRENT (meaning rotation is still in progress).
    SECRET_INFO=$(aws secretsmanager describe-secret \
        --secret-id "$SECRET_ARN" \
        --region "$REGION" 2>/dev/null)

    ROTATION_STATUS=$(echo "$SECRET_INFO" | python3 -c "
import sys, json
d = json.load(sys.stdin)
versions = d.get('VersionIdsToStages', {})

current_vid = None
pending_vid = None
for vid, stages in versions.items():
    if 'AWSCURRENT' in stages:
        current_vid = vid
    if 'AWSPENDING' in stages:
        pending_vid = vid

if pending_vid is None:
    # No AWSPENDING at all — rotation complete
    print('complete')
elif pending_vid == current_vid:
    # AWSPENDING on same version as AWSCURRENT — RDS-managed rotation finished
    print('complete')
else:
    # AWSPENDING on a different version — still rotating
    print('pending')
" 2>/dev/null || echo "unknown")

    if [ "$ROTATION_STATUS" = "complete" ]; then
        echo -e "${GREEN}Rotation completed in ~${ELAPSED}s${NC}"
        break
    fi

    echo -e "${DIM}  Waiting... (${ELAPSED}s elapsed, AWSPENDING still on separate version)${NC}"
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo -e "${YELLOW}Warning: Rotation still in progress after ${MAX_WAIT}s.${NC}"
    echo -e "${YELLOW}Check CloudWatch logs for the rotation Lambda.${NC}"
fi

echo ""

# Show post-rotation state
echo -e "${CYAN}Step 3/3: Verifying new credentials...${NC}"
echo ""
show_status

echo -e "${GREEN}${BOLD}Password rotation triggered successfully.${NC}"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "  1. Watch the Lambda logs:   ${BOLD}./scripts/watch-secret-sync-logs.sh --recent${NC}"
echo -e "  2. Verify apps are healthy: check Amplify console or hit an API endpoint"
echo -e "  3. Apps will auto-refresh credentials within 4 minutes via background refresh"
