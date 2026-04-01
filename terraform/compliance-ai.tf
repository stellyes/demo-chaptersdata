# ============================================
# COMPLIANCE AI INFRASTRUCTURE
# Lambda functions, Step Functions, and EventBridge
# for the compliance scanning pipeline.
# ============================================

# ─── Variables ───────────────────────────────────────────────────────────────

variable "compliance_scan_enabled" {
  description = "Enable/disable daily compliance scanning schedule"
  type        = bool
  default     = true
}

# ─── Lambda Functions ────────────────────────────────────────────────────────

# Corpus Sync: Downloads SQLite from S3, extracts enriched JSONL
resource "aws_lambda_function" "compliance_corpus_sync" {
  function_name = "chapters-compliance-corpus-sync"
  role          = aws_iam_role.compliance_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300 # 5 minutes
  memory_size   = 1024

  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment {
    variables = {
      S3_BUCKET              = var.s3_bucket_name
      RULE_COMPILER_FUNCTION = aws_lambda_function.compliance_rule_compiler.function_name
      NODE_ENV               = var.environment
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "compliance-corpus-sync"
  }
}

# Rule Compiler: Compiles enriched docs into structured rules via Claude Haiku
resource "aws_lambda_function" "compliance_rule_compiler" {
  function_name = "chapters-compliance-rule-compiler"
  role          = aws_iam_role.compliance_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 600 # 10 minutes
  memory_size   = 1024

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
    Purpose     = "compliance-rule-compiler"
  }
}

# Rules Engine: Applies deterministic rules against sales data
resource "aws_lambda_function" "compliance_rules_engine" {
  function_name = "chapters-compliance-rules-engine"
  role          = aws_iam_role.compliance_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300 # 5 minutes
  memory_size   = 512

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
      NODE_ENV            = var.environment
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "compliance-rules-engine"
  }
}

# Aggregator: Merges scan results, writes alerts to Aurora
resource "aws_lambda_function" "compliance_aggregator" {
  function_name = "chapters-compliance-aggregator"
  role          = aws_iam_role.compliance_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300 # 5 minutes
  memory_size   = 512

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
      NODE_ENV            = var.environment
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "compliance-aggregator"
  }
}

# Report Generator: Claude Haiku summarizes findings
resource "aws_lambda_function" "compliance_report" {
  function_name = "chapters-compliance-report"
  role          = aws_iam_role.compliance_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300 # 5 minutes
  memory_size   = 512

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
    Purpose     = "compliance-report"
  }
}

# ─── IAM Role for Compliance Lambdas ─────────────────────────────────────────

resource "aws_iam_role" "compliance_lambda_role" {
  name = "chapters-compliance-lambda-role"

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

resource "aws_iam_role_policy" "compliance_lambda_policy" {
  name = "chapters-compliance-lambda-policy"
  role = aws_iam_role.compliance_lambda_role.id

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
      # S3 (read/write compliance data + backups)
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.s3_bucket_name}",
          "arn:aws:s3:::${var.s3_bucket_name}/cannabis-compliance/*"
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
      # VPC for RDS access
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface"
        ]
        Resource = "*"
      },
      # Lambda invoke (corpus-sync triggers rule-compiler)
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:chapters-compliance-*"
        ]
      }
    ]
  })
}

# Allow compliance Lambdas to access Aurora
resource "aws_security_group_rule" "aurora_from_compliance_lambda" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.lambda_sg.id
  security_group_id        = aws_security_group.aurora.id
  description              = "Allow compliance Lambda access to Aurora"
}

# ─── Step Functions: Compliance Pipeline ─────────────────────────────────────

resource "aws_iam_role" "compliance_sfn_role" {
  name = "chapters-compliance-sfn-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "states.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Application = "chapters-data"
  }
}

resource "aws_iam_role_policy" "compliance_sfn_policy" {
  name = "chapters-compliance-sfn-lambda-policy"
  role = aws_iam_role.compliance_sfn_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          aws_lambda_function.compliance_rules_engine.arn,
          aws_lambda_function.compliance_aggregator.arn,
          aws_lambda_function.compliance_report.arn,
          aws_lambda_function.compliance_rule_compiler.arn,
          aws_lambda_function.compliance_ml_scanner.arn,
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "compliance_sfn_logs" {
  name              = "/aws/states/chapters-compliance-pipeline"
  retention_in_days = 14

  tags = {
    Environment = var.environment
    Application = "chapters-data"
  }
}

resource "aws_sfn_state_machine" "compliance_pipeline" {
  name     = "chapters-compliance-pipeline"
  role_arn = aws_iam_role.compliance_sfn_role.arn

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.compliance_sfn_logs.arn}:*"
    include_execution_data = true
    level                  = "ERROR"
  }

  definition = jsonencode({
    Comment = "Chapters Compliance AI - Sales Data Risk Scanning Pipeline"
    StartAt = "InitializeScan"

    States = {
      # Step 1: Initialize scan record in Aurora
      InitializeScan = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.compliance_rules_engine.arn
          Payload = {
            action         = "initialize"
            "scanType.$"   = "$.scanType"
            "dateRange.$"  = "$.dateRange"
          }
        }
        ResultPath     = "$.initResult"
        ResultSelector = {
          "scanId.$"     = "$.Payload.scanId"
          "rulesStale.$" = "$.Payload.rulesStale"
        }
        TimeoutSeconds = 120
        Retry = [{
          ErrorEquals     = ["States.TaskFailed"]
          IntervalSeconds = 5
          MaxAttempts     = 1
          BackoffRate     = 2
        }]
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "ScanFailed"
        }]
        Next = "CheckRulesRefresh"
      }

      # Step 2: Check if rules need refreshing
      CheckRulesRefresh = {
        Type = "Choice"
        Choices = [{
          Variable      = "$.initResult.rulesStale"
          BooleanEquals = true
          Next          = "RefreshRules"
        }]
        Default = "RunScanners"
      }

      # Step 2a: Refresh rules if stale
      RefreshRules = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.compliance_rule_compiler.arn
          Payload = {
            source = "compliance-pipeline"
          }
        }
        ResultPath     = "$.refreshResult"
        TimeoutSeconds = 600
        Retry = [{
          ErrorEquals     = ["States.TaskFailed"]
          IntervalSeconds = 10
          MaxAttempts     = 1
          BackoffRate     = 2
        }]
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "ScanFailed"
        }]
        Next = "RunScanners"
      }

      # Step 3: Run Rules Engine + ML Classifier in PARALLEL
      RunScanners = {
        Type = "Parallel"
        Branches = [
          {
            StartAt = "RunRulesEngine"
            States = {
              RunRulesEngine = {
                Type     = "Task"
                Resource = "arn:aws:states:::lambda:invoke"
                Parameters = {
                  FunctionName = aws_lambda_function.compliance_rules_engine.arn
                  Payload = {
                    action       = "scan"
                    "scanId.$"   = "$.initResult.scanId"
                    "dateRange.$" = "$.dateRange"
                  }
                }
                ResultSelector = {
                  "violationCount.$" = "$.Payload.violationCount"
                  "s3ResultKey.$"    = "$.Payload.s3ResultKey"
                }
                TimeoutSeconds = 300
                Retry = [{
                  ErrorEquals     = ["States.TaskFailed"]
                  IntervalSeconds = 10
                  MaxAttempts     = 1
                  BackoffRate     = 2
                }]
                End = true
              }
            }
          },
          {
            StartAt = "RunMLClassifier"
            States = {
              RunMLClassifier = {
                Type     = "Task"
                Resource = "arn:aws:states:::lambda:invoke"
                Parameters = {
                  FunctionName = aws_lambda_function.compliance_ml_scanner.arn
                  Payload = {
                    "scanId.$"    = "$.initResult.scanId"
                    "dateRange.$" = "$.dateRange"
                  }
                }
                ResultSelector = {
                  "violationCount.$" = "$.Payload.violationCount"
                  "s3ResultKey.$"    = "$.Payload.s3ResultKey"
                  "status.$"         = "$.Payload.status"
                }
                TimeoutSeconds = 600
                Retry = [{
                  ErrorEquals     = ["States.TaskFailed"]
                  IntervalSeconds = 15
                  MaxAttempts     = 2
                  BackoffRate     = 2
                }]
                # ML failure is non-fatal: catch and return empty result
                Catch = [{
                  ErrorEquals = ["States.ALL"]
                  ResultPath  = "$.mlError"
                  Next        = "MLScannerFallback"
                }]
                End = true
              }
              MLScannerFallback = {
                Type = "Pass"
                Result = {
                  violationCount = 0
                  s3ResultKey    = null
                  status         = "fallback"
                }
                End = true
              }
            }
          }
        ]
        ResultPath = "$.scanResults"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "ScanFailed"
        }]
        Next = "AggregateResults"
      }

      # Step 4: Aggregate, deduplicate, and write alerts
      # scanResults[0] = rules engine, scanResults[1] = ML classifier
      AggregateResults = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.compliance_aggregator.arn
          Payload = {
            "scanId.$"        = "$.initResult.scanId"
            "rulesResultKey.$" = "$.scanResults[0].s3ResultKey"
            "mlResultKey.$"    = "$.scanResults[1].s3ResultKey"
          }
        }
        ResultPath     = "$.aggregateResult"
        ResultSelector = {
          "alertsCreated.$" = "$.Payload.alertsCreated"
          "criticalCount.$" = "$.Payload.criticalCount"
          "highCount.$"     = "$.Payload.highCount"
        }
        TimeoutSeconds = 300
        Retry = [{
          ErrorEquals     = ["States.TaskFailed"]
          IntervalSeconds = 10
          MaxAttempts     = 1
          BackoffRate     = 2
        }]
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "ScanFailed"
        }]
        Next = "GenerateReport"
      }

      # Step 5: Generate human-readable compliance report
      GenerateReport = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.compliance_report.arn
          Payload = {
            "scanId.$" = "$.initResult.scanId"
          }
        }
        ResultPath     = "$.reportResult"
        TimeoutSeconds = 300
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "FinalizeScan"
        }]
        Next = "FinalizeScan"
      }

      # Step 6: Mark scan as completed
      FinalizeScan = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.compliance_rules_engine.arn
          Payload = {
            action     = "finalize"
            "scanId.$" = "$.initResult.scanId"
          }
        }
        ResultPath     = "$.finalResult"
        TimeoutSeconds = 120
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "ScanFailed"
        }]
        Next = "Done"
      }

      # Terminal: Success
      Done = {
        Type = "Succeed"
      }

      # Terminal: Failure
      ScanFailed = {
        Type  = "Fail"
        Error = "CompliancePipelineError"
        Cause = "Compliance scan failed. Check ComplianceScan record and CloudWatch logs for details."
      }
    }
  })

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "compliance-pipeline"
  }
}

# ─── EventBridge Schedules ───────────────────────────────────────────────────

# IAM role for EventBridge to invoke Step Functions
resource "aws_iam_role" "compliance_scheduler_role" {
  name = "chapters-compliance-scheduler-role"

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

resource "aws_iam_role_policy" "compliance_scheduler_policy" {
  name = "chapters-compliance-scheduler-policy"
  role = aws_iam_role.compliance_scheduler_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "states:StartExecution"
        ]
        Resource = aws_sfn_state_machine.compliance_pipeline.arn
      },
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = aws_lambda_function.compliance_corpus_sync.arn
      }
    ]
  })
}

# Daily compliance scan at 8AM PST (4PM UTC)
resource "aws_scheduler_schedule" "daily_compliance_scan" {
  name       = "chapters-daily-compliance-scan"
  group_name = "default"
  state      = var.compliance_scan_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 16 * * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_sfn_state_machine.compliance_pipeline.arn
    role_arn = aws_iam_role.compliance_scheduler_role.arn

    input = jsonencode({
      scanType  = "daily"
      dateRange = { lookbackDays = 1 }
      source    = "daily-schedule"
    })
  }
}

# Weekly corpus sync at Monday 2AM PST (10AM UTC)
resource "aws_scheduler_schedule" "weekly_corpus_sync" {
  name       = "chapters-weekly-corpus-sync"
  group_name = "default"
  state      = var.compliance_scan_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 10 ? * MON *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_lambda_function.compliance_corpus_sync.arn
    role_arn = aws_iam_role.compliance_scheduler_role.arn

    input = jsonencode({
      source = "weekly-schedule"
    })
  }
}

# ─── Phase 4: ML Scanner Lambda ─────────────────────────────────────────────

# ML Scanner Lambda (invokes SageMaker Serverless Endpoint for classification)
resource "aws_lambda_function" "compliance_ml_scanner" {
  function_name = "chapters-compliance-ml-scanner"
  role          = aws_iam_role.compliance_ml_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 600 # 10 minutes (cold start + inference)
  memory_size   = 512

  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = data.aws_subnets.default.ids
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  environment {
    variables = {
      DATABASE_SECRET_ARN  = aws_rds_cluster.chapters.master_user_secret[0].secret_arn
      DATABASE_HOST        = aws_rds_cluster.chapters.endpoint
      DATABASE_NAME        = aws_rds_cluster.chapters.database_name
      S3_BUCKET            = var.s3_bucket_name
      SAGEMAKER_ENDPOINT   = "chapters-compliance-classifier"
      NODE_ENV             = var.environment
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "compliance-ml-scanner"
  }
}

# ─── Phase 3: ML Training Pipeline ──────────────────────────────────────────

# Training Data Generator Lambda
resource "aws_lambda_function" "compliance_training_data_gen" {
  function_name = "chapters-compliance-training-data-gen"
  role          = aws_iam_role.compliance_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 900 # 15 minutes
  memory_size   = 1024

  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = data.aws_subnets.default.ids
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  environment {
    variables = {
      DATABASE_SECRET_ARN    = aws_rds_cluster.chapters.master_user_secret[0].secret_arn
      DATABASE_HOST          = aws_rds_cluster.chapters.endpoint
      DATABASE_NAME          = aws_rds_cluster.chapters.database_name
      S3_BUCKET              = var.s3_bucket_name
      ANTHROPIC_API_KEY      = var.anthropic_api_key
      TRAIN_TRIGGER_FUNCTION = aws_lambda_function.compliance_train_trigger.function_name
      NODE_ENV               = var.environment
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "compliance-training-data-gen"
  }
}

# Train Trigger Lambda (manages SageMaker jobs + endpoint deployment)
resource "aws_lambda_function" "compliance_train_trigger" {
  function_name = "chapters-compliance-train-trigger"
  role          = aws_iam_role.compliance_ml_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 900 # 15 minutes (polls training job)
  memory_size   = 256

  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment {
    variables = {
      S3_BUCKET          = var.s3_bucket_name
      SAGEMAKER_ROLE_ARN = aws_iam_role.sagemaker_role.arn
      NODE_ENV           = var.environment
    }
  }

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "compliance-train-trigger"
  }
}

# ─── SageMaker IAM Role ─────────────────────────────────────────────────────

resource "aws_iam_role" "sagemaker_role" {
  name = "chapters-sagemaker-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "sagemaker.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Application = "chapters-data"
  }
}

resource "aws_iam_role_policy" "sagemaker_policy" {
  name = "chapters-sagemaker-policy"
  role = aws_iam_role.sagemaker_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3 access for training data and model artifacts
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ]
        Resource = [
          "arn:aws:s3:::${var.s3_bucket_name}",
          "arn:aws:s3:::${var.s3_bucket_name}/cannabis-compliance/*"
        ]
      },
      # CloudWatch for training metrics
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
      },
      # ECR for pulling DLC images
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = "*"
      }
    ]
  })
}

# ─── ML Lambda IAM Role (needs SageMaker permissions) ────────────────────────

resource "aws_iam_role" "compliance_ml_role" {
  name = "chapters-compliance-ml-role"

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

resource "aws_iam_role_policy" "compliance_ml_policy" {
  name = "chapters-compliance-ml-policy"
  role = aws_iam_role.compliance_ml_role.id

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
      # S3
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.s3_bucket_name}",
          "arn:aws:s3:::${var.s3_bucket_name}/cannabis-compliance/*"
        ]
      },
      # SageMaker training + endpoint management
      {
        Effect = "Allow"
        Action = [
          "sagemaker:CreateTrainingJob",
          "sagemaker:DescribeTrainingJob",
          "sagemaker:StopTrainingJob",
          "sagemaker:CreateModel",
          "sagemaker:DescribeModel",
          "sagemaker:DeleteModel",
          "sagemaker:CreateEndpointConfig",
          "sagemaker:DescribeEndpointConfig",
          "sagemaker:DeleteEndpointConfig",
          "sagemaker:CreateEndpoint",
          "sagemaker:DescribeEndpoint",
          "sagemaker:UpdateEndpoint",
          "sagemaker:InvokeEndpoint",
          "sagemaker:AddTags"
        ]
        Resource = "*"
      },
      # Pass role to SageMaker
      {
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = aws_iam_role.sagemaker_role.arn
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "sagemaker.amazonaws.com"
          }
        }
      },
      # Lambda invoke (data gen triggers train trigger)
      {
        Effect = "Allow"
        Action = "lambda:InvokeFunction"
        Resource = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:chapters-compliance-*"
      }
    ]
  })
}

# ─── Monthly Training Schedule ───────────────────────────────────────────────

# Monthly model retraining on 1st of month at 1AM PST (9AM UTC)
resource "aws_scheduler_schedule" "monthly_compliance_retrain" {
  name       = "chapters-monthly-compliance-retrain"
  group_name = "default"
  state      = var.compliance_scan_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 9 1 * ? *)"
  schedule_expression_timezone = "America/Los_Angeles"

  target {
    arn      = aws_lambda_function.compliance_training_data_gen.arn
    role_arn = aws_iam_role.compliance_scheduler_role.arn

    input = jsonencode({
      source = "monthly-schedule"
    })
  }
}

# Update scheduler policy to include new Lambda targets
resource "aws_iam_role_policy" "compliance_scheduler_ml_policy" {
  name = "chapters-compliance-scheduler-ml-policy"
  role = aws_iam_role.compliance_scheduler_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "lambda:InvokeFunction"
        Resource = aws_lambda_function.compliance_training_data_gen.arn
      }
    ]
  })
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "compliance_pipeline_arn" {
  description = "ARN of the compliance scanning pipeline state machine"
  value       = aws_sfn_state_machine.compliance_pipeline.arn
}

output "compliance_corpus_sync_arn" {
  description = "ARN of the corpus sync Lambda"
  value       = aws_lambda_function.compliance_corpus_sync.arn
}

output "compliance_rule_compiler_arn" {
  description = "ARN of the rule compiler Lambda"
  value       = aws_lambda_function.compliance_rule_compiler.arn
}

output "sagemaker_role_arn" {
  description = "ARN of the SageMaker execution role"
  value       = aws_iam_role.sagemaker_role.arn
}

output "compliance_train_trigger_arn" {
  description = "ARN of the train trigger Lambda"
  value       = aws_lambda_function.compliance_train_trigger.arn
}

output "compliance_ml_scanner_arn" {
  description = "ARN of the ML scanner Lambda"
  value       = aws_lambda_function.compliance_ml_scanner.arn
}
