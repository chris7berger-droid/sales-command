-- ============================================================
-- Audit fixes C1, C3, C10 (2026-04-30):
--   C1 — call_log anon UPDATE policy used WITH CHECK (true), so a
--        signing-token holder could rewrite ANY column on the linked
--        call_log row (tenant_id, billing fields, qb_customer_id, etc.)
--   C3 — proposal_recipients anon UPDATE permitted arbitrary column
--        writes; token holder could flip role viewer→signer.
--   C10 — proposal-signed edge function trusted callLogId from the
--         request body instead of reading proposals.call_log_id.
--
-- Strategy: replace the column-unrestricted anon UPDATE policies with
-- two SECURITY DEFINER RPCs that update ONLY the columns the public
-- signing flow actually needs. The token is validated inside each RPC.
-- The RPCs are also what the proposal-signed edge function will use
-- (next commit), removing the body-supplied callLogId trust.
-- ============================================================


-- ============================================================
-- mark_recipient_viewed(p_token text)
--
-- Marks recipients of the proposal identified by p_token as "viewed"
-- (sets viewed_at = now() on rows where viewed_at IS NULL). Replaces
-- the direct UPDATE that PublicSigningPage previously issued under the
-- column-unrestricted anon UPDATE policy.
--
-- Returns the count of rows updated.
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_recipient_viewed(p_token text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal_id text;
  v_count integer;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  SELECT id INTO v_proposal_id
    FROM public.proposals
   WHERE signing_token IS NOT NULL
     AND signing_token::text = p_token
   LIMIT 1;

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  UPDATE public.proposal_recipients
     SET viewed_at = now()
   WHERE proposal_id = v_proposal_id
     AND viewed_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_recipient_viewed(text) TO anon;


-- ============================================================
-- mark_proposal_signed(p_token text)
--
-- Single-shot atomic update for the signing event:
--   1. Validates the signing_token against public.proposals.
--   2. Sets proposals.status = 'Sold', approved_at = now() on the
--      matching proposal.
--   3. Sets call_log.stage = 'Sold' on the proposal's OWN call_log_id
--      (read from the DB — NOT trusted from caller input). Fixes C10.
--
-- Returns a row with proposal_id + call_log_id so the caller can do
-- non-mutating downstream work (QB sync, notifications) without
-- re-trusting body parameters.
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_proposal_signed(p_token text)
RETURNS TABLE (proposal_id text, call_log_id integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal_id text;
  v_call_log_id integer;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  SELECT p.id, p.call_log_id
    INTO v_proposal_id, v_call_log_id
    FROM public.proposals p
   WHERE p.signing_token IS NOT NULL
     AND p.signing_token::text = p_token
   LIMIT 1;

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  UPDATE public.proposals
     SET status = 'Sold',
         approved_at = now()
   WHERE id = v_proposal_id;

  IF v_call_log_id IS NOT NULL THEN
    UPDATE public.call_log
       SET stage = 'Sold'
     WHERE id = v_call_log_id;
  END IF;

  RETURN QUERY SELECT v_proposal_id, v_call_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_proposal_signed(text) TO anon;


-- ============================================================
-- Drop the column-unrestricted anon UPDATE policies. After this point
-- only the RPCs above can mutate proposal_recipients.viewed_at and
-- call_log.stage from an anon context.
-- ============================================================

DROP POLICY IF EXISTS "proposal_recipients_public_update_token" ON public.proposal_recipients;
DROP POLICY IF EXISTS "call_log_public_sign_update_token"       ON public.call_log;


-- ============================================================
-- Note on proposals_public_sign_update_token:
--
-- This policy on the `proposals` table also has a WITH CHECK that
-- mirrors USING (no `WITH CHECK (true)`), so it does not exhibit the
-- same anti-pattern. Sign-time mutation of proposals.status/approved_at
-- now flows through mark_proposal_signed() instead, but the policy is
-- left in place for any client-side use we haven't migrated. Future
-- hardening: drop it once we confirm no caller hits it.
-- ============================================================


-- ============================================================
-- VERIFICATION (run manually after migration)
-- ============================================================
-- 1. Confirm the dropped policies no longer exist:
--    SELECT policyname FROM pg_policies
--     WHERE schemaname='public'
--       AND policyname IN (
--         'proposal_recipients_public_update_token',
--         'call_log_public_sign_update_token'
--       );
--    -- expect zero rows
--
-- 2. Confirm anon can call the RPCs:
--    SET ROLE anon;
--    SELECT public.mark_recipient_viewed('<real-token>');
--    SELECT * FROM public.mark_proposal_signed('<real-token>');
--    RESET ROLE;
--
-- 3. Confirm an invalid token raises:
--    SELECT public.mark_recipient_viewed('not-a-real-token');
--    -- expect: ERROR: INVALID_TOKEN
