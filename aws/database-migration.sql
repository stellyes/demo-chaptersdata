-- ============================================
-- CHAPTERS DATA - COMPLETE DATABASE MIGRATION
-- Run this against your Aurora PostgreSQL database
-- ============================================

-- ============================================
-- MULTI-TENANT FOUNDATION
-- Organizations, storefronts, users, and profiles
-- ============================================

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(500) NOT NULL,
    type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    location VARCHAR(500),
    monthly_billing DECIMAL(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Storefronts table
CREATE TABLE IF NOT EXISTS storefronts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storefront_id VARCHAR(255) NOT NULL UNIQUE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    location VARCHAR(500),
    address VARCHAR(500),
    city VARCHAR(255),
    state VARCHAR(100),
    zip_code VARCHAR(20),
    phone VARCHAR(50),
    monthly_billing DECIMAL(10, 2) NOT NULL DEFAULT 0,
    dashboard_url VARCHAR(1000),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Mappings table (user-to-organization assignments)
CREATE TABLE IF NOT EXISTS user_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(500),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_user_mappings_user_id ON user_mappings(user_id);

-- User Profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    organization_name VARCHAR(500),
    organization_type VARCHAR(100),
    license_number VARCHAR(255),
    address VARCHAR(500),
    city VARCHAR(255),
    state VARCHAR(100),
    zip_code VARCHAR(20),
    phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- CLIENT BILLING INVOICES
-- Invoices sent TO clients
-- ============================================

-- Client Invoices table
CREATE TABLE IF NOT EXISTS client_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(100) NOT NULL UNIQUE,
    org_id VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
    description TEXT,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    pdf_key VARCHAR(1000),
    pdf_url VARCHAR(1000),
    pdf_file_name VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    paid_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_client_invoices_org_id ON client_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_client_invoices_status ON client_invoices(status);
CREATE INDEX IF NOT EXISTS idx_client_invoices_due_date ON client_invoices(due_date);

-- ============================================
-- DAILY LEARNING SYSTEM
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

-- ============================================
-- MONTHLY OPUS STRATEGIC ANALYSIS TABLES
-- ============================================

-- Monthly Analysis Jobs table
CREATE TABLE IF NOT EXISTS monthly_analysis_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'running',
    current_phase VARCHAR(100),
    month_year VARCHAR(7) NOT NULL UNIQUE,
    data_aggregation_done BOOLEAN DEFAULT FALSE,
    trend_analysis_done BOOLEAN DEFAULT FALSE,
    strategy_gen_done BOOLEAN DEFAULT FALSE,
    report_gen_done BOOLEAN DEFAULT FALSE,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    estimated_cost DECIMAL(10, 4) DEFAULT 0,
    error_message TEXT,
    error_phase VARCHAR(100),
    report_id UUID UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_monthly_analysis_jobs_started_at ON monthly_analysis_jobs(started_at);
CREATE INDEX IF NOT EXISTS idx_monthly_analysis_jobs_status ON monthly_analysis_jobs(status);

-- Monthly Strategic Reports table
CREATE TABLE IF NOT EXISTS monthly_strategic_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    month_year VARCHAR(7) NOT NULL UNIQUE,

    -- Executive Analysis
    executive_summary TEXT NOT NULL,
    performance_grade VARCHAR(2) NOT NULL,
    mom_change JSONB NOT NULL DEFAULT '{}',

    -- SWOT Analysis
    strengths_analysis JSONB NOT NULL DEFAULT '[]',
    weaknesses_analysis JSONB NOT NULL DEFAULT '[]',
    opportunities_analysis JSONB NOT NULL DEFAULT '[]',
    threats_analysis JSONB NOT NULL DEFAULT '[]',

    -- Trend Analysis
    sales_trends JSONB NOT NULL DEFAULT '[]',
    customer_trends JSONB NOT NULL DEFAULT '[]',
    brand_trends JSONB NOT NULL DEFAULT '[]',
    market_trends JSONB NOT NULL DEFAULT '[]',

    -- Strategic Recommendations
    strategic_priorities JSONB NOT NULL DEFAULT '[]',
    quarterly_goals JSONB NOT NULL DEFAULT '[]',
    resource_allocations JSONB NOT NULL DEFAULT '[]',
    risk_mitigations JSONB NOT NULL DEFAULT '[]',

    -- Competitive & Market Analysis
    competitive_landscape JSONB NOT NULL DEFAULT '{}',
    market_positioning JSONB NOT NULL DEFAULT '{}',
    regulatory_outlook JSONB NOT NULL DEFAULT '{}',

    -- Forecasts
    revenue_projections JSONB NOT NULL DEFAULT '[]',
    growth_opportunities JSONB NOT NULL DEFAULT '[]',
    risk_factors JSONB NOT NULL DEFAULT '[]',

    -- Questions for Next Month
    key_questions_next JSONB NOT NULL DEFAULT '[]',

    -- Metadata
    data_health_score FLOAT DEFAULT 0,
    confidence_score FLOAT DEFAULT 0,
    daily_digests_included INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_monthly_strategic_reports_created_at ON monthly_strategic_reports(created_at);

-- Add foreign key constraint for report_id
ALTER TABLE monthly_analysis_jobs
ADD CONSTRAINT fk_monthly_analysis_jobs_report
FOREIGN KEY (report_id) REFERENCES monthly_strategic_reports(id);

-- ============================================
-- BLOG SYSTEM TABLES
-- Blog posts and tags for the website
-- ============================================

-- Blog Posts table
CREATE TABLE IF NOT EXISTS blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(500) NOT NULL,
    excerpt TEXT NOT NULL,
    content TEXT NOT NULL,
    cover_image VARCHAR(1000),

    -- SEO fields
    meta_title VARCHAR(500),
    meta_description TEXT,
    keywords TEXT[] DEFAULT '{}',

    -- Categorization
    category VARCHAR(100) NOT NULL DEFAULT 'insights',
    tags TEXT[] DEFAULT '{}',

    -- Author info
    author_name VARCHAR(255) NOT NULL DEFAULT 'Chapters Data Team',
    author_role VARCHAR(255),

    -- Publishing
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMP WITH TIME ZONE,

    -- Engagement metrics
    view_count INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON blog_posts(published_at);
CREATE INDEX IF NOT EXISTS idx_blog_posts_featured ON blog_posts(featured);

-- Blog Tags table
CREATE TABLE IF NOT EXISTS blog_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    slug VARCHAR(255) NOT NULL UNIQUE,
    count INTEGER NOT NULL DEFAULT 0
);
