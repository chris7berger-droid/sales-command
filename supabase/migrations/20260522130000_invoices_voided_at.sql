-- B34: Invoice void audit record
--
-- Pull-back of a QB-synced invoice currently mutates the row in place (voids
-- in QB, nulls qb_invoice_id, resets status to New). Re-sync then fails with
-- a duplicate-DocNumber 500 because QB permanently claims the voided number.
--
-- New design: pull-back marks the original row as voided (preserving the
-- QB link for audit) and an insert creates the replacement at the next free
-- invoice ID. Aggregators across the app filter on voided_at IS NULL.
--
-- Columns are nullable so existing rows are treated as active by default.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS voided_at  timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text;

COMMENT ON COLUMN public.invoices.voided_at IS
  'Set when invoice is pulled back / voided in QB. NULL = active row. Aggregators must filter on voided_at IS NULL.';

COMMENT ON COLUMN public.invoices.void_reason IS
  'Reason text captured at void time (audit compliance). Mirrors the [VOIDED] PrivateNote written to the QB record.';
