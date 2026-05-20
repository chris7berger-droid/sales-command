-- B13: Add viewing_token_expires_at to invoices for time-limited public access.
-- Mirrors H5 signing_token_expires_at pattern on proposals.

BEGIN;

-- 1. Add column
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS viewing_token_expires_at timestamptz;

-- 2. Backfill existing invoices: expire = COALESCE(sent_at, created_at) + 90 days
UPDATE public.invoices
   SET viewing_token_expires_at = COALESCE(sent_at, created_at) + interval '90 days'
 WHERE viewing_token IS NOT NULL
   AND viewing_token_expires_at IS NULL;

-- 3. Auto-fill trigger for new invoices
CREATE OR REPLACE FUNCTION public.trg_invoices_set_viewing_token_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.viewing_token IS NOT NULL AND NEW.viewing_token_expires_at IS NULL THEN
    NEW.viewing_token_expires_at := now() + interval '90 days';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_viewing_token_expiry ON public.invoices;
CREATE TRIGGER trg_invoices_viewing_token_expiry
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_invoices_set_viewing_token_expiry();

-- 4. Update RLS policies to include expiry check

-- 4a. invoices_public_view_token
DROP POLICY IF EXISTS "invoices_public_view_token" ON public.invoices;
CREATE POLICY "invoices_public_view_token" ON public.invoices
  FOR SELECT TO anon
  USING (
    viewing_token IS NOT NULL
    AND viewing_token::text = public.request_viewing_token()
    AND viewing_token_expires_at IS NOT NULL
    AND viewing_token_expires_at > now()
  );

-- 4b. invoice_lines_public_read_token
DROP POLICY IF EXISTS "invoice_lines_public_read_token" ON public.invoice_lines;
CREATE POLICY "invoice_lines_public_read_token" ON public.invoice_lines
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
       WHERE i.id = invoice_id
         AND i.viewing_token IS NOT NULL
         AND i.viewing_token::text = public.request_viewing_token()
         AND i.viewing_token_expires_at IS NOT NULL
         AND i.viewing_token_expires_at > now()
    )
  );

-- 4c. proposals_public_view_token (joins through invoices)
DROP POLICY IF EXISTS "proposals_public_view_token" ON public.proposals;
CREATE POLICY "proposals_public_view_token" ON public.proposals
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
       WHERE i.proposal_id = id::text
         AND i.viewing_token IS NOT NULL
         AND i.viewing_token::text = public.request_viewing_token()
         AND i.viewing_token_expires_at IS NOT NULL
         AND i.viewing_token_expires_at > now()
    )
  );

-- 4d. call_log_public_view_token (joins through invoices)
DROP POLICY IF EXISTS "call_log_public_view_token" ON public.call_log;
CREATE POLICY "call_log_public_view_token" ON public.call_log
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
       WHERE i.call_log_id = id
         AND i.viewing_token IS NOT NULL
         AND i.viewing_token::text = public.request_viewing_token()
         AND i.viewing_token_expires_at IS NOT NULL
         AND i.viewing_token_expires_at > now()
    )
  );

-- 4e. customers_public_read_token viewing branch (joins through invoices -> call_log)
DROP POLICY IF EXISTS "customers_public_read_token" ON public.customers;
CREATE POLICY "customers_public_read_token" ON public.customers
  FOR SELECT TO anon
  USING (
    -- Signing token path (proposals)
    EXISTS (
      SELECT 1 FROM public.proposals p
       WHERE p.call_log_id IN (SELECT cl.id FROM public.call_log cl WHERE cl.customer_id = customers.id)
         AND p.signing_token IS NOT NULL
         AND p.signing_token::text = public.request_signing_token()
         AND p.signing_token_expires_at IS NOT NULL
         AND p.signing_token_expires_at > now()
    )
    OR
    -- Viewing token path (invoices)
    EXISTS (
      SELECT 1 FROM public.invoices i
        JOIN public.call_log cl ON cl.id = i.call_log_id
       WHERE cl.customer_id = customers.id
         AND i.viewing_token IS NOT NULL
         AND i.viewing_token::text = public.request_viewing_token()
         AND i.viewing_token_expires_at IS NOT NULL
         AND i.viewing_token_expires_at > now()
    )
  );

-- 4f. proposal_wtc_public_view_token (joins through invoices)
DROP POLICY IF EXISTS "proposal_wtc_public_view_token" ON public.proposal_wtc;
CREATE POLICY "proposal_wtc_public_view_token" ON public.proposal_wtc
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
       WHERE i.proposal_id = proposal_id::text
         AND i.viewing_token IS NOT NULL
         AND i.viewing_token::text = public.request_viewing_token()
         AND i.viewing_token_expires_at IS NOT NULL
         AND i.viewing_token_expires_at > now()
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
