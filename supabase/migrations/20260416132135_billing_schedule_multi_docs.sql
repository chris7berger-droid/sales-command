-- Allow multiple contract documents per billing schedule.
-- Keeps the existing contract_pdf_url column (single) as-is for zero-downtime
-- while adding contract_pdf_urls (array). Backfill moves existing single URLs
-- into the array so the new UI can render both.

alter table public.billing_schedule
  add column if not exists contract_pdf_urls text[] not null default '{}';

-- Backfill: any row with an existing contract_pdf_url gets that URL seeded
-- into the new array (if not already present).
update public.billing_schedule
   set contract_pdf_urls = array[contract_pdf_url]
 where contract_pdf_url is not null
   and (contract_pdf_urls is null or array_length(contract_pdf_urls, 1) is null);
