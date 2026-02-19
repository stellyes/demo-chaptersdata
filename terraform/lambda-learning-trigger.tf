# ============================================
# LAMBDA FOR TRIGGERING LEARNING VIA API
# Simple Lambda that calls the Amplify API endpoint
# ============================================

# IAM Role for Learning Trigger Lambda
resource "aws_iam_role" "learning_trigger_role" {
  name = "chapters-learning-trigger-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Application = "chapters-data"
  }
}

# IAM Policy for Learning Trigger Lambda
resource "aws_iam_role_policy" "learning_trigger_policy" {
  name = "chapters-learning-trigger-policy"
  role = aws_iam_role.learning_trigger_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudWatch Logs
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

# Learning trigger Lambda function
resource "aws_lambda_function" "learning_trigger" {
  function_name = "chapters-learning-trigger"
  role          = aws_iam_role.learning_trigger_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 900
  memory_size   = 128

  filename         = data.archive_file.learning_trigger_code.output_path
  source_code_hash = data.archive_file.learning_trigger_code.output_base64sha256

  environment {
    variables = {
      API_BASE_URL     = var.amplify_app_url
      LEARNING_API_KEY = var.learning_api_key
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "learning-trigger"
  }
}

# Lambda code for triggering learning
data "archive_file" "learning_trigger_code" {
  type        = "zip"
  output_path = "${path.module}/lambda_learning_trigger.zip"

  source {
    content = <<-EOF
const https = require('https');
const http = require('http');

exports.handler = async (event) => {
  console.log('Learning trigger invoked:', JSON.stringify(event));

  const baseUrl = process.env.API_BASE_URL || 'https://bcsf.chaptersdata.com';
  const apiKey = process.env.LEARNING_API_KEY;
  const url = new URL('/api/ai/learning/run', baseUrl);

  if (!apiKey) {
    console.error('LEARNING_API_KEY not configured - API call will be rejected');
  }

  const payload = JSON.stringify({
    forceRun: event.forceRun || false,
    skipWebResearch: event.skipWebResearch || false,
    source: event.source || 'eventbridge-schedule'
  });

  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  };

  // Add auth header if API key is configured
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: headers
  };

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('API Response:', res.statusCode, data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({
            statusCode: 200,
            body: JSON.stringify({
              message: 'Learning triggered successfully',
              response: JSON.parse(data || '{}')
            })
          });
        } else {
          resolve({
            statusCode: res.statusCode,
            body: JSON.stringify({
              message: 'API returned error',
              response: data
            })
          });
        }
      });
    });

    req.on('error', (err) => {
      console.error('Request error:', err);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
};
EOF
    filename = "index.js"
  }
}

# Permission for EventBridge to invoke Lambda
resource "aws_lambda_permission" "eventbridge_daily" {
  statement_id  = "AllowEventBridgeDaily"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.learning_trigger.function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = aws_scheduler_schedule.daily_learning_lambda.arn
}

resource "aws_lambda_permission" "eventbridge_weekly" {
  statement_id  = "AllowEventBridgeWeekly"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.learning_trigger.function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = aws_scheduler_schedule.weekly_deep_learning_lambda.arn
}

# Daily learning schedule - calls Lambda at 5 AM PST
resource "aws_scheduler_schedule" "daily_learning_lambda" {
  name       = "chapters-daily-learning-lambda"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 5 * * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_lambda_function.learning_trigger.arn
    role_arn = aws_iam_role.scheduler_lambda_role.arn

    input = jsonencode({
      forceRun        = false
      skipWebResearch = false
      source          = "daily-schedule"
    })
  }

  state = "ENABLED"
}

# Weekly deep learning schedule - Sundays at 3 AM PST
resource "aws_scheduler_schedule" "weekly_deep_learning_lambda" {
  name       = "chapters-weekly-deep-learning-lambda"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 3 ? * SUN *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_lambda_function.learning_trigger.arn
    role_arn = aws_iam_role.scheduler_lambda_role.arn

    input = jsonencode({
      forceRun        = true
      skipWebResearch = false
      source          = "weekly-deep-learning"
    })
  }

  state = "ENABLED"
}

# IAM Role for Scheduler to invoke Lambda
resource "aws_iam_role" "scheduler_lambda_role" {
  name = "chapters-scheduler-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Application = "chapters-data"
  }
}

resource "aws_iam_role_policy" "scheduler_lambda_policy" {
  name = "chapters-scheduler-lambda-policy"
  role = aws_iam_role.scheduler_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.learning_trigger.arn
      }
    ]
  })
}

# Outputs
output "learning_trigger_lambda_arn" {
  description = "ARN of the learning trigger Lambda"
  value       = aws_lambda_function.learning_trigger.arn
}

output "daily_learning_lambda_schedule_arn" {
  description = "ARN of the daily learning schedule (Lambda)"
  value       = aws_scheduler_schedule.daily_learning_lambda.arn
}

output "weekly_deep_learning_lambda_schedule_arn" {
  description = "ARN of the weekly deep learning schedule (Lambda)"
  value       = aws_scheduler_schedule.weekly_deep_learning_lambda.arn
}
