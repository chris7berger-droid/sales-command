-- B37 — fix false-sister detection in mark_proposal_signed.
-- Replaces broad call_log_id sibling scan with cloned_from_proposal_id lineage check.
-- Signature unchanged (5-arg → TABLE(proposal_id, call_log_id, became_sold)); 1-arg wrapper unaffected.

CREATE OR REPLACE FUNCTION public.mark_proposal_signed(
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
  v_proposal_id   text;
  v_call_log_id   integer;
  v_cloned_from   text;
  v_rows          integer;
  v_pdf           text := NULLIF(btrim(p_pdf_url), '');
  v_signer_name   text := NULLIF(btrim(p_signer_name), '');
  v_has_sisters   boolean;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  IF v_signer_name IS NOT NULL AND length(v_signer_name) < 3 THEN
    RAISE EXCEPTION 'INVALID_SIGNER_NAME';
  END IF;

  SELECT p.id, p.call_log_id, p.cloned_from_proposal_id
    INTO v_proposal_id, v_call_log_id, v_cloned_from
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

  SELECT EXISTS (
    SELECT 1 FROM public.proposals s
     WHERE s.deleted_at IS NULL
       AND s.status NOT IN ('Lost')
       AND s.id <> v_proposal_id
       AND (
         s.cloned_from_proposal_id = v_proposal_id
         OR
         (v_cloned_from IS NOT NULL AND s.cloned_from_proposal_id = v_cloned_from)
         OR
         (v_cloned_from IS NOT NULL AND s.id = v_cloned_from)
       )
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

  NOTIFY pgrst, 'reload schema';

  RETURN QUERY SELECT v_proposal_id, v_call_log_id, (NOT v_has_sisters);
END;
$$;
