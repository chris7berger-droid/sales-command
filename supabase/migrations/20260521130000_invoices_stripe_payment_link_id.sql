-- Add stripe_payment_link_id to invoices for the Payment Links swap (B33).
-- Payment Links replace Checkout Sessions (which had a 24h hard cap on link
-- lifetime). The new column stores the `plink_*` ID so we can deactivate
-- the link when the invoice is paid, voided, or pulled back.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS stripe_payment_link_id TEXT;

COMMENT ON COLUMN public.invoices.stripe_payment_link_id IS
  'Stripe Payment Link ID (plink_*). Set by send-invoice; cleared on paid/void/pullback. Null for legacy invoices (Checkout Session era).';
