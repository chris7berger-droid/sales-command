-- ============================================================
-- ROLLBACK for 20260427120000_tighten_anon_rls_signing_flow.sql
--
-- Run this in the Supabase SQL editor as service role IF the
-- forward migration breaks the public signing or invoice flow
-- in prod. This restores the EXACT original anon policies from
-- sql/rls_core_tables.sql and sql/rls_child_tables.sql, verbatim.
--
-- WARNING: this restores the audit-flagged vulnerability — anon
-- can read/update any row where signing_token / viewing_token
-- IS NOT NULL. Only run in an active incident, then re-deploy
-- the forward migration once the underlying issue is fixed.
--
-- Stripe paths are not touched by this script.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Drop the new RPCs.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_proposal_by_token(uuid);
DROP FUNCTION IF EXISTS public.mark_proposal_viewed(uuid);
DROP FUNCTION IF EXISTS public.get_invoice_by_viewing_token(uuid);


-- ------------------------------------------------------------
-- 2. Restore the 8 anon policies.
--    Defensive DROP IF EXISTS first in case some are still
--    around (e.g. partial rollback, or rerun).
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "proposals_public_sign"             ON public.proposals;
DROP POLICY IF EXISTS "proposals_public_sign_update"      ON public.proposals;
DROP POLICY IF EXISTS "call_log_public_sign_update"       ON public.call_log;
DROP POLICY IF EXISTS "proposal_wtc_public_read"          ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_recipients_public_update" ON public.proposal_recipients;
DROP POLICY IF EXISTS "proposal_signatures_public_insert" ON public.proposal_signatures;
DROP POLICY IF EXISTS "invoices_public_view"              ON public.invoices;
DROP POLICY IF EXISTS "invoice_lines_public_read"         ON public.invoice_lines;


-- proposals_public_sign — from sql/rls_core_tables.sql:138-140
CREATE POLICY "proposals_public_sign" ON public.proposals
  FOR SELECT TO anon
  USING (signing_token IS NOT NULL);


-- proposals_public_sign_update — from sql/rls_core_tables.sql:144-147
CREATE POLICY "proposals_public_sign_update" ON public.proposals
  FOR UPDATE TO anon
  USING (signing_token IS NOT NULL)
  WITH CHECK (signing_token IS NOT NULL);


-- call_log_public_sign_update — from sql/rls_core_tables.sql:98-107
CREATE POLICY "call_log_public_sign_update" ON public.call_log
  FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.call_log_id = call_log.id
        AND p.signing_token IS NOT NULL
    )
  )
  WITH CHECK (true);


-- proposal_wtc_public_read — from sql/rls_child_tables.sql:172-180
CREATE POLICY "proposal_wtc_public_read" ON public.proposal_wtc
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
    )
  );


-- proposal_recipients_public_update — from sql/rls_child_tables.sql:227-236
CREATE POLICY "proposal_recipients_public_update" ON public.proposal_recipients
  FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
    )
  )
  WITH CHECK (true);


-- proposal_signatures_public_insert — from sql/rls_child_tables.sql:264-272
CREATE POLICY "proposal_signatures_public_insert" ON public.proposal_signatures
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
    )
  );


-- invoices_public_view — from sql/rls_core_tables.sql:190-192
CREATE POLICY "invoices_public_view" ON public.invoices
  FOR SELECT TO anon
  USING (viewing_token IS NOT NULL);


-- invoice_lines_public_read — from sql/rls_child_tables.sql:293-301
CREATE POLICY "invoice_lines_public_read" ON public.invoice_lines
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id::text = invoice_id::text
        AND i.viewing_token IS NOT NULL
    )
  );


-- ============================================================
-- VERIFY rollback
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
--   )
-- ORDER BY tablename, policyname;
-- -- Expect 8 rows.
--
-- SELECT proname FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('get_proposal_by_token', 'mark_proposal_viewed',
--                     'get_invoice_by_viewing_token');
-- -- Expect 0 rows.
