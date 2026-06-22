-- 20260621120000_deposit_one_field.sql
--
-- Deposit Tag — Plan v2 (docs/plans/deposit_tag.md @ 220b7c1). Collapses the deposit
-- feature to ONE pointer on the job. Supersedes the held (never-applied) files
-- 20260620130000 + 20260620140000, which over-engineered "mark the deposit invoice"
-- into invoices.is_deposit + a partial unique index + billing_schedule.deposit_pending.
-- Those files are deleted; this is the single clean migration.
--
--   call_log.deposit_required    — job is flagged deposit-required (§1b checkbox)
--   call_log.deposit_amount      — the deposit figure (user-entered)
--   call_log.deposit_invoice_id  — the job points at its ONE deposit invoice.
--                                  ON DELETE SET NULL is a FK-integrity backstop only
--                                  (the app soft-deletes, so it rarely fires). The real
--                                  contract: every reader active-filters the pointer
--                                  (the referenced invoice must have voided_at IS NULL AND
--                                  deleted_at IS NULL to count) — so a voided/deleted
--                                  deposit needs no handler, the link just stops counting.
--                                  Single-select, badge, and state all fall out of this.
--
-- The vestigial 20260620120000 columns (proposals.deposit_*, invoices.type) are already
-- on prod and now fully unused — LEFT in place (harmless); cleanup is a backlog one-liner.
--
-- All additive / default-safe. ⚠️ db:push BLOCKED (sibling sch-command ledger) → apply via
-- the Supabase SQL editor, then: supabase migration repair --status applied 20260621120000
-- (Held for the /buildvsplan deploy gate — do NOT apply from the build session.)

BEGIN;

ALTER TABLE public.call_log
  ADD COLUMN IF NOT EXISTS deposit_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.call_log
  ADD COLUMN IF NOT EXISTS deposit_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.call_log
  ADD COLUMN IF NOT EXISTS deposit_invoice_id text
    REFERENCES public.invoices(id) ON DELETE SET NULL;

COMMIT;
