-- Fix clone_proposal_to_gcs: populate customer (denormalized name) and total
-- on sister proposals. Previously both were NULL after cloning.

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

    -- F19: intro override
    IF v_target->>'intro_override' IS NOT NULL THEN
      v_intro := v_target->>'intro_override';
      v_intro_lef := ARRAY['intro'];
    ELSE
      v_intro := v_source.intro;
      v_intro_lef := '{}'::text[];
    END IF;

    -- Look up GC customer name for denormalized column
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
