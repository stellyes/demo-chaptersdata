// ============================================
// SHARED CORS UTILITY
// Consistent CORS handling across all API routes
// ============================================

import { NextRequest } from 'next/server';

// Allowed origins - keep in sync with middleware.ts
const ALLOWED_ORIGINS = [
  'http://localhost:3002',
  'http://localhost:3003',
  'https://chaptersdata.com',
  'https://www.chaptersdata.com',
];

// Regex patterns for dynamic origin matching
const SUBDOMAIN_PATTERN = /^https:\/\/[a-z0-9-]+\.chaptersdata\.com$/;
const AMPLIFY_PATTERN = /^https:\/\/.*\.amplifyapp\.com$/;

/**
 * Check if an origin is allowed for CORS
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;

  // Check exact matches
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  // Check subdomains of chaptersdata.com
  if (SUBDOMAIN_PATTERN.test(origin)) return true;

  // Check Amplify preview URLs
  if (AMPLIFY_PATTERN.test(origin)) return true;

  return false;
}

/**
 * Get CORS headers for a request
 * Use this when creating custom Response objects (e.g., gzip responses)
 */
export function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Accept-Encoding',
  };

  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

/**
 * Create headers object for gzip responses with CORS
 * Includes Vary header to ensure correct cache behavior
 */
export function getGzipResponseHeaders(request: NextRequest): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
    'Vary': 'Accept-Encoding, Origin',
    'Cache-Control': 'private, max-age=300',
    ...getCorsHeaders(request),
  };
}

/**
 * Create headers object for non-gzip JSON responses with CORS
 */
export function getJsonResponseHeaders(request: NextRequest): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Vary': 'Accept-Encoding, Origin',
    'Cache-Control': 'private, max-age=300',
    ...getCorsHeaders(request),
  };
}
