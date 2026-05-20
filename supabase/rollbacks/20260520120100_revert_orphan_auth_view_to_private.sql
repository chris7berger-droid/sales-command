-- Reverts 20260520120000_orphan_auth_view_to_private.sql
-- Restores the public.v_orphan_auth_users view as defined in
-- migration 20260509120000. Note: rolling back re-opens the
-- two advisor findings (auth_users_exposed,
-- security_definer_view). Only run if the move broke the S2
-- monitoring path or some operator query.
--
-- For an in-incident rollback, the CREATE OR REPLACE below
-- can be pasted into the Supabase SQL Editor directly; this
-- file exists for audit-trail completeness.

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

DROP VIEW IF EXISTS private.v_orphan_auth_users;
-- private schema kept (idempotent CREATE SCHEMA IF NOT EXISTS;
-- removing it could break unrelated objects added later).
