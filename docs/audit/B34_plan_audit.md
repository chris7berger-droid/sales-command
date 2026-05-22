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

---

## Round 2 Revisions (post-audit, 2026-05-22)

Round 1 audit verdict: NEEDS CHANGES. AUDIT_LOG row:
`| 2026-05-22 | feat/b34-invoice-void-record @ 72d04a2 (plan doc) | 6 | 0 Crit, 3 P0, 2 P1, 1 P2 | accepted-pending-changes | aggregation-blind-spot |`

Original plan is preserved above. Deltas below — re-audit against this section.

### P0.1 — Aggregator queries must filter voided rows

Add `.is("voided_at", null)` alongside any existing `.is("deleted_at", null)` in:

- `src/components/CallLogDetail.jsx:185` — linked invoices for Job Detail
- `src/components/ProposalDetail.jsx:59, 460, 483, 521` — proposal totals + invoice listings
- `src/components/BillingScheduleSection.jsx:58` — auto-lock counter (companion to B31's status filter)

Without this, voided + replacement rows both count toward Billed/Remaining/% Invoiced. B31's
auto-lock fix would also re-break (voided rows count as committed).

### P0.2 — `qb_invoice_id` consumers must short-circuit on voided rows

The plan keeps `qb_invoice_id` populated on the voided row (intentional, for QB-record audit linkage).
Every code path that branches on "has QB link" must add `voided_at IS NULL` to its gate:

**Client (`src/pages/Invoices.jsx`):**
- `handleQBSync` (~1095) — return early if voided; no re-sync allowed
- `handleSaveEdit` (~1234) — edit reason gate + qb-sync re-invoke; no QB edit on voided row
- `handleStatusChange` Paid path (~1087) — no `qb-record-payment` on voided
- `handleDelete` (~1158) — voided rows skip the modal entirely (already voided)
- UI: hide Sync / Edit / Mark-Paid / Pull-Back / Delete buttons when `inv.voided_at` is set (show only "View")

**Server (`supabase/functions/qb-sync-invoice/index.ts`):**
- After invoice fetch (~line 116, before tenant binding check), early-return 200 with
  `{ success: true, skipped: true, reason: "voided" }` if `invoice.voided_at` is set

### P0.3 — Pay-app FK on void

Pay-app branch must clear `billing_schedule_pay_apps.invoice_id` on the original linkage (or repoint
to new invoice when pay-app re-locks). Without this, the pay app shows a voided invoice as its
current link until re-lock. Cleaner: clear `invoice_id = NULL` at void time; re-lock path
overwrites it on next pay-app submission (verify NewPayAppModal lock path always writes fresh,
never assumes pre-existing FK).

### P1.4 — INSERT-copy field list expanded

Non-pay-app branch INSERT now copies (in addition to original list):
- `amount` (customer-facing total — must match unless edited)
- `retention_pct`, `retention_amount`
- `due_date`
- `show_cents`
- `tenant_id` (mandatory FK — must carry)
- `customer_id` if present on invoices schema

Do NOT copy:
- `viewing_token` — let DB default `gen_random_uuid()` fire
- `viewing_token_expires_at` — fresh invoice, fresh window
- `qb_invoice_id` — null on new row (the whole point)
- `stripe_*` — null on new row
- `sent_at`, `paid_at`, `voided_at`, `void_reason` — null on new row

### P1.5 — Refresh Stripe Link button: hide when pay-app linked

Pay-app invoices follow PayAppDetailModal send flow (not the Invoices.jsx PDF modal). The
refresh-link button should only render when `!linkedPayApp`.

### P2.6 — Duplicate DocNum error extraction

Audit found "Duplicate Document Number" appears in `Fault.Error[0].Message`, NOT in `Detail`.
`qbApi` helper at `qb-sync-invoice/index.ts:70` currently throws with `Detail` only.

Fix: change qbApi error throw to include both Message and Detail:

```ts
throw new Error(`QB API ${res.status}: ${JSON.stringify({
  message: data?.Fault?.Error?.[0]?.Message,
  detail: data?.Fault?.Error?.[0]?.Detail,
}) || data}`);
```

Then duplicate regex: `/Duplicate Document Number|different number|already.*used/i`

### Smoke test plan

- **Do NOT use #10028.** Real customer invoice, leave alone until code ships.
- Create a TEST job (job_name containing "test" — triggers existing qb-skip-sync in handlers,
  per `Invoices.jsx:1234, 1276`).
- Smoke matrix:
  1. Non-pay-app invoice, sync to QB, pull-back-with-reason → verify: original row has
     `voided_at`/`void_reason`/`qb_invoice_id`; new row at next-free-ID with copied lines;
     QB shows voided original + nothing yet for new (until manual re-sync).
  2. Same scenario, re-sync new invoice → verify QB creates fresh invoice with new DocNumber.
  3. Pay-app invoice, pull-back → verify: original voided, pay app status=draft, pay app
     invoice_id cleared, NO new invoice yet.
  4. Pay-app re-lock → verify new invoice with fresh ID created and linked.
  5. Refresh Stripe Link on a Sent invoice → verify: Payment Link rotated, no QB call, status
     stays Sent.
  6. Aggregator check: Job Detail Billed/Remaining/% Invoiced does NOT double-count voided +
     new pair (P0.1 verification).
  7. Voided row UI: Sync/Edit/Pull-Back/Delete buttons hidden (P0.2 verification).
  8. Force a duplicate DocNum by manually syncing a renumbered invoice with a colliding
     DocNumber in QB — verify the new error banner ("QB already has invoice #X…") instead
     of opaque 500.

### Re-audit request

Audit terminal: please re-run the checklist against this Round 2 plan. Specifically verify:

- All 6 audit findings are addressed (3 P0, 2 P1, 1 P2)
- No new aggregation blind spots introduced (especially in any cross-tenant view)
- Migration timestamp choice doesn't collide with prod ledger
- Smoke matrix #4 (pay-app re-lock path) — confirm NewPayAppModal lock path overwrites
  `billing_schedule_pay_apps.invoice_id` rather than assuming it's null

Output same table format. TL;DR: Ready to build / Needs more changes / Block.

---

## Round 3 Revisions (post-audit round 2, 2026-05-22)

Round 2 audit verdict: NEEDS MORE CHANGES. AUDIT_LOG row:
`| 2026-05-22 | feat/b34-invoice-void-record @ 51334d0 (plan doc Round 2) | 7 | 0 Crit, 4 P0, 2 P1, 1 nit | accepted-pending-changes | aggregation-blind-spot |`

### P0.1 extended — additional aggregator/list sites

Round 2 list missed several sites. Add `.is("voided_at", null)` to:

- `src/pages/Invoices.jsx:141` — main list fetch (cascades to status totals at 1736-1740)
- `src/components/MergeJobModal.jsx:90` — invoices count by `job_id = display_job_number`
- `src/components/MergeJobModal.jsx:92` — invoices count by `job_id = String(loserJob.id)`
- `src/pages/Customers.jsx:524` — fetchAll filters; add `["is", "voided_at", null]` to the
  filters array (already has the deleted_at filter — mirror it)
- `src/pages/SalesDash.jsx:417` — fetchAll has no filters today; pass
  `{ filters: [["is", "voided_at", null], ["is", "deleted_at", null]] }`
  Pre-existing gap: this call doesn't filter `deleted_at` either, so soft-deletes leak into
  SalesDash totals today. Fix both in the same edit (don't expand B34 scope, but it's a
  one-line bonus correction).

Grep verified: `src/pages/Home.jsx` has no direct `from("invoices")` query.

### P0.2 corrected — voided early-return placement

Round 2 said "after invoice fetch (~line 116, before tenant binding check)." That leaks
cross-tenant voided-status. Move to AFTER the tenant binding gate at
`qb-sync-invoice/index.ts:121`:

```ts
// Tenant binding: line 119-121 (existing)
if (!caller.isServiceRole && invoice.tenant_id !== caller.tenantId) {
  return unauthorizedResponse(403, corsHeaders);
}

// NEW: voided early-return (Round 3, after tenant gate)
if (invoice.voided_at) {
  return new Response(JSON.stringify({
    success: true, skipped: true, reason: "voided",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
}
```

### P0.3 specified — handleDelete on voided rows

Click behavior on a voided row's Delete button:
- NO QB void call (already voided — `qb-void-invoice` would error)
- NO modal (no reason needed; reason already captured at void time)
- Direct soft-delete: `UPDATE invoices SET deleted_at = now() WHERE id = inv.id`
- Single confirm() prompt: "Hide this voided invoice from lists? (record stays in DB for audit.)"
- After delete: redirect/refresh as today

Implementation: branch at top of `handleDelete` (`Invoices.jsx:1158`):

```js
async function handleDelete() {
  if (inv.voided_at) {
    if (!confirm("Hide this voided invoice from lists? (record stays in DB for audit.)")) return;
    const { error } = await supabase.from("invoices")
      .update({ deleted_at: new Date().toISOString() }).eq("id", inv.id);
    if (error) { alert(error.message); return; }
    onDeleted && onDeleted();
    return;
  }
  // existing path: qb_invoice_id → void modal, else hard-confirm soft-delete
  ...
}
```

### P0.4 — inline voided indicator on list rows

Minimum-viable visual cue (full badge component deferred to next loop):

- On Invoices list rows: append `" (voided)"` to the invoice ID display when `voided_at` is set,
  AND apply muted color (`C.textFaint`) + strikethrough to the row's text columns.
- On Invoice detail header (Invoices.jsx ~765): add a `<Pill label="VOIDED" cm={...} />` next to
  the status pill when `inv.voided_at` is set.
- On Job Detail linked invoices section: same `" (voided)"` suffix + muted styling.

No new component. Reuses `Pill` from `src/components/Pill.jsx` and existing `C.textFaint` token.

### P1.5 — PublicInvoicePage voided handling

`src/pages/PublicInvoicePage.jsx:32` fetch by `viewing_token`. After fetch, if `inv.voided_at`
is set, render a "This invoice is no longer active." notice (mirror Stripe's deactivated-link
`inactive_message` copy from B33 for consistency). Do not render the PDF / pay button.

Pattern: insert check right after `setInvoice(inv)` at line 38, before the lines fetch. Lines
fetch can be skipped on voided.

### P1.6 — Smoke #8 dropped

Test jobs auto-skip QB sync (Invoices.jsx:1234, 1276 — `(inv.job_name || "").toLowerCase().includes("test")`).
That prevents smoke #8 (duplicate DocNum surfacing) from firing on a test job. Two options:
- **Drop #8 from this loop** — the dupe-DocNum catch is defense-in-depth; primary fix is the
  two-row design which prevents the scenario. Verify catch in a future loop with a non-test
  sandbox QB job.
- **Smoke against sandbox QB job** — requires `QB_ENVIRONMENT=sandbox` + a non-test job_name.
  Out of 30m budget.

Decision: **drop #8 this loop.** Carry as B34 follow-up smoke task.

### Nit 7 — drop customer_id from copy list

CLAUDE.md `invoices` schema does NOT list `customer_id`. Removing from P1.4's "must copy" list.
Customer linkage flows through `call_log_id` → `call_log.customer_id`. The invoice row has no
direct customer FK.

Updated copy list (final):
- `tenant_id` (mandatory FK)
- `job_id`, `job_name`, `call_log_id`, `proposal_id`
- `amount`, `discount`, `retention_pct`, `retention_amount`
- `due_date`, `description`, `intro`
- `show_cents`

Do NOT copy: `qb_invoice_id`, `stripe_*`, `sent_at`, `paid_at`, `voided_at`, `void_reason`,
`viewing_token` (let default fire), `viewing_token_expires_at`, `deleted_at`.

### Updated smoke matrix (7 cases now)

1. Non-pay-app: sync to QB, pull-back-with-reason → verify original voided, new row created.
2. Re-sync new invoice → QB creates fresh invoice with new DocNumber.
3. Pay-app invoice, pull-back → original voided, pay app draft, `billing_schedule_pay_apps.invoice_id`
   cleared, NO new invoice yet.
4. Pay-app re-lock → new invoice with fresh ID created + linked.
5. Refresh Stripe Link on a Sent invoice → Payment Link rotated, no QB call, status stays Sent.
6. Aggregator double-count check across: Invoices list totals, Job Detail Billed/Remaining/%,
   Customer detail invoices tab, SalesDash invoiced-by-month, MergeJobModal counts.
7. Voided row UI: list row shows "(voided)" + muted/strikethrough; detail header shows VOIDED
   pill; Sync/Edit/Mark-Paid/Pull-Back buttons hidden; Delete shows "Hide from lists?" confirm
   only; PublicInvoicePage renders "no longer active" notice.

(Smoke #8 — dupe-DocNum surfacing — deferred to follow-up loop with sandbox QB job.)

### Re-audit request (Round 3)

Audit terminal: re-run against Round 3. Specifically verify:
- All 7 Round 2 findings (4 P0, 2 P1, 1 nit) addressed
- Tenant binding placement correct in P0.2
- handleDelete branch in P0.3 covers all delete-on-voided edge cases
- P0.4 inline indicator doesn't break any existing styling (DataTable column rendering)
- P1.5 PublicInvoicePage edit doesn't break the happy-path (active invoice) render

Output: same table + TL;DR: Ready to build / Needs more changes / Block.
