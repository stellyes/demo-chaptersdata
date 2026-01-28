# ============================================
# SQS QUEUES FOR ASYNC JOB PROCESSING
# ============================================

# Learning job queue - longer visibility timeout for long-running jobs
resource "aws_sqs_queue" "learning_jobs" {
  name                       = "chapters-learning-jobs"
  visibility_timeout_seconds = 900  # 15 minutes
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20   # Long polling

  # Dead letter queue for failed jobs
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.learning_jobs_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "progressive-learning"
  }
}

# Dead letter queue for learning jobs
resource "aws_sqs_queue" "learning_jobs_dlq" {
  name                      = "chapters-learning-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "dead-letter-queue"
  }
}

# Custom query queue - shorter timeout for typical queries
resource "aws_sqs_queue" "custom_queries" {
  name                       = "chapters-custom-queries"
  visibility_timeout_seconds = 300  # 5 minutes
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20   # Long polling

  # Dead letter queue for failed jobs
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.custom_queries_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "custom-queries"
  }
}

# Dead letter queue for custom queries
resource "aws_sqs_queue" "custom_queries_dlq" {
  name                      = "chapters-custom-queries-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "dead-letter-queue"
  }
}

# Outputs
output "learning_queue_url" {
  description = "URL of the learning jobs SQS queue"
  value       = aws_sqs_queue.learning_jobs.url
}

output "learning_queue_arn" {
  description = "ARN of the learning jobs SQS queue"
  value       = aws_sqs_queue.learning_jobs.arn
}

output "custom_queries_queue_url" {
  description = "URL of the custom queries SQS queue"
  value       = aws_sqs_queue.custom_queries.url
}

output "custom_queries_queue_arn" {
  description = "ARN of the custom queries SQS queue"
  value       = aws_sqs_queue.custom_queries.arn
}
