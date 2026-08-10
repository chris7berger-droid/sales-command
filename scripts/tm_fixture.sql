-- FIXTURE for the T&M billing build — docs/plans/tm_billing.md §8.1
-- Creates a throwaway TEST job + Sold proposal + 4 WTCs.
-- Inserted directly at status='Sold': every side-effect trigger on proposals is
-- AFTER UPDATE, so this fires NO approval email and NO QuickBooks job.
-- P7 (job 7215) is not touched.
BEGIN;

with j as (
  insert into public.call_log
    (job_name, job_number, display_job_number, customer_id, customer_name,
     stage, qb_skip_sync, qb_customer_id, tenant_id, customer_type, notes)
  values
    ('TEST — T&M Billing', 99001, '99001 - TEST — T&M Billing',
     '115932bd-f9e7-4919-bc7c-1caa8e4ccf5f', 'TEST TEST',
     'Sold', true, null, '246f6551-60de-4965-bb97-9a52971bc05d', 'Commercial',
     'FIXTURE for the T&M billing build (docs/plans/tm_billing.md 8). Safe to delete when the build is done. Named TEST so ProposalDetail.jsx:812 skips QuickBooks; qb_skip_sync also set.')
  returning id
), p as (
  insert into public.proposals
    (call_log_id, customer, status, total, proposal_number, tenant_id, intro)
  select j.id, 'TEST TEST', 'Sold', 2720, 1, '246f6551-60de-4965-bb97-9a52971bc05d',
         'FIXTURE - T&M billing build. Inserted directly at status Sold, so no AFTER UPDATE trigger fired: no approval email, no QuickBooks job.'
  from j
  returning id, call_log_id
), w as (
  insert into public.proposal_wtc
    (proposal_id, work_type_id, burden_rate, ot_burden_rate, regular_hours, ot_hours,
     markup_pct, size, unit, sales_sow, locked, locked_line_total, tenant_id, tax_rate)
  select p.id, v.wt, v.burden, v.ot_burden, v.hrs, 0, 0, 1, 'SQFT', v.sow, true, v.total,
         '246f6551-60de-4965-bb97-9a52971bc05d', 0
  from p, (values
    (30, 58.50, 87.75, 40.0, 2340.00, 'FIXTURE - fixed-price work. 40 hrs @ $58.50 = $2,340. This is the line that bills by PERCENT.'),
    (31, 105.00, 157.50, 1.0, 105.00,  'T&M - STRAIGHT TIME = $105 per hour. Regular time M-F / 40hr week.'),
    (31, 125.00, 187.50, 1.0, 125.00,  'T&M - TIME AND A HALF = $125 per hour. Wed-Sun.'),
    (31, 150.00, 225.00, 1.0, 150.00,  'T&M - DOUBLE TIME = $150 per hour. Nights.')
  ) as v(wt, burden, ot_burden, hrs, total, sow)
  returning proposal_id
)
select (select id from j) as call_log_id, (select id from p) as proposal_id, count(*) as wtcs from w;

COMMIT;
