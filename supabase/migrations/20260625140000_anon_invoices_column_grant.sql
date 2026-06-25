-- T5 security #SEC1 (High) — CORRECTED enforcement of "anon can't read pay-link cols".
-- See: docs/plans/invoice_recipients.md §4.5. Supersedes the approach in
-- 20260625130000_revoke_payment_cols_from_anon.sql, which was a SILENT NO-OP.
--
-- WHY 20260625130000 DID NOTHING (verified against prod 2026-06-25 via an anon
-- REST read that still returned HTTP 200 for stripe_checkout_url):
--   `REVOKE SELECT (col) ON invoices FROM anon` has no effect when anon holds
--   TABLE-LEVEL SELECT on invoices (which it does — the public invoice page's
--   RLS needs it to return token-matching rows). In Postgres a table-level
--   SELECT grant covers every column, present and future, and a column-level
--   REVOKE cannot carve a hole out of it. To actually restrict columns you must
--   REVOKE the table-level SELECT and re-GRANT only the allowed columns.
--
-- FIX — default-deny: anon gets SELECT on ONLY the columns the public invoice
-- page (PublicInvoicePage.jsx) actually reads. None of stripe_*/qb_* are in the
-- list, so they are now physically unreadable by anon regardless of how the
-- request is crafted. This is stronger than "revoke 5 cols": any sensitive
-- column added to invoices in future stays hidden from anon unless explicitly
-- granted here.
--
-- GOTCHA: keep this column list in sync with PublicInvoicePage.jsx:33's explicit
-- select. If that page starts reading another invoices column, add it here too,
-- or the public page 401s. The only anon reader of invoices is that page
-- (PublicSigningPage/InvoicePaidPage do not query invoices — traced 2026-06-25).
-- Never `GRANT SELECT ON invoices TO anon` (blanket) — that re-opens the hole.

BEGIN;

REVOKE SELECT ON public.invoices FROM anon;

GRANT SELECT (
  id,
  proposal_id,
  job_id,
  job_name,
  status,
  amount,
  discount,
  due_date,
  paid_at,
  description,
  show_cents,
  retention_amount,
  retention_pct,
  voided_at,
  viewing_token
) ON public.invoices TO anon;

COMMIT;
