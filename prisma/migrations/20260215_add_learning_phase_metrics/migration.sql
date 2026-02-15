-- ISSUE #9: Add LearningPhaseMetric table for observability
-- Stores phase-level metrics for each learning job run
-- Enables dashboard visualization of learning system health

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

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS "learning_phase_metrics_job_id_idx" ON "learning_phase_metrics"("job_id");
CREATE INDEX IF NOT EXISTS "learning_phase_metrics_phase_idx" ON "learning_phase_metrics"("phase");
CREATE INDEX IF NOT EXISTS "learning_phase_metrics_status_idx" ON "learning_phase_metrics"("status");
CREATE INDEX IF NOT EXISTS "learning_phase_metrics_start_time_idx" ON "learning_phase_metrics"("start_time");

-- Foreign key constraint
ALTER TABLE "learning_phase_metrics" ADD CONSTRAINT "learning_phase_metrics_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "daily_learning_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
