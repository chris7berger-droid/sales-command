-- ============================================================
-- Rollback for 20260510120000_signing_token_expiry_and_consume.sql
--
-- Restores production state to what existed immediately before that
-- migration applied:
--   • mark_proposal_signed(text) body restored from 20260502120000
--     (atomic status flip + call_log update, NO expiry/consumed_at
--     awareness — the columns will no longer exist after this rollback).
--   • get_public_proposal_view(text) restored from 20260505190300.
--   • mark_recipient_viewed(text) restored from 20260502120000.
--   • 5 policies restored to the pre-H5 (post-20260502130000) shape.
--   • Trigger + trigger function dropped.
--   • CHECK constraint dropped.
--   • Unique partial index dropped.
--   • signing_token_consumed_at + signing_token_expires_at columns
--     dropped (this is destructive — any consumed_at history is lost).
--
-- Use only if H5 must be reverted urgently. Migration B
-- (drop the compat wrapper + legacy insert policy) MUST NOT have
-- applied yet — if it has, run its rollback first, then this one.
-- ============================================================

BEGIN;

-- 1) Drop the 5-arg form first (before redefining the 1-arg form's body).
DROP FUNCTION IF EXISTS public.mark_proposal_signed(text, text, text, text, text);

-- 2) Restore the original 1-arg mark_proposal_signed body (pre-H5).
--    This is the body from 20260502120000_signing_flow_security_definer.sql.
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


-- 3) Restore mark_recipient_viewed body (no expiry/consumed_at checks).
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


-- 4) Restore get_public_proposal_view body (no consumed_at field, no
--    expiry predicate). Pre-H5 body from 20260505190300.
CREATE OR REPLACE FUNCTION public.get_public_proposal_view(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal_id text;
  v_result json;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  SELECT p.id INTO v_proposal_id
    FROM public.proposals p
   WHERE p.signing_token IS NOT NULL
     AND p.signing_token::text = p_token
   LIMIT 1;

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  SELECT json_build_object(
    'id',              p.id,
    'status',          p.status,
    'customer',        p.customer,
    'proposal_number', p.proposal_number,
    'call_log_id',     p.call_log_id,
    'total',           p.total,
    'call_log', (
      SELECT json_build_object(
        'job_name',            cl.job_name,
        'display_job_number',  cl.display_job_number,
        'customer_name',       cl.customer_name,
        'sales_name',          cl.sales_name,
        'jobsite_address',     cl.jobsite_address,
        'jobsite_city',        cl.jobsite_city,
        'jobsite_state',       cl.jobsite_state,
        'jobsite_zip',         cl.jobsite_zip,
        'show_cents',          cl.show_cents,
        'customers', (
          SELECT json_build_object(
            'business_address', c.business_address,
            'business_city',    c.business_city,
            'business_state',   c.business_state,
            'business_zip',     c.business_zip,
            'contact_email',    c.contact_email
          )
            FROM public.customers c
           WHERE c.id = cl.customer_id
        )
      )
        FROM public.call_log cl
       WHERE cl.id = p.call_log_id
    ),
    'wtc', COALESCE(
      (
        SELECT json_agg(
                 json_build_object(
                   'id',                w.id,
                   'sales_sow',         w.sales_sow,
                   'locked_line_total', w.locked_line_total,
                   'work_type_name',    wt.name
                 )
                 ORDER BY w.created_at ASC
               )
          FROM public.proposal_wtc w
          LEFT JOIN public.work_types wt ON wt.id = w.work_type_id
         WHERE w.proposal_id = p.id
      ),
      '[]'::json
    )
  )
    INTO v_result
    FROM public.proposals p
   WHERE p.id = v_proposal_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_proposal_view(text) TO anon;


-- 5) Restore policies to pre-H5 shape (post-20260502130000).
DROP POLICY IF EXISTS "proposals_public_sign_token" ON public.proposals;
CREATE POLICY "proposals_public_sign_token" ON public.proposals
  FOR SELECT TO anon
  USING (
    signing_token IS NOT NULL
    AND signing_token::text = public.request_signing_token()
  );

DROP POLICY IF EXISTS "proposal_wtc_public_read_token" ON public.proposal_wtc;
CREATE POLICY "proposal_wtc_public_read_token" ON public.proposal_wtc
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
       WHERE p.id::text = proposal_id::text
         AND p.signing_token IS NOT NULL
         AND p.signing_token::text = public.request_signing_token()
    )
  );

DROP POLICY IF EXISTS "call_log_public_read_token" ON public.call_log;
CREATE POLICY "call_log_public_read_token" ON public.call_log
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
       WHERE p.call_log_id = call_log.id
         AND p.signing_token IS NOT NULL
         AND p.signing_token::text = public.request_signing_token()
    )
  );

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
    )
    OR EXISTS (
      SELECT 1 FROM public.call_log cl
      JOIN public.invoices i ON i.job_id::int = cl.id
      WHERE cl.customer_id = customers.id
        AND i.viewing_token IS NOT NULL
        AND i.viewing_token::text = public.request_viewing_token()
    )
  );

DROP POLICY IF EXISTS "proposal_signatures_public_insert_token"
  ON public.proposal_signatures;
CREATE POLICY "proposal_signatures_public_insert_token"
  ON public.proposal_signatures
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
       WHERE p.id::text = proposal_id::text
         AND p.signing_token IS NOT NULL
         AND p.signing_token::text = public.request_signing_token()
    )
  );


-- 6) Drop trigger + trigger function.
DROP TRIGGER IF EXISTS trg_proposals_set_signing_token_expires_at
  ON public.proposals;
DROP FUNCTION IF EXISTS public.proposals_set_signing_token_expires_at();


-- 7) Drop CHECK constraint.
ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_signing_token_requires_expiry;


-- 8) Drop unique partial index.
DROP INDEX IF EXISTS public.uq_proposals_signing_token_active;


-- 9) Drop columns. DESTRUCTIVE — consumed_at audit trail lost.
ALTER TABLE public.proposals
  DROP COLUMN IF EXISTS signing_token_consumed_at,
  DROP COLUMN IF EXISTS signing_token_expires_at;


COMMIT;

NOTIFY pgrst, 'reload schema';
