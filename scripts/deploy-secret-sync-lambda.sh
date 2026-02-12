#!/bin/bash
# Deploy the secret sync Lambda function using AWS CLI
# This syncs RDS password changes to Amplify automatically

set -e

REGION="us-west-1"
FUNCTION_NAME="chapters-secret-sync"
ROLE_NAME="chapters-secret-sync-lambda-role"
RULE_NAME="chapters-secret-rotation"
SECRET_ARN="arn:aws:secretsmanager:us-west-1:716121312511:secret:rds!cluster-f89505b1-a495-4483-b282-15d58e2df95e-vOlOPD"
ACCOUNT_ID="716121312511"

echo "Creating IAM role..."
aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' 2>/dev/null || echo "Role already exists"

echo "Attaching policies..."
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "chapters-secret-sync-policy" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["secretsmanager:GetSecretValue"],
        "Resource": "'"$SECRET_ARN"'"
      },
      {
        "Effect": "Allow",
        "Action": ["amplify:GetApp", "amplify:UpdateApp"],
        "Resource": [
          "arn:aws:amplify:'"$REGION"':'"$ACCOUNT_ID"':apps/d2a3nxrtmkt6i2",
          "arn:aws:amplify:'"$REGION"':'"$ACCOUNT_ID"':apps/d2a3nxrtmkt6i2/*",
          "arn:aws:amplify:'"$REGION"':'"$ACCOUNT_ID"':apps/d3lu1hx5fjw0r9",
          "arn:aws:amplify:'"$REGION"':'"$ACCOUNT_ID"':apps/d3lu1hx5fjw0r9/*"
        ]
      },
      {
        "Effect": "Allow",
        "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        "Resource": "arn:aws:logs:*:*:*"
      }
    ]
  }'

# Wait for role to propagate
echo "Waiting for IAM role to propagate..."
sleep 10

echo "Creating Lambda function code..."
LAMBDA_CODE='
import json
import boto3
import urllib.parse

def handler(event, context):
    print(f"Received event: {json.dumps(event)}")

    SECRET_ARN = "arn:aws:secretsmanager:us-west-1:716121312511:secret:rds!cluster-f89505b1-a495-4483-b282-15d58e2df95e-vOlOPD"
    DB_ENDPOINT = "chapters-data-cluster.cluster-crcoymcou3hf.us-west-1.rds.amazonaws.com"
    DB_NAME = "chapters_data"
    REGION = "us-west-1"

    # Get the new password from Secrets Manager
    sm = boto3.client("secretsmanager", region_name=REGION)
    secret = sm.get_secret_value(SecretId=SECRET_ARN)
    secret_data = json.loads(secret["SecretString"])

    username = secret_data["username"]
    password = secret_data["password"]

    # URL-encode the password
    encoded_password = urllib.parse.quote(password, safe="")

    # Build DATABASE_URL
    database_url = f"postgresql://{username}:{encoded_password}@{DB_ENDPOINT}:5432/{DB_NAME}?sslmode=require"

    print(f"Updating DATABASE_URL for user: {username}")

    # Update Amplify apps
    amplify = boto3.client("amplify", region_name=REGION)
    app_ids = ["d2a3nxrtmkt6i2", "d3lu1hx5fjw0r9"]

    for app_id in app_ids:
        try:
            app = amplify.get_app(appId=app_id)
            current_env = app["app"].get("environmentVariables", {})
            current_env["DATABASE_URL"] = database_url

            amplify.update_app(appId=app_id, environmentVariables=current_env)

            print(f"Successfully updated DATABASE_URL env var for app {app_id} (no redeployment needed - apps fetch credentials from Secrets Manager at runtime)")
        except Exception as e:
            print(f"Error updating app {app_id}: {str(e)}")
            raise

    return {"statusCode": 200, "body": "Successfully synced database credentials"}
'

# Create the Lambda deployment package
TMPDIR=$(mktemp -d)
echo "$LAMBDA_CODE" > "$TMPDIR/index.py"
cd "$TMPDIR"
zip -q function.zip index.py

echo "Deploying Lambda function..."
ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"

# Check if function exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null; then
  echo "Updating existing function..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://function.zip" \
    --region "$REGION"
else
  echo "Creating new function..."
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime python3.11 \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file "fileb://function.zip" \
    --timeout 60 \
    --region "$REGION"
fi

# Clean up
rm -rf "$TMPDIR"

echo "Creating EventBridge rule..."
aws events put-rule \
  --name "$RULE_NAME" \
  --event-pattern '{
    "source": ["aws.secretsmanager"],
    "detail-type": ["AWS API Call via CloudTrail"],
    "detail": {
      "eventSource": ["secretsmanager.amazonaws.com"],
      "eventName": ["RotateSecret", "PutSecretValue"]
    }
  }' \
  --region "$REGION" 2>/dev/null || echo "Rule already exists"

echo "Adding Lambda permission for EventBridge..."
aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id "AllowEventBridge" \
  --action "lambda:InvokeFunction" \
  --principal "events.amazonaws.com" \
  --source-arn "arn:aws:events:$REGION:$ACCOUNT_ID:rule/$RULE_NAME" \
  --region "$REGION" 2>/dev/null || echo "Permission already exists"

echo "Adding EventBridge target..."
aws events put-targets \
  --rule "$RULE_NAME" \
  --targets "Id=chapters-secret-sync,Arn=arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$FUNCTION_NAME" \
  --region "$REGION"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "The Lambda function will now automatically:"
echo "  1. Detect when AWS rotates the RDS password"
echo "  2. Get the new password from Secrets Manager"
echo "  3. Update both Amplify apps with the new DATABASE_URL"
echo "  4. Trigger new deployments"
echo ""
echo "To test manually: aws lambda invoke --function-name $FUNCTION_NAME --region $REGION /dev/stdout"
