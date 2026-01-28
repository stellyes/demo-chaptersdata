// ============================================
// EXPORT UTILITIES
// Functions for exporting content as printable files
// ============================================

import { format } from 'date-fns';

export interface ExportOptions {
  filename: string;
  title?: string;
  subtitle?: string;
  generatedAt?: Date;
}

// DailyDigest type for formatting
export interface DailyDigestExport {
  executiveSummary: string;
  priorityActions: Array<{ action: string; timeframe: string; impact: string; category: string }>;
  quickWins: Array<{ action: string; effort: string; impact: string }>;
  watchItems: Array<{ item: string; reason: string; monitorUntil: string }>;
  industryHighlights: Array<{ headline: string; source: string; relevance: string; actionItem?: string }>;
  regulatoryUpdates: Array<{ update: string; source: string; impactLevel: 'high' | 'medium' | 'low'; deadline?: string }>;
  marketTrends: Array<{ trend: string; evidence: string; implication: string }>;
  questionsForTomorrow: Array<{ question: string; priority: number; category: string }>;
  correlatedInsights: Array<{
    internalObservation: string;
    externalEvidence: string;
    correlation: string;
    confidence: number;
    actionItem?: string;
    category: string;
  }>;
  dataHealthScore: number;
  confidenceScore: number;
}

// Print-optimized CSS styles
const PRINT_STYLES = `
  @media print {
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #000;
      max-width: none;
      padding: 0;
    }
    h1 { font-size: 24pt; margin-bottom: 8pt; border-bottom: 2px solid #000; padding-bottom: 8pt; }
    h2 { font-size: 16pt; margin-top: 20pt; margin-bottom: 8pt; page-break-after: avoid; color: #333; }
    h3 { font-size: 13pt; margin-top: 14pt; margin-bottom: 6pt; page-break-after: avoid; }
    p { margin-bottom: 8pt; orphans: 3; widows: 3; }
    ul, ol { margin-left: 20pt; margin-bottom: 10pt; }
    li { margin-bottom: 4pt; }
    table { border-collapse: collapse; width: 100%; margin: 12pt 0; page-break-inside: avoid; }
    th, td { border: 1px solid #666; padding: 6pt 8pt; text-align: left; font-size: 10pt; }
    th { background: #f0f0f0; font-weight: bold; }
    .header { border-bottom: 2px solid #000; padding-bottom: 12pt; margin-bottom: 20pt; }
    .meta { color: #666; font-size: 10pt; font-style: italic; margin-top: 4pt; }
    .section { page-break-inside: avoid; margin-bottom: 16pt; }
    .metric-grid { display: flex; gap: 20pt; flex-wrap: wrap; margin: 12pt 0; }
    .metric { background: #f5f5f5; padding: 8pt 12pt; border-radius: 4pt; }
    .metric-value { font-size: 18pt; font-weight: bold; color: #1a1a1a; }
    .metric-label { font-size: 9pt; color: #666; }
    hr { border: none; border-top: 1px solid #ccc; margin: 16pt 0; }
    code { background: #f5f5f5; padding: 2pt 4pt; font-family: 'Courier New', monospace; font-size: 10pt; }
    pre { background: #f5f5f5; padding: 10pt; overflow-x: auto; font-size: 9pt; }
    blockquote { border-left: 3pt solid #ccc; padding-left: 12pt; margin-left: 0; color: #555; }
    @page { margin: 0.75in; }
  }
  /* Screen styles for preview */
  body {
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #1a1a1a;
  }
  h1 { font-size: 28px; margin-bottom: 8px; }
  h2 { font-size: 20px; margin-top: 32px; margin-bottom: 12px; color: #333; border-bottom: 1px solid #e5e5e5; padding-bottom: 8px; }
  h3 { font-size: 16px; margin-top: 20px; margin-bottom: 8px; }
  .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 24px; }
  .meta { color: #666; font-size: 13px; font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 10px 12px; text-align: left; }
  th { background: #f8f8f8; font-weight: 600; }
  ul, ol { margin-left: 24px; margin-bottom: 16px; }
  li { margin-bottom: 6px; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 24px 0; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; }
  blockquote { border-left: 4px solid #ddd; padding-left: 16px; margin-left: 0; color: #555; }
`;

/**
 * Trigger a file download using the Blob API
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build markdown header with title and metadata
 */
function buildMarkdownHeader(options: ExportOptions): string {
  const date = format(options.generatedAt || new Date(), 'MMMM d, yyyy h:mm a');
  let header = `# ${options.title || 'Export'}\n\n`;
  if (options.subtitle) {
    header += `*${options.subtitle}*\n\n`;
  }
  header += `*Generated: ${date}*\n\n---\n\n`;
  return header;
}

/**
 * Convert markdown to basic HTML
 */
function convertMarkdownToHTML(markdown: string): string {
  let html = markdown
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers (must be at start of line)
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```[\s\S]*?```/g, (match) => {
      const code = match.slice(3, -3).replace(/^\w*\n/, '');
      return `<pre><code>${code}</code></pre>`;
    })
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Horizontal rules
    .replace(/^---$/gim, '<hr>')
    .replace(/^\*\*\*$/gim, '<hr>')
    // Line breaks for paragraphs
    .replace(/\n\n/g, '</p><p>');

  // Handle unordered lists
  html = html.replace(/^[-*]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)(\n<li>)/g, '$1$2');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Handle numbered lists
  html = html.replace(/^\d+\.\s+(.*$)/gim, '<li>$1</li>');

  // Wrap in paragraphs
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs and fix nesting
  html = html
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<p>\s*(<h[1-4]>)/g, '$1')
    .replace(/(<\/h[1-4]>)\s*<\/p>/g, '$1')
    .replace(/<p>\s*(<ul>)/g, '$1')
    .replace(/(<\/ul>)\s*<\/p>/g, '$1')
    .replace(/<p>\s*(<hr>)/g, '$1')
    .replace(/(<hr>)\s*<\/p>/g, '$1')
    .replace(/<p>\s*(<pre>)/g, '$1')
    .replace(/(<\/pre>)\s*<\/p>/g, '$1');

  return html;
}

/**
 * Build print-optimized HTML document
 */
function buildPrintableHTML(markdownContent: string, options: ExportOptions): string {
  const date = format(options.generatedAt || new Date(), 'MMMM d, yyyy h:mm a');
  const htmlContent = convertMarkdownToHTML(markdownContent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title || 'Export'}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="header">
    <h1>${options.title || 'Export'}</h1>
    ${options.subtitle ? `<p class="meta">${options.subtitle}</p>` : ''}
    <p class="meta">Generated: ${date}</p>
  </div>
  <div class="content">
    ${htmlContent}
  </div>
</body>
</html>`;
}

/**
 * Download content as a Markdown file
 */
export function downloadAsMarkdown(content: string, options: ExportOptions): void {
  const header = buildMarkdownHeader(options);
  const fullContent = header + content;

  const blob = new Blob([fullContent], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, `${options.filename}.md`);
}

/**
 * Open content in a new window optimized for printing
 * User can then save as PDF or print directly
 */
export function openPrintWindow(content: string, options: ExportOptions): void {
  const html = buildPrintableHTML(content, options);
  const printWindow = window.open('', '_blank');

  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    // Small delay to ensure content and styles load before print dialog
    setTimeout(() => {
      printWindow.print();
    }, 300);
  }
}

/**
 * Convert DailyDigest structured data to formatted markdown
 */
export function formatDailyDigestAsMarkdown(
  digest: DailyDigestExport,
  jobInfo?: { completedAt: string | null }
): string {
  const sections: string[] = [];

  // Executive Summary
  if (digest.executiveSummary) {
    sections.push('## Executive Summary\n');
    sections.push(digest.executiveSummary + '\n');
  }

  // Key Metrics
  sections.push('## Key Metrics\n');
  sections.push(`- **Data Health Score:** ${digest.dataHealthScore}`);
  sections.push(`- **Confidence Score:** ${Math.round(digest.confidenceScore * 100)}%`);
  sections.push(`- **Priority Actions:** ${digest.priorityActions?.length || 0}`);
  sections.push(`- **Quick Wins:** ${digest.quickWins?.length || 0}\n`);

  // Priority Actions
  if (digest.priorityActions && digest.priorityActions.length > 0) {
    sections.push('## Priority Actions\n');
    digest.priorityActions.forEach((action, i) => {
      sections.push(`### ${i + 1}. ${action.action}`);
      sections.push(`- **Category:** ${action.category}`);
      sections.push(`- **Timeframe:** ${action.timeframe}`);
      sections.push(`- **Impact:** ${action.impact}\n`);
    });
  }

  // Quick Wins
  if (digest.quickWins && digest.quickWins.length > 0) {
    sections.push('## Quick Wins\n');
    digest.quickWins.forEach((win) => {
      sections.push(`- **${win.action}**`);
      sections.push(`  - Effort: ${win.effort} | Impact: ${win.impact}`);
    });
    sections.push('');
  }

  // Industry Highlights
  if (digest.industryHighlights && digest.industryHighlights.length > 0) {
    sections.push('## Industry Highlights\n');
    digest.industryHighlights.forEach((item) => {
      sections.push(`### ${item.headline}`);
      sections.push(`*Source: ${item.source}*\n`);
      sections.push(`**Relevance:** ${item.relevance}`);
      if (item.actionItem) {
        sections.push(`\n**Action:** ${item.actionItem}`);
      }
      sections.push('');
    });
  }

  // Market Trends
  if (digest.marketTrends && digest.marketTrends.length > 0) {
    sections.push('## Market Trends\n');
    digest.marketTrends.forEach((trend) => {
      sections.push(`### ${trend.trend}`);
      sections.push(`**Evidence:** ${trend.evidence}`);
      sections.push(`\n**Implication:** ${trend.implication}\n`);
    });
  }

  // Regulatory Updates
  if (digest.regulatoryUpdates && digest.regulatoryUpdates.length > 0) {
    sections.push('## Regulatory Updates\n');
    digest.regulatoryUpdates.forEach((update) => {
      const impactIndicator = update.impactLevel === 'high' ? '[HIGH]' : update.impactLevel === 'medium' ? '[MEDIUM]' : '[LOW]';
      sections.push(`### ${impactIndicator} ${update.update}`);
      sections.push(`*Source: ${update.source}*`);
      sections.push(`**Impact Level:** ${update.impactLevel.toUpperCase()}`);
      if (update.deadline) {
        sections.push(`**Deadline:** ${update.deadline}`);
      }
      sections.push('');
    });
  }

  // Correlated Insights
  if (digest.correlatedInsights && digest.correlatedInsights.length > 0) {
    sections.push('## Correlated Insights\n');
    digest.correlatedInsights.forEach((insight, i) => {
      sections.push(`### Insight ${i + 1}: ${insight.correlation}`);
      sections.push(`- **Category:** ${insight.category}`);
      sections.push(`- **Confidence:** ${Math.round(insight.confidence * 100)}%`);
      sections.push(`- **Internal Observation:** ${insight.internalObservation}`);
      sections.push(`- **External Evidence:** ${insight.externalEvidence}`);
      if (insight.actionItem) {
        sections.push(`- **Recommended Action:** ${insight.actionItem}`);
      }
      sections.push('');
    });
  }

  // Watch Items
  if (digest.watchItems && digest.watchItems.length > 0) {
    sections.push('## Watch Items\n');
    digest.watchItems.forEach((item) => {
      sections.push(`- **${item.item}**`);
      sections.push(`  - Reason: ${item.reason}`);
      sections.push(`  - Monitor Until: ${item.monitorUntil}`);
    });
    sections.push('');
  }

  // Questions for Tomorrow
  if (digest.questionsForTomorrow && digest.questionsForTomorrow.length > 0) {
    sections.push('## Questions for Tomorrow\n');
    const sortedQuestions = [...digest.questionsForTomorrow].sort((a, b) => a.priority - b.priority);
    sortedQuestions.forEach((q, i) => {
      sections.push(`${i + 1}. **${q.question}**`);
      sections.push(`   - Category: ${q.category} | Priority: ${q.priority}`);
    });
    sections.push('');
  }

  // Footer
  if (jobInfo?.completedAt) {
    sections.push('---\n');
    sections.push(`*Analysis completed: ${format(new Date(jobInfo.completedAt), 'MMMM d, yyyy h:mm a')}*`);
  }

  return sections.join('\n');
}
