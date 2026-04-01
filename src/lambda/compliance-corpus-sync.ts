// ============================================
// LAMBDA: COMPLIANCE CORPUS SYNC
// Downloads the SQLite compliance corpus backup
// from S3, extracts enriched documents into JSONL,
// and triggers the rule compiler if new data detected.
//
// Triggered by: EventBridge weekly schedule (Monday 2AM PST)
// ============================================

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';

const REGION = process.env.AWS_REGION || 'us-west-1';
const BUCKET = process.env.S3_BUCKET || 'retail-data-bcgr';
const BACKUP_PREFIX = 'cannabis-compliance/backups/';
const EXPORT_PREFIX = 'cannabis-compliance/training/exports/';
const STATE_KEY = 'cannabis-compliance/training/sync-state.json';
const RULE_COMPILER_FUNCTION = process.env.RULE_COMPILER_FUNCTION || 'chapters-compliance-rule-compiler';

const s3 = new S3Client({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

// ─── Types ──────────────────────────────────────────────────────────────────

interface SyncState {
  lastSync: string;
  documentCount: number;
  enrichedCount: number;
  ruleCount: number;
  corpusHashPrefix: string;
}

interface EnrichedDocument {
  id: number;
  url: string;
  title: string | null;
  jurisdiction: string;
  agency: string | null;
  documentType: string | null;
  publishedDate: string | null;
  collectedAt: string;
  contentLength: number | null;
  status: string;
  // Enrichment fields
  summary: string | null;
  complianceRequirements: unknown[] | null;
  legalCitations: unknown[] | null;
  entities: Record<string, unknown> | null;
  topics: string[] | null;
  regulationType: string | null;
  effectiveDateExtracted: string | null;
  expirationDateExtracted: string | null;
  complianceAreas: string[] | null;
  keyProvisions: unknown[] | null;
  enrichmentModel: string | null;
  enrichedAt: string | null;
}

interface SyncEvent {
  forceSync?: boolean;
  source?: string;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export const handler = async (event: SyncEvent) => {
  console.log('[CorpusSync] Starting corpus sync...', JSON.stringify(event));
  const startTime = Date.now();

  // Step 1: Find the latest backup in S3
  const backupKey = await findLatestBackup();
  if (!backupKey) {
    console.log('[CorpusSync] No backup found in S3. Nothing to sync.');
    return { success: false, reason: 'no_backup_found' };
  }
  console.log(`[CorpusSync] Latest backup: ${backupKey}`);

  // Step 2: Download SQLite database to /tmp
  const dbPath = '/tmp/corpus.db';
  await downloadFromS3(backupKey, dbPath);
  console.log('[CorpusSync] SQLite database downloaded.');

  // Step 3: Query enriched documents
  const db = new Database(dbPath, { readonly: true });
  const { documents, stats } = extractEnrichedDocuments(db);
  db.close();
  console.log(`[CorpusSync] Extracted ${documents.length} enriched documents (${stats.totalDocuments} total in corpus).`);

  // Step 4: Check for delta against previous sync
  const previousState = await loadSyncState();
  const currentHash = computeCorpusHash(documents);
  const hasDelta = event.forceSync ||
    !previousState ||
    previousState.enrichedCount !== documents.length ||
    previousState.documentCount !== stats.totalDocuments ||
    previousState.corpusHashPrefix !== currentHash;

  if (!hasDelta) {
    console.log('[CorpusSync] No changes detected since last sync. Skipping export.');
    return {
      success: true,
      skipped: true,
      reason: 'no_delta',
      stats: { totalDocuments: stats.totalDocuments, enrichedDocuments: documents.length },
    };
  }

  // Step 5: Write enriched JSONL to S3
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonlKey = `${EXPORT_PREFIX}corpus-enriched-${timestamp}.jsonl`;
  const latestKey = `${EXPORT_PREFIX}corpus-enriched-latest.jsonl`;

  const jsonlContent = documents.map(doc => JSON.stringify(doc)).join('\n');

  await Promise.all([
    uploadToS3(jsonlKey, jsonlContent, 'application/x-ndjson'),
    uploadToS3(latestKey, jsonlContent, 'application/x-ndjson'),
  ]);
  console.log(`[CorpusSync] Exported to ${jsonlKey} (${(jsonlContent.length / 1024 / 1024).toFixed(1)} MB)`);

  // Step 6: Save sync state
  const newState: SyncState = {
    lastSync: new Date().toISOString(),
    documentCount: stats.totalDocuments,
    enrichedCount: documents.length,
    ruleCount: previousState?.ruleCount ?? 0,
    corpusHashPrefix: currentHash,
  };
  await saveSyncState(newState);

  // Step 7: Trigger rule compiler
  console.log('[CorpusSync] Triggering rule compiler...');
  await lambda.send(new InvokeCommand({
    FunctionName: RULE_COMPILER_FUNCTION,
    InvocationType: 'Event', // async invocation
    Payload: Buffer.from(JSON.stringify({
      source: 'corpus-sync',
      exportKey: latestKey,
      enrichedCount: documents.length,
      totalDocuments: stats.totalDocuments,
    })),
  }));

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[CorpusSync] Complete in ${duration}s.`);

  return {
    success: true,
    exportKey: jsonlKey,
    stats: {
      totalDocuments: stats.totalDocuments,
      enrichedDocuments: documents.length,
      exportSizeBytes: jsonlContent.length,
      durationSeconds: parseFloat(duration),
    },
    delta: {
      previousEnriched: previousState?.enrichedCount ?? 0,
      currentEnriched: documents.length,
      newDocuments: documents.length - (previousState?.enrichedCount ?? 0),
    },
  };
};

// ─── S3 Helpers ─────────────────────────────────────────────────────────────

async function findLatestBackup(): Promise<string | null> {
  // List all backup directories, find the most recent one containing corpus.db
  const listResponse = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: BACKUP_PREFIX,
    Delimiter: '/',
  }));

  const prefixes = listResponse.CommonPrefixes?.map(cp => cp.Prefix!).sort().reverse() ?? [];

  for (const prefix of prefixes) {
    const dbKey = `${prefix}corpus.db`;
    try {
      // Check if corpus.db exists in this backup directory
      const objects = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: dbKey,
        MaxKeys: 1,
      }));
      if (objects.Contents && objects.Contents.length > 0) {
        return dbKey;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function downloadFromS3(key: string, localPath: string): Promise<void> {
  const dir = localPath.substring(0, localPath.lastIndexOf('/'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const bytes = await response.Body!.transformToByteArray();
  writeFileSync(localPath, Buffer.from(bytes));
}

async function uploadToS3(key: string, content: string, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: content,
    ContentType: contentType,
  }));
}

async function loadSyncState(): Promise<SyncState | null> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: STATE_KEY }));
    const text = await response.Body!.transformToString();
    return JSON.parse(text) as SyncState;
  } catch {
    return null;
  }
}

async function saveSyncState(state: SyncState): Promise<void> {
  await uploadToS3(STATE_KEY, JSON.stringify(state, null, 2), 'application/json');
}

// ─── SQLite Extraction ──────────────────────────────────────────────────────

function extractEnrichedDocuments(db: Database.Database): {
  documents: EnrichedDocument[];
  stats: { totalDocuments: number };
} {
  // Get total document count
  const countRow = db.prepare(`SELECT COUNT(*) as count FROM documents WHERE status NOT IN ('duplicate', 'error')`).get() as { count: number };

  // Join documents with enrichments
  const rows = db.prepare(`
    SELECT
      d.id,
      d.url,
      d.title,
      d.jurisdiction,
      d.agency,
      d.document_type as documentType,
      d.published_date as publishedDate,
      d.collected_at as collectedAt,
      d.content_length as contentLength,
      d.status,
      e.summary,
      e.compliance_requirements as complianceRequirements,
      e.legal_citations as legalCitations,
      e.entities,
      e.topics,
      e.regulation_type as regulationType,
      e.effective_date_extracted as effectiveDateExtracted,
      e.expiration_date_extracted as expirationDateExtracted,
      e.compliance_areas as complianceAreas,
      e.key_provisions as keyProvisions,
      e.enrichment_model as enrichmentModel,
      e.enriched_at as enrichedAt
    FROM documents d
    INNER JOIN document_enrichments e ON e.document_id = d.id
    WHERE d.status NOT IN ('duplicate', 'error')
    ORDER BY d.id
  `).all() as Array<Record<string, unknown>>;

  const documents: EnrichedDocument[] = rows.map(row => ({
    id: row.id as number,
    url: row.url as string,
    title: row.title as string | null,
    jurisdiction: row.jurisdiction as string,
    agency: row.agency as string | null,
    documentType: row.documentType as string | null,
    publishedDate: row.publishedDate as string | null,
    collectedAt: row.collectedAt as string,
    contentLength: row.contentLength as number | null,
    status: row.status as string,
    summary: row.summary as string | null,
    complianceRequirements: safeJsonParse(row.complianceRequirements as string | null),
    legalCitations: safeJsonParse(row.legalCitations as string | null),
    entities: safeJsonParse(row.entities as string | null),
    topics: safeJsonParse(row.topics as string | null),
    regulationType: row.regulationType as string | null,
    effectiveDateExtracted: row.effectiveDateExtracted as string | null,
    expirationDateExtracted: row.expirationDateExtracted as string | null,
    complianceAreas: safeJsonParse(row.complianceAreas as string | null),
    keyProvisions: safeJsonParse(row.keyProvisions as string | null),
    enrichmentModel: row.enrichmentModel as string | null,
    enrichedAt: row.enrichedAt as string | null,
  }));

  return { documents, stats: { totalDocuments: countRow.count } };
}

function safeJsonParse(val: string | null): unknown {
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function computeCorpusHash(documents: EnrichedDocument[]): string {
  const hash = createHash('sha256');
  hash.update(String(documents.length));
  // Sample first, middle, last documents for quick hash
  const indices = [0, Math.floor(documents.length / 2), documents.length - 1];
  for (const i of indices) {
    if (documents[i]) {
      hash.update(String(documents[i].id));
      hash.update(documents[i].enrichedAt || '');
    }
  }
  return hash.digest('hex').substring(0, 16);
}
