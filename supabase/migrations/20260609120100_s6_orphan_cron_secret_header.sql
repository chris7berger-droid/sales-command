-- S6 (T1 security remediation, Loop #33) — add x-cron-secret header to the
-- daily orphan-alarm cron.
--
-- check-orphan-users is being gated with verify_jwt=true (config.toml) + a
-- handler x-cron-secret check. The scheduled pg_cron invoker must therefore send
-- that header. The original job (20260520095500_s2_orphan_user_alarm.sql) sends
-- only the service-role Bearer; this migration reschedules it to also send
-- x-cron-secret, read from the app.settings.cron_secret GUC the same way the
-- Bearer reads app.settings.service_role_key.
--
-- LOCKSTEP (see plan §6 step 3, reschedule-before-gate): provision the GUC
-- out-of-band and smoke it FIRST, then push THIS migration (the function is
-- still ungated, so it ignores the new header and keeps returning 200 — no
-- missed run), then deploy the gated function. That order leaves no window where
-- the live cron is 403'd.
--
-- current_setting('app.settings.cron_secret', TRUE) uses the two-arg missing_ok
-- form: if the GUC is unset it returns NULL instead of RAISING. A raise here
-- would abort the entire net.http_post statement and silently stop the daily
-- alarm. NULL instead means the function 403s the call (no valid secret) — which
-- is why the GUC must be provisioned BEFORE this lands (the missing_ok form
-- prevents a crash; provisioning is what makes the secret present).

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
      'x-cron-secret', current_setting('app.settings.cron_secret', TRUE)
    ),
    body := '{}'::jsonb
  );
  $$
);
