# Plan — Invoice "sent" state stale: Edit / Sync-to-QuickBooks buttons don't clear after send

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** bug

**Status:** PARKED (scaffolded 2026-06-29) — not yet planned.

---

## §0 Reproduction [DERIVED from code read 2026-06-29 — not yet run-verified]
Report: send an invoice (both pay-package AND standard) → "Edit" and "Sync to QuickBooks"
buttons stay visible as if unsent; navigating away and back clears them. Started ~mid-June 2026.

Mechanism traced in `src/pages/Invoices.jsx` (InvoiceDetail):
- Send completion is `onSent` (line ~2358). It applies a **hardcoded optimistic merge**
  (`{status:"Sent", sent_at, viewing_token_expires_at, stripe_*}`) via `setInv` and fires
  `qb-sync-invoice` **fire-and-forget** (line ~719, `.catch(()=>{})`). It never refetches.
- So local `inv.qb_invoice_id` is never updated, even though the edge fn writes it server-side.
- Sync button condition (line ~2272): `!inv.qb_invoice_id && !qb_skip_sync && qb_customer_id
  && (inv.status !== "New" || linkedPayApp)`. Standard invoice: at "New" the button is hidden;
  after send `status` flips to "Sent" locally but `qb_invoice_id` stays null → button now SHOWS
  and persists until a remount refetch.
- Pay-package: approve/send goes through `handleApprove` (line ~730) → `onSent({})` (empty obj)
  → optimistic merge is a no-op → neither status nor qb_invoice_id updates locally → Edit
  (`isNew`, line 1506/2253) + Sync both persist until remount.
- Contrast — the MANUAL Sync button `handleQBSync` (line ~1476) does it correctly: after sync it
  **refetches the invoice row and `setInv(...refreshed)`**. Same pattern at QBLink `onLinked`
  (line ~2321). The send path simply omits this refetch.

[VERIFY before fix: run-reproduce on preview for one standard + one pay-app invoice; confirm
qb_invoice_id is null in local state post-send and populated after remount.]

## §1 Problem / intent
After a successful Send, local `inv` state is not reconciled with the server-written row
(`qb_invoice_id`, and for pay-apps `status`), so action buttons reflect pre-send state until the
component remounts (navigate away/back). Expected: buttons reflect true sent state immediately.

## §2 Change as built [LOCKED — implemented 2026-06-29, build green]
Root cause: after send, local `inv` was updated only from a hardcoded optimistic object that
omits server-written fields (esp. `qb_invoice_id`), and never refetched. Two timing realities:
- **Pay-app approve path** (`handleApprove`): qb-sync is *awaited* before `onSent({})`, so the
  row already has `qb_invoice_id` — a plain refetch in `onSent` reconciles it. ✅
- **Standard send path** (`handleSend`): qb-sync is fire-and-forget and the QB write (edge fn
  line 366) lands *after* a full QuickBooks round-trip, so an immediate refetch races ahead of
  it. Solved by a new `onQbSynced` callback fired from the qb-sync `.then()` — when QB actually
  has the invoice, the parent refetches and the Sync button clears in place.

Design kept qb-sync **non-blocking for the send confirmation** (modal still shows "Sent" without
waiting on QB); only the parent's button-state reconciliation waits on the qb-sync resolving.

## §3 Files touched
`src/pages/Invoices.jsx` only (frontend; no migrations):
- New `reloadInv()` helper in `InvoiceDetail` (DRYs the existing refetch select).
- `InvoicePDFModal` signature: new `onQbSynced` prop.
- `handleSend` qb-sync: `.then(() => onQbSynced?.())` added to the fire-and-forget call.
- `onSent`: optimistic `setInv` (instant feedback) → `await reloadInv()` reconcile.
- New `onQbSynced={async () => { await reloadInv(); onUpdated?.() }}` on the modal.

## §4 Out of scope / deferred
- Did not refactor the two pre-existing inline refetches (handleQBSync, QBLink onLinked) to use
  `reloadInv()` — kept blast radius minimal. Optional cleanup later.
- Pre-existing lint issues in InvoicesPage URL-sync effects — untouched.

## §5 Verification
- Local: `npm run build` green; `eslint src/pages/Invoices.jsx` adds no new problems.
- Pending: live smoke on preview against a QB-linked job (standard + pay-app) — buttons should
  clear without navigate-away. [user step]

## §3 Files to touch [TODO]

