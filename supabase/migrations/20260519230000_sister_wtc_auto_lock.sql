-- Auto-lock sister WTCs when source WTC is locked and no markup override.
-- Applies to clone_proposal_to_gcs (new sisters) and
-- apply_source_edit_to_sisters (sync resync).

-- ============================================================================
-- clone_proposal_to_gcs — auto-lock at clone time
-- ============================================================================

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
      tenant_id, signing_token, created_at
    ) VALUES (
      v_sister_id, v_source.call_log_id, 'Draft',
      v_intro, v_intro_lef,
      v_customer_name, (v_target->>'customer_id')::uuid, (v_target->>'markup_override_pct')::numeric,
      v_source.total,
      v_target->>'rfp_number',
      (v_target->>'bid_due')::date,
      (v_target->>'billing_terms')::integer,
      v_next_n, p_source_proposal_id,
      v_tenant_id, gen_random_uuid(), now()
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

-- ============================================================================
-- apply_source_edit_to_sisters — auto-resync lock state for no-override sisters
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_source_edit_to_sisters(
  p_source_proposal_id text,
  p_changed_fields     text[],
  p_force_overwrite    text[] DEFAULT '{}'::text[]
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_source      public.proposals%ROWTYPE;
  v_sister      record;
  v_field       text;
  v_force_key   text;
  v_should_skip boolean;
  v_synced      jsonb := '[]'::jsonb;
  v_skipped     jsonb := '[]'::jsonb;
  v_wtc_source  record;
  v_locked      boolean;
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_source FROM public.proposals
    WHERE id = p_source_proposal_id FOR UPDATE;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SOURCE'; END IF;
  IF v_source.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_DELETED'; END IF;

  FOR v_sister IN
    SELECT * FROM public.proposals
     WHERE cloned_from_proposal_id = p_source_proposal_id
       AND deleted_at IS NULL
       AND tenant_id = v_tenant_id
       AND status NOT IN ('Lost','Sold')
     FOR UPDATE
  LOOP
    FOREACH v_field IN ARRAY p_changed_fields LOOP
      v_force_key   := v_sister.id || ':' || v_field;
      v_should_skip := FALSE;

      IF v_field = 'intro' THEN
        IF 'intro' = ANY (COALESCE(v_sister.locally_edited_fields, '{}'))
           AND NOT (v_force_key = ANY (p_force_overwrite)) THEN
          v_should_skip := TRUE;
        END IF;

        IF v_should_skip THEN
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'sister_id', v_sister.id, 'field', v_field, 'reason','locked'));
        ELSE
          UPDATE public.proposals
             SET intro = v_source.intro
           WHERE id = v_sister.id;
          v_synced := v_synced || jsonb_build_array(jsonb_build_object(
            'sister_id', v_sister.id, 'field', v_field));

          IF 'intro' = ANY (COALESCE(v_sister.locally_edited_fields, '{}')) THEN
            UPDATE public.proposals
               SET locally_edited_fields = array_remove(locally_edited_fields, 'intro')
             WHERE id = v_sister.id;
          END IF;
        END IF;

      ELSE
        FOR v_wtc_source IN
          SELECT * FROM public.proposal_wtc WHERE proposal_id = p_source_proposal_id
        LOOP
          SELECT v_field = ANY (COALESCE(locally_edited_fields, '{}'))
            INTO v_locked
            FROM public.proposal_wtc
           WHERE proposal_id = v_sister.id
             AND cloned_from_wtc_id = v_wtc_source.id
           LIMIT 1;

          IF NOT FOUND THEN
            v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
              'sister_id', v_sister.id,
              'field', v_field,
              'scope', 'wtc:' || v_wtc_source.work_type_id::text,
              'reason', 'missing_on_sister'));
            CONTINUE;
          END IF;

          IF v_locked AND NOT (v_force_key = ANY (p_force_overwrite)) THEN
            v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
              'sister_id', v_sister.id,
              'field', v_field,
              'scope', 'wtc:' || v_wtc_source.work_type_id::text,
              'reason', 'locked'));
            CONTINUE;
          END IF;

          IF v_field = 'sales_sow' THEN
            UPDATE public.proposal_wtc SET sales_sow = v_wtc_source.sales_sow
             WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id;
          ELSIF v_field = 'size' THEN
            UPDATE public.proposal_wtc SET size = v_wtc_source.size
             WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id;
          ELSIF v_field = 'unit' THEN
            UPDATE public.proposal_wtc SET unit = v_wtc_source.unit
             WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id;
          ELSIF v_field = 'discount' THEN
            UPDATE public.proposal_wtc SET discount = v_wtc_source.discount
             WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id;
          ELSIF v_field = 'discount_reason' THEN
            UPDATE public.proposal_wtc SET discount_reason = v_wtc_source.discount_reason
             WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id;
          ELSIF v_field = 'field_sow' THEN
            UPDATE public.proposal_wtc SET field_sow = v_wtc_source.field_sow
             WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id;
          ELSIF v_field = 'materials' THEN
            UPDATE public.proposal_wtc SET materials = v_wtc_source.materials
             WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id;
          ELSIF v_field = 'sub_areas' THEN
            UPDATE public.proposal_wtc SET sub_areas = v_wtc_source.sub_areas
             WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id;
          ELSIF v_field LIKE 'travel:%' THEN
            DECLARE
              v_tkey text := substring(v_field FROM 8);
              v_tval jsonb := v_wtc_source.travel -> v_tkey;
            BEGIN
              UPDATE public.proposal_wtc
                 SET travel = jsonb_set(COALESCE(travel, '{}'::jsonb), ARRAY[v_tkey], v_tval, true)
               WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id;
            END;
          ELSE
            RAISE EXCEPTION 'UNKNOWN_FIELD: %', v_field;
          END IF;

          v_synced := v_synced || jsonb_build_array(jsonb_build_object(
            'sister_id', v_sister.id,
            'field', v_field,
            'scope', 'wtc:' || v_wtc_source.work_type_id::text));

          IF v_locked THEN
            UPDATE public.proposal_wtc
               SET locally_edited_fields = array_remove(locally_edited_fields, v_field)
             WHERE proposal_id = v_sister.id
               AND cloned_from_wtc_id = v_wtc_source.id;
          END IF;
        END LOOP;
      END IF;
    END LOOP;

    -- Auto-resync lock state + total for no-override sisters
    IF COALESCE(v_sister.markup_override_pct, 0) = 0 THEN
      UPDATE public.proposal_wtc sw
         SET locked = src.locked,
             locked_line_total = src.locked_line_total
        FROM public.proposal_wtc src
       WHERE sw.cloned_from_wtc_id = src.id
         AND sw.proposal_id = v_sister.id
         AND src.locked = true;

      UPDATE public.proposals
         SET total = (
           SELECT COALESCE(SUM(locked_line_total), 0)
             FROM public.proposal_wtc
            WHERE proposal_id = v_sister.id
         )
       WHERE id = v_sister.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'source_id', p_source_proposal_id,
    'synced',    v_synced,
    'skipped',   v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_source_edit_to_sisters(text, text[], text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_source_edit_to_sisters(text, text[], text[]) TO authenticated;
