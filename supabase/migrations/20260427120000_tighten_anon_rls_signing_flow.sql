-- ============================================================
-- Tighten anon RLS for the public signing + invoice flows.
-- Addresses 2026-04-26 audit findings #1, #2, and the signature-
-- insert leg of #4. The legacy policies allowed anon to read or
-- mutate ANY row where signing_token / viewing_token IS NOT NULL,
-- with no per-row token match — so anyone with the bundled anon
-- key could omit the .eq("signing_token", ...) filter and access
-- everything.
--
-- Strategy:
--   * SELECTs  → token-checking SECURITY DEFINER RPCs (one bundled
--                row per call).
--   * UPDATEs  → routed through the existing proposal-signed edge
--                function (already validates the token, runs as
--                service role).
--   * INSERTs  → same: signature insert moves into proposal-signed
--                edge function.
--
-- The new RPCs take the token as an argument so the auth check is
-- explicit and unambiguous (no header-sniffing inside an RLS
-- policy).
--
-- The original sql/rls_*.sql baselines are intentionally NOT
-- edited; this migration is the diff.
--
-- Cross-repo note: these tables are also used by sch-command,
-- field-command, and AR-Command-Center. Coordinate deploys.
--
-- Scope creep, called out on purpose: get_proposal_by_token also
-- returns customer business address fields. The old anon policies
-- never granted SELECT on `customers`, so the joined customer
-- fields in PublicSigningPage have been silently null in prod.
-- Returning them through the RPC fixes that latent bug — same
-- token gate, same call, no new attack surface.
-- ============================================================


-- ------------------------------------------------------------
-- 1. DROP the over-broad anon policies.
--    No replacement policies — the RPCs + edge function take over.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "proposals_public_sign"             ON public.proposals;
DROP POLICY IF EXISTS "proposals_public_sign_update"      ON public.proposals;
DROP POLICY IF EXISTS "call_log_public_sign_update"       ON public.call_log;
DROP POLICY IF EXISTS "proposal_wtc_public_read"          ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_recipients_public_update" ON public.proposal_recipients;
DROP POLICY IF EXISTS "proposal_signatures_public_insert" ON public.proposal_signatures;
DROP POLICY IF EXISTS "invoices_public_view"              ON public.invoices;
DROP POLICY IF EXISTS "invoice_lines_public_read"         ON public.invoice_lines;

-- Note: call_log_public_read (SELECT) is intentionally left in
-- place — it was not flagged in findings #1 or #2, and keeping
-- it lets joins from authenticated paths continue to work
-- unchanged. The signing page no longer reads call_log directly.


-- ------------------------------------------------------------
-- 2. RPC: get_proposal_by_token(p_token uuid) → jsonb
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
-- 3. RPC: mark_proposal_viewed(p_token uuid) → void
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
-- 4. RPC: get_invoice_by_viewing_token(p_token uuid) → jsonb
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
-- VERIFY (run these in the SQL editor after deploy)
-- ============================================================
--
-- 1. The dropped policies are gone:
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND policyname IN (
--     'proposals_public_sign',
--     'proposals_public_sign_update',
--     'call_log_public_sign_update',
--     'proposal_wtc_public_read',
--     'proposal_recipients_public_update',
--     'proposal_signatures_public_insert',
--     'invoices_public_view',
--     'invoice_lines_public_read'
--   );
-- -- Expect 0 rows.
--
-- 2. The new RPCs exist and anon can EXECUTE them:
-- SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--        has_function_privilege('anon', p.oid, 'execute') AS anon_can_exec
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('get_proposal_by_token', 'mark_proposal_viewed', 'get_invoice_by_viewing_token');
-- -- Expect 3 rows, all anon_can_exec = true.
