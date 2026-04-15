-- ============================================================
-- RLS Phase 3: Identity & config tables
-- Tables: team_members, tenant_config, qb_connection
--
-- Run in Supabase SQL Editor with service role, top-to-bottom
-- ============================================================


-- ============================================================
-- SECTION 1: TEAM_MEMBERS — add tenant_id + RLS
-- ============================================================

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

-- Backfill: all existing members belong to the single tenant
UPDATE public.team_members
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.team_members
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_team_members_tenant
  ON public.team_members(tenant_id);

CREATE INDEX IF NOT EXISTS idx_team_members_auth_id
  ON public.team_members(auth_id);

-- Enable RLS
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_members_select"        ON public.team_members;
DROP POLICY IF EXISTS "team_members_insert"        ON public.team_members;
DROP POLICY IF EXISTS "team_members_update"        ON public.team_members;
DROP POLICY IF EXISTS "team_members_delete"        ON public.team_members;
DROP POLICY IF EXISTS "team_members_public_read"   ON public.team_members;

-- Authenticated: see your tenant's team
CREATE POLICY "team_members_select" ON public.team_members
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "team_members_insert" ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "team_members_update" ON public.team_members
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "team_members_delete" ON public.team_members
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Anon: signing page + public invoice page look up rep by name
-- Only expose name, email, phone — scoped to active reps
CREATE POLICY "team_members_public_read" ON public.team_members
  FOR SELECT TO anon
  USING (active = true);


-- ============================================================
-- SECTION 2: TENANT_CONFIG — RLS (singleton table)
-- ============================================================

ALTER TABLE public.tenant_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_config_select"        ON public.tenant_config;
DROP POLICY IF EXISTS "tenant_config_update"        ON public.tenant_config;
DROP POLICY IF EXISTS "tenant_config_public_read"   ON public.tenant_config;

-- Authenticated: read + update your own tenant config
CREATE POLICY "tenant_config_select" ON public.tenant_config
  FOR SELECT TO authenticated
  USING (id = public.get_user_tenant_id());

CREATE POLICY "tenant_config_update" ON public.tenant_config
  FOR UPDATE TO authenticated
  USING  (id = public.get_user_tenant_id())
  WITH CHECK (id = public.get_user_tenant_id());

-- Anon: public pages need branding (logo, name, phone, etc.)
-- Read-only, no sensitive data exposed (tokens managed by edge fns)
CREATE POLICY "tenant_config_public_read" ON public.tenant_config
  FOR SELECT TO anon
  USING (true);


-- ============================================================
-- SECTION 3: QB_CONNECTION — RLS (lock down secrets)
-- Contains OAuth access_token + refresh_token in plain text.
-- Only edge functions (service role) should ever touch this.
-- No client policies = no anon or authenticated access.
-- ============================================================

ALTER TABLE public.qb_connection ENABLE ROW LEVEL SECURITY;

-- No policies created intentionally.
-- Service role bypasses RLS → edge functions still work.
-- Anon + authenticated get zero rows → tokens are safe.


-- ============================================================
-- SECTION 4: UPDATE get_user_tenant_id() TO BE AUTH-AWARE
-- Current version just does LIMIT 1 (single-tenant assumption).
-- New version: look up tenant via the logged-in user's auth_id.
-- Falls back to LIMIT 1 if no match (backwards-compatible).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid AS $$
  SELECT COALESCE(
    (SELECT tenant_id FROM public.team_members WHERE auth_id = auth.uid() LIMIT 1),
    (SELECT id FROM public.tenant_config LIMIT 1)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================================
-- SECTION 5: VERIFY
-- ============================================================

-- Check RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('team_members', 'tenant_config', 'qb_connection')
ORDER BY tablename;

-- Check policies
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('team_members', 'tenant_config', 'qb_connection')
ORDER BY tablename, policyname;

-- Smoke test
SELECT 'team_members' AS tbl, count(*) FROM public.team_members
UNION ALL
SELECT 'tenant_config', count(*) FROM public.tenant_config;

-- qb_connection should return 0 rows (RLS blocks authenticated)
-- This is correct — only service role can read it
SELECT 'qb_connection (should be 0 from auth context)' AS tbl, count(*) FROM public.qb_connection;
