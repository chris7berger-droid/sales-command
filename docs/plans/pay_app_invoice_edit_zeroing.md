# Pay App invoice zeroed by Edit → Save

- **Date:** 2026-06-04
- **Branch:** `fix/pay-app-invoice-edit-zeroing`
- **Repro case:** Invoice #10069, job 7432 (Lake Tahoe School Demo Epoxy Underlayment)
- **ERD loop:** #32 — pay-app-invoicing-issues
- **Confidence tags:** [LOCKED] verified in code/data · [DERIVED] inferred, needs confirmation · [DESIGN-OPEN] decision pending

---

## §0 Reproduction (observed)

- Invoice #10069 is a Pay App #1 invoice. The **PAY APPS table** at the bottom of
  the invoice detail screen shows correct numbers: This App **$32,476**,
  Retention **$1,624**, Payment Due **$30,852**.
- The three **summary cards** at the top (INVOICE AMOUNT, DISCOUNT, NET TOTAL)
  all show **$0.00**.
- The **Invoices list** shows the invoice amount as **$0.00** (status "Sent").
- In **QuickBooks**, the synced invoice has **two "Services" line items at $0.00**,
  Invoice total $0.00, and status flipped to **Paid** (a $0 balance reads as paid).
- The invoice `description` contains the literal text "(DEPOSIT INVOICE)".

User action that preceded this: opened invoice #10069 in the **Edit** form and
edited the description (added the word "deposit"), then saved. User did **not**
edit any line %; the user typed "deposit" into the description and the email body.

---

## §1 Evidence trail (code, with file:line)

1. **Detail cards read `invoice.amount`** — `src/pages/Invoices.jsx:1632-1637`.
   `amount` is 0 → cards show $0.
2. **List amount reads `invoice.amount`** — `src/pages/Invoices.jsx:2092`. Same 0.
3. **QB lines built from `invoice_lines.amount`** — `supabase/functions/qb-sync-invoice/index.ts:232-244`.
   Two lines came over at $0 → the two `invoice_lines` rows have `amount = 0`.
4. **PAY APPS table reads the separate `billing_schedule_pay_apps` row**
   (`this_app_amount`, `retainage_withheld`, `current_payment_due`) —
   `src/components/BillingScheduleSection.jsx:651-653`. That row is intact.
5. **"deposit" is not a trigger** — case-insensitive grep of `src/` + all edge
   functions returns **zero** matches for "deposit". `git log -S "DEPOSIT INVOICE"`
   across all branches is empty. The text is user-entered data in `description`;
   QB shows it because `qb-sync-invoice` sets `CustomerMemo = invoice.description`
   (`index.ts:340-341`). It has no effect on QB behavior. [LOCKED]
6. **Pay-app line items are hidden in the edit form** — the line-items table is
   wrapped in `{!linkedPayApp && ...}` (`Invoices.jsx:1646`). So the user never
   saw or edited line %; only the description.

---

## §2 Root cause [LOCKED — pending one DB confirmation, see §6]

`handleSaveEdit` (`src/pages/Invoices.jsx:1230-1263`) recomputes **every** line's
amount on save. Original code:

```js
const newLines = lines.map(l => {
  if (isArchiveInvoice) { /* preserve directly-entered amount */ }
  const wtc = l.proposal_wtc;
  const wtcTotal = wtc ? calcWtcPrice(wtc) : 0;          // pay-app line has no proposal_wtc → 0
  const pct = parseFloat(editPcts[l.id]) || 0;
  return { id: l.id, billing_pct: pct, amount: Math.round(wtcTotal * (pct / 100) * 100) / 100 };  // → 0
});
const newAmount = newLines.reduce((sum, l) => sum + l.amount, 0);  // → 0
```

- `isArchiveInvoice` is defined as lines with **neither** `proposal_wtc_id` **nor**
  `billing_schedule_line_id` (`Invoices.jsx:1214`).
- A pay-app/SOV invoice's lines have `billing_schedule_line_id` set (written by
  `NewPayAppModal.jsx:200-205`). So they are **not** archive and **not** WTC →
  they fall through to `wtcTotal × pct`. With no `proposal_wtc`, `wtcTotal = 0`,
  so every line → 0, `newAmount` → 0.
- `handleSaveEdit` then writes `amount: 0` to `invoices`, `amount: 0` to each
  `invoice_lines` row (`:1269`), and — when `inv.qb_invoice_id` is set — re-invokes
  `qb-sync-invoice` (`:1283`), pushing the $0 lines to QB.
- The **pay app row is never touched** by `handleSaveEdit` → it stays correct.
  This is exactly why the data diverged.

The UI already hides pay-app lines from editing (`!linkedPayApp`), but the **save
handler has no matching guard** — so editing the description (or any other field)
on a pay-app invoice silently zeroes the money.

---

## §3 Fix — code (build-terminal spec)

`src/pages/Invoices.jsx`, in `handleSaveEdit`, add a pay-app branch that preserves
the stored amount/% instead of recomputing:

```js
if (l.billing_schedule_line_id) {
  return { id: l.id, billing_pct: l.billing_pct, amount: parseFloat(l.amount) || 0 };
}
```

Rationale: pay-app line dollars are owned by the billing-schedule + pay-app flow
(`PayAppDetailModal.handleSaveLines`), not this generic editor. Preserving them
matches the existing `isArchiveInvoice` pattern (which also preserves rather than
recomputes). After this, `newAmount` = sum of preserved lines = correct gross.

**Round-1 audit B — guard extends beyond the line amount.** Retention and discount
are also owned by the pay-app flow, so for a pay-app invoice (`linkedPayApp`) the
save must **preserve** `inv.retention_pct`, `inv.retention_amount`, and `inv.discount`
instead of recomputing them from the edit-form inputs:

```js
const retPct   = linkedPayApp ? (parseFloat(inv.retention_pct) || 0)    : (parseFloat(editRetentionPct) || 0);
const retAmt   = linkedPayApp ? (parseFloat(inv.retention_amount) || 0) : Math.round(newAmount * (retPct/100) * 100)/100;
const discount = linkedPayApp ? (parseFloat(inv.discount) || 0)         : (parseFloat(editDiscount) || 0);
```

And the **Retention / Discount inputs must be hidden** in the edit form for pay-app
invoices (wrap `Invoices.jsx:1588-1603` in `{!linkedPayApp && …}`), mirroring the
already-hidden line-items table (`:1651`). So the UI no longer exposes fields the
save path must ignore. QB re-sync then pushes correct lines + retention.

Archive and proposal-WTC invoices are unchanged. [LOCKED]

---

## §4 Fix — data repair (invoice #10069)

The code fix prevents recurrence but does not restore the already-zeroed row
(preserving "0" keeps it 0). Restore from the intact pay app:

- Source of truth: `billing_schedule_pay_apps.this_app_amount` (header) and
  `billing_schedule_pay_app_lines.billed_amount_this_app` (per line).
- SQL: pre-check (A) → repair header + lines in a transaction (B) → post-check (C).
  Exact statements in **Appendix — Repair SQL** below.

[DERIVED] Assumes `invoice_lines` rows still exist (2 of them) and are merely
zeroed — **Gate 1:** pre-check A must confirm exactly **2** `invoice_lines` rows
for #10069 (both non-NULL `billing_schedule_line_id`) and **2** matching
`pay_app_lines`. If counts differ, STOP — the join would silently leave a line at 0.

---

## §5 QB re-sync + ordering [LOCKED — ordering matters]

After data repair, QB still holds the $0/paid invoice. Re-sync to push correct lines.

**Required order:**
1. Deploy the code fix to prod **first**. (Otherwise an Edit→Save re-zeroes.)
2. **Do NOT open #10069 in Edit between deploy and the SQL repair** (round-1 audit E).
   An accidental Edit→Save before the data is restored re-writes the still-zero
   stored values. Repair the data first, then touch the invoice.
3. Run SQL A → B → C (see Appendix; Gates 1, 2 must pass).
4. Re-sync QB via the **"Sync to QuickBooks" button** (`handleQBSync`, `Invoices.jsx:1138`)
   — **not** Edit→Save (round-1 audit A). The Edit→Save QB call is fire-and-forget
   (`.catch(() => {})` at `:1289`): it swallows QB errors and would report save success
   while QB silently stays $0. `handleQBSync` awaits the result; the build terminal
   must also make it surface the real error body via `fnErr.context.json()` (the
   FunctionsHttpError Response is on `fnErr.context`; `.message` alone is generic).
   Verify QB reopens to ~$30,852 due and the false "Paid" clears.

---

## §6 Risks / open questions

1. [DERIVED] **DB state unconfirmed** — investigation was code-only (local has anon
   key, RLS-blocked). Pre-check A must confirm `invoice.amount = 0` and the pay
   app holds 32476/1624 before repairing.
2. [DESIGN-OPEN] **Completeness** — are there *other* entry points that recompute
   pay-app invoice lines against `proposal_wtc` and could zero them? (e.g. retention
   release, status changes, re-send.) Planning agent to confirm `handleSaveEdit`
   is the only such path.
3. **Known adjacent (out of scope this loop):** `PayAppDetailModal.handleSaveLines`
   updates `invoices.amount` + `pay_app.this_app_amount` but does **not** update
   `invoice_lines` — a separate divergence path (UI→QB) worth a backlog item.
4. Per user: **broad scan for other affected invoices is skipped** this loop.

---

## §7 Out of scope

- Scanning/repairing other pay-app invoices (user deferred).
- The `handleSaveLines` invoice_lines divergence — build terminal should **file as
  B42** in `docs/BACKLOG.md` (T2; non-zeroing UI→QB drift; fix: also update
  `invoice_lines` in `handleSaveLines`). Not fixed this loop.
- Any change to the "deposit" labeling workflow (confirmed harmless).

---

## §8 Independent planning-agent verdict (2026-06-04)

**Root cause CONFIRMED · Fix + repair APPROVED.** Agent verified every claim
against code + migrations.

- Fix cannot misfire on proposal-WTC (NULL `billing_schedule_line_id`) or archive
  (caught by `isArchiveInvoice` first) invoices.
- `handleSaveEdit` is the ONLY path that zeroes pay-app lines. `handleBillRetention`,
  `handlePullBack`, `handleVoidConfirm` (copies amounts directly), and status
  updaters do not recompute lines.
- All repair-SQL columns exist (`20260417140000_pay_apps.sql`,
  `20260420170000_invoices_retention.sql`); join is 1:1 via
  `UNIQUE (pay_app_id, billing_schedule_line_id)`.

**Execution gates (must pass before/while repairing):**
1. **Gate 1 — row counts:** pre-check A shows exactly 2 invoice_lines (non-NULL
   `billing_schedule_line_id`) and 2 matching pay_app_lines. Mismatch → STOP.
2. **Gate 2 — QB payment:** before re-sync, confirm in QB that **no Payment
   object** is attached to #10069 (the "Paid" state must be balance-derived only;
   user never clicked Mark as Paid, so none should exist). The full re-sync
   (`qb-sync-invoice` `sparse:false`) raises the balance to ~$30,852 and the false
   Paid clears on its own.
3. **Gate 3 — deploy order:** code fix to prod BEFORE any Edit→Save re-sync.

**RLS note:** the Supabase SQL editor runs as table owner and bypasses tenant RLS
on `billing_schedule_pay_apps`/`invoices` — confirm you're acting on the correct
tenant's #10069.

**Backlog item to file:** `PayAppDetailModal.handleSaveLines` (`:249-252`) updates
`invoices.amount` but NOT `invoice_lines` → stale per-line amounts that a later QB
re-sync would push. Separate, non-zeroing UI→QB drift. Out of scope this loop.

---

## Appendix — Repair SQL (invoice #10069)

**A — Pre-check (+ Gate 1 counts):**
```sql
select i.id, i.amount, i.retention_amount, i.retention_pct,
       pa.this_app_amount, pa.retainage_withheld, pa.retainage_pct_snapshot
from invoices i
join billing_schedule_pay_apps pa on pa.invoice_id = i.id
where i.id = '10069';

-- Gate 1 (join-based, round-1 audit C): every invoice_line for #10069 must match
-- EXACTLY ONE pay_app_line and have a non-NULL billing_schedule_line_id. Any failing
-- row => STOP — the repair join (B) would silently leave that line at 0.
select il.id as invoice_line_id,
       il.billing_schedule_line_id,
       count(pal.*) as pa_line_matches
from invoice_lines il
left join billing_schedule_pay_apps pa on pa.invoice_id = il.invoice_id
left join billing_schedule_pay_app_lines pal
       on pal.pay_app_id = pa.id
      and pal.billing_schedule_line_id = il.billing_schedule_line_id
where il.invoice_id = '10069'
group by il.id, il.billing_schedule_line_id
having count(pal.*) <> 1 or il.billing_schedule_line_id is null;
-- Expect: ZERO rows. Any row returned => STOP, do not run B.

-- Gate 2 (round-1 audit D): the false "Paid" must be balance-derived only — no QB
-- Payment object recorded. Confirm qb_payment_id IS NULL before re-syncing.
select id, status, qb_payment_id from invoices where id = '10069';
-- Expect: qb_payment_id IS NULL. If populated => STOP, resolve the QB payment first.
```

**B — Repair (transaction):**
```sql
begin;

update invoices i
set amount           = pa.this_app_amount,
    retention_amount = pa.retainage_withheld,
    retention_pct    = pa.retainage_pct_snapshot
from billing_schedule_pay_apps pa
where pa.invoice_id = i.id
  and i.id = '10069';

update invoice_lines il
set amount      = pal.billed_amount_this_app,
    billing_pct = pal.billed_pct_this_app
from billing_schedule_pay_apps pa
join billing_schedule_pay_app_lines pal on pal.pay_app_id = pa.id
where pa.invoice_id = il.invoice_id
  and pal.billing_schedule_line_id = il.billing_schedule_line_id
  and il.invoice_id = '10069';

commit;
```

**C — Post-check assertions (round-1 audit C — all must hold):**
```sql
select
  i.amount,
  i.retention_amount,
  i.retention_pct,
  pa.retainage_pct_snapshot,
  (select coalesce(sum(il.amount), 0) from invoice_lines il where il.invoice_id = i.id) as line_sum,
  (select count(*) from invoice_lines il where il.invoice_id = i.id and coalesce(il.amount, 0) = 0) as zero_lines,
  case
    when (select coalesce(sum(il.amount), 0) from invoice_lines il where il.invoice_id = i.id) = i.amount
     and (select count(*) from invoice_lines il where il.invoice_id = i.id and coalesce(il.amount, 0) = 0) = 0
     and i.retention_pct = pa.retainage_pct_snapshot
    then 'PASS' else 'FAIL'
  end as verdict
from invoices i
join billing_schedule_pay_apps pa on pa.invoice_id = i.id
where i.id = '10069';
```
Expect: **verdict = PASS** — `line_sum = amount` (lines reconcile to the header),
`zero_lines = 0` (no line left at $0), and `retention_pct = retainage_pct_snapshot`.
Sanity: `amount` ~32476, `retention_amount` ~1624.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-04. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Tiny code change (a 3-line guard) but it touches money and QuickBooks, plus a one-off
hand-run repair on a live invoice. So this is a small, money-touching review — three
reviewers on the three risky spots: the save logic, the QuickBooks re-sync, and the
repair SQL. A focused check, not a deep one.

### Round
- Current round: 1
- Plan revision under audit: c09d721
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: do NOT re-find issues from prior rounds. (None exist — round 1.)
Attack the plan revision under audit (c09d721).

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding is F-tier/blocked.
- **Prod / staging / dev**: LIVE for the paying customer. Invoice #10069 is a real
  prod invoice; the edit-save path and `qb-sync-invoice` are in active use.
- **Blocking feature flags**: `customers.requires_pay_app` gates pay-app vs regular
  invoice routing (live/on for HDSP).
- **Concurrency profile**: solo / ≤5 (small office team).

Agents weight severity against these. Cross-tenant findings cap at Med (live_tenants==1).
Multi-user race findings cap at Low (solo/≤5). Theoretical blast-radius against
state that doesn't exist yet is not High.

### Time budget + finding cap
- **Time budget**: 30 min (ERD loop #32 lock)
- **Finding cap**: 3 findings (`max(3, ceil(30/10))`)

Surface only the top-3 most consequential findings. Remainder → "Quarantined findings
(not actionable this loop)."

### Surface
- Total lines: 243
- Sections: 9 (§0–§8) + Appendix
- [LOCKED] decisions: 5
- [DESIGN-OPEN] items: 2
- [OPEN] items: 0
- Plan-to-code ratio: ~243 : ~3 code lines (+~20 SQL) ≈ 81:1 code-only / ~10:1 incl. SQL.
  Flagged >50:1 — but by design: the doc is mostly the SQL appendix + evidence trail +
  independent-vetting record, not scope creep. The actual fix is one guard branch.

### Layers touched
- UI / components (`Invoices.jsx` edit-form save handler)
- Data layer (`invoices` + `invoice_lines` writes; the one-off repair SQL)
- External integrations (QuickBooks via `qb-sync-invoice`)

### New mechanisms introduced
- New columns: none
- New tables: none
- New helper functions/hooks: none (one `if` branch added to existing `handleSaveEdit`)
- New triggers / RLS policies: none
- New routes / jobs / webhooks: none
- (One-off data-repair SQL — a manual prod mutation, not a persistent mechanism.)

### Cross-system reach
- QuickBooks — `qb-sync-invoice` full-update path mutates the real QB invoice.
- Service-role / RLS-bypass write path — repair SQL run in the Supabase SQL editor
  executes as table owner, bypassing tenant RLS on `invoices`/`billing_schedule_pay_apps`.
- Shared Supabase (FC+SC) — surface is SC invoice tables only; no cross-repo readers
  of `invoice_lines`.

### Irreversibility
- One-off prod data UPDATE on `invoices` + `invoice_lines` (money fields) — reversible
  only by re-editing; treat as careful.
- QB invoice mutation via re-sync (external; mutates a real QuickBooks record).
- No schema migration, no backfill script, no ledger coordination.

### Known weak points
- §6.1 / Gate 1: DB state is code-inferred, not confirmed. Join leaves a line at 0 if
  any `invoice_lines` row has NULL `billing_schedule_line_id` (FK is `ON DELETE SET NULL`).
- §8 / Gate 2: re-sync assumes no QB Payment object on #10069. If one exists, updating
  amounts could leave a credit/overpayment artifact.
- `retention_pct` snapshot unit (fraction vs percent) — agent judged self-consistent;
  still a money-rounding pressure point worth one look.
- §8 / Gate 3: deploy-before-resync ordering. If violated, an Edit→Save re-zeroes.
- Adjacent (out of scope): `PayAppDetailModal.handleSaveLines` updates `invoices.amount`
  but not `invoice_lines` — non-zeroing UI→QB drift (backlog candidate).

### Open questions
- Count: 1 (§6.2 completeness — whether `handleSaveEdit` is the only pay-app-line
  zeroing path). Largely resolved by the independent planning agent (§8: yes), but
  the audit should re-pressure it.
- Highest-pressure: any other writer of `invoice_lines.amount` for a pay-app invoice;
  presence of a QB Payment object before re-sync.

### Suggested attack angles (3 total)
1. **Save-logic — fix correctness & completeness** — covers UI + data layer. Required
   reading: `src/pages/Invoices.jsx` (`handleSaveEdit`, `isArchiveInvoice` ~1214, lines
   load ~1041), `src/components/PayAppDetailModal.jsx` (`handleSaveLines` 232-261),
   `src/components/NewPayAppModal.jsx`. Pressure: can the new `billing_schedule_line_id`
   guard misfire on proposal-WTC or archive invoices? Is `handleSaveEdit` truly the only
   path that zeroes pay-app `invoice_lines`? Do preserved amounts feed a correct
   `newAmount` + retention recompute?
2. **QuickBooks re-sync** — covers external integration. Required reading:
   `supabase/functions/qb-sync-invoice/index.ts` (line build ~232-244, update path
   ~344-374), `Invoices.jsx` QB invoke + mark-as-paid. Pressure: does the full re-sync
   correctly replace the two $0 lines and clear the false Paid? SyncToken / Payment-object
   / negative-retention-line hazards.
3. **Data-repair SQL + irreversibility** — covers data layer + RLS bypass. Required
   reading: `supabase/migrations/20260417140000_pay_apps.sql`, `invoice_lines` /
   `invoices` schema migrations. Pressure: exact column names, join cardinality (NULL
   `billing_schedule_line_id`, missed/duplicated lines), RLS-bypass tenant safety,
   transaction safety, `retention_pct` unit.

### Suggested agent count: 3

Rationale: the strict formula nudges to 4 (3 layers + cross-system), but QB-as-layer
and QB-as-cross-system are the same surface and collapse into one angle — so 3 is the
honest split, matches the finding cap (3) and the 30-min budget, and hits the 3-agent
sweet spot.
