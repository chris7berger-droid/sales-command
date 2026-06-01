-- Per-invoice retention release (ERD loop #30).
--
-- Today the app handles the WITHHOLD side of retention end-to-end but has no
-- RELEASE side: held-back dollars (routed to an Other Current Asset in QB) can
-- never be billed back to the customer. This adds the two columns the release
-- path needs:
--
--   retention_release_of — when non-null, THIS row is a retention release
--     invoice and the value is the source invoice's id (link back + "is a
--     release" flag in one column). FK clauses mirror the sibling invoice FKs
--     (invoice_lines.invoice_id, billing_schedule_pay_apps.invoice_id) for
--     house-style consistency; no code path renumbers invoices.id or hard-
--     deletes invoice rows, so both clauses are harmless no-ops here.
--
--   retention_released — flips true on the SOURCE invoice once its retention
--     has been billed, so the "Bill Retention" button can't double-bill. On the
--     active retention_* convention (the legacy retainage_released stub is left
--     untouched).
--
-- Both additive + nullable/defaulted so existing rows are unaffected.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS retention_release_of text
    REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS retention_released boolean DEFAULT false;

COMMENT ON COLUMN public.invoices.retention_release_of IS
  'Non-null => this row is a retention release invoice; value is the source invoice id. QB sync emits a single positive retention-item line for these rows.';

COMMENT ON COLUMN public.invoices.retention_released IS
  'Set true on a source invoice once its held retention has been billed via the Bill Retention button. Prevents double-billing. Active retention_* convention (not the legacy retainage_released stub).';
