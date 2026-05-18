-- §10 step 7: proposal_wtc locally_edited_fields auto-population trigger
-- Companion to proposals_track_local_edits (Migration 1a line 118-147).
-- Fires on sister WTC edits; appends changed field names so sync RPCs
-- know which fields the sister has locally overridden.

CREATE OR REPLACE FUNCTION public.proposal_wtc_track_local_edits()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_cloned_from text;
  v_fields      text[];
  v_key         text;
  v_travel_keys text[] := ARRAY[
    'drive_rate','drive_miles',
    'fly_rate','fly_tickets',
    'stay_rate','stay_nights',
    'per_diem_rate','per_diem_days','per_diem_crew'
  ];
BEGIN
  SELECT cloned_from_proposal_id INTO v_cloned_from
    FROM public.proposals
   WHERE id = NEW.proposal_id;

  IF v_cloned_from IS NULL THEN
    RETURN NEW;
  END IF;

  v_fields := COALESCE(NEW.locally_edited_fields, '{}');

  -- Scalar columns
  IF NEW.sales_sow IS DISTINCT FROM OLD.sales_sow
     AND NOT ('sales_sow' = ANY(v_fields)) THEN
    v_fields := array_append(v_fields, 'sales_sow');
  END IF;

  IF NEW.size IS DISTINCT FROM OLD.size
     AND NOT ('size' = ANY(v_fields)) THEN
    v_fields := array_append(v_fields, 'size');
  END IF;

  IF NEW.unit IS DISTINCT FROM OLD.unit
     AND NOT ('unit' = ANY(v_fields)) THEN
    v_fields := array_append(v_fields, 'unit');
  END IF;

  IF NEW.discount IS DISTINCT FROM OLD.discount
     AND NOT ('discount' = ANY(v_fields)) THEN
    v_fields := array_append(v_fields, 'discount');
  END IF;

  IF NEW.discount_reason IS DISTINCT FROM OLD.discount_reason
     AND NOT ('discount_reason' = ANY(v_fields)) THEN
    v_fields := array_append(v_fields, 'discount_reason');
  END IF;

  -- Jsonb columns (column-level granularity)
  IF NEW.field_sow::jsonb IS DISTINCT FROM OLD.field_sow::jsonb
     AND NOT ('field_sow' = ANY(v_fields)) THEN
    v_fields := array_append(v_fields, 'field_sow');
  END IF;

  IF NEW.materials::jsonb IS DISTINCT FROM OLD.materials::jsonb
     AND NOT ('materials' = ANY(v_fields)) THEN
    v_fields := array_append(v_fields, 'materials');
  END IF;

  IF NEW.sub_areas::jsonb IS DISTINCT FROM OLD.sub_areas::jsonb
     AND NOT ('sub_areas' = ANY(v_fields)) THEN
    v_fields := array_append(v_fields, 'sub_areas');
  END IF;

  -- Travel: sub-key granularity
  FOREACH v_key IN ARRAY v_travel_keys LOOP
    IF (NEW.travel -> v_key) IS DISTINCT FROM (OLD.travel -> v_key)
       AND NOT (('travel:' || v_key) = ANY(v_fields)) THEN
      v_fields := array_append(v_fields, 'travel:' || v_key);
    END IF;
  END LOOP;

  NEW.locally_edited_fields := v_fields;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposal_wtc_track_local_edits ON public.proposal_wtc;
CREATE TRIGGER trg_proposal_wtc_track_local_edits
  BEFORE UPDATE OF sales_sow, field_sow, materials, sub_areas,
                    size, unit, discount, discount_reason, travel
  ON public.proposal_wtc
  FOR EACH ROW
  EXECUTE FUNCTION public.proposal_wtc_track_local_edits();
