# ============================================
# TREEZ S3 → AURORA INGESTION LAMBDA
# Triggered daily at 7AM UTC (1hr after Treez export at 6AM UTC).
# Reads Product Summary CSVs from S3 and upserts into sales_line_items.
# ============================================

# Lambda function for Treez ingestion
resource "aws_lambda_function" "treez_ingest" {
  function_name = "chapters-treez-ingest"
  role          = aws_iam_role.lambda_worker_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300 # 5 minutes
  memory_size   = 512

  # Placeholder - actual code deployed via scripts/build-treez-ingest-lambda.ts
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = data.aws_subnets.default.ids
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  environment {
    variables = {
      DATABASE_SECRET_ARN = aws_rds_cluster.chapters.master_user_secret[0].secret_arn
      DATABASE_HOST       = aws_rds_cluster.chapters.endpoint
      DATABASE_NAME       = aws_rds_cluster.chapters.database_name
      TREEZ_S3_BUCKET     = "treez-data-export"
      NODE_ENV            = var.environment
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "treez-ingest"
  }
}

# IAM Role for Scheduler to invoke Lambda directly
resource "aws_iam_role" "scheduler_treez_ingest_role" {
  name = "chapters-scheduler-treez-ingest-role"

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

resource "aws_iam_role_policy" "scheduler_treez_ingest_policy" {
  name = "chapters-scheduler-treez-ingest-policy"
  role = aws_iam_role.scheduler_treez_ingest_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.treez_ingest.arn
      }
    ]
  })
}

# EventBridge Scheduler — daily at midnight PST (7AM UTC, 1hr after Treez export)
resource "aws_scheduler_schedule" "daily_treez_ingest" {
  name       = "chapters-daily-treez-ingest"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 0 * * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_lambda_function.treez_ingest.arn
    role_arn = aws_iam_role.scheduler_treez_ingest_role.arn

    input = jsonencode({
      lookbackDays = 3
      source       = "daily-schedule"
    })
  }

  state = "ENABLED"
}

# Outputs
output "treez_ingest_arn" {
  description = "ARN of the Treez ingest Lambda"
  value       = aws_lambda_function.treez_ingest.arn
}

output "treez_ingest_schedule_arn" {
  description = "ARN of the daily Treez ingest schedule"
  value       = aws_scheduler_schedule.daily_treez_ingest.arn
}
