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

def handler(event, context):
    """
    Lambda triggered when RDS password rotates.
    Updates Amplify environment variables with new DATABASE_URL.
    """
    print(f"Received event: {json.dumps(event)}")

    # Get the secret ARN from the event
    secret_arn = event.get('detail', {}).get('secretArn') or event.get('SecretArn')

    if not secret_arn:
        print("No secret ARN in event, checking for test invocation")
        # For manual testing, use the known secret ARN
        secret_arn = "${aws_rds_cluster.chapters.master_user_secret[0].secret_arn}"

    # Get the new password from Secrets Manager
    sm = boto3.client('secretsmanager', region_name='${var.aws_region}')
    secret = sm.get_secret_value(SecretId=secret_arn)
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

            # Trigger a new deployment
            amplify.start_job(
                appId=app_id,
                branchName='main',
                jobType='RELEASE'
            )

            print(f"Successfully updated app {app_id}")

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
      eventName   = ["RotateSecret", "PutSecretValue"]
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
