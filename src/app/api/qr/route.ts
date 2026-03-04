// ============================================
// QR CODES API ROUTE
// Manages QR codes in Aurora PostgreSQL
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { QR_REDIRECT_BASE_URL } from '@/lib/config';

// Build the tracking URL for a QR code
// QR_REDIRECT_BASE_URL already includes the /r path segment
// e.g., https://skhaq1xs3j.execute-api.us-west-1.amazonaws.com/prod/r
function buildTrackingUrl(shortCode: string): string {
  return `${QR_REDIRECT_BASE_URL}/${shortCode}`;
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
