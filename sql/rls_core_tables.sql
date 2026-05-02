-- ============================================================
-- RLS Phase 1: Core tenant-scoped tables
-- Tables: customers, call_log, proposals, invoices
--
-- HARDENED 2026-05-02 (audit C2, 2026-04-30):
-- The original seed shipped five anon SELECT/UPDATE policies on these
-- tables in the documented 2026-04-26 anti-pattern shape — that is,
-- predicates that just check `signing_token IS NOT NULL` /
-- `viewing_token IS NOT NULL` without verifying the caller actually
-- holds the matching token, plus two `WITH CHECK (true)` UPDATE
-- policies that allowed token holders to rewrite arbitrary columns.
-- All five were dropped in production by migrations
--   20260427180000_add_token_gated_policies.sql
--   20260427190000_drop_old_anon_signing_policies.sql
--   20260502120000_signing_flow_security_definer.sql
-- and replaced with token-match policies and SECURITY DEFINER RPCs.
-- They have been removed from this seed too. Re-running this script
-- on a fresh deploy will NOT re-introduce the incident.
--
-- Going forward: never add anon access policies in this file.
-- Anon access flows exclusively through the migration files above.
--
-- Prerequisites:
--   - tenant_id (NOT NULL) already exists on all 4 tables
--   - public.get_user_tenant_id() already exists
--   - Edge functions use service_role key (bypass RLS — unaffected)
--
-- Run in Supabase SQL Editor with service role, top-to-bottom
-- ============================================================


-- ============================================================
-- SECTION 1: CUSTOMERS
-- App access: list, detail, edit, create (all via anon key)
-- Edge access: none directly
-- ============================================================

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies (safe re-run)
DROP POLICY IF EXISTS "customers_select" ON public.customers;
DROP POLICY IF EXISTS "customers_insert" ON public.customers;
DROP POLICY IF EXISTS "customers_update" ON public.customers;
DROP POLICY IF EXISTS "customers_delete" ON public.customers;

CREATE POLICY "customers_select" ON public.customers
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "customers_delete" ON public.customers
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- ============================================================
-- SECTION 2: CALL_LOG
-- App access: list, detail, edit, create, delete (via anon key)
-- Edge access: deactivate-user reads count (service role — bypasses)
-- Note: CLAUDE.md mentions existing DELETE policy — drop first
-- ============================================================

ALTER TABLE public.call_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_log_select"              ON public.call_log;
DROP POLICY IF EXISTS "call_log_insert"              ON public.call_log;
DROP POLICY IF EXISTS "call_log_update"              ON public.call_log;
DROP POLICY IF EXISTS "call_log_delete"              ON public.call_log;
DROP POLICY IF EXISTS "call_log_public_read"         ON public.call_log;
DROP POLICY IF EXISTS "call_log_public_sign_update"  ON public.call_log;
-- Drop any legacy policy names that may exist
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON public.call_log;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.call_log;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.call_log;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.call_log;

CREATE POLICY "call_log_select" ON public.call_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "call_log_insert" ON public.call_log
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "call_log_update" ON public.call_log
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "call_log_delete" ON public.call_log
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Anon access to call_log:
--   SELECT — provided by call_log_public_read_token in
--     20260427180000_add_token_gated_policies.sql, which requires the
--     caller to present the matching signing_token via x-signing-token.
--   UPDATE — no anon policy. PublicSigningPage now flips
--     call_log.stage='Sold' through the SECURITY DEFINER RPC
--     mark_proposal_signed() defined in
--     20260502120000_signing_flow_security_definer.sql, which reads
--     call_log_id from proposals (not from caller input).
-- Removed bare-`signing_token IS NOT NULL` policies and a WITH CHECK
-- (true) UPDATE — audit C1/C2 (2026-04-30).


-- ============================================================
-- SECTION 3: PROPOSALS
-- App access: list, detail, edit, create, soft-delete (via anon key)
-- Edge access: send-proposal (service role — bypasses)
-- Public access: PublicSigningPage needs to read proposals
--   via signing_token WITHOUT being authenticated.
--   Add an anon SELECT policy scoped to signing_token lookup.
-- ============================================================

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proposals_select"              ON public.proposals;
DROP POLICY IF EXISTS "proposals_insert"              ON public.proposals;
DROP POLICY IF EXISTS "proposals_update"              ON public.proposals;
DROP POLICY IF EXISTS "proposals_delete"              ON public.proposals;
DROP POLICY IF EXISTS "proposals_public_sign"         ON public.proposals;
DROP POLICY IF EXISTS "proposals_public_sign_update"  ON public.proposals;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON public.proposals;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.proposals;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.proposals;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.proposals;

-- Authenticated users see their tenant's proposals
CREATE POLICY "proposals_select" ON public.proposals
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Anon access to proposals: provided by *_token policies in
-- 20260427180000_add_token_gated_policies.sql (require x-signing-token
-- header match). Sign-time mutation now flows through
-- mark_proposal_signed() (20260502120000_signing_flow_security_definer).
-- Removed bare `signing_token IS NOT NULL` SELECT + UPDATE policies —
-- audit C2 (2026-04-30).

CREATE POLICY "proposals_insert" ON public.proposals
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "proposals_update" ON public.proposals
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Allow soft-delete (UPDATE deleted_at) — covered by update policy above
-- Hard delete also allowed for tenant's own rows
CREATE POLICY "proposals_delete" ON public.proposals
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- ============================================================
-- SECTION 4: INVOICES
-- App access: list, detail, edit, create, soft-delete (via anon key)
-- Edge access: send-invoice, qb-sync-invoice (service role — bypasses)
-- Public access: customer invoice viewing via viewing_token
-- ============================================================

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_select"       ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert"       ON public.invoices;
DROP POLICY IF EXISTS "invoices_update"       ON public.invoices;
DROP POLICY IF EXISTS "invoices_delete"       ON public.invoices;
DROP POLICY IF EXISTS "invoices_public_view"  ON public.invoices;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON public.invoices;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.invoices;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.invoices;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.invoices;

-- Authenticated users see their tenant's invoices
CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Anon access to invoices: provided by invoices_public_view_token in
-- 20260427180000_add_token_gated_policies.sql (require x-viewing-token
-- header match). Removed bare `viewing_token IS NOT NULL` SELECT —
-- audit C2 (2026-04-30).

CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "invoices_delete" ON public.invoices
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- ============================================================
-- SECTION 5: VERIFY — run these SELECTs to confirm
-- ============================================================

-- Check RLS is enabled on all 4 tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('customers', 'call_log', 'proposals', 'invoices')
ORDER BY tablename;

-- Check all policies landed
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('customers', 'call_log', 'proposals', 'invoices')
ORDER BY tablename, policyname;

-- Smoke test: these should return data (you're authenticated as tenant user)
-- If any return 0 rows, something is wrong — DO NOT proceed to Phase 2
SELECT 'customers' AS tbl, count(*) FROM public.customers
UNION ALL
SELECT 'call_log', count(*) FROM public.call_log
UNION ALL
SELECT 'proposals', count(*) FROM public.proposals
UNION ALL
SELECT 'invoices', count(*) FROM public.invoices;
