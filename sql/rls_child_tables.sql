-- ============================================================
-- RLS Phase 2: Child tables
-- Tables: proposal_wtc, proposal_recipients, proposal_signatures,
--         invoice_lines, job_work_types, customer_contacts
--
-- HARDENED 2026-05-02 (audit C2/C3, 2026-04-30):
-- The original seed shipped four anon policies in the documented
-- 2026-04-26 anti-pattern shape (predicates that just checked the
-- parent's *_token IS NOT NULL without requiring a header match)
-- plus a `WITH CHECK (true)` UPDATE on proposal_recipients that
-- allowed signing-token holders to flip recipient role from
-- 'viewer' to 'signer'. All four were dropped in production by
-- migrations
--   20260427180000_add_token_gated_policies.sql
--   20260427190000_drop_old_anon_signing_policies.sql
--   20260502120000_signing_flow_security_definer.sql
-- Removed from this seed too. Anon access flows exclusively through
-- those migrations and the SECURITY DEFINER RPCs they install.
--
-- Strategy: Add tenant_id, backfill from parent, enable RLS
-- Edge functions use service_role key — bypass RLS, unaffected
--
-- Run in Supabase SQL Editor with service role, top-to-bottom
-- ============================================================


-- ============================================================
-- SECTION 1: ADD tenant_id TO ALL CHILD TABLES
-- ============================================================

-- 1a. proposal_wtc (parent: proposals)
ALTER TABLE public.proposal_wtc
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.proposal_wtc AS pw
SET tenant_id = p.tenant_id
FROM public.proposals p
WHERE pw.proposal_id::text = p.id::text
  AND pw.tenant_id IS NULL;

-- Fallback: any orphans get default tenant
UPDATE public.proposal_wtc
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.proposal_wtc
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_proposal_wtc_tenant
  ON public.proposal_wtc(tenant_id);


-- 1b. proposal_recipients (parent: proposals)
ALTER TABLE public.proposal_recipients
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.proposal_recipients AS pr
SET tenant_id = p.tenant_id
FROM public.proposals p
WHERE pr.proposal_id::text = p.id::text
  AND pr.tenant_id IS NULL;

UPDATE public.proposal_recipients
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.proposal_recipients
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_proposal_recipients_tenant
  ON public.proposal_recipients(tenant_id);


-- 1c. proposal_signatures (parent: proposals)
ALTER TABLE public.proposal_signatures
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.proposal_signatures AS ps
SET tenant_id = p.tenant_id
FROM public.proposals p
WHERE ps.proposal_id::text = p.id::text
  AND ps.tenant_id IS NULL;

UPDATE public.proposal_signatures
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.proposal_signatures
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_proposal_signatures_tenant
  ON public.proposal_signatures(tenant_id);


-- 1d. invoice_lines (parent: invoices)
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.invoice_lines AS il
SET tenant_id = i.tenant_id
FROM public.invoices i
WHERE il.invoice_id::text = i.id::text
  AND il.tenant_id IS NULL;

UPDATE public.invoice_lines
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.invoice_lines
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_invoice_lines_tenant
  ON public.invoice_lines(tenant_id);


-- 1e. job_work_types (parent: call_log)
ALTER TABLE public.job_work_types
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.job_work_types AS jw
SET tenant_id = cl.tenant_id
FROM public.call_log cl
WHERE jw.call_log_id = cl.id
  AND jw.tenant_id IS NULL;

UPDATE public.job_work_types
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.job_work_types
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_job_work_types_tenant
  ON public.job_work_types(tenant_id);


-- 1f. customer_contacts (parent: customers)
ALTER TABLE public.customer_contacts
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.customer_contacts AS cc
SET tenant_id = c.tenant_id
FROM public.customers c
WHERE cc.customer_id = c.id
  AND cc.tenant_id IS NULL;

UPDATE public.customer_contacts
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.customer_contacts
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_customer_contacts_tenant
  ON public.customer_contacts(tenant_id);


-- ============================================================
-- SECTION 2: ENABLE RLS + POLICIES
-- ============================================================

-- -------------------------------------------------------
-- 2a. proposal_wtc
-- Authenticated: tenant-scoped CRUD
-- Anon: SELECT for signing page (reads WTCs to show SOW)
-- -------------------------------------------------------
ALTER TABLE public.proposal_wtc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proposal_wtc_select"        ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_wtc_insert"        ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_wtc_update"        ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_wtc_delete"        ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_wtc_public_read"   ON public.proposal_wtc;

CREATE POLICY "proposal_wtc_select" ON public.proposal_wtc
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Anon SELECT on proposal_wtc — provided by proposal_wtc_public_read_token
-- in 20260427180000_add_token_gated_policies.sql (requires x-signing-token
-- header match). Removed bare-`signing_token IS NOT NULL` policy —
-- audit C2 (2026-04-30).

CREATE POLICY "proposal_wtc_insert" ON public.proposal_wtc
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "proposal_wtc_update" ON public.proposal_wtc
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "proposal_wtc_delete" ON public.proposal_wtc
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- -------------------------------------------------------
-- 2b. proposal_recipients
-- Authenticated: tenant-scoped CRUD
-- Anon: UPDATE viewed_at from signing page
-- -------------------------------------------------------
ALTER TABLE public.proposal_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proposal_recipients_select"        ON public.proposal_recipients;
DROP POLICY IF EXISTS "proposal_recipients_insert"        ON public.proposal_recipients;
DROP POLICY IF EXISTS "proposal_recipients_update"        ON public.proposal_recipients;
DROP POLICY IF EXISTS "proposal_recipients_delete"        ON public.proposal_recipients;
DROP POLICY IF EXISTS "proposal_recipients_public_update" ON public.proposal_recipients;

CREATE POLICY "proposal_recipients_select" ON public.proposal_recipients
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "proposal_recipients_insert" ON public.proposal_recipients
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "proposal_recipients_update" ON public.proposal_recipients
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "proposal_recipients_delete" ON public.proposal_recipients
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Anon access to proposal_recipients is now write-only via the
-- SECURITY DEFINER RPC mark_recipient_viewed() defined in
-- 20260502120000_signing_flow_security_definer.sql, which updates
-- ONLY the viewed_at column. Removed the WITH CHECK (true) anon
-- UPDATE policy — audit C3 (2026-04-30).


-- -------------------------------------------------------
-- 2c. proposal_signatures
-- Authenticated: tenant-scoped SELECT + DELETE (pull-back)
-- Anon: INSERT from signing page
-- -------------------------------------------------------
ALTER TABLE public.proposal_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proposal_signatures_select"        ON public.proposal_signatures;
DROP POLICY IF EXISTS "proposal_signatures_insert"        ON public.proposal_signatures;
DROP POLICY IF EXISTS "proposal_signatures_delete"        ON public.proposal_signatures;
DROP POLICY IF EXISTS "proposal_signatures_public_insert" ON public.proposal_signatures;

CREATE POLICY "proposal_signatures_select" ON public.proposal_signatures
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "proposal_signatures_insert" ON public.proposal_signatures
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "proposal_signatures_delete" ON public.proposal_signatures
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Anon INSERT on proposal_signatures — provided by
-- proposal_signatures_public_insert_token in
-- 20260427180000_add_token_gated_policies.sql (requires x-signing-token
-- header match). Removed bare-`signing_token IS NOT NULL` policy —
-- audit C2 (2026-04-30). Future hardening per audit H4: bind
-- proposal_signatures.tenant_id to the parent proposal in WITH CHECK.


-- -------------------------------------------------------
-- 2d. invoice_lines
-- Authenticated: tenant-scoped CRUD
-- Anon: SELECT for public invoice viewing page
-- -------------------------------------------------------
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_lines_select"       ON public.invoice_lines;
DROP POLICY IF EXISTS "invoice_lines_insert"       ON public.invoice_lines;
DROP POLICY IF EXISTS "invoice_lines_update"       ON public.invoice_lines;
DROP POLICY IF EXISTS "invoice_lines_delete"       ON public.invoice_lines;
DROP POLICY IF EXISTS "invoice_lines_public_read"  ON public.invoice_lines;

CREATE POLICY "invoice_lines_select" ON public.invoice_lines
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Anon SELECT on invoice_lines — provided by invoice_lines_public_read_token
-- in 20260427180000_add_token_gated_policies.sql (requires x-viewing-token
-- header match). Removed bare-`viewing_token IS NOT NULL` policy —
-- audit C2 (2026-04-30).

CREATE POLICY "invoice_lines_insert" ON public.invoice_lines
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "invoice_lines_update" ON public.invoice_lines
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "invoice_lines_delete" ON public.invoice_lines
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- -------------------------------------------------------
-- 2e. job_work_types
-- Authenticated: tenant-scoped CRUD
-- No anon access needed
-- -------------------------------------------------------
ALTER TABLE public.job_work_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_work_types_select" ON public.job_work_types;
DROP POLICY IF EXISTS "job_work_types_insert" ON public.job_work_types;
DROP POLICY IF EXISTS "job_work_types_update" ON public.job_work_types;
DROP POLICY IF EXISTS "job_work_types_delete" ON public.job_work_types;
-- Legacy policies
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON public.job_work_types;
DROP POLICY IF EXISTS "Enable read access for authenticated users"  ON public.job_work_types;
DROP POLICY IF EXISTS "Enable insert for authenticated users only"  ON public.job_work_types;
DROP POLICY IF EXISTS "Enable update for authenticated users only"  ON public.job_work_types;

CREATE POLICY "job_work_types_select" ON public.job_work_types
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "job_work_types_insert" ON public.job_work_types
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "job_work_types_update" ON public.job_work_types
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "job_work_types_delete" ON public.job_work_types
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- -------------------------------------------------------
-- 2f. customer_contacts
-- Authenticated: tenant-scoped CRUD
-- No anon access needed
-- -------------------------------------------------------
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_contacts_select" ON public.customer_contacts;
DROP POLICY IF EXISTS "customer_contacts_insert" ON public.customer_contacts;
DROP POLICY IF EXISTS "customer_contacts_update" ON public.customer_contacts;
DROP POLICY IF EXISTS "customer_contacts_delete" ON public.customer_contacts;

CREATE POLICY "customer_contacts_select" ON public.customer_contacts
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "customer_contacts_insert" ON public.customer_contacts
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "customer_contacts_update" ON public.customer_contacts
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "customer_contacts_delete" ON public.customer_contacts
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- ============================================================
-- SECTION 3: VERIFY
-- ============================================================

-- Check RLS is enabled on all 6 tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'proposal_wtc', 'proposal_recipients', 'proposal_signatures',
    'invoice_lines', 'job_work_types', 'customer_contacts'
  )
ORDER BY tablename;

-- Check all policies landed
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'proposal_wtc', 'proposal_recipients', 'proposal_signatures',
    'invoice_lines', 'job_work_types', 'customer_contacts'
  )
ORDER BY tablename, policyname;

-- Smoke test: all should return row counts (not 0)
SELECT 'proposal_wtc' AS tbl, count(*) FROM public.proposal_wtc
UNION ALL
SELECT 'proposal_recipients', count(*) FROM public.proposal_recipients
UNION ALL
SELECT 'proposal_signatures', count(*) FROM public.proposal_signatures
UNION ALL
SELECT 'invoice_lines', count(*) FROM public.invoice_lines
UNION ALL
SELECT 'job_work_types', count(*) FROM public.job_work_types
UNION ALL
SELECT 'customer_contacts', count(*) FROM public.customer_contacts;
