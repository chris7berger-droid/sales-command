-- ============================================================
-- S1: drop the COALESCE fallback in public.get_user_tenant_id().
--
-- Live body (confirmed against prod 2026-05-07 via
-- pg_get_functiondef before this migration was applied):
--
--   SELECT COALESCE(
--     (SELECT tenant_id FROM public.team_members
--       WHERE auth_id = auth.uid() LIMIT 1),
--     (SELECT id FROM public.tenant_config LIMIT 1)
--   );
--
-- The second branch returns "the first row of tenant_config"
-- whenever the caller has no team_members row. Today (single
-- tenant) the bug is latent; multi-tenant onboarding (F7) turns
-- it into a cross-tenant read on every RLS-scoped table. H4
-- (proposal_signatures BEFORE INSERT trigger, migration
-- 20260508120000) closed the anon path of this same fallback;
-- S1 is the authenticated path.
--
-- Fix: drop the fallback. NULL on miss is the convention used
-- by archive.get_user_tenant_id() (migration 20260416230000)
-- and is already handled by callers — public.delete_customer
-- and public.merge_customers (migration 20260430120000), and
-- public.merge_call_log (migration 20260507120000), all check
-- IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'.
--
-- Side-fix: scope to active=true so a deactivated team_members
-- row (active=false, auth_id non-null in some hypothetical
-- future state) cannot retain tenant access. The current
-- deactivate-user edge function clears auth_id, so this is a
-- no-op for current data — defense-in-depth only.
--
-- Pre-apply gate (one-shot, runs only at this migration's
-- apply time; the steady-state guard is v_orphan_auth_users
-- below paired with a scheduled query — see plan
-- §Antifragile observability):
-- ============================================================

DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans
    FROM auth.users u
    LEFT JOIN public.team_members tm
      ON tm.auth_id = u.id AND tm.active = true
   WHERE tm.id IS NULL
     AND u.deleted_at IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'S1 pre-flight failed: % orphan auth user(s) without an active team_members row. '
      'Provision or delete them before applying this migration.', v_orphans;
  END IF;
END $$;

-- ----- 1. Replace the function body. Metadata identical to
--          current prod (SECURITY DEFINER, STABLE, search_path).
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id
    FROM public.team_members
   WHERE auth_id = auth.uid()
     AND active = true
   LIMIT 1;
$$;

-- ----- 2. Permanent operator-visible orphan view. This is the
--          steady-state guard. Pair with a scheduled query
--          alerting on count(*) > 0 (see plan §Antifragile
--          observability).
CREATE OR REPLACE VIEW public.v_orphan_auth_users AS
SELECT u.id        AS auth_id,
       u.email,
       u.created_at,
       u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.team_members tm
    ON tm.auth_id = u.id AND tm.active = true
 WHERE tm.id IS NULL
   AND u.deleted_at IS NULL;

REVOKE ALL ON public.v_orphan_auth_users FROM public, anon;
-- No grant to authenticated: the view is SECURITY INVOKER over
-- auth.users, which the authenticated role cannot read. A grant
-- here would be misleading. Reads happen via service_role
-- (Studio, scheduled cron functions); listed in
-- handoffs/SC_Handoff_v102.txt under "monitoring queries".

-- ============================================================
-- POST-APPLY VERIFICATION
-- ============================================================
-- 1) New body landed:
--    SELECT pg_get_functiondef('public.get_user_tenant_id()'::regprocedure);
--
-- 2) Authenticated path returns admin's tenant:
--    -- (run as the prod admin via Studio impersonation)
--    SELECT public.get_user_tenant_id();   -- expect uuid
--
-- 3) Anon path returns NULL (regression guard, was already true):
--    SET ROLE anon;
--    SELECT public.get_user_tenant_id();   -- expect NULL
--    RESET ROLE;
--
-- 4) Orphan view is empty:
--    SELECT count(*) FROM public.v_orphan_auth_users;  -- expect 0
--
-- 5) Live app smoke at scmybiz.com — see plan §Verification.
-- ============================================================
