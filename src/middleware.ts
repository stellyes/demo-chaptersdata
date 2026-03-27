import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:3002',
  'http://localhost:3003',
  'https://chaptersdata.com',
  'https://www.chaptersdata.com',
  // All subdomains of chaptersdata.com (e.g., demo.chaptersdata.com)
  /^https:\/\/[a-z0-9-]+\.chaptersdata\.com$/,
  // Amplify preview URLs
  /^https:\/\/.*\.amplifyapp\.com$/,
];

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;

  return allowedOrigins.some((allowed) => {
    if (typeof allowed === 'string') {
      return allowed === origin;
    }
    return allowed.test(origin);
  });
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');
  const response = NextResponse.next();

  // Handle CORS for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      const preflightResponse = new NextResponse(null, { status: 204 });

      if (origin && isOriginAllowed(origin)) {
        preflightResponse.headers.set('Access-Control-Allow-Origin', origin);
      }
      preflightResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      preflightResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Accept-Encoding');
      preflightResponse.headers.set('Access-Control-Max-Age', '86400');

      return preflightResponse;
    }

    // Add CORS headers to actual response
    if (origin && isOriginAllowed(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Accept-Encoding');
  }

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
