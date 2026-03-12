# ============================================
# LAMBDA WORKERS FOR ASYNC JOB PROCESSING
# ============================================

# IAM Role for Lambda workers
resource "aws_iam_role" "lambda_worker_role" {
  name = "chapters-lambda-worker-role"

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

# IAM Policy for Lambda workers
resource "aws_iam_role_policy" "lambda_worker_policy" {
  name = "chapters-lambda-worker-policy"
  role = aws_iam_role.lambda_worker_role.id

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
      },
      # SQS permissions
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = [
          aws_sqs_queue.learning_jobs.arn,
          aws_sqs_queue.custom_queries.arn
        ]
      },
      # S3 permissions
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.s3_bucket_name}",
          "arn:aws:s3:::${var.s3_bucket_name}/*"
        ]
      },
      # Secrets Manager for database credentials
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = aws_rds_cluster.chapters.master_user_secret[0].secret_arn
      },
      # VPC permissions for RDS access
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface"
        ]
        Resource = "*"
      }
    ]
  })
}

# Security group for Lambda in VPC
resource "aws_security_group" "lambda_sg" {
  name        = "chapters-lambda-sg"
  description = "Security group for Lambda workers"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = {
    Name        = "chapters-lambda-sg"
    Environment = var.environment
  }
}

# Allow Lambda to access Aurora
resource "aws_security_group_rule" "aurora_from_lambda" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.lambda_sg.id
  security_group_id        = aws_security_group.aurora.id
  description              = "Allow Lambda access to Aurora"
}

# Learning job processor Lambda
resource "aws_lambda_function" "learning_processor" {
  function_name = "chapters-learning-processor"
  role          = aws_iam_role.lambda_worker_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 900  # 15 minutes max
  memory_size   = 1024

  # Placeholder - actual code will be deployed separately
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
      S3_BUCKET           = var.s3_bucket_name
      ANTHROPIC_API_KEY   = var.anthropic_api_key
      SERPAPI_API_KEY      = var.serpapi_api_key
      VOYAGE_API_KEY       = var.voyage_api_key
      LEARNING_API_KEY     = var.learning_api_key
      NODE_ENV            = var.environment
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "learning-processor"
  }
}

# Custom query processor Lambda
resource "aws_lambda_function" "query_processor" {
  function_name = "chapters-query-processor"
  role          = aws_iam_role.lambda_worker_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300  # 5 minutes
  memory_size   = 512

  # Placeholder - actual code will be deployed separately
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
      S3_BUCKET           = var.s3_bucket_name
      ANTHROPIC_API_KEY   = var.anthropic_api_key
      NODE_ENV            = var.environment
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "query-processor"
  }
}

# Placeholder Lambda code (will be replaced with actual deployment)
data "archive_file" "lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/lambda_placeholder.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'Placeholder - deploy actual code' });"
    filename = "index.js"
  }
}

# SQS trigger for learning processor
resource "aws_lambda_event_source_mapping" "learning_trigger" {
  event_source_arn = aws_sqs_queue.learning_jobs.arn
  function_name    = aws_lambda_function.learning_processor.arn
  batch_size       = 1
  enabled          = true
}

# SQS trigger for query processor
resource "aws_lambda_event_source_mapping" "query_trigger" {
  event_source_arn = aws_sqs_queue.custom_queries.arn
  function_name    = aws_lambda_function.query_processor.arn
  batch_size       = 1
  enabled          = true
}

# Outputs
output "learning_processor_arn" {
  description = "ARN of the learning processor Lambda"
  value       = aws_lambda_function.learning_processor.arn
}

output "query_processor_arn" {
  description = "ARN of the query processor Lambda"
  value       = aws_lambda_function.query_processor.arn
}
