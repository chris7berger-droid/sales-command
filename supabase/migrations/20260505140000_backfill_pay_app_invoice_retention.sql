-- One-time backfill: NewPayAppModal was writing retention to columns
-- named retainage_pct/retainage_amount, which don't exist on the invoices
-- table — the actual columns are retention_pct/retention_amount. Existing
-- pay-app invoices therefore have retention = 0 even when the linked pay
-- app has retainage_withheld > 0. Backfill from the pay app.

UPDATE public.invoices i
SET retention_pct    = pa.retainage_pct_snapshot,
    retention_amount = pa.retainage_withheld
FROM public.billing_schedule_pay_apps pa
WHERE pa.invoice_id = i.id
  AND COALESCE(i.retention_amount, 0) = 0
  AND COALESCE(pa.retainage_withheld, 0) > 0;
