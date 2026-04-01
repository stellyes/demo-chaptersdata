// ============================================
// LAMBDA: COMPLIANCE RULE COMPILER
// Reads enriched corpus JSONL from S3, groups by
// jurisdiction + compliance area, and uses Claude Haiku
// to compile structured compliance rules.
//
// Triggered by: corpus-sync Lambda (async) or manual
// ============================================

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import Anthropic from '@anthropic-ai/sdk';

const REGION = process.env.AWS_REGION || 'us-west-1';
const BUCKET = process.env.S3_BUCKET || 'retail-data-bcgr';
const EXPORT_PREFIX = 'cannabis-compliance/training/exports/';
const RULES_PREFIX = 'cannabis-compliance/knowledge-base/rules/';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_DOCS_PER_BATCH = 30;

const s3 = new S3Client({ region: REGION });

// ─── Types ──────────────────────────────────────────────────────────────────

interface EnrichedDocument {
  id: number;
  url: string;
  title: string | null;
  jurisdiction: string;
  agency: string | null;
  documentType: string | null;
  publishedDate: string | null;
  summary: string | null;
  complianceRequirements: Array<{
    requirement: string;
    enforcedBy: string;
    penalty?: string;
    deadline?: string;
  }> | null;
  legalCitations: Array<{ citation: string; context: string }> | null;
  entities: {
    agencies?: string[];
    licenseTypes?: string[];
    substances?: string[];
    thresholds?: string[];
    locations?: string[];
  } | null;
  topics: string[] | null;
  regulationType: string | null;
  effectiveDateExtracted: string | null;
  expirationDateExtracted: string | null;
  complianceAreas: string[] | null;
  keyProvisions: Array<{
    provision: string;
    section?: string;
    significance: string;
  }> | null;
}

interface CompiledRuleOutput {
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
  enforcedBy: string | null;
  penalty: string | null;
  citations: string[];
  sourceDocumentIds: number[];
  effectiveDate: string | null;
  severity: string;
}

interface CompilerEvent {
  source?: string;
  exportKey?: string;
  enrichedCount?: number;
  totalDocuments?: number;
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

export const handler = async (event: CompilerEvent) => {
  console.log('[RuleCompiler] Starting rule compilation...', JSON.stringify(event));
  const startTime = Date.now();

  await bootstrapDatabase();

  // Dynamic import after DATABASE_URL is set
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Step 1: Load enriched JSONL from S3
    const exportKey = event.exportKey || `${EXPORT_PREFIX}corpus-enriched-latest.jsonl`;
    const documents = await loadEnrichedDocuments(exportKey);
    console.log(`[RuleCompiler] Loaded ${documents.length} enriched documents.`);

    // Step 2: Group by jurisdiction + compliance area
    const groups = groupDocuments(documents);
    console.log(`[RuleCompiler] Grouped into ${groups.size} jurisdiction/area combinations.`);

    // Step 3: Compile rules for each group using Claude Haiku
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
    const allRules: CompiledRuleOutput[] = [];
    let totalTokensUsed = 0;

    for (const [groupKey, groupDocs] of groups.entries()) {
      const [jurisdiction, complianceArea] = groupKey.split('::');
      console.log(`[RuleCompiler] Compiling rules for ${jurisdiction}/${complianceArea} (${groupDocs.length} docs)...`);

      // Batch documents if group is large
      const batches = chunkArray(groupDocs, MAX_DOCS_PER_BATCH);
      for (const batch of batches) {
        const { rules, tokensUsed } = await compileRulesForGroup(
          anthropic, jurisdiction, complianceArea, batch,
        );
        allRules.push(...rules);
        totalTokensUsed += tokensUsed;
      }
    }

    // Step 4: Deduplicate rules
    const deduped = deduplicateRules(allRules);
    console.log(`[RuleCompiler] Compiled ${deduped.length} unique rules (${allRules.length} before dedup). Tokens used: ${totalTokensUsed}.`);

    // Step 5: Write rules to S3
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const manifestKey = `${RULES_PREFIX}current/rules-manifest.json`;
    const rulesKey = `${RULES_PREFIX}current/all-rules.jsonl`;
    const versionKey = `${RULES_PREFIX}versions/${timestamp}/all-rules.jsonl`;

    const manifest = {
      version: timestamp,
      ruleCount: deduped.length,
      jurisdictions: [...new Set(deduped.map(r => r.jurisdiction))].sort(),
      complianceAreas: [...new Set(deduped.map(r => r.complianceArea))].sort(),
      compiledAt: new Date().toISOString(),
      sourceDocumentCount: documents.length,
      tokensUsed: totalTokensUsed,
    };

    const rulesJsonl = deduped.map(r => JSON.stringify(r)).join('\n');

    await Promise.all([
      uploadToS3(manifestKey, JSON.stringify(manifest, null, 2), 'application/json'),
      uploadToS3(rulesKey, rulesJsonl, 'application/x-ndjson'),
      uploadToS3(versionKey, rulesJsonl, 'application/x-ndjson'),
    ]);

    // Step 6: Upsert rules to Aurora
    let upserted = 0;
    for (const rule of deduped) {
      await prisma.complianceRule.upsert({
        where: { ruleId: rule.ruleId },
        create: {
          ruleId: rule.ruleId,
          jurisdiction: rule.jurisdiction,
          complianceArea: rule.complianceArea,
          productTypes: rule.productTypes,
          ruleType: rule.ruleType,
          condition: rule.condition,
          enforcedBy: rule.enforcedBy,
          penalty: rule.penalty,
          citations: rule.citations,
          sourceDocumentIds: rule.sourceDocumentIds,
          effectiveDate: rule.effectiveDate ? new Date(rule.effectiveDate) : null,
          severity: rule.severity,
          isActive: true,
          version: 1,
        },
        update: {
          complianceArea: rule.complianceArea,
          productTypes: rule.productTypes,
          ruleType: rule.ruleType,
          condition: rule.condition,
          enforcedBy: rule.enforcedBy,
          penalty: rule.penalty,
          citations: rule.citations,
          sourceDocumentIds: rule.sourceDocumentIds,
          effectiveDate: rule.effectiveDate ? new Date(rule.effectiveDate) : null,
          severity: rule.severity,
          lastVerified: new Date(),
          version: { increment: 1 },
        },
      });
      upserted++;
    }

    // Step 7: Record rule version
    await prisma.complianceRuleVersion.create({
      data: {
        snapshotDate: new Date(),
        s3Path: versionKey,
        totalRules: deduped.length,
        jurisdictions: [...new Set(deduped.map(r => r.jurisdiction))],
        sourceCorpusSize: documents.length,
      },
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[RuleCompiler] Complete in ${duration}s. ${upserted} rules upserted to Aurora.`);

    return {
      success: true,
      rulesCompiled: deduped.length,
      rulesUpserted: upserted,
      jurisdictions: manifest.jurisdictions,
      tokensUsed: totalTokensUsed,
      durationSeconds: parseFloat(duration),
    };
  } finally {
    await prisma.$disconnect();
  }
};

// ─── Claude Compilation ─────────────────────────────────────────────────────

async function compileRulesForGroup(
  anthropic: Anthropic,
  jurisdiction: string,
  complianceArea: string,
  documents: EnrichedDocument[],
): Promise<{ rules: CompiledRuleOutput[]; tokensUsed: number }> {
  // Build context from enriched documents
  const docSummaries = documents.map(doc => {
    const parts: string[] = [];
    parts.push(`Document #${doc.id}: "${doc.title || 'Untitled'}"`);
    if (doc.summary) parts.push(`Summary: ${doc.summary}`);
    if (doc.complianceRequirements?.length) {
      parts.push(`Requirements: ${JSON.stringify(doc.complianceRequirements)}`);
    }
    if (doc.legalCitations?.length) {
      parts.push(`Citations: ${JSON.stringify(doc.legalCitations)}`);
    }
    if (doc.entities?.thresholds?.length) {
      parts.push(`Thresholds: ${doc.entities.thresholds.join('; ')}`);
    }
    if (doc.keyProvisions?.length) {
      parts.push(`Key Provisions: ${JSON.stringify(doc.keyProvisions)}`);
    }
    if (doc.effectiveDateExtracted) {
      parts.push(`Effective: ${doc.effectiveDateExtracted}`);
    }
    return parts.join('\n');
  }).join('\n\n---\n\n');

  const systemPrompt = `You are a cannabis regulatory compliance expert. You extract structured, machine-readable compliance rules from regulatory documents.

Your output MUST be a JSON array of rule objects. Each rule represents a specific, testable compliance requirement that can be checked against sales transaction data.

IMPORTANT: Only output rules that can be verified against point-of-sale transaction data with these fields:
- totalMgThc, totalMgCbd (cannabinoid content in mg)
- productType, productSubtype (flower, edible, concentrate, topical, preroll, cartridge, tincture, etc.)
- quantity (units in transaction)
- pricePerUnit, grossSales, netSales, taxes
- customerAge (customer age in years)
- stateTrackingId (state track-and-trace ID)
- distributor (distributor name)
- size (product size/weight)

Each rule object must have:
{
  "ruleId": "<JURISDICTION>-<AREA>-<TYPE>-<NNN>",
  "jurisdiction": "${jurisdiction}",
  "complianceArea": "${complianceArea}",
  "productTypes": ["edible", "flower", ...],  // empty array = applies to all
  "ruleType": "threshold|restriction|requirement|prohibition",
  "condition": {
    "field": "<sales field name>",
    "operator": "lte|gte|lt|gt|eq|neq|is_null|not_null|in|not_in|contains|between",
    "value": <number or string or array>,
    "upperValue": <number, for 'between' only>,
    "unit": "mg|g|oz|years|usd",
    "per": "package|serving|transaction|day|customer"
  },
  "enforcedBy": "agency name or null",
  "penalty": "penalty description or null",
  "citations": ["citation1", "citation2"],
  "sourceDocumentIds": [doc_id1, doc_id2],
  "effectiveDate": "YYYY-MM-DD or null",
  "severity": "critical|high|medium|low"
}

Guidelines:
- If a newer document supersedes an older one, use the newer rule
- If multiple documents reinforce the same rule, merge their citations
- Severity: critical = immediate public safety risk, high = license risk, medium = fine risk, low = record-keeping
- Use "is_null" for requirement checks (e.g., stateTrackingId must not be null)
- Use "lte" for threshold limits (e.g., THC mg must be <= 100)
- Only extract rules you are confident about. Do not guess thresholds.`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Extract compliance rules for ${jurisdiction} / ${complianceArea} from these ${documents.length} enriched regulatory documents:\n\n${docSummaries}\n\nReturn ONLY a JSON array of rule objects. No explanation.`,
    }],
  });

  const textContent = response.content.find(c => c.type === 'text');
  const text = textContent?.type === 'text' ? textContent.text : '[]';
  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

  // Parse rules from response
  const rules = parseRulesFromResponse(text, jurisdiction, complianceArea, documents);

  return { rules, tokensUsed };
}

function parseRulesFromResponse(
  text: string,
  jurisdiction: string,
  complianceArea: string,
  sourceDocs: EnrichedDocument[],
): CompiledRuleOutput[] {
  try {
    // Extract JSON array from response (handle markdown code blocks)
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonText) as CompiledRuleOutput[];
    if (!Array.isArray(parsed)) return [];

    // Validate and normalize each rule
    return parsed
      .filter(rule => rule.ruleId && rule.condition && rule.condition.field && rule.condition.operator)
      .map(rule => ({
        ...rule,
        jurisdiction: rule.jurisdiction || jurisdiction,
        complianceArea: rule.complianceArea || complianceArea,
        productTypes: Array.isArray(rule.productTypes) ? rule.productTypes : [],
        citations: Array.isArray(rule.citations) ? rule.citations : [],
        sourceDocumentIds: Array.isArray(rule.sourceDocumentIds)
          ? rule.sourceDocumentIds
          : sourceDocs.map(d => d.id),
        severity: ['critical', 'high', 'medium', 'low'].includes(rule.severity) ? rule.severity : 'medium',
        ruleType: ['threshold', 'restriction', 'requirement', 'prohibition'].includes(rule.ruleType) ? rule.ruleType : 'requirement',
      }));
  } catch (err) {
    console.error(`[RuleCompiler] Failed to parse rules for ${jurisdiction}/${complianceArea}:`, err);
    return [];
  }
}

// ─── Document Grouping ──────────────────────────────────────────────────────

function groupDocuments(documents: EnrichedDocument[]): Map<string, EnrichedDocument[]> {
  const groups = new Map<string, EnrichedDocument[]>();

  for (const doc of documents) {
    const areas = doc.complianceAreas?.length
      ? doc.complianceAreas
      : doc.topics?.length
        ? doc.topics
        : ['general'];

    for (const area of areas) {
      const key = `${doc.jurisdiction}::${area}`;
      const existing = groups.get(key) || [];
      existing.push(doc);
      groups.set(key, existing);
    }
  }

  return groups;
}

// ─── S3 Helpers ─────────────────────────────────────────────────────────────

async function loadEnrichedDocuments(key: string): Promise<EnrichedDocument[]> {
  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const text = await response.Body!.transformToString();

  return text.split('\n')
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line) as EnrichedDocument; } catch { return null; }
    })
    .filter((doc): doc is EnrichedDocument => doc !== null);
}

async function uploadToS3(key: string, content: string, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: content,
    ContentType: contentType,
  }));
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function deduplicateRules(rules: CompiledRuleOutput[]): CompiledRuleOutput[] {
  const seen = new Map<string, CompiledRuleOutput>();

  for (const rule of rules) {
    // Deduplicate by ruleId
    if (seen.has(rule.ruleId)) {
      const existing = seen.get(rule.ruleId)!;
      // Merge citations and source document IDs
      existing.citations = [...new Set([...existing.citations, ...rule.citations])];
      existing.sourceDocumentIds = [...new Set([...existing.sourceDocumentIds, ...rule.sourceDocumentIds])];
    } else {
      // Also check for semantic duplicates (same jurisdiction + field + operator + value)
      const semanticKey = `${rule.jurisdiction}:${rule.condition.field}:${rule.condition.operator}:${JSON.stringify(rule.condition.value)}:${rule.productTypes.sort().join(',')}`;
      const existingBySemantic = [...seen.values()].find(r => {
        const rKey = `${r.jurisdiction}:${r.condition.field}:${r.condition.operator}:${JSON.stringify(r.condition.value)}:${r.productTypes.sort().join(',')}`;
        return rKey === semanticKey;
      });

      if (existingBySemantic) {
        existingBySemantic.citations = [...new Set([...existingBySemantic.citations, ...rule.citations])];
        existingBySemantic.sourceDocumentIds = [...new Set([...existingBySemantic.sourceDocumentIds, ...rule.sourceDocumentIds])];
      } else {
        seen.set(rule.ruleId, { ...rule });
      }
    }
  }

  return [...seen.values()];
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
