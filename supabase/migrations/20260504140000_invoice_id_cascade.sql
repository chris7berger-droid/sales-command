-- Allow invoice number (id) changes to cascade to child tables.
-- Without this, renaming an invoice (e.g. matching a QB invoice number)
-- fails with a FK constraint violation.

-- invoice_lines → invoices
ALTER TABLE public.invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_invoice_id_fkey,
  ADD CONSTRAINT invoice_lines_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
    ON UPDATE CASCADE ON DELETE CASCADE;

-- billing_schedule_pay_apps → invoices
ALTER TABLE public.billing_schedule_pay_apps
  DROP CONSTRAINT IF EXISTS billing_schedule_pay_apps_invoice_id_fkey,
  ADD CONSTRAINT billing_schedule_pay_apps_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
    ON UPDATE CASCADE ON DELETE SET NULL;
