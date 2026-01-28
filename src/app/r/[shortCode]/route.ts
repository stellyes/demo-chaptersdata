// ============================================
// QR CODE TRACKING REDIRECT ROUTE
// Tracks clicks and redirects to destination URL
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { headers } from 'next/headers';

// Parse user agent to extract device info
function parseUserAgent(userAgent: string): {
  deviceType: string;
  browser: string;
  os: string;
} {
  const ua = userAgent.toLowerCase();

  // Detect device type
  let deviceType = 'desktop';
  if (ua.includes('mobile') || ua.includes('android')) {
    deviceType = 'mobile';
  } else if (ua.includes('tablet') || ua.includes('ipad')) {
    deviceType = 'tablet';
  }

  // Detect browser
  let browser = 'unknown';
  if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('safari')) browser = 'Safari';
  else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';

  // Detect OS
  let os = 'unknown';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os') || ua.includes('macos')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  return { deviceType, browser, os };
}

// Get client IP address from various headers
function getClientIp(headersList: Headers): string {
  // Check various headers for the real IP
  const forwardedFor = headersList.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = headersList.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  const cfConnectingIp = headersList.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  return 'unknown';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shortCode: string }> }
) {
  const { shortCode } = await params;

  try {
    // Look up the QR code
    const qrCode = await prisma.qrCode.findUnique({
      where: { shortCode },
    });

    if (!qrCode) {
      return new NextResponse(
        `<!DOCTYPE html>
<html>
<head><title>QR Code Not Found</title></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
  <h1>QR Code Not Found</h1>
  <p>This QR code does not exist or has been removed.</p>
</body>
</html>`,
        {
          status: 404,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    if (!qrCode.active || qrCode.deleted) {
      return new NextResponse(
        `<!DOCTYPE html>
<html>
<head><title>QR Code Inactive</title></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
  <h1>QR Code Deactivated</h1>
  <p>This QR code has been deactivated.</p>
</body>
</html>`,
        {
          status: 410,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    // Get request headers for tracking
    const headersList = await headers();
    const userAgent = headersList.get('user-agent') || '';
    const referer = headersList.get('referer') || headersList.get('referrer') || '';
    const ipAddress = getClientIp(headersList);
    const acceptLanguage = headersList.get('accept-language') || '';

    // Parse user agent
    const { deviceType, browser, os } = parseUserAgent(userAgent);

    // Get UTM parameters from query string
    const searchParams = request.nextUrl.searchParams;
    const utmSource = searchParams.get('utm_source') || '';
    const utmMedium = searchParams.get('utm_medium') || '';
    const utmCampaign = searchParams.get('utm_campaign') || '';

    // Build location string from IP (simplified - could use geo IP service)
    const location = ipAddress !== 'unknown' ? `IP: ${ipAddress}` : undefined;

    // Record the click and increment total_clicks in a transaction
    await prisma.$transaction([
      prisma.qrClick.create({
        data: {
          qrCodeId: qrCode.id,
          shortCode: qrCode.shortCode,
          ipAddress: ipAddress.substring(0, 45), // Limit length
          userAgent: userAgent.substring(0, 500), // Limit length
          referrer: referer.substring(0, 500), // Limit length
          location,
          // Store additional metadata as JSON in location field for now
          // Could add dedicated columns later: deviceType, browser, os, utm params
        },
      }),
      prisma.qrCode.update({
        where: { id: qrCode.id },
        data: { totalClicks: { increment: 1 } },
      }),
    ]);

    // Log for debugging (can be removed in production)
    console.log(`QR Click: ${shortCode} -> ${qrCode.originalUrl} | Device: ${deviceType} | Browser: ${browser} | OS: ${os}`);

    // Redirect to the original URL
    return NextResponse.redirect(qrCode.originalUrl, {
      status: 302, // Temporary redirect (allows tracking on each scan)
    });
  } catch (error) {
    console.error('QR tracking error:', error);

    // On error, try to redirect anyway if we have the URL
    try {
      const qrCode = await prisma.qrCode.findUnique({
        where: { shortCode },
        select: { originalUrl: true },
      });

      if (qrCode?.originalUrl) {
        return NextResponse.redirect(qrCode.originalUrl, { status: 302 });
      }
    } catch {
      // Ignore secondary error
    }

    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
  <h1>Something went wrong</h1>
  <p>Please try scanning the QR code again.</p>
</body>
</html>`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }
}
