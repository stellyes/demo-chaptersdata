-- Migration: Add vector embeddings, action tracking, and insight lifecycle management
-- Date: 2026-03-11

-- ============================================
-- 1. Enable pgvector extension for semantic search
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 2. BusinessInsight lifecycle fields + vector embedding
-- ============================================
ALTER TABLE business_insights ADD COLUMN IF NOT EXISTS validation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_insights ADD COLUMN IF NOT EXISTS last_validated TIMESTAMP(3);
ALTER TABLE business_insights ADD COLUMN IF NOT EXISTS impact_score DOUBLE PRECISION;
ALTER TABLE business_insights ADD COLUMN IF NOT EXISTS retention_score DOUBLE PRECISION;

-- Vector embedding column (1024 dimensions for Voyage AI voyage-3 model)
ALTER TABLE business_insights ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_business_insights_embedding
  ON business_insights USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================
-- 3. ActionItem table for tracking recommendation outcomes
-- ============================================
CREATE TABLE IF NOT EXISTS action_items (
  id TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  digest_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  timeframe TEXT,
  impact TEXT,
  effort TEXT,
  action_type TEXT NOT NULL DEFAULT 'priority',
  status TEXT NOT NULL DEFAULT 'pending',
  outcome TEXT,
  outcome_notes TEXT,
  completed_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_action_items_digest_id ON action_items(digest_id);
CREATE INDEX IF NOT EXISTS idx_action_items_job_id ON action_items(job_id);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status);
CREATE INDEX IF NOT EXISTS idx_action_items_category ON action_items(category);
CREATE INDEX IF NOT EXISTS idx_action_items_created_at ON action_items(created_at);

-- ============================================
-- 4. FeedbackCycle table for aggregate action analytics
-- ============================================
CREATE TABLE IF NOT EXISTS feedback_cycles (
  id TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cycle_date DATE NOT NULL,
  total_actions INTEGER NOT NULL DEFAULT 0,
  completed_actions INTEGER NOT NULL DEFAULT 0,
  dismissed_actions INTEGER NOT NULL DEFAULT 0,
  avg_completion_days DOUBLE PRECISION,
  top_categories JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT feedback_cycles_cycle_date_key UNIQUE(cycle_date)
);

CREATE INDEX IF NOT EXISTS idx_feedback_cycles_cycle_date ON feedback_cycles(cycle_date);
