-- T5 security #SEC1 (High) — stop shipping the live Stripe pay link to anon.
-- See: docs/plans/invoice_recipients.md §4.5 + Audit Amendments (post-T5).
--
-- The public invoice page is reached by an anon client holding the invoice's
-- shared viewing_token. Removing the page's Pay button (§4.5) was not enough:
-- a `select("*")` still returned stripe_checkout_url — a live, payable Stripe
-- Payment Link — to every viewer's browser, readable from the Network tab.
-- A viewer could pay from it, the exact double-pay this feature prevents.
--
-- The client select on PublicInvoicePage.jsx:33 was narrowed to omit these
-- columns, but that alone leaves a hand-crafted-anon-request hole (the anon
-- key is in the bundle; RLS is row-level, not column-level). This column-level
-- REVOKE is the real boundary — it makes these columns physically unreadable
-- by the `anon` role regardless of how the request is crafted.
--
-- GOTCHA 1: FROM anon ONLY — never FROM public. FROM public would strip the
--   `authenticated` role too and break the internal app, which legitimately
--   reads these columns (Invoices.jsx void/QB/resend flows).
-- GOTCHA 2: do NOT add a blanket `GRANT SELECT ON invoices TO anon` after this
--   — that would re-expose the columns. This migration is self-contained.
--
-- Non-breaking (anon surface fully traced 2026-06-25): the only anon readers
-- are PublicInvoicePage (now omits these columns) and PublicSigningPage (never
-- queries invoices). Edge fns use service_role (unaffected by anon grants).
-- Composes with the existing invoices_public_view_token ROW policy — this is
-- the column-privilege layer, a separate mechanism from RLS policies.

REVOKE SELECT (
  stripe_checkout_url,
  stripe_payment_link_id,
  stripe_checkout_id,
  qb_invoice_id,
  qb_payment_id
) ON public.invoices FROM anon;
