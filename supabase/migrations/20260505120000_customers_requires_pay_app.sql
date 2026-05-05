ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS requires_pay_app boolean NOT NULL DEFAULT false;
