/**
 * Data Coverage Audit Script
 *
 * Audits Aurora PostgreSQL for data completeness across both stores
 * (Grass Roots and Barbary Coast) up to today's date.
 *
 * Usage:
 *   cd chapters-bcsf-app && npx tsx scripts/audit-data-coverage.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: '.env.local' });

const prisma = new PrismaClient();

const TODAY = new Date('2026-03-25');
const STORES = ['Barbary Coast - SF Mission', 'Grass Roots - SF'];
const STORE_IDS = ['barbary_coast', 'grass_roots'];

interface DateGap {
  start: string;
  end: string;
  days: number;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function findDateGaps(dates: string[], startDate: string, endDate: string): DateGap[] {
  const dateSet = new Set(dates);
  const gaps: DateGap[] = [];
  let gapStart: string | null = null;

  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const dateStr = formatDate(current);
    if (!dateSet.has(dateStr)) {
      if (!gapStart) gapStart = dateStr;
    } else {
      if (gapStart) {
        const prev = new Date(current);
        prev.setDate(prev.getDate() - 1);
        const days = Math.round((prev.getTime() - new Date(gapStart).getTime()) / 86400000) + 1;
        gaps.push({ start: gapStart, end: formatDate(prev), days });
        gapStart = null;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  if (gapStart) {
    const days = Math.round((end.getTime() - new Date(gapStart).getTime()) / 86400000) + 1;
    gaps.push({ start: gapStart, end: formatDate(end), days });
  }

  return gaps;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          CHAPTERS DATA COVERAGE AUDIT                   ║');
  console.log('║          Date: 2026-03-25                               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ─── 1. SALES LINE ITEMS (daily Treez exports) ───
  console.log('═══════════════════════════════════════════');
  console.log('  1. SALES LINE ITEMS (Treez Daily Data)');
  console.log('═══════════════════════════════════════════\n');

  for (const store of STORES) {
    const totalCount = await prisma.salesLineItem.count({
      where: { storeName: store },
    });

    const dateRange: any[] = await prisma.$queryRaw`
      SELECT
        MIN(date_open)::text as min_date,
        MAX(date_open)::text as max_date,
        COUNT(DISTINCT date_open::date)::int as unique_dates,
        COUNT(DISTINCT ticket_id)::int as unique_tickets,
        COUNT(DISTINCT customer_treez_id)::int as unique_customers,
        COUNT(DISTINCT original_brand_name)::int as unique_brands,
        COUNT(DISTINCT product_type)::int as unique_product_types,
        SUM(net_sales)::float as total_net_sales,
        SUM(gross_sales)::float as total_gross_sales,
        SUM(discounts)::float as total_discounts,
        SUM(returns)::float as total_returns,
        SUM(taxes)::float as total_taxes
      FROM sales_line_items
      WHERE store_name = ${store}
    `;

    const r = dateRange[0];
    console.log(`  📍 ${store}`);
    console.log(`     Total line items:    ${totalCount.toLocaleString()}`);
    console.log(`     Date range:          ${r.min_date?.split('T')[0] || 'N/A'} → ${r.max_date?.split('T')[0] || 'N/A'}`);
    console.log(`     Unique dates:        ${r.unique_dates || 0}`);
    console.log(`     Unique tickets:      ${(r.unique_tickets || 0).toLocaleString()}`);
    console.log(`     Unique customers:    ${(r.unique_customers || 0).toLocaleString()}`);
    console.log(`     Unique brands:       ${r.unique_brands || 0}`);
    console.log(`     Unique product types: ${r.unique_product_types || 0}`);
    console.log(`     Total gross sales:   $${(r.total_gross_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`     Total net sales:     $${(r.total_net_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`     Total discounts:     $${(r.total_discounts || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`     Total returns:       $${(r.total_returns || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`     Total taxes:         $${(r.total_taxes || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    // Find date gaps
    if (r.min_date) {
      const allDates: any[] = await prisma.$queryRaw`
        SELECT DISTINCT date_open::date::text as d
        FROM sales_line_items
        WHERE store_name = ${store}
        ORDER BY d
      `;
      const dateStrings = allDates.map(row => row.d);
      const gaps = findDateGaps(dateStrings, r.min_date.split('T')[0], formatDate(TODAY));

      if (gaps.length > 0) {
        console.log(`     ⚠️  DATE GAPS (${gaps.length} gaps, ${gaps.reduce((s, g) => s + g.days, 0)} total missing days):`);
        for (const gap of gaps) {
          const label = gap.days === 1 ? `${gap.start}` : `${gap.start} → ${gap.end} (${gap.days} days)`;
          console.log(`        - ${label}`);
        }
      } else {
        console.log(`     ✅ No date gaps found`);
      }
    }
    console.log('');
  }

  // ─── 2. SALES RECORDS (aggregated daily summaries) ───
  console.log('═══════════════════════════════════════════');
  console.log('  2. SALES RECORDS (Aggregated Summaries)');
  console.log('═══════════════════════════════════════════\n');

  for (const storeId of STORE_IDS) {
    const totalCount = await prisma.salesRecord.count({
      where: { storeId },
    });

    const dateRange: any[] = await prisma.$queryRaw`
      SELECT
        MIN(date)::text as min_date,
        MAX(date)::text as max_date,
        COUNT(DISTINCT date)::int as unique_dates,
        SUM(net_sales)::float as total_net_sales,
        SUM(gross_sales)::float as total_gross_sales,
        AVG(avg_basket_size)::float as avg_basket,
        AVG(avg_order_value)::float as avg_order_val,
        SUM(tickets_count)::int as total_tickets,
        SUM(units_sold)::int as total_units,
        SUM(customers_count)::int as total_customers_sum
      FROM sales_records
      WHERE store_id = ${storeId}
    `;

    const r = dateRange[0];
    const label = storeId === 'barbary_coast' ? 'Barbary Coast' : 'Grass Roots';
    console.log(`  📍 ${label} (${storeId})`);
    console.log(`     Total records:       ${totalCount.toLocaleString()}`);
    console.log(`     Date range:          ${r.min_date?.split('T')[0] || 'N/A'} → ${r.max_date?.split('T')[0] || 'N/A'}`);
    console.log(`     Unique dates:        ${r.unique_dates || 0}`);
    console.log(`     Total tickets:       ${(r.total_tickets || 0).toLocaleString()}`);
    console.log(`     Total units:         ${(r.total_units || 0).toLocaleString()}`);
    console.log(`     Total gross sales:   $${(r.total_gross_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`     Total net sales:     $${(r.total_net_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`     Avg basket size:     ${(r.avg_basket || 0).toFixed(2)}`);
    console.log(`     Avg order value:     $${(r.avg_order_val || 0).toFixed(2)}`);

    // Find date gaps
    if (r.min_date) {
      const allDates: any[] = await prisma.$queryRaw`
        SELECT DISTINCT date::date::text as d
        FROM sales_records
        WHERE store_id = ${storeId}
        ORDER BY d
      `;
      const dateStrings = allDates.map(row => row.d);
      const gaps = findDateGaps(dateStrings, r.min_date.split('T')[0], formatDate(TODAY));

      if (gaps.length > 0) {
        console.log(`     ⚠️  DATE GAPS (${gaps.length} gaps, ${gaps.reduce((s, g) => s + g.days, 0)} total missing days):`);
        for (const gap of gaps) {
          const label = gap.days === 1 ? `${gap.start}` : `${gap.start} → ${gap.end} (${gap.days} days)`;
          console.log(`        - ${label}`);
        }
      } else {
        console.log(`     ✅ No date gaps found`);
      }
    }
    console.log('');
  }

  // ─── 3. BRAND RECORDS ───
  console.log('═══════════════════════════════════════════');
  console.log('  3. BRAND RECORDS');
  console.log('═══════════════════════════════════════════\n');

  for (const storeId of STORE_IDS) {
    const totalCount = await prisma.brandRecord.count({
      where: { storeId },
    });

    const dateRange: any[] = await prisma.$queryRaw`
      SELECT
        MIN(upload_start_date)::text as min_start,
        MAX(upload_end_date)::text as max_end,
        COUNT(DISTINCT original_brand_name)::int as unique_brands,
        SUM(net_sales)::float as total_net_sales
      FROM brand_records
      WHERE store_id = ${storeId}
    `;

    const r = dateRange[0];
    const label = storeId === 'barbary_coast' ? 'Barbary Coast' : 'Grass Roots';
    console.log(`  📍 ${label} (${storeId})`);
    console.log(`     Total records:       ${totalCount.toLocaleString()}`);
    console.log(`     Date range:          ${r.min_start?.split('T')[0] || 'N/A'} → ${r.max_end?.split('T')[0] || 'N/A'}`);
    console.log(`     Unique brands:       ${r.unique_brands || 0}`);
    console.log(`     Total net sales:     $${(r.total_net_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');
  }

  // ─── 4. PRODUCT RECORDS ───
  console.log('═══════════════════════════════════════════');
  console.log('  4. PRODUCT RECORDS');
  console.log('═══════════════════════════════════════════\n');

  for (const storeId of STORE_IDS) {
    const totalCount = await prisma.productRecord.count({
      where: { storeId },
    });

    const dateRange: any[] = await prisma.$queryRaw`
      SELECT
        MIN(upload_start_date)::text as min_start,
        MAX(upload_end_date)::text as max_end,
        COUNT(DISTINCT product_type)::int as unique_types,
        SUM(net_sales)::float as total_net_sales
      FROM product_records
      WHERE store_id = ${storeId}
    `;

    const r = dateRange[0];
    const label = storeId === 'barbary_coast' ? 'Barbary Coast' : 'Grass Roots';
    console.log(`  📍 ${label} (${storeId})`);
    console.log(`     Total records:       ${totalCount.toLocaleString()}`);
    console.log(`     Date range:          ${r.min_start?.split('T')[0] || 'N/A'} → ${r.max_end?.split('T')[0] || 'N/A'}`);
    console.log(`     Unique product types: ${r.unique_types || 0}`);
    console.log(`     Total net sales:     $${(r.total_net_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');
  }

  // ─── 5. CUSTOMERS ───
  console.log('═══════════════════════════════════════════');
  console.log('  5. CUSTOMERS');
  console.log('═══════════════════════════════════════════\n');

  const customerStats: any[] = await prisma.$queryRaw`
    SELECT
      store_name,
      COUNT(*)::int as total,
      COUNT(DISTINCT customer_segment)::int as segments,
      SUM(lifetime_net_sales)::float as total_ltv,
      AVG(lifetime_net_sales)::float as avg_ltv,
      AVG(lifetime_visits)::float as avg_visits,
      MIN(signup_date)::text as earliest_signup,
      MAX(last_visit_date)::text as latest_visit
    FROM customers
    GROUP BY store_name
    ORDER BY store_name
  `;

  for (const r of customerStats) {
    console.log(`  📍 ${r.store_name}`);
    console.log(`     Total customers:     ${(r.total || 0).toLocaleString()}`);
    console.log(`     Total LTV:           $${(r.total_ltv || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`     Avg LTV:             $${(r.avg_ltv || 0).toFixed(2)}`);
    console.log(`     Avg visits:          ${(r.avg_visits || 0).toFixed(1)}`);
    console.log(`     Earliest signup:     ${r.earliest_signup?.split('T')[0] || 'N/A'}`);
    console.log(`     Latest visit:        ${r.latest_visit?.split('T')[0] || 'N/A'}`);
    console.log('');
  }

  // ─── 6. INVOICES (Purchasing/Vendor Side) ───
  console.log('═══════════════════════════════════════════');
  console.log('  6. INVOICES & LINE ITEMS (Purchasing)');
  console.log('═══════════════════════════════════════════\n');

  const invoiceCount = await prisma.invoice.count();
  const lineItemCount = await prisma.invoiceLineItem.count();

  const invoiceStats: any[] = await prisma.$queryRaw`
    SELECT
      MIN(invoice_date)::text as min_date,
      MAX(invoice_date)::text as max_date,
      COUNT(DISTINCT storefront_id)::int as unique_stores,
      COUNT(DISTINCT original_vendor_name)::int as unique_vendors,
      SUM(total_cost)::float as total_cost,
      SUM(total_with_excise)::float as total_with_excise
    FROM invoices
  `;

  const lineItemStats: any[] = await prisma.$queryRaw`
    SELECT
      COUNT(DISTINCT brand_id)::int as brands_linked,
      COUNT(CASE WHEN brand_id IS NULL THEN 1 END)::int as brands_unlinked,
      SUM(total_cost)::float as total_cost
    FROM invoice_line_items
  `;

  const ir = invoiceStats[0];
  const lr = lineItemStats[0];
  console.log(`  Total invoices:       ${invoiceCount.toLocaleString()}`);
  console.log(`  Total line items:     ${lineItemCount.toLocaleString()}`);
  console.log(`  Date range:           ${ir.min_date?.split('T')[0] || 'N/A'} → ${ir.max_date?.split('T')[0] || 'N/A'}`);
  console.log(`  Unique storefronts:   ${ir.unique_stores || 0}`);
  console.log(`  Unique vendors:       ${ir.unique_vendors || 0}`);
  console.log(`  Total cost:           $${(ir.total_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Total w/ excise:      $${(ir.total_with_excise || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Line items w/ brand:  ${(lr.brands_linked || 0).toLocaleString()} linked`);
  console.log(`  Line items no brand:  ${(lr.brands_unlinked || 0).toLocaleString()} unlinked`);
  console.log(`  LI total cost:        $${(lr.total_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');

  // ─── 7. VENDOR/BRAND NORMALIZATION ───
  console.log('═══════════════════════════════════════════');
  console.log('  7. VENDOR & BRAND NORMALIZATION');
  console.log('═══════════════════════════════════════════\n');

  const vendorCount = await prisma.vendor.count();
  const vendorAliasCount = await prisma.vendorAlias.count();
  const canonicalBrandCount = await prisma.canonicalBrand.count();
  const brandAliasCount = await prisma.brandAlias.count();
  const vendorBrandCount = await prisma.vendorBrand.count();

  console.log(`  Canonical vendors:    ${vendorCount}`);
  console.log(`  Vendor aliases:       ${vendorAliasCount}`);
  console.log(`  Canonical brands:     ${canonicalBrandCount}`);
  console.log(`  Brand aliases:        ${brandAliasCount}`);
  console.log(`  Vendor-brand links:   ${vendorBrandCount}`);
  console.log('');

  // ─── 8. PRODUCTS (Treez catalog) ───
  console.log('═══════════════════════════════════════════');
  console.log('  8. PRODUCT CATALOG (Treez Sync)');
  console.log('═══════════════════════════════════════════\n');

  const productCount = await prisma.product.count();
  const productStats: any[] = await prisma.$queryRaw`
    SELECT
      COUNT(DISTINCT original_brand_name)::int as brands,
      COUNT(DISTINCT product_type)::int as types,
      COUNT(DISTINCT product_subtype)::int as subtypes,
      COUNT(CASE WHEN is_active THEN 1 END)::int as active,
      COUNT(CASE WHEN NOT is_active THEN 1 END)::int as inactive,
      MIN(last_synced_at)::text as oldest_sync,
      MAX(last_synced_at)::text as newest_sync
    FROM products
  `;

  const pr = productStats[0];
  console.log(`  Total products:       ${productCount.toLocaleString()}`);
  console.log(`  Unique brands:        ${pr.brands || 0}`);
  console.log(`  Unique types:         ${pr.types || 0}`);
  console.log(`  Unique subtypes:      ${pr.subtypes || 0}`);
  console.log(`  Active:               ${(pr.active || 0).toLocaleString()}`);
  console.log(`  Inactive:             ${(pr.inactive || 0).toLocaleString()}`);
  console.log(`  Sync range:           ${pr.oldest_sync?.split('T')[0] || 'N/A'} → ${pr.newest_sync?.split('T')[0] || 'N/A'}`);
  console.log('');

  // ─── 9. BUDTENDER RECORDS ───
  console.log('═══════════════════════════════════════════');
  console.log('  9. BUDTENDER RECORDS');
  console.log('═══════════════════════════════════════════\n');

  for (const storeId of STORE_IDS) {
    const count = await prisma.budtenderRecord.count({
      where: { storeId },
    });

    const stats: any[] = await prisma.$queryRaw`
      SELECT
        MIN(date)::text as min_date,
        MAX(date)::text as max_date,
        COUNT(DISTINCT employee_name)::int as unique_budtenders,
        SUM(net_sales)::float as total_net_sales
      FROM budtender_records
      WHERE store_id = ${storeId}
    `;

    const s = stats[0];
    const label = storeId === 'barbary_coast' ? 'Barbary Coast' : 'Grass Roots';
    console.log(`  📍 ${label}`);
    console.log(`     Total records:       ${count.toLocaleString()}`);
    console.log(`     Date range:          ${s.min_date?.split('T')[0] || 'N/A'} → ${s.max_date?.split('T')[0] || 'N/A'}`);
    console.log(`     Unique budtenders:   ${s.unique_budtenders || 0}`);
    console.log(`     Total net sales:     $${(s.total_net_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');
  }

  // ─── 10. DAILY PRODUCT SALES ───
  console.log('═══════════════════════════════════════════');
  console.log('  10. DAILY PRODUCT SALES');
  console.log('═══════════════════════════════════════════\n');

  const dpsCount = await prisma.dailyProductSale.count();
  if (dpsCount > 0) {
    const dpsStats: any[] = await prisma.$queryRaw`
      SELECT
        store_name,
        MIN(date)::text as min_date,
        MAX(date)::text as max_date,
        COUNT(*)::int as records,
        COUNT(DISTINCT date)::int as unique_dates,
        SUM(net_sales)::float as total_net_sales
      FROM daily_product_sales
      GROUP BY store_name
      ORDER BY store_name
    `;
    for (const s of dpsStats) {
      console.log(`  📍 ${s.store_name || 'Unknown'}`);
      console.log(`     Records: ${s.records.toLocaleString()}, Dates: ${s.unique_dates}`);
      console.log(`     Range: ${s.min_date?.split('T')[0]} → ${s.max_date?.split('T')[0]}`);
      console.log(`     Net sales: $${(s.total_net_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      console.log('');
    }
  } else {
    console.log('  No daily product sales records found.\n');
  }

  // ─── 11. AI/LEARNING DATA ───
  console.log('═══════════════════════════════════════════');
  console.log('  11. AI & LEARNING PIPELINE DATA');
  console.log('═══════════════════════════════════════════\n');

  const dailyJobCount = await prisma.dailyLearningJob.count();
  const digestCount = await prisma.dailyDigest.count();
  const monthlyJobCount = await prisma.monthlyAnalysisJob.count();
  const monthlyReportCount = await prisma.monthlyStrategicReport.count();
  const insightCount = await prisma.businessInsight.count();
  const questionCount = await prisma.learningQuestion.count();

  console.log(`  Daily learning jobs:   ${dailyJobCount}`);
  console.log(`  Daily digests:         ${digestCount}`);
  console.log(`  Monthly analysis jobs: ${monthlyJobCount}`);
  console.log(`  Monthly reports:       ${monthlyReportCount}`);
  console.log(`  Business insights:     ${insightCount}`);
  console.log(`  Learning questions:    ${questionCount}`);
  console.log('');

  // ─── 12. CROSS-TABLE KEY MAPPING ───
  console.log('═══════════════════════════════════════════');
  console.log('  12. SHARED KEYS & CROSS-TABLE LINKS');
  console.log('═══════════════════════════════════════════\n');

  // Check how line items connect to other tables
  const lineItemBrandCoverage: any[] = await prisma.$queryRaw`
    SELECT
      COUNT(DISTINCT sli.original_brand_name)::int as total_brands_in_sales,
      COUNT(DISTINCT ba.brand_id)::int as matched_to_canonical,
      COUNT(DISTINCT CASE WHEN ba.id IS NULL THEN sli.original_brand_name END)::int as unmatched_brands
    FROM (
      SELECT DISTINCT original_brand_name
      FROM sales_line_items
      WHERE original_brand_name IS NOT NULL
    ) sli
    LEFT JOIN brand_aliases ba ON UPPER(sli.original_brand_name) = UPPER(ba.alias_name)
  `;

  const bc = lineItemBrandCoverage[0];
  console.log('  Brand Resolution (sales_line_items → canonical_brands):');
  console.log(`     Total unique brands in sales: ${bc.total_brands_in_sales}`);
  console.log(`     Matched to canonical:         ${bc.matched_to_canonical}`);
  console.log(`     Unmatched (unmapped):         ${bc.unmatched_brands}`);
  console.log(`     Coverage:                     ${bc.total_brands_in_sales > 0 ? ((1 - bc.unmatched_brands / bc.total_brands_in_sales) * 100).toFixed(1) : 0}%`);
  console.log('');

  // Customer overlap between line items and customer table
  const customerOverlap: any[] = await prisma.$queryRaw`
    SELECT
      (SELECT COUNT(DISTINCT customer_treez_id) FROM sales_line_items WHERE customer_treez_id IS NOT NULL)::int as line_item_customers,
      (SELECT COUNT(*) FROM customers)::int as customer_table_count
  `;

  const co = customerOverlap[0];
  console.log('  Customer Linkage (sales_line_items → customers):');
  console.log(`     Unique customer IDs in sales:   ${(co.line_item_customers || 0).toLocaleString()}`);
  console.log(`     Customer table records:          ${(co.customer_table_count || 0).toLocaleString()}`);
  console.log('');

  // Invoice-brand connection
  const invoiceBrandLink: any[] = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int as total_line_items,
      COUNT(CASE WHEN brand_id IS NOT NULL THEN 1 END)::int as linked,
      COUNT(CASE WHEN brand_id IS NULL THEN 1 END)::int as unlinked
    FROM invoice_line_items
  `;

  const ib = invoiceBrandLink[0];
  console.log('  Invoice-Brand Linkage (invoice_line_items → canonical_brands):');
  console.log(`     Total line items:  ${(ib.total_line_items || 0).toLocaleString()}`);
  console.log(`     Linked to brand:   ${(ib.linked || 0).toLocaleString()}`);
  console.log(`     Unlinked:          ${(ib.unlinked || 0).toLocaleString()}`);
  console.log(`     Coverage:          ${ib.total_line_items > 0 ? ((ib.linked / ib.total_line_items) * 100).toFixed(1) : 0}%`);
  console.log('');

  // ─── 13. DATA FLAGS (quality issues) ───
  console.log('═══════════════════════════════════════════');
  console.log('  13. DATA QUALITY FLAGS');
  console.log('═══════════════════════════════════════════\n');

  const flagStats: any[] = await prisma.$queryRaw`
    SELECT
      flag_type,
      severity,
      status,
      COUNT(*)::int as count
    FROM data_flags
    WHERE status = 'pending'
    GROUP BY flag_type, severity, status
    ORDER BY severity, flag_type
  `;

  if (flagStats.length > 0) {
    for (const f of flagStats) {
      console.log(`  [${f.severity}] ${f.flag_type}: ${f.count}`);
    }
  } else {
    console.log('  No unresolved data flags.');
  }
  console.log('');

  // ─── 14. MONTHLY COMPARISON: line items vs sales records ───
  console.log('═══════════════════════════════════════════');
  console.log('  14. MONTHLY COMPARISON: Line Items vs Aggregated Sales');
  console.log('═══════════════════════════════════════════\n');

  for (const store of STORES) {
    const storeId = store.includes('Grass') ? 'grass_roots' : 'barbary_coast';
    const label = store.includes('Grass') ? 'Grass Roots' : 'Barbary Coast';

    const monthlyLineItems: any[] = await prisma.$queryRaw`
      SELECT
        TO_CHAR(date_open, 'YYYY-MM') as month,
        COUNT(*)::int as line_item_count,
        COUNT(DISTINCT date_open::date)::int as unique_dates,
        COUNT(DISTINCT ticket_id)::int as unique_tickets,
        SUM(net_sales)::float as net_sales,
        SUM(gross_sales)::float as gross_sales
      FROM sales_line_items
      WHERE store_name = ${store}
      GROUP BY TO_CHAR(date_open, 'YYYY-MM')
      ORDER BY month
    `;

    const monthlySalesRecords: any[] = await prisma.$queryRaw`
      SELECT
        TO_CHAR(date, 'YYYY-MM') as month,
        COUNT(*)::int as record_count,
        SUM(net_sales)::float as net_sales,
        SUM(gross_sales)::float as gross_sales,
        SUM(tickets_count)::int as tickets
      FROM sales_records
      WHERE store_id = ${storeId}
      GROUP BY TO_CHAR(date, 'YYYY-MM')
      ORDER BY month
    `;

    console.log(`  📍 ${label}`);
    console.log(`  ${'Month'.padEnd(10)} | ${'LI Count'.padStart(10)} | ${'LI Dates'.padStart(8)} | ${'LI Net$'.padStart(14)} | ${'SR Count'.padStart(8)} | ${'SR Net$'.padStart(14)} | ${'Δ Net$'.padStart(14)}`);
    console.log(`  ${'-'.repeat(10)} | ${'-'.repeat(10)} | ${'-'.repeat(8)} | ${'-'.repeat(14)} | ${'-'.repeat(8)} | ${'-'.repeat(14)} | ${'-'.repeat(14)}`);

    // Merge months
    const allMonths = new Set([
      ...monthlyLineItems.map(r => r.month),
      ...monthlySalesRecords.map(r => r.month),
    ]);
    const sortedMonths = [...allMonths].sort();

    for (const month of sortedMonths) {
      const li = monthlyLineItems.find(r => r.month === month);
      const sr = monthlySalesRecords.find(r => r.month === month);

      const liCount = li?.line_item_count || 0;
      const liDates = li?.unique_dates || 0;
      const liNet = li?.net_sales || 0;
      const srCount = sr?.record_count || 0;
      const srNet = sr?.net_sales || 0;
      const delta = liNet - srNet;

      console.log(`  ${month.padEnd(10)} | ${liCount.toLocaleString().padStart(10)} | ${String(liDates).padStart(8)} | ${('$' + liNet.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })).padStart(14)} | ${srCount.toLocaleString().padStart(8)} | ${('$' + srNet.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })).padStart(14)} | ${(delta >= 0 ? '+' : '') + '$' + delta.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`.padStart(14));
    }
    console.log('');
  }

  // ─── 15. RECENT DATA CHECK (last 7 days) ───
  console.log('═══════════════════════════════════════════');
  console.log('  15. RECENT DATA CHECK (Last 7 Days)');
  console.log('═══════════════════════════════════════════\n');

  const sevenDaysAgo = new Date(TODAY);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  for (const store of STORES) {
    const recentDays: any[] = await prisma.$queryRaw`
      SELECT
        date_open::date::text as d,
        COUNT(*)::int as line_items,
        COUNT(DISTINCT ticket_id)::int as tickets,
        SUM(net_sales)::float as net_sales
      FROM sales_line_items
      WHERE store_name = ${store}
        AND date_open >= ${sevenDaysAgo}
      GROUP BY date_open::date
      ORDER BY d
    `;

    const label = store.includes('Grass') ? 'Grass Roots' : 'Barbary Coast';
    console.log(`  📍 ${label} (last 7 days):`);
    if (recentDays.length === 0) {
      console.log(`     ⚠️  NO DATA in last 7 days!`);
    } else {
      for (const day of recentDays) {
        console.log(`     ${day.d}: ${day.line_items} items, ${day.tickets} tickets, $${(day.net_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      }
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════');
  console.log('  AUDIT COMPLETE');
  console.log('═══════════════════════════════════════════');

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    prisma.$disconnect();
    process.exit(1);
  });
