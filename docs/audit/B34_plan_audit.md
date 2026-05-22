# AUDIT — B34: Invoice resend after QB void (sales-command)

You are auditing a proposed fix BEFORE any code is written. Do not edit code.
Output the canonical audit table (# / Item / Agent rec / My take · Accept/Partial/Reject).

## Context

B33 (commit 896b09b, 2026-05-21) swapped invoice payment links from Stripe
Checkout Sessions to Stripe Payment Links. Today user pulled back invoice
#10028 (qb_invoice_id was set, status=Sent) to attach the new Payment Link.
Pull-back voided the QB invoice and nulled qb_invoice_id locally
(Invoices.jsx:1298). Re-send minted a new Payment Link but did NOT re-create
a QB record. Sync and Send now 500s because qb-sync-invoice posts
DocNumber="10028" and QB rejects duplicates (voided #10028 still owns the
DocNumber).

Current state of #10028: qb_invoice_id NULL, status=Sent. QB has voided #10028.

## Files to read first

- src/pages/Invoices.jsx
  - handlePullBack ~1250
  - handleVoidConfirm ~1272
  - handleQBSync ~1095
  - onSent ~1605
  - NewInvoiceModal next-free-ID logic ~232-244
  - edit-mode invoice_lines.invoice_id update ~1226-1231
- supabase/functions/qb-sync-invoice/index.ts
  - DocNumber set at 280
  - isUpdate gate at 123
  - error handler at 339-347
- supabase/functions/deactivate-payment-link/index.ts
- supabase/functions/send-invoice/index.ts

## Proposed plan (audit this)

### Migration
Add two columns to invoices:
- voided_at  timestamptz  (nullable, NULL = active)
- void_reason  text        (nullable)

Follow CLAUDE.md migration discipline:
scripts/check-migration-safety.sh BEFORE push; npm run db:push.

### Pull-back from QB-synced state (Invoices.jsx handlePullBack + handleVoidConfirm)

When inv.qb_invoice_id is set and user confirms void modal with reason:

1. Call qb-void-invoice (existing) with reason — voids in QB, leaves qb_invoice_id
   linked to the now-voided QB record for audit linkage.
2. UPDATE original invoice: voided_at=now, void_reason=<reason>.
   DO NOT null qb_invoice_id (keeps SC→QB voided-record link visible).
   DO NOT reset status to New.
3. Call deactivate-payment-link (existing).
4. Branch on linkedPayApp:
   (a) Pay-app linked: set pay app status=draft (already done at line 1264-1267).
       STOP. New invoice is born when pay app re-locks (existing path).
   (b) Not pay-app linked: INSERT new invoices row with
       - id = next-free-ID (reuse NewInvoiceModal:232-244 logic)
       - job_id, job_name, proposal_id, call_log_id, customer fields = copied from original
       - lines: copy each invoice_line (proposal_wtc_id, billing_pct, amount) with new invoice_id
       - intro, description = copied from original
       - status='New', sent_at=null, qb_invoice_id=null, stripe_*=null,
         voided_at=null
       Navigate to the new invoice (or refresh list).

### Refresh Stripe Link (new button on Invoices detail)

Visible next to Pull Back when status != New and stripe_payment_link_id is set.
Handler:
1. Invoke deactivate-payment-link with invoiceId.
2. Open InvoicePDFModal in send mode (existing onSent path mints fresh
   Payment Link + emails).
3. No QB touch. No qb_invoice_id changes. No voided_at change. Status stays Sent.

### qb-sync-invoice error surfacing (defense-in-depth)

In the catch at index.ts:339-347, add a branch:
- If error.message matches /Duplicate Document Number|already.*used/i,
  return { error: "qb_duplicate_docnum", message: "QB already has invoice
  #<DocNumber> (likely voided). The voided record blocks re-using the
  number. Pull back to void + replace, then retry." } with status 200.
- handleQBSync in Invoices.jsx surfaces this in syncError banner.

### Out of scope this loop (filed for follow-up)

- Job Detail VOIDED badge + reason hover (next loop)
- Manual renumber UI for edge cases
- #10028 itself — manually pull-back + re-issue after code ships

Time budget: 30 minutes (ERD loop #24 locked).

## Audit checklist — verdict each, Accept/Partial/Reject + reason

1. Does keeping qb_invoice_id on the voided row cause any code path to
   mis-treat the voided invoice as still-active? Specifically check:
   - handleQBSync (would it try to re-sync a voided invoice?)
   - qb-sync-invoice isUpdate gate (sees qb_invoice_id, tries UPDATE,
     but invoice is voided in QB — what happens?)
   - any UI showing "Sync to QB" or "Sync and Send"
   - stripe-webhook lookups
   The fix may need a `voided_at IS NULL` filter on the sync gates.

2. INSERT new invoice row copy-logic: which fields MUST copy? Check
   schema for invoices columns and identify any tenant_id / customer_id
   FK that needs to carry. Also: retention_pct, retention_amount,
   show_cents, intro, due_date — do these copy?

3. invoice_lines copy: are there fields beyond proposal_wtc_id/billing_pct/
   amount? Check the table. Any FK constraints that prevent copying?

4. Next-free-ID logic at NewInvoiceModal:232-244 — verify it correctly
   excludes the soon-to-be-voided original (it's still in the table with
   the same ID at INSERT time). Race condition if two pull-backs happen
   concurrently? Per-tenant scoping?

5. Pay-app branch: does setting pay app to draft + leaving the invoice
   voided result in the next pay-app-lock creating a new invoice with a
   fresh ID? Read the pay-app lock path (NewPayAppModal:183 or whichever
   path locks). Confirm it always creates fresh, never reuses.

6. Refresh Stripe Link button:
   - Does invoking deactivate-payment-link then re-opening PDF modal
     give the user a clean send experience? Any race / state issue?
   - Should the button also be visible when stripe_payment_link_id is
     null but stripe_checkout_url is set (legacy Checkout Session
     invoice)? Or treat that as out-of-scope?

7. Duplicate DocNum error matching: qbApi helper at index.ts:55-73
   throws "QB API <status>: <JSON>". Does the actual QB error message
   contain "Duplicate Document Number" literally? Pull from Intuit docs
   or the qb_connection error log. Suggest exact regex.

8. RLS / tenant: renumber UPDATE + INSERT on invoices respect tenant
   isolation? Run through CLAUDE_RLS.md gate.

9. Migration safety: any other prod ledger conflicts at the chosen
   timestamp? Run scripts/check-migration-safety.sh logic in your head
   against latest migrations.

10. Side-effects: anything that references invoices.id as a stable key
    that the renumber + insert-new design might break?
    - signed-proposal storage paths (no — that's proposals)
    - viewing_token URLs (per-invoice, but new invoice has its own)
    - QB PrivateNote audit lines
    - stripe-webhook (looks up by stripe_payment_id or session_id, not
      invoices.id, but confirm)

11. ERD success criterion: "Stripe Link refresh process work, QB voided
    invoice updates." Does this plan satisfy both halves?

12. Anything missing or out-of-scope-adjacent that could bite within 30m?

## Output format

Table: # | Item | Plan summary (one-line) | Verdict | Reason

End with TL;DR: Ready to build / Needs changes / Block. If "Needs changes,"
list the must-fix items in priority order.

Do not write code. Do not edit files.
