-- Track archive provenance on call_log so we can show an "Archive" badge
-- and warn that no proposal exists. Was previously on proposals.archive_record_id;
-- moved here when we stopped auto-creating skeleton proposals on import.

alter table public.call_log
  add column if not exists archive_record_id uuid references archive.legacy_records(id) on delete set null;

create index if not exists call_log_archive_record_id_idx
  on public.call_log(archive_record_id)
  where archive_record_id is not null;
