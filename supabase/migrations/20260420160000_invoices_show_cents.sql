-- Per-invoice cents override. NULL = inherit from call_log.show_cents.
alter table public.invoices
  add column if not exists show_cents boolean;
