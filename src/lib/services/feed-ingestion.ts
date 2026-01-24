// ============================================
// FEED INGESTION SERVICE
// Fetches and processes RSS feeds from industry sources
// for the Progressive Learning System
// ============================================

import { prisma } from '@/lib/prisma';
import { getAnthropicClient } from './claude';
import { CLAUDE_CONFIG } from '@/lib/config';

// Feed Ingestion Configuration
export const FEED_CONFIG = {
  fetchTimeoutMs: 30000,
  maxItemsPerFeed: 50,
  relevanceThreshold: 0.5,
  maxItemsToProcess: 20, // Max items to analyze per batch
  cacheExpirationHours: 24,
};

// Pre-configured industry feeds
export const INDUSTRY_FEEDS = [
  {
    name: 'MJBizDaily',
    feedUrl: 'https://mjbizdaily.com/feed/',
    category: 'industry',
    description: 'Cannabis industry news and business intelligence',
  },
  {
    name: 'Cannabis Business Times',
    feedUrl: 'https://www.cannabisbusinesstimes.com/rss/',
    category: 'industry',
    description: 'Cannabis cultivation and retail business news',
  },
  {
    name: 'Leafly News',
    feedUrl: 'https://www.leafly.com/news/feed',
    category: 'market',
    description: 'Consumer cannabis news and market trends',
  },
  {
    name: 'Green Market Report',
    feedUrl: 'https://www.greenmarketreport.com/feed/',
    category: 'market',
    description: 'Cannabis financial and market analysis',
  },
];

// California regulatory feeds (when available)
export const REGULATORY_FEEDS = [
  {
    name: 'CA DCC News',
    feedUrl: 'https://cannabis.ca.gov/feed/', // May need adjustment
    category: 'regulatory',
    description: 'California Department of Cannabis Control updates',
  },
];

interface FeedItem {
  guid: string;
  title: string;
  link: string;
  publishedAt: Date;
  summary?: string;
  categories?: string[];
  author?: string;
}

interface ParsedFeed {
  success: boolean;
  items: FeedItem[];
  error?: string;
}

interface RelevanceResult {
  relevanceScore: number;
  categories: string[];
  summary: string;
  keyEntities: string[];
}

export class FeedIngestionService {
  private client = getAnthropicClient();

  /**
   * Fetches and parses an RSS feed.
   */
  private async fetchFeed(feedUrl: string): Promise<ParsedFeed> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FEED_CONFIG.fetchTimeoutMs);

      const response = await fetch(feedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'ChaptersData/1.0 (+https://chapters-data.com)',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return { success: false, items: [], error: `HTTP ${response.status}` };
      }

      const xml = await response.text();
      const items = this.parseRssFeed(xml);

      return { success: true, items };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: error instanceof Error ? error.message : 'Unknown fetch error',
      };
    }
  }

  /**
   * Basic RSS XML parser.
   * In production, consider using a proper XML parsing library.
   */
  private parseRssFeed(xml: string): FeedItem[] {
    const items: FeedItem[] = [];

    // Extract items using regex (basic implementation)
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

    for (const itemXml of itemMatches.slice(0, FEED_CONFIG.maxItemsPerFeed)) {
      try {
        const title = this.extractTag(itemXml, 'title');
        const link = this.extractTag(itemXml, 'link');
        const guid = this.extractTag(itemXml, 'guid') || link;
        const pubDate = this.extractTag(itemXml, 'pubDate');
        const description = this.extractTag(itemXml, 'description');
        const author = this.extractTag(itemXml, 'author') || this.extractTag(itemXml, 'dc:creator');

        // Extract categories
        const categoryMatches = itemXml.match(/<category[^>]*>([^<]+)<\/category>/gi) || [];
        const categories = categoryMatches.map(cat => {
          const match = cat.match(/>([^<]+)</);
          return match ? this.decodeHtmlEntities(match[1]) : '';
        }).filter(Boolean);

        if (title && link && guid) {
          items.push({
            guid,
            title: this.decodeHtmlEntities(title),
            link,
            publishedAt: pubDate ? new Date(pubDate) : new Date(),
            summary: description ? this.cleanSummary(description) : undefined,
            categories,
            author: author ? this.decodeHtmlEntities(author) : undefined,
          });
        }
      } catch {
        // Skip malformed items
        continue;
      }
    }

    return items;
  }

  /**
   * Extracts content from an XML tag.
   */
  private extractTag(xml: string, tagName: string): string | null {
    // Handle CDATA sections
    const cdataPattern = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
    const cdataMatch = xml.match(cdataPattern);
    if (cdataMatch) {
      return cdataMatch[1].trim();
    }

    // Handle regular content
    const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = xml.match(pattern);
    return match ? match[1].trim() : null;
  }

  /**
   * Decodes HTML entities in text.
   */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
  }

  /**
   * Cleans and truncates summary text.
   */
  private cleanSummary(html: string): string {
    // Remove HTML tags
    let text = html.replace(/<[^>]+>/g, ' ');
    // Decode entities
    text = this.decodeHtmlEntities(text);
    // Clean whitespace
    text = text.replace(/\s+/g, ' ').trim();
    // Truncate
    return text.substring(0, 500);
  }

  /**
   * Scores relevance of a feed item for cannabis retail business.
   */
  private async scoreRelevance(item: FeedItem): Promise<RelevanceResult> {
    const prompt = `Analyze this news article for relevance to a California cannabis dispensary business.

TITLE: ${item.title}
SUMMARY: ${item.summary || 'No summary available'}
CATEGORIES: ${item.categories?.join(', ') || 'None'}
SOURCE DATE: ${item.publishedAt.toISOString().split('T')[0]}

Score the relevance (0.0-1.0) based on:
- California cannabis retail operations
- Regulatory changes affecting dispensaries
- Market trends impacting sales
- Competitor/industry movements
- Pricing or supply chain updates

Return JSON only:
{
  "relevanceScore": 0.0-1.0,
  "categories": ["regulatory", "market", "operations", "competition", "general"],
  "summary": "One sentence business impact summary",
  "keyEntities": ["brands, companies, or regulations mentioned"]
}`;

    try {
      const response = await this.client.messages.create({
        model: CLAUDE_CONFIG.haiku,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      const text = textContent?.type === 'text' ? textContent.text : '{}';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          relevanceScore: parsed.relevanceScore || 0,
          categories: parsed.categories || [],
          summary: parsed.summary || '',
          keyEntities: parsed.keyEntities || [],
        };
      }
    } catch (error) {
      console.error('Error scoring relevance:', error);
    }

    // Default low relevance on error
    return {
      relevanceScore: 0.3,
      categories: ['general'],
      summary: item.title,
      keyEntities: [],
    };
  }

  /**
   * Ensures a feed is registered in the database.
   */
  async ensureFeedRegistered(feed: {
    name: string;
    feedUrl: string;
    category: string;
    description?: string;
  }): Promise<string> {
    const existing = await prisma.externalFeed.findUnique({
      where: { name: feed.name },
    });

    if (existing) {
      return existing.id;
    }

    const created = await prisma.externalFeed.create({
      data: {
        name: feed.name,
        feedUrl: feed.feedUrl,
        feedType: 'rss',
        category: feed.category,
        description: feed.description,
        isActive: true,
      },
    });

    return created.id;
  }

  /**
   * Fetches and processes a single feed.
   */
  async processFeed(feedId: string): Promise<{
    success: boolean;
    newItems: number;
    processedItems: number;
    error?: string;
  }> {
    const feed = await prisma.externalFeed.findUnique({
      where: { id: feedId },
    });

    if (!feed) {
      return { success: false, newItems: 0, processedItems: 0, error: 'Feed not found' };
    }

    // Fetch the feed
    const fetchResult = await this.fetchFeed(feed.feedUrl);

    // Update feed status
    await prisma.externalFeed.update({
      where: { id: feedId },
      data: {
        lastFetched: new Date(),
        lastSuccessful: fetchResult.success ? new Date() : feed.lastSuccessful,
        lastError: fetchResult.error || null,
        errorCount: fetchResult.success ? 0 : { increment: 1 },
      },
    });

    if (!fetchResult.success) {
      return { success: false, newItems: 0, processedItems: 0, error: fetchResult.error };
    }

    // Process items
    let newItems = 0;
    let processedItems = 0;

    for (const item of fetchResult.items) {
      // Check if item already exists
      const existing = await prisma.externalFeedItem.findUnique({
        where: { guid: item.guid },
      });

      if (existing) {
        continue;
      }

      // Create new item
      await prisma.externalFeedItem.create({
        data: {
          feedId: feed.id,
          guid: item.guid,
          title: item.title,
          link: item.link,
          publishedAt: item.publishedAt,
          summary: item.summary,
          author: item.author,
          categories: item.categories || [],
          isProcessed: false,
        },
      });

      newItems++;
    }

    // Score relevance for unprocessed items
    const unprocessedItems = await prisma.externalFeedItem.findMany({
      where: {
        feedId: feed.id,
        isProcessed: false,
      },
      orderBy: { publishedAt: 'desc' },
      take: FEED_CONFIG.maxItemsToProcess,
    });

    for (const item of unprocessedItems) {
      const relevance = await this.scoreRelevance({
        guid: item.guid,
        title: item.title,
        link: item.link,
        publishedAt: item.publishedAt,
        summary: item.summary || undefined,
        categories: item.categories,
      });

      await prisma.externalFeedItem.update({
        where: { id: item.id },
        data: {
          isProcessed: true,
          relevanceScore: relevance.relevanceScore,
          analyzedCategories: relevance.categories,
          businessImpact: relevance.summary,
          keyEntities: relevance.keyEntities,
        },
      });

      processedItems++;
    }

    return { success: true, newItems, processedItems };
  }

  /**
   * Processes all active feeds.
   */
  async processAllFeeds(): Promise<{
    feedsProcessed: number;
    totalNewItems: number;
    totalProcessedItems: number;
    errors: Array<{ feedName: string; error: string }>;
  }> {
    const activeFeeds = await prisma.externalFeed.findMany({
      where: { isActive: true },
    });

    let feedsProcessed = 0;
    let totalNewItems = 0;
    let totalProcessedItems = 0;
    const errors: Array<{ feedName: string; error: string }> = [];

    for (const feed of activeFeeds) {
      const result = await this.processFeed(feed.id);

      if (result.success) {
        feedsProcessed++;
        totalNewItems += result.newItems;
        totalProcessedItems += result.processedItems;
      } else {
        errors.push({ feedName: feed.name, error: result.error || 'Unknown error' });
      }
    }

    return { feedsProcessed, totalNewItems, totalProcessedItems, errors };
  }

  /**
   * Initializes default industry feeds.
   */
  async initializeDefaultFeeds(): Promise<number> {
    let registered = 0;

    for (const feed of [...INDUSTRY_FEEDS, ...REGULATORY_FEEDS]) {
      await this.ensureFeedRegistered(feed);
      registered++;
    }

    return registered;
  }

  /**
   * Gets relevant feed items for the daily learning context.
   */
  async getRelevantFeedItems(options: {
    minRelevance?: number;
    categories?: string[];
    sinceDaysAgo?: number;
    limit?: number;
  } = {}): Promise<Array<{
    title: string;
    link: string;
    summary: string;
    businessImpact: string | null;
    relevanceScore: number;
    publishedAt: Date;
    feedName: string;
    categories: string[];
  }>> {
    const {
      minRelevance = FEED_CONFIG.relevanceThreshold,
      categories,
      sinceDaysAgo = 7,
      limit = 20,
    } = options;

    const since = new Date();
    since.setDate(since.getDate() - sinceDaysAgo);

    const items = await prisma.externalFeedItem.findMany({
      where: {
        isProcessed: true,
        relevanceScore: { gte: minRelevance },
        publishedAt: { gte: since },
        ...(categories && categories.length > 0 ? {
          analyzedCategories: { hasSome: categories },
        } : {}),
      },
      orderBy: [
        { relevanceScore: 'desc' },
        { publishedAt: 'desc' },
      ],
      take: limit,
      include: {
        feed: {
          select: { name: true },
        },
      },
    });

    return items.map(item => ({
      title: item.title,
      link: item.link,
      summary: item.summary || '',
      businessImpact: item.businessImpact,
      relevanceScore: item.relevanceScore || 0,
      publishedAt: item.publishedAt,
      feedName: item.feed.name,
      categories: item.analyzedCategories,
    }));
  }

  /**
   * Gets feed ingestion statistics.
   */
  async getStats(): Promise<{
    totalFeeds: number;
    activeFeeds: number;
    totalItems: number;
    processedItems: number;
    highRelevanceItems: number;
    feedStatus: Array<{
      name: string;
      category: string;
      isActive: boolean;
      lastFetched: Date | null;
      itemCount: number;
      errorCount: number;
    }>;
  }> {
    const [
      totalFeeds,
      activeFeeds,
      totalItems,
      processedItems,
      highRelevanceItems,
    ] = await Promise.all([
      prisma.externalFeed.count(),
      prisma.externalFeed.count({ where: { isActive: true } }),
      prisma.externalFeedItem.count(),
      prisma.externalFeedItem.count({ where: { isProcessed: true } }),
      prisma.externalFeedItem.count({
        where: {
          relevanceScore: { gte: FEED_CONFIG.relevanceThreshold },
        },
      }),
    ]);

    const feeds = await prisma.externalFeed.findMany({
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    return {
      totalFeeds,
      activeFeeds,
      totalItems,
      processedItems,
      highRelevanceItems,
      feedStatus: feeds.map(feed => ({
        name: feed.name,
        category: feed.category,
        isActive: feed.isActive,
        lastFetched: feed.lastFetched,
        itemCount: feed._count.items,
        errorCount: feed.errorCount,
      })),
    };
  }

  /**
   * Cleans up old, low-relevance feed items.
   */
  async cleanupOldItems(daysToKeep: number = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    // Keep high-relevance items longer
    const result = await prisma.externalFeedItem.deleteMany({
      where: {
        publishedAt: { lt: cutoff },
        OR: [
          { relevanceScore: { lt: FEED_CONFIG.relevanceThreshold } },
          { relevanceScore: null },
        ],
      },
    });

    return result.count;
  }
}

export const feedIngestionService = new FeedIngestionService();
