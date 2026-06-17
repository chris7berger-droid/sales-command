-- §6.2 (SOW vertical) — proposal_wtc.dates_tbd (Sales-owned, supports §S2)
--
-- Per-WTC "Dates TBD" toggle: makes "we don't know the schedule yet" a
-- first-class state instead of leaving the tentative start/end date inputs in
-- their required-with-red-error state. When true, Send-to-Schedule seeds the
-- job_wtcs start_date/end_date and per-day field_sow[*].date as NULL and
-- Schedule Command assigns the calendar later.
--
-- Pure additive, not RLS-touching. DEFAULT false preserves all legacy rows
-- (their dates stay required-with-tentative; null dates on legacy rows are not
-- "TBD"). IF NOT EXISTS makes re-run a no-op.
--
-- Deploy: sales-command uses `npm run db:push` (runs the cross-repo collision
-- check). Run scripts/check-migration-safety.sh first. Apply is GATED — it
-- waits for /buildvsplan, same as the §6.6 sch-command migration. The S2 code
-- that reads/writes dates_tbd only functions once this column exists.

ALTER TABLE public.proposal_wtc
  ADD COLUMN IF NOT EXISTS dates_tbd boolean NOT NULL DEFAULT false;
