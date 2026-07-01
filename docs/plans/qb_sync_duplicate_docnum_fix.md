# Plan: `qb_duplicate_docnum` wedge on invoice #10051

**Status:** AUDIT ROUND 1 COMPLETE · SCOPE RATIFIED · REVISED FOR RE-AUDIT · FIX NOT BUILT
**Branch:** `fix/qb-sync-duplicate-docnum`
**Author:** build/fix session, 2026-07-01
**Confidence tags:** [LOCKED] verified · [DERIVED] inferred from code · [DESIGN-OPEN] needs a call · [BLOCKED] needs external input

---

## Ratified decision (2026-07-01, round-1 audit)

**Ship Option C (corrected) + Option D (generalized). Defer Options A & B.**

Rationale: prevent silent recurrence (C) and heal existing wedges by verified
per-invoice QB read (D). Do **not** adopt-by-DocNumber or auto-overwrite
(A/B) — those break B34's "never write onto an unlinked QB invoice" invariant and
rest on a heuristic. Deferred, not rejected.

Audit outcome: 10 findings (7 after dedup) · 1C/4H/5M/4L · accepted-pending-changes ·
pattern **"heal-path-rests-on-nonexistent-QB-read"** (i.e. §3 blocker is real —
the heal must actually read QB per invoice, not assume state).

---

## §0 — Reproduction & evidence (verified)

**Observed:** Invoice #10051 (Sent, $5,754.16, Clorox Ceres Line archive invoice)
returns `qb_duplicate_docnum` on "Sync to QuickBooks."

**Prod DB state** (queried live via `command-suite-db` linked):
```
id=10051  status=Sent  qb_invoice_id=NULL  voided_at=NULL  sent_at=2026-07-01
```
SC believes #10051 was never synced; QB holds a record at DocNumber "10051" that
SC has no link to. A desync. **[LOCKED]**

**Mechanism (file:line-verified):**
- QB DocNumber = SC invoice id: `qb-sync-invoice/index.ts:322` → `DocNumber: invoiceId`.
- `isUpdate = !!invoice.qb_invoice_id` (`:129`). Null → **create** branch (`:358-367`).
- Success writes the link at `:366` — **the ONLY write to `qb_invoice_id`
  anywhere** (grep-verified across `src/` + `supabase/functions/`); nothing nulls
  it on an existing row.
- Desync = the create POST reached QB and created the invoice, but the **HTTP
  response was lost** (timeout/network), so `qbApi` threw before `:366` ran. QB
  kept DocNumber 10051; SC never recorded the link. **[DERIVED — the only
  mechanism the code permits]**
- Auto-sync on send is fired **non-blocking and fully swallowed**:
  `Invoices.jsx:721-724` → `.then(() => onQbSynced()).catch(() => {})`. The
  duplicate error arrives as `data.error` at **HTTP 200**, so even the client's
  `error` slot is empty — nothing was ever shown. **[LOCKED]**
- `send-pay-app/index.ts:469-483` uses the identical fire-and-forget-swallow
  pattern (server-side), so the pay-app send path has the same blind spot.
  **[LOCKED]**
- "Pull Back didn't ask for a reason": `handlePullBack` (`Invoices.jsx:1721-1725`)
  opens the void modal only when `qb_invoice_id` is set. Null → silent no-void
  branch → same id 10051 → same burned DocNumber. **[LOCKED]**

---

## §1 — Prior-work interaction (the stated fear) — CONFIRMED, with causation checked

- `bb66d5f` (Apr 2) — "update existing QB invoice instead of skipping": re-sync
  of a *linked* invoice updates, not orphans.
- `04da90f` / **B34** (May 22) — **two-row void design**: pull-back of a *linked*
  invoice marks the original `voided_at` (keeps `qb_invoice_id` for QB audit) and
  mints a **new SC id**. Same commit added the `qb_duplicate_docnum` message.
- `24c7ba1` — "Fix invoice sent-state buttons not clearing until remount."
  **Audit refuted this as the cause, two ways.** Not implicated. **[LOCKED]**

**Did prior work cause the wedge?** No. The two-row design runs only when
`qb_invoice_id` is set; #10051 had null and never entered it. §1 is **CONFIRMED
but incomplete** per audit — the causation is the lost write-back, not any prior
commit. **[LOCKED]**

**The gap prior work left:** B34's `qb_duplicate_docnum` advice ("pull back to
void + replace") is a **dead end for null-link invoices** — pull-back keeps the
same id, looping back into the burned number. This is why prevention (C) + heal
(D) are needed, not the void+replace path. **[LOCKED]**

---

## §2 — Options (A/B deferred)

- **A — silent adopt-by-DocNumber.** DEFERRED. Breaks the unlinked-invoice
  invariant; voided/live detection is heuristic.
- **B — explicit reconcile button.** DEFERRED. Good idea, but out of this scope.
- **C — prevent-only (corrected).** SHIP. See build.
- **D — data heal (generalized).** SHIP. See build.

---

## §3 — Build (ratified shape)

All work on `fix/qb-sync-duplicate-docnum`. No migration, no schema change.

**(1) Edge fn `qb-sync-invoice` — make create→link non-orphaning.**
At `index.ts:366` the write-back has no error check: a create can succeed in QB
while the `qb_invoice_id` persist silently fails, orphaning the QB invoice.
Capture the update `error`; on failure **surface it** (return an error payload
carrying the just-created `qbInvoiceId`) instead of reporting success — so a lost
persist is recoverable, never silently orphaned. Make the create→link path
atomic/idempotent to the extent possible.
> Note [LOCKED]: the lost-*response* case (throw at `qbApi` before `:366`) is
> inherently unpreventable at the persist step — that is why C is paired with the
> client surface (below) and the D heal for already-wedged rows.

**(2) Client `Invoices.jsx:721` — surface, don't swallow.**
Inspect both `{data, error}` from the `qb-sync-invoice` invoke. The duplicate
arrives as **`data.error` at HTTP 200**, so check `data?.error` as well as
`error`. Surface it in a **separate try** as a **non-fatal warning banner** —
**never flip `sendError`/`sendDone`** (the send itself succeeded). Fold in audit
client findings **B1/B2/B3** here. *(See §Open below — confirm B1/B2/B3 text
against the audit output; backlog B2 = send-invoice error surfacing, B3 =
list↔detail remount are the topical matches; backlog B1 is already Closed.)*

**(3) Edge fn `send-pay-app/index.ts:469-483` — same treatment.**
The fire-and-forget QB sync there swallows failures identically. Apply the same
surface-on-failure handling (log + return a non-fatal warning in the response)
so pay-app sends can't silently wedge.

**(4) Data heal (generalized, verified per-invoice).**
Enumerate wedged rows (sent/non-voided invoices with `qb_invoice_id IS NULL`
whose job is QB-linked). For **each**, read the QB record by DocNumber and set
`qb_invoice_id` **only if** the QB record's **CustomerRef + TotalAmt match** the
SC invoice. No code overwrite of QB; SC is the only side written. Refuse/skip on
mismatch or voided QB record and report it.

---

## §4 — Blocking unknown (audit-confirmed)

**[BLOCKED]** Step (4) cannot run until QB is readable. The audit's headline
pattern is exactly this: the heal rests on a QB read that does not yet exist.
Re-authorize the claude.ai Intuit QuickBooks integration, then the heal reads
DocNumber 10051 (live vs voided, QB id, CustomerRef, TotalAmt) before any write.

---

## §5 — Files in scope
- `supabase/functions/qb-sync-invoice/index.ts` — write-back `:366`.
- `src/pages/Invoices.jsx` — swallowed auto-sync `:721`; (`handlePullBack` `:1721`
  context only).
- `supabase/functions/send-pay-app/index.ts` — `:469-483`.
- Data: heal SQL (enumeration + per-invoice verified set). No migration.

---

## §6 — Open for re-audit
1. **B1/B2/B3 identity** — confirm these are the audit's round-1 client findings
   and paste their scope, so step (2) folds the right work. (Backlog B1 is Closed;
   B2/B3 are topical but may not be what the audit meant.)
2. Confirm step (1)'s "surface the orphan with its qbInvoiceId" is the intended
   recovery contract (vs. attempting a QB void-on-persist-failure rollback).
3. Confirm the step (4) enumeration predicate and the match keys
   (CustomerRef + TotalAmt) are sufficient (retention/discount lines can make
   TotalAmt ≠ invoice.amount — decide the tolerance).

---

## AUDIT_LOG
| 2026-07-01 | sales-command @ fix/qb-sync-duplicate-docnum · inline plan (qb_duplicate_docnum #10051) | 10 (7 after dedup) | 1C/4H/5M/4L | accepted-pending-changes | heal-path-rests-on-nonexistent-QB-read |
