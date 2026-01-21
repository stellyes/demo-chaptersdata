// ============================================
// SEO AUDITS API ROUTE
// List and create SEO audits
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { runSimpleAudit } from '@/lib/services/seo-crawler';

// GET - List all audits
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const domain = url.searchParams.get('domain');
    const limit = parseInt(url.searchParams.get('limit') || '20');

    const audits = await prisma.seoAudit.findMany({
      where: domain ? { domain } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        domain: true,
        status: true,
        createdAt: true,
        completedAt: true,
        summary: true,
        progress: true,
        _count: {
          select: { pages: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: audits.map((audit) => ({
        ...audit,
        pageCount: audit._count.pages,
      })),
    });
  } catch (error) {
    console.error('Error fetching SEO audits:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch audits' },
      { status: 500 }
    );
  }
}

// POST - Create a new audit and start crawling
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { domain, maxPages = 10, checkPerformance = false } = body;

    if (!domain) {
      return NextResponse.json(
        { success: false, error: 'Domain is required' },
        { status: 400 }
      );
    }

    // Normalize domain
    let normalizedUrl = domain;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    const urlObj = new URL(normalizedUrl);
    const baseDomain = urlObj.hostname;

    // Create audit record
    const audit = await prisma.seoAudit.create({
      data: {
        domain: baseDomain,
        status: 'crawling',
        config: {
          maxPages,
          checkPerformance,
          startUrl: normalizedUrl,
        },
        progress: {
          pagesDiscovered: 0,
          pagesCrawled: 0,
          pagesAnalyzed: 0,
        },
      },
    });

    // Run the audit synchronously (for simplicity - could be queued for production)
    try {
      const { pages, summary } = await runSimpleAudit(normalizedUrl, maxPages);

      // Save pages to database
      for (const page of pages) {
        await prisma.seoAuditPage.create({
          data: {
            auditId: audit.id,
            url: page.url,
            statusCode: page.statusCode,
            title: page.title,
            metaDescription: page.metaDescription,
            canonical: page.canonicalUrl,
            robots: page.metaRobots,
            headings: JSON.parse(JSON.stringify(page.headings)),
            images: {
              total: page.images.length,
              withAlt: page.images.filter((img) => img.hasAlt).length,
              withoutAlt: page.images.filter((img) => !img.hasAlt).length,
            },
            links: {
              internal: page.internalLinks.length,
              external: page.externalLinks.length,
            },
            issues: JSON.parse(JSON.stringify(page.issues)),
          },
        });
      }

      // Update audit with summary
      const updatedAudit = await prisma.seoAudit.update({
        where: { id: audit.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: {
            pagesDiscovered: pages.length,
            pagesCrawled: pages.length,
            pagesAnalyzed: pages.length,
          },
          summary: {
            healthScore: summary.healthScore,
            totalPages: summary.totalPages,
            totalIssues: summary.totalIssues,
            criticalIssues: summary.issuesByPriority.critical,
            highIssues: summary.issuesByPriority.high,
            mediumIssues: summary.issuesByPriority.medium,
            lowIssues: summary.issuesByPriority.low,
            issuesByCategory: summary.issuesByCategory,
          },
        },
        include: {
          pages: true,
        },
      });

      return NextResponse.json({
        success: true,
        data: updatedAudit,
      });
    } catch (crawlError) {
      // Update audit with error
      await prisma.seoAudit.update({
        where: { id: audit.id },
        data: {
          status: 'failed',
          error: crawlError instanceof Error ? crawlError.message : 'Crawl failed',
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: crawlError instanceof Error ? crawlError.message : 'Crawl failed',
          auditId: audit.id,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error creating SEO audit:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create audit' },
      { status: 500 }
    );
  }
}
