// ============================================
// BRAND MAPPINGS API ROUTE
// Upload/download brand mappings JSON (v2 structure)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { uploadBrandMappings, downloadBrandMappings } from '@/lib/aws/s3';

// GET - Download current brand mappings
export async function GET() {
  try {
    const mappings = await downloadBrandMappings();

    if (!mappings) {
      return NextResponse.json({
        success: false,
        error: 'No brand mappings found',
      }, { status: 404 });
    }

    const data = JSON.parse(mappings);
    const count = Object.keys(data).length;

    return NextResponse.json({
      success: true,
      data,
      count,
    });
  } catch (error) {
    console.error('Error loading brand mappings:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load brand mappings',
    }, { status: 500 });
  }
}

// POST - Upload new brand mappings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate the structure
    if (!body || typeof body !== 'object') {
      return NextResponse.json({
        success: false,
        error: 'Invalid JSON structure',
      }, { status: 400 });
    }

    // Check if it's in v2 format (has aliases property in entries)
    const firstValue = Object.values(body)[0] as { aliases?: Record<string, string> };
    if (!firstValue || typeof firstValue !== 'object' || !('aliases' in firstValue)) {
      return NextResponse.json({
        success: false,
        error: 'Brand mappings must be in v2 format with "aliases" property',
      }, { status: 400 });
    }

    const jsonString = JSON.stringify(body, null, 2);
    const key = await uploadBrandMappings(jsonString);
    const count = Object.keys(body).length;

    return NextResponse.json({
      success: true,
      message: `Uploaded ${count} brand mappings`,
      key,
      count,
    });
  } catch (error) {
    console.error('Error uploading brand mappings:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload brand mappings',
    }, { status: 500 });
  }
}
