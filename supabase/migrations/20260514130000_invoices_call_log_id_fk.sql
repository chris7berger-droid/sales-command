-- ============================================================
-- 20260514130000_invoices_call_log_id_fk.sql
--
-- Add invoices.call_log_id as a proper FK to call_log(id).
-- Backfill from proposals.call_log_id. Rewrite the two RLS
-- policies that mistakenly cast invoices.job_id::int = call_log.id
-- (which threw a type error and returned 400 on every public
-- invoice link, since job_id stores descriptive display strings,
-- not stringified integer PKs).
--
-- After this migration:
--   - invoices.call_log_id is the canonical FK
--     ("which call_log does this invoice belong to").
--   - invoices.job_id remains the denormalized display label
--     used by QB sync edge functions, PDF generator, invoice
--     list display, and the customers-page filter. NOT a FK.
--   - Public invoice page loads succeed for all 36 live invoices.
--
-- One-off cleanup: hard-delete invoice 09121 + proposal
-- 3273564d-9336-4fe6-8f0e-2b7638e40700. Both soft-deleted
-- 2026-05-11 21:03:* with matching timestamps. Invoice was a
-- $2.19 Stripe test charge with no QB sync; proposal never had
-- a call_log_id assigned. Orphan would otherwise block the
-- NOT NULL constraint.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Hard-delete the orphan invoice + proposal.
--    invoices → invoice_lines is ON DELETE CASCADE (1 line row).
--    proposals → proposal_wtc / proposal_recipients /
--    proposal_signatures / billing_schedule all ON DELETE CASCADE.
-- ------------------------------------------------------------
DELETE FROM public.invoices  WHERE id = '09121';
DELETE FROM public.proposals WHERE id = '3273564d-9336-4fe6-8f0e-2b7638e40700';


-- ------------------------------------------------------------
-- 2) Add the new column (nullable so we can backfill).
-- ------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN call_log_id integer;


-- ------------------------------------------------------------
-- 3) Backfill from proposals.call_log_id.
--    Every live invoice has a proposal_id (verified 2026-05-14
--    pre-migration: 36/36 resolve to a non-null call_log_id).
-- ------------------------------------------------------------
UPDATE public.invoices i
   SET call_log_id = p.call_log_id
  FROM public.proposals p
 WHERE p.id = i.proposal_id;


-- ------------------------------------------------------------
-- 4) Sanity check: abort if any row remains NULL.
-- ------------------------------------------------------------
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM public.invoices WHERE call_log_id IS NULL;
  IF c > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % rows with NULL call_log_id', c;
  END IF;
END $$;


-- ------------------------------------------------------------
-- 5) Enforce NOT NULL + FK + index.
--    FK shape mirrors proposals.call_log_id (no ON DELETE clause).
-- ------------------------------------------------------------
ALTER TABLE public.invoices
  ALTER COLUMN call_log_id SET NOT NULL,
  ADD CONSTRAINT invoices_call_log_id_fkey
    FOREIGN KEY (call_log_id) REFERENCES public.call_log(id);

CREATE INDEX IF NOT EXISTS idx_invoices_call_log_id
  ON public.invoices(call_log_id);


-- ------------------------------------------------------------
-- 6) Rewrite call_log_public_view_token to use the clean FK
--    instead of i.job_id::int = call_log.id. The cast was the
--    cause of the 400s — any non-integer job_id (all 36 rows)
--    raised a type error inside the policy predicate.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "call_log_public_view_token" ON public.call_log;
CREATE POLICY "call_log_public_view_token" ON public.call_log
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
       WHERE i.call_log_id = call_log.id
         AND i.viewing_token IS NOT NULL
         AND i.viewing_token::text = public.request_viewing_token()
    )
  );


-- ------------------------------------------------------------
-- 7) Rewrite the viewing branch of customers_public_read_token
--    the same way. Signing branch (with expiry predicates) is
--    copied verbatim from 20260510120000 — must not regress.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "customers_public_read_token" ON public.customers;
CREATE POLICY "customers_public_read_token" ON public.customers
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.call_log cl
      JOIN public.proposals p ON p.call_log_id = cl.id
      WHERE cl.customer_id = customers.id
        AND p.signing_token IS NOT NULL
        AND p.signing_token::text = public.request_signing_token()
        AND p.signing_token_expires_at IS NOT NULL
        AND p.signing_token_expires_at > now()
    )
    OR EXISTS (
      SELECT 1 FROM public.call_log cl
      JOIN public.invoices i ON i.call_log_id = cl.id
      WHERE cl.customer_id = customers.id
        AND i.viewing_token IS NOT NULL
        AND i.viewing_token::text = public.request_viewing_token()
    )
  );


-- ------------------------------------------------------------
-- 8) PostgREST schema cache reload.
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
