-- B19 follow-up: restore guardrails dropped during repoint rewrite.
-- Fixes: (1) auth check (is_admin_or_manager), (2) caller tenant verification,
-- (3) performed_by team_members lookup, (4) symbolic error codes,
-- (5) additive pay-app template dedup, (6) proposals_moved audit column.

BEGIN;

-- 1. Add proposals_moved column to audit table
ALTER TABLE public.customer_merges
  ADD COLUMN IF NOT EXISTS proposals_moved int NOT NULL DEFAULT 0;

-- 2. Restore merge_customers with original guardrails + B19's UPDATE proposals
CREATE OR REPLACE FUNCTION public.merge_customers(p_dup_id uuid, p_survivor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id        uuid;
  v_dup              public.customers%ROWTYPE;
  v_survivor         public.customers%ROWTYPE;
  v_jobs_moved       int;
  v_contacts_moved   int;
  v_templates_moved  int;
  v_proposals_moved  int;
  v_qb_copied        boolean := false;
  v_performed_by     uuid;
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_dup_id = p_survivor_id THEN
    RAISE EXCEPTION 'SAME_CUSTOMER';
  END IF;

  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'NO_TENANT';
  END IF;

  -- Deterministic lock order
  IF p_dup_id < p_survivor_id THEN
    SELECT * INTO v_dup      FROM public.customers WHERE id = p_dup_id      FOR UPDATE;
    SELECT * INTO v_survivor FROM public.customers WHERE id = p_survivor_id FOR UPDATE;
  ELSE
    SELECT * INTO v_survivor FROM public.customers WHERE id = p_survivor_id FOR UPDATE;
    SELECT * INTO v_dup      FROM public.customers WHERE id = p_dup_id      FOR UPDATE;
  END IF;

  IF v_dup.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND_DUPLICATE';
  END IF;
  IF v_survivor.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND_SURVIVOR';
  END IF;

  IF v_dup.tenant_id <> v_tenant_id OR v_survivor.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  SELECT id INTO v_performed_by
    FROM public.team_members
   WHERE auth_id = auth.uid()
   LIMIT 1;

  -- 1. Re-point call_log
  UPDATE public.call_log
     SET customer_id   = p_survivor_id,
         customer_name = v_survivor.name
   WHERE customer_id = p_dup_id;
  GET DIAGNOSTICS v_jobs_moved = ROW_COUNT;

  -- 2. Demote dup's primary contact if survivor already has one
  IF EXISTS (
    SELECT 1 FROM public.customer_contacts
     WHERE customer_id = p_survivor_id AND is_primary = true
  ) THEN
    UPDATE public.customer_contacts
       SET is_primary = false
     WHERE customer_id = p_dup_id AND is_primary = true;
  END IF;
  UPDATE public.customer_contacts
     SET customer_id = p_survivor_id
   WHERE customer_id = p_dup_id;
  GET DIAGNOSTICS v_contacts_moved = ROW_COUNT;

  -- 3. Pay-app templates: demote-default (additive, not destructive)
  IF EXISTS (
    SELECT 1 FROM public.customer_pay_app_templates
     WHERE customer_id = p_survivor_id
       AND scope = 'customer'
       AND is_default = true
  ) THEN
    UPDATE public.customer_pay_app_templates
       SET is_default = false
     WHERE customer_id = p_dup_id
       AND scope = 'customer'
       AND is_default = true;
  END IF;
  UPDATE public.customer_pay_app_templates
     SET customer_id = p_survivor_id
   WHERE customer_id = p_dup_id;
  GET DIAGNOSTICS v_templates_moved = ROW_COUNT;

  -- 3b. Re-point proposals (B19 fix)
  UPDATE public.proposals
     SET customer_id = p_survivor_id
   WHERE customer_id = p_dup_id;
  GET DIAGNOSTICS v_proposals_moved = ROW_COUNT;

  -- 4. qb_customer_id backfill
  IF v_survivor.qb_customer_id IS NULL AND v_dup.qb_customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET qb_customer_id = v_dup.qb_customer_id
     WHERE id = p_survivor_id;
    v_qb_copied := true;
  END IF;

  -- 5. Audit (now includes proposals_moved)
  INSERT INTO public.customer_merges (
    duplicate_id, duplicate_name,
    survivor_id, survivor_name_snapshot,
    jobs_moved, contacts_moved, pay_app_templates_moved, proposals_moved,
    qb_customer_id_copied, performed_by, tenant_id
  ) VALUES (
    p_dup_id, v_dup.name,
    p_survivor_id, v_survivor.name,
    v_jobs_moved, v_contacts_moved, v_templates_moved, v_proposals_moved,
    v_qb_copied, v_performed_by, v_tenant_id
  );

  -- 6. Delete the now-empty duplicate
  DELETE FROM public.customers WHERE id = p_dup_id;

  RETURN jsonb_build_object(
    'jobs_moved',              v_jobs_moved,
    'contacts_moved',          v_contacts_moved,
    'pay_app_templates_moved', v_templates_moved,
    'proposals_moved',         v_proposals_moved,
    'qb_customer_id_copied',   v_qb_copied,
    'survivor_id',             p_survivor_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_customers(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_customers(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
