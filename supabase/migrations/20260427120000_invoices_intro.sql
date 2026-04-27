-- Per-invoice email intro + tenant default.
--
-- invoices.intro: editable greeting/body inserted into the customer email
-- between "Hi {name}," and the invoice card. Distinct from
-- invoices.description, which is the work description that prints on the
-- invoice itself (above the Amount Due banner).
--
-- tenant_config.default_invoice_intro: tenant-level default that pre-fills
-- the New Invoice modal. Sits alongside default_invoice_description and
-- default_pay_app_intro.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS intro text;

ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS default_invoice_intro text;

UPDATE public.tenant_config
   SET default_invoice_intro = $seed$Please find your invoice attached.

Let me know if you have any questions.

Thank you,$seed$
 WHERE default_invoice_intro IS NULL;
