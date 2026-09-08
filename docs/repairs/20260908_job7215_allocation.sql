-- Targeted DATA repair, not a schema migration. Authorized by Chris 2026-09-08.
-- Move only the saved October 12-13 allocation from folded 1199 to main 1150.
-- Run with supabase db query --linked --file <this-file> from command-suite-db.
-- Rehearse by replacing the final COMMIT with ROLLBACK in a temporary copy.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

DO $repair$
DECLARE
  v_before public.job_mobilizations%ROWTYPE;
  v_after public.job_mobilizations%ROWTYPE;
  v_target public.jobs%ROWTYPE;
  v_source public.jobs%ROWTYPE;
  v_seq integer;
  v_tenant uuid;
BEGIN
  -- Lock both parents in stable order and the allocation before checking state.
  PERFORM job_id FROM public.jobs WHERE job_id IN (1150,1199) ORDER BY job_id FOR UPDATE;
  SELECT * INTO STRICT v_target FROM public.jobs WHERE job_id=1150;
  SELECT * INTO STRICT v_source FROM public.jobs WHERE job_id=1199;
  SELECT * INTO STRICT v_before FROM public.job_mobilizations
    WHERE id='45ad5024-45e2-4cdf-a470-d7f50835df05' FOR UPDATE;

  IF v_target.call_log_id IS DISTINCT FROM 3791
     OR v_source.call_log_id IS DISTINCT FROM 3791
     OR v_target.merged_into_job_id IS NOT NULL
     OR v_source.merged_into_job_id IS DISTINCT FROM 1150
     OR v_target.deleted='Yes' THEN
    RAISE EXCEPTION 'Job relationships changed; stop and inspect before repair';
  END IF;
  IF v_before.start_date IS DISTINCT FROM DATE '2026-10-12'
     OR v_before.end_date IS DISTINCT FROM DATE '2026-10-13'
     OR v_before.lead IS DISTINCT FROM 'Bash Dave'
     OR v_before.crew_needed IS DISTINCT FROM 3
     OR v_before.label IS DISTINCT FROM 'WTC1 - Concrete Sealing' THEN
    RAISE EXCEPTION 'Allocation details changed; stop and inspect before repair';
  END IF;
  IF v_before.job_id=1150 THEN
    RAISE NOTICE 'Already repaired; no change';
    RETURN;
  END IF;
  IF v_before.job_id IS DISTINCT FROM 1199 OR v_before.seq IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Allocation identity changed; stop';
  END IF;

  -- Verified empty before authoring; fail rather than guess how to move any new
  -- dependencies or rewrite SOW sequence tags. Holding the allocation row lock
  -- prevents concurrent FK inserts from attaching new dependents during the move.
  IF EXISTS (SELECT 1 FROM public.assignments WHERE mobilization_id=v_before.id)
     OR EXISTS (SELECT 1 FROM public.pull_tickets WHERE job_mobilization_id=v_before.id)
     OR EXISTS (SELECT 1 FROM public.job_mobilization_sow_versions WHERE mobilization_id=v_before.id)
     OR EXISTS (SELECT 1 FROM public.job_wtcs WHERE job_id IN (1150,1199))
     OR v_source.field_sow IS NOT NULL OR v_target.field_sow IS NOT NULL THEN
    RAISE EXCEPTION 'Dependent records/SOW changed; this narrow repair is no longer sufficient';
  END IF;
  SELECT coalesce(max(seq),0)+1 INTO v_seq FROM public.job_mobilizations WHERE job_id=1150;
  UPDATE public.job_mobilizations SET job_id=1150,seq=v_seq WHERE id=v_before.id
    RETURNING * INTO STRICT v_after;

  -- Assert every other business field, including UUID, dates, lead and flags,
  -- was preserved. updated_at is intentionally refreshed by the existing trigger.
  IF (to_jsonb(v_before)-ARRAY['job_id','seq','updated_at'])
       IS DISTINCT FROM (to_jsonb(v_after)-ARRAY['job_id','seq','updated_at']) THEN
    RAISE EXCEPTION 'Unexpected field change; rolling back';
  END IF;
  SELECT tenant_id INTO STRICT v_tenant FROM public.call_log WHERE id=3791;
  INSERT INTO public.job_changes(job_id,call_log_id,field,old_value,new_value,changed_by,source,tenant_id)
    VALUES(1150,3791,'allocation.parent_repaired',to_jsonb(v_before)::text,to_jsonb(v_after)::text,
      'Codex (authorized by Chris)','codex_job7215_repair',v_tenant);
END;
$repair$;

COMMIT;
