// ============================================
// LAMBDA: COMPLIANCE RULES ENGINE
// Deterministic rule-based scanning of sales data.
// Called by Step Functions with three actions:
//   initialize → create scan record, check rule freshness
//   scan       → load rules, query sales, apply checks
//   finalize   → mark scan completed
//
// Triggered by: Step Functions (chapters-compliance-pipeline)
// ============================================

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { scanBatch, type CompiledRule, type SalesLineItemForScan } from '@/lib/services/compliance-rules';

const REGION = process.env.AWS_REGION || 'us-west-1';
const BUCKET = process.env.S3_BUCKET || 'retail-data-bcgr';
const RULES_KEY = 'cannabis-compliance/knowledge-base/rules/current/all-rules.jsonl';
const RULES_MANIFEST_KEY = 'cannabis-compliance/knowledge-base/rules/current/rules-manifest.json';
const RESULTS_PREFIX = 'cannabis-compliance/scan-results/daily/';
const BATCH_SIZE = 500;
const RULES_STALE_DAYS = 7;
// Default jurisdiction for stores (San Francisco, CA)
const DEFAULT_JURISDICTION = 'CA';

const s3 = new S3Client({ region: REGION });

// ─── Types ──────────────────────────────────────────────────────────────────

interface RulesEngineEvent {
  action: 'initialize' | 'scan' | 'finalize';
  scanId?: string;
  scanType?: string;
  dateRange?: {
    lookbackDays?: number;
    startDate?: string;
    endDate?: string;
  };
}

interface RulesManifest {
  version: string;
  ruleCount: number;
  compiledAt: string;
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

export const handler = async (event: RulesEngineEvent) => {
  console.log(`[RulesEngine] Action: ${event.action}`, JSON.stringify(event));
  await bootstrapDatabase();

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    switch (event.action) {
      case 'initialize':
        return await handleInitialize(prisma, event);
      case 'scan':
        return await handleScan(prisma, event);
      case 'finalize':
        return await handleFinalize(prisma, event);
      default:
        throw new Error(`Unknown action: ${event.action}`);
    }
  } finally {
    await prisma.$disconnect();
  }
};

// ─── Initialize ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInitialize(prisma: any, event: RulesEngineEvent) {
  // Check rule freshness
  const manifest = await loadRulesManifest();
  let rulesStale = true;

  if (manifest) {
    const compiledAt = new Date(manifest.compiledAt);
    const daysSince = (Date.now() - compiledAt.getTime()) / (1000 * 60 * 60 * 24);
    rulesStale = daysSince > RULES_STALE_DAYS || manifest.ruleCount === 0;
    console.log(`[RulesEngine] Rules compiled ${daysSince.toFixed(1)} days ago (${manifest.ruleCount} rules). Stale: ${rulesStale}`);
  } else {
    console.log('[RulesEngine] No rules manifest found. Rules are stale.');
  }

  // Create scan record
  const scan = await prisma.complianceScan.create({
    data: {
      scanType: event.scanType || 'daily',
      status: 'running',
    },
  });

  console.log(`[RulesEngine] Created scan ${scan.id}`);
  return { scanId: scan.id, rulesStale };
}

// ─── Scan ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleScan(prisma: any, event: RulesEngineEvent) {
  if (!event.scanId) throw new Error('scanId is required for scan action');

  // Step 1: Load compiled rules from S3
  const rules = await loadRulesFromS3();
  if (rules.length === 0) {
    console.log('[RulesEngine] No compiled rules available. Skipping scan.');
    return { violationCount: 0, s3ResultKey: null };
  }
  console.log(`[RulesEngine] Loaded ${rules.length} compiled rules.`);

  // Step 2: Determine date range
  const { startDate, endDate } = resolveDateRange(event.dateRange);
  console.log(`[RulesEngine] Scanning sales from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

  // Step 3: Process sales data in batches
  const allViolations: unknown[] = [];
  let totalScanned = 0;
  let cursor: string | undefined;

  while (true) {
    const items = await prisma.salesLineItem.findMany({
      where: {
        dateOpen: { gte: startDate, lte: endDate },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });

    if (items.length === 0) break;

    // Convert Prisma decimals to numbers for the rules engine
    const scanItems: SalesLineItemForScan[] = items.map(item => ({
      id: item.id,
      storefrontId: item.storefrontId,
      storeName: item.storeName || '',
      ticketId: item.ticketId,
      ticketLineId: item.ticketLineId,
      dateOpen: item.dateOpen,
      dateClose: item.dateClose,
      productName: item.productName,
      productType: item.productType,
      productSubtype: item.productSubtype,
      classification: item.classification,
      stateTrackingId: item.stateTrackingId,
      batch: item.batch,
      distributor: item.distributor,
      quantity: item.quantity,
      pricePerUnit: item.pricePerUnit ? Number(item.pricePerUnit) : null,
      grossSales: item.grossSales ? Number(item.grossSales) : null,
      discounts: item.discounts ? Number(item.discounts) : null,
      netSales: item.netSales ? Number(item.netSales) : null,
      taxes: item.taxes ? Number(item.taxes) : null,
      costWithoutExcise: item.costWithoutExcise ? Number(item.costWithoutExcise) : null,
      costWithExcise: item.costWithExcise ? Number(item.costWithExcise) : null,
      customerAge: item.customerAge,
      customerDob: item.customerDob,
      customerCity: item.customerCity,
      customerState: item.customerState,
      totalMgThc: item.totalMgThc ? Number(item.totalMgThc) : null,
      totalMgCbd: item.totalMgCbd ? Number(item.totalMgCbd) : null,
      size: item.size,
    }));

    const violations = scanBatch(rules as CompiledRule[], scanItems, DEFAULT_JURISDICTION);
    allViolations.push(...violations);
    totalScanned += items.length;
    cursor = items[items.length - 1].id;

    if (items.length < BATCH_SIZE) break;
  }

  console.log(`[RulesEngine] Scanned ${totalScanned} sales records. Found ${allViolations.length} violations.`);

  // Step 4: Write violations to S3
  const dateStr = endDate.toISOString().split('T')[0];
  const s3ResultKey = `${RESULTS_PREFIX}${dateStr}/rules-violations-${event.scanId}.jsonl`;

  if (allViolations.length > 0) {
    const jsonl = allViolations.map(v => JSON.stringify(v)).join('\n');
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3ResultKey,
      Body: jsonl,
      ContentType: 'application/x-ndjson',
      Metadata: {
        'scan-id': event.scanId,
        'records-scanned': String(totalScanned),
        'violations-found': String(allViolations.length),
      },
    }));
  }

  // Update scan record with progress
  await prisma.complianceScan.update({
    where: { id: event.scanId },
    data: { recordsScanned: totalScanned },
  });

  return {
    violationCount: allViolations.length,
    recordsScanned: totalScanned,
    s3ResultKey: allViolations.length > 0 ? s3ResultKey : null,
  };
}

// ─── Finalize ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleFinalize(prisma: any, event: RulesEngineEvent) {
  if (!event.scanId) throw new Error('scanId is required for finalize action');

  // Count alerts created for this scan
  const alertCounts = await prisma.complianceAlert.groupBy({
    by: ['riskLevel'],
    where: { scanId: event.scanId },
    _count: true,
  });

  const totalAlerts = alertCounts.reduce((sum, g) => sum + g._count, 0);
  const criticalCount = alertCounts.find(g => g.riskLevel === 'critical')?._count ?? 0;
  const highCount = alertCounts.find(g => g.riskLevel === 'high')?._count ?? 0;

  await prisma.complianceScan.update({
    where: { id: event.scanId },
    data: {
      status: 'completed',
      completedAt: new Date(),
      risksFound: totalAlerts,
      criticalRisks: criticalCount,
      highRisks: highCount,
    },
  });

  console.log(`[RulesEngine] Finalized scan ${event.scanId}: ${totalAlerts} alerts (${criticalCount} critical, ${highCount} high)`);
  return { success: true, scanId: event.scanId, totalAlerts, criticalCount, highCount };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadRulesManifest(): Promise<RulesManifest | null> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: RULES_MANIFEST_KEY }));
    const text = await response.Body!.transformToString();
    return JSON.parse(text) as RulesManifest;
  } catch {
    return null;
  }
}

async function loadRulesFromS3(): Promise<unknown[]> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: RULES_KEY }));
    const text = await response.Body!.transformToString();
    return text.split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function resolveDateRange(dateRange?: RulesEngineEvent['dateRange']): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);

  if (dateRange?.startDate && dateRange?.endDate) {
    return {
      startDate: new Date(dateRange.startDate),
      endDate: new Date(dateRange.endDate),
    };
  }

  const lookbackDays = dateRange?.lookbackDays ?? 1;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - lookbackDays);

  return { startDate, endDate };
}
