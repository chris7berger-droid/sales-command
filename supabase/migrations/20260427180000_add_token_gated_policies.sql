-- ============================================================
-- RLS Hardening: Token-Gated Public Access Policies
--
-- Purpose: Replace broad "signing_token IS NOT NULL" anon policies
-- with policies that require the caller to present the actual token
-- via a custom HTTP header (x-signing-token, x-viewing-token).
--
-- Strategy: Add new policies alongside existing ones.
-- A separate migration will drop the old broad policies AFTER
-- frontend deploy is verified. RLS policies combine with OR,
-- so during the overlap window both sets allow access.
--
-- Affected tables:
--   proposals (SELECT, UPDATE)
--   proposal_wtc (SELECT)
--   proposal_recipients (UPDATE)
--   proposal_signatures (INSERT)
--   call_log (SELECT, UPDATE — via proposal join)
--   invoices (SELECT)
--   invoice_lines (SELECT)
--
-- Header source: current_setting('request.headers', true)::json
--   ->> 'x-signing-token'  for proposals + children + call_log
--   ->> 'x-viewing-token'  for invoices + invoice_lines
-- ============================================================


-- ============================================================
-- Helper function: extract signing token from request header
-- ============================================================

CREATE OR REPLACE FUNCTION public.request_signing_token()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.headers', true)::json ->> 'x-signing-token',
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.request_viewing_token()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.headers', true)::json ->> 'x-viewing-token',
    ''
  );
$$;


-- ============================================================
-- proposals: SELECT + UPDATE gated by x-signing-token
-- ============================================================

DROP POLICY IF EXISTS "proposals_public_sign_token"        ON public.proposals;
DROP POLICY IF EXISTS "proposals_public_sign_update_token" ON public.proposals;

CREATE POLICY "proposals_public_sign_token" ON public.proposals
  FOR SELECT TO anon
  USING (
    signing_token IS NOT NULL
    AND signing_token::text = public.request_signing_token()
  );

CREATE POLICY "proposals_public_sign_update_token" ON public.proposals
  FOR UPDATE TO anon
  USING (
    signing_token IS NOT NULL
    AND signing_token::text = public.request_signing_token()
  )
  WITH CHECK (
    signing_token IS NOT NULL
    AND signing_token::text = public.request_signing_token()
  );


-- ============================================================
-- proposal_wtc: SELECT gated via parent proposal token match
-- ============================================================

DROP POLICY IF EXISTS "proposal_wtc_public_read_token" ON public.proposal_wtc;

CREATE POLICY "proposal_wtc_public_read_token" ON public.proposal_wtc
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
        AND p.signing_token::text = public.request_signing_token()
    )
  );


-- ============================================================
-- proposal_recipients: UPDATE gated via parent proposal token match
-- ============================================================

DROP POLICY IF EXISTS "proposal_recipients_public_update_token" ON public.proposal_recipients;

CREATE POLICY "proposal_recipients_public_update_token" ON public.proposal_recipients
  FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
        AND p.signing_token::text = public.request_signing_token()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
        AND p.signing_token::text = public.request_signing_token()
    )
  );


-- ============================================================
-- proposal_signatures: INSERT gated via parent proposal token match
-- ============================================================

DROP POLICY IF EXISTS "proposal_signatures_public_insert_token" ON public.proposal_signatures;

CREATE POLICY "proposal_signatures_public_insert_token" ON public.proposal_signatures
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
        AND p.signing_token::text = public.request_signing_token()
    )
  );


-- ============================================================
-- call_log: SELECT + UPDATE gated via linked proposal token match
-- ============================================================

DROP POLICY IF EXISTS "call_log_public_read_token"        ON public.call_log;
DROP POLICY IF EXISTS "call_log_public_sign_update_token" ON public.call_log;

CREATE POLICY "call_log_public_read_token" ON public.call_log
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.call_log_id = call_log.id
        AND p.signing_token IS NOT NULL
        AND p.signing_token::text = public.request_signing_token()
    )
  );

CREATE POLICY "call_log_public_sign_update_token" ON public.call_log
  FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.call_log_id = call_log.id
        AND p.signing_token IS NOT NULL
        AND p.signing_token::text = public.request_signing_token()
    )
  )
  WITH CHECK (true);


-- ============================================================
-- invoices: SELECT gated by x-viewing-token
-- ============================================================

DROP POLICY IF EXISTS "invoices_public_view_token" ON public.invoices;

CREATE POLICY "invoices_public_view_token" ON public.invoices
  FOR SELECT TO anon
  USING (
    viewing_token IS NOT NULL
    AND viewing_token::text = public.request_viewing_token()
  );


-- ============================================================
-- invoice_lines: SELECT gated via parent invoice token match
-- ============================================================

DROP POLICY IF EXISTS "invoice_lines_public_read_token" ON public.invoice_lines;

CREATE POLICY "invoice_lines_public_read_token" ON public.invoice_lines
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id::text = invoice_id::text
        AND i.viewing_token IS NOT NULL
        AND i.viewing_token::text = public.request_viewing_token()
    )
  );


-- ============================================================
-- VERIFICATION QUERIES (run manually after migration)
-- ============================================================

-- 1. Confirm both old and new policies exist (overlap window)
-- Expected: each table shows both _public_* (old) and _public_*_token (new)
--
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public'
--   AND policyname LIKE '%public%'
-- ORDER BY tablename, policyname;

-- 2. Confirm helper functions are callable by anon
-- Expected: both return NULL when no header is set
--
-- SET ROLE anon;
-- SELECT public.request_signing_token(), public.request_viewing_token();
-- RESET ROLE;

-- 3. Confirm new policy works with header set (manual test)
-- Run from a fresh psql connection with header simulation:
--
-- SET request.headers = '{"x-signing-token": "<some-real-token>"}';
-- SET ROLE anon;
-- SELECT id, signing_token FROM public.proposals WHERE signing_token::text = '<some-real-token>';
-- RESET ROLE;
