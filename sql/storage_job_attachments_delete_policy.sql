-- Allow authenticated users to DELETE objects in the job-attachments bucket.
-- Run this in Supabase Studio > SQL Editor.
-- Supabase already has INSERT/SELECT policies in place for upload/list to work;
-- DELETE was never added, which causes storage.remove() to silently no-op.

create policy "Authenticated can delete job-attachments"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'job-attachments');
