-- ============================================
-- DAILY LEARNING SYSTEM - DATABASE MIGRATION
-- Run this against your PostgreSQL database
-- ============================================

-- Daily Learning Jobs table
CREATE TABLE IF NOT EXISTS daily_learning_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'running',
    current_phase VARCHAR(100),
    data_review_done BOOLEAN DEFAULT FALSE,
    question_gen_done BOOLEAN DEFAULT FALSE,
    web_research_done BOOLEAN DEFAULT FALSE,
    correlation_done BOOLEAN DEFAULT FALSE,
    digest_gen_done BOOLEAN DEFAULT FALSE,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    searches_used INTEGER DEFAULT 0,
    estimated_cost DECIMAL(10, 4) DEFAULT 0,
    questions_generated INTEGER DEFAULT 0,
    insights_discovered INTEGER DEFAULT 0,
    articles_analyzed INTEGER DEFAULT 0,
    error_message TEXT,
    error_phase VARCHAR(100),
    digest_id UUID UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_daily_learning_jobs_started_at ON daily_learning_jobs(started_at);
CREATE INDEX IF NOT EXISTS idx_daily_learning_jobs_status ON daily_learning_jobs(status);

-- Daily Digests table
CREATE TABLE IF NOT EXISTS daily_digests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    date DATE NOT NULL,
    executive_summary TEXT NOT NULL,
    priority_actions JSONB NOT NULL DEFAULT '[]',
    quick_wins JSONB NOT NULL DEFAULT '[]',
    watch_items JSONB NOT NULL DEFAULT '[]',
    questions_for_tomorrow JSONB NOT NULL DEFAULT '[]',
    industry_highlights JSONB NOT NULL DEFAULT '[]',
    correlated_insights JSONB NOT NULL DEFAULT '[]',
    data_snapshot JSONB NOT NULL DEFAULT '{}',
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_searches INTEGER DEFAULT 0,
    estimated_cost DECIMAL(10, 4) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_daily_digests_date ON daily_digests(date);
CREATE INDEX IF NOT EXISTS idx_daily_digests_created_at ON daily_digests(created_at);

-- Add foreign key constraint for digest_id
ALTER TABLE daily_learning_jobs
ADD CONSTRAINT fk_daily_learning_jobs_digest
FOREIGN KEY (digest_id) REFERENCES daily_digests(id);

-- Web Research Cache table
CREATE TABLE IF NOT EXISTS web_research_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query VARCHAR(500) NOT NULL,
    query_hash VARCHAR(64) NOT NULL,
    results JSONB NOT NULL DEFAULT '[]',
    total_results INTEGER DEFAULT 0,
    searched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    source VARCHAR(50) DEFAULT 'serpapi'
);

CREATE INDEX IF NOT EXISTS idx_web_research_cache_query_hash ON web_research_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_web_research_cache_expires_at ON web_research_cache(expires_at);

-- Collected URLs table (for deduplication)
CREATE TABLE IF NOT EXISTS collected_urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url_hash VARCHAR(64) NOT NULL UNIQUE,
    url TEXT NOT NULL,
    title VARCHAR(500),
    domain VARCHAR(255),
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    times_seen INTEGER DEFAULT 1,
    relevance_score DECIMAL(3, 2) DEFAULT 0,
    was_analyzed BOOLEAN DEFAULT FALSE,
    analysis_date TIMESTAMP WITH TIME ZONE,
    content_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_collected_urls_url_hash ON collected_urls(url_hash);
CREATE INDEX IF NOT EXISTS idx_collected_urls_domain ON collected_urls(domain);
CREATE INDEX IF NOT EXISTS idx_collected_urls_first_seen_at ON collected_urls(first_seen_at);

-- Learning Questions table
CREATE TABLE IF NOT EXISTS learning_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source VARCHAR(50) DEFAULT 'autonomous',
    priority INTEGER DEFAULT 5,
    requires_web_research BOOLEAN DEFAULT FALSE,
    was_researched BOOLEAN DEFAULT FALSE,
    research_date TIMESTAMP WITH TIME ZONE,
    answer TEXT,
    confidence DECIMAL(3, 2),
    sources JSONB DEFAULT '[]',
    job_id UUID
);

CREATE INDEX IF NOT EXISTS idx_learning_questions_category ON learning_questions(category);
CREATE INDEX IF NOT EXISTS idx_learning_questions_generated_at ON learning_questions(generated_at);
CREATE INDEX IF NOT EXISTS idx_learning_questions_job_id ON learning_questions(job_id);

-- Add foreign key constraint for job_id
ALTER TABLE learning_questions
ADD CONSTRAINT fk_learning_questions_job
FOREIGN KEY (job_id) REFERENCES daily_learning_jobs(id);

-- API Usage Tracker table
CREATE TABLE IF NOT EXISTS api_usage_tracker (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service VARCHAR(50) NOT NULL,
    month VARCHAR(7) NOT NULL,
    usage_count INTEGER DEFAULT 0,
    monthly_limit INTEGER NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(service, month)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_tracker_service_month ON api_usage_tracker(service, month);

-- Initialize SerpAPI tracker for current month
INSERT INTO api_usage_tracker (service, month, usage_count, monthly_limit)
VALUES ('serpapi', TO_CHAR(NOW(), 'YYYY-MM'), 0, 250)
ON CONFLICT (service, month) DO NOTHING;
