-- F44 signing-page RENDER fixture — a throwaway proposal so Chris can see how a
-- rate card renders on the public signing page WITHOUT touching the real P7
-- proposal (72572e85). Job 998: below the live sequence (~10233) so it cannot
-- become max(job_number) and hijack the next real job number (the 99001 incident).
--
-- One contract line ($27,999.64) + three rate cards (reg/OT/DT). Status 'Sent'
-- with a known signing token so the URL is /sign/<token>.
-- Tear down with scripts/f44_signing_render_fixture_teardown.sql when done.
BEGIN;

do $$
declare v_exists int;
begin
  select count(*) into v_exists from public.call_log where job_number = 998;
  if v_exists > 0 then
    raise exception 'Refusing: job_number 998 already exists — pick another or tear down first.';
  end if;
end $$;

with t as (select id as tid from public.tenant_config limit 1),
wt as (select min(id) as wid from public.work_types),
ins_cl as (
  insert into public.call_log
    (job_number, display_job_number, job_name, customer_name, sales_name, stage, tenant_id, created_at)
  select 998, '998', 'ZZ F44 RENDER TEST — delete me', 'Test Customer (F44)', 'Test Rep', 'Proposal', t.tid, now()
  from t
  returning id, tenant_id
),
ins_p as (
  insert into public.proposals
    (id, call_log_id, tenant_id, status, total, customer,
     signing_token, signing_token_expires_at, created_at)
  select gen_random_uuid()::text, ins_cl.id, ins_cl.tenant_id, 'Sent', 27999.64,
         'Test Customer (F44)',
         '00000000-0000-4000-8000-0000000f44ff'::uuid, now() + interval '3 days', now()
  from ins_cl
  returning id, tenant_id
)
insert into public.proposal_wtc
  (proposal_id, tenant_id, work_type_id, is_rate_card, rate_class, rate_amount,
   sales_sow, locked_line_total, locked, burden_rate, regular_hours, created_at)
select ins_p.id, ins_p.tenant_id, wt.wid, false, null,      null, 'Furnish and install roofing membrane and flashing per specification.', 27999.64, true, 58.50, 1, now()               from ins_p, wt
union all
select ins_p.id, ins_p.tenant_id, wt.wid, true,  'regular', 105,  'T&M labor — straight time, billed as incurred.',                       105,      true, 56.50, 1, now() + interval '1 sec' from ins_p, wt
union all
select ins_p.id, ins_p.tenant_id, wt.wid, true,  'ot',      125,  'T&M labor — overtime, billed as incurred.',                            125,      true, 56.50, 1, now() + interval '2 sec' from ins_p, wt
union all
select ins_p.id, ins_p.tenant_id, wt.wid, true,  'dt',      150,  'T&M labor — double time, billed as incurred.',                         150,      true, 56.50, 1, now() + interval '3 sec' from ins_p, wt;

COMMIT;

-- Echo the link path.
select '/sign/00000000-0000-4000-8000-0000000f44ff' as signing_path;
