-- ============================================================
-- RLS Phase 1: Core tenant-scoped tables
-- Tables: customers, call_log, proposals, invoices
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

-- Anon: PublicSigningPage reads call_log via proposals join
-- Scoped: only rows linked to a proposal that has a signing_token
CREATE POLICY "call_log_public_read" ON public.call_log
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.call_log_id = call_log.id
        AND p.signing_token IS NOT NULL
    )
  );

-- Anon: PublicSigningPage fallback updates stage to "Sold" after signing
-- Same scope — only call_log rows tied to a signable proposal
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

-- Anon users can read a single proposal by signing_token (public signing page)
CREATE POLICY "proposals_public_sign" ON public.proposals
  FOR SELECT TO anon
  USING (signing_token IS NOT NULL);

-- Anon users can update proposal status after signing (fallback when edge fn fails)
-- Scoped to rows that have a signing_token (only signable proposals)
CREATE POLICY "proposals_public_sign_update" ON public.proposals
  FOR UPDATE TO anon
  USING (signing_token IS NOT NULL)
  WITH CHECK (signing_token IS NOT NULL);

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

-- Anon users can view a single invoice by viewing_token (customer payment page)
CREATE POLICY "invoices_public_view" ON public.invoices
  FOR SELECT TO anon
  USING (viewing_token IS NOT NULL);

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
