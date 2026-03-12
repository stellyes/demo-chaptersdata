#!/bin/bash
# ============================================
# DEPLOY LEARNING PROCESSOR LAMBDA
# Builds and deploys the Lambda function code
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FUNCTION_NAME="chapters-learning-processor"
REGION="us-west-1"
ZIP_PATH="$PROJECT_DIR/dist/lambda/learning-handler.zip"

echo "=== Deploying Learning Processor Lambda ==="
echo "Function: $FUNCTION_NAME"
echo "Region: $REGION"
echo ""

# Step 1: Build
echo "--- Building Lambda ---"
cd "$PROJECT_DIR"
npx tsx scripts/build-lambda.ts

# Step 2: Deploy
echo ""
echo "--- Deploying to AWS Lambda ---"
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$ZIP_PATH" \
  --region "$REGION" \
  --output json

echo ""
echo "--- Waiting for function to be active ---"
aws lambda wait function-active-v2 \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION"

echo ""
echo "=== Deployment complete ==="

# Show function info
aws lambda get-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query '{Runtime: Runtime, MemorySize: MemorySize, Timeout: Timeout, LastModified: LastModified}' \
  --output table
