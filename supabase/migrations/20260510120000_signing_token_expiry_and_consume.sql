-- ============================================================
-- H5 (audit Deep 2026-04-30): signing-token expiry + single-use.
--
-- Adds two columns to proposals:
--   signing_token_expires_at   timestamptz
--   signing_token_consumed_at  timestamptz
--
-- The schema invariant is: any row with a non-null signing_token MUST
-- have a non-null signing_token_expires_at. A BEFORE INSERT OR UPDATE
-- trigger auto-fills expires_at from tenant_config.proposal_validity_days
-- (fallback 90) whenever a token is set without an expiry.
--
-- Backfill:
--   Drafts          — anchor on now() (no customer has the link yet;
--                     handleSend refreshes expires_at before email send).
--   Sent/other      — anchor on COALESCE(sent_at, created_at, now()).
--   Sold            — backfill expires_at to COALESCE(approved_at, now())
--                     + interval '1 year' so the customer can revisit
--                     the Accepted page for a bookkeeper/audit window.
--                     consumed_at backfilled to COALESCE(approved_at, now()).
--   Safety net      — anything missed gets 90 days from
--                     COALESCE(sent_at, created_at, now()).
--
-- Predicates updated (no NULL bypass — strict):
--   5 anon SELECT/INSERT policies on proposals, proposal_wtc, call_log,
--   customers (signing-token branch), proposal_signatures all gain
--   AND signing_token_expires_at IS NOT NULL
--   AND signing_token_expires_at > now()
--
-- RPC bodies:
--   get_public_proposal_view(p_token)  — strict on expiry, permissive on
--                                        consumed_at (Accepted revisit).
--   mark_recipient_viewed(p_token)     — strict on expiry AND consumed_at.
--   mark_proposal_signed (5-arg)       — atomic single-use: SELECT FOR
--                                        UPDATE, UPDATE ... WHERE
--                                        consumed_at IS NULL race guard,
--                                        optional signature insert
--                                        (p_signer_name supplied),
--                                        call_log.stage flip — one txn.
--                                        Raises ALREADY_SIGNED when the
--                                        atomic guard catches a 2nd call.
--                                        Validates p_pdf_url against
--                                        Supabase signed-proposals URL
--                                        AND the proposal's own id.
--   mark_proposal_signed (1-arg)       — KEPT as compatibility wrapper.
--                                        Old JS (already loaded in
--                                        customer browsers) calls this;
--                                        wrapper delegates to 5-arg with
--                                        NULL signer fields (old JS does
--                                        its own proposal_signatures
--                                        insert via the anon insert
--                                        policy which this migration
--                                        leaves in place, gated on
--                                        unexpired signing_token).
--                                        Backlog row O3 tracks the
--                                        post-deploy drop of this
--                                        wrapper + the legacy insert
--                                        policy (Migration B).
--
-- UNIQUE partial index on signing_token enforces no-collision invariant.
-- Preflight Q-DUP must return 0 before this migration applies.
--
-- Final statement: NOTIFY pgrst, 'reload schema' so PostgREST picks up
-- the new 5-arg overload immediately (otherwise the first call returns
-- PGRST202 / function not found until the schema cache rolls).
-- ============================================================

BEGIN;

-- ============================================================
-- 1) Columns
-- ============================================================
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS signing_token_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS signing_token_consumed_at timestamptz;


-- ============================================================
-- 2) Unique partial index on signing_token
--    Replaces nothing existing; just enforces no-collision invariant.
--    Preflight Q-DUP must return zero before apply.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposals_signing_token_active
  ON public.proposals (signing_token)
  WHERE signing_token IS NOT NULL;


-- ============================================================
-- 3) Backfill — Drafts (anchor on now())
-- ============================================================
UPDATE public.proposals AS p
   SET signing_token_expires_at =
         now() + (COALESCE(tc.proposal_validity_days, 90) || ' days')::interval
  FROM public.tenant_config tc
 WHERE p.tenant_id = tc.id
   AND p.signing_token IS NOT NULL
   AND p.signing_token_expires_at IS NULL
   AND p.status = 'Draft';


-- ============================================================
-- 4) Backfill — Sent / In Progress / Has Bid / other non-Draft
--    non-Sold (anchor on COALESCE(sent_at, created_at, now()))
-- ============================================================
UPDATE public.proposals AS p
   SET signing_token_expires_at =
         COALESCE(p.sent_at, p.created_at, now())
         + (COALESCE(tc.proposal_validity_days, 90) || ' days')::interval
  FROM public.tenant_config tc
 WHERE p.tenant_id = tc.id
   AND p.signing_token IS NOT NULL
   AND p.signing_token_expires_at IS NULL
   AND p.status NOT IN ('Draft', 'Sold');


-- ============================================================
-- 5) Backfill — Sold (revisit window from approved_at + 1 year)
--    Also flip consumed_at to lock out re-signing.
-- ============================================================
UPDATE public.proposals
   SET signing_token_expires_at =
         COALESCE(approved_at, now()) + interval '1 year'
 WHERE signing_token IS NOT NULL
   AND signing_token_expires_at IS NULL
   AND status = 'Sold';

UPDATE public.proposals
   SET signing_token_consumed_at = COALESCE(approved_at, now())
 WHERE status = 'Sold'
   AND signing_token IS NOT NULL
   AND signing_token_consumed_at IS NULL;


-- ============================================================
-- 6) Safety-net backfill — anything still null (shouldn't happen
--    since tenant_id is NOT NULL on proposals, but defensive).
-- ============================================================
UPDATE public.proposals
   SET signing_token_expires_at =
         COALESCE(sent_at, created_at, now()) + interval '90 days'
 WHERE signing_token IS NOT NULL
   AND signing_token_expires_at IS NULL;


-- ============================================================
-- 7) Schema invariant: signing_token => signing_token_expires_at
-- ============================================================
ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_signing_token_requires_expiry;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_signing_token_requires_expiry
  CHECK (signing_token IS NULL OR signing_token_expires_at IS NOT NULL)
  NOT VALID;

ALTER TABLE public.proposals
  VALIDATE CONSTRAINT proposals_signing_token_requires_expiry;


-- ============================================================
-- 8) Auto-fill trigger for token-mint sites
--    Covers NewProposalModal, ArchiveProposalModal, and any future
--    INSERT or token-rotation path. No React code change needed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.proposals_set_signing_token_expires_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_days int;
BEGIN
  IF NEW.signing_token IS NOT NULL
     AND NEW.signing_token_expires_at IS NULL THEN
    SELECT COALESCE(proposal_validity_days, 90) INTO v_days
      FROM public.tenant_config WHERE id = NEW.tenant_id;
    NEW.signing_token_expires_at :=
      now() + (COALESCE(v_days, 90) || ' days')::interval;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposals_set_signing_token_expires_at
  ON public.proposals;

CREATE TRIGGER trg_proposals_set_signing_token_expires_at
  BEFORE INSERT OR UPDATE OF signing_token ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.proposals_set_signing_token_expires_at();


-- ============================================================
-- 9) Policy updates — strict predicate (no NULL bypass).
--    All five anon policies that key off signing_token gain
--      AND signing_token_expires_at IS NOT NULL
--      AND signing_token_expires_at > now()
-- ============================================================

-- 9a. proposals SELECT
DROP POLICY IF EXISTS "proposals_public_sign_token" ON public.proposals;
CREATE POLICY "proposals_public_sign_token" ON public.proposals
  FOR SELECT TO anon
  USING (
    signing_token IS NOT NULL
    AND signing_token::text = public.request_signing_token()
    AND signing_token_expires_at IS NOT NULL
    AND signing_token_expires_at > now()
  );

-- 9b. proposal_wtc SELECT (via parent proposals)
DROP POLICY IF EXISTS "proposal_wtc_public_read_token" ON public.proposal_wtc;
CREATE POLICY "proposal_wtc_public_read_token" ON public.proposal_wtc
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
       WHERE p.id::text = proposal_id::text
         AND p.signing_token IS NOT NULL
         AND p.signing_token::text = public.request_signing_token()
         AND p.signing_token_expires_at IS NOT NULL
         AND p.signing_token_expires_at > now()
    )
  );

-- 9c. call_log SELECT (signing-token branch via parent proposals).
--     Viewing-token branch (call_log_public_view_token) untouched — B13.
DROP POLICY IF EXISTS "call_log_public_read_token" ON public.call_log;
CREATE POLICY "call_log_public_read_token" ON public.call_log
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
       WHERE p.call_log_id = call_log.id
         AND p.signing_token IS NOT NULL
         AND p.signing_token::text = public.request_signing_token()
         AND p.signing_token_expires_at IS NOT NULL
         AND p.signing_token_expires_at > now()
    )
  );

-- 9d. customers SELECT (signing-token branch gains predicate; viewing
--     branch verbatim from 20260502130000 — B13 will tighten it).
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
      JOIN public.invoices i ON i.job_id::int = cl.id
      WHERE cl.customer_id = customers.id
        AND i.viewing_token IS NOT NULL
        AND i.viewing_token::text = public.request_viewing_token()
    )
  );

-- 9e. proposal_signatures INSERT — KEPT for compat wrapper path (old JS
--     does its own insert via this policy). Migration B (O3) drops it.
--     Gains expiry predicate so an expired link can't write a sig row.
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
         AND p.signing_token_expires_at IS NOT NULL
         AND p.signing_token_expires_at > now()
    )
  );


-- ============================================================
-- 10) get_public_proposal_view — strict expiry, permissive consumed_at.
--     Body adds signing_token_consumed_at to the returned JSON so the
--     React page can render the Accepted screen on first paint.
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
     AND p.signing_token_expires_at IS NOT NULL
     AND p.signing_token_expires_at > now()
   LIMIT 1;

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  SELECT json_build_object(
    'id',                       p.id,
    'status',                   p.status,
    'customer',                 p.customer,
    'proposal_number',          p.proposal_number,
    'call_log_id',              p.call_log_id,
    'total',                    p.total,
    'signing_token_consumed_at', p.signing_token_consumed_at,
    'call_log', (
      SELECT json_build_object(
        'job_name',           cl.job_name,
        'display_job_number', cl.display_job_number,
        'customer_name',      cl.customer_name,
        'sales_name',         cl.sales_name,
        'jobsite_address',    cl.jobsite_address,
        'jobsite_city',       cl.jobsite_city,
        'jobsite_state',      cl.jobsite_state,
        'jobsite_zip',        cl.jobsite_zip,
        'show_cents',         cl.show_cents,
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


-- ============================================================
-- 11) mark_recipient_viewed — strict on expiry AND consumed_at.
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
     AND signing_token_expires_at IS NOT NULL
     AND signing_token_expires_at > now()
     AND signing_token_consumed_at IS NULL
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
-- 12) mark_proposal_signed — atomic 5-arg form (NEW).
--     Signature insert is OPTIONAL: only fires when p_signer_name is
--     supplied. Compatibility wrapper (1-arg) passes NULLs so the
--     status flip + call_log update still happens atomically while the
--     old JS handles its own proposal_signatures insert via the
--     legacy anon-insert policy (which Migration B drops).
--
--     Race-safe: SELECT FOR UPDATE locks the row; UPDATE filters on
--     signing_token_consumed_at IS NULL. Only one concurrent caller
--     flips it. Second caller raises ALREADY_SIGNED.
--
--     p_pdf_url, when supplied, must be a Supabase signed-proposals
--     public URL whose path's {proposal_id} matches THIS proposal —
--     an attacker can't spoof a URL pointing at another proposal's
--     signed PDF (defence against SECURITY DEFINER write trust).
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_proposal_signed(
  p_token        text,
  p_signer_name  text,
  p_signer_email text,
  p_ip_address   text,
  p_pdf_url      text
)
RETURNS TABLE (proposal_id text, call_log_id integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal_id text;
  v_call_log_id integer;
  v_rows        integer;
  v_pdf         text := NULLIF(btrim(p_pdf_url), '');
  v_signer_name text := NULLIF(btrim(p_signer_name), '');
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'INVALID_TOKEN';
  END IF;

  -- New path supplies a signer name; compat wrapper passes NULL. The
  -- difference is whether we insert a proposal_signatures row inside
  -- this txn or leave it to the caller's anon-insert path.
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

  -- p_pdf_url validation: must be a Supabase signed-proposals URL whose
  -- filename embeds THIS proposal's id. The current upload path in
  -- src/pages/PublicSigningPage.jsx writes:
  --   signed-proposals/signed-proposal-{proposal_id}-{ms_timestamp}.pdf
  IF v_pdf IS NOT NULL THEN
    IF v_pdf !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/signed-proposals/signed-proposal-' ||
                 v_proposal_id || '-[0-9]+\.pdf$') THEN
      RAISE EXCEPTION 'INVALID_PDF_URL';
    END IF;
  END IF;

  -- Atomic single-use guard. Only the first concurrent caller's UPDATE
  -- matches (consumed_at IS NULL filter). Subsequent calls get
  -- v_rows = 0 and raise ALREADY_SIGNED.
  UPDATE public.proposals
     SET status                    = 'Sold',
         approved_at               = now(),
         signing_token_consumed_at = now()
   WHERE id = v_proposal_id
     AND signing_token_consumed_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'ALREADY_SIGNED';
  END IF;

  -- Signature insert (new-path only). Tenant_id is set by
  -- trg_proposal_signatures_set_tenant (migration 20260508120000).
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

  IF v_call_log_id IS NOT NULL THEN
    UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;
  END IF;

  RETURN QUERY SELECT v_proposal_id, v_call_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_proposal_signed(text, text, text, text, text) TO anon;


-- ============================================================
-- 13) mark_proposal_signed — 1-arg compatibility wrapper (KEPT).
--     Old JS in already-loaded customer browsers calls this. Wrapper
--     delegates to the 5-arg with NULL signer fields — atomic
--     status/consumed/call_log flip still happens; old JS's own
--     anon-insert of proposal_signatures runs via the policy kept in
--     section 9e above. Backlog O3 tracks dropping both this wrapper
--     AND the anon-insert policy in Migration B after deploy verifies.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_proposal_signed(p_token text)
RETURNS TABLE (proposal_id text, call_log_id integer)
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


-- ============================================================
-- 14) PostgREST schema reload — picks up the new 5-arg overload
--     immediately. Without this, the first call hits PGRST202
--     ("Could not find the function public.mark_proposal_signed
--     ... in the schema cache") until the cache rolls.
-- ============================================================
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- VERIFICATION (run manually after apply — read-only)
-- ============================================================
-- 1. Zero rows with signing_token but no expiry:
--    SELECT count(*) FROM public.proposals
--     WHERE signing_token IS NOT NULL AND signing_token_expires_at IS NULL;
--    -- expect 0
--
-- 2. Zero Sold rows with signing_token but no consumed_at:
--    SELECT count(*) FROM public.proposals
--     WHERE status='Sold' AND signing_token IS NOT NULL
--       AND signing_token_consumed_at IS NULL;
--    -- expect 0
--
-- 3. CHECK constraint validated:
--    SELECT conname, convalidated FROM pg_constraint
--     WHERE conname = 'proposals_signing_token_requires_expiry';
--    -- expect convalidated = true
--
-- 4. Both mark_proposal_signed forms exist:
--    SELECT proname, pg_get_function_arguments(oid) FROM pg_proc
--     WHERE proname = 'mark_proposal_signed' AND pronamespace = 'public'::regnamespace
--     ORDER BY pronargs;
--    -- expect:
--    --   mark_proposal_signed | p_token text
--    --   mark_proposal_signed | p_token text, p_signer_name text, p_signer_email text, p_ip_address text, p_pdf_url text
--
-- 5. New 5-arg RPC resolves via PostgREST (post-NOTIFY):
--    From Supabase JS:
--      supabase.rpc("mark_proposal_signed",
--        { p_token: "not-a-real-token", p_signer_name: null,
--          p_signer_email: null, p_ip_address: null, p_pdf_url: null })
--    -- expect: 400 with INVALID_TOKEN (NOT 404 / PGRST202)
--
-- 6. Anon policy inventory unchanged in shape, bodies updated:
--    SELECT tablename, policyname, cmd FROM pg_policies
--     WHERE schemaname='public' AND roles::text LIKE '%anon%'
--     ORDER BY tablename, policyname;
--    -- expect (signing-token surface):
--    --   call_log            | call_log_public_read_token              | SELECT
--    --   customers           | customers_public_read_token             | SELECT
--    --   proposal_signatures | proposal_signatures_public_insert_token | INSERT  -- DROPPED IN MIGRATION B
--    --   proposal_wtc        | proposal_wtc_public_read_token          | SELECT
--    --   proposals           | proposals_public_sign_token             | SELECT
