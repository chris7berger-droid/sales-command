-- Billing Schedule (SOV / G702-G703) + archive record links.
-- Phase 1 of the Customer Billing Schedule plan: data model only, no UI.
-- See: memory/project_customer_billing_schedule.md

-- ---------------------------------------------------------------------------
-- Archive provenance links
-- ---------------------------------------------------------------------------
-- When a History Locker record is imported into live DB as a new call_log +
-- skeleton proposal, archive_record_id preserves the link back to the
-- source archive.legacy_records row (uuid).

ALTER TABLE public.call_log
  ADD COLUMN IF NOT EXISTS archive_record_id uuid
    REFERENCES archive.legacy_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_call_log_archive_record_id
  ON public.call_log(archive_record_id);

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS archive_record_id uuid
    REFERENCES archive.legacy_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proposals_archive_record_id
  ON public.proposals(archive_record_id);

-- ---------------------------------------------------------------------------
-- Billing schedule (per proposal, 1:1) — the customer's Schedule of Values
-- ---------------------------------------------------------------------------
-- Exists only when the customer contract defines its own SOV framework.
-- When present, invoicing bills % per billing_schedule_line instead of
-- % per proposal_wtc.

CREATE TABLE IF NOT EXISTS public.billing_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id text NOT NULL UNIQUE
    REFERENCES public.proposals(id) ON DELETE CASCADE,
  contract_sum numeric NOT NULL DEFAULT 0,
  retainage_pct numeric NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'draft',   -- 'draft' | 'active' | 'locked'
  contract_pdf_url text,
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id()
    REFERENCES public.tenant_config(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_schedule_proposal_id
  ON public.billing_schedule(proposal_id);

CREATE INDEX IF NOT EXISTS idx_billing_schedule_tenant_id
  ON public.billing_schedule(tenant_id);

DROP TRIGGER IF EXISTS trg_billing_schedule_updated_at ON public.billing_schedule;
CREATE TRIGGER trg_billing_schedule_updated_at
  BEFORE UPDATE ON public.billing_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.billing_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_schedule_select ON public.billing_schedule;
CREATE POLICY billing_schedule_select ON public.billing_schedule
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS billing_schedule_insert ON public.billing_schedule;
CREATE POLICY billing_schedule_insert ON public.billing_schedule
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS billing_schedule_update ON public.billing_schedule;
CREATE POLICY billing_schedule_update ON public.billing_schedule
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS billing_schedule_delete ON public.billing_schedule;
CREATE POLICY billing_schedule_delete ON public.billing_schedule
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- ---------------------------------------------------------------------------
-- Billing schedule lines (G703 continuation sheet rows)
-- ---------------------------------------------------------------------------
-- Each row = one SOV line item from the customer's contract.
-- Change-order lines are appended here with is_change_order=true + co_number.

CREATE TABLE IF NOT EXISTS public.billing_schedule_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_schedule_id uuid NOT NULL
    REFERENCES public.billing_schedule(id) ON DELETE CASCADE,
  line_code text,                          -- customer's identifier (e.g. "A.1")
  description text NOT NULL,
  scheduled_value numeric NOT NULL DEFAULT 0,
  is_change_order boolean NOT NULL DEFAULT false,
  co_number integer,
  ordinal integer NOT NULL DEFAULT 0,
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id()
    REFERENCES public.tenant_config(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_schedule_lines_schedule_id
  ON public.billing_schedule_lines(billing_schedule_id);

CREATE INDEX IF NOT EXISTS idx_billing_schedule_lines_tenant_id
  ON public.billing_schedule_lines(tenant_id);

DROP TRIGGER IF EXISTS trg_billing_schedule_lines_updated_at ON public.billing_schedule_lines;
CREATE TRIGGER trg_billing_schedule_lines_updated_at
  BEFORE UPDATE ON public.billing_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.billing_schedule_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_schedule_lines_select ON public.billing_schedule_lines;
CREATE POLICY billing_schedule_lines_select ON public.billing_schedule_lines
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS billing_schedule_lines_insert ON public.billing_schedule_lines;
CREATE POLICY billing_schedule_lines_insert ON public.billing_schedule_lines
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS billing_schedule_lines_update ON public.billing_schedule_lines;
CREATE POLICY billing_schedule_lines_update ON public.billing_schedule_lines
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS billing_schedule_lines_delete ON public.billing_schedule_lines;
CREATE POLICY billing_schedule_lines_delete ON public.billing_schedule_lines
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- ---------------------------------------------------------------------------
-- Invoice lines: allow SOV billing alongside existing WTC billing
-- ---------------------------------------------------------------------------
-- Existing proposal_wtc_id path stays intact. A line must reference exactly
-- one of (proposal_wtc_id, billing_schedule_line_id) — enforced by the app,
-- not the DB (to avoid forcing a migration on historical rows).

ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS billing_schedule_line_id uuid
    REFERENCES public.billing_schedule_lines(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_lines
  ALTER COLUMN proposal_wtc_id DROP NOT NULL;

-- Free-form description on the line (required for SOV billing, since period
-- notes like "Work completed this period" are customary on G703 rows).
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS idx_invoice_lines_billing_schedule_line_id
  ON public.invoice_lines(billing_schedule_line_id);

-- ---------------------------------------------------------------------------
-- Retainage on invoices (G702 cover-sheet concept)
-- ---------------------------------------------------------------------------
-- retainage_pct: % withheld from this invoice (snapshot from billing_schedule
--   at invoice creation so historical invoices stay correct even if the
--   schedule's retainage_pct changes later).
-- retainage_amount: computed amount withheld (dollars).
-- retainage_released: flips true when a final/release invoice pays it out.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS retainage_pct numeric DEFAULT 0;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS retainage_amount numeric DEFAULT 0;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS retainage_released boolean DEFAULT false;
