-- Capture historical billing on archive-imported jobs.
-- Without this, the New Invoice modal's "Already billed" only counts in-system
-- invoices, so an archived job that was fully or partially billed before import
-- always looks fully open. Stored as a flat dollar amount, not line items.

alter table public.proposals
  add column if not exists historical_billed_amount numeric not null default 0;
