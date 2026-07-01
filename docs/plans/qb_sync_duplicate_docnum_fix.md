# Plan: `qb_duplicate_docnum` wedge on invoice #10051

**Status:** DISCOVERY COMPLETE · FIX NOT BUILT · AUDIT REQUESTED
**Branch:** `fix/qb-sync-duplicate-docnum`
**Author:** build/fix session, 2026-07-01
**Confidence tags:** [LOCKED] verified · [DERIVED] inferred from code · [DESIGN-OPEN] needs a call · [BLOCKED] needs external input

---

## §0 — Reproduction & evidence (verified, not theorized)

**Observed:** Invoice #10051 (status Sent, $5,754.16, Clorox Ceres Line archive
invoice) returns `qb_duplicate_docnum` when the user presses "Sync to QuickBooks."

**Prod DB state** (queried live via `command-suite-db` linked):
```
id=10051  status=Sent  qb_invoice_id=NULL  voided_at=NULL  sent_at=2026-07-01
```
SC believes #10051 was never synced. QB rejects the create as a duplicate
DocNumber → **QB already holds a record at DocNumber "10051" that SC has no link
to.** This is a desync. **[LOCKED]**

**Mechanism (every claim file:line-verified):**
- QB DocNumber = SC invoice id: `supabase/functions/qb-sync-invoice/index.ts:322`
  → `DocNumber: invoiceId`.
- `isUpdate = !!invoice.qb_invoice_id` (`:129`). With null → **create** branch
  (`:358-367`).
- A successful create writes the link back at `:366`. **This is the ONLY write
  to `qb_invoice_id` anywhere** — verified by grep across `src/` and
  `supabase/functions/`. Nothing nulls it on an existing row.
- Therefore the desync = the create POST reached QB and created the invoice, but
  the **HTTP response was lost** (timeout/network), so `qbApi` threw before
  `:366` executed. QB kept DocNumber 10051; SC never recorded the link. **[DERIVED
  — this is the only mechanism the code permits, since nothing nulls the field]**
- On send, auto-sync is fired **non-blocking and the result is fully swallowed**:
  `src/pages/Invoices.jsx:721-724` → `.then(() => onQbSynced()).catch(() => {})`.
  So neither the original lost-response failure nor the later duplicate error was
  ever surfaced to the user. **[LOCKED]**
- "Pull Back didn't ask for a reason" is consistent: `handlePullBack`
  (`Invoices.jsx:1721-1725`) only opens the void modal when `qb_invoice_id` is
  set. It was null → silent no-void branch → kept the same id 10051 → same
  burned DocNumber. **[LOCKED]**

---

## §1 — Prior-work interaction (the stated fear: "work was done that caused this; the fix may undo it")

**Prior work, git-verified:**
- `bb66d5f` (Apr 2) — "qb-sync-invoice updates existing QB invoice instead of
  skipping." Established: re-sync of a *linked* invoice should **update**, not
  orphan.
- `04da90f` / **B34** (May 22) — the **two-row void design**: pull-back of a
  *QB-linked* invoice marks the original `voided_at` (keeps `qb_invoice_id` for
  QB audit) and mints a **new SC id** as the replacement. Same commit added the
  `qb_duplicate_docnum` message: *"likely a voided record. Pull back to void +
  replace, then retry."*

**Did prior work cause the bug?** No. The two-row design runs only when
`qb_invoice_id` is set. #10051 had null — it never entered that path. The desync
is a lost write-back, independent of B34. **[LOCKED]**

**But B34 left a real gap.** Its `qb_duplicate_docnum` recovery advice — "pull
back to void + replace" — **does not work in this state**: pull-back with a null
`qb_invoice_id` keeps the same id 10051 (no new id is minted), so the user loops
back into the same burned number. That dead-end is the prior-work gap, not
something a fix would be "undoing." **[LOCKED]**

**Would the first-draft fix undo prior work?** Mostly no — but it stepped on one
invariant, which is why this was halted and sent to audit:
- It does **not** touch the two-row void flow (that's the `isUpdate` path).
- It **preserves** the voided-number-is-burned rule (draft returned
  `qb_duplicate_docnum` when the QB match looked voided).
- **The tension [DESIGN-OPEN]:** B34 carries an implicit invariant — *SC never
  writes onto a QB invoice it isn't already linked to.* The draft's "adopt any
  live QB invoice found by DocNumber and update it" **breaks that invariant** and
  leans on a **heuristic** (`TotalAmt === 0`) to distinguish voided from live. If
  the heuristic misfires, SC could overwrite or resurrect a QB audit record.
  This is the thing to audit before building.

---

## §2 — Options

- **Option A — Silent adopt-by-DocNumber in the create branch** (first draft).
  Self-heals every wedge automatically. Risk: breaks the "never touch unlinked QB
  invoice" invariant; voided/live detection is heuristic.
- **Option B — Explicit reconcile.** Same DocNumber lookup, but surface a "This
  invoice already exists in QuickBooks — Reconcile?" action so the operator
  confirms the adopt. Preserves the invariant (human in the loop). Cost: one
  extra click on the rare wedge.
- **Option C — Prevent-only.** Make the auto-sync on send **blocking +
  error-surfacing** (`Invoices.jsx:721`) so a lost/failed create is shown
  immediately and never silently wedges. Also teach `handlePullBack` to detect
  "null link but QB may have it." Does not heal invoices *already* wedged (like
  #10051 today).
- **Option D — Data-only.** Manually set #10051's `qb_invoice_id` to the real QB
  id after confirming that QB record is live, plus a narrow guard. Fixes the one
  invoice; leaves the class of bug open.

**Recommendation for audit: C + B** — fix the swallow at `Invoices.jsx:721` so
this cannot silently recur (root-cause prevention), and make healing **explicit**
(B) not silent (A), keeping B34's invariant intact and a human on any write to a
previously-unlinked QB record. Handle #10051 itself as one-time reconciliation
(D) once QB state is confirmed. **[DESIGN-OPEN — auditor to ratify]**

---

## §3 — Blocking unknown before ANY write

**[BLOCKED]** Whether QB's DocNumber 10051 is a **live** $5,754 invoice or a
**voided/$0** record is unconfirmed — the QuickBooks MCP token is expired. This
is decisive:
- **Live** → reconciliation = adopt its id into SC; the invoice is real and may
  already be in front of the customer.
- **Voided** → the number is burned; #10051 needs a new id, and any "adopt" path
  must refuse.

**Do not touch data or ship a heal path until this is read.** Unblock:
re-authorize the claude.ai Intuit QuickBooks integration, then query DocNumber
10051 (live vs voided, QB id, balance).

---

## §4 — Files in scope
- `supabase/functions/qb-sync-invoice/index.ts` — create branch `:358-367`;
  error map `:390`.
- `src/pages/Invoices.jsx` — swallowed auto-sync `:721`; `handlePullBack` `:1721`.
- No migration. No schema change.

---

## §5 — Audit manifest

Ratify these before build:
1. Does adopt-by-DocNumber (Option A) violate B34's "don't overwrite unlinked QB
   invoices" invariant, and is that acceptable? (read `04da90f`)
2. Is `TotalAmt === 0` a safe voided-vs-live signal in QB, or can a legitimate
   live invoice read $0 / a voided one read non-zero? (QB entity semantics)
3. Confirm no other caller reaches the create branch with a reused DocNumber
   (deposit machinery, archive re-import). Grep `DocNumber`, `qb-sync-invoice`
   invocations.
4. Is making `Invoices.jsx:721` blocking safe, or does send latency/UX regress?
   (it currently fires-and-forgets by design)
5. Validate the §0 lost-write-back mechanism against any alternative origin for a
   null `qb_invoice_id` co-existing with a live QB record.
