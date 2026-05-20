-- B19: merge_customers must repoint proposals.customer_id before deleting
-- the duplicate, otherwise ON DELETE SET NULL silently nulls sister lineage.
CREATE OR REPLACE FUNCTION public.merge_customers(p_dup_id uuid, p_survivor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dup        public.customers;
  v_survivor   public.customers;
  v_jobs_moved        int;
  v_contacts_moved    int;
  v_templates_moved   int;
  v_proposals_moved   int;
  v_qb_copied         boolean := false;
  v_performed_by      uuid;
  v_tenant_id         uuid;
BEGIN
  -- Auth
  v_performed_by := auth.uid();
  IF v_performed_by IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Same-id guard
  IF p_dup_id = p_survivor_id THEN
    RAISE EXCEPTION 'Cannot merge a customer with itself';
  END IF;

  -- Lock rows in consistent order to prevent deadlocks
  IF p_dup_id < p_survivor_id THEN
    SELECT * INTO v_dup      FROM public.customers WHERE id = p_dup_id      FOR UPDATE;
    SELECT * INTO v_survivor FROM public.customers WHERE id = p_survivor_id FOR UPDATE;
  ELSE
    SELECT * INTO v_survivor FROM public.customers WHERE id = p_survivor_id FOR UPDATE;
    SELECT * INTO v_dup      FROM public.customers WHERE id = p_dup_id      FOR UPDATE;
  END IF;

  IF v_dup IS NULL THEN
    RAISE EXCEPTION 'Duplicate customer not found';
  END IF;
  IF v_survivor IS NULL THEN
    RAISE EXCEPTION 'Survivor customer not found';
  END IF;

  -- Tenant check
  v_tenant_id := v_survivor.tenant_id;
  IF v_dup.tenant_id IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'Cannot merge customers from different tenants';
  END IF;

  -- 1. Re-point call_log
  UPDATE public.call_log
     SET customer_id   = p_survivor_id,
         customer_name = v_survivor.name
   WHERE customer_id = p_dup_id;
  GET DIAGNOSTICS v_jobs_moved = ROW_COUNT;

  -- 2. Re-point contacts (keep survivor's primary, demote dup's)
  UPDATE public.customer_contacts
     SET is_primary = false
     WHERE customer_id = p_survivor_id AND is_primary = true
       AND EXISTS (
         SELECT 1 FROM public.customer_contacts
         WHERE customer_id = p_dup_id AND is_primary = true
       );
  UPDATE public.customer_contacts
     SET customer_id = p_survivor_id
   WHERE customer_id = p_dup_id;
  GET DIAGNOSTICS v_contacts_moved = ROW_COUNT;

  -- 3. Re-point pay app templates
  IF EXISTS (
    SELECT 1 FROM public.customer_pay_app_templates
    WHERE customer_id = p_survivor_id
  ) THEN
    DELETE FROM public.customer_pay_app_templates
    WHERE customer_id = p_dup_id
      AND template_name IN (
        SELECT template_name FROM public.customer_pay_app_templates
        WHERE customer_id = p_survivor_id
      );
  END IF;

  UPDATE public.customer_pay_app_templates
     SET customer_id = p_survivor_id
   WHERE customer_id = p_dup_id;
  GET DIAGNOSTICS v_templates_moved = ROW_COUNT;

  -- 3b. Re-point proposals (B19 fix — prevents ON DELETE SET NULL from
  --     silently nulling sister proposal lineage)
  UPDATE public.proposals
     SET customer_id = p_survivor_id
   WHERE customer_id = p_dup_id;
  GET DIAGNOSTICS v_proposals_moved = ROW_COUNT;

  -- 4. qb_customer_id backfill (read-only against QB itself — no API call).
  IF v_survivor.qb_customer_id IS NULL AND v_dup.qb_customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET qb_customer_id = v_dup.qb_customer_id
     WHERE id = p_survivor_id;
    v_qb_copied := true;
  END IF;

  -- 5. Audit
  INSERT INTO public.customer_merges (
    duplicate_id, duplicate_name,
    survivor_id, survivor_name_snapshot,
    jobs_moved, contacts_moved, pay_app_templates_moved,
    qb_customer_id_copied, performed_by, tenant_id
  ) VALUES (
    p_dup_id, v_dup.name,
    p_survivor_id, v_survivor.name,
    v_jobs_moved, v_contacts_moved, v_templates_moved,
    v_qb_copied, v_performed_by, v_tenant_id
  );

  -- 6. Delete the now-empty duplicate.
  DELETE FROM public.customers WHERE id = p_dup_id;

  RETURN jsonb_build_object(
    'duplicate_id',    p_dup_id,
    'survivor_id',     p_survivor_id,
    'jobs_moved',      v_jobs_moved,
    'contacts_moved',  v_contacts_moved,
    'templates_moved', v_templates_moved,
    'proposals_moved', v_proposals_moved,
    'qb_copied',       v_qb_copied
  );
END;
$$;
