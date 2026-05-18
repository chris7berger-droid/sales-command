-- ============================================================
-- proposal_wtc: add SELECT branch gated by x-viewing-token
--
-- Context: invoice_lines already has invoice_lines_public_read_token
-- which lets anon read lines when carrying a valid x-viewing-token.
-- proposal_wtc only had proposal_wtc_public_read_token (signing path),
-- so the public invoice page's `invoice_lines(*, proposal_wtc(...))`
-- join silently returned null. Customers saw "—" in Description and
-- $0.00 in Amount.
--
-- This migration ADDS a second policy (signing branch stays untouched).
-- Multiple policies on the same table+role are OR'd together by
-- PostgreSQL, so the signing-time read path is unaffected.
-- ============================================================

DROP POLICY IF EXISTS "proposal_wtc_public_view_token" ON public.proposal_wtc;

CREATE POLICY "proposal_wtc_public_view_token" ON public.proposal_wtc
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.invoice_lines l ON l.invoice_id::text = i.id::text
      WHERE l.proposal_wtc_id = proposal_wtc.id
        AND i.viewing_token IS NOT NULL
        AND i.viewing_token::text = public.request_viewing_token()
    )
  );

-- Reload PostgREST schema cache so the new policy applies immediately.
NOTIFY pgrst, 'reload schema';
