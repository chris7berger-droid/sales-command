-- Role-aware RLS for money tables.
-- Closes the gap surfaced in the 2026-04-16 audit: tenant-only RLS lets a
-- Sales user mutate billing schedules / line items / materials catalog via
-- direct API calls. Per the standing rule (memory/feedback_role_gating.md),
-- Sales uploads documents only; Admin/Manager configure money.
--
-- Strategy:
--   * billing_schedule  — INSERT/DELETE require Admin/Manager.
--                         UPDATE stays open to tenant so Sales can attach
--                         contract PDFs (the only column they legitimately
--                         touch), but a BEFORE UPDATE trigger blocks changes
--                         to money/status columns for non-managers.
--   * billing_schedule_lines — all writes require Admin/Manager.
--   * materials_catalog       — all writes require Admin/Manager.
--   * SELECT policies are unchanged everywhere.

-- ---------------------------------------------------------------------------
-- Helper: is_admin_or_manager()
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the team_members lookup bypasses RLS on team_members
-- itself (the caller may not have a SELECT policy that returns their own
-- row in every context). search_path locked to public to prevent shadowing.

CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.team_members
     WHERE auth_id = auth.uid()
       AND role IN ('Admin', 'Manager')
       AND active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_or_manager() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin_or_manager() TO authenticated;

-- ---------------------------------------------------------------------------
-- billing_schedule
-- ---------------------------------------------------------------------------
-- INSERT and DELETE: Admin/Manager only.
-- UPDATE: still tenant-scoped (so Sales can attach PDFs), but the trigger
-- below blocks money-column changes for non-managers.

DROP POLICY IF EXISTS billing_schedule_insert ON public.billing_schedule;
CREATE POLICY billing_schedule_insert ON public.billing_schedule
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS billing_schedule_delete ON public.billing_schedule;
CREATE POLICY billing_schedule_delete ON public.billing_schedule
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

-- billing_schedule_update policy stays as-is (tenant only) so Sales can
-- attach PDFs. Column-level enforcement happens in the trigger below.

CREATE OR REPLACE FUNCTION public.billing_schedule_guard_money_cols()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  -- Allow if caller is admin/manager
  IF public.is_admin_or_manager() THEN
    RETURN NEW;
  END IF;

  -- Otherwise block changes to money/status columns
  IF NEW.contract_sum   IS DISTINCT FROM OLD.contract_sum
   OR NEW.retainage_pct IS DISTINCT FROM OLD.retainage_pct
   OR NEW.status        IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'Only Admin/Manager can change contract_sum, retainage_pct, or status on billing_schedule'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_schedule_guard_money ON public.billing_schedule;
CREATE TRIGGER trg_billing_schedule_guard_money
  BEFORE UPDATE ON public.billing_schedule
  FOR EACH ROW EXECUTE FUNCTION public.billing_schedule_guard_money_cols();

-- ---------------------------------------------------------------------------
-- billing_schedule_lines  (the actual SOV money rows)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS billing_schedule_lines_insert ON public.billing_schedule_lines;
CREATE POLICY billing_schedule_lines_insert ON public.billing_schedule_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS billing_schedule_lines_update ON public.billing_schedule_lines;
CREATE POLICY billing_schedule_lines_update ON public.billing_schedule_lines
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS billing_schedule_lines_delete ON public.billing_schedule_lines;
CREATE POLICY billing_schedule_lines_delete ON public.billing_schedule_lines
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

-- ---------------------------------------------------------------------------
-- materials_catalog  (per-tenant pricing — Sales can never write)
-- ---------------------------------------------------------------------------
-- SELECT policy intentionally unchanged: system rows (tenant_id IS NULL)
-- stay readable to all authenticated users; tenant rows readable to that
-- tenant. Writes require Admin/Manager AND tenant_id match (system rows
-- remain non-writable from the app).

DROP POLICY IF EXISTS materials_catalog_insert ON public.materials_catalog;
CREATE POLICY materials_catalog_insert ON public.materials_catalog
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS materials_catalog_update ON public.materials_catalog;
CREATE POLICY materials_catalog_update ON public.materials_catalog
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS materials_catalog_delete ON public.materials_catalog;
CREATE POLICY materials_catalog_delete ON public.materials_catalog
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );
