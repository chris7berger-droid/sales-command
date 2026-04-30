-- Customer delete + merge.
-- Adds two SECURITY DEFINER RPCs (delete_customer, merge_customers) so the
-- multi-table re-point and authorization checks happen atomically inside one
-- transaction, plus a customer_merges audit trail. Tightens DELETE policies
-- on customers + customer_contacts to require Admin/Manager (per
-- feedback/role_gating: Sales must not delete customer-shaped data).

-- ---------------------------------------------------------------------------
-- Audit table: customer_merges
-- ---------------------------------------------------------------------------
-- duplicate_id is intentionally not an FK — the row it referenced will be
-- deleted at the end of merge_customers(), and we want the audit to survive.
-- duplicate_name is a snapshot for the same reason.
-- survivor_id is FK with ON DELETE SET NULL so audit history survives if the
-- survivor is itself later deleted/merged.

CREATE TABLE IF NOT EXISTS public.customer_merges (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_id             uuid NOT NULL,
  duplicate_name           text NOT NULL,
  survivor_id              uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  survivor_name_snapshot   text NOT NULL,
  jobs_moved               int  NOT NULL DEFAULT 0,
  contacts_moved           int  NOT NULL DEFAULT 0,
  pay_app_templates_moved  int  NOT NULL DEFAULT 0,
  qb_customer_id_copied    boolean NOT NULL DEFAULT false,
  performed_by             uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  performed_at             timestamptz NOT NULL DEFAULT now(),
  tenant_id                uuid NOT NULL DEFAULT public.get_user_tenant_id()
                                REFERENCES public.tenant_config(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_merges_tenant_id
  ON public.customer_merges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_merges_survivor_id
  ON public.customer_merges(survivor_id);

ALTER TABLE public.customer_merges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_merges_select ON public.customer_merges;
CREATE POLICY customer_merges_select ON public.customer_merges
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS customer_merges_insert ON public.customer_merges;
CREATE POLICY customer_merges_insert ON public.customer_merges
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS customer_merges_update ON public.customer_merges;
CREATE POLICY customer_merges_update ON public.customer_merges
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS customer_merges_delete ON public.customer_merges;
CREATE POLICY customer_merges_delete ON public.customer_merges
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

-- ---------------------------------------------------------------------------
-- Tighten DELETE policies: customers, customer_contacts
-- ---------------------------------------------------------------------------
-- Sales must not delete customer-shaped data via the anon key. RPCs below
-- are SECURITY DEFINER so they bypass these policies; this is the public
-- surface. customer_pay_app_templates already requires Admin/Manager
-- (see 20260417140000_pay_apps.sql).

DROP POLICY IF EXISTS "customers_delete" ON public.customers;
CREATE POLICY "customers_delete" ON public.customers
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS "customer_contacts_delete" ON public.customer_contacts;
CREATE POLICY "customer_contacts_delete" ON public.customer_contacts
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

-- ---------------------------------------------------------------------------
-- delete_customer(p_customer_id uuid) -> jsonb
-- ---------------------------------------------------------------------------
-- Refuses if the customer has any FK children (jobs, contacts, pay-app
-- templates). Counts are computed inside the same transaction as the delete
-- so a sales rep can't slip a job in between the count and the delete.
-- RAISE 'HAS_CHILDREN' carries a JSON detail with the per-table counts so
-- the UI can show a precise message.

CREATE OR REPLACE FUNCTION public.delete_customer(p_customer_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_customer   public.customers%ROWTYPE;
  v_jobs       int;
  v_contacts   int;
  v_templates  int;
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'NO_TENANT';
  END IF;

  SELECT * INTO v_customer
    FROM public.customers
   WHERE id = p_customer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF v_customer.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  SELECT count(*) INTO v_jobs
    FROM public.call_log
   WHERE customer_id = p_customer_id;
  SELECT count(*) INTO v_contacts
    FROM public.customer_contacts
   WHERE customer_id = p_customer_id;
  SELECT count(*) INTO v_templates
    FROM public.customer_pay_app_templates
   WHERE customer_id = p_customer_id;

  IF v_jobs > 0 OR v_contacts > 0 OR v_templates > 0 THEN
    RAISE EXCEPTION 'HAS_CHILDREN'
      USING DETAIL = jsonb_build_object(
        'jobs', v_jobs,
        'contacts', v_contacts,
        'pay_app_templates', v_templates
      )::text;
  END IF;

  DELETE FROM public.customers WHERE id = p_customer_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_customer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_customer(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- merge_customers(p_dup_id uuid, p_survivor_id uuid) -> jsonb
-- ---------------------------------------------------------------------------
-- Re-points all FK children from duplicate -> survivor, then deletes the
-- now-empty duplicate. All steps run in one implicit transaction; partial
-- failure rolls back.
--
-- Edge cases handled:
--   * Same id passed twice                  -> SAME_CUSTOMER
--   * Either side missing or wrong tenant   -> NOT_FOUND_* / TENANT_MISMATCH
--   * Both sides have a primary contact     -> dup primaries demoted before move
--   * Both have a default customer template -> dup default demoted before move
--   * Survivor has no qb_customer_id, dup does -> copy onto survivor (track
--                                                  qb_customer_id_copied=true)
--   * Both have qb_customer_id              -> survivor wins; dup's record is
--                                              left dangling in QB for manual
--                                              cleanup (we never call QB).
--   * Duplicate contacts (same email/phone) -> NOT auto-deduped; we move
--                                              everything and let the user
--                                              clean up afterward. Heuristic
--                                              dedupe misfires too easily
--                                              (e.g., parent vs. child sharing
--                                              a phone number).

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

  -- Lock both rows in a deterministic order to avoid deadlocks if two
  -- sessions ever try to merge (a, b) and (b, a) at the same time.
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

  -- 1. Re-point jobs and refresh the customer_name snapshot on call_log.
  --    display_job_number is intentionally untouched.
  UPDATE public.call_log
     SET customer_id   = p_survivor_id,
         customer_name = v_survivor.name
   WHERE customer_id = p_dup_id;
  GET DIAGNOSTICS v_jobs_moved = ROW_COUNT;

  -- 2. Demote duplicate's primary contacts if survivor already has a primary.
  --    One primary per customer (UI-enforced today, preserved here).
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

  -- 3. Demote duplicate's default customer-scope template if survivor
  --    already has one. One default per customer (per the constraint
  --    pattern in 20260417140000_pay_apps.sql).
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

  -- 6. Delete the now-empty duplicate. By this point no FK children
  --    reference it, so the cascade on customer_contacts /
  --    customer_pay_app_templates is a no-op, and call_log's NO ACTION FK
  --    has nothing to block on.
  DELETE FROM public.customers WHERE id = p_dup_id;

  RETURN jsonb_build_object(
    'jobs_moved',              v_jobs_moved,
    'contacts_moved',          v_contacts_moved,
    'pay_app_templates_moved', v_templates_moved,
    'qb_customer_id_copied',   v_qb_copied,
    'survivor_id',             p_survivor_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_customers(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_customers(uuid, uuid) TO authenticated;
