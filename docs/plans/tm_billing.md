# T&M Billing — Day Rows on the Invoice

**Type:** feature
**Status:** BUILD PLAN — scoped 2026-08-07 after round-2 audit. Planning closed; no round 3.
**Repo/branch:** `sales-command` @ `feat/tm-tickets`
**Migrations live in:** `command-suite-db` (single source of truth since 2026-06-29)
**Driving artifact:** `CCF_000982.pdf` — HDSP's paper "T&M Authorization", filled + signed, job 7215 STY 4
**Supersedes:** `docs/plans/tm_tickets.md` v1 (ticket-object design) and v2 (billing + rate-card exclusion in one plan)

**Split out of this plan:** making rate cards stop counting as contract dollars. See §13.

Confidence tags: **[LOCKED]** decided by Chris · **[DERIVED]** mechanical from code/schema read · **[DESIGN-OPEN]** needs a decision.

---

## Planning history

| round | plan | findings | outcome |
|---|---|---|---|
| 1 | v1 — T&M ticket as its own object (3 tables, 12 policies, own routes) | 23 caused-by · 1C/5H/15M/4L · `rate-card-exclusion-overreach` | model replaced |
| 2 | v2 — the invoice line *is* the ticket | 14 caused-by · 0C/7H/7M · `migration-procedure-concentration` | **−39%, Critical dissolved → model validated** |
| — | v3 (this doc) — billing half only | closed | rate work split to its own loop (§13) |

Round 2 settled the design question: deleting the ticket object removed the whole class of problems it generated. What remained was not in the model — it was concentrated in one mechanism (the rate-card exclusion) and its deployment procedure. That mechanism is now its own job, and this plan is closed to further audit.

---

## §0 Baseline — verified current state (2026-08-07)

**Method:** code **read-verified** on `feat/tm-tickets`; live data and database objects **run-verified** against `pbgvgjjuhnpsumnowuym`. Labelled per claim.

### 0.1 The live proposal — 7215 STY 4 P7 [run-verified]

P7 = `72572e85-98ae-476d-8067-ee5c3494fb69` · customer `Contract Flooring` · status **`Sent`** · total `28379.64` · job `call_log.id = 3791` (`7215 - STY 4`). Tenant `246f6551-60de-4965-bb97-9a52971bc05d`.

| WTC | work_type | regular_hours | markup_pct | locked_line_total | what it is |
|---|---|---|---|---|---|
| `3310068b…` | 30 Specialty | 1.00 | 0.00 | **27,999.64** | real money — material, bought all at once |
| `f220da87…` | 31 T&M | 1.00 | 85.84 | **105** | straight-time **rate**, $105/hr |
| `d4228e36…` | 31 T&M | 1.00 | 121.24 | **125** | time-and-a-half **rate**, $125/hr |
| `9f412aec…` | 31 T&M | 1.00 | 165.49 | **150** | double-time **rate**, $150/hr |

All four `locked: true`. `work_types` 30 = `Specialty`, 31 = `T&M`. `work_type_id = 31` exists on 3 WTCs / 1 proposal and no code reads it — `grep -rin "T&M\|time_and_material\|hourly" src/` returns zero hits [read-verified].

`Contract Flooring.requires_pay_app = false` → regular invoice route, not pay-app/SOV.

**Note under this scope:** P7's total stays **$28,379.64**, including the $380 of phantom hours. That is today's behavior and this plan does not change it (§13).

### 0.2 Invoicing is percent-of-WTC, capped at 100% [read-verified]

`Invoices.jsx` — `:167` loads existing lines as `proposal_wtc_id, billing_pct`; `:186-189` `getBilledPct` sums `billing_pct` per WTC; `:191-193` `getRemainingPct = 100 - billed`; `:214-221` `validatePcts`; `:196-206` line amount = `calcWtcPrice(wtc) * pct/100`.

Maximum lifetime billing against the $105/hr WTC: **$105.00**.

**`getBilledPct` sums `billing_pct`.** A line storing `billing_pct = null` contributes 0 — so a T&M line can carry a WTC reference without ever consuming that WTC's percentage. This is what makes §2.4 safe.

### 0.3 The invoice form refuses to save without a percentage [read-verified — round-2 finding E]

`Invoices.jsx:206-219`:
```js
const invoiceTotal = wtcs.reduce((sum, w) => sum + getLineAmount(w), 0);
const hasAnyPct = Object.values(billingPcts).some(v => parseFloat(v) > 0);
function validatePcts() {
  …
  if (!hasAnyPct) return "Enter a billing % for at least one work type";
  return null;
}
```
`handleCreate` (`:220`) calls `validatePcts` for every non-archive proposal, and `invoiceTotal` feeds `finalAmount` at `:277`.

**Two hard blocks, both must be fixed (§4.4):** a week of day rows carries no percentage, so the form rejects it outright; and `invoiceTotal` counts only percent lines, so a mixed invoice would write a header that disagrees with its own lines.

### 0.4 The archive escape hatch [read-verified]

`Invoices.jsx:224-235` — `is_archive_proposal` proposals take a free-form amount; `:288-296` inserts one line with `proposal_wtc_id: null, billing_pct: null`. A null-percent, amount-only line already works end to end.

### 0.5 `invoice_lines` already carries a second line kind [read-verified]

Live columns: `invoice_id, proposal_wtc_id, billing_pct, amount, tenant_id, billing_schedule_line_id, description`.

`billing_schedule_line_id` (pay apps) is handled as a parallel kind — `invoicePdf.js:268-281` branches `const isSov = !wtc && sov`. Precedent for a third kind is in production.

### 0.6 The regular-invoice document is a web page, not a PDF [read-verified]

`generateInvoicePdf` (`invoicePdf.js:28`) has one caller — `PayAppDetailModal.jsx:333`; its WTC branch is annotated `:276-280` as *"currently unreached."* The customer sees `PublicInvoicePage.jsx` (`/invoice/:token`), loading lines at `:50-51` and rendering work-type name + billing % + amount at `:219-228`.

### 0.7 Attaching the signed scan already works [read-verified]

`invoice_attachments` is live — `Invoices.jsx:599, 1236, 1265, 1285`; `send-invoice/index.ts:73-137` loads from storage, base64-encodes under a size cap, attaches to the email. **Zero new work.**

### 0.8 The line-edit path recomputes from the WTC [read-verified — round-2 finding A1 origin]

`handleSaveEdit` (`Invoices.jsx:1795-1811`) has preserve branches for synced-lock (`:1798`), archive (`:1801`) and SOV (`:1810`), then falls through to `wtcTotal = wtc ? calcWtcPrice(wtc) : 0` × pct. Third occurrence of the `calcWtcPrice → 0` mechanism (archive `14000c5`, pay-app `33c385e`).

### 0.9 Void-and-replace copies four fields [read-verified — round-2 finding A3]

`Invoices.jsx:2137-2143` maps replacement lines as exactly `{invoice_id, proposal_wtc_id, billing_schedule_line_id, billing_pct, amount}` — **not `description`**. The header mapper at `:2125-2133` carries `type` and `is_deposit` but nothing else new.

### 0.10 QuickBooks labels lines by work type, never by description [read-verified]

`qb-sync-invoice/index.ts:150-152` loads lines with `proposal_wtc(*, work_types(name, cost_code))`; `:243-256` emits `Description = work_types.name || "Services"`. It never consults `line.description` — so five day rows on one rate card would push five identical `"T&M"` lines (§5.3).

### 0.11 The job screen loads invoices without their lines [read-verified]

`CallLogDetail.jsx:222`:
```js
supabase.from("invoices").select("id, status, amount, job_name, voided_at, void_reason, retention_release_of")
```
`sumContractBilled` (`calc.js:203-208`) takes **invoices** and sums `i.amount`. **There is no line-level data on this screen**, so nothing can currently distinguish T&M dollars from contract dollars (§6).

### 0.12 Marking a proposal Sold fires three irreversible side effects [run-verified — this is why §8 exists]

- `ProposalDetail.jsx:804-813` writes `status: 'Sold'`, sets `call_log.stage = 'Sold'`, and invokes `qb-create-job` — **creating a QuickBooks customer the app cannot delete.**
- `trg_notify_proposal_approved` is `AFTER UPDATE OF status ON proposals FOR EACH ROW` [run-verified via `pg_get_triggerdef`] — **it fires on a direct SQL UPDATE too, not only on the button.** Its function posts to the `proposal-approved` edge function, emailing the sales rep that a proposal was approved. Email cannot be unsent.
- `PublicSigningPage.jsx:70` immediately renders the customer's live link as **"Proposal Accepted."**

**Two existing escape hatches [run-verified]:**
- `ProposalDetail.jsx:812` — `const isTest = (p.call_log?.job_name || "").toLowerCase().includes("test")`, and `:813` skips `qb-create-job` when true. **The app already has a test guard, keyed on the job name containing "test".**
- `notify_proposal_approved` returns early when `NEW.is_archive_proposal` is true, and also requires `cron_secret` in the vault.

### 0.13 The paper form being replaced [run-verified against `CCF_000982.pdf`]

**High Desert Surface Prep — T&M Authorization.** Date `8/4/26` · Location `STY 4 FSA` · Bill To *(blank)* · Description `CAULKING PERIMETER WALLS`.

LABOR — Date · Employee Count · Area Work Performed · Hours REG/OT · Rate · Amount:

| Date | Emp | Area | REG | OT | Rate | Amount |
|---|---|---|---|---|---|---|
| 8/4/26 | 5 | FSA Priority Areas | 27 | 13 | $105/$125 | $4,460.00 |
| 8/5/26 | 2 | FSA Priority Areas | 16 | 5 | $105/$125 | $2,305.00 |
| | | | | | **TOTAL** | **$6,765.00** |

Verified: (27×105)+(13×125)=4,460 ✓ · (16×105)+(5×125)=2,305 ✓ · 6,765 ✓.

MATERIAL/EQUIPMENT — one row (`8/4/26 · TREMCO DYMONIC 100`) with **no price** — material bills separately under the Specialty WTC.

Footer: `Prepared by: PAUL BASIL` (signed 8/5) · `Accepted by:` **Chris Renteria** (signed) · `08/06/26`.

Structural facts:
- Hours are **crew totals per day**, not per employee. No individual timesheet needed.
- The form **carries dollars** and the GC signed the dollar amount — unlike the industry quantities-only tag.
- One form spans **multiple work days** (header 8/4; rows 8/4 and 8/5).

---

## §1 Problem statement [LOCKED]

Open-ended T&M cannot be billed. The only mechanism is a percentage of a fixed price (§0.2), and T&M has no fixed price. Encoding an hourly rate as a one-hour WTC (§0.1) displays the rate correctly and caps lifetime billing at one hour.

HDSP already produces the right artifact on paper (§0.13): a signed, priced, finite authorization. It is retyped nowhere and billed by hand.

**This plan makes that paper billable.** It does not change what a proposal is worth (§13).

---

## §2 The rate card

### 2.1 New columns on `proposal_wtc` [LOCKED]

| column | type | notes |
|---|---|---|
| `is_rate_card` | boolean not null default false | this WTC supplies rates to day rows |
| `rate_class` | text null, check in ('regular','ot','dt') | which slot it fills |
| `rate_amount` | numeric null | dollars per hour, typed explicitly |

**`rate_amount` is explicit, not inferred [LOCKED].** Today the rate is readable only as `calcWtcPrice` of a WTC that happens to have `regular_hours = 1` (§0.1) — an artifact of data entry. Reading rates that way breaks the moment anyone edits hours.

**Keyed by `is_rate_card`, not `work_type_id = 31` [LOCKED].** A work-type row is user-editable; a rename or delete would silently un-mark every rate card.

### 2.2 Authoring [LOCKED]

Picking the **T&M** work type in `WTCCalculator.jsx` shows a **rate-card panel** — rate class + rate amount — alongside the schedule text already in `sales_sow`. `is_rate_card` is set by that choice, not by a separate checkbox a user could forget.

**The existing pricing fields keep saving exactly as they do today.** `handleSave` (`WTCCalculator.jsx:2110-2140`) writes `regular_hours`, `markup_pct`, `burden_rate`, `materials` and the rest unconditionally, and this plan does not change that. A rate-card WTC therefore still computes to $105 and still counts toward `proposals.total` — **identical to production today.** That is the deliberate boundary of this scope; making it stop counting is §13.

### 2.3 What the proposal shows [LOCKED]

**Unchanged.** The proposal, its PDF, and the signing page render exactly as they do now. Rate cards continue to print as $105 / $125 / $150 line totals and continue to sum into $28,379.64.

Making the proposal read as a rate card is §13's job, and it is the half that touches the customer-facing document. Nothing in this plan alters a customer-facing proposal surface.

### 2.4 A T&M invoice line carries the rate-card WTC [LOCKED]

`invoice_lines.proposal_wtc_id` = the rate-card WTC the rate came from.

Safe because `getBilledPct` (§0.2) sums `billing_pct`, which is null on a T&M line — it never consumes the rate card's percentage. What it buys, with no extra code:

- `isArchiveInvoice` (`Invoices.jsx:1747`, `:2358`) tests `lines.every(l => !l.proposal_wtc_id && !l.billing_schedule_line_id)` — a T&M line **has** a WTC, so a T&M-only invoice is never misread as an archive invoice.
- `Customers.jsx:707` work-type column and `SalesDash.jsx:497` revenue bucketing both resolve "T&M" normally instead of dropping the money into "Unknown."

**Multi-rate days:** the paper's 8/4 row mixes 27 REG @ $105 and 13 OT @ $125. The line points at **one** WTC — convention is the `regular` card; OT and DT rates ride on the row itself.

**[DESIGN-OPEN O1]** a pure-double-time day points at the `regular` card in the work-type column. Cosmetically odd, harmless to the money. Accept, or point at the highest class used?

### 2.5 Rate cards are filtered out of the percent list [LOCKED]

`Invoices.jsx` step 2 hides `is_rate_card` WTCs from the percentage list, so nobody can bill an hourly rate as a fixed line.

**One UI condition. No migration, no shared-function change, no customer-facing surface.** This is the only piece of §13's territory that stays, and it stays because it costs nothing and prevents an obvious mis-click.

---

## §3 The T&M invoice line

### 3.1 New columns on `invoice_lines` [LOCKED]

One row per work day, matching a row on the paper (§0.13):

| column | type |
|---|---|
| `work_date` | date null |
| `crew_count` | int null |
| `area` | text null |
| `reg_hours` / `reg_rate` | numeric null |
| `ot_hours` / `ot_rate` | numeric null |
| `dt_hours` / `dt_rate` | numeric null |

`amount` and `description` already exist. `amount` stores `reg_hours*reg_rate + ot_hours*ot_rate + dt_hours*dt_rate`, cent-rounded.

**Three fixed rate slots [LOCKED].** The paper has a REG/OT pair, P7 carries exactly three rates, and straight / time-and-a-half / double-time is the universal split. **Named limit:** a fourth class needs DDL — and `proposal_wtc.prevailing_wage`, `pw_rate`, `pw_ot_rate` already exist, so a prevailing-wage T&M job would not fit (O2).

**`work_date` is a Postgres `date`, so it must never be written with `toISOString()` [LOCKED — added 2026-08-10].** A T&M line is date-stamped by nature, which puts this build directly in the path of the bug fixed on main in `c648dc3` (`docs/handoffs/SC_Handoff_v178.txt`): `invoices.sent_at` is a `date`, every send path wrote `new Date().toISOString()`, and Postgres cast that UTC instant to the UTC date — so anything sent after 5pm Pacific was stamped **tomorrow** and dropped out of the date filter, in Sales Command and in QuickBooks. Twelve invoices had to be repaired in both systems.

Rules for every date this plan writes:

| field | type | write it with |
|---|---|---|
| `invoice_lines.work_date` | `date` | `tod()` from `src/lib/utils.js`, or the operator's typed wall-clock date |
| day counts between dates | — | `dayDiff()` from `src/lib/utils.js` — **not** `new Date() - new Date(str)` |
| `invoices.due_date`, `sent_at` | `date` | already on `tod()` post-`c648dc3`; do not reintroduce `toISOString()` |
| any `timestamptz` | `timestamptz` | `toISOString()` is correct — leave it alone |

There is no browser locale inside an edge function, so a date written server-side needs an explicit zone: `toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })` — see `supabase/functions/follow-up-reminders/index.ts:38`.

**Check the column type before writing any date field**, rather than assuming:
```
supabase db query --linked "select column_name, data_type from information_schema.columns where table_name='invoice_lines';"
```

**`amount` is stored, not derived [LOCKED].** It is a billed figure and must not move if a rate is later edited on the proposal.

**Known gap [DERIVED]:** no check constraint ties `amount` to `hours × rate`. §4.3's live total against the paper is the only cross-check, and it depends on a person comparing two numbers.

### 3.2 A day row bills once, at its own value [LOCKED]

`billing_pct = null`. The percent cap never applies. `getBilledPct` is not modified.

---

## §4 Creating and editing the invoice

### 4.1 Where [DERIVED]

The existing **New Invoice** modal in `Invoices.jsx`, extended with a third mode. No new screen, no new route, no new component.

Step 2 already branches archive (free-form amount) vs regular (percent per WTC). A **T&M** section appears when the selected proposal has rate-card WTCs. Both sections can appear on one invoice — the material WTC at some percent **and** the week's day rows. That is the normal case for job 7215.

### 4.2 The day-row form [LOCKED]

Same columns as the paper, same order: **Date · Crew · Area · REG hrs · OT hrs · DT hrs · Rate · Amount**, with "add row" per work day.

Rates prefill from the rate cards by class and stay editable per row; a row edited off the card value is marked so the office can see it diverged. Edits never write back to the proposal.

Material rows use the existing archive-style amount line — no new mechanism.

### 4.3 Live total against the paper [LOCKED]

The total updates as rows are typed so it can be checked against the handwritten total before saving. A mismatch against the paper is the most likely transcription error and the only check on §3.1's unconstrained `amount`.

### 4.4 The create path must accept a percent-free invoice [DERIVED — round-2 finding E]

Two changes in `Invoices.jsx`, both required or nothing can be billed:

1. **`validatePcts` (`:211-219`)** — replace the bare `if (!hasAnyPct)` with a check that the invoice has *any* billable content: at least one percent **or** at least one day row **or** a material line. The current message ("Enter a billing % for at least one work type") is wrong for a T&M invoice.
2. **`invoiceTotal` (`:208`)** — must sum percent lines **plus** day rows **plus** material lines. It currently sums only percent lines and feeds `finalAmount` at `:277`, so a mixed invoice would write a header of $12,000 against lines of $18,765.

**The header must equal the sum of its own lines.** That invariant is already load-bearing elsewhere (`Invoices.jsx:199-206` comments) and must hold for the new kind.

### 4.5 Weekly not-to-exceed [LOCKED]

`invoices.nte_amount numeric null`. Set when the GC has given a ceiling for that week, blank when they haven't. The form warns when day rows exceed it; it does not block. Prints either way — *"Not to exceed $X this week"* or *"No cap — billed as incurred."*

**Deliberately per-invoice, not per-job [LOCKED].** A GC may impose a cap partway through; billing is weekly, so the week is where the call gets made. A job-level ceiling was considered and rejected — no live use for it.

### 4.6 The line-edit path must preserve T&M amounts [DERIVED — round-2 finding A1]

A T&M line **has** a WTC (§2.4). `handleSaveEdit` (§0.8) falls through to a WTC recompute, and a rate-card WTC prices at $105 — so a $6,765 line becomes $105, `invoices.amount` is overwritten, and QuickBooks is re-synced full-replace with the wrong figure.

**Fix — a preserve branch matching the three that already exist at `:1798`/`:1801`/`:1810`, placed above the fall-through:**

```js
if (l.proposal_wtc?.is_rate_card) {
  return { id: l.id, billing_pct: null, amount: parseFloat(l.amount) || 0 };
}
```

**The line select at `Invoices.jsx:1541` must embed `proposal_wtc(is_rate_card)`.** Without it the test is silently false and the bug returns unchanged — a silent-false guard on a money path. **Build step 4 verifies the embed explicitly, not by inspection.**

Preserve is the only correct behavior: recompute is unreachable because the hours live on the row, not on the WTC.

### 4.7 Void-and-replace must carry the new fields [DERIVED — round-2 finding A3]

`Invoices.jsx:2137-2143` copies four fields (§0.9). It must also carry the **nine day columns** and **`description`** — `description` is dropped today, which is a pre-existing gap this plan must not inherit. The header mapper at `:2125-2133` must carry **`nte_amount`**, or a replacement invoice silently reads "No cap."

### 4.8 Display branches [DERIVED]

Sites rendering a line's full value as `calcWtcPrice(wtc)` need a rate-card branch returning the stored `amount`: `Invoices.jsx:946`, `:2370`, `PublicInvoicePage.jsx:225`. The `isSov` / `isArchiveLine` discrimination at `:2370` is the pattern to copy.

---

## §5 What the customer sees

### 5.1 The public invoice page [LOCKED]

`PublicInvoicePage.jsx:219-228` renders line = work-type name + billing % + amount. A T&M line has no percent, so it needs its own branch rendering **the day breakdown** — date · crew · area · hours by class · rate · amount — then the week's total and the NTE statement.

That breakdown is what makes the invoice approvable without a phone call.

**Narrow the select first [DERIVED — carried from round-2 adjacent].** `PublicInvoicePage.jsx:50-51` selects `proposal_wtc(*)`, shipping `burden_rate`, `ot_burden_rate`, `markup_pct`, `materials` and `discount` to unauthenticated viewers **today**. Before widening what this page reads, replace `*` with an explicit column allow-list. Pre-existing exposure; this plan is the right moment to close it because it is touching the same select.

### 5.2 The signed scan

Rides along via `invoice_attachments` (§0.7) — **zero code.**

### 5.3 QuickBooks [DERIVED — round-2 over-cap]

`qb-sync-invoice/index.ts:243-256` never consults `line.description` (§0.10), so five day rows would push five identical `"T&M"` lines. Prefer `line.description` when present:

```ts
const desc = line.description || line.proposal_wtc?.work_types?.name || "Services";
```

One line. **Verify it does not rewrite descriptions on existing pay-app invoices at their next full-replace sync** — archive lines write no description today, so the fallback must hold for them.

### 5.4 The invoice PDF

No change. `invoicePdf.js` has no regular-invoice caller (§0.6). **[DESIGN-OPEN O3]** confirm leaving it out.

---

## §6 The T&M row on the job screen [LOCKED]

`CallLogDetail.jsx:885-914` renders **Job Totals**: `Sold` · `Billed` · `Remaining` · `% Invoiced`. That box assumes a fixed contract. T&M has none, so T&M dollars landing in `Billed` with nothing matching in `Sold` push `Remaining` down about $6,765 per week.

**Don't bend the box. Add a row beside it:**

```
Sold  $607,840   Billed  $340,120   Remaining  $267,720   67%

T&M   $105 / $125 / $150 per hr
      43 reg · 18 OT hrs                        $6,765 billed
```

### 6.1 It needs line-level data the screen doesn't load [DERIVED — round-2 over-cap]

`sumContractBilled` takes invoices and sums `i.amount` (§0.11). It **cannot** be filtered by line kind — an invoice mixing material percent lines and T&M day rows has one `amount`.

**Fix:** extend the `CallLogDetail.jsx:222` invoice select to embed the lines it needs —
`invoice_lines(amount, proposal_wtc_id, reg_hours, ot_hours, dt_hours, proposal_wtc(is_rate_card))` — then:

- **Billed** = invoice amounts **minus** the sum of rate-card line amounts
- **T&M row** = the sum of rate-card line amounts, with hours totalled by class

One extra embed on a query that already runs. **Do not add a second round-trip**, and keep `sumContractBilled`'s existing retention-release exclusion (`calc.js:190-208`) intact — it is there because a raw sum double-counts retention.

**[DESIGN-OPEN O4]** should T&M revenue count toward billing goals (`SalesDash.jsx:131-137`, `Home.jsx:130-133`)? Out of scope either way.

---

## §7 Migration A — additive columns only

Authored in `command-suite-db`. 3 columns on `proposal_wtc` (§2.1), 9 on `invoice_lines` (§3.1), 1 on `invoices` (§4.5).

**No new tables. No new policies. No triggers. No indexes. No function replacements.** Existing RLS on all three tables already covers new columns.

- Author `rollbacks/<ts>_revert_tm_billing.sql` in the same PR — `command-suite-db/supabase/rollbacks/` holds 22 paired reverts.
- Apply with **`npm run db:push`**, never bare `supabase db push --linked` — the wrapper runs four gates including the cross-repo collision check.
- **No `migration repair --status reverted`** on a live entry; the README forbids it.
- Rehearse before pushing.

**On the rehearsal harness:** round 2 flagged that `rehearse.sh` fingerprints its loaded baseline rather than prod, so its "Safe to push" can be green while prod has drifted. That matters for a function replacement, which fingerprinting cannot see. **This migration is additive columns only** — the class of change the existing gates genuinely do cover. The harness refresh moves to §13, where Migration B lives.

**Known limit, not fixed here [DERIVED — round-2 over-cap]:** `clone_proposal_to_gcs` (`20260626150000:143-164`) is an explicit-column INSERT and will not copy `is_rate_card` / `rate_class` / `rate_amount`. A multi-GC sister proposal gets no rate cards, so its T&M form has nothing to prefill from. **Filed as backlog, conditional on cloning a T&M job** — HDSP has not done so.

---

## §8 Test procedure — how to prove this without touching P7 [LOCKED]

**Do not press Mark Sold on P7, and do not `UPDATE proposals SET status='Sold'` on it either.** §0.12: the button creates an undeletable QuickBooks customer, and the trigger fires on a direct SQL update just as it does on the button — the email cannot be unsent, and the customer's live link flips to "Proposal Accepted."

The earlier plan called this "a data step." It is not. It is three irreversible outward-facing actions taken to unblock a build.

### 8.1 Build and prove on a throwaway job

**Number the fixture BELOW the live sequence [LOCKED — learned the hard way 2026-08-10].**
`NewInquiryWizard.jsx:97-99` mints a new job as `max(job_number) + 1`. The fixture
was first created as **99001** because a high number looks obviously fake — which
is precisely what made it dangerous: it became the maximum, and the next REAL
customer job was minted as 99002 instead of 10232. Caught only because a team
member noticed and told Chris. Fixture is now **999**; keep any future fixture
below the live range, never above it.

1. **Create a new job** in the app with a name containing **"TEST"** — e.g. `TEST — T&M Billing`. This is not a convention invented here: `ProposalDetail.jsx:812` already keys its QuickBooks skip on exactly `job_name.toLowerCase().includes("test")` [run-verified].
2. Point it at a customer **not linked to QuickBooks** (`call_log.qb_customer_id` null), and set `call_log.qb_skip_sync = true` as a second belt.
3. **Create a proposal on it** with one normal priced WTC and three rate-card WTCs mirroring P7's $105 / $125 / $150.
4. **Create the fixture at `Draft`. Flip it to `Sold` only when you need to invoice.**

   *Corrected twice, 2026-08-10. Both corrections are recorded because the second
   one undoes half of the first.*

   **First pass — insert straight at `Sold` to dodge the notification trigger.**
   True as far as it went: every side-effect trigger on `proposals` is
   `AFTER UPDATE`, so a row INSERTED at Sold fires none of them.

   **What that missed: `Sold` is read-only.** `WTCCalculator.jsx` passes
   `onChange={proposalSold ? undefined : …}`, so a Sold proposal cannot be edited
   — and the rate cards have to be authored through that exact editor. The fixture
   was created in a state where the feature being tested could not be used
   without pulling the proposal back. Caught by Chris on first contact with the UI.

   **The procedure that actually works:**

   1. Create the job and proposal at **`Draft`**, WTCs unlocked. Editable.
   2. Author the rate cards through the real UI — which is the point of a fixture.
   3. Lock the WTCs and flip to `Sold` when step 4 needs an invoiceable proposal
      (`Invoices.jsx:71` lists Sold only).

   **Step 3's flip is safe without disabling anything, but for a specific reason
   worth stating:** `notify_proposal_approved` posts to the `proposal-approved`
   edge function, which resolves the rep via `resolveRepForProposal`
   (`_shared/repNotify.ts:50-51`) and returns `job_has_no_sales_rep` **before
   sending anything** when `call_log.sales_name` is blank. The fixture's
   `sales_name` is deliberately **null** [run-verified], so no email can be sent.

   Keep it null. That is the mechanism, not luck — set a rep on this job and the
   flip starts emailing. Belt and braces alongside it: the job name contains
   `TEST` (skips QuickBooks at `ProposalDetail.jsx:812`) and `qb_skip_sync` is on.

   Going the other way — `Sold → Draft` — is always safe: the trigger function
   returns early unless `NEW.status IN ('Sold','Signed')`.

   ~~Insert the proposal directly at `status = 'Sold'`. No trigger disable is needed.~~

   *Corrected 2026-08-10 during execution.* This step previously called for
   `ALTER TABLE ... DISABLE TRIGGER` around an `UPDATE`. That is unnecessary and
   riskier than the alternative. Every side-effect trigger on `proposals` is
   **`AFTER UPDATE`** [run-verified via `pg_get_triggerdef`]:

   | trigger | timing | fires on a fresh INSERT? |
   |---|---|---|
   | `trg_notify_proposal_approved` | `AFTER UPDATE OF status` | **no** |
   | `trg_sync_job_amount` | `AFTER UPDATE OF total` | **no** |
   | `trg_proposals_track_local_edits` | `BEFORE UPDATE OF intro` | **no** |
   | `trg_proposals_updated_at` | `BEFORE UPDATE` | **no** |
   | `trg_proposals_set_signing_token_expires_at` | `BEFORE INSERT OR UPDATE OF signing_token` | yes — sets token expiry, which is wanted |

   A fixture created from scratch never passes through an `UPDATE`, so nothing to
   suppress: no approval email, no QuickBooks job, and no window in which a
   notification trigger is disabled cluster-wide. Disabling a trigger on a shared
   production table — even for seconds — is a worse tool than simply not
   triggering it.

5. Bill the test job. Enter `CCF_000982`'s two day rows. Confirm **$6,765**.

### 8.1a The fixture as built [run-verified 2026-08-10]

Created by `scripts/tm_fixture.sql`, then returned to Draft by `scripts/tm_fixture_unlock.sql`:

| | |
|---|---|
| job | `call_log.id = 3810` · `999 - TEST — T&M Billing` · stage `Has Bid` · **`sales_name` null — keep it that way (§8.1 step 4)** |
| customer | `TEST TEST` (`115932bd-…`) — `qb_customer_id` null, `qb_skip_sync = true` |
| proposal | `1b064211-fa9b-4d82-b18a-35f8554aa16f` · status **`Draft`**, WTCs unlocked · total **$2,720** |

WTCs (unlocked — they are authored through the UI at step 3, then locked before step 4 needs an invoiceable proposal):

| work type | hours | rate | line total | role in the test |
|---|---|---|---|---|
| Specialty | 40 | $58.50 | **$2,340** | the fixed-price line — bills by percent |
| T&M | 1 | $105.00 | **$105** | straight-time rate card |
| T&M | 1 | $125.00 | **$125** | time-and-a-half rate card |
| T&M | 1 | $150.00 | **$150** | double-time rate card |

**Rates are carried as `burden_rate` with `markup_pct = 0`**, not as P7's marked-up
values. P7 hits $105 via `56.50 × 1.8584`, which lands on $105.00 only because P7
was quoted inside the closed exact-penny window (`calc.js:29-33`). A fixture created
today rounds UP, so the same markup would print **$126**, not $125. Rate-as-burden
gives exact figures independent of the pricing era — and `rate_amount` (§2.1)
replaces this scaffolding at step 3 anyway.

**Teardown** — `scripts/tm_fixture_teardown.sql`. Run it when the build is done;
the fixture is disposable and nothing should be built to depend on it.

**P7 confirmed untouched** after the insert: still `Sent`, still `$28,379.64`,
`updated_at` unchanged at `2026-08-06 14:01:36`.

### 8.2 P7 gets marked Sold when it is actually sold

When Chris sells P7 through the normal button, all three side effects are **correct**: the QuickBooks customer should exist, the sales rep should be notified, and the customer's link should say Accepted. The problem was never the button — it was pressing it early, for a build.

**Nothing in this plan requires P7 to change state.** Real billing on 7215 begins after P7 is sold in the ordinary course.

---

## §9 Estimate

| piece | est. code |
|---|---|
| Migration A (13 additive columns) + rollback | ~55 lines SQL |
| `WTCCalculator` rate-card panel (§2.2) | ~70 lines |
| `Invoices.jsx` percent-list filter (§2.5) | ~5 lines |
| `Invoices.jsx` day-row form + NTE (§4.2, §4.3, §4.5) | ~220 lines |
| `validatePcts` + `invoiceTotal` (§4.4) | ~35 lines |
| Preserve branch + embed, void-and-replace, display branches (§4.6–4.8) | ~60 lines |
| `PublicInvoicePage` column allow-list + day breakdown (§5.1) | ~95 lines |
| `qb-sync-invoice` description preference (§5.3) | ~5 lines |
| `CallLogDetail` line embed + T&M row + Billed split (§6) | ~85 lines |
| **Total** | **~630 lines** |

**Time budget: 60 min** (Chris, 2026-08-07).

**Estimate divergence, recorded not resolved:** honest read is **~120 min** — down from v2's 180 because the exclusion, the S1–S8 sweep, Migration B and the harness refresh all left with §13. Still twice the lock. Per the standing rule that a **time budget is not a scope cap**, nothing in §§2-8 was trimmed to fit it. If the build runs long, that is a Delta to name at close.

---

## §10 Build order

1. **Set up the test job** (§8.1 steps 1-4). Nothing downstream can be proved without it, and it must not be P7.
2. Migration A → rehearse → `npm run db:push`. Rollback authored in the same PR.
3. Rate-card panel + percent-list filter *(verifiable: the test proposal's three rate cards save with class and amount, and none of them appear in the invoice percentage list)*
4. Day-row form + `validatePcts` / `invoiceTotal` + preserve branch + embed at `:1541` + void-and-replace + display branches *(verifiable: `CCF_000982` entered as two day rows totalling **$6,765**; editing that invoice leaves it at $6,765; voiding and reissuing keeps the day breakdown and the NTE; the existing percent lines still bill correctly)*
5. Public invoice page — allow-list first, then the day breakdown *(verifiable: the customer link shows date · crew · area · hours · rate, and the page no longer ships burden rate or markup)*
6. QuickBooks description preference *(verifiable: five day rows sync as five distinct lines, and an existing pay-app invoice re-syncs unchanged)*
7. Job-screen T&M row + Billed split

Step 4 is the one that has to be right — it carries the round-2 Critical's descendant (§4.6) and the two blocks that stop an invoice existing at all (§4.4).

---

## §11 Open questions

| # | question | § | blocking? |
|---|---|---|---|
| O1 | A pure-double-time day points at the `regular` card in the work-type column — accept, or point at the highest class used? | §2.4 | no |
| O2 | Prevailing-wage T&M does not fit the three fixed slots. Real need or theoretical? | §3.1 | no |
| O3 | Confirm `invoicePdf.js` stays untouched (no regular-invoice caller) | §5.4 | no |
| O4 | Should T&M revenue count toward billing goals? | §6.1 | no |

---

## §12 Locked decisions summary

| # | decision |
|---|---|
| L1 | **The invoice line is the ticket.** No ticket object, no ticket tables, no ticket routes. |
| L2 | One invoice line per work day: date · crew · area · REG/OT/DT hours · rate · amount. |
| L3 | Office entry only. No mobile app, no in-app signature capture, no crew-punch integration. The paper is signed in the field; the scan attaches to the invoice. |
| L4 | Picking the T&M work type shows a rate-card panel. Existing pricing fields keep saving as they do today. |
| L5 | Rates prefill from the card and stay editable per row. Edits never write back to the proposal. |
| L6 | Weekly invoicing; a week of day rows per invoice. |
| L7 | Not-to-exceed is **per invoice**, not per job. Prints either way, warns but does not block. |
| L8 | Materials ride the existing amount-line mechanism. |
| L9 | A T&M line carries the rate-card WTC. Safe because `billing_pct` is null; it prevents the archive misclassification and keeps the money on the dashboard. |
| L10 | Rate cards are keyed by `is_rate_card`, never by `work_type_id = 31`. |
| L11 | Three fixed rate slots (regular / OT / double). A fourth needs DDL. |
| L12 | **No customer-facing proposal surface changes in this plan.** Proposal totals, the proposal PDF and the signing page are untouched — that is §13. |
| L13 | The job screen gets a **separate T&M row**; Sold/Billed/Remaining keeps fixed-price work only, split at line level from one extended query. |
| L14 | **P7 is never put into Sold state to unblock a build.** Proving happens on a throwaway "TEST" job (§8). |
| L15 | Migration A is additive columns only, applied with `npm run db:push`, rollback in the same PR. |

---

## §13 Split out — the rate-card exclusion

**Stub for its own loop. Not in this plan.**

> **T&M rate cards should not count as contract dollars.** P7 reads $28,379.64; the real contract is $27,999.64 of material plus three hourly rates. Make rate-card WTCs contribute $0 to every proposal total and print as a rate instead of a price — including on the customer's proposal PDF and signing page, which needs replacing the `get_public_proposal_view` database function and refreshing the migration rehearsal baseline first (**split to `O11`** — that gate guards every migration the suite pushes, not just this one).

Round-2 evidence for anyone picking it up: the exclusion and its migration accounted for **8 of 14 findings (57%)**, including every finding that touched a customer-facing surface. Known starting points — `proposals.total` has **three** writers (`ProposalDetail.jsx:341`, `WTCCalculator.jsx:2161`, `:2188`), all unfiltered; `calcProposalTotal` (`calc.js:186`) has exactly one caller, so seven of eight sum-sites hand-roll their own reduce; `CREATE OR REPLACE` resets `SECURITY DEFINER` and `SET search_path` unless restated; and `rehearse.sh` currently reports green against a drifted baseline.

**Backlog entry `F44` filed** so it is owned rather than assumed — nothing forces a return to it otherwise, since the $380 overstatement and the rate-card line on the signing page are both live today and harming nothing.

---

## Audit manifest — CLOSED

_Rescoped 2026-08-07 to the billing half. **Planning is closed. Do not run round 3.**_

**Why closed:** round 2 returned 14 caused-by against round 1's 23 — **−39%, Critical dissolved**, theme settled from `rate-card-exclusion-overreach` to `migration-procedure-concentration`. That is the plateau signal, and the concentration it named has been **removed from the plan** rather than defended: the exclusion mechanism, its migration, and its harness dependency all left with §13. This section is the scope of record, not an invitation to audit again.

### Round history
| round | revision | findings | pattern |
|---|---|---|---|
| 1 | `b29a3b1` | 23 caused-by · 1C/5H/15M/4L | `rate-card-exclusion-overreach` |
| 2 | `60605fc` | 14 caused-by · 0C/7H/7M · 2 regressions | `migration-procedure-concentration` |
| — | this doc | closed — concentration cut to §13 | — |

### Deployment context
- **Live tenants**: 1 — HDSP (`246f6551-60de-4965-bb97-9a52971bc05d`)
- **Prod / staging / dev**: modified surfaces are live in prod — invoice creation and editing, the public invoice page, the job screen, the WTC editor. **No customer-facing proposal surface is touched** (L12).
- **Blocking feature flags**: none. `requires_pay_app = false` keeps job 7215 on the regular-invoice path.
- **Concurrency**: solo.
- **Proving happens on a throwaway "TEST" job, never on P7** (§8, L14).

### Surface
- Sections: 13 · [LOCKED]: 15 · [DESIGN-OPEN]: 4 · Open questions: 4
- Estimated code: ~630 lines · plan-to-code ≈ 0.7:1

### Layers touched
- UI / components — `WTCCalculator`, `Invoices`, `PublicInvoicePage`, `CallLogDetail`
- Data layer — invoice-line loaders; one extended embed on the job screen (§6.1)
- State model — 13 additive columns; stored-not-derived `amount`
- Migrations — **Migration A only**: additive columns, reversible, rollback in the same PR
- External integrations — QuickBooks (one-line description preference, §5.3)

**Dropped with §13:** auth / anon-exposure as a *change* layer (no function replacement), cross-repo migration-procedure risk (additive columns only), and the shared-function behavior changes to `calcProposalTotal` and `sumContractBilled`.

### New mechanisms
- 13 additive columns (`proposal_wtc` ×3, `invoice_lines` ×9, `invoices.nte_amount`)
- No new tables, policies, triggers, indexes, routes, or function replacements
- New UI mode: day-row form inside the existing invoice modal
- New preserve branch in `handleSaveEdit` (§4.6)
- Widened `validatePcts` / `invoiceTotal` (§4.4)
- Column allow-list replacing `proposal_wtc(*)` on the public invoice page (§5.1)

### Irreversibility
- Migration A: additive columns — reversible, paired rollback.
- Everything else is application code.
- **No stored contract value changes. No customer-facing proposal surface changes. No proposal is moved into Sold state to unblock the build.**

### Findings carried in from round 2 — each answered in the plan
| round-2 finding | where answered |
|---|---|
| **E** — create path rejects a percent-free invoice; mixed header disagrees with lines | §4.4 |
| **A1** — line edit recomputes a T&M line to the rate card's price | §4.6 (+ the `:1541` embed, verified at build step 4) |
| **A3** — void-and-replace drops the day fields | §4.7 (+ `description` and `nte_amount`) |
| §6 `sumContractBilled` filter not implementable | §6.1 — line-level embed, one extended query |
| QuickBooks emits identical `"T&M"` lines | §5.3 |
| `npm run db:push`, not bare `supabase db push --linked` | §7 |
| `PublicInvoicePage` ships cost basis via `proposal_wtc(*)` | §5.1 — allow-list first |
| `clone_proposal_to_gcs` drops the new columns | §7 — named limit, backlog, conditional on cloning |

### Findings that left with §13 — not applicable to this scope
**A** (`proposals.total` has three unfiltered writers) · **C** (rehearsal harness reports green against a drifted baseline) · **D** (`CREATE OR REPLACE` resets `SECURITY DEFINER` / `SET search_path`) · **F** (hidden pricing inputs still save, so a rate card still computes to $105) · plus `billing_schedule.contract_sum` staleness, the `rate_class` omission from the RPC payload, and the two-migrations-one-rollback pairing.

**F in particular is not a defect here.** This plan deliberately leaves the pricing fields saving exactly as they do today (§2.2), so a rate card computing to $105 and counting toward $28,379.64 is **current production behavior**, unchanged.

### Findings dissolved by the procedure rewrite
**B** — marking P7 Sold fires an undeletable QuickBooks customer, an unsendable email, and a customer-visible "Proposal Accepted". §8 replaces the step entirely: prove on a throwaway job whose name contains "TEST" (the app's own guard at `ProposalDetail.jsx:812`), set Sold in one transaction with `trg_notify_proposal_approved` disabled, and never move P7. The finding does not apply to the new procedure.
