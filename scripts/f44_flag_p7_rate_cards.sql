-- F44 one-time data fix — flag P7's three legacy rate cards (job 7215).
--
-- Proposal 72572e85 (Sent, $28,379.64) carries three T&M rate lines that were
-- entered as plain 1-hour WTCs before the is_rate_card flag existed, so the
-- F44 code fix (which keys on is_rate_card) does not reach them. Chris
-- confirmed 2026-08-10: $105 regular, $125 OT, $150 DT. Flag them explicitly by
-- id (never a heuristic sweep — a real 1-hour WTC must not be caught), then
-- recompute proposals.total excluding them → $27,999.64.
--
-- Scoped by exact WTC id AND proposal id, and asserted against the expected
-- unflagged state, so it cannot touch any other proposal even if run twice.
BEGIN;

do $$
declare v_cnt int;
begin
  select count(*) into v_cnt from public.proposal_wtc
   where proposal_id = '72572e85-98ae-476d-8067-ee5c3494fb69'
     and id in ('f220da87-539f-4730-9aa6-0cca7e86629a',
                'd4228e36-6c70-4ef7-a43b-a0d687d0d6e6',
                '9f412aec-acb2-48af-90dc-e82e1e53bec0')
     and is_rate_card = false;
  if v_cnt <> 3 then
    raise exception 'Refusing: expected 3 unflagged rate lines on proposal 72572e85, found %. Investigate before mutating.', v_cnt;
  end if;
end $$;

update public.proposal_wtc set is_rate_card = true, rate_class = 'regular', rate_amount = 105
 where id = 'f220da87-539f-4730-9aa6-0cca7e86629a';
update public.proposal_wtc set is_rate_card = true, rate_class = 'ot',      rate_amount = 125
 where id = 'd4228e36-6c70-4ef7-a43b-a0d687d0d6e6';
update public.proposal_wtc set is_rate_card = true, rate_class = 'dt',      rate_amount = 150
 where id = '9f412aec-acb2-48af-90dc-e82e1e53bec0';

-- Recompute proposals.total the same way calcProposalTotal now does: sum the
-- non-rate-card lines only (their locked_line_total is the lock-time snapshot).
update public.proposals p
   set total = (select coalesce(sum(w.locked_line_total), 0)
                  from public.proposal_wtc w
                 where w.proposal_id = p.id and w.is_rate_card = false)
 where p.id = '72572e85-98ae-476d-8067-ee5c3494fb69';

COMMIT;
