-- Reverts 20260509120000_get_user_tenant_id_remove_fallback.sql
-- Restores the COALESCE fallback. Note: re-introduces the
-- latent cross-tenant exposure described in S1 — only run if
-- the no-fallback body broke prod.
--
-- For an in-incident rollback, the CREATE OR REPLACE below
-- can be pasted into the Supabase SQL Editor directly; this
-- file exists for audit-trail completeness.

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tenant_id FROM public.team_members
      WHERE auth_id = auth.uid() LIMIT 1),
    (SELECT id FROM public.tenant_config LIMIT 1)
  );
$$;

DROP VIEW IF EXISTS public.v_orphan_auth_users;
