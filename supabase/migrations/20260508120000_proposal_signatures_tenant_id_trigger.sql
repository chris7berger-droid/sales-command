-- ============================================================
-- H4: bind proposal_signatures.tenant_id to its parent proposal
--
-- The tenant_id column, NOT NULL, FK to tenant_config(id), and
-- btree index are already on prod (added via sql/rls_child_tables.sql
-- outside the numbered migrations ledger). The DEFAULT was
-- get_user_tenant_id(), whose anon fallback returns "the first
-- tenant_config row" — producing an arbitrary tenant_id on anon
-- signature inserts (today benign with one tenant; latent
-- cross-tenant write the moment a second tenant is provisioned).
--
-- Fix is policy-adjacent but implemented at the row level:
--   - Install a BEFORE INSERT trigger that always derives
--     tenant_id from public.proposals.tenant_id for the row's
--     proposal_id. Whatever the caller passes (or omits) is
--     overwritten.
--   - Drop the column DEFAULT (the trigger is now responsible).
--
-- This means:
--   * Anon inserts via the public signing flow get the correct
--     tenant regardless of get_user_tenant_id()'s anon fallback.
--   * Authenticated inserts (none today, but the policy exists)
--     still hit WITH CHECK (tenant_id = get_user_tenant_id());
--     if the caller tries to insert against another tenant's
--     proposal, the trigger sets the parent's tenant_id, the
--     WITH CHECK fails, and the row is rejected.
--   * Existing anon INSERT policy (token-only WITH CHECK) is
--     unchanged. The trigger handles tenant correctness; the
--     policy handles authorization.
-- ============================================================


-- ----- 1. Trigger function -----
CREATE OR REPLACE FUNCTION public.set_proposal_signature_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parent_tenant uuid;
BEGIN
  SELECT tenant_id
    INTO v_parent_tenant
  FROM public.proposals
  WHERE id = NEW.proposal_id;

  IF v_parent_tenant IS NULL THEN
    -- Parent proposal missing OR parent has NULL tenant_id. The
    -- FK on proposal_id covers the missing case and would block
    -- the row at constraint time anyway, but we raise here so
    -- the error is unambiguous and fires before the FK check.
    RAISE EXCEPTION
      'proposal_signatures insert blocked: parent proposal % missing or has NULL tenant_id',
      NEW.proposal_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.tenant_id := v_parent_tenant;
  RETURN NEW;
END;
$$;


-- ----- 2. Trigger -----
DROP TRIGGER IF EXISTS trg_proposal_signatures_set_tenant
  ON public.proposal_signatures;

CREATE TRIGGER trg_proposal_signatures_set_tenant
  BEFORE INSERT ON public.proposal_signatures
  FOR EACH ROW
  EXECUTE FUNCTION public.set_proposal_signature_tenant_id();


-- ----- 3. Drop the column DEFAULT -----
ALTER TABLE public.proposal_signatures
  ALTER COLUMN tenant_id DROP DEFAULT;
