ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS default_proposal_email_intro text;
