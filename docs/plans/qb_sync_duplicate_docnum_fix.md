# Plan: `qb_duplicate_docnum` wedge on invoice #10051

**Status:** R2 AUDIT COMPLETE · RULINGS RESOLVED · BUILDING now-batch (1)(2)(3)+persist · step (4) heal deferred to post-QB-reauth
**Branch:** `fix/qb-sync-duplicate-docnum`
**Author:** build/fix session, 2026-07-01
**Confidence tags:** [LOCKED] verified · [DERIVED] inferred from code · [DESIGN-OPEN] needs a call · [BLOCKED] needs external input

---

## Ratified decision (rounds 1–2 audit)

**Ship Option C (corrected) + Option D (generalized). Defer Options A & B.**
Split delivery: **ship (1)(2)(3)+persist now**; **run corrected (4) heal after QB
re-auth.** Prevent silent recurrence (C) + heal existing wedges by verified
per-invoice QB read (D). Do not adopt-by-DocNumber / auto-overwrite (A/B) — breaks
B34's "never write onto an unlinked QB invoice" invariant. Deferred, not rejected.

R2 rulings (both RESOLVED): §6.2 → **persist the qbId client/server-side, reject
void-rollback**; §6.3 → **match on net ±$0.01 against the QB sub-customer**.

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
  anywhere** (grep-verified); nothing nulls it on an existing row.
- Desync = the create POST reached QB and created the invoice, but the **HTTP
  response was lost** (timeout/network), so `qbApi` threw before `:366` ran. QB
  kept DocNumber 10051; SC never recorded the link. **[DERIVED — only mechanism
  the code permits]**
- Auto-sync on send is fired **non-blocking and fully swallowed**:
  `Invoices.jsx:721-724` → `.then(() => onQbSynced()).catch(() => {})`. The
  duplicate error arrives as `data.error` at **HTTP 200**, so even the client's
  `error` slot is empty. **[LOCKED]**
- `send-pay-app/index.ts:469-483` uses the identical fire-and-forget-swallow
  pattern server-side — same blind spot on the pay-app path. **[LOCKED]**
- "Pull Back didn't ask for a reason": `handlePullBack` (`Invoices.jsx:1721-1725`)
  opens the void modal only when `qb_invoice_id` is set. Null → silent no-void
  branch → same id → same burned DocNumber. **[LOCKED]**

---

## §1 — Prior-work interaction (CONFIRMED, causation checked)

- `bb66d5f` (Apr 2) — "update existing QB invoice instead of skipping."
- `04da90f` / **B34** (May 22) — two-row void design + the `qb_duplicate_docnum`
  message. Carries the "never overwrite an unlinked QB invoice" invariant.
- `24c7ba1` — "Fix invoice sent-state buttons not clearing until remount." **Audit
  refuted as the cause, two ways. Not implicated.** **[LOCKED]**

Prior work did **not** cause the wedge (the two-row design runs only when
`qb_invoice_id` is set; #10051 had null). It left a **dead-end recovery** for
null-link invoices (pull-back keeps the same id). Prevention (C) + heal (D) is the
right response, not void+replace. **[LOCKED]**

---

## §2 — Options
- **A — silent adopt-by-DocNumber** — DEFERRED (invariant + heuristic risk).
- **B — explicit reconcile button** — DEFERRED (out of scope).
- **C — prevent-only (corrected)** — SHIP now.
- **D — data heal (generalized, verified)** — SHIP after QB re-auth.

---

## §3 — Build (ratified final shape)

All on `fix/qb-sync-duplicate-docnum`. No migration, no schema change.

### Now-batch (ship this commit)

**(1) Edge fn `qb-sync-invoice` — non-orphaning create→link.**
`index.ts:366` write-back has no error check: a create can succeed in QB while the
`qb_invoice_id` persist fails, orphaning the QB invoice. Capture the update
`error`; on failure return `{ error: "qb_link_persist_failed", message, qbInvoiceId }`
(HTTP 200) instead of a bare success, so the caller can persist the link. No
atomic/idempotent claim — this only closes the *persist-returned-an-error* case;
the lost-*response* case is handled by the client persist + step (4) heal.

**(2) Client `Invoices.jsx` — surface + persist, don't swallow.**
- `:721` (auto-sync on send, **B1**): await the invoke; inspect `{data, error}` in
  a **separate try**. If `data.qbInvoiceId` came back with an error → **persist it**
  (`invoices.qb_invoice_id = data.qbInvoiceId`), don't just banner. Otherwise push
  a **non-fatal warning** into `sendWarnings` (check `data.error` at HTTP 200 and
  `error.context.json()`). **Never flip `sendError`/`sendDone`** — the send
  succeeded. Then call `onQbSynced()`.
- `handleQBSync:1476` (**B2**): throw `data.message || data.error` (surface the
  friendly message, not the raw code). Add the same `qb_link_persist_failed`
  persist-recovery before the error checks.

**(3) Edge fn `send-pay-app:469-483` + `PayAppDetailModal` — await + surface.**
Chosen: **await** the qb-sync call server-side (not fire-and-forget). On
`qb_link_persist_failed` with a qbInvoiceId → persist it server-side
(tenant-scoped). Collect any other error/message into a top-level `warnings: []`
in the response. `PayAppDetailModal` renders `data.warnings` non-fatally on the
"sent" step. (Rejected log-only — the pay-app path creates QB invoices too and
carries the same orphan/wedge risk.)

**B3** (list↔detail remount): **DEFERRED** — perf/flicker polish, outside the
causal scope of this wedge. Left as backlog B3.

### Deferred to post-QB-reauth

**(4) Data heal (generalized, verified per-invoice).** [BLOCKED on QB read]
- **Enumerate** wedged rows: `qb_invoice_id IS NULL` AND `deleted_at IS NULL` AND
  `voided_at IS NULL` AND `status <> 'New'` AND job **not** test AND
  `qb_skip_sync` false AND job is QB-linked (`call_log.qb_customer_id` set,
  resolved via `index.ts:144-159`).
- For **each**, query QB by DocNumber. **Refuse on 0 or >1 matches.**
- **Voided-refuse:** skip if the QB record looks voided — `TotalAmt == 0`, or all
  lines 0, or `PrivateNote` contains "Voided".
- **Match rule:** set `qb_invoice_id` **only if** QB `CustomerRef` == the SC job's
  QB **sub-customer** (`call_log.qb_customer_id`) **and** QB `TotalAmt` == SC
  **net** = `amount − discount − retention_amount`, within **±$0.01**.
- SC-side write only; never overwrite QB. Report every refusal.

---

## §4 — Files in scope
- `supabase/functions/qb-sync-invoice/index.ts` — `:366`.
- `src/pages/Invoices.jsx` — `:721` (auto-sync), `handleQBSync:1476`.
- `supabase/functions/send-pay-app/index.ts` — `:469-483`.
- `src/components/PayAppDetailModal.jsx` — sent-step warnings render.
- Data (deferred): heal SQL. No migration.

---

## §5 — Deploy notes
- Edge fns deploy with `--no-verify-jwt`. Smoke against a TEST recipient after
  deploy (deploy exit 0 ≠ working).
- Build session ships code + local build check only; edge-fn deploy + the step-4
  heal run wait for the deploy gate / QB re-auth.

---

## §6 — Resolved rulings (rounds 1–2)
1. B1/B2/B3 identity — RESOLVED. B1 = `:721/:722` swallow (folded into step 2);
   B2 = `handleQBSync:1476` `data.message||data.error`; B3 = deferred.
2. Step (1) recovery contract — RESOLVED: persist the returned qbId (client +
   server); reject QB void-on-failure rollback.
3. Step (4) match keys — RESOLVED: net (amount − discount − retention_amount) vs
   QB TotalAmt ±$0.01, CustomerRef = QB sub-customer.

---

## AUDIT_LOG
| 2026-07-01 | sales-command @ fix/qb-sync-duplicate-docnum · inline plan (#10051) | R1: 10 (7 dedup) | 1C/4H/5M/4L | accepted-pending-changes | heal-path-rests-on-nonexistent-QB-read |
| 2026-07-01 | sales-command @ fix/qb-sync-duplicate-docnum 51830cd · qb_sync_duplicate_docnum_fix.md | R2: 8 dedup + 3 regressions | 1C/4H/3M/2L | accepted-pending-changes | heal-match-uses-gross-not-net |
