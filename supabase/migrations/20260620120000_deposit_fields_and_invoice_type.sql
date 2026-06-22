-- 20260620120000_deposit_fields_and_invoice_type.sql
--
-- Phase 1 §1a (billing deposit foundation). Cross-repo: sch-command's billing
-- worklist reads these columns. Owner repo = sales-command (owns proposals + invoices).
--
-- ⚠️ EXECUTION HELD FOR ROUND-2 RE-AUDIT (2026-06-20).
--    This migration backfills `invoices.type` by MUTATING live invoice rows
--    (money-touching). Per the billing-redesign round-1 audit (5H, pattern:
--    assumes-wiring-that-isnt-there), the backfill rule goes back to T2 for a
--    focused round-2 re-audit BEFORE it runs against prod. Do NOT `db:push`
--    until round-2 clears. The proposals columns are additive/low-risk and ride
--    along; the sensitive piece is the invoices.type UPDATE below.
--
-- Deploy path (sales-command rules): `node scripts/check-migration-collision.mjs`
--   + `scripts/check-migration-safety.sh`, then `npm run db:push`. (NOT sch-command —
--   db push is blocked there; see sch-command CLAUDE.md.)
--
-- Backfill rule [RATIFIED 2026-06-20] mirrors the existing per-invoice classifier
--   (src/pages/Invoices.jsx:1224): an invoice's kind is decided across ALL its
--   lines, not line-by-line. pay-app = ANY line carries billing_schedule_line_id;
--   everything else = 'regular'. No 'deposit' exists in history — the new
--   create path (§1c) is the only writer of 'deposit'.

BEGIN;

-- ── proposals: deposit source-of-truth fields (additive, default-safe) ──────────
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS deposit_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS deposit_amount numeric NOT NULL DEFAULT 0;

-- ── invoices.type: pinned DDL order (ADD DEFAULT → backfill pay-app → CHECK → NOT NULL) ──

-- 1. ADD COLUMN with DEFAULT 'regular' → every existing row becomes 'regular'.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS type text DEFAULT 'regular';

-- 2. Reclassify pay-apps. Idempotent: WHERE type = 'regular' skips already-set
--    'deposit'/'pay-app' on re-run. EXISTS mirrors the all-lines classifier —
--    any line with billing_schedule_line_id makes the whole invoice a pay-app.
UPDATE public.invoices i
   SET type = 'pay-app'
 WHERE i.type = 'regular'
   AND EXISTS (
         SELECT 1
           FROM public.invoice_lines l
          WHERE l.invoice_id = i.id
            AND l.billing_schedule_line_id IS NOT NULL
       );

-- 3. CHECK constraint added AFTER backfill so no existing row violates it.
--    Drop-then-add makes the migration re-runnable.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_type_check
  CHECK (type IN ('regular', 'deposit', 'pay-app'));

-- 4. Enforce the contract (default already guarantees non-null; explicit).
ALTER TABLE public.invoices
  ALTER COLUMN type SET NOT NULL;

COMMIT;

-- ── POST-BACKFILL VERIFY (run after apply; record results in the §1a closeout) ──
-- Expect: every row classified; pay-app count must match the line-FK count.
--   SELECT type, count(*) FROM public.invoices GROUP BY type ORDER BY type;
--   -- pay-app count above must equal:
--   SELECT count(DISTINCT invoice_id) FROM public.invoice_lines
--     WHERE billing_schedule_line_id IS NOT NULL;
