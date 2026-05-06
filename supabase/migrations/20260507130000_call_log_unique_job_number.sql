-- Per-tenant uniqueness on call_log.job_number for active rows.
-- COALESCE(co_number, 0) lets a parent (NULL co_number) coexist with its
-- COs (numbered 1..N) under the same job_number, while still rejecting
-- two distinct parents that share a job_number on the same tenant.
--
-- Partial: archived rows excluded so historical merges/dupes don't block.
-- Pre-flight cleanup (manual via Merge Job feature, B9) must be done first;
-- creation will fail with 23505 if any active dupes still exist.

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_log_unique_job_number
  ON public.call_log (tenant_id, job_number, (COALESCE(co_number, 0)))
  WHERE archived = false AND job_number IS NOT NULL;
