// ============================================
// LEARNING API AUTHENTICATION
// Shared auth utility for learning API routes
// ============================================

import { NextRequest, NextResponse } from 'next/server';

const LEARNING_API_KEY = process.env.LEARNING_API_KEY;

/**
 * Check if a request is authorized to access learning API endpoints.
 *
 * Authorization methods (in order of precedence):
 * 1. Bearer token in Authorization header (Lambda/external triggers)
 * 2. X-API-Key header (Lambda/external triggers)
 * 3. X-Internal-Auth header matching server-side key (frontend via getInternalAuthHeader)
 * 4. Localhost access when no LEARNING_API_KEY is configured (dev mode)
 *
 * @param request - The incoming NextRequest
 * @returns true if authorized, false otherwise
 */
export function isLearningApiAuthorized(request: NextRequest): boolean {
  const host = request.headers.get('host') || '';

  // If no API key is configured, allow localhost access only (development mode)
  if (!LEARNING_API_KEY) {
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');

    if (isLocalhost) {
      return true;
    }

    // In production without an API key configured, deny all access
    console.warn('[Learning API] No LEARNING_API_KEY configured and request is not from localhost');
    return false;
  }

  // Check Bearer token in Authorization header (for Lambda/external triggers)
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token === LEARNING_API_KEY) {
      return true;
    }
  }

  // Check X-API-Key header (for Lambda/external triggers)
  const apiKeyHeader = request.headers.get('X-API-Key');
  if (apiKeyHeader === LEARNING_API_KEY) {
    return true;
  }

  // Check X-Internal-Auth header (for frontend calls via server action)
  const internalAuth = request.headers.get('X-Internal-Auth');
  if (internalAuth === LEARNING_API_KEY) {
    return true;
  }

  return false;
}

/**
 * Get the internal auth header value for server-side frontend requests.
 * This is safe because it only runs server-side (in API routes or server actions)
 * and the key is never exposed to the browser.
 */
export function getInternalAuthHeaders(): Record<string, string> {
  return LEARNING_API_KEY
    ? { 'X-Internal-Auth': LEARNING_API_KEY }
    : {};
}

/**
 * Create an unauthorized response for learning API endpoints.
 *
 * @param message - Optional custom error message
 * @returns NextResponse with 401 status
 */
export function unauthorizedResponse(message: string = 'Unauthorized'): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: message,
      hint: 'Provide a valid API key via Authorization: Bearer <key> or X-API-Key header'
    },
    { status: 401 }
  );
}

/**
 * Higher-order function to wrap an API handler with auth check.
 * Use this for cleaner route handlers.
 *
 * @example
 * export const POST = withLearningAuth(async (request) => {
 *   // Your handler logic here
 *   return NextResponse.json({ success: true });
 * });
 */
export function withLearningAuth(
  handler: (request: NextRequest) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    if (!isLearningApiAuthorized(request)) {
      return unauthorizedResponse();
    }
    return handler(request);
  };
}
