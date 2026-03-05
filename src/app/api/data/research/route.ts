// ============================================
// RESEARCH & SEO DATA API ROUTE
// Loads industry research, SEO analysis, and QR data from Aurora
// ============================================

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { gzipSync } from 'zlib';
import { getGzipResponseHeaders, shouldUseGzip } from '@/lib/cors';

interface ResearchFinding {
  id: string;
  date: string;
  category: string;
  summary: string;
  key_findings: string[];
  relevance: string;
  source?: string;
}

interface SEOSummary {
  site: string;
  score: number;
  priorities: string[];
  quickWins: string[];
  lastUpdated: string;
}

interface QRCode {
  id: string;
  shortCode: string;
  name: string;
  originalUrl: string;
  totalClicks: number;
  createdAt: string;
  active: boolean;
}

interface AIRecommendation {
  id: string;
  type: string;
  date: string;
  analysis: string;
  summary?: string;
}

// Cache
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let researchCache: CacheEntry<ResearchFinding[]> | null = null;
let seoCache: CacheEntry<SEOSummary[]> | null = null;
let qrCache: CacheEntry<QRCode[]> | null = null;
let recommendationsCache: CacheEntry<AIRecommendation[]> | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Load research findings from Aurora (CollectedUrl)
async function loadResearchFindings(): Promise<ResearchFinding[]> {
  console.log('Loading research findings from Aurora...');

  // Load URLs even if not fully analyzed - prioritize analyzed ones first
  const collectedUrls = await prisma.collectedUrl.findMany({
    orderBy: [
      { isAnalyzed: 'desc' }, // Analyzed URLs first
      { createdAt: 'desc' },
    ],
    take: 100,
  });

  // Transform to research findings format
  const findings: ResearchFinding[] = collectedUrls.map((url) => {
    const categories = url.categories as string[] | null;
    return {
      id: url.id,
      date: url.createdAt.toISOString(),
      category: categories?.[0] || 'Research',
      summary: url.title || '',
      key_findings: url.snippet ? [url.snippet] : [],
      relevance: url.relevanceScore && url.relevanceScore > 0.7 ? 'high' : url.relevanceScore && url.relevanceScore > 0.4 ? 'medium' : 'low',
      source: url.url,
    };
  });

  return findings;
}

// Load SEO analysis data from Aurora (SeoAudit model if exists, otherwise return placeholder)
async function loadSEOData(): Promise<SEOSummary[]> {
  console.log('Loading SEO data from Aurora...');

  // Check if SeoAudit model exists
  try {
    // For now, return placeholder data until SEO audit is fully migrated
    // This will be replaced when Phase 2 (SEO Audit Feature) is implemented
    return [
      {
        site: 'Barbary Coast',
        score: 0,
        priorities: ['SEO audit feature coming soon'],
        quickWins: [],
        lastUpdated: new Date().toISOString(),
      },
      {
        site: 'Grass Roots',
        score: 0,
        priorities: ['SEO audit feature coming soon'],
        quickWins: [],
        lastUpdated: new Date().toISOString(),
      },
    ];
  } catch (error) {
    console.error('Error loading SEO data:', error);
    return [];
  }
}

// Load QR codes from Aurora
async function loadQRData(): Promise<QRCode[]> {
  console.log('Loading QR codes from Aurora...');

  const qrCodes = await prisma.qrCode.findMany({
    where: { deleted: false },
    orderBy: { createdAt: 'desc' },
  });

  return qrCodes.map((qr) => ({
    id: qr.id,
    shortCode: qr.shortCode,
    name: qr.name,
    originalUrl: qr.originalUrl,
    totalClicks: qr.totalClicks,
    createdAt: qr.createdAt.toISOString(),
    active: qr.active,
  }));
}

// Load past AI recommendations from Aurora (AnalysisHistory)
async function loadAIRecommendations(): Promise<AIRecommendation[]> {
  console.log('[Research API] Loading AI recommendations from Aurora...');

  try {
    const analysisHistory = await prisma.analysisHistory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    console.log(`[Research API] Found ${analysisHistory.length} AI recommendations in database`);

    return analysisHistory.map((analysis) => ({
      id: analysis.id,
      type: analysis.analysisType,
      date: analysis.createdAt.toISOString(),
      analysis: analysis.outputSummary || '',
      summary: analysis.inputSummary || undefined,
    }));
  } catch (error) {
    console.error('[Research API] Error loading AI recommendations:', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check gzip support (disabled for iOS due to Safari PWA bugs)
    const supportsGzip = shouldUseGzip(request);
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get('refresh') === 'true';
    const includeDebug = url.searchParams.get('debug') === 'true';

    // Check caches and load fresh data if needed
    const now = Date.now();
    let fromCache = true;

    if (forceRefresh || !researchCache || now - researchCache.timestamp > CACHE_TTL) {
      const research = await loadResearchFindings();
      researchCache = { data: research, timestamp: now };
      fromCache = false;
    }

    if (forceRefresh || !seoCache || now - seoCache.timestamp > CACHE_TTL) {
      const seo = await loadSEOData();
      seoCache = { data: seo, timestamp: now };
      fromCache = false;
    }

    if (forceRefresh || !qrCache || now - qrCache.timestamp > CACHE_TTL) {
      const qr = await loadQRData();
      qrCache = { data: qr, timestamp: now };
      fromCache = false;
    }

    if (forceRefresh || !recommendationsCache || now - recommendationsCache.timestamp > CACHE_TTL) {
      const recommendations = await loadAIRecommendations();
      recommendationsCache = { data: recommendations, timestamp: now };
      fromCache = false;
    }

    const responseData: Record<string, unknown> = {
      success: true,
      data: {
        research: researchCache.data,
        seo: seoCache.data,
        qrCodes: qrCache.data,
        aiRecommendations: recommendationsCache.data,
      },
      counts: {
        research: researchCache.data.length,
        seo: seoCache.data.length,
        qrCodes: qrCache.data.length,
        aiRecommendations: recommendationsCache.data.length,
      },
      cached: fromCache,
      source: 'aurora',
    };

    // Include debug info when requested
    if (includeDebug) {
      responseData.debug = {
        dataSource: 'Aurora PostgreSQL',
        tables: ['collected_urls', 'qr_codes', 'analysis_history'],
        seoSitesLoaded: seoCache.data.map(s => s.site),
        researchSources: researchCache.data.slice(0, 5).map(r => ({ id: r.id, category: r.category })),
        cacheTimestamp: new Date(researchCache.timestamp).toISOString(),
      };
    }

    if (supportsGzip) {
      const compressed = gzipSync(JSON.stringify(responseData));
      return new Response(compressed, {
        status: 200,
        headers: getGzipResponseHeaders(request),
      });
    }

    return Response.json(responseData);
  } catch (error) {
    console.error('Research data loading error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load research data',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
