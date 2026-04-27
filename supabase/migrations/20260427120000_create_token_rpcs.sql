-- ============================================================
-- Part 1 of 2 — Create token-checking RPCs.
-- Pairs with: 20260427120100_drop_anon_signing_policies.sql
--
-- This migration is safe to apply at any time and on its own does
-- not change anon access. It just defines three SECURITY DEFINER
-- functions that the public signing + invoice pages will call.
-- The over-broad anon policies are dropped in the part-2 migration
-- AFTER the new frontend (which uses these RPCs) is live.
--
-- Deploy order (full sequence):
--   1. supabase functions deploy proposal-signed
--   2. Apply THIS migration  (RPCs exist, no anon access change)
--   3. Merge frontend PR; wait for Vercel "Ready"
--   4. Apply 20260427120100_drop_anon_signing_policies.sql
--
-- Rollback for this part alone (between step 2 and step 4):
--   DROP FUNCTION public.get_proposal_by_token(uuid);
--   DROP FUNCTION public.mark_proposal_viewed(uuid);
--   DROP FUNCTION public.get_invoice_by_viewing_token(uuid);
-- Full-state rollback (after step 4): see
--   sql/rollback_20260427120000_tighten_anon_rls_signing_flow.sql
--
-- Scope creep, called out: get_proposal_by_token returns customer
-- business address fields. The previous anon policies never granted
-- SELECT on `customers`, so the joined customer fields in the
-- signing page have been silently null in prod. Same token gate,
-- same call — fixing while in the area.
-- ============================================================


-- ------------------------------------------------------------
-- 1. RPC: get_proposal_by_token(p_token uuid) → jsonb
--    Single round-trip read for PublicSigningPage.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_proposal_by_token(uuid);

CREATE OR REPLACE FUNCTION public.get_proposal_by_token(p_token uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'proposal',
      to_jsonb(p.*) - 'signing_token',
    'wtc',
      COALESCE((
        SELECT jsonb_agg(
          to_jsonb(pw.*) || jsonb_build_object(
            'work_types', jsonb_build_object('name', wt.name)
          )
          ORDER BY pw.created_at ASC
        )
        FROM public.proposal_wtc pw
        LEFT JOIN public.work_types wt ON wt.id = pw.work_type_id
        WHERE pw.proposal_id::text = p.id::text
      ), '[]'::jsonb),
    'call_log',
      (
        SELECT jsonb_build_object(
          'id',                 cl.id,
          'job_name',           cl.job_name,
          'display_job_number', cl.display_job_number,
          'customer_name',      cl.customer_name,
          'sales_name',         cl.sales_name,
          'jobsite_address',    cl.jobsite_address,
          'jobsite_city',       cl.jobsite_city,
          'jobsite_state',      cl.jobsite_state,
          'jobsite_zip',        cl.jobsite_zip,
          'show_cents',         cl.show_cents
        )
        FROM public.call_log cl
        WHERE cl.id = p.call_log_id
      ),
    'customer',
      (
        SELECT jsonb_build_object(
          'business_address', c.business_address,
          'business_city',    c.business_city,
          'business_state',   c.business_state,
          'business_zip',     c.business_zip,
          'contact_email',    c.contact_email
        )
        FROM public.customers c
        JOIN public.call_log cl ON cl.customer_id = c.id
        WHERE cl.id = p.call_log_id
      ),
    'rep',
      (
        SELECT jsonb_build_object(
          'name',  tm.name,
          'email', tm.email,
          'phone', tm.phone
        )
        FROM public.team_members tm
        JOIN public.call_log cl ON cl.sales_name = tm.name
        WHERE cl.id = p.call_log_id
          AND tm.active = true
        LIMIT 1
      )
  )
  FROM public.proposals p
  WHERE p.signing_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_proposal_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_proposal_by_token(uuid) TO anon, authenticated;


-- ------------------------------------------------------------
-- 2. RPC: mark_proposal_viewed(p_token uuid) → void
--    Idempotent: only flips viewed_at where it's still NULL.
--    Side-effecting, so kept separate from the STABLE read RPC.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.mark_proposal_viewed(uuid);

CREATE OR REPLACE FUNCTION public.mark_proposal_viewed(p_token uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
  UPDATE public.proposal_recipients pr
  SET viewed_at = now()
  WHERE pr.viewed_at IS NULL
    AND pr.proposal_id::text IN (
      SELECT p.id::text
      FROM public.proposals p
      WHERE p.signing_token = p_token
    );
$$;

REVOKE ALL ON FUNCTION public.mark_proposal_viewed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_proposal_viewed(uuid) TO anon, authenticated;


-- ------------------------------------------------------------
-- 3. RPC: get_invoice_by_viewing_token(p_token uuid) → jsonb
--    Single round-trip read for PublicInvoicePage.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_invoice_by_viewing_token(uuid);

CREATE OR REPLACE FUNCTION public.get_invoice_by_viewing_token(p_token uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'invoice',
      to_jsonb(i.*) - 'viewing_token',
    'lines',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',           il.id,
            'billing_pct',  il.billing_pct,
            'amount',       il.amount,
            'proposal_wtc', CASE
              WHEN pw.id IS NULL THEN NULL
              ELSE to_jsonb(pw.*) || jsonb_build_object(
                'work_types', jsonb_build_object('name', wt.name)
              )
            END
          )
          ORDER BY il.id
        )
        FROM public.invoice_lines il
        LEFT JOIN public.proposal_wtc pw ON pw.id = il.proposal_wtc_id
        LEFT JOIN public.work_types  wt ON wt.id = pw.work_type_id
        WHERE il.invoice_id::text = i.id::text
      ), '[]'::jsonb),
    'call_log',
      (
        SELECT jsonb_build_object(
          'customer_name',      cl.customer_name,
          'sales_name',         cl.sales_name,
          'display_job_number', cl.display_job_number,
          'jobsite_address',    cl.jobsite_address,
          'jobsite_city',       cl.jobsite_city,
          'jobsite_state',      cl.jobsite_state,
          'jobsite_zip',        cl.jobsite_zip,
          'show_cents',         cl.show_cents
        )
        FROM public.call_log cl
        JOIN public.proposals p ON p.call_log_id = cl.id
        WHERE p.id::text = i.proposal_id::text
      ),
    'customer',
      (
        SELECT jsonb_build_object(
          'billing_name',     c.billing_name,
          'billing_email',    c.billing_email,
          'contact_email',    c.contact_email,
          'first_name',       c.first_name,
          'last_name',        c.last_name,
          'name',             c.name,
          'business_address', c.business_address,
          'business_city',    c.business_city,
          'business_state',   c.business_state,
          'business_zip',     c.business_zip
        )
        FROM public.customers c
        JOIN public.call_log  cl ON cl.customer_id = c.id
        JOIN public.proposals p  ON p.call_log_id = cl.id
        WHERE p.id::text = i.proposal_id::text
      ),
    'rep',
      (
        SELECT jsonb_build_object(
          'phone', tm.phone,
          'email', tm.email
        )
        FROM public.team_members tm
        JOIN public.call_log  cl ON cl.sales_name = tm.name
        JOIN public.proposals p  ON p.call_log_id = cl.id
        WHERE p.id::text = i.proposal_id::text
          AND tm.active = true
        LIMIT 1
      )
  )
  FROM public.invoices i
  WHERE i.viewing_token = p_token
    AND i.deleted_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_invoice_by_viewing_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invoice_by_viewing_token(uuid) TO anon, authenticated;


-- ============================================================
-- VERIFY (run after applying)
-- ============================================================
-- SELECT n.nspname, p.proname,
--        pg_get_function_identity_arguments(p.oid) AS args,
--        has_function_privilege('anon', p.oid, 'execute') AS anon_can_exec
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('get_proposal_by_token', 'mark_proposal_viewed',
--                     'get_invoice_by_viewing_token');
-- -- Expect 3 rows, all anon_can_exec = true.
