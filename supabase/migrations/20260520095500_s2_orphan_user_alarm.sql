-- S2: Daily orphan auth user alarm.
-- Creates an RPC that counts orphan users from private.v_orphan_auth_users
-- (service_role only), and schedules a daily cron via pg_cron + pg_net
-- to invoke the check-orphan-users edge function.

-- RPC for the edge function to call
CREATE OR REPLACE FUNCTION public.get_orphan_auth_user_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer FROM private.v_orphan_auth_users;
$$;

-- Only service_role should call this
REVOKE EXECUTE ON FUNCTION public.get_orphan_auth_user_count() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_orphan_auth_user_count() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_orphan_auth_user_count() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_orphan_auth_user_count() TO service_role;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule daily cron at 6am UTC (11pm PST) via pg_cron + pg_net
SELECT cron.schedule(
  'check-orphan-users-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/check-orphan-users',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
