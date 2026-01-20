# Chapters Data Architecture Audit & Migration Recommendations

**Date:** January 19, 2026
**Scope:** AWS S3, DynamoDB, and data connectivity analysis

---

## Executive Summary

The current architecture uses a **hybrid storage approach**:
- **S3** for unstructured/semi-structured data (CSVs, PDFs, research documents)
- **DynamoDB** for structured transactional data (invoices, organizations, users)

This creates **data silos** that make it difficult to answer critical business questions like:
- "What brands do we buy vs. what brands actually sell?"
- "Which distributors offer the best margins on products we successfully sell?"
- "How do purchasing decisions correlate with sales performance?"

---

## Current Data Inventory

### 1. S3 Bucket: `retail-data-bcgr`

| Data Type | Location | Format | Records (Est.) | Update Frequency |
|-----------|----------|--------|----------------|------------------|
| Sales Data | `raw-uploads/{store}/sales_*.csv` | CSV | ~2,000 daily records | Daily |
| Brand Performance | `raw-uploads/{store}/brand_*.csv` | CSV | ~500 brands | Weekly |
| Product Performance | `raw-uploads/{store}/product_*.csv` | CSV | ~50 categories | Weekly |
| Customer Data | `raw-uploads/{store}/customers_*.csv` | CSV | 30,000+ records | Weekly |
| Brand Mappings | `config/brand_product_mapping.json` | JSON | ~200 canonical brands | Manual |
| Budtender Metrics | `data/budtender_performance.csv` | CSV | ~20 employees | Weekly |
| Research Documents | `research-documents/` | HTML | ~100 documents | Ad-hoc |

### 2. DynamoDB Tables

| Table | Purpose | Key Structure | Records (Est.) | GSIs |
|-------|---------|---------------|----------------|------|
| `retail-invoices` | Invoice headers | `invoice_id` | ~20,000 | date-index, vendor-date-index |
| `retail-invoice-line-items` | Invoice line items | `invoice_id` + `line_number` | ~500,000 | brand-index, product-type-index |
| `chapters-organizations` | Multi-tenant orgs | `ORG#{orgId}` | ~10 | None |
| `chapters-storefronts` | Store locations | `ORG#{orgId}` + `STOREFRONT#{id}` | ~10 | None |
| `chapters-user-mappings` | User roles | `USER#{userId}` + `ORG#{orgId}` | ~50 | None |

---

## Current Data Relationships (Or Lack Thereof)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CURRENT STATE: DATA SILOS                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   S3 (Analytics Data)              DynamoDB (Transactional)             │
│   ─────────────────                ─────────────────────────            │
│                                                                         │
│   ┌──────────────┐                 ┌──────────────────┐                 │
│   │  Sales Data  │                 │ retail-invoices  │                 │
│   │  (by date)   │    NO LINK      │ (by invoice_id)  │                 │
│   └──────────────┘ ◄────────────►  └──────────────────┘                 │
│          ↓                                  ↓                           │
│   ┌──────────────┐                 ┌──────────────────┐                 │
│   │ Brand Perf   │   WEAK LINK     │ Invoice Line     │                 │
│   │ (brand name) │ ◄─ ─ ─ ─ ─ ─ ─► │ Items (brand)    │                 │
│   └──────────────┘  (name only)    └──────────────────┘                 │
│          ↓                                  ↓                           │
│   ┌──────────────┐                 ┌──────────────────┐                 │
│   │ Product Perf │   WEAK LINK     │ Line Items       │                 │
│   │ (type name)  │ ◄─ ─ ─ ─ ─ ─ ─► │ (product_type)   │                 │
│   └──────────────┘  (name only)    └──────────────────┘                 │
│          ↓                                                              │
│   ┌──────────────┐                 ┌──────────────────┐                 │
│   │ Customer     │    NO LINK      │ Organizations    │                 │
│   │ Data         │ ◄────────────►  │ Storefronts      │                 │
│   └──────────────┘                 └──────────────────┘                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Issues

1. **No Purchase-to-Sale Tracking**: Cannot connect what we buy (invoices) to what we sell (sales data)
2. **Brand Name Inconsistency**: 798 vendor name variants, brand names differ between POS and invoices
3. **No Product-Level Attribution**: Sales data is aggregated by category, not individual products
4. **No Time-Series Correlation**: Cannot see if a purchase led to increased sales
5. **Customer Data Isolated**: No connection between customer purchases and inventory sourcing
6. **Manual Brand Mapping**: The `brand_product_mapping.json` requires constant manual updates

---

## Questions We CANNOT Currently Answer

| Question | Why It's Blocked |
|----------|------------------|
| "Which distributor gives us the best margins on products that actually sell?" | No link between invoice costs and sales revenue |
| "What's the true profitability of Brand X?" | Purchase cost in DynamoDB, sales in S3, different naming |
| "Should we reorder from Nabis or Herbl?" | Can't compare historical performance by distributor |
| "What products are we buying but not selling?" | No inventory tracking, no purchase-to-sale correlation |
| "Which customer segments buy products from specific distributors?" | Customer data and invoice data completely separate |
| "What's the lead time from purchase to sale for different product types?" | No timestamp correlation between invoice_date and sale_date |

---

## Migration Options Analysis

### Option 1: Amazon Aurora PostgreSQL (Recommended)

**Why PostgreSQL:**
- True relational joins between all data types
- JSONB support for semi-structured data (brand mappings, metadata)
- Full-text search for product names and descriptions
- Window functions for time-series analysis
- Mature tooling and broad ecosystem

**Proposed Schema:**

```sql
-- Core Business Entities
CREATE TABLE organizations (
    org_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50),
    status VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE storefronts (
    storefront_id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(org_id),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(2),
    zip VARCHAR(10),
    status VARCHAR(50)
);

-- Vendor/Distributor Management (with normalization)
CREATE TABLE distributors (
    distributor_id UUID PRIMARY KEY,
    canonical_name VARCHAR(255) NOT NULL UNIQUE,
    license_number VARCHAR(50),
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE distributor_aliases (
    alias_id UUID PRIMARY KEY,
    distributor_id UUID REFERENCES distributors(distributor_id),
    alias_name VARCHAR(255) NOT NULL,
    UNIQUE(alias_name)
);

-- Brand Management (with normalization)
CREATE TABLE brands (
    brand_id UUID PRIMARY KEY,
    canonical_name VARCHAR(255) NOT NULL UNIQUE,
    product_types TEXT[],  -- Array of product types this brand produces
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE brand_aliases (
    alias_id UUID PRIMARY KEY,
    brand_id UUID REFERENCES brands(brand_id),
    alias_name VARCHAR(255) NOT NULL,
    product_type VARCHAR(50),  -- What type when sold under this alias
    UNIQUE(alias_name)
);

-- Product Catalog (central product registry)
CREATE TABLE products (
    product_id UUID PRIMARY KEY,
    brand_id UUID REFERENCES brands(brand_id),
    product_name VARCHAR(500) NOT NULL,
    product_type VARCHAR(50) NOT NULL,
    product_subtype VARCHAR(50),
    unit_size VARCHAR(50),
    strain VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(brand_id, product_name, unit_size)
);

-- Purchase Data (from invoices)
CREATE TABLE invoices (
    invoice_id UUID PRIMARY KEY,
    storefront_id UUID REFERENCES storefronts(storefront_id),
    distributor_id UUID REFERENCES distributors(distributor_id),
    invoice_number VARCHAR(50),
    invoice_date DATE NOT NULL,
    download_date DATE,
    subtotal DECIMAL(12,2),
    discount DECIMAL(12,2),
    tax DECIMAL(12,2),
    total DECIMAL(12,2),
    status VARCHAR(50),
    source_file VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoice_line_items (
    line_item_id UUID PRIMARY KEY,
    invoice_id UUID REFERENCES invoices(invoice_id),
    product_id UUID REFERENCES products(product_id),
    line_number INT,
    sku_units INT NOT NULL,
    unit_cost DECIMAL(10,4) NOT NULL,
    excise_per_unit DECIMAL(10,4),
    total_cost DECIMAL(12,2) NOT NULL,
    total_with_excise DECIMAL(12,2),
    trace_id VARCHAR(100),
    is_promo BOOLEAN DEFAULT FALSE
);

-- Sales Data (from POS exports)
CREATE TABLE daily_sales (
    sale_id UUID PRIMARY KEY,
    storefront_id UUID REFERENCES storefronts(storefront_id),
    sale_date DATE NOT NULL,
    tickets_count INT,
    units_sold INT,
    customers_count INT,
    new_customers INT,
    gross_sales DECIMAL(12,2),
    discounts DECIMAL(12,2),
    returns DECIMAL(12,2),
    net_sales DECIMAL(12,2),
    taxes DECIMAL(12,2),
    cogs_with_excise DECIMAL(12,2),
    gross_income DECIMAL(12,2),
    gross_margin_pct DECIMAL(5,2),
    UNIQUE(storefront_id, sale_date)
);

-- Brand-Level Sales (aggregated from POS)
CREATE TABLE brand_sales (
    brand_sale_id UUID PRIMARY KEY,
    storefront_id UUID REFERENCES storefronts(storefront_id),
    brand_id UUID REFERENCES brands(brand_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    net_sales DECIMAL(12,2),
    gross_margin_pct DECIMAL(5,2),
    pct_of_total_sales DECIMAL(5,2),
    avg_cost_wo_excise DECIMAL(10,4),
    UNIQUE(storefront_id, brand_id, period_start, period_end)
);

-- Product Category Sales
CREATE TABLE product_type_sales (
    product_type_sale_id UUID PRIMARY KEY,
    storefront_id UUID REFERENCES storefronts(storefront_id),
    product_type VARCHAR(50) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    net_sales DECIMAL(12,2),
    gross_margin_pct DECIMAL(5,2),
    pct_of_total_sales DECIMAL(5,2),
    UNIQUE(storefront_id, product_type, period_start, period_end)
);

-- Customer Data
CREATE TABLE customers (
    customer_id UUID PRIMARY KEY,
    storefront_id UUID REFERENCES storefronts(storefront_id),
    external_id VARCHAR(100),  -- POS system ID
    name VARCHAR(255),
    signup_date DATE,
    last_visit_date DATE,
    lifetime_visits INT,
    lifetime_transactions INT,
    lifetime_net_sales DECIMAL(12,2),
    lifetime_aov DECIMAL(10,2),
    customer_segment VARCHAR(50),  -- New/Low, Regular, Good, VIP, Whale
    recency_segment VARCHAR(50),   -- Active, Warm, Cool, Cold, Lost
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Budtender Performance
CREATE TABLE budtenders (
    budtender_id UUID PRIMARY KEY,
    storefront_id UUID REFERENCES storefronts(storefront_id),
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE budtender_metrics (
    metric_id UUID PRIMARY KEY,
    budtender_id UUID REFERENCES budtenders(budtender_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    transactions INT,
    net_sales DECIMAL(12,2),
    avg_basket DECIMAL(10,2),
    items_per_transaction DECIMAL(5,2),
    UNIQUE(budtender_id, period_start, period_end)
);

-- User Management
CREATE TABLE users (
    user_id UUID PRIMARY KEY,
    cognito_id VARCHAR(255) UNIQUE,  -- Keep Cognito for auth
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_org_roles (
    user_id UUID REFERENCES users(user_id),
    org_id UUID REFERENCES organizations(org_id),
    role VARCHAR(50) NOT NULL,  -- admin, member
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, org_id)
);

-- Indexes for common queries
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_distributor ON invoices(distributor_id);
CREATE INDEX idx_line_items_product ON invoice_line_items(product_id);
CREATE INDEX idx_daily_sales_date ON daily_sales(sale_date);
CREATE INDEX idx_brand_sales_brand ON brand_sales(brand_id);
CREATE INDEX idx_customers_segment ON customers(customer_segment);
```

**Data Relationships (After Migration):**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PROPOSED STATE: CONNECTED DATA                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   organizations ───1:N──► storefronts ───1:N──► daily_sales            │
│        │                       │                     │                  │
│        │                       │                     ▼                  │
│        │                       └──1:N──► brand_sales ◄──N:1── brands   │
│        │                       │                          │            │
│        │                       │                          │            │
│        │                       └──1:N──► invoices         │            │
│        │                                    │              │            │
│        │                                    │              │            │
│        │                                    ▼              │            │
│        │                         invoice_line_items       │            │
│        │                                    │              │            │
│        │                                    │              │            │
│        │                                    ▼              │            │
│        │                              products ◄──────N:1─┘            │
│        │                                    │                          │
│        │                                    │                          │
│        │                                    ▼                          │
│        │                             brand_aliases ◄──── brand_mappings│
│        │                                                               │
│        └──1:N──► users ◄──► user_org_roles                            │
│                                                                         │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  NEW QUERIES ENABLED:                                          │   │
│   │  • JOIN invoices → products → brands → brand_sales            │   │
│   │  • Purchase cost vs. sale revenue by brand                    │   │
│   │  • Distributor performance comparison                          │   │
│   │  • Time-series: purchase date → sale date correlation         │   │
│   │  • Customer segment → product preference analysis              │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Aurora PostgreSQL Pricing (us-west-1):**

| Configuration | Monthly Cost (Est.) |
|---------------|---------------------|
| db.t4g.medium (2 vCPU, 4GB) | ~$60/month |
| Storage (100GB) | ~$10/month |
| I/O costs | ~$5-20/month |
| **Total** | **~$75-90/month** |

*Note: Can start with `db.t4g.small` at ~$30/month for development*

---

### Option 2: Amazon RDS MySQL

**Pros:**
- Lower cost than Aurora (~20% cheaper)
- Simpler if team has MySQL experience
- Good enough for this data volume

**Cons:**
- No native JSONB (use JSON type instead)
- Window functions less powerful
- Less scalable than Aurora if growth accelerates

**Pricing:** ~$50-70/month for comparable setup

---

### Option 3: Keep DynamoDB + Add Amazon Athena

**Approach:**
- Keep DynamoDB for invoices (already there)
- Export S3 CSVs to Parquet format
- Use Athena for ad-hoc SQL queries across both

**Pros:**
- Minimal migration (no data movement)
- Pay-per-query pricing
- Good for infrequent analytical queries

**Cons:**
- No true JOINs (Athena federated queries are slow and limited)
- Still requires brand name normalization
- Query latency (seconds, not milliseconds)
- Complex to maintain two query patterns

**Pricing:** ~$5/TB scanned (could be $10-50/month depending on usage)

---

### Option 4: Amazon Redshift Serverless

**Pros:**
- Purpose-built for analytics
- Excellent for large-scale aggregations
- Native S3 data lake integration

**Cons:**
- Overkill for current data volume (~1GB)
- Higher cost floor ($0.50/RPU-hour, minimum ~$100/month active)
- Not ideal for transactional operations

---

## Recommendation: Aurora PostgreSQL

### Why Aurora PostgreSQL is the Best Fit

1. **True Relational Connections**: Foreign keys enforce data integrity and enable meaningful JOINs
2. **Right-Sized**: Handles your ~1GB of data efficiently, scales to 100GB+ easily
3. **JSONB for Flexibility**: Store brand mappings, metadata, and semi-structured data without schema changes
4. **Cost-Effective**: ~$75-90/month is comparable to current S3 + DynamoDB costs with heavy read/write
5. **Simpler Architecture**: One database instead of S3 + DynamoDB + mapping files
6. **Standard SQL**: Easier to query, maintain, and onboard new team members
7. **ACID Compliance**: Guaranteed consistency when updating brand mappings or uploading data

### Migration Plan

**Phase 1: Setup & Schema (Week 1)**
- Create Aurora PostgreSQL cluster
- Deploy schema with all tables and indexes
- Set up IAM roles and security groups

**Phase 2: Entity Resolution (Week 2)**
- Build brand alias resolution table from current mappings
- Build distributor alias table from vendor normalization map
- Create product catalog from invoice line items

**Phase 3: Historical Data Migration (Week 3)**
- Migrate DynamoDB invoices → `invoices` + `invoice_line_items`
- Migrate S3 sales CSVs → `daily_sales`
- Migrate S3 brand CSVs → `brand_sales`
- Migrate S3 customer CSVs → `customers`
- Migrate organizations/users from DynamoDB

**Phase 4: Application Updates (Week 4)**
- Update API routes to use PostgreSQL (can use Prisma or direct pg)
- Keep DynamoDB as read fallback during transition
- Update invoice crawler to write to PostgreSQL

**Phase 5: Validation & Cutover (Week 5)**
- Run parallel writes to both systems
- Validate data consistency
- Disable old data paths
- Decommission DynamoDB tables (keep S3 for PDF storage)

---

## New Queries Enabled After Migration

```sql
-- 1. True brand profitability: purchase cost vs. sales revenue
SELECT
    b.canonical_name AS brand,
    SUM(ili.total_cost) AS total_purchased,
    SUM(bs.net_sales) AS total_sold,
    SUM(bs.net_sales) - SUM(ili.total_cost) AS gross_profit,
    ROUND((SUM(bs.net_sales) - SUM(ili.total_cost)) / NULLIF(SUM(bs.net_sales), 0) * 100, 2) AS margin_pct
FROM brands b
JOIN invoice_line_items ili ON ili.product_id IN (
    SELECT product_id FROM products WHERE brand_id = b.brand_id
)
JOIN brand_sales bs ON bs.brand_id = b.brand_id
GROUP BY b.brand_id, b.canonical_name
ORDER BY gross_profit DESC;

-- 2. Distributor comparison: who gives best margins on products that sell?
SELECT
    d.canonical_name AS distributor,
    COUNT(DISTINCT i.invoice_id) AS invoice_count,
    SUM(ili.total_cost) AS total_purchased,
    AVG(ili.unit_cost) AS avg_unit_cost,
    COUNT(DISTINCT p.brand_id) AS unique_brands
FROM distributors d
JOIN invoices i ON i.distributor_id = d.distributor_id
JOIN invoice_line_items ili ON ili.invoice_id = i.invoice_id
JOIN products p ON p.product_id = ili.product_id
GROUP BY d.distributor_id, d.canonical_name
ORDER BY total_purchased DESC;

-- 3. Purchase-to-sale lag analysis
WITH purchase_dates AS (
    SELECT
        p.brand_id,
        MIN(i.invoice_date) AS first_purchase,
        MAX(i.invoice_date) AS last_purchase
    FROM invoice_line_items ili
    JOIN invoices i ON i.invoice_id = ili.invoice_id
    JOIN products p ON p.product_id = ili.product_id
    GROUP BY p.brand_id
),
sale_dates AS (
    SELECT
        brand_id,
        MIN(period_start) AS first_sale,
        MAX(period_end) AS last_sale
    FROM brand_sales
    GROUP BY brand_id
)
SELECT
    b.canonical_name,
    pd.first_purchase,
    sd.first_sale,
    sd.first_sale - pd.first_purchase AS days_to_first_sale
FROM brands b
JOIN purchase_dates pd ON pd.brand_id = b.brand_id
JOIN sale_dates sd ON sd.brand_id = b.brand_id;

-- 4. Products bought but never sold (dead inventory indicators)
SELECT
    b.canonical_name AS brand,
    p.product_name,
    SUM(ili.sku_units) AS units_purchased,
    SUM(ili.total_cost) AS cost_invested
FROM products p
JOIN brands b ON b.brand_id = p.brand_id
JOIN invoice_line_items ili ON ili.product_id = p.product_id
WHERE p.brand_id NOT IN (SELECT brand_id FROM brand_sales WHERE net_sales > 0)
GROUP BY b.canonical_name, p.product_name
ORDER BY cost_invested DESC;

-- 5. Customer segment preferences (requires product-level sales data)
-- This becomes possible if POS exports include brand/product details
```

---

## Data Accuracy Improvements

### 1. Brand Name Resolution System

```sql
-- Function to resolve any brand name to canonical
CREATE OR REPLACE FUNCTION resolve_brand(input_name TEXT)
RETURNS UUID AS $$
DECLARE
    resolved_id UUID;
BEGIN
    -- Try exact canonical match first
    SELECT brand_id INTO resolved_id
    FROM brands
    WHERE LOWER(canonical_name) = LOWER(TRIM(input_name));

    IF resolved_id IS NOT NULL THEN
        RETURN resolved_id;
    END IF;

    -- Try alias match
    SELECT brand_id INTO resolved_id
    FROM brand_aliases
    WHERE LOWER(alias_name) = LOWER(TRIM(input_name));

    RETURN resolved_id;  -- May be NULL if no match
END;
$$ LANGUAGE plpgsql;
```

### 2. Automated Alias Detection

When new invoices are imported, flag unmatched brand names for review:

```sql
CREATE TABLE brand_review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_name VARCHAR(255) NOT NULL,
    suggested_match UUID REFERENCES brands(brand_id),
    similarity_score DECIMAL(5,2),
    source_invoice_id UUID,
    reviewed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger on invoice import to queue unknown brands
CREATE OR REPLACE FUNCTION queue_unknown_brand()
RETURNS TRIGGER AS $$
BEGIN
    IF resolve_brand(NEW.brand) IS NULL THEN
        INSERT INTO brand_review_queue (raw_name, source_invoice_id)
        VALUES (NEW.brand, NEW.invoice_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 3. Distributor Normalization

The current 798-variant vendor mapping becomes a database lookup:

```sql
-- Import existing mappings
INSERT INTO distributor_aliases (distributor_id, alias_name)
SELECT d.distributor_id, v.variant_name
FROM (VALUES
    ('NABITWO LLC'), ('NABIS 2.0 LLC'), ('NABIS TWO LLC'),
    -- ... all 798 variants
) AS v(variant_name)
CROSS JOIN distributors d
WHERE d.canonical_name = 'Nabis';
```

---

## Cost Comparison

| Component | Current (Monthly) | After Migration (Monthly) |
|-----------|-------------------|---------------------------|
| S3 Storage | ~$2 | ~$2 (keep for PDFs) |
| S3 Requests | ~$5 | ~$1 (reduced reads) |
| DynamoDB RCU/WCU | ~$25-50 | $0 (decommissioned) |
| DynamoDB Storage | ~$5 | $0 |
| Aurora PostgreSQL | $0 | ~$75-90 |
| **Total** | **~$37-62** | **~$78-93** |

**Net increase:** ~$30-40/month

**Value gained:**
- True relational queries (purchase ↔ sales)
- Automated brand/vendor resolution
- Simpler codebase (one data source)
- Standard SQL (easier maintenance)
- Foundation for advanced analytics

---

## Next Steps

1. **Confirm migration approach** - Aurora PostgreSQL vs. alternatives
2. **Refine schema** - Review entity relationships with business requirements
3. **Build migration scripts** - Python ETL for DynamoDB → PostgreSQL
4. **Update API layer** - Decide on ORM (Prisma, Drizzle, or raw SQL)
5. **Test with subset** - Migrate one month of data first
6. **Full migration** - Execute with parallel writes for validation

---

## Appendix: Current Data Files Reference

### S3 Paths (Active)
- `s3://retail-data-bcgr/raw-uploads/grass_roots/sales_*.csv`
- `s3://retail-data-bcgr/raw-uploads/barbary_coast/sales_*.csv`
- `s3://retail-data-bcgr/config/brand_product_mapping.json`

### DynamoDB Tables (Active)
- `retail-invoices` (us-west-1)
- `retail-invoice-line-items` (us-west-1)
- `chapters-organizations` (us-west-1)
- `chapters-storefronts` (us-west-1)
- `chapters-user-mappings` (us-west-1)

### Local PDF Storage
- `/invoice-crawler/invoices/` (Barbary Coast)
- `/invoice-crawler/gr-invoices/` (Grass Roots)
