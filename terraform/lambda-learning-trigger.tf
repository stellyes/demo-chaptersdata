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

# Outputs
output "daily_learning_sfn_schedule_arn" {
  description = "ARN of the daily learning Step Functions schedule"
  value       = aws_scheduler_schedule.daily_learning_sfn.arn
}

output "weekly_deep_learning_sfn_schedule_arn" {
  description = "ARN of the weekly deep learning Step Functions schedule"
  value       = aws_scheduler_schedule.weekly_deep_learning_sfn.arn
}
