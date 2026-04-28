-- ============================================================
-- RLS Hardening: Drop Old Broad Anon Policies
--
-- Purpose: Now that token-gated policies are deployed and verified
-- end-to-end, drop the original broad "signing_token IS NOT NULL"
-- policies. After this migration runs, anon access requires the
-- caller to present the matching token via x-signing-token /
-- x-viewing-token request headers.
--
-- Prerequisites (must be true before applying):
--   - Migration 20260427180000_add_token_gated_policies.sql is applied
--   - All client code uses createPublicClient() with the token header
--   - End-to-end signing tested on production with new code
--
-- Rollback: see sql/rollback_drop_old_anon_signing_policies.sql
-- ============================================================


-- proposals: drop both the tracked-SQL legacy policies AND the
-- two older un-tracked ones discovered during audit.
DROP POLICY IF EXISTS "proposals_public_sign"                       ON public.proposals;
DROP POLICY IF EXISTS "proposals_public_sign_update"                ON public.proposals;
DROP POLICY IF EXISTS "Allow public read by signing_token"          ON public.proposals;
DROP POLICY IF EXISTS "Allow public update status by signing_token" ON public.proposals;

-- proposal_wtc
DROP POLICY IF EXISTS "proposal_wtc_public_read" ON public.proposal_wtc;

-- proposal_recipients
DROP POLICY IF EXISTS "proposal_recipients_public_update" ON public.proposal_recipients;

-- proposal_signatures
DROP POLICY IF EXISTS "proposal_signatures_public_insert" ON public.proposal_signatures;

-- call_log
DROP POLICY IF EXISTS "call_log_public_read"        ON public.call_log;
DROP POLICY IF EXISTS "call_log_public_sign_update" ON public.call_log;

-- invoices
DROP POLICY IF EXISTS "invoices_public_view" ON public.invoices;

-- invoice_lines
DROP POLICY IF EXISTS "invoice_lines_public_read" ON public.invoice_lines;


-- ============================================================
-- VERIFICATION: confirm only token-gated policies remain
-- ============================================================
-- Expected: only *_token policies show up (no bare *_public_*).
--
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public'
--   AND (policyname LIKE '%public_sign%'
--        OR policyname LIKE '%public_view%'
--        OR policyname LIKE '%public_read%'
--        OR policyname LIKE '%public_insert%'
--        OR policyname LIKE '%public_update%')
-- ORDER BY tablename, policyname;
