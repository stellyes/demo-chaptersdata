#!/bin/bash
# sync-env-to-amplify.sh - Syncs environment variable VALUES from .env.local to Amplify Console
# Run automatically via pre-push hook or manually with: ./scripts/sync-env-to-amplify.sh
#
# Prerequisites:
# 1. AWS CLI installed and configured with appropriate credentials
# 2. AMPLIFY_APP_ID set in .env.local or as environment variable
# 3. AWS credentials with amplify:UpdateApp permission

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_LOCAL="$PROJECT_ROOT/.env.local"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if .env.local exists
if [ ! -f "$ENV_LOCAL" ]; then
    echo -e "${RED}Error: .env.local not found at $ENV_LOCAL${NC}"
    echo -e "${YELLOW}Copy .env.example to .env.local and fill in your values.${NC}"
    exit 1
fi

# Load .env.local to get AMPLIFY_APP_ID
source "$ENV_LOCAL" 2>/dev/null || true

# Check for AMPLIFY_APP_ID
if [ -z "$AMPLIFY_APP_ID" ]; then
    echo -e "${RED}Error: AMPLIFY_APP_ID not set${NC}"
    echo -e "${YELLOW}Add AMPLIFY_APP_ID=<your-app-id> to .env.local${NC}"
    echo -e "${YELLOW}Find your App ID in AWS Amplify Console > App settings > General${NC}"
    exit 1
fi

# Check AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI not found. Please install it first.${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured or invalid.${NC}"
    echo -e "${YELLOW}Run 'aws configure' to set up your credentials.${NC}"
    exit 1
fi

echo -e "${BLUE}=== Syncing Environment Variables to Amplify ===${NC}"
echo -e "${GREEN}App ID: $AMPLIFY_APP_ID${NC}"

# Build the environment variables JSON object
# We read from .env.example to know which vars to sync, then get values from .env.local
build_env_vars() {
    local env_vars="{"
    local first=true

    while IFS= read -r line || [ -n "$line" ]; do
        # Handle variable lines (VAR_NAME= or VAR_NAME=value)
        if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]]; then
            local var_name="${BASH_REMATCH[1]}"

            # Skip AMPLIFY_APP_ID itself - it's not a runtime env var
            if [ "$var_name" = "AMPLIFY_APP_ID" ]; then
                continue
            fi

            # Get the value from .env.local
            local var_value=$(grep "^${var_name}=" "$ENV_LOCAL" 2>/dev/null | cut -d'=' -f2-)

            # Skip if no value set
            if [ -z "$var_value" ]; then
                echo -e "${YELLOW}  Skipping $var_name (no value in .env.local)${NC}"
                continue
            fi

            # Handle special S3_ -> AWS_ mapping for Amplify
            # In Amplify, we use S3_ prefix since AWS_ is reserved
            local amplify_var_name="$var_name"
            if [[ "$var_name" == "AWS_ACCESS_KEY_ID" ]]; then
                amplify_var_name="S3_ACCESS_KEY_ID"
            elif [[ "$var_name" == "AWS_SECRET_ACCESS_KEY" ]]; then
                amplify_var_name="S3_SECRET_ACCESS_KEY"
            elif [[ "$var_name" == "AWS_REGION" ]]; then
                amplify_var_name="S3_REGION"
            fi

            # Add comma if not first
            if [ "$first" = true ]; then
                first=false
            else
                env_vars+=","
            fi

            # Escape special characters in value for JSON
            local escaped_value=$(echo "$var_value" | sed 's/\\/\\\\/g; s/"/\\"/g')
            env_vars+="\"$amplify_var_name\":\"$escaped_value\""
            echo -e "${GREEN}  + $amplify_var_name${NC}"
        fi
    done < "$ENV_EXAMPLE"

    env_vars+="}"
    echo "$env_vars"
}

echo -e "\n${BLUE}Reading variables from .env.example, values from .env.local...${NC}"
ENV_VARS_JSON=$(build_env_vars)

# Get just the JSON part (last line of output)
ENV_VARS_JSON=$(echo "$ENV_VARS_JSON" | tail -1)

# Update Amplify app with new environment variables
echo -e "\n${BLUE}Updating Amplify environment variables...${NC}"

aws amplify update-app \
    --app-id "$AMPLIFY_APP_ID" \
    --environment-variables "$ENV_VARS_JSON" \
    --output text \
    --query 'app.name' 2>/dev/null && {
    echo -e "\n${GREEN}Successfully updated environment variables!${NC}"
} || {
    echo -e "\n${RED}Failed to update environment variables.${NC}"
    echo -e "${YELLOW}Check your AWS credentials and Amplify App ID.${NC}"
    exit 1
}

echo -e "\n${GREEN}=== Sync Complete ===${NC}"
echo -e "${YELLOW}Note: You may need to trigger a redeploy for changes to take effect.${NC}"
