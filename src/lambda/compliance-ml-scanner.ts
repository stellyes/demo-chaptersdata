// ============================================
// LAMBDA: COMPLIANCE ML SCANNER
// Invokes the SageMaker Serverless Endpoint
// (DistilBERT compliance classifier) against
// sales data batches. Handles cases the rules
// engine can't: naming violations, pricing
// anomalies, purchase frequency patterns, and
// ambiguous product type classification.
//
// Triggered by: Step Functions (chapters-compliance-pipeline)
// ============================================

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {
  SageMakerRuntimeClient,
  InvokeEndpointCommand,
} from '@aws-sdk/client-sagemaker-runtime';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION || 'us-west-1';
const BUCKET = process.env.S3_BUCKET || 'retail-data-bcgr';
const ENDPOINT_NAME = process.env.SAGEMAKER_ENDPOINT || 'chapters-compliance-classifier';
const RESULTS_PREFIX = 'cannabis-compliance/scan-results/daily/';
const BATCH_SIZE = 500;
const INFERENCE_BATCH = 25; // SageMaker batch per request
const DEFAULT_JURISDICTION = 'CA';

const sagemakerRuntime = new SageMakerRuntimeClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

// ─── Types ──────────────────────────────────────────────────────────────────

interface MLScannerEvent {
  scanId: string;
  dateRange?: {
    lookbackDays?: number;
    startDate?: string;
    endDate?: string;
  };
}

interface SageMakerPrediction {
  labels: string[];
  scores: Record<string, number>;
  risk_level: string;
  risk_score: number;
}

interface SageMakerResponse {
  predictions: SageMakerPrediction[];
}

interface MLViolation {
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

// Label → human-readable descriptions for violation messages
const LABEL_DESCRIPTIONS: Record<string, { violation: string; field: string; recommendation: string }> = {
  thc_limit_violation: {
    violation: 'ML model detected potential THC content limit violation',
    field: 'totalMgThc',
    recommendation: 'Review product THC content against jurisdiction limits',
  },
  cbd_limit_violation: {
    violation: 'ML model detected potential CBD content labeling issue',
    field: 'totalMgCbd',
    recommendation: 'Verify CBD content labeling accuracy',
  },
  missing_tracking: {
    violation: 'ML model flagged potential track-and-trace compliance gap',
    field: 'stateTrackingId',
    recommendation: 'Ensure all products have valid state tracking IDs',
  },
  age_verification_issue: {
    violation: 'ML model detected potential age verification concern',
    field: 'customerAge',
    recommendation: 'Review age verification procedures for this transaction',
  },
  quantity_limit_violation: {
    violation: 'ML model flagged potential purchase quantity limit exceeded',
    field: 'quantity',
    recommendation: 'Check daily purchase limits for this customer',
  },
  tax_discrepancy: {
    violation: 'ML model detected potential tax calculation discrepancy',
    field: 'taxes',
    recommendation: 'Audit tax calculations against jurisdiction rates',
  },
  naming_violation: {
    violation: 'ML model detected potential product naming compliance issue (medical claims, restricted terms)',
    field: 'productName',
    recommendation: 'Review product name for prohibited medical claims or restricted terminology',
  },
  hours_violation: {
    violation: 'ML model flagged transaction outside permitted operating hours',
    field: 'dateOpen',
    recommendation: 'Verify transaction timestamp falls within legal operating hours',
  },
  pricing_anomaly: {
    violation: 'ML model detected suspicious pricing pattern (below-cost, bulk discount evasion)',
    field: 'grossSales',
    recommendation: 'Review pricing for compliance with minimum markup requirements and promotional limits',
  },
  distributor_issue: {
    violation: 'ML model flagged potential unlicensed or unverified distributor',
    field: 'distributor',
    recommendation: 'Verify distributor licensing status against state registry',
  },
};

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

export const handler = async (event: MLScannerEvent) => {
  console.log('[MLScanner] Starting ML classification scan...', JSON.stringify(event));
  const startTime = Date.now();

  if (!event.scanId) throw new Error('scanId is required');

  await bootstrapDatabase();
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Step 1: Verify SageMaker endpoint is available
    const endpointReady = await checkEndpointHealth();
    if (!endpointReady) {
      console.warn('[MLScanner] SageMaker endpoint not available. Returning empty results.');
      return { violationCount: 0, s3ResultKey: null, status: 'endpoint_unavailable' };
    }

    // Step 2: Determine date range
    const dateRange = resolveDateRange(event.dateRange);
    console.log(`[MLScanner] Scanning ${dateRange.startDate.toISOString()} to ${dateRange.endDate.toISOString()}`);

    // Step 3: Query and classify in cursor-paginated batches
    const violations: MLViolation[] = [];
    let totalScanned = 0;
    let cursor: string | undefined;

    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = {
        dateOpen: {
          gte: dateRange.startDate,
          lte: dateRange.endDate,
        },
      };

      const items = await prisma.salesLineItem.findMany({
        where,
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          productName: true,
          productType: true,
          productSubtype: true,
          classification: true,
          totalMgThc: true,
          totalMgCbd: true,
          size: true,
          quantity: true,
          grossSales: true,
          discounts: true,
          taxes: true,
          netSales: true,
          stateTrackingId: true,
          customerAge: true,
          customerDob: true,
          customerTreezId: true,
          distributor: true,
          dateOpen: true,
          dateClose: true,
          storefrontId: true,
        },
      });

      if (items.length === 0) break;

      cursor = items[items.length - 1].id;
      totalScanned += items.length;

      // Classify in inference batches
      for (let i = 0; i < items.length; i += INFERENCE_BATCH) {
        const batch = items.slice(i, i + INFERENCE_BATCH);
        const batchViolations = await classifyBatch(batch);
        violations.push(...batchViolations);
      }

      console.log(`[MLScanner] Scanned ${totalScanned} records, ${violations.length} violations so far`);

      if (items.length < BATCH_SIZE) break; // last page
    }

    // Step 4: Write violations to S3
    let s3ResultKey: string | null = null;
    if (violations.length > 0) {
      const dateStr = new Date().toISOString().split('T')[0];
      s3ResultKey = `${RESULTS_PREFIX}${dateStr}/ml-results-${event.scanId}.jsonl`;

      const jsonl = violations.map(v => JSON.stringify(v)).join('\n');
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3ResultKey,
        Body: jsonl,
        ContentType: 'application/x-ndjson',
      }));

      console.log(`[MLScanner] Wrote ${violations.length} violations to ${s3ResultKey}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[MLScanner] Complete in ${duration}s. Scanned ${totalScanned} records, found ${violations.length} violations.`);

    return {
      violationCount: violations.length,
      s3ResultKey,
      recordsScanned: totalScanned,
      status: 'completed',
    };
  } finally {
    await prisma.$disconnect();
  }
};

// ─── SageMaker Inference ────────────────────────────────────────────────────

async function checkEndpointHealth(): Promise<boolean> {
  try {
    // Send a minimal request to verify the endpoint is active
    const testPayload = JSON.stringify({ instances: ['test: health check'] });
    await sagemakerRuntime.send(new InvokeEndpointCommand({
      EndpointName: ENDPOINT_NAME,
      ContentType: 'application/json',
      Body: testPayload,
    }));
    return true;
  } catch (err: unknown) {
    const error = err as { name?: string };
    // ModelNotReadyException means endpoint exists but cold-starting (serverless)
    if (error.name === 'ModelNotReadyException') {
      console.log('[MLScanner] Endpoint is cold-starting, will retry during scan');
      return true;
    }
    console.warn('[MLScanner] Endpoint health check failed:', error);
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function classifyBatch(items: any[]): Promise<MLViolation[]> {
  // Step 1: Serialize each SalesLineItem into the text format the model expects
  const texts = items.map(serializeSalesItem);

  // Step 2: Invoke SageMaker endpoint
  let predictions: SageMakerPrediction[];
  try {
    predictions = await invokeEndpoint(texts);
  } catch (err: unknown) {
    const error = err as { name?: string };
    // If endpoint is cold-starting, retry once after a delay
    if (error.name === 'ModelNotReadyException') {
      console.log('[MLScanner] Endpoint cold start, waiting 30s and retrying...');
      await sleep(30000);
      predictions = await invokeEndpoint(texts);
    } else {
      console.error('[MLScanner] SageMaker invocation failed:', err);
      return []; // Skip this batch rather than fail the entire scan
    }
  }

  // Step 3: Convert predictions to violations (only non-compliant)
  const violations: MLViolation[] = [];

  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const item = items[i];

    // Skip items classified as compliant
    if (pred.labels.length === 1 && pred.labels[0] === 'compliant') continue;
    if (pred.risk_score < 0.4) continue; // Below medium threshold

    for (const label of pred.labels) {
      if (label === 'compliant') continue;

      const labelScore = pred.scores[label] || pred.risk_score;
      if (labelScore < 0.5) continue; // Below classification threshold

      const desc = LABEL_DESCRIPTIONS[label];
      if (!desc) continue;

      violations.push({
        ruleId: `ML-${label.toUpperCase()}`,
        riskLevel: scoreToRiskLevel(labelScore),
        riskScore: labelScore,
        detectionMethod: 'ml_model',
        violation: desc.violation,
        salesLineItemId: item.id,
        productName: item.productName || null,
        productType: item.productType || null,
        field: desc.field,
        actualValue: getFieldValue(item, desc.field),
        limitValue: `ML confidence: ${(labelScore * 100).toFixed(1)}%`,
        recommendation: desc.recommendation,
      });
    }
  }

  return violations;
}

async function invokeEndpoint(texts: string[]): Promise<SageMakerPrediction[]> {
  const payload = JSON.stringify({ instances: texts });

  const response = await sagemakerRuntime.send(new InvokeEndpointCommand({
    EndpointName: ENDPOINT_NAME,
    ContentType: 'application/json',
    Body: payload,
  }));

  const responseBody = new TextDecoder().decode(response.Body);
  const parsed: SageMakerResponse = JSON.parse(responseBody);

  return parsed.predictions;
}

// ─── Serialization ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeSalesItem(item: any): string {
  // Convert SalesLineItem fields into the natural language text format
  // that the DistilBERT model was trained on (matching training-data-gen output)
  const parts: string[] = [];

  if (item.productType) parts.push(`Product Type: ${item.productType}`);
  if (item.productSubtype) parts.push(`Product Subtype: ${item.productSubtype}`);
  if (item.classification) parts.push(`Classification: ${item.classification}`);
  if (item.productName) parts.push(`Product Name: ${item.productName}`);

  // Convert Prisma Decimal fields to numbers
  const thc = item.totalMgThc ? Number(item.totalMgThc) : null;
  const cbd = item.totalMgCbd ? Number(item.totalMgCbd) : null;
  const quantity = item.quantity ? Number(item.quantity) : null;
  const grossSales = item.grossSales ? Number(item.grossSales) : null;
  const discounts = item.discounts ? Number(item.discounts) : null;
  const taxes = item.taxes ? Number(item.taxes) : null;
  const netSales = item.netSales ? Number(item.netSales) : null;

  if (thc !== null) parts.push(`Total Mg THC: ${thc}`);
  if (cbd !== null) parts.push(`Total Mg CBD: ${cbd}`);
  if (item.size) parts.push(`Size: ${item.size}`);
  if (quantity !== null) parts.push(`Quantity: ${quantity}`);
  if (grossSales !== null) parts.push(`Gross Sales: ${grossSales}`);
  if (discounts !== null) parts.push(`Discount: ${discounts}`);
  if (taxes !== null) parts.push(`Taxes: ${taxes}`);
  if (netSales !== null) parts.push(`Net Sales: ${netSales}`);

  if (item.stateTrackingId) {
    parts.push(`State Tracking ID: ${item.stateTrackingId}`);
  } else {
    parts.push('State Tracking ID: MISSING');
  }

  if (item.customerAge) parts.push(`Customer Age: ${item.customerAge}`);
  if (item.distributor) parts.push(`Distributor: ${item.distributor}`);

  if (item.dateOpen) {
    const d = new Date(item.dateOpen);
    parts.push(`Transaction Time: ${d.toISOString()}`);
    parts.push(`Transaction Hour: ${d.getHours()}`);
  }

  parts.push(`Jurisdiction: ${DEFAULT_JURISDICTION}`);

  return parts.join(', ');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveDateRange(dateRange?: MLScannerEvent['dateRange']): { startDate: Date; endDate: Date } {
  if (dateRange?.startDate && dateRange?.endDate) {
    return {
      startDate: new Date(dateRange.startDate),
      endDate: new Date(dateRange.endDate),
    };
  }

  const lookbackDays = dateRange?.lookbackDays || 1;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate };
}

function scoreToRiskLevel(score: number): string {
  if (score >= 0.9) return 'critical';
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFieldValue(item: any, field: string): string {
  const val = item[field];
  if (val === null || val === undefined) return 'null';
  if (val instanceof Date) return val.toISOString();
  // Handle Prisma Decimal
  if (typeof val === 'object' && typeof val.toNumber === 'function') {
    return val.toNumber().toString();
  }
  return String(val);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
