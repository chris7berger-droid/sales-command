-- 20260620140000_billing_schedule_deposit_pending.sql
--
-- Deposit Tag follow-up (T5 #3). Threads the deposit intent through a pay-app
-- VOID → re-lock so the replacement invoice carries is_deposit, symmetric with the
-- non-pay-app void path (which copies is_deposit straight onto its replacement).
--
-- A pay-app void sets its pay app back to draft and clears invoice_id — the
-- replacement invoice is minted later by NewPayAppModal (a NEW pay app on the same
-- billing_schedule), so the intent can't ride on the invoice row. It rides here:
-- the void sets billing_schedule.deposit_pending = true when the voided pay-app
-- invoice was a deposit; NewPayAppModal consumes it (one-shot) on the next pay-app
-- invoice it creates for that schedule.
--
-- Additive, NOT NULL DEFAULT. db:push BLOCKED (sibling ledger) → apply via Supabase
-- editor + `repair --status applied 20260620140000` at the deploy gate.

BEGIN;

ALTER TABLE public.billing_schedule
  ADD COLUMN IF NOT EXISTS deposit_pending boolean NOT NULL DEFAULT false;

COMMIT;
