-- Reset the T&M fixture's fixed-price line back to Specialty.
-- It was switched to a T&M work type during smoke, which flipped it into a rate
-- card. Identified by its shape (40 hrs @ 58.50), not by work_type_id, since the
-- work_type_id is exactly what changed.
BEGIN;

update public.proposal_wtc
   set work_type_id = 30,          -- Specialty (global)
       is_rate_card = false,
       rate_class   = null,
       rate_amount  = null
 where proposal_id in (select id from public.proposals where call_log_id = 3810)
   and regular_hours = 40
   and burden_rate   = 58.50;

COMMIT;

select w.work_type_id, t.name as work_type, w.regular_hours, w.burden_rate,
       w.is_rate_card, w.rate_class, w.rate_amount
  from public.proposal_wtc w
  left join public.work_types t on t.id = w.work_type_id
 where w.proposal_id in (select id from public.proposals where call_log_id = 3810)
 order by w.burden_rate;
