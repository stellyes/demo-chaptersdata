// ============================================
// TYPE DEFINITIONS
// ============================================

// Store types
export type StoreId = 'grass_roots' | 'barbary_coast' | 'combined';

export interface StoreConfig {
  id: StoreId;
  name: string;
  displayName: string;
}

// Sales data types
export interface SalesRecord {
  [key: string]: string | number | StoreId;
  date: string;
  store: string;
  store_id: StoreId;
  week: string;
  tickets_count: number;
  units_sold: number;
  customers_count: number;
  new_customers: number;
  gross_sales: number;
  discounts: number;
  returns: number;
  net_sales: number;
  taxes: number;
  gross_receipts: number;
  cogs_with_excise: number;
  gross_income: number;
  gross_margin_pct: number;
  discount_pct: number;
  cost_pct: number;
  avg_basket_size: number;
  avg_order_value: number;
  avg_order_profit: number;
}

// Brand data types
export interface BrandRecord {
  [key: string]: string | number | StoreId | undefined;
  brand: string;
  pct_of_total_net_sales: number;
  gross_margin_pct: number;
  avg_cost_wo_excise: number;
  net_sales: number;
  store: string;
  store_id: StoreId;
  upload_start_date?: string;
  upload_end_date?: string;
}

// Product data types
export interface ProductRecord {
  [key: string]: string | number | StoreId;
  product_type: string;
  pct_of_total_net_sales: number;
  gross_margin_pct: number;
  avg_cost_wo_excise: number;
  net_sales: number;
  store: string;
  store_id: StoreId;
}

// Customer data types
export type CustomerSegment = 'New/Low' | 'Regular' | 'Good' | 'VIP' | 'Whale';
export type RecencySegment = 'Active' | 'Warm' | 'Cool' | 'Cold' | 'Lost';

export interface CustomerRecord {
  [key: string]: string | number | CustomerSegment | RecencySegment | undefined;
  store_name: string;
  customer_id: string;
  name: string;
  date_of_birth?: string;
  age?: number;
  lifetime_visits: number;
  lifetime_transactions: number;
  lifetime_net_sales: number;
  lifetime_aov: number;
  signup_date: string;
  last_visit_date: string;
  customer_segment: CustomerSegment;
  recency_segment: RecencySegment;
}

// Invoice data types
export interface InvoiceRecord {
  [key: string]: string | number;
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  download_date: string;
  vendor: string;
  total_cost: number;
  total_with_excise: number;
  line_items_count: number;
  created_at: string;
}

export interface InvoiceLineItem {
  [key: string]: string | number | boolean | undefined;
  invoice_id: string;
  line_item_id: string;
  product_name: string;
  product_type: string;
  sku_units: number;
  unit_cost: number;
  total_cost: number;
  total_with_excise: number;
  strain?: string;
  unit_size?: string;
  trace_id?: string;
  is_promo: boolean;
}

// Research document types
export interface ResearchDocument {
  id: string;
  filename: string;
  s3_key: string;
  category: string;
  source_url?: string;
  uploaded_at: string;
  analysis?: DocumentAnalysis;
}

export interface DocumentAnalysis {
  summary: string;
  key_findings: KeyFinding[];
  date_mentioned?: string;
  key_facts: string[];
  relevance_score: 'high' | 'medium' | 'low';
}

export interface KeyFinding {
  finding: string;
  relevance: 'high' | 'medium' | 'low';
  category: 'regulatory' | 'market' | 'competition' | 'products' | 'pricing' | 'other';
  action_required: boolean;
  recommended_action?: string;
}

// SEO data types
export interface SEOSummary {
  site: string;
  score: number;
  top_priorities: string[];
  quick_wins: string[];
  analyzed_at: string;
}

// QR Code types
export interface QRCode {
  short_code: string;
  original_url: string;
  name: string;
  description?: string;
  created_at: string;
  total_clicks: number;
  active: boolean;
  deleted: boolean;
}

export interface QRClick {
  short_code: string;
  ip_address: string;
  timestamp: string;
  user_agent?: string;
  referrer?: string;
  location?: string;
}

// Auth types
export interface User {
  username: string;
  role: 'admin' | 'analyst';
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Chart data types
export interface ChartDataPoint {
  [key: string]: string | number | null;
}

// Budtender data types
export interface BudtenderRecord {
  [key: string]: string | number | StoreId | undefined;
  store: string;
  store_id: StoreId;
  employee_name: string;
  date: string;
  tickets_count: number;
  customers_count: number;
  net_sales: number;
  gross_margin_pct: number;
  avg_order_value: number;
  units_sold: number;
}

// Brand-Product Mapping types
export interface BrandMapping {
  brand: string;
  product_type: string;
  category?: string;
  vendor?: string;
}

export interface BrandMappingsData {
  mappings: BrandMapping[];
  last_updated: string;
}

// Upload metadata
export interface UploadMetadata {
  store: StoreId;
  start_date: string;
  end_date: string;
  uploaded_at: string;
  filename: string;
}
