// ============================================
// APPLICATION CONFIGURATION
// ============================================
// Demo deployment — store names are for the Chapters demo environment.

import { StoreConfig, StoreId } from '@/types';

// ---- Store Configuration ----

const STORE_LIST: StoreConfig[] = [
  { id: 'greenleaf', name: 'Greenleaf Market', displayName: 'Greenleaf Market - Downtown' },
  { id: 'emerald', name: 'Emerald Collective', displayName: 'Emerald Collective - Midtown' },
];

// Build the STORES record (individual stores + combined)
export const STORES: Record<StoreId, StoreConfig> = Object.fromEntries([
  ...STORE_LIST.map((s) => [s.id, s]),
  ['combined', { id: 'combined', name: 'All Stores', displayName: 'All Stores' }],
]);

// Helper: get only the individual (non-combined) store IDs
export function getIndividualStoreIds(): StoreId[] {
  return STORE_LIST.map((s) => s.id);
}

// Helper: get the first store ID (used as default)
export function getDefaultStoreId(): StoreId {
  return STORE_LIST[0]?.id ?? 'combined';
}

// Store name to ID mapping (for CSV parsing) – built dynamically from config
export const STORE_NAME_TO_ID: Record<string, StoreId> = Object.fromEntries(
  STORE_LIST.flatMap((s) => [
    [s.id, s.id],
    [s.name, s.id],
    [s.displayName, s.id],
    [s.name.toLowerCase(), s.id],
  ])
);

// ---- Chart Colors ----

const STORE_COLOR_PALETTE = ['#1e391f', '#3d6b3e', '#5a8f5c', '#7eb37f', '#a3cca4', '#2d5a3f'];

export const CHART_COLORS = {
  primary: '#1e391f',
  secondary: '#3d6b3e',
  tertiary: '#5a8f5c',
  quaternary: '#7eb37f',
  quinary: '#a3cca4',
  stores: Object.fromEntries(
    STORE_LIST.map((s, i) => [s.id, STORE_COLOR_PALETTE[i % STORE_COLOR_PALETTE.length]])
  ) as Record<string, string>,
};

// Helper: get color for a store
export function getStoreColor(storeId: StoreId): string {
  return CHART_COLORS.stores[storeId] ?? CHART_COLORS.primary;
}

// ---- AWS Configuration ----
export const AWS_CONFIG = {
  region: process.env.CHAPTERS_AWS_REGION || process.env.S3_REGION || 'us-west-1',
  bucket: process.env.CHAPTERS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'retail-data-demo',
  accessKeyId: process.env.CHAPTERS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.CHAPTERS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY,
};

// S3 Paths
export const S3_PATHS = {
  rawUploads: 'raw-uploads',
  processed: 'processed',
  researchDocuments: 'research-documents',
  researchFindings: 'research-findings',
  seoAnalysis: 'seo-analysis',
  config: 'config',
};

// QR Redirect URL
export const QR_REDIRECT_BASE_URL = process.env.QR_REDIRECT_BASE_URL || 'https://demo.chaptersdata.com/r';

// Customer Segmentation Thresholds
export const CUSTOMER_SEGMENTS = {
  'New/Low': { min: 0, max: 500 },
  'Regular': { min: 500, max: 2000 },
  'Good': { min: 2000, max: 5000 },
  'VIP': { min: 5000, max: 10000 },
  'Whale': { min: 10000, max: Infinity },
};

// Recency Thresholds (days)
export const RECENCY_SEGMENTS = {
  'Active': { min: 0, max: 30 },
  'Warm': { min: 30, max: 90 },
  'Cool': { min: 90, max: 180 },
  'Cold': { min: 180, max: 365 },
  'Lost': { min: 365, max: Infinity },
};

// Brand Analysis Thresholds
export const BRAND_THRESHOLDS = {
  lowMargin: 40,
  targetMargin: 55,
  highMargin: 65,
  minSalesForAnalysis: 1000,
};

// Research Categories
export const RESEARCH_CATEGORIES = [
  'Regulatory Updates',
  'Market Trends',
  'Competitive Landscape',
  'Product Innovation',
  'Pricing & Economics',
  'Other',
];

// SEO Sites - empty for demo
export const SEO_SITES: { id: string; name: string; url: string }[] = [];

// Claude AI Configuration
export const CLAUDE_CONFIG = {
  defaultModel: 'claude-sonnet-4-20250514',
  haiku: 'claude-haiku-4-5-20251001',
  maxTokens: 4096,
  cacheTTL: 86400,
};

// Date formats
export const DATE_FORMATS = {
  display: 'MMM d, yyyy',
  api: 'yyyy-MM-dd',
  filename: 'MM-dd-yyyy',
};
