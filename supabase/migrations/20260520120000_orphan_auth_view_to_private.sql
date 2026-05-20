-- ============================================================
-- Move v_orphan_auth_users from public to a non-API-exposed
-- schema. Closes two Supabase advisor findings flagged
-- 2026-05-17 on Command Suite DB:
--
--   1) auth_users_exposed (ERROR, SECURITY) — a view in a schema
--      exposed via PostgREST (default: public, graphql_public)
--      that references auth.users is reachable by the
--      authenticated role through PostgREST even when grants are
--      revoked, because Supabase's default privilege chain
--      grants SELECT on public objects to authenticated.
--      Advisor metadata confirmed exposed_to: ["authenticated"].
--
--   2) security_definer_view (ERROR, SECURITY) — the public view
--      ran with the view-owner's privileges (postgres role,
--      which can read auth.users) rather than the caller's,
--      bypassing RLS. The original migration's comment claimed
--      SECURITY INVOKER but the view was never created with
--      WITH (security_invoker=on), so the default (DEFINER) was
--      in effect.
--
-- The view itself is operator-only — it's the steady-state
-- guard for S1 (migration 20260509120000), read by Studio and
-- service_role for the upcoming S2 scheduled alarm. No app code
-- queries it (grep verified 2026-05-20). Moving it to a schema
-- that PostgREST does not expose preserves the operator use
-- case and removes the API-surface exposure entirely.
--
-- supabase/config.toml has no [api] block, so PostgREST exposes
-- the defaults (public, graphql_public, storage). The `private`
-- schema is not exposed.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE OR REPLACE VIEW private.v_orphan_auth_users
WITH (security_invoker = on) AS
SELECT u.id        AS auth_id,
       u.email,
       u.created_at,
       u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.team_members tm
    ON tm.auth_id = u.id AND tm.active = true
 WHERE tm.id IS NULL
   AND u.deleted_at IS NULL;

REVOKE ALL ON private.v_orphan_auth_users FROM public, anon, authenticated;
GRANT SELECT ON private.v_orphan_auth_users TO service_role;

DROP VIEW IF EXISTS public.v_orphan_auth_users;

-- ============================================================
-- POST-APPLY VERIFICATION
-- ============================================================
-- 1) New view present:
--    SELECT count(*) FROM private.v_orphan_auth_users;  -- expect 0
--
-- 2) Old view gone:
--    SELECT 1 FROM pg_views
--     WHERE schemaname='public' AND viewname='v_orphan_auth_users';
--    -- expect 0 rows
--
-- 3) Advisor re-scan: both auth_users_exposed and
--    security_definer_view findings should clear on Command Suite DB.
-- ============================================================
