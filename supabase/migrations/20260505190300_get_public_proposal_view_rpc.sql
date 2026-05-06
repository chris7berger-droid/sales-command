-- ============================================================
-- Audit fix H6 — SECURITY DEFINER RPC for the public signing page
--
-- get_public_proposal_view(p_token text)
--
-- Replaces the anon-facing supabase.from('proposal_wtc').select('*')
-- (and the wildcard portion of the proposals select) with a single
-- token-validated read that returns ONLY display-safe fields:
--
--   proposal core         id, status, customer, proposal_number,
--                         call_log_id, total
--   call_log              job_name, display_job_number, customer_name,
--                         sales_name, jobsite_{address,city,state,zip},
--                         show_cents
--   customers             business_{address,city,state,zip},
--                         contact_email
--   wtc array (per row)   id, sales_sow, locked_line_total,
--                         work_type_name
--
-- Crucially, the wtc array does NOT contain burden_rate,
-- ot_burden_rate, pw_rate, pw_ot_rate, markup_pct, materials (jsonb),
-- travel (jsonb), regular_hours, ot_hours, size, prevailing_wage,
-- discount, tax_rate, sub_areas, field_sow, or any other cost basis.
-- locked_line_total is the snapshot written by handleLock() in the
-- internal app at lock time (migration 20260505190200), so the
-- customer sees the SAME number that proposals.total was computed
-- from — single source of truth lives in src/lib/calc.js, never
-- reimplemented in SQL.
--
-- Pattern matches the v91 SECURITY DEFINER RPCs (mark_proposal_signed,
-- mark_recipient_viewed): SET search_path = public (audit H1/H7),
-- INVALID_TOKEN raise, GRANT EXECUTE TO anon, no body trust on
-- caller-supplied values.
-- ============================================================

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

COMMENT ON FUNCTION public.get_public_proposal_view(text) IS
  'Audit H6: token-validated read for the public signing page. '
  'Returns display-safe fields only — no burden_rate, markup_pct, '
  'materials, travel, or hours. Per-WTC totals come from '
  'proposal_wtc.locked_line_total (snapshot at lock time). Pattern '
  'matches v91 mark_proposal_signed / mark_recipient_viewed: '
  'SECURITY DEFINER, SET search_path=public, GRANT EXECUTE TO anon, '
  'INVALID_TOKEN raise on null/empty/mismatched token.';

-- ============================================================
-- VERIFICATION (run manually after migration)
-- ============================================================
--   SET ROLE anon;
--   SELECT public.get_public_proposal_view('not-a-real-token');
--   -- expect: ERROR: INVALID_TOKEN
--
--   SELECT public.get_public_proposal_view('<a real signing_token>');
--   -- expect: a json object with proposal/call_log/customers/wtc keys
--   -- and NO burden_rate, markup_pct, materials, etc. anywhere in
--   -- the response.
--   RESET ROLE;
-- ============================================================
