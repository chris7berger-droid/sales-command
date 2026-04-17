-- Pay Apps: G702/G703-style submissions against a billing_schedule.
--
-- Per v76 Phase 3 plan. A pay app is a per-period billing of a subset of
-- each SOV line's scheduled value. Each pay app produces (a) a PDF matching
-- the customer's template and (b) an SC invoice for (this-app $ − retainage)
-- so the money lands somewhere trackable.
--
-- Tables created here:
--   public.billing_schedule_pay_apps       — one row per pay app submission
--   public.billing_schedule_pay_app_lines  — per-SOV-line breakdown
--   public.customer_pay_app_templates      — per-customer template storage
--
-- Writes on all three are gated to Admin/Manager via is_admin_or_manager()
-- (per feedback_role_gating.md — Sales uploads docs only).

-- ---------------------------------------------------------------------------
-- billing_schedule_pay_apps
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.billing_schedule_pay_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_schedule_id uuid NOT NULL
    REFERENCES public.billing_schedule(id) ON DELETE CASCADE,
  app_number int NOT NULL,
  period_from date,
  period_to date,
  type_of_work text,
  -- Snapshot of contract sum + retainage % at submission time so historical
  -- pay apps stay correct if the schedule changes later.
  contract_sum_snapshot numeric NOT NULL DEFAULT 0,
  retainage_pct_snapshot numeric NOT NULL DEFAULT 0,
  -- Aggregated totals for quick reads (also derivable from lines).
  this_app_amount numeric NOT NULL DEFAULT 0,
  retainage_withheld numeric NOT NULL DEFAULT 0,
  current_payment_due numeric NOT NULL DEFAULT 0,
  pdf_url text,
  invoice_id text REFERENCES public.invoices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',   -- 'draft' | 'submitted' | 'paid'
  submitted_at timestamptz,
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id()
    REFERENCES public.tenant_config(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (billing_schedule_id, app_number)
);

CREATE INDEX IF NOT EXISTS idx_pay_apps_schedule_id
  ON public.billing_schedule_pay_apps(billing_schedule_id);
CREATE INDEX IF NOT EXISTS idx_pay_apps_tenant_id
  ON public.billing_schedule_pay_apps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pay_apps_invoice_id
  ON public.billing_schedule_pay_apps(invoice_id);

DROP TRIGGER IF EXISTS trg_pay_apps_updated_at ON public.billing_schedule_pay_apps;
CREATE TRIGGER trg_pay_apps_updated_at
  BEFORE UPDATE ON public.billing_schedule_pay_apps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.billing_schedule_pay_apps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pay_apps_select ON public.billing_schedule_pay_apps;
CREATE POLICY pay_apps_select ON public.billing_schedule_pay_apps
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS pay_apps_insert ON public.billing_schedule_pay_apps;
CREATE POLICY pay_apps_insert ON public.billing_schedule_pay_apps
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS pay_apps_update ON public.billing_schedule_pay_apps;
CREATE POLICY pay_apps_update ON public.billing_schedule_pay_apps
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS pay_apps_delete ON public.billing_schedule_pay_apps;
CREATE POLICY pay_apps_delete ON public.billing_schedule_pay_apps
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

-- ---------------------------------------------------------------------------
-- billing_schedule_pay_app_lines
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.billing_schedule_pay_app_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_app_id uuid NOT NULL
    REFERENCES public.billing_schedule_pay_apps(id) ON DELETE CASCADE,
  billing_schedule_line_id uuid NOT NULL
    REFERENCES public.billing_schedule_lines(id) ON DELETE CASCADE,
  scheduled_value_snapshot numeric NOT NULL DEFAULT 0,
  billed_pct_this_app numeric NOT NULL DEFAULT 0,      -- 0-100
  billed_amount_this_app numeric NOT NULL DEFAULT 0,
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id()
    REFERENCES public.tenant_config(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pay_app_id, billing_schedule_line_id)
);

CREATE INDEX IF NOT EXISTS idx_pay_app_lines_pay_app_id
  ON public.billing_schedule_pay_app_lines(pay_app_id);
CREATE INDEX IF NOT EXISTS idx_pay_app_lines_sov_line_id
  ON public.billing_schedule_pay_app_lines(billing_schedule_line_id);
CREATE INDEX IF NOT EXISTS idx_pay_app_lines_tenant_id
  ON public.billing_schedule_pay_app_lines(tenant_id);

ALTER TABLE public.billing_schedule_pay_app_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pay_app_lines_select ON public.billing_schedule_pay_app_lines;
CREATE POLICY pay_app_lines_select ON public.billing_schedule_pay_app_lines
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS pay_app_lines_insert ON public.billing_schedule_pay_app_lines;
CREATE POLICY pay_app_lines_insert ON public.billing_schedule_pay_app_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS pay_app_lines_update ON public.billing_schedule_pay_app_lines;
CREATE POLICY pay_app_lines_update ON public.billing_schedule_pay_app_lines
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS pay_app_lines_delete ON public.billing_schedule_pay_app_lines;
CREATE POLICY pay_app_lines_delete ON public.billing_schedule_pay_app_lines
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

-- ---------------------------------------------------------------------------
-- customer_pay_app_templates
-- ---------------------------------------------------------------------------
-- scope = 'customer' — the master blank template for this customer; we fill
--                     every field (header, contract summary, pay app fields).
-- scope = 'job'      — per-proposal template already project-customized; we
--                     only fill the per-pay-app fields (invoice #, period,
--                     amounts, signature). DA Builders works this way.

CREATE TABLE IF NOT EXISTS public.customer_pay_app_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL
    REFERENCES public.customers(id) ON DELETE CASCADE,
  proposal_id text
    REFERENCES public.proposals(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('customer', 'job')),
  label text,                              -- human-friendly name
  pdf_url text NOT NULL,
  is_fillable boolean NOT NULL DEFAULT false,
  field_mapping jsonb,                     -- coordinate map (nullable for now)
  is_default boolean NOT NULL DEFAULT false,
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id()
    REFERENCES public.tenant_config(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- scope='job' requires proposal_id; scope='customer' forbids it.
  CHECK ((scope = 'job' AND proposal_id IS NOT NULL)
      OR (scope = 'customer' AND proposal_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_cust_pay_app_templates_customer_id
  ON public.customer_pay_app_templates(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_pay_app_templates_proposal_id
  ON public.customer_pay_app_templates(proposal_id);
CREATE INDEX IF NOT EXISTS idx_cust_pay_app_templates_tenant_id
  ON public.customer_pay_app_templates(tenant_id);

DROP TRIGGER IF EXISTS trg_cust_pay_app_templates_updated_at ON public.customer_pay_app_templates;
CREATE TRIGGER trg_cust_pay_app_templates_updated_at
  BEFORE UPDATE ON public.customer_pay_app_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.customer_pay_app_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cust_pay_app_templates_select ON public.customer_pay_app_templates;
CREATE POLICY cust_pay_app_templates_select ON public.customer_pay_app_templates
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS cust_pay_app_templates_insert ON public.customer_pay_app_templates;
CREATE POLICY cust_pay_app_templates_insert ON public.customer_pay_app_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS cust_pay_app_templates_update ON public.customer_pay_app_templates;
CREATE POLICY cust_pay_app_templates_update ON public.customer_pay_app_templates
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS cust_pay_app_templates_delete ON public.customer_pay_app_templates;
CREATE POLICY cust_pay_app_templates_delete ON public.customer_pay_app_templates
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND public.is_admin_or_manager()
  );
