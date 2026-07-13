# Plan — Edit a Sent / QB-Synced Invoice In Place (keep same number)

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** BUILT + buildvsplan-cleared (2026-07-13) — §2 landed in `src/pages/Invoices.jsx`; build passes; not yet smoke-tested. Awaiting QB smoke (see §6).

**buildvsplan (2026-07-13):** 0 Tier-1, 2 Tier-2 — both fixed same session.
- **T2-1 (real, fixed):** `syncedLock` locked the UI but `handleSaveEdit` never referenced it — the CLAUDE.md #6/#7 trap. WTC lines recomputed `calcWtcPrice × pct` (would drift + full-replace into QB if the underlying `proposal_wtc` changed after send) and the archive-amount input wasn't disabled. **Fix:** added a `syncedLock` preserve branch as the first case in `newLines` (preserve stored amount + %, never recompute), preserved retention/discount under `syncedLock`, and disabled the archive input. Now §2.3's "amounts are locked" is enforced at the write path, not just the UI.
- **T2-2 (note, not fixed):** `!inv.qb_payment_id` in the gate is currently redundant with `!== "Paid"` (live data: qb_payment_id only set once Paid), so it doesn't independently block a partial-payment-while-Sent case. Low likelihood; documented inline as defense-in-depth with a "add a balance check if partial QB payments ever land on a Sent invoice" pointer.

**Build note:** §2 delivered as — (1) button gate widened via new `canEditInPlace` (New + Sent/Waiting/Past Due; excludes Paid, voided, and any `qb_payment_id`-linked invoice); (2) Paid + QB-payment guard added to `handleSaveEdit`; (3) `syncedLock = !!inv.qb_invoice_id` disables invoice number + discount + retention + per-line % inputs; (4) edit-reason field already conditioned on `qb_invoice_id` — verified renders in widened path; (5) explainer banner + "Edit Sent Invoice" label + "Locked — synced to QuickBooks" hint. **(6) QB resync now awaits + surfaces errors** (Chris's call, 2026-07-13) — replaced the fire-and-forget `.catch(()=>{})` with an awaited invoke that reads `fnErr.context.json()` for the real QB fault (mirrors `handleQBSync`), and on failure keeps the SC edit saved but leaves the edit form open with an alert so a retry re-pushes to QB (number+amounts locked → idempotent). Closes the B44 silent-failure gap on this path.

---

## §1 Problem / intent [LOCKED]

An invoice is sent to a GC who requires a P.O. number. The PO arrives *after*
the invoice was already sent (and synced to QuickBooks). Today the only way to
add the PO is to **Pull Back** the invoice — and for a QB-synced invoice, pull-back
**voids the QB record and mints a brand-new invoice number**. The operator wants
to keep the **same invoice number** and just add the PO.

The PO does **not** need a dedicated field. It gets recorded in two existing places:
1. **Work description** (`invoices.description`) — flows to the PDF and to QB `CustomerMemo`.
2. **Email body introduction** (`invoices.intro`) — customer-facing email only; does not go to QB.

Goal: expose an in-place edit of a **Sent, unpaid, QB-synced** invoice that edits
description + intro (+ due date), re-syncs to QB with an audit note, and **preserves
the invoice number**.

---

## §0 Baseline (observed current state) [DERIVED — read-verified 2026-07-13]

### Invoice lifecycle: sync and "Sent" happen together
- Sending (`handleSend`, `src/pages/Invoices.jsx:721`) or "Approve → QB"
  (`:834`) both **posts to QB** (sets `qb_invoice_id`, `:756`–`:760`) **and**
  flips status to Sent. There is no state where an invoice is QB-synced but still
  New. Therefore: **New = no QB record; Sent/Waiting/Past Due/Paid = has QB record.**

### Editing is gated to status New
- The "Edit Invoice" button renders only `{isNew && ...}` where
  `isNew = inv.status === "New"` (`:1696`, button at `:2495`). A Sent invoice
  cannot be edited in place today.
- `startEditing()` (`:1725`) seeds edit state incl. `editId` (the invoice
  number), `editDesc`, `editIntro`, due date, discount, retention, per-line pct.
- `handleSaveEdit()` (`:1739`) **already contains full QB-synced-edit machinery**:
  - Requires an edit reason when `inv.qb_invoice_id` is set (`:1742`–`:1745`).
  - Writes invoice + lines (`:1777`–`:1799`), incl. re-pointing `invoice_lines.invoice_id`
    if `editId` changed (`:1795`–`:1799`).
  - Re-syncs to QB with the reason (`:1802`–`:1804`).
  - Only voided is blocked (`:1740`); **Paid is NOT blocked** — gap.
  This QB branch is currently unreachable through the UI (button only shows for New).

### QB re-sync update path is built and correct
`supabase/functions/qb-sync-invoice/index.ts`, `isUpdate` branch (`:381`):
- GETs live QB invoice for a fresh `SyncToken` (`:384`–`:385`) — concurrency safe.
- Rebuilds full object, `sparse: false` → **destructive full replace** (`:388`).
- Appends `[EDITED] <ts> — <reason>` to QB `PrivateNote` (`:390`–`:394`) — audit trail.
- `description` → `CustomerMemo` (`:375`–`:377`). `DocNumber` = invoice id (`:364`).
- Duplicate-docnum caught → `qb_duplicate_docnum` (`:447`).

### PO data flow (verified)
- `description` → PDF (`src/lib/invoicePdf.js:333`) **and** QB `CustomerMemo`.
- `intro` → customer email only (not sent to QB) — correct, expected.

---

## §2 Proposed change [DESIGN-OPEN on field-locking scope]

Expose in-place editing for **Sent-family, unpaid, QB-synced** invoices, scoped
tightly so it cannot drift QB.

1. **Widen the edit-button gate** (`:2495`): show for New **and** for
   Sent-family statuses (`Sent`, `Waiting for Payment`, `Past Due`), **but not
   `Paid`** and not `voided_at`.
2. **Add a Paid guard to `handleSaveEdit`** (`:1740`): mirror the `voided_at`
   block — refuse when `inv.status === "Paid"` (and consider warning on partial
   payment). This is the load-bearing safety guard (see §risks).
3. **Lock number + dollar fields for synced edits.** When `inv.qb_invoice_id` is
   set, disable the invoice-number input (`editId`, `:2120`), discount, retention,
   and per-line billing % — allow only **description, intro, due date**. Keeps the
   number stable (the whole point) and prevents amount drift under a QB record.
4. **Edit-reason prompt** already keys off `qb_invoice_id` (`:1742`) — verify it
   renders in the widened path.
5. Copy tweaks: button label / helper text so it's clear this edits a live,
   already-sent invoice and re-syncs to QB with an audit note.

---

## §3 Files to touch [DERIVED]

- `src/pages/Invoices.jsx`
  - `:2495` button gate (isNew → isNew || isSentFamily, exclude Paid/voided)
  - `:1740` add Paid guard in `handleSaveEdit`
  - `:2120` + discount/retention/pct inputs — disable when `qb_invoice_id` set
  - edit-reason input visibility (already conditioned on `qb_invoice_id`)
- No edge-function change needed — `qb-sync-invoice` update path already handles it.
- No DB / migration change — **no new column** (PO lives in existing description/intro).

---

## §4 Out of scope / deferred

- Dedicated `po_number` column / first-class PO field — explicitly NOT wanted.
- Editing **Paid** invoices in place — blocked, not supported (QB payment linkage risk).
- Changing the invoice number on a synced invoice — deliberately locked.
- Populating QB's native PO field — stays in `CustomerMemo` via description.

---

## §5 Risks / safety (Intuit side) [DERIVED — read-verified]

1. **`sparse: false` is a destructive full-replace.** Any QB field not modeled in
   SC (custom fields, terms, ship-to, class, hand-edited memo) is reset to default
   on every resync. This is **existing behavior on all resyncs** (Mark-as-Paid,
   etc.), not new — but exposing edit makes it fire more often. Non-issue if
   nobody hand-edits invoices directly in QB. **Do not silently change this;**
   flag to user before build if their QB workflow includes manual invoice edits.
2. **Paid / partially-paid edits are the danger.** Full-replace of line items on
   an invoice with a linked QB Payment can error or shift amounts under a recorded
   payment. §2 step 2 (Paid guard) is mandatory, not optional.
3. **Number change → `qb_duplicate_docnum`.** Locking the number field (§2 step 3)
   removes this risk entirely.
4. Clearing description clears QB `CustomerMemo` (sparse-false omits it) — expected;
   the PO would vanish from QB if description is blanked. Acceptable.

**Verdict:** for the target case (Sent, unpaid, description/intro edit, same number)
this is safe — SyncToken handling, audit note, and the QB update call are already
built and correct. The build is small: a button gate, a save guard, and disabled
inputs. No backend or schema work.

## §6 Estimate / time budget

~1–2 hrs (build). Single file. Smoke: create → send (syncs to QB) → edit
description with PO → verify same number in SC + QB, `CustomerMemo` updated,
`[EDITED]` note appended to QB `PrivateNote`, PDF shows PO. Verify against a
**test** job so the QB skip-test guard (`:1802`) doesn't suppress the resync
during real verification — or use a real sandbox job and confirm the resync fires.
