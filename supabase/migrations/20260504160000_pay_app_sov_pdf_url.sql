ALTER TABLE billing_schedule_pay_apps
  ADD COLUMN IF NOT EXISTS sov_pdf_url text;
