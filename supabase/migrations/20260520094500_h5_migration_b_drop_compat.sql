-- H5 Migration B (O3): Drop 1-arg compat wrapper + legacy anon insert policy.
-- Safe to apply: 9 days past H5 deploy (2026-05-11), all browsers have
-- refreshed to the 5-arg edge-fn path. The 1-arg form is dead code.

BEGIN;

-- Drop the 1-arg compatibility wrapper
DROP FUNCTION IF EXISTS public.mark_proposal_signed(text);

-- Drop the legacy anon INSERT policy on proposal_signatures.
-- The edge function (proposal-signed) now handles all signature inserts
-- via service_role, so anon INSERT is no longer needed.
DROP POLICY IF EXISTS "proposal_signatures_public_insert_token"
  ON public.proposal_signatures;

-- Notify PostgREST to pick up the schema change immediately
NOTIFY pgrst, 'reload schema';

COMMIT;
