import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Parse user agent to extract device info (same logic as redirect handler)
function parseUserAgent(userAgent: string): {
  deviceType: string;
  browser: string;
  os: string;
} {
  const ua = userAgent.toLowerCase();

  let deviceType = 'desktop';
  if (ua.includes('mobile') || ua.includes('android')) {
    deviceType = 'mobile';
  } else if (ua.includes('tablet') || ua.includes('ipad')) {
    deviceType = 'tablet';
  }

  let browser = 'Unknown';
  if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('safari')) browser = 'Safari';
  else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';

  let os = 'Unknown';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os') || ua.includes('macos')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  return { deviceType, browser, os };
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Fetch all clicks within the time window
    const clicks = await prisma.qrClick.findMany({
      where: { clickedAt: { gte: since } },
      orderBy: { clickedAt: 'desc' },
      select: {
        shortCode: true,
        clickedAt: true,
        userAgent: true,
        referrer: true,
        ipAddress: true,
      },
    });

    // Fetch QR code names for mapping
    const qrCodes = await prisma.qrCode.findMany({
      where: { deleted: false },
      select: { shortCode: true, name: true, totalClicks: true },
    });
    const codeNames: Record<string, string> = {};
    for (const qr of qrCodes) {
      codeNames[qr.shortCode] = qr.name;
    }

    // --- Aggregate: clicks per day ---
    const clicksByDay: Record<string, number> = {};
    for (const click of clicks) {
      const day = click.clickedAt.toISOString().split('T')[0];
      clicksByDay[day] = (clicksByDay[day] || 0) + 1;
    }
    // Fill in missing days with 0
    const dailyClicks: { date: string; clicks: number }[] = [];
    const cursor = new Date(since);
    const today = new Date();
    while (cursor <= today) {
      const key = cursor.toISOString().split('T')[0];
      dailyClicks.push({ date: key, clicks: clicksByDay[key] || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    // --- Aggregate: clicks per QR code ---
    const clicksByCode: Record<string, number> = {};
    for (const click of clicks) {
      clicksByCode[click.shortCode] = (clicksByCode[click.shortCode] || 0) + 1;
    }
    const topCodes = Object.entries(clicksByCode)
      .map(([shortCode, count]) => ({
        shortCode,
        name: codeNames[shortCode] || shortCode,
        clicks: count,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10);

    // --- Aggregate: device / browser / OS breakdowns ---
    const devices: Record<string, number> = {};
    const browsers: Record<string, number> = {};
    const operatingSystems: Record<string, number> = {};
    for (const click of clicks) {
      const parsed = parseUserAgent(click.userAgent || '');
      devices[parsed.deviceType] = (devices[parsed.deviceType] || 0) + 1;
      browsers[parsed.browser] = (browsers[parsed.browser] || 0) + 1;
      operatingSystems[parsed.os] = (operatingSystems[parsed.os] || 0) + 1;
    }

    // --- Aggregate: top referrers ---
    const referrerCounts: Record<string, number> = {};
    for (const click of clicks) {
      let ref = click.referrer?.trim() || 'Direct / Unknown';
      // Normalize referrer to domain
      try {
        if (ref !== 'Direct / Unknown' && ref.startsWith('http')) {
          ref = new URL(ref).hostname;
        }
      } catch {
        // keep as-is
      }
      referrerCounts[ref] = (referrerCounts[ref] || 0) + 1;
    }
    const topReferrers = Object.entries(referrerCounts)
      .map(([source, count]) => ({ source, clicks: count }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10);

    // --- Recent clicks (last 20) ---
    const recentClicks = clicks.slice(0, 20).map((click) => {
      const parsed = parseUserAgent(click.userAgent || '');
      return {
        shortCode: click.shortCode,
        name: codeNames[click.shortCode] || click.shortCode,
        clickedAt: click.clickedAt.toISOString(),
        device: parsed.deviceType,
        browser: parsed.browser,
        os: parsed.os,
        referrer: click.referrer || null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        totalClicks: clicks.length,
        period: { days, since: since.toISOString() },
        dailyClicks,
        topCodes,
        devices,
        browsers,
        operatingSystems,
        topReferrers,
        recentClicks,
      },
    });
  } catch (error) {
    console.error('[QR Analytics] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load analytics' },
      { status: 500 }
    );
  }
}
