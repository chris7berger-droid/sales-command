-- 20260620130000_deposit_tag.sql
--
-- Deposit Tag (docs/plans/deposit_tag.md, ERD Loop #36). Repoints the deposit
-- feature from a standalone deposit-invoice (vestigial proposals.deposit_* +
-- invoices.type='deposit', shipped 20260620120000 — LEFT in place, do not drop)
-- to a TAG on a real invoice billed through the normal flow.
--
-- Build #0: the deposit-required flag is a JOB-level fact → it lives on call_log
-- (the universal record; proposal-less archive jobs can still carry a deposit, and
-- Schedule reads it straight off the job with no proposal join).
-- Build #2: invoices.is_deposit tags the one invoice that IS the deposit —
-- orthogonal to invoices.type (a GC deposit is type='pay-app' AND is_deposit; a
-- direct deposit is type='regular' AND is_deposit).
--
-- All additive, NOT NULL DEFAULT (default-safe; no backfill of live money rows).
--
-- ⚠️ db:push is BLOCKED on this branch (sibling sch-command ledger divergence).
--    Apply via the Supabase SQL editor, then:
--      supabase migration repair --status applied 20260620130000
--    (Held for the /buildvsplan deploy gate — do NOT apply from the build session.)

BEGIN;

-- ── call_log: job-level deposit intent (Build #0) ───────────────────────────
ALTER TABLE public.call_log
  ADD COLUMN IF NOT EXISTS deposit_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.call_log
  ADD COLUMN IF NOT EXISTS deposit_amount numeric NOT NULL DEFAULT 0;

-- ── invoices: deposit tag on the real invoice (Build #2) ────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS is_deposit boolean NOT NULL DEFAULT false;

-- ── Single active deposit invoice per job (Build #2, audit r2 #3/#5) ─────────
-- At most ONE active is_deposit invoice per call_log. The WHERE scope is
-- mandatory: it excludes voided/deleted rows so a void-then-re-mark (or a
-- void-replacement that copies the tag) can't collide with the dead original.
-- UI single-select is not the backstop — this index is.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_active_deposit_per_job
  ON public.invoices (call_log_id)
  WHERE is_deposit AND deleted_at IS NULL AND voided_at IS NULL;

COMMIT;
