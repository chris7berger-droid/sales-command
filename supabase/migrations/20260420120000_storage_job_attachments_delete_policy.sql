-- Allow authenticated users to DELETE objects in the job-attachments bucket.
-- Without this, supabase.storage.remove() silently no-ops (returns empty data array).

create policy "Authenticated can delete job-attachments"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'job-attachments');
