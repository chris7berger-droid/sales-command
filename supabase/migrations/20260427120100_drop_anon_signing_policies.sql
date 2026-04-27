-- ============================================================
-- Part 2 of 2 — Drop the over-broad anon signing/invoice policies.
-- Pairs with: 20260427120000_create_token_rpcs.sql
--
-- Addresses 2026-04-26 audit findings #1, #2, and the signature-
-- insert leg of #4. The legacy policies allowed anon to read or
-- mutate ANY row where signing_token / viewing_token IS NOT NULL,
-- with no per-row token match — so anyone with the bundled anon
-- key could omit the .eq("signing_token", ...) filter and access
-- everything.
--
-- Strategy:
--   * SELECTs  → token-checking SECURITY DEFINER RPCs (created in
--                the part-1 migration).
--   * UPDATEs  → routed through the existing proposal-signed edge
--                function (already validates the token, runs as
--                service role).
--   * INSERTs  → same: signature insert moves into proposal-signed
--                edge function.
--
-- Apply ONLY AFTER:
--   1. The part-1 migration has been applied (RPCs exist).
--   2. The proposal-signed edge function has been deployed with
--      the new signature-insert payload handling.
--   3. The frontend has been deployed and is calling the RPCs +
--      the updated edge function payload.
--
-- If you apply this before the frontend deploy, the public signing
-- and invoice pages will return "Proposal not found" / "Invoice
-- not found" until the new frontend ships.
--
-- The original sql/rls_*.sql baselines are intentionally NOT
-- edited; this migration is the diff.
--
-- Cross-repo note: these tables are also used by sch-command,
-- field-command, and AR-Command-Center. Verified zero hits across
-- all three for the affected anon read/write paths (2026-04-27).
-- Re-grep before applying if it's been a while.
--
-- Rollback: see sql/rollback_20260427120000_tighten_anon_rls_signing_flow.sql
-- ============================================================


-- ------------------------------------------------------------
-- DROP the over-broad anon policies.
-- No replacement policies — the RPCs + edge function take over.
--
-- Note: call_log_public_read (SELECT) is intentionally left in
-- place — it was not flagged in audit findings #1 or #2, and
-- keeping it doesn't widen anon access (the signing page no
-- longer reads call_log directly, but other authenticated paths
-- may still rely on the join through it).
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "proposals_public_sign"             ON public.proposals;
DROP POLICY IF EXISTS "proposals_public_sign_update"      ON public.proposals;
DROP POLICY IF EXISTS "call_log_public_sign_update"       ON public.call_log;
DROP POLICY IF EXISTS "proposal_wtc_public_read"          ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_recipients_public_update" ON public.proposal_recipients;
DROP POLICY IF EXISTS "proposal_signatures_public_insert" ON public.proposal_signatures;
DROP POLICY IF EXISTS "invoices_public_view"              ON public.invoices;
DROP POLICY IF EXISTS "invoice_lines_public_read"         ON public.invoice_lines;


-- ============================================================
-- VERIFY
-- ============================================================
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND policyname IN (
--     'proposals_public_sign',
--     'proposals_public_sign_update',
--     'call_log_public_sign_update',
--     'proposal_wtc_public_read',
--     'proposal_recipients_public_update',
--     'proposal_signatures_public_insert',
--     'invoices_public_view',
--     'invoice_lines_public_read'
--   );
-- -- Expect 0 rows.
