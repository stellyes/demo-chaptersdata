-- Add lastHeartbeat column to track job activity for stale job detection
-- ISSUE #7: Enables faster detection of crashed jobs vs legitimately long-running jobs

ALTER TABLE "daily_learning_jobs" ADD COLUMN IF NOT EXISTS "last_heartbeat" TIMESTAMP(3);
