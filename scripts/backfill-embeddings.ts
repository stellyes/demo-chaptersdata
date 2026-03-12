#!/usr/bin/env npx tsx
// ============================================
// Backfill Embeddings Script
// One-time script to generate and store Voyage AI embeddings
// for all existing active BusinessInsight records.
//
// Usage: npx tsx scripts/backfill-embeddings.ts
// Requires: VOYAGE_API_KEY environment variable
// ============================================

import { PrismaClient } from '@prisma/client';
import {
  generateEmbeddingsBatch,
  insightToEmbeddingText,
  storeInsightEmbedding,
} from '../src/lib/services/embedding-service';

const prisma = new PrismaClient();

async function backfill() {
  if (!process.env.VOYAGE_API_KEY) {
    console.error('ERROR: VOYAGE_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log('Loading active insights without embeddings...');

  // Find insights that don't have embeddings yet
  const insights = await prisma.$queryRawUnsafe<Array<{
    id: string;
    category: string;
    subcategory: string | null;
    insight: string;
  }>>(
    `SELECT id, category, subcategory, insight
     FROM business_insights
     WHERE is_active = true AND embedding IS NULL
     ORDER BY created_at DESC`
  );

  console.log(`Found ${insights.length} active insights to embed`);

  if (insights.length === 0) {
    console.log('All insights already have embeddings. Nothing to do.');
    return;
  }

  const BATCH = 128;
  let embedded = 0;
  let errors = 0;

  for (let i = 0; i < insights.length; i += BATCH) {
    const batch = insights.slice(i, i + BATCH);
    const texts = batch.map(insightToEmbeddingText);

    try {
      const embeddings = await generateEmbeddingsBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        try {
          await storeInsightEmbedding(batch[j].id, embeddings[j]);
          embedded++;
        } catch (err) {
          console.error(`Failed to store embedding for insight ${batch[j].id}:`, err);
          errors++;
        }
      }

      console.log(`Progress: ${Math.min(i + BATCH, insights.length)}/${insights.length} processed (${embedded} embedded, ${errors} errors)`);
    } catch (err) {
      console.error(`Failed to generate batch embeddings at offset ${i}:`, err);
      errors += batch.length;
    }

    // Brief pause between batches to avoid rate limiting
    if (i + BATCH < insights.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`\nBackfill complete: ${embedded} embedded, ${errors} errors out of ${insights.length} total`);
}

backfill()
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
