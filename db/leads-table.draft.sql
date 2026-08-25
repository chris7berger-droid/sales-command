-- DRAFT — Leads table for the marketing-lead receiver (leads-inbox feature).
--
-- ⚠️ NOT LIVE. This is authored here on the parked branch so it can't collide with
--    other in-flight work. Before it goes live it must be moved into command-suite-db
--    and rehearsed from a prod-shaped throwaway (scripts/rehearse.sh) per standing rule.
--
-- Purpose: one row per lead pushed in by the marketing company's bot webhook
-- (see docs/plans/PARTNER-leads-intake-spec.md). The leads-intake edge function
-- inserts with the service role; the Sales Command screen reads + updates status.
--
-- Style copied from 20260811120100_home_followup_outreach_log.sql.

BEGIN;

-- Bolt-on switch: leads is a paid add-on, OFF for every customer by default.
-- Only a customer with this flipped true sees the inbox screen or accepts webhook
-- leads. Sold/enabled per customer; never ships on by default to new customers.
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS leads_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenant_config(id),
  -- partner's stable id from their side; dedupe anchor (see UNIQUE below)
  lead_id      text NOT NULL,
  channel      text CHECK (channel IN ('facebook', 'google', 'twilio', 'other')),
  received_at  timestamptz NOT NULL,
  name         text,
  phone        text,
  email        text,
  campaign     text,
  ad_id        text,
  message      text,
  raw          jsonb,
  -- triage state, driven by the inbox screen
  status       text NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'contacted', 'qualified', 'junk', 'converted')),
  -- set when a lead is converted into a real call_log inquiry (integer PK, per prod)
  call_log_id  integer REFERENCES public.call_log(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Dedupe anchor: a retry with the same partner lead_id is a no-op, not a 2nd row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_leadid
  ON public.leads(tenant_id, lead_id);

-- Inbox worklist reads: newest-first within tenant, and by status.
CREATE INDEX IF NOT EXISTS idx_leads_tenant_received
  ON public.leads(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status
  ON public.leads(tenant_id, status);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT + UPDATE for signed-in staff, tenant-scoped. INSERT is done by the
-- webhook via the service role (bypasses RLS), so no INSERT policy for app users.
-- DELETE omitted — junk leads get status='junk', not hard-deleted.
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS leads_update ON public.leads;
CREATE POLICY leads_update ON public.leads
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

NOTIFY pgrst, 'reload schema';

COMMIT;
