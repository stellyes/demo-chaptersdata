-- CreateTable: compliance_rules
CREATE TABLE IF NOT EXISTS "compliance_rules" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "rule_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "compliance_area" TEXT NOT NULL,
    "product_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rule_type" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "enforced_by" TEXT,
    "penalty" TEXT,
    "citations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_document_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "effective_date" TIMESTAMP(3),
    "expiration_date" TIMESTAMP(3),
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_verified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_rules_rule_id_key" ON "compliance_rules"("rule_id");
CREATE INDEX IF NOT EXISTS "compliance_rules_jurisdiction_idx" ON "compliance_rules"("jurisdiction");
CREATE INDEX IF NOT EXISTS "compliance_rules_compliance_area_idx" ON "compliance_rules"("compliance_area");
CREATE INDEX IF NOT EXISTS "compliance_rules_is_active_idx" ON "compliance_rules"("is_active");

-- CreateTable: compliance_scans
CREATE TABLE IF NOT EXISTS "compliance_scans" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "storefront_id" TEXT,
    "scan_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "records_scanned" INTEGER NOT NULL DEFAULT 0,
    "risks_found" INTEGER NOT NULL DEFAULT 0,
    "critical_risks" INTEGER NOT NULL DEFAULT 0,
    "high_risks" INTEGER NOT NULL DEFAULT 0,
    "scan_metadata" JSONB,
    "s3_results_path" TEXT,

    CONSTRAINT "compliance_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "compliance_scans_storefront_id_idx" ON "compliance_scans"("storefront_id");
CREATE INDEX IF NOT EXISTS "compliance_scans_started_at_idx" ON "compliance_scans"("started_at");

-- CreateTable: compliance_alerts
CREATE TABLE IF NOT EXISTS "compliance_alerts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "scan_id" TEXT NOT NULL,
    "storefront_id" TEXT,
    "rule_id" TEXT,
    "risk_level" TEXT NOT NULL,
    "risk_score" DOUBLE PRECISION NOT NULL,
    "detection_method" TEXT NOT NULL,
    "violation" TEXT NOT NULL,
    "sales_line_item_id" TEXT,
    "product_name" TEXT,
    "product_type" TEXT,
    "field" TEXT,
    "actual_value" TEXT,
    "limit_value" TEXT,
    "recommendation" TEXT,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolved_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "compliance_alerts_scan_id_idx" ON "compliance_alerts"("scan_id");
CREATE INDEX IF NOT EXISTS "compliance_alerts_storefront_id_idx" ON "compliance_alerts"("storefront_id");
CREATE INDEX IF NOT EXISTS "compliance_alerts_risk_level_idx" ON "compliance_alerts"("risk_level");
CREATE INDEX IF NOT EXISTS "compliance_alerts_is_resolved_idx" ON "compliance_alerts"("is_resolved");
CREATE INDEX IF NOT EXISTS "compliance_alerts_created_at_idx" ON "compliance_alerts"("created_at");

-- AddForeignKey
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "compliance_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: compliance_rule_versions
CREATE TABLE IF NOT EXISTS "compliance_rule_versions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_date" TIMESTAMP(3) NOT NULL,
    "s3_path" TEXT NOT NULL,
    "total_rules" INTEGER NOT NULL,
    "jurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_corpus_size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "compliance_rule_versions_snapshot_date_idx" ON "compliance_rule_versions"("snapshot_date");
