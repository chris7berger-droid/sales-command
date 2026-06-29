-- Exact-penny pricing (plan docs/plans/exact_penny_pricing.md §3.5.1).
--
-- Adds the pricing-era anchor column + teaches the multi-GC clone RPC to carry
-- it, so a sister cloned from a PRE-cutoff source keeps billing CEIL (legacy)
-- even though the clone's own created_at is post-cutoff. Without this, a clone's
-- live invoice recompute would flip to EXACT while its frozen snapshot stayed
-- CEIL → freeze ≠ bill on a live prod path.
--
-- The pricing era resolved in JS is `pricing_anchor_at ?? created_at`
-- (src/lib/calc.js usesExactPricing). Normal proposals leave pricing_anchor_at
-- NULL and fall through to created_at. created_at stays truthful (real clone
-- time); the pricing era is explicit and self-documenting.
--
-- ADDITIVE + REVERSIBLE: one nullable column + a CREATE OR REPLACE on an
-- existing RPC + a one-time set-based backfill. Rollback order (ADJ-M5): revert
-- the app SELECTs FIRST, then drop the column (dropping while the app still
-- selects it 400s every proposal fetch).
--
-- Shared backend (pbgvgjjuhnpsumnowuym, shared with field-command): pushed via
-- `npm run db:push` after `scripts/check-migration-safety.sh`.
--
-- Anon exposure: anon reads proposals through the existing table-level SELECT
-- grant + the proposals_public_view_token row policy, so this nullable column is
-- automatically readable by the public-invoice embed (PublicInvoicePage). No new
-- grant is required (a column-level GRANT under a table-level grant is a no-op).

-- ============================================================================
-- 1. The pricing-era anchor column
-- ============================================================================

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS pricing_anchor_at timestamptz;

COMMENT ON COLUMN public.proposals.pricing_anchor_at IS
  'Pricing-era override for exact-penny rounding. NULL for normal proposals '
  '(era falls back to created_at). A multi-GC clone inherits its source''s era '
  'here so it never silently flips ceil<->exact. See exact_penny_pricing plan.';

-- ============================================================================
-- 2. Backfill existing sisters (set-based, not a one-row hand-edit)
-- ============================================================================
-- src is always an original — clone_proposal_to_gcs rejects nested clones, so a
-- sister's source is never itself a clone. (Confirm no sister has a hard-deleted
-- source before relying on this join; under soft-delete the row still exists.)

UPDATE public.proposals s
   SET pricing_anchor_at = src.created_at
  FROM public.proposals src
 WHERE s.cloned_from_proposal_id = src.id
   AND s.pricing_anchor_at IS NULL;

-- ============================================================================
-- 3. clone_proposal_to_gcs — carry the source's pricing era onto the sister
-- ============================================================================
-- CREATE OR REPLACE of 20260519230000_sister_wtc_auto_lock.sql with ONE change:
-- pricing_anchor_at added to the INSERT column list + VALUES, set to
-- COALESCE(v_source.pricing_anchor_at, v_source.created_at). The first arm is
-- forward-defensive — the RPC rejects nested clones (NESTED_CLONE_NOT_SUPPORTED)
-- so v_source.pricing_anchor_at is NULL today, but the COALESCE keeps it correct
-- if that ever changes. Everything else is byte-for-byte the prior definition.

CREATE OR REPLACE FUNCTION public.clone_proposal_to_gcs(
  p_source_proposal_id text,
  p_targets            jsonb
) RETURNS TABLE (sister_proposal_id text, customer_id uuid, proposal_number int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_source    public.proposals%ROWTYPE;
  v_target    jsonb;
  v_sister_id text;
  v_next_n    int;
  v_performed_by uuid;
  v_intro     text;
  v_intro_lef text[];
  v_contact   record;
  v_viewer_id text;
  v_customer_name text;
  v_no_override boolean;
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_source FROM public.proposals
    WHERE id = p_source_proposal_id FOR UPDATE;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SOURCE'; END IF;
  IF v_source.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_DELETED'; END IF;
  IF v_source.cloned_from_proposal_id IS NOT NULL THEN
    RAISE EXCEPTION 'NESTED_CLONE_NOT_SUPPORTED';
  END IF;

  SELECT id INTO v_performed_by
    FROM public.team_members WHERE auth_id = auth.uid() LIMIT 1;

  SELECT COALESCE(MAX(p.proposal_number), 0) INTO v_next_n
    FROM public.proposals p
   WHERE p.call_log_id = v_source.call_log_id
     AND p.deleted_at IS NULL;

  FOR v_target IN SELECT * FROM jsonb_array_elements(p_targets)
  LOOP
    v_next_n := v_next_n + 1;
    v_sister_id := gen_random_uuid()::text;
    v_no_override := COALESCE((v_target->>'markup_override_pct')::numeric, 0) = 0;

    -- F19: intro override
    IF v_target->>'intro_override' IS NOT NULL THEN
      v_intro := v_target->>'intro_override';
      v_intro_lef := ARRAY['intro'];
    ELSE
      v_intro := v_source.intro;
      v_intro_lef := '{}'::text[];
    END IF;

    SELECT c.name INTO v_customer_name
      FROM public.customers c
     WHERE c.id = (v_target->>'customer_id')::uuid;

    INSERT INTO public.proposals (
      id, call_log_id, status,
      intro, locally_edited_fields,
      customer, customer_id, markup_override_pct,
      total,
      rfp_number, bid_due_date, billing_terms_override,
      proposal_number, cloned_from_proposal_id,
      tenant_id, signing_token, created_at,
      pricing_anchor_at
    ) VALUES (
      v_sister_id, v_source.call_log_id, 'Draft',
      v_intro, v_intro_lef,
      v_customer_name, (v_target->>'customer_id')::uuid, (v_target->>'markup_override_pct')::numeric,
      v_source.total,
      v_target->>'rfp_number',
      (v_target->>'bid_due')::date,
      (v_target->>'billing_terms')::integer,
      v_next_n, p_source_proposal_id,
      v_tenant_id, gen_random_uuid(), now(),
      COALESCE(v_source.pricing_anchor_at, v_source.created_at)
    );

    INSERT INTO public.proposal_wtc (
      proposal_id, work_type_id, cloned_from_wtc_id,
      sales_sow, field_sow, materials, sub_areas, travel,
      size, unit, discount, discount_reason,
      regular_hours, ot_hours, markup_pct,
      burden_rate, ot_burden_rate, tax_rate, prevailing_wage,
      start_date, end_date,
      locked, locked_line_total,
      locally_edited_fields
    )
    SELECT
      v_sister_id, work_type_id, id,
      sales_sow, field_sow, materials, sub_areas, travel,
      size, unit, discount, discount_reason,
      regular_hours, ot_hours, markup_pct,
      burden_rate, ot_burden_rate, tax_rate, prevailing_wage,
      start_date, end_date,
      CASE WHEN locked AND v_no_override THEN true ELSE false END,
      CASE WHEN locked AND v_no_override THEN locked_line_total ELSE NULL END,
      '{}'::text[]
    FROM public.proposal_wtc
    WHERE proposal_id = p_source_proposal_id;

    INSERT INTO public.proposal_clones (
      parent_proposal_id, sister_proposal_id, call_log_id,
      wtc_count, cloned_by, tenant_id
    ) VALUES (
      p_source_proposal_id, v_sister_id, v_source.call_log_id,
      (SELECT count(*) FROM public.proposal_wtc WHERE proposal_id = v_sister_id),
      v_performed_by, v_tenant_id
    );

    -- Insert signer as proposal_recipient
    IF v_target->>'signer_contact_id' IS NOT NULL THEN
      SELECT * INTO v_contact FROM public.customer_contacts
        WHERE id = (v_target->>'signer_contact_id')::uuid;
      IF v_contact.id IS NOT NULL THEN
        INSERT INTO public.proposal_recipients (
          proposal_id, contact_name, contact_email, phone,
          role, customer_contact_id
        ) VALUES (
          v_sister_id, v_contact.name, v_contact.email, v_contact.phone,
          'signer', v_contact.id
        );
      END IF;
    END IF;

    -- Insert viewers as proposal_recipients (jsonb_typeof guard for null safety)
    IF jsonb_typeof(v_target->'viewer_contact_ids') = 'array'
       AND jsonb_array_length(v_target->'viewer_contact_ids') > 0 THEN
      FOR v_viewer_id IN SELECT jsonb_array_elements_text(v_target->'viewer_contact_ids')
      LOOP
        SELECT * INTO v_contact FROM public.customer_contacts
          WHERE id = v_viewer_id::uuid;
        IF v_contact.id IS NOT NULL THEN
          INSERT INTO public.proposal_recipients (
            proposal_id, contact_name, contact_email, phone,
            role, customer_contact_id
          ) VALUES (
            v_sister_id, v_contact.name, v_contact.email, v_contact.phone,
            'viewer', v_contact.id
          );
        END IF;
      END LOOP;
    END IF;

    sister_proposal_id := v_sister_id;
    customer_id := (v_target->>'customer_id')::uuid;
    proposal_number := v_next_n;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.clone_proposal_to_gcs(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.clone_proposal_to_gcs(text, jsonb) TO authenticated;
