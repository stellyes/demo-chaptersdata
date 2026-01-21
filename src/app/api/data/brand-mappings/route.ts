// ============================================
// BRAND MAPPINGS API ROUTE
// Read/update brand mappings from Aurora PostgreSQL (v2 structure)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Brand mapping v2 structure
interface BrandMappingData {
  [canonicalBrand: string]: {
    aliases: { [aliasName: string]: string };
  };
}

// GET - Download current brand mappings
export async function GET() {
  try {
    const canonicalBrands = await prisma.canonicalBrand.findMany({
      include: { aliases: true },
      orderBy: { canonicalName: 'asc' },
    });

    // Transform to v2 format
    const mappings: BrandMappingData = {};
    for (const brand of canonicalBrands) {
      const aliases: { [aliasName: string]: string } = {};
      for (const alias of brand.aliases) {
        aliases[alias.aliasName] = alias.productType || '';
      }
      mappings[brand.canonicalName] = { aliases };
    }

    const count = Object.keys(mappings).length;

    return NextResponse.json({
      success: true,
      data: mappings,
      count,
      source: 'aurora',
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
    const body = await request.json() as BrandMappingData;

    // Validate the structure
    if (!body || typeof body !== 'object') {
      return NextResponse.json({
        success: false,
        error: 'Invalid JSON structure',
      }, { status: 400 });
    }

    // Check if it's in v2 format (has aliases property in entries)
    const firstValue = Object.values(body)[0];
    if (!firstValue || typeof firstValue !== 'object' || !('aliases' in firstValue)) {
      return NextResponse.json({
        success: false,
        error: 'Brand mappings must be in v2 format with "aliases" property',
      }, { status: 400 });
    }

    // Process each canonical brand
    let brandsCreated = 0;
    let aliasesCreated = 0;

    for (const [canonicalName, entry] of Object.entries(body)) {
      // Upsert canonical brand
      const brand = await prisma.canonicalBrand.upsert({
        where: { canonicalName },
        create: { canonicalName },
        update: {},
      });
      brandsCreated++;

      // Process aliases
      for (const [aliasName, productType] of Object.entries(entry.aliases)) {
        await prisma.brandAlias.upsert({
          where: {
            aliasName,
          },
          create: {
            brandId: brand.id,
            aliasName,
            productType: productType || null,
          },
          update: {
            brandId: brand.id,
            productType: productType || null,
          },
        });
        aliasesCreated++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${brandsCreated} brands with ${aliasesCreated} aliases`,
      count: brandsCreated,
      source: 'aurora',
    });
  } catch (error) {
    console.error('Error uploading brand mappings:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload brand mappings',
    }, { status: 500 });
  }
}
