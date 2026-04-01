// ============================================
// LAMBDA: COMPLIANCE REPORT GENERATOR
// Reads ComplianceAlerts for a scan, uses Claude Haiku
// to generate a human-readable compliance summary,
// and writes it to S3 + integrates with DailyDigest.
//
// Triggered by: Step Functions (chapters-compliance-pipeline)
// ============================================

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Anthropic from '@anthropic-ai/sdk';

const REGION = process.env.AWS_REGION || 'us-west-1';
const BUCKET = process.env.S3_BUCKET || 'retail-data-bcgr';
const REPORTS_PREFIX = 'cannabis-compliance/scan-results/';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const s3 = new S3Client({ region: REGION });

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReportEvent {
  scanId: string;
}

interface AlertSummary {
  riskLevel: string;
  count: number;
  topViolations: string[];
  affectedProducts: string[];
  rulesTriggered: string[];
}

interface ComplianceReport {
  scanId: string;
  generatedAt: string;
  summary: string;
  riskBreakdown: Record<string, number>;
  topFindings: string[];
  recommendations: string[];
  alertDetails: AlertSummary[];
}

// ─── Database Bootstrap ─────────────────────────────────────────────────────

async function bootstrapDatabase(): Promise<void> {
  if (process.env.DATABASE_URL) return;

  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) throw new Error('DATABASE_SECRET_ARN is required');

  const client = new SecretsManagerClient({ region: REGION });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!response.SecretString) throw new Error('Secret value is empty');

  const secret = JSON.parse(response.SecretString) as { username: string; password: string };
  const host = process.env.DATABASE_HOST;
  const dbName = process.env.DATABASE_NAME || 'chapters_data';
  if (!host) throw new Error('DATABASE_HOST is required');

  process.env.DATABASE_URL = `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${host}:5432/${dbName}?sslmode=require&connection_limit=10&pool_timeout=30&connect_timeout=15`;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export const handler = async (event: ReportEvent) => {
  console.log('[ComplianceReport] Generating report...', JSON.stringify(event));
  const startTime = Date.now();

  if (!event.scanId) throw new Error('scanId is required');

  await bootstrapDatabase();
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Step 1: Load scan metadata + alerts
    const scan = await prisma.complianceScan.findUnique({
      where: { id: event.scanId },
      include: {
        alerts: {
          orderBy: { riskScore: 'desc' },
          take: 200, // cap for report generation
        },
      },
    });

    if (!scan) throw new Error(`Scan ${event.scanId} not found`);

    if (scan.alerts.length === 0) {
      console.log('[ComplianceReport] No alerts found. Generating clean report.');
      const cleanReport = buildCleanReport(event.scanId, scan.recordsScanned);
      await writeReport(cleanReport);
      return { success: true, reportGenerated: true, alertCount: 0 };
    }

    // Step 2: Build alert summaries by risk level
    const summaries = buildAlertSummaries(scan.alerts);

    // Step 3: Generate narrative report with Claude Haiku
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
    const report = await generateNarrativeReport(anthropic, event.scanId, scan, summaries);

    // Step 4: Write report to S3
    await writeReport(report);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ComplianceReport] Report generated in ${duration}s. ${scan.alerts.length} alerts summarized.`);

    return { success: true, reportGenerated: true, alertCount: scan.alerts.length };
  } finally {
    await prisma.$disconnect();
  }
};

// ─── Report Generation ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAlertSummaries(alerts: any[]): AlertSummary[] {
  const byLevel = new Map<string, typeof alerts>();

  for (const alert of alerts) {
    const level = alert.riskLevel;
    const existing = byLevel.get(level) || [];
    existing.push(alert);
    byLevel.set(level, existing);
  }

  return ['critical', 'high', 'medium', 'low']
    .filter(level => byLevel.has(level))
    .map(level => {
      const levelAlerts = byLevel.get(level)!;
      return {
        riskLevel: level,
        count: levelAlerts.length,
        topViolations: [...new Set(levelAlerts.slice(0, 5).map((a: { violation: string }) => a.violation))],
        affectedProducts: [...new Set(
          levelAlerts
            .map((a: { productName: string | null }) => a.productName)
            .filter(Boolean)
            .slice(0, 10)
        )],
        rulesTriggered: [...new Set(
          levelAlerts
            .map((a: { ruleId: string | null }) => a.ruleId)
            .filter(Boolean)
            .slice(0, 10)
        )],
      };
    });
}

async function generateNarrativeReport(
  anthropic: Anthropic,
  scanId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scan: any,
  summaries: AlertSummary[],
): Promise<ComplianceReport> {
  const totalAlerts = summaries.reduce((sum, s) => sum + s.count, 0);
  const riskBreakdown: Record<string, number> = {};
  for (const s of summaries) {
    riskBreakdown[s.riskLevel] = s.count;
  }

  // Build context for Claude
  const summaryText = summaries.map(s =>
    `${s.riskLevel.toUpperCase()} (${s.count}):\n` +
    `  Violations: ${s.topViolations.join('; ')}\n` +
    `  Products: ${s.affectedProducts.join(', ')}\n` +
    `  Rules: ${s.rulesTriggered.join(', ')}`
  ).join('\n\n');

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2048,
    system: `You are a cannabis compliance analyst generating a concise daily compliance report for retail dispensary operators. Be specific, actionable, and prioritize by severity. Do not use legal jargon unnecessarily.`,
    messages: [{
      role: 'user',
      content: `Generate a compliance scan report based on these findings:

Scan ID: ${scanId}
Records Scanned: ${scan.recordsScanned}
Total Alerts: ${totalAlerts}

Risk Breakdown:
${summaryText}

Provide:
1. A 2-3 sentence executive summary
2. Top 3-5 specific findings that need immediate attention (one sentence each)
3. 3-5 actionable recommendations

Return as JSON:
{
  "summary": "executive summary text",
  "topFindings": ["finding 1", "finding 2", ...],
  "recommendations": ["recommendation 1", "recommendation 2", ...]
}`,
    }],
  });

  const textContent = response.content.find(c => c.type === 'text');
  const text = textContent?.type === 'text' ? textContent.text : '{}';

  let parsed: { summary?: string; topFindings?: string[]; recommendations?: string[] };
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    parsed = { summary: text, topFindings: [], recommendations: [] };
  }

  return {
    scanId,
    generatedAt: new Date().toISOString(),
    summary: parsed.summary || `Compliance scan completed. ${totalAlerts} potential issues identified across ${scan.recordsScanned} sales records.`,
    riskBreakdown,
    topFindings: parsed.topFindings || [],
    recommendations: parsed.recommendations || [],
    alertDetails: summaries,
  };
}

function buildCleanReport(scanId: string, recordsScanned: number): ComplianceReport {
  return {
    scanId,
    generatedAt: new Date().toISOString(),
    summary: `Compliance scan completed successfully. No violations detected across ${recordsScanned} sales records. All transactions appear compliant with current regulatory requirements.`,
    riskBreakdown: {},
    topFindings: [],
    recommendations: ['Continue regular compliance monitoring.', 'Ensure compliance rules are updated with latest regulatory changes.'],
    alertDetails: [],
  };
}

// ─── Write to S3 ────────────────────────────────────────────────────────────

async function writeReport(report: ComplianceReport): Promise<void> {
  const dateStr = new Date().toISOString().split('T')[0];

  // Write daily report
  const reportKey = `${REPORTS_PREFIX}daily/${dateStr}/report-${report.scanId}.json`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: reportKey,
    Body: JSON.stringify(report, null, 2),
    ContentType: 'application/json',
  }));

  console.log(`[ComplianceReport] Report written to ${reportKey}`);
}
