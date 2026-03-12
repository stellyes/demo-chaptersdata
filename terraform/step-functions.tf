# ============================================
# STEP FUNCTIONS STATE MACHINE FOR LEARNING PIPELINE
# Orchestrates the 5-phase learning pipeline with
# individual Lambda invocations per phase.
# ============================================

data "aws_caller_identity" "current" {}

# IAM Role for Step Functions
resource "aws_iam_role" "sfn_role" {
  name = "chapters-sfn-role"

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

# IAM Policy for Step Functions to invoke Lambda
resource "aws_iam_role_policy" "sfn_lambda_policy" {
  name = "chapters-sfn-lambda-policy"
  role = aws_iam_role.sfn_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = aws_lambda_function.learning_processor.arn
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

# CloudWatch Log Group for Step Functions
resource "aws_cloudwatch_log_group" "sfn_logs" {
  name              = "/aws/states/chapters-learning-pipeline"
  retention_in_days = 14

  tags = {
    Environment = var.environment
    Application = "chapters-data"
  }
}

# Step Functions State Machine
resource "aws_sfn_state_machine" "learning_pipeline" {
  name     = "chapters-learning-pipeline"
  role_arn = aws_iam_role.sfn_role.arn

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.sfn_logs.arn}:*"
    include_execution_data = true
    level                  = "ERROR"
  }

  definition = jsonencode({
    Comment = "Chapters Data Daily Learning Pipeline - 5 Phase Orchestration"
    StartAt = "InitializeJob"

    States = {
      # Step 1: Initialize the job record
      InitializeJob = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.learning_processor.arn
          Payload = {
            action            = "initialize"
            "skipWebResearch.$" = "$.skipWebResearch"
            "forceRun.$"       = "$.forceRun"
          }
        }
        ResultPath = "$.initResult"
        ResultSelector = {
          "jobId.$"              = "$.Payload.jobId"
          "skipWebResearch.$"    = "$.Payload.skipWebResearch"
        }
        TimeoutSeconds = 120
        Retry = [
          {
            ErrorEquals     = ["States.TaskFailed"]
            IntervalSeconds = 5
            MaxAttempts     = 1
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "JobFailed"
          }
        ]
        Next = "Phase1DataReview"
      }

      # Step 2: Phase 1 - Data Review
      Phase1DataReview = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.learning_processor.arn
          Payload = {
            action = "executePhase"
            phase  = 1
            "jobId.$" = "$.initResult.jobId"
          }
        }
        ResultPath = "$.phase1Result"
        ResultSelector = {
          "success.$" = "$.Payload.success"
        }
        TimeoutSeconds = 600
        Retry = [
          {
            ErrorEquals     = ["States.TaskFailed"]
            IntervalSeconds = 10
            MaxAttempts     = 1
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "JobFailed"
          }
        ]
        Next = "Phase2QuestionGen"
      }

      # Step 3: Phase 2 - Question Generation
      Phase2QuestionGen = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.learning_processor.arn
          Payload = {
            action = "executePhase"
            phase  = 2
            "jobId.$" = "$.initResult.jobId"
          }
        }
        ResultPath = "$.phase2Result"
        ResultSelector = {
          "success.$" = "$.Payload.success"
        }
        TimeoutSeconds = 300
        Retry = [
          {
            ErrorEquals     = ["States.TaskFailed"]
            IntervalSeconds = 10
            MaxAttempts     = 1
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "JobFailed"
          }
        ]
        Next = "WebResearchChoice"
      }

      # Step 4: Choice - Skip or run web research
      WebResearchChoice = {
        Type = "Choice"
        Choices = [
          {
            Variable      = "$.initResult.skipWebResearch"
            BooleanEquals = true
            Next          = "SkipWebResearch"
          }
        ]
        Default = "Phase3WebResearch"
      }

      # Step 4a: Skip web research
      SkipWebResearch = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.learning_processor.arn
          Payload = {
            action     = "skipPhase"
            phase      = 3
            "jobId.$"  = "$.initResult.jobId"
            skipReason = "user_requested_or_quota"
          }
        }
        ResultPath = "$.phase3Result"
        ResultSelector = {
          "success.$" = "$.Payload.success"
        }
        TimeoutSeconds = 30
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "JobFailed"
          }
        ]
        Next = "Phase4Correlations"
      }

      # Step 4b: Phase 3 - Web Research (runs when not skipped)
      Phase3WebResearch = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.learning_processor.arn
          Payload = {
            action = "executePhase"
            phase  = 3
            "jobId.$" = "$.initResult.jobId"
          }
        }
        ResultPath = "$.phase3Result"
        ResultSelector = {
          "success.$" = "$.Payload.success"
        }
        TimeoutSeconds = 900
        Retry = [
          {
            ErrorEquals     = ["States.TaskFailed"]
            IntervalSeconds = 15
            MaxAttempts     = 1
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "JobFailed"
          }
        ]
        Next = "Phase4Correlations"
      }

      # Step 5: Phase 4 - Correlation Analysis
      Phase4Correlations = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.learning_processor.arn
          Payload = {
            action = "executePhase"
            phase  = 4
            "jobId.$" = "$.initResult.jobId"
          }
        }
        ResultPath = "$.phase4Result"
        ResultSelector = {
          "success.$" = "$.Payload.success"
        }
        TimeoutSeconds = 600
        Retry = [
          {
            ErrorEquals     = ["States.TaskFailed"]
            IntervalSeconds = 10
            MaxAttempts     = 1
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "JobFailed"
          }
        ]
        Next = "Phase5DigestGen"
      }

      # Step 6: Phase 5 - Digest Generation
      Phase5DigestGen = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.learning_processor.arn
          Payload = {
            action = "executePhase"
            phase  = 5
            "jobId.$" = "$.initResult.jobId"
          }
        }
        ResultPath = "$.phase5Result"
        ResultSelector = {
          "success.$" = "$.Payload.success"
        }
        TimeoutSeconds = 600
        Retry = [
          {
            ErrorEquals     = ["States.TaskFailed"]
            IntervalSeconds = 10
            MaxAttempts     = 1
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "JobFailed"
          }
        ]
        Next = "FinalizeJob"
      }

      # Step 7: Finalize the job
      FinalizeJob = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.learning_processor.arn
          Payload = {
            action    = "finalize"
            "jobId.$" = "$.initResult.jobId"
          }
        }
        ResultPath = "$.finalResult"
        ResultSelector = {
          "success.$" = "$.Payload.success"
          "jobId.$"   = "$.Payload.jobId"
        }
        TimeoutSeconds = 120
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "JobFailed"
          }
        ]
        Next = "Done"
      }

      # Terminal: Success
      Done = {
        Type = "Succeed"
      }

      # Terminal: Failure
      JobFailed = {
        Type  = "Fail"
        Error = "LearningPipelineError"
        Cause = "One or more phases failed. Check DailyLearningJob record for details."
      }
    }
  })

  tags = {
    Environment = var.environment
    Application = "chapters-data"
    Purpose     = "learning-pipeline"
  }
}

# Output
output "learning_pipeline_arn" {
  description = "ARN of the learning pipeline state machine"
  value       = aws_sfn_state_machine.learning_pipeline.arn
}
