#!/bin/bash
# sync-env.sh - Syncs environment variables from .env.example to amplify.yml
# Run automatically via pre-commit hook or manually with: ./scripts/sync-env.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"
AMPLIFY_YML="$PROJECT_ROOT/amplify.yml"
ENV_LOCAL="$PROJECT_ROOT/.env.local"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env.example exists
if [ ! -f "$ENV_EXAMPLE" ]; then
    echo -e "${RED}Error: .env.example not found at $ENV_EXAMPLE${NC}"
    exit 1
fi

# Check if amplify.yml exists
if [ ! -f "$AMPLIFY_YML" ]; then
    echo -e "${RED}Error: amplify.yml not found at $AMPLIFY_YML${NC}"
    exit 1
fi

echo -e "${GREEN}Syncing environment variables from .env.example to amplify.yml...${NC}"

# Parse .env.example and build echo commands
# Handles comments as section headers and special S3_ -> AWS_ mapping
generate_echo_commands() {
    local current_comment=""
    local first_var=true

    while IFS= read -r line || [ -n "$line" ]; do
        # Skip empty lines
        if [ -z "$line" ]; then
            continue
        fi

        # Handle comment lines (section headers)
        if [[ "$line" =~ ^#(.*)$ ]]; then
            current_comment="${BASH_REMATCH[1]}"
            continue
        fi

        # Handle variable lines (VAR_NAME= or VAR_NAME=value)
        if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]]; then
            local var_name="${BASH_REMATCH[1]}"

            # Print section comment if we have one
            if [ -n "$current_comment" ]; then
                if [ "$first_var" = false ]; then
                    echo "        #$current_comment"
                else
                    echo "        # Create .env.production file with runtime environment variables"
                    echo "        #$current_comment"
                fi
                current_comment=""
            fi
            first_var=false

            # Handle special S3_ -> AWS_ mapping
            if [[ "$var_name" == "S3_ACCESS_KEY_ID" ]]; then
                echo "        - echo \"AWS_ACCESS_KEY_ID=\$S3_ACCESS_KEY_ID\" >> .env.production"
            elif [[ "$var_name" == "S3_SECRET_ACCESS_KEY" ]]; then
                echo "        - echo \"AWS_SECRET_ACCESS_KEY=\$S3_SECRET_ACCESS_KEY\" >> .env.production"
            elif [[ "$var_name" == "S3_REGION" ]]; then
                echo "        - echo \"AWS_REGION=\$S3_REGION\" >> .env.production"
            elif [[ "$var_name" == "S3_BUCKET_NAME" ]]; then
                echo "        - echo \"S3_BUCKET_NAME=\$S3_BUCKET_NAME\" >> .env.production"
            else
                echo "        - echo \"$var_name=\$$var_name\" >> .env.production"
            fi
        fi
    done < "$ENV_EXAMPLE"
}

# Generate the new build commands section
NEW_COMMANDS=$(generate_echo_commands)

# Create the new amplify.yml content
# We'll rebuild the file preserving the structure but replacing the echo commands
cat > "$AMPLIFY_YML" << 'AMPLIFY_HEADER'
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
AMPLIFY_HEADER

# Add the generated echo commands
echo "$NEW_COMMANDS" >> "$AMPLIFY_YML"

# Add the build command and footer
cat >> "$AMPLIFY_YML" << 'AMPLIFY_FOOTER'
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
AMPLIFY_FOOTER

echo -e "${GREEN}Updated amplify.yml with $(echo "$NEW_COMMANDS" | grep -c "echo \"") environment variables${NC}"

# Validate .env.local if it exists
if [ -f "$ENV_LOCAL" ]; then
    echo -e "\n${GREEN}Validating .env.local against .env.example...${NC}"
    missing_vars=()

    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]]; then
            var_name="${BASH_REMATCH[1]}"
            if ! grep -q "^${var_name}=" "$ENV_LOCAL"; then
                missing_vars+=("$var_name")
            fi
        fi
    done < "$ENV_EXAMPLE"

    if [ ${#missing_vars[@]} -gt 0 ]; then
        echo -e "${YELLOW}Warning: The following variables are in .env.example but missing from .env.local:${NC}"
        for var in "${missing_vars[@]}"; do
            echo -e "${YELLOW}  - $var${NC}"
        done
        echo -e "${YELLOW}Add these to .env.local for local development.${NC}"
    else
        echo -e "${GREEN}All variables from .env.example are present in .env.local${NC}"
    fi
else
    echo -e "${YELLOW}Note: .env.local not found. Copy .env.example to .env.local and fill in your values.${NC}"
fi

# Stage amplify.yml if we're in a git commit context
if git rev-parse --git-dir > /dev/null 2>&1; then
    if ! git diff --quiet "$AMPLIFY_YML" 2>/dev/null; then
        echo -e "${GREEN}Staging updated amplify.yml...${NC}"
        git add "$AMPLIFY_YML"
    fi
fi

echo -e "${GREEN}Sync complete!${NC}"
