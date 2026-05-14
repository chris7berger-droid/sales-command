-- C1 fix — sister-aware mark_proposal_signed.
-- Plan: docs/plans/multi_gc_allocation.md §2516 (C1 Resolution — Status Model §3b).
--
-- Changes:
--   1. RETURNS TABLE adds `became_sold boolean` so callers gate QB sync.
--   2. v_has_sisters check: active non-Lost siblings under same call_log.
--   3. Multi-GC path: status → 'Signed', no call_log.stage flip.
--   4. Single-GC path: byte-for-byte identical to 20260510120000 behavior.
--   5. 1-arg wrapper updated to match new return signature.

BEGIN;

-- Drop both overloads first — PostgreSQL does not allow CREATE OR
-- REPLACE when the return type changes (the new signature adds
-- became_sold boolean). Drop order: 1-arg wrapper first (it calls
-- the 5-arg), then 5-arg.
DROP FUNCTION IF EXISTS public.mark_proposal_signed(text);
DROP FUNCTION IF EXISTS public.mark_proposal_signed(text, text, text, text, text);

-- ============================================================
-- 5-arg form (replaces 20260510120000:439-531)
-- ============================================================

CREATE FUNCTION public.mark_proposal_signed(
  p_token        text,
  p_signer_name  text,
  p_signer_email text,
  p_ip_address   text,
  p_pdf_url      text
)
RETURNS TABLE (proposal_id text, call_log_id integer, became_sold boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal_id  text;
  v_call_log_id  integer;
  v_rows         integer;
  v_pdf          text := NULLIF(btrim(p_pdf_url), '');
  v_signer_name  text := NULLIF(btrim(p_signer_name), '');
  v_has_sisters  boolean;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  IF v_signer_name IS NOT NULL AND length(v_signer_name) < 3 THEN
    RAISE EXCEPTION 'INVALID_SIGNER_NAME';
  END IF;

  SELECT p.id, p.call_log_id
    INTO v_proposal_id, v_call_log_id
    FROM public.proposals p
   WHERE p.signing_token IS NOT NULL
     AND p.signing_token::text = p_token
     AND p.signing_token_expires_at IS NOT NULL
     AND p.signing_token_expires_at > now()
   LIMIT 1
   FOR UPDATE;

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  IF v_pdf IS NOT NULL THEN
    IF v_pdf !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/signed-proposals/signed-proposal-' ||
                 v_proposal_id || '-[0-9]+\.pdf$') THEN
      RAISE EXCEPTION 'INVALID_PDF_URL';
    END IF;
  END IF;

  -- C1: sister-aware terminal status.
  SELECT EXISTS (
    SELECT 1
      FROM public.proposals s
     WHERE s.call_log_id = v_call_log_id
       AND s.id <> v_proposal_id
       AND s.deleted_at IS NULL
       AND s.status NOT IN ('Lost')
  ) INTO v_has_sisters;

  IF v_has_sisters THEN
    UPDATE public.proposals
       SET status                    = 'Signed',
           approved_at               = now(),
           signing_token_consumed_at = now()
     WHERE id = v_proposal_id
       AND signing_token_consumed_at IS NULL;
  ELSE
    UPDATE public.proposals
       SET status                    = 'Sold',
           approved_at               = now(),
           signing_token_consumed_at = now()
     WHERE id = v_proposal_id
       AND signing_token_consumed_at IS NULL;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'ALREADY_SIGNED';
  END IF;

  IF v_signer_name IS NOT NULL THEN
    INSERT INTO public.proposal_signatures (
      proposal_id, signer_name, signer_email,
      ip_address, pdf_url, signed_at
    ) VALUES (
      v_proposal_id,
      v_signer_name,
      NULLIF(btrim(p_signer_email), ''),
      NULLIF(btrim(p_ip_address), ''),
      v_pdf,
      now()
    );
  END IF;

  IF v_call_log_id IS NOT NULL AND NOT v_has_sisters THEN
    UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;
  END IF;

  RETURN QUERY SELECT v_proposal_id, v_call_log_id, (NOT v_has_sisters);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_proposal_signed(text, text, text, text, text) TO anon;

-- ============================================================
-- 1-arg compatibility wrapper (updated return signature)
-- ============================================================

CREATE FUNCTION public.mark_proposal_signed(p_token text)
RETURNS TABLE (proposal_id text, call_log_id integer, became_sold boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT * FROM public.mark_proposal_signed(
      p_token,
      NULL::text, NULL::text, NULL::text, NULL::text
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_proposal_signed(text) TO anon;

COMMIT;

-- PostgREST schema cache reload: run `NOTIFY pgrst, 'reload schema'`
-- after applying, or restart PostgREST. The RETURNS TABLE change is a
-- signature change that PostgREST must pick up.
NOTIFY pgrst, 'reload schema';
