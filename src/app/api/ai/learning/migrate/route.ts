// ============================================
// DATABASE MIGRATION API ROUTE
// Apply pending schema changes via direct SQL
// Protected by the same auth as other learning endpoints
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isLearningApiAuthorized, unauthorizedResponse } from '../auth';

// Migration definitions - add new migrations here
const MIGRATIONS = [
  {
    id: '20260215_add_last_heartbeat',
    description: 'Add lastHeartbeat column for stale job detection',
    sql: `ALTER TABLE "daily_learning_jobs" ADD COLUMN IF NOT EXISTS "last_heartbeat" TIMESTAMP(3);`,
  },
  {
    id: '20260215_add_learning_phase_metrics',
    description: 'Add LearningPhaseMetric table for observability',
    sql: `
      CREATE TABLE IF NOT EXISTS "learning_phase_metrics" (
        "id" TEXT NOT NULL,
        "job_id" TEXT NOT NULL,
        "phase" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "start_time" TIMESTAMP(3) NOT NULL,
        "end_time" TIMESTAMP(3),
        "duration_ms" INTEGER,
        "input_tokens" INTEGER NOT NULL DEFAULT 0,
        "output_tokens" INTEGER NOT NULL DEFAULT 0,
        "error_message" TEXT,
        "data_sources" JSONB,
        "items_processed" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "learning_phase_metrics_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "learning_phase_metrics_job_id_idx" ON "learning_phase_metrics"("job_id");
      CREATE INDEX IF NOT EXISTS "learning_phase_metrics_phase_idx" ON "learning_phase_metrics"("phase");
      CREATE INDEX IF NOT EXISTS "learning_phase_metrics_status_idx" ON "learning_phase_metrics"("status");
      CREATE INDEX IF NOT EXISTS "learning_phase_metrics_start_time_idx" ON "learning_phase_metrics"("start_time");
    `,
  },
  {
    id: '20260215_add_learning_phase_metrics_fk',
    description: 'Add foreign key constraint for LearningPhaseMetric',
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'learning_phase_metrics_job_id_fkey'
        ) THEN
          ALTER TABLE "learning_phase_metrics"
          ADD CONSTRAINT "learning_phase_metrics_job_id_fkey"
          FOREIGN KEY ("job_id") REFERENCES "daily_learning_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `,
  },
];

export async function POST(request: NextRequest) {
  // Verify authorization - same as other learning endpoints
  if (!isLearningApiAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { action = 'status', migrationId } = body;

    if (action === 'status') {
      // Check which tables/columns exist
      const checks = await Promise.all([
        prisma.$queryRaw`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'daily_learning_jobs' AND column_name = 'last_heartbeat'
        `,
        prisma.$queryRaw`
          SELECT table_name FROM information_schema.tables
          WHERE table_name = 'learning_phase_metrics'
        `,
      ]);

      const hasLastHeartbeat = (checks[0] as unknown[]).length > 0;
      const hasPhaseMetrics = (checks[1] as unknown[]).length > 0;

      return NextResponse.json({
        success: true,
        data: {
          action: 'status',
          schema: {
            lastHeartbeat: hasLastHeartbeat,
            learningPhaseMetrics: hasPhaseMetrics,
          },
          pendingMigrations: MIGRATIONS.filter(m => {
            if (m.id.includes('last_heartbeat') && hasLastHeartbeat) return false;
            if (m.id.includes('learning_phase_metrics') && hasPhaseMetrics) return false;
            return true;
          }).map(m => ({ id: m.id, description: m.description })),
        },
      });
    }

    if (action === 'apply') {
      // Apply a specific migration or all pending
      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      const migrationsToApply = migrationId
        ? MIGRATIONS.filter(m => m.id === migrationId)
        : MIGRATIONS;

      for (const migration of migrationsToApply) {
        try {
          console.log(`Applying migration: ${migration.id}`);
          await prisma.$executeRawUnsafe(migration.sql);
          results.push({ id: migration.id, success: true });
          console.log(`Migration ${migration.id} applied successfully`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Migration ${migration.id} failed:`, errorMsg);
          results.push({ id: migration.id, success: false, error: errorMsg });
          // Continue with other migrations even if one fails
        }
      }

      return NextResponse.json({
        success: results.every(r => r.success),
        data: {
          action: 'apply',
          results,
        },
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action. Use: status or apply',
    }, { status: 400 });

  } catch (error) {
    console.error('Migration error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Migration failed';

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
