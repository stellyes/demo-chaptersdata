// ============================================
// EMBEDDING SERVICE
// Manages Voyage AI embeddings for semantic search over BusinessInsights.
// Gracefully degrades when VOYAGE_API_KEY is not set.
// ============================================

import { prisma } from '@/lib/prisma';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3'; // 1024 dimensions
const BATCH_SIZE = 128; // Voyage AI max batch size

interface VoyageEmbeddingData {
  embedding: number[];
  index: number;
}

interface VoyageResponse {
  data: VoyageEmbeddingData[];
  usage: { total_tokens: number };
}

/**
 * Check if embedding features are available (VOYAGE_API_KEY is set).
 */
export function isEmbeddingEnabled(): boolean {
  return !!process.env.VOYAGE_API_KEY;
}

/**
 * Generate an embedding for a single document text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [text],
      input_type: 'document',
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Voyage AI error: ${response.status} ${response.statusText} — ${errText}`);
  }

  const data: VoyageResponse = await response.json();
  return data.data[0].embedding;
}

/**
 * Generate an embedding for a search query.
 * Uses 'query' input_type for better retrieval performance.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [query],
      input_type: 'query',
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Voyage AI query embedding error: ${response.status} — ${errText}`);
  }

  const data: VoyageResponse = await response.json();
  return data.data[0].embedding;
}

/**
 * Generate embeddings for a batch of texts (handles chunking at BATCH_SIZE).
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: batch,
        input_type: 'document',
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Voyage AI batch error: ${response.status} — ${errText}`);
    }

    const data: VoyageResponse = await response.json();
    allEmbeddings.push(...data.data.map(d => d.embedding));
  }

  return allEmbeddings;
}

/**
 * Compose the text that gets embedded for an insight.
 * Combines category, subcategory, and insight text for richer semantic representation.
 */
export function insightToEmbeddingText(insight: {
  category: string;
  subcategory?: string | null;
  insight: string;
}): string {
  const parts = [insight.category];
  if (insight.subcategory) parts.push(insight.subcategory);
  parts.push(insight.insight);
  return parts.join(' | ');
}

/**
 * Store an embedding for a single insight using raw SQL.
 */
export async function storeInsightEmbedding(
  insightId: string,
  embedding: number[]
): Promise<void> {
  const vectorStr = `[${embedding.join(',')}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE business_insights SET embedding = $1::vector WHERE id = $2`,
    vectorStr,
    insightId
  );
}

/**
 * Semantic search: find similar insights using cosine similarity.
 */
export async function searchSimilarInsights(
  queryEmbedding: number[],
  options: {
    limit?: number;
    categories?: string[];
    minSimilarity?: number;
    activeOnly?: boolean;
  } = {}
): Promise<Array<{
  id: string;
  category: string;
  subcategory: string | null;
  insight: string;
  confidence: string;
  source: string;
  similarity: number;
  retentionScore: number | null;
  createdAt: Date;
}>> {
  const {
    limit = 20,
    categories,
    minSimilarity = 0.3,
    activeOnly = true,
  } = options;

  const vectorStr = `[${queryEmbedding.join(',')}]`;

  // Build WHERE conditions
  const conditions: string[] = ['embedding IS NOT NULL'];
  if (activeOnly) {
    conditions.push('is_active = true');
    conditions.push('(expires_at IS NULL OR expires_at > NOW())');
  }
  if (categories && categories.length > 0) {
    const categoryList = categories.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
    conditions.push(`category IN (${categoryList})`);
  }

  const whereClause = conditions.join(' AND ');

  const results = await prisma.$queryRawUnsafe<Array<{
    id: string;
    category: string;
    subcategory: string | null;
    insight: string;
    confidence: string;
    source: string;
    similarity: number;
    retention_score: number | null;
    created_at: Date;
  }>>(
    `SELECT
      id, category, subcategory, insight, confidence, source,
      1 - (embedding <=> $1::vector) as similarity,
      retention_score,
      created_at
    FROM business_insights
    WHERE ${whereClause}
      AND 1 - (embedding <=> $1::vector) >= $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3`,
    vectorStr,
    minSimilarity,
    limit
  );

  return results.map(r => ({
    id: r.id,
    category: r.category,
    subcategory: r.subcategory,
    insight: r.insight,
    confidence: r.confidence,
    source: r.source,
    similarity: r.similarity,
    retentionScore: r.retention_score,
    createdAt: r.created_at,
  }));
}
