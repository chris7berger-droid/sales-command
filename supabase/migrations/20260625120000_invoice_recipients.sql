-- Invoice Recipients (main + viewers).
-- Mirror of proposal_recipients for the invoice send flow. Lets an invoice be
-- sent to multiple people where exactly one is the `main` recipient (gets the
-- Stripe pay link) and the rest are `viewer`s (view-only email, no pay link).
-- See: docs/plans/invoice_recipients.md §4.1
--
-- RLS: standard 4-policy tenant pattern (authenticated, tenant-scoped). No anon
-- policy — the public invoice page (PublicInvoicePage) never queries this table.
-- tenant_id DEFAULT get_user_tenant_id() matches sql/rls_child_tables.sql.

CREATE TABLE IF NOT EXISTS public.invoice_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id text NOT NULL
    REFERENCES public.invoices(id) ON DELETE CASCADE,
  contact_name text,
  contact_email text,
  phone text,
  role text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('main', 'viewer')),
  sent_at timestamptz,
  viewed_at timestamptz,            -- parity with proposal_recipients; tracking NOT wired this pass (plan §6)
  customer_contact_id uuid
    REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id()
    REFERENCES public.tenant_config(id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_recipients_invoice_id
  ON public.invoice_recipients(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_recipients_tenant_id
  ON public.invoice_recipients(tenant_id);

ALTER TABLE public.invoice_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_recipients_select ON public.invoice_recipients;
CREATE POLICY invoice_recipients_select ON public.invoice_recipients
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS invoice_recipients_insert ON public.invoice_recipients;
CREATE POLICY invoice_recipients_insert ON public.invoice_recipients
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS invoice_recipients_update ON public.invoice_recipients;
CREATE POLICY invoice_recipients_update ON public.invoice_recipients
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS invoice_recipients_delete ON public.invoice_recipients;
CREATE POLICY invoice_recipients_delete ON public.invoice_recipients
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());
