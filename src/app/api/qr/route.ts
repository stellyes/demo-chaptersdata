// ============================================
// QR CODES API ROUTE
// Manages QR codes in Aurora PostgreSQL
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Get the base URL for tracking redirects
function getTrackingBaseUrl(): string {
  // Use environment variable if set, otherwise derive from NEXTAUTH_URL or default
  return (
    process.env.QR_TRACKING_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://bcsf.chaptersdata.com'
  );
}

// Build the tracking URL for a QR code
function buildTrackingUrl(shortCode: string): string {
  const baseUrl = getTrackingBaseUrl();
  return `${baseUrl}/r/${shortCode}`;
}

// GET - Load all QR codes
export async function GET() {
  try {
    const qrCodes = await prisma.qrCode.findMany({
      where: { deleted: false },
      orderBy: { createdAt: 'desc' },
    });

    // Add tracking URL to each QR code
    const qrCodesWithTracking = qrCodes.map((qr) => ({
      ...qr,
      trackingUrl: buildTrackingUrl(qr.shortCode),
    }));

    return NextResponse.json({
      success: true,
      data: qrCodesWithTracking,
    });
  } catch (error) {
    console.error('Error loading QR codes:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load QR codes' },
      { status: 500 }
    );
  }
}

// POST - Create a new QR code
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shortCode, name, originalUrl, description } = body;

    if (!name || !originalUrl) {
      return NextResponse.json(
        { success: false, error: 'Name and URL are required' },
        { status: 400 }
      );
    }

    const generatedShortCode = shortCode || `qr_${Date.now().toString(36)}`;

    const qrCode = await prisma.qrCode.create({
      data: {
        shortCode: generatedShortCode,
        name,
        originalUrl,
        description,
        active: true,
        totalClicks: 0,
      },
    });

    // Return with tracking URL
    return NextResponse.json({
      success: true,
      data: {
        ...qrCode,
        trackingUrl: buildTrackingUrl(qrCode.shortCode),
      },
    });
  } catch (error) {
    console.error('Error creating QR code:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create QR code' },
      { status: 500 }
    );
  }
}

// DELETE - Soft delete a QR code
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'QR code ID is required' },
        { status: 400 }
      );
    }

    await prisma.qrCode.update({
      where: { id },
      data: { deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting QR code:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete QR code' },
      { status: 500 }
    );
  }
}
