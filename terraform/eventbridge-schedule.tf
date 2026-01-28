# ============================================
# EVENTBRIDGE SCHEDULE FOR DAILY LEARNING
# Triggers at 5 AM PST (1 PM UTC)
# ============================================

# IAM Role for EventBridge Scheduler
resource "aws_iam_role" "scheduler_role" {
  name = "chapters-scheduler-role"

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

# IAM Policy for Scheduler to send to SQS
resource "aws_iam_role_policy" "scheduler_sqs_policy" {
  name = "chapters-scheduler-sqs-policy"
  role = aws_iam_role.scheduler_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = aws_sqs_queue.learning_jobs.arn
      }
    ]
  })
}

# NOTE: SQS-targeted schedules are DISABLED
# Use lambda-learning-trigger.tf for active Lambda-based scheduling
# These SQS schedules are kept for potential future Lambda SQS consumers

# Daily learning schedule (SQS) - DISABLED, use Lambda trigger instead
resource "aws_scheduler_schedule" "daily_learning" {
  name       = "chapters-daily-learning"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 13 * * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_sqs_queue.learning_jobs.arn
    role_arn = aws_iam_role.scheduler_role.arn

    input = jsonencode({
      type            = "scheduled"
      forceRun        = false
      skipWebResearch = false
      source          = "eventbridge-schedule-sqs"
      scheduledAt     = "5am-pst"
    })
  }

  # DISABLED - Using Lambda trigger instead (see lambda-learning-trigger.tf)
  state = "DISABLED"
}

# Weekly deep learning schedule (SQS) - DISABLED, use Lambda trigger instead
resource "aws_scheduler_schedule" "weekly_deep_learning" {
  name       = "chapters-weekly-deep-learning"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 3 ? * SUN *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_sqs_queue.learning_jobs.arn
    role_arn = aws_iam_role.scheduler_role.arn

    input = jsonencode({
      type            = "scheduled"
      forceRun        = true
      skipWebResearch = false
      source          = "eventbridge-schedule-sqs"
      scheduledAt     = "sunday-3am-pst"
      deepLearning    = true
    })
  }

  # DISABLED - Using Lambda trigger instead (see lambda-learning-trigger.tf)
  state = "DISABLED"
}

# Outputs
output "daily_learning_schedule_arn" {
  description = "ARN of the daily learning schedule"
  value       = aws_scheduler_schedule.daily_learning.arn
}

output "weekly_deep_learning_schedule_arn" {
  description = "ARN of the weekly deep learning schedule"
  value       = aws_scheduler_schedule.weekly_deep_learning.arn
}
