-- Teardown for the T&M billing fixture — docs/plans/tm_billing.md §8.1a
--
-- Removes job 99001 and everything hanging off it. Run when the build is done;
-- the fixture is disposable and nothing should be built to depend on it.
--
--   supabase db query --linked -f scripts/tm_fixture_teardown.sql
--
-- Scoped by job_number AND asserted against the known id, so it cannot reach
-- P7 (job 7215 / call_log 3791) or any other live job even if run by mistake.
BEGIN;

do $$
declare v_id bigint;
begin
  select id into v_id from public.call_log where job_number = 99001;
  if v_id is null then
    raise notice 'Fixture job 99001 not found — nothing to tear down.';
  elsif v_id <> 3810 then
    raise exception 'Refusing: job_number 99001 resolves to call_log.id=% (expected 3810). Investigate before deleting anything.', v_id;
  end if;
end $$;

delete from public.invoice_lines
 where invoice_id in (select id from public.invoices where call_log_id = 3810);
delete from public.invoices       where call_log_id = 3810;
delete from public.proposal_wtc   where proposal_id in (select id from public.proposals where call_log_id = 3810);
delete from public.proposals      where call_log_id = 3810;
delete from public.job_work_types where call_log_id = 3810;
delete from public.call_log       where id = 3810 and job_number = 99001;

COMMIT;
