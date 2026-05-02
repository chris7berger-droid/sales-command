-- ============================================================
-- Drop all remaining 2026-04-26 anti-pattern anon policies and
-- add viewing-token SELECT policies so the invoice public page
-- continues to work through nested joins.
--
-- Anti-pattern: policies that check `*_token IS NOT NULL` without
-- matching the caller's actual token via request_*_token().
--
-- After this migration, anon access is exclusively through:
--   - Token-matched SELECT policies (request_signing_token / request_viewing_token)
--   - SECURITY DEFINER RPCs (mark_recipient_viewed, mark_proposal_signed,
--     get_public_tenant_config, get_rep_contact)
--   - Token-matched INSERT on proposal_signatures
--
-- See CLAUDE_RLS.md for the correct patterns.
-- ============================================================


-- ============================================================
-- STEP 1: Create viewing-token SELECT policies for the invoice
-- page's join path: invoices → proposals → call_log → customers
--
-- The signing page join path (proposals → call_log → customers)
-- already has signing-token policies. The invoice page uses a
-- viewing token, so these tables need a second anon SELECT
-- policy for the viewing-token path.
--
-- NOTE on invoices.job_id: this column is text, call_log.id is
-- integer, with no FK constraint. All joins use ::int cast.
-- The direct invoices.job_id path (not through proposals) is
-- used so invoices without a proposal_id are also covered.
-- ============================================================

-- proposals: invoice page reads proposals(total, is_archive_proposal)
-- through the invoices → proposals join.
CREATE POLICY proposals_public_view_token ON public.proposals
FOR SELECT TO anon
USING (EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.proposal_id = proposals.id
    AND i.viewing_token IS NOT NULL
    AND i.viewing_token::text = request_viewing_token()
));

-- call_log: invoice page reads call_log(customer_name, sales_name, ...)
-- through invoices.job_id → call_log.id (direct, not through proposals).
CREATE POLICY call_log_public_view_token ON public.call_log
FOR SELECT TO anon
USING (EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.job_id::int = call_log.id
    AND i.viewing_token IS NOT NULL
    AND i.viewing_token::text = request_viewing_token()
));

-- customers: needed by BOTH public pages.
-- Signing page path: proposals → call_log → customers (via signing token)
-- Invoice page path: invoices → call_log → customers (via viewing token)
CREATE POLICY customers_public_read_token ON public.customers
FOR SELECT TO anon
USING (
  EXISTS (
    SELECT 1 FROM call_log cl
    JOIN proposals p ON p.call_log_id = cl.id
    WHERE cl.customer_id = customers.id
      AND p.signing_token IS NOT NULL
      AND p.signing_token::text = request_signing_token()
  )
  OR EXISTS (
    SELECT 1 FROM call_log cl
    JOIN invoices i ON i.job_id::int = cl.id
    WHERE cl.customer_id = customers.id
      AND i.viewing_token IS NOT NULL
      AND i.viewing_token::text = request_viewing_token()
  )
);


-- ============================================================
-- STEP 2: Drop all anti-pattern policies.
-- Each has a correct token-matched replacement already in place
-- (either pre-existing or created in step 1 above).
-- ============================================================

-- proposals: 2 anti-pattern policies (SELECT + UPDATE)
-- SELECT replaced by: proposals_public_sign_token + proposals_public_view_token
-- UPDATE replaced by: mark_proposal_signed RPC (migration 20260502120000)
DROP POLICY IF EXISTS "anon: signing page read"   ON public.proposals;
DROP POLICY IF EXISTS "anon: signing page update"  ON public.proposals;

-- call_log: 2 anti-pattern policies (SELECT + UPDATE)
-- SELECT replaced by: call_log_public_read_token + call_log_public_view_token
-- UPDATE replaced by: mark_proposal_signed RPC (migration 20260502120000)
DROP POLICY IF EXISTS "anon: signing page read"   ON public.call_log;
DROP POLICY IF EXISTS "anon: signing page update"  ON public.call_log;

-- customers: 1 anti-pattern policy (SELECT)
-- Replaced by: customers_public_read_token
DROP POLICY IF EXISTS "anon: signing page read"   ON public.customers;

-- proposal_wtc: 1 anti-pattern policy (SELECT)
-- Replaced by: proposal_wtc_public_read_token (pre-existing)
DROP POLICY IF EXISTS "anon: signing page read"   ON public.proposal_wtc;

-- invoices: 1 anti-pattern policy (SELECT)
-- Replaced by: invoices_public_view_token (pre-existing)
DROP POLICY IF EXISTS "anon_view_invoice_by_token" ON public.invoices;


-- ============================================================
-- STEP 3: Drop column-unrestricted token-matched UPDATE policies.
-- Even though these validate the token, they allow a token holder
-- to write ANY column. Mutations now flow through RPCs only.
-- ============================================================

DROP POLICY IF EXISTS "proposals_public_sign_update_token" ON public.proposals;
DROP POLICY IF EXISTS "call_log_public_sign_update_token"  ON public.call_log;
DROP POLICY IF EXISTS "proposal_recipients_public_update_token" ON public.proposal_recipients;


-- ============================================================
-- VERIFICATION (run manually after migration)
-- ============================================================
-- 1. No anti-pattern policies should remain:
--    SELECT policyname FROM pg_policies
--     WHERE schemaname='public'
--       AND (policyname LIKE 'anon:%' OR policyname = 'anon_view_invoice_by_token');
--    -- expect zero rows
--
-- 2. No anon UPDATE policies at all:
--    SELECT tablename, policyname FROM pg_policies
--     WHERE schemaname='public' AND cmd='UPDATE' AND roles::text LIKE '%anon%';
--    -- expect zero rows
--
-- 3. Complete anon policy inventory:
--    SELECT tablename, policyname, cmd FROM pg_policies
--     WHERE schemaname='public' AND roles::text LIKE '%anon%'
--     ORDER BY tablename, cmd, policyname;
--    -- expect exactly:
--    --   call_log          | call_log_public_read_token              | SELECT
--    --   call_log          | call_log_public_view_token              | SELECT
--    --   customers         | customers_public_read_token             | SELECT
--    --   invoice_lines     | invoice_lines_public_read_token         | SELECT
--    --   invoices          | invoices_public_view_token              | SELECT
--    --   proposal_signatures | proposal_signatures_public_insert_token | INSERT
--    --   proposal_wtc      | proposal_wtc_public_read_token          | SELECT
--    --   proposals         | proposals_public_sign_token             | SELECT
--    --   proposals         | proposals_public_view_token             | SELECT
