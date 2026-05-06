ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS is_billing_contact boolean NOT NULL DEFAULT false;

UPDATE customer_contacts
  SET is_billing_contact = true
  WHERE role = 'Billing Contact'
    AND is_billing_contact = false;
