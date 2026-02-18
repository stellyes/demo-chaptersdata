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

def handler(event, context):
    """
    Lambda triggered when RDS password rotation completes.
    Updates Amplify environment variables with new DATABASE_URL.

    Only acts on FinishSecret events (rotation complete, AWSCURRENT updated).
    Skips PutSecretValue/RotateSecret events to avoid syncing stale credentials
    during the AWSPENDING phase.
    """
    print(f"Received event: {json.dumps(event)}")

    # Determine which rotation event triggered us
    event_name = event.get('detail', {}).get('eventName', '')

    # Only sync credentials after rotation is fully complete.
    # PutSecretValue fires during AWSPENDING (new password not yet active).
    # FinishSecret fires after AWSPENDING is promoted to AWSCURRENT.
    if event_name in ('RotateSecret', 'PutSecretValue'):
        print(f"Skipping {event_name} event - waiting for FinishSecret to sync credentials")
        return {
            'statusCode': 200,
            'body': json.dumps(f'Skipped {event_name} - will sync on FinishSecret')
        }

    # Get the secret ARN from the event
    secret_arn = (
        event.get('detail', {}).get('requestParameters', {}).get('secretId')
        or event.get('detail', {}).get('secretArn')
        or event.get('SecretArn')
    )

    if not secret_arn:
        print("No secret ARN in event, using known secret ARN for manual invocation")
        secret_arn = "${aws_rds_cluster.chapters.master_user_secret[0].secret_arn}"

    # Brief delay to ensure AWSCURRENT is fully propagated after FinishSecret
    time.sleep(2)

    # Fetch the AWSCURRENT version explicitly to guarantee we get the active password
    sm = boto3.client('secretsmanager', region_name='${var.aws_region}')
    secret = sm.get_secret_value(SecretId=secret_arn, VersionStage='AWSCURRENT')
    secret_data = json.loads(secret['SecretString'])

    username = secret_data['username']
    password = secret_data['password']

    # URL-encode the password for DATABASE_URL
    encoded_password = urllib.parse.quote(password, safe='')

    # Build the new DATABASE_URL
    database_url = f"postgresql://{username}:{encoded_password}@${aws_rds_cluster.chapters.endpoint}:5432/${aws_rds_cluster.chapters.database_name}?sslmode=require"

    print(f"Updating DATABASE_URL for user: {username}")

    # Update Amplify apps
    amplify = boto3.client('amplify', region_name='${var.aws_region}')

    app_ids = ['d2a3nxrtmkt6i2', 'd3lu1hx5fjw0r9']  # chapters-data, chapters-website

    for app_id in app_ids:
        try:
            # Get current env vars
            app = amplify.get_app(appId=app_id)
            current_env = app['app'].get('environmentVariables', {})

            # Update DATABASE_URL
            current_env['DATABASE_URL'] = database_url

            # Apply the update
            amplify.update_app(
                appId=app_id,
                environmentVariables=current_env
            )

            print(f"Successfully updated DATABASE_URL env var for app {app_id} (no redeployment needed - apps fetch credentials from Secrets Manager at runtime)")

        except Exception as e:
            print(f"Error updating app {app_id}: {str(e)}")
            raise

    return {
        'statusCode': 200,
        'body': json.dumps('Successfully synced database credentials')
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
      eventName   = ["RotateSecret", "PutSecretValue", "FinishSecret"]
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
