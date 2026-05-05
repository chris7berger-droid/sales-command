ALTER TABLE billing_schedule_pay_apps
  ADD COLUMN IF NOT EXISTS release_waiver_url text;
