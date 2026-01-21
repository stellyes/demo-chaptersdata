// ============================================
// SEO CRAWLER SERVICE
// Crawls websites and analyzes SEO issues
// ============================================

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { v4 as uuidv4 } from 'uuid';

// Types
export type IssuePriority = 'critical' | 'high' | 'medium' | 'low';
export type IssueCategory = 'technical' | 'content' | 'performance' | 'links';

export interface PageIssue {
  id: string;
  code: string;
  category: IssueCategory;
  priority: IssuePriority;
  title: string;
  description: string;
  recommendation: string;
  currentValue?: string;
}

export interface HeadingStructure {
  h1: string[];
  h2: string[];
  h3: string[];
}

export interface ImageInfo {
  src: string;
  alt: string;
  hasAlt: boolean;
}

export interface LinkInfo {
  url: string;
  anchorText: string;
  isFollowed: boolean;
  isBroken?: boolean;
}

export interface CrawledPage {
  url: string;
  statusCode: number;
  responseTime: number;
  title: string;
  titleLength: number;
  metaDescription: string;
  metaDescriptionLength: number;
  metaRobots: string;
  canonicalUrl: string;
  headings: HeadingStructure;
  wordCount: number;
  internalLinks: LinkInfo[];
  externalLinks: LinkInfo[];
  images: ImageInfo[];
  issues: PageIssue[];
  crawledAt: string;
}

export interface AuditConfig {
  maxPages: number;
  checkPerformance: boolean;
  includeExternalLinks: boolean;
}

export interface AuditProgress {
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesAnalyzed: number;
}

export interface AuditSummary {
  healthScore: number;
  totalPages: number;
  totalIssues: number;
  issuesByPriority: Record<IssuePriority, number>;
  issuesByCategory: Record<IssueCategory, number>;
}

// Constants
const REQUEST_TIMEOUT = 15000;
const USER_AGENT = 'ChaptersDataSEOBot/1.0';

// Fetch a page with timeout
async function fetchPage(url: string): Promise<{
  html: string;
  statusCode: number;
  responseTime: number;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    const html = await response.text();
    const responseTime = Date.now() - startTime;

    clearTimeout(timeout);
    return {
      html,
      statusCode: response.status,
      responseTime,
    };
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout for ${url}`);
    }
    throw error;
  }
}

// Extract page data using Cheerio
function extractPageData(
  $: cheerio.CheerioAPI,
  url: string,
  statusCode: number,
  responseTime: number
): Omit<CrawledPage, 'issues'> {
  // Title and Meta
  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';
  const metaRobots = $('meta[name="robots"]').attr('content')?.trim() || '';
  const canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() || '';

  // Headings Structure
  const headings: HeadingStructure = {
    h1: $('h1').map((_: number, el: Element) => $(el).text().trim()).get(),
    h2: $('h2').map((_: number, el: Element) => $(el).text().trim()).get(),
    h3: $('h3').map((_: number, el: Element) => $(el).text().trim()).get(),
  };

  // Word Count (excluding scripts/styles)
  const $clone = $.root().clone();
  $clone.find('script, style, noscript').remove();
  const bodyText = $clone.find('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(/\s+/).filter((w: string) => w.length > 0).length;

  // Links
  const internalLinks: LinkInfo[] = [];
  const externalLinks: LinkInfo[] = [];
  const urlObj = new URL(url);

  $('a[href]').each((_: number, el: Element) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const linkUrl = new URL(href, url);
      const anchorText = $(el).text().trim().substring(0, 200);
      const rel = $(el).attr('rel') || '';
      const isFollowed = !rel.includes('nofollow');

      const linkInfo: LinkInfo = {
        url: linkUrl.href,
        anchorText,
        isFollowed,
      };

      if (linkUrl.hostname === urlObj.hostname) {
        internalLinks.push(linkInfo);
      } else {
        externalLinks.push(linkInfo);
      }
    } catch {
      // Invalid URL, skip
    }
  });

  // Images
  const images: ImageInfo[] = [];
  $('img').each((_: number, el: Element) => {
    const src = $(el).attr('src');
    if (!src) return;

    images.push({
      src: src.substring(0, 500),
      alt: $(el).attr('alt') || '',
      hasAlt: !!$(el).attr('alt'),
    });
  });

  return {
    url,
    statusCode,
    responseTime,
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    metaRobots,
    canonicalUrl,
    headings,
    wordCount,
    internalLinks: internalLinks.slice(0, 100),
    externalLinks: externalLinks.slice(0, 50),
    images: images.slice(0, 50),
    crawledAt: new Date().toISOString(),
  };
}

// Analyze SEO issues for a page
export function analyzeIssues(page: Omit<CrawledPage, 'issues'>): PageIssue[] {
  const issues: PageIssue[] = [];

  // TITLE ISSUES
  if (!page.title) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_001',
      category: 'technical',
      priority: 'critical',
      title: 'Missing Title Tag',
      description: 'This page does not have a title tag.',
      recommendation: 'Add a unique, descriptive title tag between 50-60 characters.',
    });
  } else if (page.titleLength < 30) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_003',
      category: 'technical',
      priority: 'medium',
      title: 'Title Too Short',
      description: `Title is only ${page.titleLength} characters. Should be 50-60 characters.`,
      recommendation: 'Expand the title with relevant keywords and descriptive text.',
      currentValue: page.title,
    });
  } else if (page.titleLength > 60) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_002',
      category: 'technical',
      priority: 'medium',
      title: 'Title Too Long',
      description: `Title is ${page.titleLength} characters. Google typically displays 50-60 characters.`,
      recommendation: 'Shorten the title to under 60 characters to prevent truncation.',
      currentValue: page.title,
    });
  }

  // META DESCRIPTION ISSUES
  if (!page.metaDescription) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_005',
      category: 'technical',
      priority: 'high',
      title: 'Missing Meta Description',
      description: 'This page does not have a meta description.',
      recommendation: 'Add a compelling meta description between 150-160 characters.',
    });
  } else if (page.metaDescriptionLength < 70) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_007',
      category: 'technical',
      priority: 'low',
      title: 'Meta Description Too Short',
      description: `Meta description is only ${page.metaDescriptionLength} characters.`,
      recommendation: 'Expand to 150-160 characters for better search visibility.',
      currentValue: page.metaDescription,
    });
  } else if (page.metaDescriptionLength > 160) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_006',
      category: 'technical',
      priority: 'low',
      title: 'Meta Description Too Long',
      description: `Meta description is ${page.metaDescriptionLength} characters.`,
      recommendation: 'Shorten to under 160 characters to prevent truncation.',
      currentValue: page.metaDescription.substring(0, 200),
    });
  }

  // H1 ISSUES
  if (page.headings.h1.length === 0) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_008',
      category: 'technical',
      priority: 'high',
      title: 'Missing H1 Tag',
      description: 'This page does not have an H1 heading.',
      recommendation: 'Add a single H1 tag that describes the main topic of the page.',
    });
  } else if (page.headings.h1.length > 1) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_009',
      category: 'technical',
      priority: 'medium',
      title: 'Multiple H1 Tags',
      description: `This page has ${page.headings.h1.length} H1 tags.`,
      recommendation: 'Use only one H1 tag per page for better SEO.',
      currentValue: page.headings.h1.join(', '),
    });
  }

  // IMAGE ALT TEXT ISSUES
  const imagesWithoutAlt = page.images.filter(img => !img.hasAlt);
  if (imagesWithoutAlt.length > 0) {
    issues.push({
      id: uuidv4(),
      code: 'CONT_002',
      category: 'content',
      priority: imagesWithoutAlt.length > 5 ? 'high' : 'medium',
      title: 'Images Missing Alt Text',
      description: `${imagesWithoutAlt.length} image(s) are missing alt text.`,
      recommendation: 'Add descriptive alt text to all images for accessibility and SEO.',
      currentValue: `${imagesWithoutAlt.length} images`,
    });
  }

  // CONTENT ISSUES
  if (page.wordCount < 300) {
    issues.push({
      id: uuidv4(),
      code: 'CONT_001',
      category: 'content',
      priority: page.wordCount < 100 ? 'high' : 'medium',
      title: 'Thin Content',
      description: `Page has only ${page.wordCount} words.`,
      recommendation: 'Add more valuable, relevant content (aim for 500+ words for main pages).',
      currentValue: `${page.wordCount} words`,
    });
  }

  // RESPONSE TIME ISSUES
  if (page.responseTime > 3000) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_018',
      category: 'performance',
      priority: page.responseTime > 5000 ? 'high' : 'medium',
      title: 'Slow Server Response',
      description: `Server responded in ${page.responseTime}ms.`,
      recommendation: 'Optimize server response time to under 200ms.',
      currentValue: `${page.responseTime}ms`,
    });
  }

  // HTTPS ISSUES
  if (page.url.startsWith('http://')) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_017',
      category: 'technical',
      priority: 'critical',
      title: 'Not Using HTTPS',
      description: 'This page is served over HTTP instead of HTTPS.',
      recommendation: 'Migrate to HTTPS for security and SEO benefits.',
    });
  }

  // NOINDEX CHECK
  if (page.metaRobots.toLowerCase().includes('noindex')) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_013',
      category: 'technical',
      priority: 'high',
      title: 'Page Set to Noindex',
      description: 'This page has a noindex directive.',
      recommendation: 'Remove noindex if this page should be indexed by search engines.',
      currentValue: page.metaRobots,
    });
  }

  // CANONICAL ISSUES
  if (!page.canonicalUrl) {
    issues.push({
      id: uuidv4(),
      code: 'TECH_010',
      category: 'technical',
      priority: 'medium',
      title: 'Missing Canonical Tag',
      description: 'This page does not have a canonical URL defined.',
      recommendation: 'Add a canonical tag to prevent duplicate content issues.',
    });
  }

  // INTERNAL LINKS ISSUES
  if (page.internalLinks.length < 3) {
    issues.push({
      id: uuidv4(),
      code: 'LINK_001',
      category: 'links',
      priority: 'medium',
      title: 'Few Internal Links',
      description: `Page has only ${page.internalLinks.length} internal links.`,
      recommendation: 'Add more internal links to improve site navigation and SEO.',
      currentValue: `${page.internalLinks.length} internal links`,
    });
  }

  return issues;
}

// Extract internal links for crawling
export function extractCrawlableLinks(
  $: cheerio.CheerioAPI,
  currentUrl: string,
  baseDomain: string
): string[] {
  const links: Set<string> = new Set();
  const urlObj = new URL(currentUrl);

  $('a[href]').each((_: number, el: Element) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const linkUrl = new URL(href, currentUrl);

      // Only internal links
      if (linkUrl.hostname !== baseDomain && linkUrl.hostname !== urlObj.hostname) return;

      // Skip non-HTML resources
      const path = linkUrl.pathname.toLowerCase();
      if (
        path.endsWith('.pdf') ||
        path.endsWith('.jpg') ||
        path.endsWith('.jpeg') ||
        path.endsWith('.png') ||
        path.endsWith('.gif') ||
        path.endsWith('.css') ||
        path.endsWith('.js') ||
        path.endsWith('.xml')
      ) return;

      // Skip common non-content paths
      if (
        path.includes('/wp-admin') ||
        path.includes('/admin') ||
        path.includes('/login') ||
        path.includes('/cart') ||
        path.includes('/checkout')
      ) return;

      // Normalize URL (remove fragment, trailing slash)
      linkUrl.hash = '';
      let normalizedUrl = linkUrl.href;
      if (normalizedUrl.endsWith('/') && normalizedUrl !== `${linkUrl.origin}/`) {
        normalizedUrl = normalizedUrl.slice(0, -1);
      }

      links.add(normalizedUrl);
    } catch {
      // Invalid URL, skip
    }
  });

  return Array.from(links);
}

// Crawl a single page
export async function crawlPage(url: string): Promise<CrawledPage> {
  const fetchResult = await fetchPage(url);
  const $ = cheerio.load(fetchResult.html);

  const pageData = extractPageData($, url, fetchResult.statusCode, fetchResult.responseTime);
  const issues = analyzeIssues(pageData);

  return {
    ...pageData,
    issues,
  };
}

// Calculate audit summary
export function calculateAuditSummary(pages: CrawledPage[]): AuditSummary {
  const issuesByPriority: Record<IssuePriority, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  const issuesByCategory: Record<IssueCategory, number> = {
    technical: 0,
    content: 0,
    performance: 0,
    links: 0,
  };

  let totalIssues = 0;

  for (const page of pages) {
    for (const issue of page.issues) {
      totalIssues++;
      issuesByPriority[issue.priority]++;
      issuesByCategory[issue.category]++;
    }
  }

  // Calculate health score (0-100) with weighted priorities
  const maxPossibleIssues = Math.max(pages.length * 10, 1);
  const weightedIssues =
    issuesByPriority.critical * 4 +
    issuesByPriority.high * 2 +
    issuesByPriority.medium * 1 +
    issuesByPriority.low * 0.25;
  const healthScore = Math.max(0, Math.round(100 - (weightedIssues / maxPossibleIssues) * 100));

  return {
    healthScore,
    totalPages: pages.length,
    totalIssues,
    issuesByPriority,
    issuesByCategory,
  };
}

// Run a full audit (simplified for single-request)
export async function runSimpleAudit(
  startUrl: string,
  maxPages: number = 10
): Promise<{
  pages: CrawledPage[];
  summary: AuditSummary;
}> {
  const crawledUrls = new Set<string>();
  const pages: CrawledPage[] = [];
  const toVisit: string[] = [startUrl];
  const urlObj = new URL(startUrl);
  const baseDomain = urlObj.hostname;

  while (toVisit.length > 0 && pages.length < maxPages) {
    const url = toVisit.shift()!;

    // Skip if already crawled
    if (crawledUrls.has(url)) continue;
    crawledUrls.add(url);

    try {
      console.log(`Crawling: ${url}`);
      const page = await crawlPage(url);
      pages.push(page);

      // Extract new links to crawl
      const fetchResult = await fetchPage(url);
      const $ = cheerio.load(fetchResult.html);
      const newLinks = extractCrawlableLinks($, url, baseDomain);

      for (const link of newLinks) {
        if (!crawledUrls.has(link) && !toVisit.includes(link)) {
          toVisit.push(link);
        }
      }
    } catch (error) {
      console.error(`Failed to crawl ${url}:`, error);
    }
  }

  const summary = calculateAuditSummary(pages);

  return { pages, summary };
}
