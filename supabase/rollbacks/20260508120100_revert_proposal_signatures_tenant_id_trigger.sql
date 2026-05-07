-- Reverts 20260508120000_proposal_signatures_tenant_id_trigger.sql
-- Restores the prior state: column DEFAULT get_user_tenant_id(),
-- no trigger. Note: this re-introduces the latent cross-tenant
-- write bug — only run if the trigger broke signing in prod.
--
-- For an in-incident rollback, running these three statements
-- directly via the Supabase SQL Editor is faster than authoring
-- and applying this file. This migration exists for audit-trail
-- completeness.

DROP TRIGGER IF EXISTS trg_proposal_signatures_set_tenant
  ON public.proposal_signatures;

DROP FUNCTION IF EXISTS public.set_proposal_signature_tenant_id();

ALTER TABLE public.proposal_signatures
  ALTER COLUMN tenant_id SET DEFAULT public.get_user_tenant_id();
