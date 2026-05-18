-- Migration 6b — Multi-GC RPCs + award/reverse columns
--
-- RPCs: clone_proposal_to_gcs, preview_sync_to_sisters,
--        apply_source_edit_to_sisters, award_proposal, reverse_award
--
-- Schema: proposals.pre_sold_status, proposals.pre_lost_status
--         (capture status before award flips, used by reverse_award)

-- ============================================================================
-- Schema additions for award reversal
-- ============================================================================

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS pre_sold_status text,
  ADD COLUMN IF NOT EXISTS pre_lost_status text;

-- ============================================================================
-- clone_proposal_to_gcs
-- ============================================================================
-- Clones a source proposal to N target GCs. Each sister gets its own
-- proposal row + cloned WTC rows with lineage (cloned_from_wtc_id).
-- Nested cloning (source is itself a sister) is rejected.

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

  SELECT COALESCE(MAX(proposal_number), 0) INTO v_next_n
    FROM public.proposals
   WHERE call_log_id = v_source.call_log_id
     AND deleted_at IS NULL;

  FOR v_target IN SELECT * FROM jsonb_array_elements(p_targets)
  LOOP
    v_next_n := v_next_n + 1;
    v_sister_id := gen_random_uuid()::text;

    INSERT INTO public.proposals (
      id, call_log_id, status,
      intro,
      customer_id, markup_override_pct,
      proposal_number, cloned_from_proposal_id,
      tenant_id, signing_token, created_at
    ) VALUES (
      v_sister_id, v_source.call_log_id, 'Draft',
      v_source.intro,
      (v_target->>'customer_id')::uuid, (v_target->>'markup_override_pct')::numeric,
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
      false, NULL,
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
-- preview_sync_to_sisters
-- ============================================================================
-- Read-only. Reports which source-driven fields differ on each sister,
-- split into pending (auto-sync) vs conflicts (locally edited).
-- Join key: cloned_from_wtc_id (lineage), not work_type_id.

CREATE OR REPLACE FUNCTION public.preview_sync_to_sisters(p_source_proposal_id text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant_id     uuid;
  v_source        public.proposals%ROWTYPE;
  v_result        jsonb := jsonb_build_object('sisters', '[]'::jsonb);
  v_sister        record;
  v_sister_obj    jsonb;
  v_pending       jsonb;
  v_conflicts     jsonb;
  v_wtc_source    record;
  v_wtc_sister    record;
  v_travel_key    text;
  v_customer_name text;
  v_travel_keys   text[] := ARRAY[
    'drive_rate','drive_miles','fly_rate','fly_tickets',
    'stay_rate','stay_nights','per_diem_rate','per_diem_days','per_diem_crew'
  ];
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_source FROM public.proposals
    WHERE id = p_source_proposal_id;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SOURCE'; END IF;
  IF v_source.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_DELETED'; END IF;

  FOR v_sister IN
    SELECT * FROM public.proposals
     WHERE cloned_from_proposal_id = p_source_proposal_id
       AND deleted_at IS NULL
       AND tenant_id = v_tenant_id
       AND status NOT IN ('Lost','Sold')
  LOOP
    v_pending   := '[]'::jsonb;
    v_conflicts := '[]'::jsonb;

    SELECT c.name INTO v_customer_name
      FROM public.customers c WHERE c.id = v_sister.customer_id;

    -- proposal-scope: intro
    IF v_source.intro IS DISTINCT FROM v_sister.intro THEN
      IF 'intro' = ANY (COALESCE(v_sister.locally_edited_fields, '{}')) THEN
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'field','intro','scope','proposal',
          'source_value', to_jsonb(v_source.intro),
          'sister_value', to_jsonb(v_sister.intro)
        ));
      ELSE
        v_pending := v_pending || jsonb_build_array(jsonb_build_object(
          'field','intro','scope','proposal'));
      END IF;
    END IF;

    -- wtc-scope: walk source WTCs, join sister WTCs by lineage
    FOR v_wtc_source IN
      SELECT * FROM public.proposal_wtc WHERE proposal_id = p_source_proposal_id
    LOOP
      SELECT * INTO v_wtc_sister
        FROM public.proposal_wtc
       WHERE proposal_id = v_sister.id
         AND cloned_from_wtc_id = v_wtc_source.id
       LIMIT 1;

      IF v_wtc_sister.id IS NULL THEN
        CONTINUE;
      END IF;

      -- scalars
      IF v_wtc_source.sales_sow IS DISTINCT FROM v_wtc_sister.sales_sow THEN
        IF 'sales_sow' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'field','sales_sow',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', to_jsonb(v_wtc_source.sales_sow),
            'sister_value', to_jsonb(v_wtc_sister.sales_sow)));
        ELSE
          v_pending := v_pending || jsonb_build_array(jsonb_build_object(
            'field','sales_sow','scope','wtc:' || v_wtc_source.work_type_id::text));
        END IF;
      END IF;

      IF v_wtc_source.size IS DISTINCT FROM v_wtc_sister.size THEN
        IF 'size' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'field','size',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', to_jsonb(v_wtc_source.size),
            'sister_value', to_jsonb(v_wtc_sister.size)));
        ELSE
          v_pending := v_pending || jsonb_build_array(jsonb_build_object(
            'field','size','scope','wtc:' || v_wtc_source.work_type_id::text));
        END IF;
      END IF;

      IF v_wtc_source.unit IS DISTINCT FROM v_wtc_sister.unit THEN
        IF 'unit' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'field','unit',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', to_jsonb(v_wtc_source.unit),
            'sister_value', to_jsonb(v_wtc_sister.unit)));
        ELSE
          v_pending := v_pending || jsonb_build_array(jsonb_build_object(
            'field','unit','scope','wtc:' || v_wtc_source.work_type_id::text));
        END IF;
      END IF;

      IF v_wtc_source.discount IS DISTINCT FROM v_wtc_sister.discount THEN
        IF 'discount' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'field','discount',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', to_jsonb(v_wtc_source.discount),
            'sister_value', to_jsonb(v_wtc_sister.discount)));
        ELSE
          v_pending := v_pending || jsonb_build_array(jsonb_build_object(
            'field','discount','scope','wtc:' || v_wtc_source.work_type_id::text));
        END IF;
      END IF;

      IF v_wtc_source.discount_reason IS DISTINCT FROM v_wtc_sister.discount_reason THEN
        IF 'discount_reason' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'field','discount_reason',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', to_jsonb(v_wtc_source.discount_reason),
            'sister_value', to_jsonb(v_wtc_sister.discount_reason)));
        ELSE
          v_pending := v_pending || jsonb_build_array(jsonb_build_object(
            'field','discount_reason','scope','wtc:' || v_wtc_source.work_type_id::text));
        END IF;
      END IF;

      -- jsonb columns (column-level)
      IF v_wtc_source.field_sow::jsonb IS DISTINCT FROM v_wtc_sister.field_sow::jsonb THEN
        IF 'field_sow' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'field','field_sow',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', v_wtc_source.field_sow,
            'sister_value', v_wtc_sister.field_sow));
        ELSE
          v_pending := v_pending || jsonb_build_array(jsonb_build_object(
            'field','field_sow','scope','wtc:' || v_wtc_source.work_type_id::text));
        END IF;
      END IF;

      IF v_wtc_source.materials::jsonb IS DISTINCT FROM v_wtc_sister.materials::jsonb THEN
        IF 'materials' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'field','materials',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', v_wtc_source.materials,
            'sister_value', v_wtc_sister.materials));
        ELSE
          v_pending := v_pending || jsonb_build_array(jsonb_build_object(
            'field','materials','scope','wtc:' || v_wtc_source.work_type_id::text));
        END IF;
      END IF;

      IF v_wtc_source.sub_areas::jsonb IS DISTINCT FROM v_wtc_sister.sub_areas::jsonb THEN
        IF 'sub_areas' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'field','sub_areas',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', v_wtc_source.sub_areas,
            'sister_value', v_wtc_sister.sub_areas));
        ELSE
          v_pending := v_pending || jsonb_build_array(jsonb_build_object(
            'field','sub_areas','scope','wtc:' || v_wtc_source.work_type_id::text));
        END IF;
      END IF;

      -- travel (key-level)
      FOREACH v_travel_key IN ARRAY v_travel_keys LOOP
        IF (v_wtc_source.travel -> v_travel_key) IS DISTINCT FROM (v_wtc_sister.travel -> v_travel_key) THEN
          IF ('travel:' || v_travel_key) = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
              'field','travel:' || v_travel_key,
              'scope','wtc:' || v_wtc_source.work_type_id::text,
              'source_value', v_wtc_source.travel -> v_travel_key,
              'sister_value', v_wtc_sister.travel -> v_travel_key));
          ELSE
            v_pending := v_pending || jsonb_build_array(jsonb_build_object(
              'field','travel:' || v_travel_key,
              'scope','wtc:' || v_wtc_source.work_type_id::text));
          END IF;
        END IF;
      END LOOP;
    END LOOP;

    v_sister_obj := jsonb_build_object(
      'sister_id', v_sister.id,
      'customer_name', COALESCE(v_customer_name, 'Proposal #' || v_sister.proposal_number::text),
      'pending',   v_pending,
      'conflicts', v_conflicts
    );
    v_result := jsonb_set(v_result, '{sisters}',
                          (v_result->'sisters') || v_sister_obj);
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_sync_to_sisters(text) FROM public;
GRANT EXECUTE ON FUNCTION public.preview_sync_to_sisters(text) TO authenticated;

-- ============================================================================
-- apply_source_edit_to_sisters
-- ============================================================================
-- Writes source values into sisters. Skips locally-edited fields unless
-- force-overwritten. Join key: cloned_from_wtc_id (lineage).

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

-- ============================================================================
-- award_proposal
-- ============================================================================
-- Picks a winner among sisters under the same call_log. Winner -> Sold,
-- sisters -> Lost. Captures pre-award status on both sides for reversal.

CREATE OR REPLACE FUNCTION public.award_proposal(
  p_winner_proposal_id text,
  p_lost_reason        text DEFAULT 'Lost to other GC'
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_winner      public.proposals%ROWTYPE;
  v_call_log_id integer;
  v_sister_ids  text[];
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_winner FROM public.proposals
    WHERE id = p_winner_proposal_id FOR UPDATE;
  IF v_winner.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_WINNER'; END IF;
  IF v_winner.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;

  v_call_log_id := v_winner.call_log_id;

  -- Capture + flip winner
  UPDATE public.proposals
     SET pre_sold_status = status,
         status = 'Sold',
         approved_at = now()
   WHERE id = p_winner_proposal_id;

  -- Capture + flip sisters
  UPDATE public.proposals
     SET pre_lost_status = status,
         status = 'Lost',
         lost_reason = p_lost_reason,
         lost_at = now()
   WHERE call_log_id = v_call_log_id
     AND id <> p_winner_proposal_id
     AND deleted_at IS NULL
     AND status NOT IN ('Sold','Lost')
   RETURNING id INTO v_sister_ids;

  UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;

  RETURN jsonb_build_object(
    'winner_id', p_winner_proposal_id,
    'sisters_lost', v_sister_ids,
    'call_log_id', v_call_log_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.award_proposal(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.award_proposal(text, text) TO authenticated;

-- ============================================================================
-- reverse_award
-- ============================================================================
-- Undoes award_proposal. Winner reverts to pre_sold_status, sisters revert
-- to pre_lost_status, call_log reverts to 'Has Bid'.

CREATE OR REPLACE FUNCTION public.reverse_award(
  p_call_log_id integer
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id    uuid;
  v_winner_id    text;
  v_reverted_ids text[];
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  -- Verify tenant owns this call_log
  IF NOT EXISTS (
    SELECT 1 FROM public.call_log
     WHERE id = p_call_log_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND_OR_TENANT_MISMATCH';
  END IF;

  -- Revert winner (the Sold proposal)
  UPDATE public.proposals
     SET status = COALESCE(pre_sold_status, 'Sent'),
         pre_sold_status = NULL,
         approved_at = NULL
   WHERE call_log_id = p_call_log_id
     AND status = 'Sold'
     AND deleted_at IS NULL
     AND tenant_id = v_tenant_id
   RETURNING id INTO v_winner_id;

  -- Revert sisters (the Lost proposals from this award)
  UPDATE public.proposals
     SET status = COALESCE(pre_lost_status, 'Sent'),
         pre_lost_status = NULL,
         lost_reason = NULL,
         lost_at = NULL
   WHERE call_log_id = p_call_log_id
     AND status = 'Lost'
     AND pre_lost_status IS NOT NULL
     AND deleted_at IS NULL
     AND tenant_id = v_tenant_id
   RETURNING id INTO v_reverted_ids;

  UPDATE public.call_log SET stage = 'Has Bid' WHERE id = p_call_log_id;

  RETURN jsonb_build_object(
    'winner_reverted', v_winner_id,
    'sisters_reverted', v_reverted_ids,
    'call_log_id', p_call_log_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_award(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.reverse_award(integer) TO authenticated;
