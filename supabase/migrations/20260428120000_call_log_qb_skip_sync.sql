-- Per-job override flag to skip QuickBooks auto-sync.
-- Backfills true on every existing archive-imported job (archive_record_id is not null)
-- so the existing Archive Job Proposal flow stops double-posting to QB.
-- For fine-grained per-proposal control, the edge functions OR this with
-- proposals.is_archive_proposal — archive-style proposals always skip regardless.

alter table public.call_log
  add column if not exists qb_skip_sync boolean not null default false;

update public.call_log
   set qb_skip_sync = true
 where archive_record_id is not null
   and qb_skip_sync = false;

create index if not exists call_log_qb_skip_sync_idx
  on public.call_log(qb_skip_sync)
  where qb_skip_sync = true;
