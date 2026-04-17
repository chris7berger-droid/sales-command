-- Cache generated invoice PDF URL so we don't re-upload on every pay app
-- send. Populated lazily by the client when the invoice PDF is first
-- generated (see src/lib/invoicePdf.js).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pdf_url text;
