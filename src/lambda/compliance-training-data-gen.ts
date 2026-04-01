// ============================================
// LAMBDA: COMPLIANCE TRAINING DATA GENERATOR
// Generates labeled training data for the DistilBERT
// compliance classifier using a teacher-student approach:
//   1. Synthetic examples from compiled rules
//   2. Real sales data labeled by Claude Haiku
//   3. Augmented edge-case examples
//
// Writes train/val/test JSONL splits to S3.
//
// Triggered by: EventBridge monthly schedule (1st of month)
//               Chains to compliance-train-trigger on completion.
// ============================================

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import Anthropic from '@anthropic-ai/sdk';

const REGION = process.env.AWS_REGION || 'us-west-1';
const BUCKET = process.env.S3_BUCKET || 'retail-data-bcgr';
const RULES_KEY = 'cannabis-compliance/knowledge-base/rules/current/all-rules.jsonl';
const DATASETS_PREFIX = 'cannabis-compliance/training/datasets/compliance-classification/';
const TRAIN_TRIGGER_FUNCTION = process.env.TRAIN_TRIGGER_FUNCTION || 'chapters-compliance-train-trigger';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const SYNTHETIC_PER_RULE = 6;          // 3 compliant + 3 violating per rule
const REAL_SAMPLE_SIZE = 2000;
const REAL_LABEL_BATCH_SIZE = 20;      // items per Claude call
const TRAIN_SPLIT = 0.70;
const VAL_SPLIT = 0.15;
// test gets the remaining 0.15

const s3 = new S3Client({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

// ─── Types ──────────────────────────────────────────────────────────────────

interface CompiledRule {
  ruleId: string;
  jurisdiction: string;
  complianceArea: string;
  productTypes: string[];
  ruleType: string;
  condition: {
    field: string;
    operator: string;
    value?: unknown;
    upperValue?: unknown;
    unit?: string;
    per?: string;
  };
  severity: string;
  citations: string[];
}

interface TrainingExample {
  text: string;                    // serialized sales fields as natural language
  labels: string[];                // multi-label: ["compliant"] or ["thc_limit_violation", "missing_tracking"]
  jurisdiction: string;
  source: 'synthetic' | 'real' | 'augmented';
  sourceRuleId?: string;
}

interface TrainingDataGenEvent {
  source?: string;
  skipRealLabeling?: boolean;      // for testing: skip Claude labeling
}

// All possible labels for the classifier
const ALL_LABELS = [
  'compliant',
  'thc_limit_violation',
  'cbd_limit_violation',
  'missing_tracking',
  'age_verification_issue',
  'quantity_limit_violation',
  'tax_discrepancy',
  'naming_violation',
  'hours_violation',
  'pricing_anomaly',
  'distributor_issue',
] as const;

// Map compliance areas / rule fields to labels
const AREA_TO_LABEL: Record<string, string> = {
  testing: 'thc_limit_violation',
  thc_limits: 'thc_limit_violation',
  cbd_limits: 'cbd_limit_violation',
  tracking: 'missing_tracking',
  age_verification: 'age_verification_issue',
  quantity: 'quantity_limit_violation',
  taxation: 'tax_discrepancy',
  labeling: 'naming_violation',
  advertising: 'naming_violation',
  pricing: 'pricing_anomaly',
  distributor: 'distributor_issue',
  operating_hours: 'hours_violation',
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

export const handler = async (event: TrainingDataGenEvent) => {
  console.log('[TrainingDataGen] Starting training data generation...', JSON.stringify(event));
  const startTime = Date.now();

  await bootstrapDatabase();
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Step 1: Load compiled rules
    const rules = await loadRulesFromS3();
    console.log(`[TrainingDataGen] Loaded ${rules.length} compiled rules.`);

    if (rules.length === 0) {
      console.log('[TrainingDataGen] No rules available. Cannot generate training data.');
      return { success: false, reason: 'no_rules' };
    }

    const allExamples: TrainingExample[] = [];

    // Step 2: Generate synthetic examples from rules
    const synthetic = generateSyntheticExamples(rules);
    allExamples.push(...synthetic);
    console.log(`[TrainingDataGen] Generated ${synthetic.length} synthetic examples.`);

    // Step 3: Label real sales data with Claude Haiku
    if (!event.skipRealLabeling) {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
      const realExamples = await labelRealSalesData(prisma, anthropic, rules);
      allExamples.push(...realExamples);
      console.log(`[TrainingDataGen] Generated ${realExamples.length} real-labeled examples.`);
    }

    // Step 4: Generate augmented edge-case examples
    const augmented = generateAugmentedExamples(rules, allExamples);
    allExamples.push(...augmented);
    console.log(`[TrainingDataGen] Generated ${augmented.length} augmented examples.`);

    // Step 5: Shuffle and split
    shuffle(allExamples);
    const trainEnd = Math.floor(allExamples.length * TRAIN_SPLIT);
    const valEnd = trainEnd + Math.floor(allExamples.length * VAL_SPLIT);

    const trainSet = allExamples.slice(0, trainEnd);
    const valSet = allExamples.slice(trainEnd, valEnd);
    const testSet = allExamples.slice(valEnd);

    // Step 6: Write splits to S3
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = `${DATASETS_PREFIX}${timestamp}/`;

    await Promise.all([
      writeJsonlToS3(`${prefix}train.jsonl`, trainSet),
      writeJsonlToS3(`${prefix}validation.jsonl`, valSet),
      writeJsonlToS3(`${prefix}test.jsonl`, testSet),
      writeJsonlToS3(`${prefix}label-map.json`, ALL_LABELS),
    ]);

    // Also write to a "latest" path for the training job
    await Promise.all([
      writeJsonlToS3(`${DATASETS_PREFIX}latest/train.jsonl`, trainSet),
      writeJsonlToS3(`${DATASETS_PREFIX}latest/validation.jsonl`, valSet),
      writeJsonlToS3(`${DATASETS_PREFIX}latest/test.jsonl`, testSet),
      writeJsonlToS3(`${DATASETS_PREFIX}latest/label-map.json`, ALL_LABELS),
    ]);

    const stats = {
      totalExamples: allExamples.length,
      syntheticCount: synthetic.length,
      realLabeledCount: allExamples.filter(e => e.source === 'real').length,
      augmentedCount: augmented.length,
      trainCount: trainSet.length,
      valCount: valSet.length,
      testCount: testSet.length,
      labelDistribution: computeLabelDistribution(allExamples),
    };

    // Write metadata
    await writeJsonlToS3(`${prefix}metadata.json`, {
      generatedAt: new Date().toISOString(),
      rulesUsed: rules.length,
      ...stats,
    });

    console.log('[TrainingDataGen] Dataset stats:', JSON.stringify(stats));

    // Step 7: Trigger training job
    console.log('[TrainingDataGen] Triggering SageMaker training job...');
    await lambda.send(new InvokeCommand({
      FunctionName: TRAIN_TRIGGER_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({
        source: 'training-data-gen',
        datasetPrefix: `${prefix}`,
        latestPrefix: `${DATASETS_PREFIX}latest/`,
        stats,
      })),
    }));

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[TrainingDataGen] Complete in ${duration}s.`);

    return { success: true, ...stats, datasetPrefix: prefix, durationSeconds: parseFloat(duration) };
  } finally {
    await prisma.$disconnect();
  }
};

// ─── Synthetic Example Generation ───────────────────────────────────────────

function generateSyntheticExamples(rules: CompiledRule[]): TrainingExample[] {
  const examples: TrainingExample[] = [];

  for (const rule of rules) {
    const label = inferLabel(rule);
    const productType = rule.productTypes[0] || 'flower';

    // Generate compliant examples
    for (let i = 0; i < Math.ceil(SYNTHETIC_PER_RULE / 2); i++) {
      const compliantFields = generateCompliantFields(rule, productType);
      examples.push({
        text: serializeToText(compliantFields),
        labels: ['compliant'],
        jurisdiction: rule.jurisdiction,
        source: 'synthetic',
        sourceRuleId: rule.ruleId,
      });
    }

    // Generate violating examples
    for (let i = 0; i < Math.floor(SYNTHETIC_PER_RULE / 2); i++) {
      const violatingFields = generateViolatingFields(rule, productType);
      examples.push({
        text: serializeToText(violatingFields),
        labels: [label],
        jurisdiction: rule.jurisdiction,
        source: 'synthetic',
        sourceRuleId: rule.ruleId,
      });
    }
  }

  return examples;
}

function generateCompliantFields(rule: CompiledRule, productType: string): Record<string, string> {
  const fields: Record<string, string> = {
    productType,
    jurisdiction: rule.jurisdiction,
  };

  const cond = rule.condition;
  switch (cond.operator) {
    case 'lte': {
      const limit = Number(cond.value) || 100;
      fields[cond.field] = String(Math.max(0, limit - randomInt(1, Math.floor(limit * 0.3))));
      fields.productName = `${productType} Product ${randomInt(100, 999)}`;
      break;
    }
    case 'gte': {
      const min = Number(cond.value) || 21;
      fields[cond.field] = String(min + randomInt(0, 30));
      break;
    }
    case 'is_null': {
      // is_null means "field must not be null" for requirement rules
      // So compliant means field IS present
      fields[cond.field] = `TRACK-${randomInt(100000, 999999)}`;
      break;
    }
    case 'not_in': {
      fields[cond.field] = 'standard_product';
      break;
    }
    default: {
      fields[cond.field] = String(cond.value || 'compliant_value');
    }
  }

  // Add realistic common fields
  fields.quantity = String(randomInt(1, 5));
  fields.netSales = String((randomInt(10, 80) + Math.random()).toFixed(2));
  fields.customerAge = String(randomInt(21, 65));
  fields.stateTrackingId = fields.stateTrackingId || `1A-${randomInt(10000, 99999)}`;

  return fields;
}

function generateViolatingFields(rule: CompiledRule, productType: string): Record<string, string> {
  const fields: Record<string, string> = {
    productType,
    jurisdiction: rule.jurisdiction,
  };

  const cond = rule.condition;
  switch (cond.operator) {
    case 'lte': {
      const limit = Number(cond.value) || 100;
      fields[cond.field] = String(limit + randomInt(1, Math.floor(limit * 0.5)));
      fields.productName = `High Potency ${productType} ${randomInt(100, 999)}`;
      break;
    }
    case 'gte': {
      const min = Number(cond.value) || 21;
      fields[cond.field] = String(Math.max(0, min - randomInt(1, 5)));
      break;
    }
    case 'is_null': {
      // Violation: field IS null/empty
      fields[cond.field] = '';
      break;
    }
    case 'not_in': {
      const banned = Array.isArray(cond.value) ? cond.value : [];
      if (banned.length > 0) fields[cond.field] = String(banned[0]);
      break;
    }
    default: {
      fields[cond.field] = 'violating_value';
    }
  }

  fields.quantity = String(randomInt(1, 10));
  fields.netSales = String((randomInt(5, 120) + Math.random()).toFixed(2));
  fields.customerAge = String(randomInt(18, 65));

  return fields;
}

// ─── Real Data Labeling ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function labelRealSalesData(prisma: any, anthropic: Anthropic, rules: CompiledRule[]): Promise<TrainingExample[]> {
  // Sample random sales line items
  const totalCount = await prisma.salesLineItem.count();
  const skipCount = Math.max(0, totalCount - REAL_SAMPLE_SIZE);
  const randomSkip = randomInt(0, Math.max(0, skipCount));

  const items = await prisma.salesLineItem.findMany({
    take: REAL_SAMPLE_SIZE,
    skip: randomSkip,
    select: {
      productName: true,
      productType: true,
      productSubtype: true,
      stateTrackingId: true,
      distributor: true,
      quantity: true,
      pricePerUnit: true,
      netSales: true,
      taxes: true,
      customerAge: true,
      totalMgThc: true,
      totalMgCbd: true,
      size: true,
      dateOpen: true,
    },
  });

  if (items.length === 0) return [];

  // Build rules summary for Claude context
  const rulesSummary = rules.slice(0, 50).map(r =>
    `${r.ruleId}: ${r.condition.field} ${r.condition.operator} ${JSON.stringify(r.condition.value)} (${r.complianceArea}, ${r.jurisdiction})`
  ).join('\n');

  const examples: TrainingExample[] = [];

  // Process in batches
  for (let i = 0; i < items.length; i += REAL_LABEL_BATCH_SIZE) {
    const batch = items.slice(i, i + REAL_LABEL_BATCH_SIZE);

    const serialized = batch.map((item: Record<string, unknown>, idx: number) => {
      const fields: Record<string, string> = {};
      for (const [key, val] of Object.entries(item)) {
        if (val != null) fields[key] = String(val);
      }
      return `[${idx}] ${serializeToText(fields)}`;
    }).join('\n\n');

    try {
      const response = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 2048,
        system: `You are a cannabis compliance classifier. Given sales transaction data and compliance rules, classify each transaction.

Available labels: ${ALL_LABELS.join(', ')}

Rules reference:
${rulesSummary}

For each transaction, output a JSON array entry: {"index": N, "labels": ["label1", ...]}
If compliant, use ["compliant"]. If multiple violations, list all applicable labels.`,
        messages: [{
          role: 'user',
          content: `Classify these ${batch.length} sales transactions:\n\n${serialized}\n\nReturn a JSON array of classifications.`,
        }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      const text = textContent?.type === 'text' ? textContent.text : '[]';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const classifications = JSON.parse(jsonMatch[0]) as Array<{ index: number; labels: string[] }>;
        for (const cls of classifications) {
          if (cls.index >= 0 && cls.index < batch.length && Array.isArray(cls.labels)) {
            const item = batch[cls.index];
            const fields: Record<string, string> = {};
            for (const [key, val] of Object.entries(item as Record<string, unknown>)) {
              if (val != null) fields[key] = String(val);
            }
            // Validate labels
            const validLabels = cls.labels.filter(l => (ALL_LABELS as readonly string[]).includes(l));
            if (validLabels.length > 0) {
              examples.push({
                text: serializeToText(fields),
                labels: validLabels,
                jurisdiction: 'CA', // default for our stores
                source: 'real',
              });
            }
          }
        }
      }
    } catch (err) {
      console.error(`[TrainingDataGen] Claude labeling batch ${i} failed:`, err);
      // Continue with other batches
    }

    // Brief pause between API calls
    if (i + REAL_LABEL_BATCH_SIZE < items.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return examples;
}

// ─── Augmented Examples ─────────────────────────────────────────────────────

function generateAugmentedExamples(rules: CompiledRule[], existingExamples: TrainingExample[]): TrainingExample[] {
  const augmented: TrainingExample[] = [];
  const targetCount = Math.floor(existingExamples.length * 0.3); // ~30% augmentation

  // Focus on boundary cases near thresholds
  for (const rule of rules) {
    if (augmented.length >= targetCount) break;
    if (rule.condition.operator !== 'lte' && rule.condition.operator !== 'gte') continue;

    const limit = Number(rule.condition.value);
    if (isNaN(limit)) continue;

    const productType = rule.productTypes[0] || 'flower';
    const label = inferLabel(rule);

    // Just below the limit (compliant boundary)
    for (let delta = 1; delta <= 3; delta++) {
      const fields: Record<string, string> = {
        productType,
        jurisdiction: rule.jurisdiction,
        quantity: String(randomInt(1, 5)),
        customerAge: String(randomInt(21, 55)),
        stateTrackingId: `1A-${randomInt(10000, 99999)}`,
        productName: `Boundary Test ${productType} ${delta}`,
      };

      if (rule.condition.operator === 'lte') {
        fields[rule.condition.field] = String(limit - delta);
        augmented.push({ text: serializeToText(fields), labels: ['compliant'], jurisdiction: rule.jurisdiction, source: 'augmented', sourceRuleId: rule.ruleId });

        fields[rule.condition.field] = String(limit + delta);
        augmented.push({ text: serializeToText(fields), labels: [label], jurisdiction: rule.jurisdiction, source: 'augmented', sourceRuleId: rule.ruleId });
      } else {
        fields[rule.condition.field] = String(limit + delta);
        augmented.push({ text: serializeToText(fields), labels: ['compliant'], jurisdiction: rule.jurisdiction, source: 'augmented', sourceRuleId: rule.ruleId });

        fields[rule.condition.field] = String(limit - delta);
        augmented.push({ text: serializeToText(fields), labels: [label], jurisdiction: rule.jurisdiction, source: 'augmented', sourceRuleId: rule.ruleId });
      }
    }
  }

  return augmented;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function serializeToText(fields: Record<string, string>): string {
  return Object.entries(fields)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${camelToReadable(k)}: ${v}`)
    .join(', ');
}

function camelToReadable(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

function inferLabel(rule: CompiledRule): string {
  // Try to match by compliance area
  const area = rule.complianceArea.toLowerCase();
  if (AREA_TO_LABEL[area]) return AREA_TO_LABEL[area];

  // Try to match by field name
  const field = rule.condition.field.toLowerCase();
  if (field.includes('thc')) return 'thc_limit_violation';
  if (field.includes('cbd')) return 'cbd_limit_violation';
  if (field.includes('tracking') || field.includes('trace')) return 'missing_tracking';
  if (field.includes('age')) return 'age_verification_issue';
  if (field.includes('quantity')) return 'quantity_limit_violation';
  if (field.includes('tax')) return 'tax_discrepancy';
  if (field.includes('price') || field.includes('cost')) return 'pricing_anomaly';
  if (field.includes('distributor')) return 'distributor_issue';

  return 'naming_violation'; // fallback
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function computeLabelDistribution(examples: TrainingExample[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const ex of examples) {
    for (const label of ex.labels) {
      dist[label] = (dist[label] || 0) + 1;
    }
  }
  return dist;
}

async function loadRulesFromS3(): Promise<CompiledRule[]> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: RULES_KEY }));
    const text = await response.Body!.transformToString();
    return text.split('\n')
      .filter(line => line.trim())
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean) as CompiledRule[];
  } catch {
    return [];
  }
}

async function writeJsonlToS3(key: string, data: unknown): Promise<void> {
  let body: string;
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null && 'text' in data[0]) {
    // Training examples → JSONL
    body = (data as TrainingExample[]).map(d => JSON.stringify(d)).join('\n');
  } else {
    // Metadata or label map → JSON
    body = JSON.stringify(data, null, 2);
  }
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: key.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/json',
  }));
}
