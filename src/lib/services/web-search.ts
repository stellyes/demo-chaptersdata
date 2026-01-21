// ============================================
// WEB SEARCH SERVICE
// SerpAPI integration with throttling (250/month)
// and URL deduplication to maximize data collection
// ============================================

import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';

// Types for SerpAPI responses
interface SerpApiOrganicResult {
  position: number;
  title: string;
  link: string;
  snippet: string;
  date?: string;
  source?: string;
}

interface SerpApiResponse {
  search_metadata: {
    id: string;
    status: string;
    created_at: string;
    processed_at: string;
    total_time_taken: number;
  };
  search_parameters: {
    q: string;
    start?: number;
  };
  organic_results?: SerpApiOrganicResult[];
  serpapi_pagination?: {
    next?: string;
    next_link?: string;
  };
  error?: string;
}

export interface SearchResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
  urlHash: string;
  publishedDate?: string;
  isNew: boolean;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  newResults: SearchResult[];
  totalResults: number;
  newResultsCount: number;
  fromCache: boolean;
  searchesRemaining: number;
  searchesUsedThisMonth: number;
}

export interface ThrottleStatus {
  monthYear: string;
  searchesUsed: number;
  searchesRemaining: number;
  limit: number;
  isThrottled: boolean;
  dailyBudget: number;
  searchesToday: number;
}

export const CANNABIS_QUERY_TEMPLATES = {
  regulation: [
    'California cannabis regulation {topic} {year}',
    'San Francisco dispensary law {topic}',
    'California DCC cannabis {topic}',
  ],
  market: [
    'California cannabis market {topic} {year}',
    'cannabis industry trends {topic}',
    'dispensary market analysis California',
  ],
  competitor: [
    'San Francisco dispensary {topic}',
    'Bay Area cannabis retail {topic}',
  ],
  pricing: [
    'cannabis pricing California {topic}',
    'dispensary pricing strategy {topic}',
  ],
  product: [
    'cannabis product trends {topic} {year}',
    'popular cannabis products California',
  ],
};

export class WebSearchService {
  private readonly SERPAPI_BASE_URL = 'https://serpapi.com/search.json';
  private readonly MONTHLY_LIMIT = 250;
  private readonly CACHE_TTL_HOURS = 24;
  private readonly MAX_PAGES_PER_SEARCH = 5;
  private readonly RESULTS_PER_PAGE = 10;

  async getThrottleStatus(): Promise<ThrottleStatus> {
    const monthYear = this.getCurrentMonthYear();

    const tracker = await prisma.apiUsageTracker.upsert({
      where: { monthYear },
      create: { monthYear, serpApiLimit: this.MONTHLY_LIMIT },
      update: {},
    });

    const daysInMonth = new Date(
      parseInt(monthYear.split('-')[0]),
      parseInt(monthYear.split('-')[1]),
      0
    ).getDate();
    const currentDay = new Date().getDate();
    const daysRemaining = daysInMonth - currentDay + 1;
    const searchesRemaining = tracker.serpApiLimit - tracker.serpApiSearches;
    const dailyBudget = Math.floor(searchesRemaining / daysRemaining);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const searchesToday = await prisma.webResearchCache.count({
      where: { createdAt: { gte: todayStart } },
    });

    return {
      monthYear,
      searchesUsed: tracker.serpApiSearches,
      searchesRemaining,
      limit: tracker.serpApiLimit,
      isThrottled: searchesRemaining <= 0,
      dailyBudget,
      searchesToday,
    };
  }

  async canSearch(): Promise<boolean> {
    const status = await this.getThrottleStatus();
    return !status.isThrottled;
  }

  private async incrementSearchCount(): Promise<void> {
    const monthYear = this.getCurrentMonthYear();
    await prisma.apiUsageTracker.upsert({
      where: { monthYear },
      create: { monthYear, serpApiSearches: 1, serpApiLimit: this.MONTHLY_LIMIT },
      update: { serpApiSearches: { increment: 1 } },
    });
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
  }

  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete('utm_source');
      parsed.searchParams.delete('utm_medium');
      parsed.searchParams.delete('utm_campaign');
      let normalized = parsed.toString();
      normalized = normalized.replace(/^https?:\/\/www\./, 'https://');
      normalized = normalized.replace(/\/$/, '');
      return normalized.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }

  private getCurrentMonthYear(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async isUrlCollected(url: string): Promise<boolean> {
    const normalizedUrl = this.normalizeUrl(url);
    const urlHash = this.hash(normalizedUrl);
    const existing = await prisma.collectedUrl.findUnique({ where: { urlHash } });
    return existing !== null;
  }

  async getCollectedUrlHashes(): Promise<Set<string>> {
    const urls = await prisma.collectedUrl.findMany({ select: { urlHash: true } });
    return new Set(urls.map(u => u.urlHash));
  }

  async storeCollectedUrls(
    results: SearchResult[],
    sourceQuery: string,
    sourceJobId?: string
  ): Promise<number> {
    const newUrls = results.filter(r => r.isNew);
    if (newUrls.length === 0) return 0;

    const urlRecords = newUrls.map(r => {
      let publishedDate: Date | null = null;
      if (r.publishedDate) {
        const parsed = new Date(r.publishedDate);
        if (!isNaN(parsed.getTime())) {
          publishedDate = parsed;
        }
      }
      return {
        url: r.url,
        urlHash: r.urlHash,
        domain: this.extractDomain(r.url),
        title: r.title,
        snippet: r.snippet,
        publishedDate,
        sourceQuery,
        sourceJobId,
        relevanceScore: 0.5,
        categories: [] as string[],
      };
    });

    const result = await prisma.collectedUrl.createMany({
      data: urlRecords,
      skipDuplicates: true,
    });

    return result.count;
  }

  private async checkCache(queryHash: string): Promise<SearchResponse | null> {
    const cached = await prisma.webResearchCache.findUnique({ where: { queryHash } });

    if (!cached || cached.expiresAt < new Date()) {
      if (cached) {
        await prisma.webResearchCache.delete({ where: { queryHash } });
      }
      return null;
    }

    const collectedHashes = await this.getCollectedUrlHashes();
    const results = (cached.resultsJson as Array<{
      position: number;
      title: string;
      link: string;
      snippet: string;
      date?: string;
    }>).map(r => {
      const normalizedUrl = this.normalizeUrl(r.link);
      const urlHash = this.hash(normalizedUrl);
      return {
        position: r.position,
        title: r.title,
        url: r.link,
        snippet: r.snippet,
        urlHash,
        publishedDate: r.date,
        isNew: !collectedHashes.has(urlHash),
      };
    });

    const newResults = results.filter(r => r.isNew);
    const status = await this.getThrottleStatus();

    return {
      query: cached.searchQuery,
      results,
      newResults,
      totalResults: results.length,
      newResultsCount: newResults.length,
      fromCache: true,
      searchesRemaining: status.searchesRemaining,
      searchesUsedThisMonth: status.searchesUsed,
    };
  }

  private async cacheResults(
    query: string,
    queryHash: string,
    results: Array<{ position: number; title: string; link: string; snippet: string; date?: string }>,
    pagesRetrieved: number
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.CACHE_TTL_HOURS);

    const urlHashes = results.map(r => this.hash(this.normalizeUrl(r.link)));

    await prisma.webResearchCache.upsert({
      where: { queryHash },
      create: {
        searchQuery: query,
        queryHash,
        resultsJson: results,
        resultCount: results.length,
        urlHashes,
        pagesRetrieved,
        expiresAt,
      },
      update: {
        resultsJson: results,
        resultCount: results.length,
        urlHashes,
        pagesRetrieved,
        expiresAt,
      },
    });
  }

  private async executeSerpApiSearch(query: string, start: number = 0): Promise<SerpApiResponse> {
    const apiKey = process.env.SERPAPI_API_KEY;

    if (!apiKey) {
      throw new Error('SERPAPI_API_KEY environment variable is not set');
    }

    const params = new URLSearchParams({
      api_key: apiKey,
      engine: 'google',
      q: query,
      start: start.toString(),
      num: this.RESULTS_PER_PAGE.toString(),
      hl: 'en',
      gl: 'us',
    });

    const response = await fetch(`${this.SERPAPI_BASE_URL}?${params}`);

    if (!response.ok) {
      throw new Error(`SerpAPI request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async search(
    query: string,
    options?: { maxPages?: number; skipCache?: boolean; sourceJobId?: string }
  ): Promise<SearchResponse> {
    const { maxPages = this.MAX_PAGES_PER_SEARCH, skipCache = false, sourceJobId } = options || {};

    const normalizedQuery = this.normalizeQuery(query);
    const queryHash = this.hash(normalizedQuery);

    if (!skipCache) {
      const cached = await this.checkCache(queryHash);
      if (cached) return cached;
    }

    const status = await this.getThrottleStatus();
    if (status.isThrottled) {
      throw new Error(`Monthly search limit reached (${status.limit}).`);
    }

    const collectedHashes = await this.getCollectedUrlHashes();
    const allResults: Array<{ position: number; title: string; link: string; snippet: string; date?: string }> = [];
    let pagesRetrieved = 0;

    for (let page = 0; page < maxPages; page++) {
      const start = page * this.RESULTS_PER_PAGE;

      try {
        const response = await this.executeSerpApiSearch(query, start);
        pagesRetrieved++;

        if (response.error) break;

        const organicResults = response.organic_results || [];
        if (organicResults.length === 0) break;

        for (const result of organicResults) {
          allResults.push({
            position: result.position,
            title: result.title,
            link: result.link,
            snippet: result.snippet,
            date: result.date,
          });
        }

        if (!response.serpapi_pagination?.next) break;
      } catch (error) {
        console.error(`Error fetching page ${page}:`, error);
        break;
      }
    }

    await this.incrementSearchCount();
    await this.cacheResults(query, queryHash, allResults, pagesRetrieved);

    const processedResults: SearchResult[] = allResults.map(r => {
      const normalizedUrl = this.normalizeUrl(r.link);
      const urlHash = this.hash(normalizedUrl);
      return {
        position: r.position,
        title: r.title,
        url: r.link,
        snippet: r.snippet,
        urlHash,
        publishedDate: r.date,
        isNew: !collectedHashes.has(urlHash),
      };
    });

    const newResults = processedResults.filter(r => r.isNew);

    if (newResults.length > 0) {
      await this.storeCollectedUrls(processedResults, query, sourceJobId);
    }

    const updatedStatus = await this.getThrottleStatus();

    return {
      query,
      results: processedResults,
      newResults,
      totalResults: processedResults.length,
      newResultsCount: newResults.length,
      fromCache: false,
      searchesRemaining: updatedStatus.searchesRemaining,
      searchesUsedThisMonth: updatedStatus.searchesUsed,
    };
  }

  async getCollectionStats(): Promise<{
    totalUrls: number;
    urlsByDomain: Record<string, number>;
    urlsByCategory: Record<string, number>;
    analyzedCount: number;
    pendingAnalysis: number;
    recentUrls: Array<{ url: string; title: string; createdAt: Date }>;
  }> {
    const [totalUrls, domainCounts, analyzedCount, recentUrls] = await Promise.all([
      prisma.collectedUrl.count(),
      prisma.collectedUrl.groupBy({
        by: ['domain'],
        _count: true,
        orderBy: { _count: { domain: 'desc' } },
        take: 20,
      }),
      prisma.collectedUrl.count({ where: { isAnalyzed: true } }),
      prisma.collectedUrl.findMany({
        select: { url: true, title: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const urlsByDomain: Record<string, number> = {};
    for (const d of domainCounts) {
      urlsByDomain[d.domain] = d._count;
    }

    const allUrls = await prisma.collectedUrl.findMany({ select: { categories: true } });
    const urlsByCategory: Record<string, number> = {};
    for (const u of allUrls) {
      for (const cat of u.categories) {
        urlsByCategory[cat] = (urlsByCategory[cat] || 0) + 1;
      }
    }

    return {
      totalUrls,
      urlsByDomain,
      urlsByCategory,
      analyzedCount,
      pendingAnalysis: totalUrls - analyzedCount,
      recentUrls: recentUrls.map(u => ({
        url: u.url,
        title: u.title || 'Untitled',
        createdAt: u.createdAt,
      })),
    };
  }

  async cleanupExpiredCache(): Promise<number> {
    const result = await prisma.webResearchCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}

export const webSearchService = new WebSearchService();
