-- ============================================================
-- Audit fix H6 — supporting schema change
--
-- Adds proposal_wtc.locked_line_total to store the per-WTC total
-- computed at lock time. Enables the SECURITY DEFINER RPC
-- get_public_proposal_view() (next migration) to return display-ready
-- numbers WITHOUT exposing cost basis (burden_rate, ot_burden_rate,
-- pw_rate, pw_ot_rate), markup_pct, or materials cost rows to the
-- anon-facing PublicSigningPage.
--
-- Why a stored column instead of a SQL recompute:
--   src/lib/calc.js (calcWtcPrice + calcLabor + calcMaterialRow +
--   calcTravel) is the single source of truth for proposal pricing
--   in the JS app. Mirroring that logic in SQL would create a parity
--   surface that can drift silently — customer sees price X on the
--   public signing page while the internal app shows price Y on the
--   locked proposal. Per CLAUDE.md handleLock() already writes the
--   authoritative grand total to proposals.total. This migration
--   lets the same code path also write per-WTC line totals, and the
--   RPC reads them back unchanged.
--
-- Nullable on purpose:
--   - Existing rows get NULL (no default value computation in SQL).
--   - Backfill is a separate one-shot Node script
--     (scripts/backfill_locked_line_total.mjs) that imports the
--     canonical calc.js to compute totals for already-locked WTCs.
--   - For unlocked WTCs the column stays NULL — the RPC won't be
--     called for unlocked proposals (signing tokens are issued at
--     send time, which is post-lock).
-- ============================================================

ALTER TABLE public.proposal_wtc
  ADD COLUMN IF NOT EXISTS locked_line_total numeric;

COMMENT ON COLUMN public.proposal_wtc.locked_line_total IS
  'Per-WTC total at lock time, written by handleLock() in '
  'src/components/ProposalDetail.jsx using calcWtcPrice() from '
  'src/lib/calc.js. Read by public.get_public_proposal_view() so '
  'PublicSigningPage can display per-line totals without receiving '
  'cost basis / markup / materials. NULL for unlocked WTCs and for '
  'WTCs locked before this column existed (backfill via '
  'scripts/backfill_locked_line_total.mjs).';

-- ============================================================
-- VERIFICATION (run manually after migration)
-- ============================================================
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name = 'proposal_wtc'
--    AND column_name = 'locked_line_total';
-- -- expect one row: numeric, YES
-- ============================================================
