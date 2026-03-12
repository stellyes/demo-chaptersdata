# ============================================
# EVENTBRIDGE SCHEDULES FOR LEARNING PIPELINE
# Triggers Step Functions state machine directly.
# No intermediary Lambda needed.
# ============================================

# IAM Role for Scheduler to start Step Functions executions
resource "aws_iam_role" "scheduler_sfn_role" {
  name = "chapters-scheduler-sfn-role"

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

resource "aws_iam_role_policy" "scheduler_sfn_policy" {
  name = "chapters-scheduler-sfn-policy"
  role = aws_iam_role.scheduler_sfn_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "states:StartExecution"
        Resource = aws_sfn_state_machine.learning_pipeline.arn
      }
    ]
  })
}

# Daily learning schedule - 5 AM PST → Step Functions
resource "aws_scheduler_schedule" "daily_learning_sfn" {
  name       = "chapters-daily-learning-sfn"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 5 * * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_sfn_state_machine.learning_pipeline.arn
    role_arn = aws_iam_role.scheduler_sfn_role.arn

    input = jsonencode({
      forceRun        = false
      skipWebResearch = false
      source          = "daily-schedule"
    })
  }

  state = "ENABLED"
}

# Weekly deep learning schedule - Sundays at 3 AM PST → Step Functions
resource "aws_scheduler_schedule" "weekly_deep_learning_sfn" {
  name       = "chapters-weekly-deep-learning-sfn"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 3 ? * SUN *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_sfn_state_machine.learning_pipeline.arn
    role_arn = aws_iam_role.scheduler_sfn_role.arn

    input = jsonencode({
      forceRun        = true
      skipWebResearch = false
      source          = "weekly-deep-learning"
    })
  }

  state = "ENABLED"
}

# ============================================
# LEGACY: Fire-and-poll trigger Lambda (DISABLED)
# Kept for reference but schedules are disabled.
# The Step Functions approach above replaces this.
# ============================================

# IAM Role for Learning Trigger Lambda (legacy)
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

resource "aws_iam_role_policy" "learning_trigger_policy" {
  name = "chapters-learning-trigger-policy"
  role = aws_iam_role.learning_trigger_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
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
    Purpose     = "learning-trigger-legacy"
  }
}

data "archive_file" "learning_trigger_code" {
  type        = "zip"
  output_path = "${path.module}/lambda_learning_trigger.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'Legacy trigger - use Step Functions instead' });"
    filename = "index.js"
  }
}

# Legacy schedules - DISABLED (replaced by Step Functions schedules above)
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
      source          = "daily-schedule-legacy"
    })
  }

  state = "DISABLED"
}

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
      source          = "weekly-deep-learning-legacy"
    })
  }

  state = "DISABLED"
}

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

# Lambda permissions for EventBridge (legacy)
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

# Outputs
output "learning_trigger_lambda_arn" {
  description = "ARN of the learning trigger Lambda (legacy)"
  value       = aws_lambda_function.learning_trigger.arn
}

output "daily_learning_sfn_schedule_arn" {
  description = "ARN of the daily learning Step Functions schedule"
  value       = aws_scheduler_schedule.daily_learning_sfn.arn
}

output "weekly_deep_learning_sfn_schedule_arn" {
  description = "ARN of the weekly deep learning Step Functions schedule"
  value       = aws_scheduler_schedule.weekly_deep_learning_sfn.arn
}
