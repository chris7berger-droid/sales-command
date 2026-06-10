-- S6 (T1 security remediation, Loop #33) — add x-cron-secret header to the
-- daily orphan-alarm cron.
--
-- check-orphan-users is gated with verify_jwt=true (config.toml) + a handler
-- x-cron-secret check. The scheduled pg_cron invoker must therefore send that
-- header. The original job (20260520095500_s2_orphan_user_alarm.sql) sent only
-- the service-role Bearer; this migration reschedules it to also send
-- x-cron-secret.
--
-- AS-EXECUTED DEVIATION FROM PLAN (2026-06-09): the plan called for storing the
-- secret in a Postgres GUC (app.settings.cron_secret) and reading it via
-- current_setting(...). That is PLATFORM-BLOCKED on this managed Supabase
-- project: setting a custom app.settings.* parameter (ALTER DATABASE/ROLE ...
-- SET) requires superuser, which the SQL editor / migration role is not. So the
-- secret is stored in Supabase Vault instead and read via
-- vault.decrypted_secrets. The edge function is UNCHANGED — it still compares the
-- header to its own CRON_SECRET function-env secret (supabase secrets set). Only
-- the cron's SOURCE of the secret changed (GUC -> Vault).
--
-- Provisioning that pairs with this migration (run once, out of band):
--   - Function env:  supabase secrets set CRON_SECRET=<value>
--   - Vault:         SELECT vault.create_secret('<value>', 'cron_secret', '...');
--   Both must hold the SAME value (a mismatch = 403 = silent alarm outage).
--
-- NOTE: url + Authorization still read from current_setting('app.settings.*'),
-- exactly as the original 20260520095500 job did — that pre-existing mechanism is
-- out of scope for this change and is left untouched.

-- Guarded unschedule so this migration is safe to re-run / safe on an env where
-- the job was never created.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-orphan-users-daily') THEN
    PERFORM cron.unschedule('check-orphan-users-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'check-orphan-users-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/check-orphan-users',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type',  'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
