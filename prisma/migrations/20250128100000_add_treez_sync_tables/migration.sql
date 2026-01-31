-- CreateTable: products (Treez Product Catalog)
CREATE TABLE IF NOT EXISTS "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "treez_product_id" TEXT NOT NULL,
    "storefront_id" TEXT,
    "brand_id" TEXT,
    "original_brand_name" TEXT,
    "product_name" TEXT NOT NULL,
    "product_type" TEXT,
    "product_subtype" TEXT,
    "category" TEXT,
    "strain" TEXT,
    "unit_size" TEXT,
    "thc_content" DECIMAL(6,3),
    "cbd_content" DECIMAL(6,3),
    "retail_price" DECIMAL(10,2),
    "wholesale_price" DECIMAL(10,2),
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable: metrc_packages (METRC Inventory)
CREATE TABLE IF NOT EXISTS "metrc_packages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "metrc_label" TEXT NOT NULL,
    "storefront_id" TEXT,
    "item_name" TEXT,
    "product_category" TEXT,
    "quantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "unit_of_measure" TEXT,
    "package_status" TEXT,
    "source_harvest_name" TEXT,
    "lab_test_state" TEXT,
    "lab_test_passed" BOOLEAN,
    "received_from_facility" TEXT,
    "received_date_time" TIMESTAMP(3),
    "packaged_date" DATE,
    "last_modified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrc_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable: metrc_transfers (METRC Transfers)
CREATE TABLE IF NOT EXISTS "metrc_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "metrc_transfer_id" INTEGER NOT NULL,
    "storefront_id" TEXT,
    "manifest_number" TEXT,
    "transfer_type" TEXT,
    "shipper_facility" TEXT,
    "shipper_license" TEXT,
    "recipient_facility" TEXT,
    "recipient_license" TEXT,
    "created_date_time" TIMESTAMP(3),
    "received_date_time" TIMESTAMP(3),
    "package_count" INTEGER NOT NULL DEFAULT 0,
    "total_quantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "last_modified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrc_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: data_flags (Data Discrepancy Flags)
CREATE TABLE IF NOT EXISTS "data_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storefront_id" TEXT,
    "flag_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source_table" TEXT NOT NULL,
    "source_record_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "raw_value" TEXT,
    "suggested_match" TEXT,
    "suggested_match_id" TEXT,
    "similarity_score" DECIMAL(5,4),
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "resolution" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "products_treez_product_id_key" ON "products"("treez_product_id");
CREATE INDEX IF NOT EXISTS "products_brand_id_idx" ON "products"("brand_id");
CREATE INDEX IF NOT EXISTS "products_product_type_idx" ON "products"("product_type");
CREATE INDEX IF NOT EXISTS "products_is_active_idx" ON "products"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "metrc_packages_metrc_label_key" ON "metrc_packages"("metrc_label");
CREATE INDEX IF NOT EXISTS "metrc_packages_package_status_idx" ON "metrc_packages"("package_status");
CREATE INDEX IF NOT EXISTS "metrc_packages_product_category_idx" ON "metrc_packages"("product_category");
CREATE INDEX IF NOT EXISTS "metrc_packages_last_modified_at_idx" ON "metrc_packages"("last_modified_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "metrc_transfers_metrc_transfer_id_key" ON "metrc_transfers"("metrc_transfer_id");
CREATE INDEX IF NOT EXISTS "metrc_transfers_transfer_type_idx" ON "metrc_transfers"("transfer_type");
CREATE INDEX IF NOT EXISTS "metrc_transfers_manifest_number_idx" ON "metrc_transfers"("manifest_number");
CREATE INDEX IF NOT EXISTS "metrc_transfers_last_modified_at_idx" ON "metrc_transfers"("last_modified_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "data_flags_flag_type_idx" ON "data_flags"("flag_type");
CREATE INDEX IF NOT EXISTS "data_flags_severity_idx" ON "data_flags"("severity");
CREATE INDEX IF NOT EXISTS "data_flags_status_idx" ON "data_flags"("status");
CREATE INDEX IF NOT EXISTS "data_flags_source_table_idx" ON "data_flags"("source_table");
CREATE INDEX IF NOT EXISTS "data_flags_created_at_idx" ON "data_flags"("created_at");

-- AddForeignKey (if storefronts exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'storefronts') THEN
        -- products -> storefronts
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_storefront_id_fkey') THEN
            ALTER TABLE "products" ADD CONSTRAINT "products_storefront_id_fkey"
            FOREIGN KEY ("storefront_id") REFERENCES "storefronts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        -- metrc_packages -> storefronts
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metrc_packages_storefront_id_fkey') THEN
            ALTER TABLE "metrc_packages" ADD CONSTRAINT "metrc_packages_storefront_id_fkey"
            FOREIGN KEY ("storefront_id") REFERENCES "storefronts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        -- metrc_transfers -> storefronts
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metrc_transfers_storefront_id_fkey') THEN
            ALTER TABLE "metrc_transfers" ADD CONSTRAINT "metrc_transfers_storefront_id_fkey"
            FOREIGN KEY ("storefront_id") REFERENCES "storefronts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        -- data_flags -> storefronts
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_flags_storefront_id_fkey') THEN
            ALTER TABLE "data_flags" ADD CONSTRAINT "data_flags_storefront_id_fkey"
            FOREIGN KEY ("storefront_id") REFERENCES "storefronts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
    END IF;
END $$;

-- AddForeignKey products -> canonical_brands
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'canonical_brands') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_brand_id_fkey') THEN
            ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey"
            FOREIGN KEY ("brand_id") REFERENCES "canonical_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
    END IF;
END $$;

-- Create function for fuzzy string matching (for vendor/brand normalization)
CREATE OR REPLACE FUNCTION similarity_score(str1 TEXT, str2 TEXT)
RETURNS DECIMAL(5,4) AS $$
DECLARE
    s1 TEXT;
    s2 TEXT;
    len1 INTEGER;
    len2 INTEGER;
    max_len INTEGER;
    common_chars INTEGER := 0;
    i INTEGER;
BEGIN
    -- Normalize strings
    s1 := LOWER(TRIM(REGEXP_REPLACE(str1, '[^a-zA-Z0-9]', '', 'g')));
    s2 := LOWER(TRIM(REGEXP_REPLACE(str2, '[^a-zA-Z0-9]', '', 'g')));

    IF s1 = s2 THEN
        RETURN 1.0;
    END IF;

    len1 := LENGTH(s1);
    len2 := LENGTH(s2);
    max_len := GREATEST(len1, len2);

    IF max_len = 0 THEN
        RETURN 0.0;
    END IF;

    -- Simple Jaccard-like similarity based on character overlap
    FOR i IN 1..len1 LOOP
        IF POSITION(SUBSTRING(s1 FROM i FOR 1) IN s2) > 0 THEN
            common_chars := common_chars + 1;
        END IF;
    END LOOP;

    RETURN ROUND(common_chars::DECIMAL / max_len::DECIMAL, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function to resolve vendor name to canonical vendor ID
CREATE OR REPLACE FUNCTION resolve_vendor(input_name TEXT)
RETURNS UUID AS $$
DECLARE
    resolved_id UUID;
BEGIN
    -- Try exact canonical match first
    SELECT id INTO resolved_id
    FROM vendors
    WHERE LOWER(canonical_name) = LOWER(TRIM(input_name));

    IF resolved_id IS NOT NULL THEN
        RETURN resolved_id;
    END IF;

    -- Try alias match
    SELECT vendor_id INTO resolved_id
    FROM vendor_aliases
    WHERE LOWER(alias_name) = LOWER(TRIM(input_name));

    RETURN resolved_id;  -- May be NULL if no match
END;
$$ LANGUAGE plpgsql;

-- Create function to resolve brand name to canonical brand ID
CREATE OR REPLACE FUNCTION resolve_brand(input_name TEXT)
RETURNS UUID AS $$
DECLARE
    resolved_id UUID;
BEGIN
    -- Try exact canonical match first
    SELECT id INTO resolved_id
    FROM canonical_brands
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

-- Create function to find best vendor match with similarity score
CREATE OR REPLACE FUNCTION find_best_vendor_match(input_name TEXT, min_score DECIMAL DEFAULT 0.7)
RETURNS TABLE(vendor_id UUID, canonical_name TEXT, match_score DECIMAL) AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id,
        v.canonical_name,
        GREATEST(
            similarity_score(input_name, v.canonical_name),
            COALESCE((
                SELECT MAX(similarity_score(input_name, va.alias_name))
                FROM vendor_aliases va
                WHERE va.vendor_id = v.id
            ), 0)
        ) as score
    FROM vendors v
    WHERE GREATEST(
        similarity_score(input_name, v.canonical_name),
        COALESCE((
            SELECT MAX(similarity_score(input_name, va.alias_name))
            FROM vendor_aliases va
            WHERE va.vendor_id = v.id
        ), 0)
    ) >= min_score
    ORDER BY score DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- Create function to find best brand match with similarity score
CREATE OR REPLACE FUNCTION find_best_brand_match(input_name TEXT, min_score DECIMAL DEFAULT 0.7)
RETURNS TABLE(brand_id UUID, canonical_name TEXT, match_score DECIMAL) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.canonical_name,
        GREATEST(
            similarity_score(input_name, b.canonical_name),
            COALESCE((
                SELECT MAX(similarity_score(input_name, ba.alias_name))
                FROM brand_aliases ba
                WHERE ba.brand_id = b.id
            ), 0)
        ) as score
    FROM canonical_brands b
    WHERE GREATEST(
        similarity_score(input_name, b.canonical_name),
        COALESCE((
            SELECT MAX(similarity_score(input_name, ba.alias_name))
            FROM brand_aliases ba
            WHERE ba.brand_id = b.id
        ), 0)
    ) >= min_score
    ORDER BY score DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;
