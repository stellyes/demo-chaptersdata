/**
 * Example SEO audit data for the demo experience.
 * Two audits: one for each demo store's website.
 */

export interface DemoSeoAudit {
  id: string;
  domain: string;
  status: string;
  createdAt: string;
  completedAt: string;
  summary: {
    healthScore: number;
    totalPages: number;
    totalIssues: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
  };
  pages: Array<{
    url: string;
    statusCode: number;
    title: string;
    issues: Array<{
      id: string;
      code: string;
      category: string;
      priority: string;
      title: string;
      description: string;
      recommendation: string;
    }>;
  }>;
}

export const EXAMPLE_SEO_AUDITS: DemoSeoAudit[] = [
  {
    id: 'demo-seo-001',
    domain: 'https://greenleafmarket.com',
    status: 'completed',
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    completedAt: new Date(Date.now() - 2 * 86400000 + 300000).toISOString(),
    summary: {
      healthScore: 74,
      totalPages: 32,
      totalIssues: 18,
      criticalIssues: 2,
      highIssues: 4,
      mediumIssues: 8,
      lowIssues: 4,
    },
    pages: [
      {
        url: 'https://greenleafmarket.com/',
        statusCode: 200,
        title: 'Greenleaf Market - Premium Cannabis Dispensary Downtown',
        issues: [
          {
            id: 'seo-gl-1',
            code: 'META_DESC_LENGTH',
            category: 'SEO',
            priority: 'high',
            title: 'Meta description too long',
            description: 'Meta description is 185 characters. Search engines typically display 150-160 characters.',
            recommendation: 'Shorten the meta description to 150-160 characters while keeping primary keywords.',
          },
          {
            id: 'seo-gl-2',
            code: 'LCP_SLOW',
            category: 'Performance',
            priority: 'critical',
            title: 'Largest Contentful Paint above 4 seconds',
            description: 'LCP measured at 4.2s on mobile. Google recommends under 2.5s for good user experience.',
            recommendation: 'Optimize hero image (currently 2.8MB). Convert to WebP format and add lazy loading for below-fold images.',
          },
        ],
      },
      {
        url: 'https://greenleafmarket.com/menu',
        statusCode: 200,
        title: 'Our Menu | Greenleaf Market',
        issues: [
          {
            id: 'seo-gl-3',
            code: 'IMG_ALT_MISSING',
            category: 'Accessibility',
            priority: 'high',
            title: '12 images missing alt text',
            description: 'Product images on the menu page lack alt attributes, impacting accessibility and image search rankings.',
            recommendation: 'Add descriptive alt text to all product images (e.g., "Pacific Bloom Hybrid Flower 3.5g").',
          },
          {
            id: 'seo-gl-4',
            code: 'H1_MISSING',
            category: 'SEO',
            priority: 'medium',
            title: 'No H1 heading found',
            description: 'The menu page lacks a proper H1 heading tag, which helps search engines understand page content.',
            recommendation: 'Add an H1 heading such as "Cannabis Menu - Flower, Edibles, Vapes & More".',
          },
        ],
      },
      {
        url: 'https://greenleafmarket.com/about',
        statusCode: 200,
        title: 'About Us | Greenleaf Market',
        issues: [
          {
            id: 'seo-gl-5',
            code: 'THIN_CONTENT',
            category: 'Content',
            priority: 'medium',
            title: 'Thin content detected',
            description: 'Page has only 87 words of content. Pages with less than 300 words may be seen as low-quality by search engines.',
            recommendation: 'Expand the about page with your story, team, mission, and community involvement (aim for 500+ words).',
          },
        ],
      },
      {
        url: 'https://greenleafmarket.com/deals',
        statusCode: 200,
        title: 'Daily Deals | Greenleaf Market',
        issues: [
          {
            id: 'seo-gl-6',
            code: 'CLS_HIGH',
            category: 'Performance',
            priority: 'critical',
            title: 'Cumulative Layout Shift above 0.25',
            description: 'CLS measured at 0.34. Elements shift during page load, creating a poor user experience.',
            recommendation: 'Add explicit width and height to promotional banner images and use CSS aspect-ratio for dynamic content areas.',
          },
          {
            id: 'seo-gl-7',
            code: 'CANONICAL_MISSING',
            category: 'SEO',
            priority: 'medium',
            title: 'Missing canonical tag',
            description: 'No canonical URL specified. This can cause duplicate content issues if the page is accessible via multiple URLs.',
            recommendation: 'Add a canonical link tag pointing to the preferred URL.',
          },
        ],
      },
    ],
  },
  {
    id: 'demo-seo-002',
    domain: 'https://emeraldcollective.com',
    status: 'completed',
    createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    completedAt: new Date(Date.now() - 4 * 86400000 + 420000).toISOString(),
    summary: {
      healthScore: 61,
      totalPages: 28,
      totalIssues: 24,
      criticalIssues: 3,
      highIssues: 6,
      mediumIssues: 10,
      lowIssues: 5,
    },
    pages: [
      {
        url: 'https://emeraldcollective.com/',
        statusCode: 200,
        title: 'Emerald Collective | Midtown Cannabis Dispensary',
        issues: [
          {
            id: 'seo-ec-1',
            code: 'RENDER_BLOCKING',
            category: 'Performance',
            priority: 'critical',
            title: '4 render-blocking resources detected',
            description: 'External CSS and JavaScript files block initial page render, adding 1.8s to First Contentful Paint.',
            recommendation: 'Inline critical CSS, defer non-essential JS, and use async loading for third-party scripts.',
          },
          {
            id: 'seo-ec-2',
            code: 'MOBILE_VIEWPORT',
            category: 'Mobile',
            priority: 'high',
            title: 'Viewport not configured for mobile',
            description: 'The page does not use a responsive viewport meta tag, causing poor display on mobile devices.',
            recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the head.',
          },
        ],
      },
      {
        url: 'https://emeraldcollective.com/products',
        statusCode: 200,
        title: 'Products - Emerald Collective',
        issues: [
          {
            id: 'seo-ec-3',
            code: 'STRUCTURED_DATA_MISSING',
            category: 'SEO',
            priority: 'high',
            title: 'No structured data found',
            description: 'No Schema.org markup detected. Structured data helps search engines display rich results.',
            recommendation: 'Add LocalBusiness and Product schema markup to improve search appearance.',
          },
          {
            id: 'seo-ec-4',
            code: 'DUPLICATE_TITLE',
            category: 'SEO',
            priority: 'medium',
            title: 'Duplicate title tag',
            description: 'This page shares the same title with 3 other pages on the site.',
            recommendation: 'Create unique, descriptive title tags for each page (include product category in title).',
          },
          {
            id: 'seo-ec-5',
            code: 'IMG_SIZE_LARGE',
            category: 'Performance',
            priority: 'high',
            title: '8 images exceed 500KB',
            description: 'Large unoptimized images slow page load significantly. Total image weight: 12.4MB.',
            recommendation: 'Compress images, use WebP format, and implement responsive image srcset.',
          },
        ],
      },
      {
        url: 'https://emeraldcollective.com/contact',
        statusCode: 200,
        title: 'Contact | Emerald Collective',
        issues: [
          {
            id: 'seo-ec-6',
            code: 'HTTPS_MIXED',
            category: 'Security',
            priority: 'critical',
            title: 'Mixed content detected',
            description: 'The page loads 3 resources over HTTP instead of HTTPS, triggering browser security warnings.',
            recommendation: 'Update all resource URLs to use HTTPS. Check embedded maps, fonts, and tracking scripts.',
          },
        ],
      },
    ],
  },
];
