-- Default pay app email intro per tenant.
--
-- Used as the editable body text when a user clicks "Send Pay App" from a
-- pay app detail view. Supports template variables that the client fills in
-- at send time: {{app_number}}, {{period}}, {{job_name}}, {{amount}}.
--
-- Sits alongside the existing tenant_config.default_proposal_intro and
-- tenant_config.default_invoice_description.

ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS default_pay_app_intro text;

-- Seed a reasonable default on existing tenants that don't have one set yet.
UPDATE public.tenant_config
   SET default_pay_app_intro = $seed$Please find attached Pay Application #{{app_number}} for {{job_name}} covering the period {{period}}.

Our invoice #{{invoice_number}} for {{amount}} is attached as well.

Let me know if any additional documentation is needed to process this request.

Thank you,$seed$
 WHERE default_pay_app_intro IS NULL;
