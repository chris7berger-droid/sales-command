-- Teardown for the F44 signing-page render fixture (job 998).
-- Scoped by job_number 998 AND its resolved id, so it cannot reach any live job.
BEGIN;

do $$
declare v_id bigint;
begin
  select id into v_id from public.call_log where job_number = 998;
  if v_id is null then
    raise notice 'F44 render fixture (job 998) not found — nothing to tear down.';
    return;
  end if;

  delete from public.proposal_wtc where proposal_id in (select id from public.proposals where call_log_id = v_id);
  delete from public.proposals     where call_log_id = v_id;
  delete from public.job_work_types where call_log_id = v_id;
  delete from public.call_log       where id = v_id and job_number = 998;
end $$;

COMMIT;
