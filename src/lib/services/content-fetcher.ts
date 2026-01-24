// ============================================
// CONTENT FETCHER SERVICE
// Fetches and analyzes content from collected URLs
// to build persistent web research memory
// ============================================

import { prisma } from '@/lib/prisma';
import { getAnthropicClient } from './claude';
import { CLAUDE_CONFIG } from '@/lib/config';

// Content Fetcher Configuration
export const CONTENT_FETCHER_CONFIG = {
  maxContentLength: 50000, // Max characters to process
  summaryMaxLength: 1000, // Max summary length
  batchSize: 10, // URLs to process per batch
  minRelevanceScore: 0.5, // Minimum relevance to process
  blockedDomains: [
    'reddit.com',
    'facebook.com',
    'twitter.com',
    'instagram.com',
    'linkedin.com',
    'tiktok.com',
  ],
  trustedDomains: [
    'cannabis.ca.gov',
    'mjbizdaily.com',
    'leafly.com',
    'weedmaps.com',
    'cannabisbusinesstimes.com',
    'greenmarketreport.com',
    'sfchronicle.com',
    'sf.gov',
  ],
};

// Domain category mapping
const DOMAIN_CATEGORIES: Record<string, string> = {
  'cannabis.ca.gov': 'government',
  'sf.gov': 'government',
  'fda.gov': 'government',
  'mjbizdaily.com': 'trade',
  'cannabisbusinesstimes.com': 'trade',
  'greenmarketreport.com': 'trade',
  'leafly.com': 'industry',
  'weedmaps.com': 'industry',
  'sfchronicle.com': 'news',
  'sfgate.com': 'news',
};

interface ContentAnalysisResult {
  success: boolean;
  summaryText?: string;
  keyPoints?: string[];
  mentionedEntities?: string[];
  contentQuality?: 'high' | 'medium' | 'low' | 'garbage';
  error?: string;
}

interface FetchResult {
  success: boolean;
  content?: string;
  error?: string;
}

export class ContentFetcherService {
  private client = getAnthropicClient();

  /**
   * Fetches URL content using a simple fetch approach.
   * In production, consider using a headless browser for JavaScript-rendered content.
   */
  private async fetchUrlContent(url: string): Promise<FetchResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ChaptersDataBot/1.0; +https://chapters-data.com)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return { success: false, error: `Unsupported content type: ${contentType}` };
      }

      const html = await response.text();

      // Basic HTML text extraction (in production, use a proper HTML parser)
      const textContent = this.extractTextFromHtml(html);

      if (textContent.length < 100) {
        return { success: false, error: 'Content too short' };
      }

      return {
        success: true,
        content: textContent.substring(0, CONTENT_FETCHER_CONFIG.maxContentLength),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown fetch error',
      };
    }
  }

  /**
   * Basic HTML to text extraction.
   * Removes scripts, styles, and HTML tags.
   */
  private extractTextFromHtml(html: string): string {
    // Remove script and style elements
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

    // Replace common block elements with newlines
    text = text
      .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    return text;
  }

  /**
   * Analyzes content using Claude to extract summary and key points.
   */
  private async analyzeContent(
    url: string,
    content: string,
    domain: string
  ): Promise<ContentAnalysisResult> {
    const prompt = `Analyze this web content for a cannabis dispensary business intelligence system.

URL: ${url}
DOMAIN: ${domain}

CONTENT:
${content.substring(0, 15000)}

Extract:
1. A concise summary (2-3 sentences) of the main points relevant to cannabis retail
2. Key points as bullet points (3-7 points)
3. Named entities mentioned (brands, companies, regulations, locations)
4. Content quality assessment

Return JSON:
{
  "summaryText": "2-3 sentence summary",
  "keyPoints": ["point 1", "point 2", ...],
  "mentionedEntities": ["entity 1", "entity 2", ...],
  "contentQuality": "high|medium|low|garbage",
  "relevanceToCannabisBusiness": 0.0-1.0
}

If content is not relevant to cannabis/dispensary business, set relevanceToCannabisBusiness to 0.
Return ONLY valid JSON.`;

    try {
      const response = await this.client.messages.create({
        model: CLAUDE_CONFIG.haiku,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      const text = textContent?.type === 'text' ? textContent.text : '{}';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          summaryText: parsed.summaryText,
          keyPoints: parsed.keyPoints || [],
          mentionedEntities: parsed.mentionedEntities || [],
          contentQuality: parsed.contentQuality || 'medium',
        };
      }

      return { success: false, error: 'Failed to parse analysis response' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Analysis error',
      };
    }
  }

  /**
   * Fetches and analyzes a single URL, updating the database.
   */
  async fetchAndAnalyzeUrl(urlId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const urlRecord = await prisma.collectedUrl.findUnique({
      where: { id: urlId },
    });

    if (!urlRecord) {
      return { success: false, error: 'URL not found' };
    }

    // Check if domain is blocked
    if (CONTENT_FETCHER_CONFIG.blockedDomains.some(d => urlRecord.domain.includes(d))) {
      await prisma.collectedUrl.update({
        where: { id: urlId },
        data: {
          fetchError: 'Domain blocked',
          isFetched: true,
        },
      });
      return { success: false, error: 'Domain blocked' };
    }

    // Fetch content
    const fetchResult = await this.fetchUrlContent(urlRecord.url);

    if (!fetchResult.success) {
      await prisma.collectedUrl.update({
        where: { id: urlId },
        data: {
          fetchError: fetchResult.error,
          isFetched: true,
        },
      });
      return { success: false, error: fetchResult.error };
    }

    // Analyze content
    const analysis = await this.analyzeContent(
      urlRecord.url,
      fetchResult.content!,
      urlRecord.domain
    );

    if (!analysis.success) {
      await prisma.collectedUrl.update({
        where: { id: urlId },
        data: {
          fetchError: analysis.error,
          isFetched: true,
        },
      });
      return { success: false, error: analysis.error };
    }

    // Get or create domain trust score
    const trustScore = await this.getDomainTrustScore(urlRecord.domain);

    // Update URL record with analysis
    await prisma.collectedUrl.update({
      where: { id: urlId },
      data: {
        fullContent: fetchResult.content,
        summaryText: analysis.summaryText,
        keyPoints: analysis.keyPoints || [],
        mentionedEntities: analysis.mentionedEntities || [],
        contentQuality: analysis.contentQuality,
        trustScore,
        isFetched: true,
        isAnalyzed: true,
        lastVerified: new Date(),
        verificationCount: { increment: 1 },
      },
    });

    // Update domain registry
    await this.updateDomainStats(urlRecord.domain);

    return { success: true };
  }

  /**
   * Batch processes unanalyzed URLs.
   */
  async batchProcessUrls(limit: number = CONTENT_FETCHER_CONFIG.batchSize): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const urls = await prisma.collectedUrl.findMany({
      where: {
        isAnalyzed: false,
        isFetched: false,
        relevanceScore: { gte: CONTENT_FETCHER_CONFIG.minRelevanceScore },
      },
      orderBy: [
        { relevanceScore: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
      select: { id: true },
    });

    let succeeded = 0;
    let failed = 0;

    for (const url of urls) {
      const result = await this.fetchAndAnalyzeUrl(url.id);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      processed: urls.length,
      succeeded,
      failed,
    };
  }

  /**
   * Gets or creates domain trust score.
   */
  private async getDomainTrustScore(domain: string): Promise<number> {
    // Check if domain is in trusted list
    if (CONTENT_FETCHER_CONFIG.trustedDomains.some(d => domain.includes(d))) {
      return 0.9;
    }

    // Check domain registry
    const registry = await prisma.domainTrustRegistry.findUnique({
      where: { domain },
    });

    if (registry) {
      return registry.trustScore;
    }

    // Create new registry entry with default score
    const category = DOMAIN_CATEGORIES[domain] || 'unknown';
    const defaultScore = category === 'government' ? 0.95 :
                        category === 'trade' ? 0.8 :
                        category === 'news' ? 0.7 :
                        category === 'industry' ? 0.75 : 0.5;

    await prisma.domainTrustRegistry.create({
      data: {
        domain,
        category,
        trustScore: defaultScore,
        isAuthoritative: category === 'government',
        urlsCollected: 1,
      },
    });

    return defaultScore;
  }

  /**
   * Updates domain statistics after processing a URL.
   */
  private async updateDomainStats(domain: string): Promise<void> {
    try {
      // Get average content quality for domain
      const urls = await prisma.collectedUrl.findMany({
        where: {
          domain,
          isAnalyzed: true,
        },
        select: {
          contentQuality: true,
        },
      });

      const qualityScores: number[] = urls.map(u => {
        switch (u.contentQuality) {
          case 'high': return 1.0;
          case 'medium': return 0.6;
          case 'low': return 0.3;
          case 'garbage': return 0.0;
          default: return 0.5;
        }
      });

      const avgQuality = qualityScores.length > 0
        ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
        : 0.5;

      await prisma.domainTrustRegistry.update({
        where: { domain },
        data: {
          urlsCollected: urls.length,
          avgContentQuality: avgQuality,
        },
      });
    } catch (error) {
      // Domain may not exist in registry yet
      console.error(`Error updating domain stats for ${domain}:`, error);
    }
  }

  /**
   * Gets statistics about content fetching status.
   */
  async getStats(): Promise<{
    totalUrls: number;
    analyzedUrls: number;
    pendingUrls: number;
    failedUrls: number;
    topDomains: Array<{ domain: string; count: number; trustScore: number }>;
  }> {
    const [total, analyzed, pending, failed] = await Promise.all([
      prisma.collectedUrl.count(),
      prisma.collectedUrl.count({ where: { isAnalyzed: true } }),
      prisma.collectedUrl.count({ where: { isAnalyzed: false, isFetched: false } }),
      prisma.collectedUrl.count({ where: { isFetched: true, isAnalyzed: false } }),
    ]);

    const topDomains = await prisma.domainTrustRegistry.findMany({
      orderBy: { urlsCollected: 'desc' },
      take: 10,
      select: {
        domain: true,
        urlsCollected: true,
        trustScore: true,
      },
    });

    return {
      totalUrls: total,
      analyzedUrls: analyzed,
      pendingUrls: pending,
      failedUrls: failed,
      topDomains: topDomains.map(d => ({
        domain: d.domain,
        count: d.urlsCollected,
        trustScore: d.trustScore,
      })),
    };
  }
}

export const contentFetcherService = new ContentFetcherService();
