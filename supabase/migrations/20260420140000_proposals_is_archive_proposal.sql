-- Distinguish "Archive Job Proposal" (lightweight, no WTC, manual amount)
-- from a standard WTC-built proposal. Archive proposals power simple
-- back-charges, recreated history, and invoicing of legacy work.

alter table public.proposals
  add column if not exists is_archive_proposal boolean not null default false;

create index if not exists proposals_is_archive_proposal_idx
  on public.proposals(is_archive_proposal)
  where is_archive_proposal = true;
