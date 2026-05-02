-- ============================================================
-- RLS Phase 3: Identity & config tables
-- Tables: team_members, tenant_config, qb_connection
--
-- Run in Supabase SQL Editor with service role, top-to-bottom.
--
-- HARDENED 2026-05-02 (audit C2/H2/H3, 2026-04-30):
-- The original seed shipped two anon SELECT policies that exposed
-- every tenant's team and config rows to anyone with the publishable
-- anon key:
--   team_members_public_read   USING (active = true)
--   tenant_config_public_read  USING (true)
-- Both were dropped in production by migration
--   20260429190000_drop_public_read_policies.sql
-- and replaced by column-scoped RPCs:
--   public.get_rep_contact(rep_name text)
--   public.get_public_tenant_config()
-- They have been removed from this seed too, so a fresh deploy will
-- never re-introduce them. Do NOT add anon SELECT/UPDATE policies on
-- these tables — anon access flows exclusively through the RPCs above.
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

-- Anon access to team_members goes exclusively through the
-- public.get_rep_contact() RPC. Removed the bare USING (active = true)
-- policy — it exposed full PII (auth_id, role, every column) across
-- tenants to any publishable-key holder. Audit H3 (2026-04-30).


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

-- Anon access to tenant_config goes exclusively through the
-- public.get_public_tenant_config() RPC, which returns only branding
-- columns (no stripe IDs, billing goals, license number). Removed the
-- bare USING (true) policy — it exposed every tenant's full row to
-- any publishable-key holder. Audit H2 (2026-04-30).


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
