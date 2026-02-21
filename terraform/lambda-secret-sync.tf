# Lambda function to sync RDS password to Amplify when rotated
# This prevents downtime when AWS auto-rotates the password

resource "aws_iam_role" "secret_sync_lambda" {
  name = "chapters-secret-sync-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "secret_sync_lambda" {
  name = "chapters-secret-sync-lambda-policy"
  role = aws_iam_role.secret_sync_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = aws_rds_cluster.chapters.master_user_secret[0].secret_arn
      },
      {
        Effect = "Allow"
        Action = [
          "amplify:UpdateApp",
          "amplify:StartJob"
        ]
        Resource = [
          "arn:aws:amplify:${var.aws_region}:*:apps/d2a3nxrtmkt6i2",
          "arn:aws:amplify:${var.aws_region}:*:apps/d2a3nxrtmkt6i2/*",
          "arn:aws:amplify:${var.aws_region}:*:apps/d3lu1hx5fjw0r9",
          "arn:aws:amplify:${var.aws_region}:*:apps/d3lu1hx5fjw0r9/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

data "archive_file" "secret_sync_lambda" {
  type        = "zip"
  output_path = "${path.module}/lambda/secret-sync.zip"

  source {
    content  = <<-EOF
import json
import boto3
import urllib.parse
import time
import datetime

def handler(event, context):
    """
    Lambda triggered when RDS password rotation completes.
    Updates Amplify environment variables with new DATABASE_URL.

    Only acts on UpdateSecretVersionStage events (rotation complete, AWSCURRENT updated).
    Skips PutSecretValue/RotateSecret events to avoid syncing stale credentials
    during the AWSPENDING phase.
    """
    start_time = time.time()
    ts = datetime.datetime.utcnow().isoformat() + 'Z'
    print(f"[{ts}] ===== SECRET SYNC LAMBDA START =====")
    print(f"[{ts}] Request ID: {context.aws_request_id}")
    print(f"[{ts}] Function: {context.function_name}, Memory: {context.memory_limit_in_mb}MB")
    print(f"[{ts}] Raw event: {json.dumps(event)}")

    # Determine which rotation event triggered us
    event_name = event.get('detail', {}).get('eventName', '')
    event_source = event.get('source', 'unknown')
    print(f"[{ts}] Event name: '{event_name}', Source: '{event_source}'")

    # Only sync credentials after rotation is fully complete.
    # PutSecretValue fires during AWSPENDING (new password not yet active).
    # UpdateSecretVersionStage fires after AWSPENDING is promoted to AWSCURRENT.
    if event_name in ('RotateSecret', 'PutSecretValue'):
        elapsed = round((time.time() - start_time) * 1000)
        print(f"[{ts}] SKIP: {event_name} event received — credentials not yet active. Waiting for UpdateSecretVersionStage.")
        print(f"[{ts}] ===== SECRET SYNC LAMBDA END (skipped, {elapsed}ms) =====")
        return {
            'statusCode': 200,
            'body': json.dumps(f'Skipped {event_name} - will sync on UpdateSecretVersionStage')
        }

    print(f"[{ts}] ACTION: Processing {event_name or 'manual'} event — syncing credentials")

    # Get the secret ARN from the event
    secret_arn = (
        event.get('detail', {}).get('requestParameters', {}).get('secretId')
        or event.get('detail', {}).get('secretArn')
        or event.get('SecretArn')
    )

    if not secret_arn:
        print(f"[{ts}] No secret ARN in event payload, using hardcoded ARN (manual invocation)")
        secret_arn = "${aws_rds_cluster.chapters.master_user_secret[0].secret_arn}"

    print(f"[{ts}] Secret ARN: {secret_arn}")

    # Brief delay to ensure AWSCURRENT is fully propagated after UpdateSecretVersionStage
    print(f"[{ts}] Waiting 2s for AWSCURRENT propagation...")
    time.sleep(2)

    # Fetch the AWSCURRENT version explicitly to guarantee we get the active password
    print(f"[{ts}] Fetching AWSCURRENT from Secrets Manager...")
    fetch_start = time.time()
    sm = boto3.client('secretsmanager', region_name='${var.aws_region}')
    secret = sm.get_secret_value(SecretId=secret_arn, VersionStage='AWSCURRENT')
    secret_data = json.loads(secret['SecretString'])
    fetch_elapsed = round((time.time() - fetch_start) * 1000)

    username = secret_data['username']
    password = secret_data['password']
    password_preview = password[:3] + '***' + password[-2:] if len(password) > 5 else '***'
    print(f"[{ts}] Secrets Manager fetch completed in {fetch_elapsed}ms")
    print(f"[{ts}] Retrieved credentials — user: {username}, password: {password_preview} ({len(password)} chars)")

    # URL-encode the password for DATABASE_URL
    encoded_password = urllib.parse.quote(password, safe='')
    print(f"[{ts}] Password URL-encoded ({len(encoded_password)} chars)")

    # Build the new DATABASE_URL
    db_host = '${aws_rds_cluster.chapters.endpoint}'
    db_name = '${aws_rds_cluster.chapters.database_name}'
    database_url = f"postgresql://{username}:{encoded_password}@{db_host}:5432/{db_name}?sslmode=require"
    print(f"[{ts}] Built DATABASE_URL: postgresql://{username}:****@{db_host}:5432/{db_name}?sslmode=require")

    # Update Amplify apps
    amplify = boto3.client('amplify', region_name='${var.aws_region}')
    app_names = {
        'd2a3nxrtmkt6i2': 'chapters-data',
        'd3lu1hx5fjw0r9': 'chapters-website',
    }

    success_count = 0
    for app_id, app_name in app_names.items():
        try:
            print(f"[{ts}] --- Updating {app_name} ({app_id}) ---")

            # Get current env vars
            print(f"[{ts}] Fetching current env vars for {app_name}...")
            app_start = time.time()
            app = amplify.get_app(appId=app_id)
            current_env = app['app'].get('environmentVariables', {})
            print(f"[{ts}] Retrieved {len(current_env)} env vars in {round((time.time() - app_start) * 1000)}ms")

            old_url = current_env.get('DATABASE_URL', '(not set)')
            url_changed = old_url != database_url
            print(f"[{ts}] DATABASE_URL changed: {url_changed}")

            # Update DATABASE_URL
            current_env['DATABASE_URL'] = database_url

            # Apply the update
            print(f"[{ts}] Calling amplify.update_app for {app_name}...")
            update_start = time.time()
            amplify.update_app(
                appId=app_id,
                environmentVariables=current_env
            )
            update_elapsed = round((time.time() - update_start) * 1000)

            print(f"[{ts}] SUCCESS: {app_name} ({app_id}) env var updated in {update_elapsed}ms")
            success_count += 1

        except Exception as e:
            print(f"[{ts}] ERROR: Failed to update {app_name} ({app_id}): {type(e).__name__}: {str(e)}")
            raise

    total_elapsed = round((time.time() - start_time) * 1000)
    print(f"[{ts}] ===== SECRET SYNC LAMBDA END ({success_count}/{len(app_names)} apps updated, {total_elapsed}ms) ====="  )

    return {
        'statusCode': 200,
        'body': json.dumps(f'Successfully synced database credentials to {success_count} apps in {total_elapsed}ms')
    }
EOF
    filename = "index.py"
  }
}

resource "aws_lambda_function" "secret_sync" {
  filename         = data.archive_file.secret_sync_lambda.output_path
  function_name    = "chapters-secret-sync"
  role             = aws_iam_role.secret_sync_lambda.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.secret_sync_lambda.output_base64sha256
  runtime          = "python3.11"
  timeout          = 60

  tags = {
    Name        = "chapters-secret-sync"
    Environment = var.environment
    Project     = "chapters"
  }
}

# EventBridge rule to trigger Lambda when secret rotates
resource "aws_cloudwatch_event_rule" "secret_rotation" {
  name        = "chapters-secret-rotation"
  description = "Trigger Lambda when RDS password rotates"

  event_pattern = jsonencode({
    source      = ["aws.secretsmanager"]
    detail-type = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["secretsmanager.amazonaws.com"]
      eventName   = ["RotateSecret", "PutSecretValue", "UpdateSecretVersionStage"]
      requestParameters = {
        secretId = [aws_rds_cluster.chapters.master_user_secret[0].secret_arn]
      }
    }
  })

  tags = {
    Name        = "chapters-secret-rotation"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_event_target" "secret_sync_lambda" {
  rule      = aws_cloudwatch_event_rule.secret_rotation.name
  target_id = "chapters-secret-sync"
  arn       = aws_lambda_function.secret_sync.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.secret_sync.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.secret_rotation.arn
}

# Output
output "secret_sync_lambda_arn" {
  description = "ARN of the secret sync Lambda function"
  value       = aws_lambda_function.secret_sync.arn
}
