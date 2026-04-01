// ============================================
// LAMBDA: COMPLIANCE AGGREGATOR
// Reads rule violations from S3, deduplicates,
// scores severity, and writes ComplianceAlert
// records to Aurora. In Phase 4 this will also
// merge ML classifier results.
//
// Triggered by: Step Functions (chapters-compliance-pipeline)
// ============================================

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION || 'us-west-1';
const BUCKET = process.env.S3_BUCKET || 'retail-data-bcgr';
const RESULTS_PREFIX = 'cannabis-compliance/scan-results/daily/';

const s3 = new S3Client({ region: REGION });

// ─── Types ──────────────────────────────────────────────────────────────────

interface AggregatorEvent {
  scanId: string;
  rulesResultKey: string | null;
  mlResultKey?: string | null; // Phase 4: ML classifier results
}

interface RuleViolation {
  ruleId: string;
  riskLevel: string;
  riskScore: number;
  detectionMethod: string;
  violation: string;
  salesLineItemId: string;
  productName: string | null;
  productType: string | null;
  field: string;
  actualValue: string;
  limitValue: string;
  recommendation: string;
}

interface AggregatedAlert {
  scanId: string;
  storefrontId: string | null;
  ruleId: string | null;
  riskLevel: string;
  riskScore: number;
  detectionMethod: string;
  violation: string;
  salesLineItemId: string | null;
  productName: string | null;
  productType: string | null;
  field: string | null;
  actualValue: string | null;
  limitValue: string | null;
  recommendation: string | null;
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

export const handler = async (event: AggregatorEvent) => {
  console.log('[Aggregator] Starting aggregation...', JSON.stringify(event));
  const startTime = Date.now();

  if (!event.scanId) throw new Error('scanId is required');

  await bootstrapDatabase();
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Step 1: Load violations from S3
    const rulesViolations = event.rulesResultKey
      ? await loadViolationsFromS3(event.rulesResultKey)
      : [];

    // Phase 4: Load ML results too
    const mlViolations = event.mlResultKey
      ? await loadViolationsFromS3(event.mlResultKey)
      : [];

    console.log(`[Aggregator] Loaded ${rulesViolations.length} rule violations, ${mlViolations.length} ML detections.`);

    // Step 2: Merge and deduplicate
    const merged = mergeViolations(rulesViolations, mlViolations);
    console.log(`[Aggregator] ${merged.length} unique violations after dedup.`);

    if (merged.length === 0) {
      return { alertsCreated: 0, criticalCount: 0, highCount: 0 };
    }

    // Step 3: Look up storefrontId for each salesLineItemId
    const salesItemIds = [...new Set(merged.map(v => v.salesLineItemId).filter(Boolean))];
    const storefrontMap = await buildStorefrontMap(prisma, salesItemIds);

    // Step 4: Write alerts to Aurora in batches
    const alerts: AggregatedAlert[] = merged.map(v => ({
      scanId: event.scanId,
      storefrontId: storefrontMap.get(v.salesLineItemId) || null,
      ruleId: v.ruleId || null,
      riskLevel: v.riskLevel,
      riskScore: v.riskScore,
      detectionMethod: v.detectionMethod,
      violation: v.violation,
      salesLineItemId: v.salesLineItemId || null,
      productName: v.productName || null,
      productType: v.productType || null,
      field: v.field || null,
      actualValue: v.actualValue || null,
      limitValue: v.limitValue || null,
      recommendation: v.recommendation || null,
    }));

    let alertsCreated = 0;
    const WRITE_BATCH = 100;
    for (let i = 0; i < alerts.length; i += WRITE_BATCH) {
      const batch = alerts.slice(i, i + WRITE_BATCH);
      await prisma.complianceAlert.createMany({
        data: batch,
      });
      alertsCreated += batch.length;
    }

    // Step 5: Write aggregated results to S3
    const dateStr = new Date().toISOString().split('T')[0];
    const aggregatedKey = `${RESULTS_PREFIX}${dateStr}/aggregated-${event.scanId}.jsonl`;
    const jsonl = alerts.map(a => JSON.stringify(a)).join('\n');
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: aggregatedKey,
      Body: jsonl,
      ContentType: 'application/x-ndjson',
    }));

    // Step 6: Update scan with results path
    const criticalCount = alerts.filter(a => a.riskLevel === 'critical').length;
    const highCount = alerts.filter(a => a.riskLevel === 'high').length;

    await prisma.complianceScan.update({
      where: { id: event.scanId },
      data: { s3ResultsPath: aggregatedKey },
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Aggregator] Complete in ${duration}s. ${alertsCreated} alerts created (${criticalCount} critical, ${highCount} high).`);

    return { alertsCreated, criticalCount, highCount };
  } finally {
    await prisma.$disconnect();
  }
};

// ─── Merge & Dedup ──────────────────────────────────────────────────────────

function mergeViolations(
  rulesViolations: RuleViolation[],
  mlViolations: RuleViolation[],
): RuleViolation[] {
  // Index rules violations by salesLineItemId + field for dedup
  const seen = new Map<string, RuleViolation>();

  for (const v of rulesViolations) {
    const key = `${v.salesLineItemId}::${v.field}::${v.ruleId}`;
    seen.set(key, v);
  }

  for (const v of mlViolations) {
    const key = `${v.salesLineItemId}::${v.field}::${v.ruleId || v.detectionMethod}`;
    const existing = seen.get(key);

    if (existing) {
      // Both engines flagged the same issue — use hybrid scoring
      existing.detectionMethod = 'hybrid';
      existing.riskScore = computeHybridScore(existing.riskScore, v.riskScore);
      existing.riskLevel = scoreToRiskLevel(existing.riskScore);
      // Keep the more detailed violation message
      if (v.violation.length > existing.violation.length) {
        existing.violation = v.violation;
      }
    } else {
      seen.set(key, v);
    }
  }

  return [...seen.values()];
}

function computeHybridScore(rulesScore: number, mlScore: number): number {
  // Weighted combination: higher score gets 70% weight
  const maxScore = Math.max(rulesScore, mlScore);
  const minScore = Math.min(rulesScore, mlScore);
  return maxScore * 0.7 + minScore * 0.3;
}

function scoreToRiskLevel(score: number): string {
  if (score >= 0.9) return 'critical';
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadViolationsFromS3(key: string): Promise<RuleViolation[]> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const text = await response.Body!.transformToString();
    return text.split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as RuleViolation; } catch { return null; }
      })
      .filter((v): v is RuleViolation => v !== null);
  } catch (err) {
    console.error(`[Aggregator] Failed to load violations from ${key}:`, err);
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildStorefrontMap(prisma: any, salesItemIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (salesItemIds.length === 0) return map;

  // Query in batches to avoid param limits
  const LOOKUP_BATCH = 200;
  for (let i = 0; i < salesItemIds.length; i += LOOKUP_BATCH) {
    const batch = salesItemIds.slice(i, i + LOOKUP_BATCH);
    const items = await prisma.salesLineItem.findMany({
      where: { id: { in: batch } },
      select: { id: true, storefrontId: true },
    });
    for (const item of items) {
      if (item.storefrontId) {
        map.set(item.id, item.storefrontId);
      }
    }
  }

  return map;
}
