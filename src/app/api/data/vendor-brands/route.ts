// ============================================
// VENDOR-BRAND RELATIONSHIPS API ROUTE
// Returns vendor-brand relationships for AI analysis
// ============================================

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { gzipSync } from 'zlib';
import { getGzipResponseHeaders } from '@/lib/cors';

interface VendorBrandRelationship {
  vendor_id: string;
  vendor_name: string;
  brand_id: string;
  brand_name: string;
  invoice_count: number;
  total_units: number;
  total_cost: number;
  first_seen: string | null;
  last_seen: string | null;
}

interface VendorSummary {
  vendor_name: string;
  brands: string[];
  total_invoices: number;
  total_units: number;
  total_cost: number;
}

interface BrandSummary {
  brand_name: string;
  vendors: string[];
  total_invoices: number;
  total_units: number;
  total_cost: number;
}

// Cache for vendor-brand data
let cache: {
  relationships: VendorBrandRelationship[];
  byVendor: VendorSummary[];
  byBrand: BrandSummary[];
  timestamp: number;
} | null = null;

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function loadVendorBrandData() {
  console.log('Loading vendor-brand relationships from Aurora...');
  const startTime = Date.now();

  const vendorBrands = await prisma.vendorBrand.findMany({
    include: {
      vendor: true,
      brand: true,
    },
    orderBy: { invoiceCount: 'desc' },
  });

  // Transform to API format
  const relationships: VendorBrandRelationship[] = vendorBrands.map(vb => ({
    vendor_id: vb.vendorId,
    vendor_name: vb.vendor.canonicalName,
    brand_id: vb.brandId,
    brand_name: vb.brand.canonicalName,
    invoice_count: vb.invoiceCount,
    total_units: vb.totalUnits,
    total_cost: Number(vb.totalCost),
    first_seen: vb.firstSeenAt?.toISOString().split('T')[0] || null,
    last_seen: vb.lastSeenAt?.toISOString().split('T')[0] || null,
  }));

  // Aggregate by vendor
  const vendorMap: Record<string, VendorSummary> = {};
  for (const vb of vendorBrands) {
    const vendorName = vb.vendor.canonicalName;
    if (!vendorMap[vendorName]) {
      vendorMap[vendorName] = {
        vendor_name: vendorName,
        brands: [],
        total_invoices: 0,
        total_units: 0,
        total_cost: 0,
      };
    }
    vendorMap[vendorName].brands.push(vb.brand.canonicalName);
    vendorMap[vendorName].total_invoices += vb.invoiceCount;
    vendorMap[vendorName].total_units += vb.totalUnits;
    vendorMap[vendorName].total_cost += Number(vb.totalCost);
  }
  const byVendor = Object.values(vendorMap).sort((a, b) => b.total_invoices - a.total_invoices);

  // Aggregate by brand
  const brandMap: Record<string, BrandSummary> = {};
  for (const vb of vendorBrands) {
    const brandName = vb.brand.canonicalName;
    if (!brandMap[brandName]) {
      brandMap[brandName] = {
        brand_name: brandName,
        vendors: [],
        total_invoices: 0,
        total_units: 0,
        total_cost: 0,
      };
    }
    brandMap[brandName].vendors.push(vb.vendor.canonicalName);
    brandMap[brandName].total_invoices += vb.invoiceCount;
    brandMap[brandName].total_units += vb.totalUnits;
    brandMap[brandName].total_cost += Number(vb.totalCost);
  }
  const byBrand = Object.values(brandMap).sort((a, b) => b.total_invoices - a.total_invoices);

  const duration = Date.now() - startTime;
  console.log(`Vendor-brand data loaded in ${duration}ms: ${relationships.length} relationships`);

  return { relationships, byVendor, byBrand };
}

export async function GET(request: NextRequest) {
  try {
    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    // Check cache
    if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
      console.log(`Returning cached vendor-brand data`);
      const responseData = {
        success: true,
        data: {
          relationships: cache.relationships,
          byVendor: cache.byVendor,
          byBrand: cache.byBrand,
        },
        counts: {
          relationships: cache.relationships.length,
          vendors: cache.byVendor.length,
          brands: cache.byBrand.length,
        },
        cached: true,
      };

      if (supportsGzip) {
        const compressed = gzipSync(JSON.stringify(responseData));
        return new Response(compressed, {
          status: 200,
          headers: getGzipResponseHeaders(request),
        });
      }
      return Response.json(responseData);
    }

    // Load fresh data
    const { relationships, byVendor, byBrand } = await loadVendorBrandData();

    // Update cache
    cache = { relationships, byVendor, byBrand, timestamp: Date.now() };

    const responseData = {
      success: true,
      data: {
        relationships,
        byVendor,
        byBrand,
      },
      counts: {
        relationships: relationships.length,
        vendors: byVendor.length,
        brands: byBrand.length,
      },
      cached: false,
    };

    if (supportsGzip) {
      const compressed = gzipSync(JSON.stringify(responseData));
      return new Response(compressed, {
        status: 200,
        headers: getGzipResponseHeaders(request),
      });
    }

    return Response.json(responseData);
  } catch (error) {
    console.error('Vendor-brand data loading error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load vendor-brand data',
      },
      { status: 500 }
    );
  }
}
