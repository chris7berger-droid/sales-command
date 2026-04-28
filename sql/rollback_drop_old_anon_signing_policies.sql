-- ============================================================
-- ROLLBACK for: 20260427190000_drop_old_anon_signing_policies.sql
--
-- Purpose: Recreate the original broad "signing_token IS NOT NULL"
-- anon policies if the drop migration needs to be undone.
--
-- After running this rollback, both broad and token-gated policies
-- are active simultaneously (RLS combines with OR), so signing
-- continues to work via either path.
-- ============================================================


-- proposals
CREATE POLICY "proposals_public_sign" ON public.proposals
  FOR SELECT TO anon
  USING (signing_token IS NOT NULL);

CREATE POLICY "proposals_public_sign_update" ON public.proposals
  FOR UPDATE TO anon
  USING (signing_token IS NOT NULL)
  WITH CHECK (signing_token IS NOT NULL);


-- proposal_wtc
CREATE POLICY "proposal_wtc_public_read" ON public.proposal_wtc
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
    )
  );


-- proposal_recipients
CREATE POLICY "proposal_recipients_public_update" ON public.proposal_recipients
  FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
    )
  )
  WITH CHECK (true);


-- proposal_signatures
CREATE POLICY "proposal_signatures_public_insert" ON public.proposal_signatures
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id::text = proposal_id::text
        AND p.signing_token IS NOT NULL
    )
  );


-- call_log
CREATE POLICY "call_log_public_read" ON public.call_log
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.call_log_id = call_log.id
        AND p.signing_token IS NOT NULL
    )
  );

CREATE POLICY "call_log_public_sign_update" ON public.call_log
  FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.call_log_id = call_log.id
        AND p.signing_token IS NOT NULL
    )
  )
  WITH CHECK (true);


-- invoices
CREATE POLICY "invoices_public_view" ON public.invoices
  FOR SELECT TO anon
  USING (viewing_token IS NOT NULL);


-- invoice_lines
CREATE POLICY "invoice_lines_public_read" ON public.invoice_lines
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id::text = invoice_id::text
        AND i.viewing_token IS NOT NULL
    )
  );


-- NOTE: The two un-tracked legacy policies on `proposals` are NOT
-- recreated by this rollback intentionally — they were redundant
-- with proposals_public_sign / proposals_public_sign_update.
-- If you need them back, recreate manually.
