variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-west-1"
}

variable "environment" {
  description = "Environment name (development, staging, production)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Environment must be development, staging, or production."
  }
}

variable "min_capacity" {
  description = "Minimum Aurora Serverless v2 capacity in ACUs (0.5 to 128)"
  type        = number
  default     = 0.5

  validation {
    condition     = var.min_capacity >= 0.5 && var.min_capacity <= 128
    error_message = "Min capacity must be between 0.5 and 128 ACUs."
  }
}

variable "max_capacity" {
  description = "Maximum Aurora Serverless v2 capacity in ACUs (0.5 to 128)"
  type        = number
  default     = 4.0

  validation {
    condition     = var.max_capacity >= 0.5 && var.max_capacity <= 128
    error_message = "Max capacity must be between 0.5 and 128 ACUs."
  }
}

variable "backup_retention_period" {
  description = "Number of days to retain automated backups (1-35)"
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_period >= 1 && var.backup_retention_period <= 35
    error_message = "Backup retention period must be between 1 and 35 days."
  }
}

variable "publicly_accessible" {
  description = "Whether the database should be publicly accessible"
  type        = bool
  default     = true
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access the database"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
