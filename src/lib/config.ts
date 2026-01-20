// ============================================
// APPLICATION CONFIGURATION
// ============================================

import { StoreConfig, StoreId } from '@/types';

// Store configurations
export const STORES: Record<StoreId, StoreConfig> = {
  grass_roots: {
    id: 'grass_roots',
    name: 'Grass Roots',
    displayName: 'Grass Roots SF',
  },
  barbary_coast: {
    id: 'barbary_coast',
    name: 'Barbary Coast',
    displayName: 'Barbary Coast SF',
  },
  combined: {
    id: 'combined',
    name: 'All Stores',
    displayName: 'All Stores',
  },
};

// Store name to ID mapping (for CSV parsing)
export const STORE_NAME_TO_ID: Record<string, StoreId> = {
  'Grass Roots': 'grass_roots',
  'Grass Roots SF': 'grass_roots',
  'grass_roots': 'grass_roots',
  'Barbary Coast': 'barbary_coast',
  'Barbary Coast SF': 'barbary_coast',
  'barbary_coast': 'barbary_coast',
};

// AWS Configuration
// Note: Using CHAPTERS_ prefix instead of AWS_ for Amplify compatibility
export const AWS_CONFIG = {
  region: process.env.CHAPTERS_AWS_REGION || process.env.AWS_REGION || 'us-west-1',
  bucket: process.env.CHAPTERS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'retail-data-bcgr',
  accessKeyId: process.env.CHAPTERS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.CHAPTERS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
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

// DynamoDB Tables
export const DYNAMODB_TABLES = {
  invoices: 'retail-invoices',
  lineItems: 'retail-invoice-line-items',
  qrCodes: process.env.DYNAMODB_QR_TABLE || 'qr-tracker-qr-codes',
  qrClicks: process.env.DYNAMODB_CLICKS_TABLE || 'qr-tracker-clicks',
};

// QR Redirect URL
export const QR_REDIRECT_BASE_URL = process.env.QR_REDIRECT_BASE_URL || 'https://skhaq1xs3j.execute-api.us-west-1.amazonaws.com/prod/r';

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

// SEO Sites
export const SEO_SITES = [
  { id: 'barbarycoastsf', name: 'Barbary Coast', url: 'https://barbarycoastsf.com' },
  { id: 'grassrootssf', name: 'Grass Roots', url: 'https://grassrootssf.com' },
];

// Claude AI Configuration
export const CLAUDE_CONFIG = {
  defaultModel: 'claude-sonnet-4-20250514',
  haiku: 'claude-haiku-4-5-20251001',
  maxTokens: 4096,
  cacheTTL: 86400, // 24 hours in seconds
};

// Chart Colors
export const CHART_COLORS = {
  primary: '#1e391f',
  secondary: '#3d6b3e',
  tertiary: '#5a8f5c',
  quaternary: '#7eb37f',
  quinary: '#a3cca4',
  stores: {
    grass_roots: '#1e391f',
    barbary_coast: '#3d6b3e',
  },
};

// Date formats
export const DATE_FORMATS = {
  display: 'MMM d, yyyy',
  api: 'yyyy-MM-dd',
  filename: 'MM-dd-yyyy',
};
