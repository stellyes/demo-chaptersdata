-- CreateTable
CREATE TABLE "custom_query_jobs" (
    "id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "result" TEXT,
    "error_message" TEXT,
    "context_options" JSONB NOT NULL DEFAULT '{}',
    "selected_research_ids" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "custom_query_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_query_jobs_status_idx" ON "custom_query_jobs"("status");

-- CreateIndex
CREATE INDEX "custom_query_jobs_started_at_idx" ON "custom_query_jobs"("started_at");
