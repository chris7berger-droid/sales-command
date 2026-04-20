-- Per-invoice retention. retention_pct is the entered value (e.g. 10 for 10%).
-- retention_amount is the dollar value held back, computed at save time.
alter table public.invoices
  add column if not exists retention_pct numeric default 0,
  add column if not exists retention_amount numeric default 0;
