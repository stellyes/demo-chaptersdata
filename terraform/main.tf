terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  required_version = ">= 1.0"
}

provider "aws" {
  region = var.aws_region
}

# Data sources for existing VPC
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Security group for Aurora
resource "aws_security_group" "aurora" {
  name        = "chapters-aurora-sg"
  description = "Security group for Chapters Aurora PostgreSQL"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "PostgreSQL access"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "chapters-aurora-sg"
    Environment = var.environment
  }
}

# DB Subnet Group
resource "aws_db_subnet_group" "aurora" {
  name       = "chapters-aurora-subnet-group"
  subnet_ids = data.aws_subnets.default.ids

  tags = {
    Name        = "chapters-aurora-subnet-group"
    Environment = var.environment
  }
}

# Aurora Serverless v2 Cluster
resource "aws_rds_cluster" "chapters" {
  cluster_identifier     = "chapters-data-cluster"
  engine                 = "aurora-postgresql"
  engine_mode            = "provisioned"
  engine_version         = "15.4"
  database_name          = "chapters_data"
  master_username        = "chapters_admin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.aurora.name
  vpc_security_group_ids = [aws_security_group.aurora.id]

  serverlessv2_scaling_configuration {
    min_capacity = var.min_capacity
    max_capacity = var.max_capacity
  }

  # Backup configuration
  backup_retention_period = var.backup_retention_period
  preferred_backup_window = "03:00-04:00"

  # Set to false for production to keep final snapshot
  skip_final_snapshot = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "chapters-data-final-snapshot" : null

  # Enable deletion protection in production
  deletion_protection = var.environment == "production"

  tags = {
    Name        = "chapters-data-cluster"
    Environment = var.environment
    Project     = "chapters"
  }
}

# Aurora Serverless v2 Instance
resource "aws_rds_cluster_instance" "chapters" {
  identifier         = "chapters-data-instance-1"
  cluster_identifier = aws_rds_cluster.chapters.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.chapters.engine
  engine_version     = aws_rds_cluster.chapters.engine_version

  # Set to false for production
  publicly_accessible = var.publicly_accessible

  tags = {
    Name        = "chapters-data-instance-1"
    Environment = var.environment
    Project     = "chapters"
  }
}

# Outputs
output "cluster_endpoint" {
  description = "Aurora cluster endpoint for writes"
  value       = aws_rds_cluster.chapters.endpoint
}

output "cluster_reader_endpoint" {
  description = "Aurora cluster reader endpoint for read replicas"
  value       = aws_rds_cluster.chapters.reader_endpoint
}

output "database_name" {
  description = "Name of the database"
  value       = aws_rds_cluster.chapters.database_name
}

output "master_username" {
  description = "Master username for database access"
  value       = aws_rds_cluster.chapters.master_username
}

output "master_password_secret_arn" {
  description = "ARN of the Secrets Manager secret containing the master password"
  value       = aws_rds_cluster.chapters.master_user_secret[0].secret_arn
}

output "database_url_template" {
  description = "Template for DATABASE_URL (replace PASSWORD with actual password from Secrets Manager)"
  value       = "postgresql://${aws_rds_cluster.chapters.master_username}:PASSWORD@${aws_rds_cluster.chapters.endpoint}:5432/${aws_rds_cluster.chapters.database_name}?sslmode=require"
}

output "security_group_id" {
  description = "Security group ID for the Aurora cluster"
  value       = aws_security_group.aurora.id
}
