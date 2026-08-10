-- Put the T&M fixture back into an EDITABLE state.
-- Sold -> Draft does NOT fire trg_notify_proposal_approved: notify_proposal_approved()
-- returns early unless NEW.status IN ('Sold','Signed').
BEGIN;

update public.proposals
   set status = 'Draft'
 where call_log_id = 3810
   and status = 'Sold';

update public.proposal_wtc
   set locked = false, locked_line_total = null
 where proposal_id in (select id from public.proposals where call_log_id = 3810);

update public.call_log set stage = 'Has Bid' where id = 3810;

COMMIT;

select p.status, count(w.id) filter (where w.locked) as locked_wtcs, count(w.id) as total_wtcs
  from public.proposals p left join public.proposal_wtc w on w.proposal_id = p.id
 where p.call_log_id = 3810 group by p.status;
