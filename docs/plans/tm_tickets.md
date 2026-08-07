# T&M Tickets — Build Plan

**Type:** feature
**Status:** BUILD PLAN (drafted from ideate session 2026-08-07, pre-audit)
**Repo/branch:** `sales-command` @ `feat/tm-tickets` (branched off `main` @ `21dc918`)
**Migrations live in:** `command-suite-db` (single source of truth since 2026-06-29) — **not** this repo's `supabase/migrations/`
**Design input:** ideate session 2026-08-07 (this doc is the only written record — no prior design doc)
**Driving artifact:** `CCF_000982.pdf` — HDSP's existing paper "T&M Authorization" form, filled + signed, job 7215 STY 4

Confidence tags: **[LOCKED]** decided by Chris in the ideate session · **[DERIVED]** mechanical from code/schema read · **[DESIGN-OPEN]** needs a decision.

---

## Brief summary (≤300 words)

Sales Command can invoice a proposal only as a **percentage of a fixed WTC price**, hard-capped so cumulative billing never exceeds 100% (`Invoices.jsx:186-193, 214-221`). T&M work has no fixed price — only a rate — so there is nothing to bill a percentage of. Proposal 7215 P7 encodes three hourly rates as WTCs with `regular_hours = 1`, which makes the $105/hr rate look like a $105 line item. That line can produce exactly $105 of invoicing, forever.

HDSP already solves this on paper. The **T&M Authorization form** is filled out in the field, priced, signed by the GC's superintendent, and turned in to the office. It is a complete, signed, finite dollar amount. This plan builds that form as a screen.

Three pieces:

1. **A T&M ticket object** (`tm_tickets` + `tm_ticket_labor` + `tm_ticket_materials`) hanging off the job (`call_log`), entered by the office from the signed paper. Ticket total = labor rows (hours × rate, three rate slots) + material rows.
2. **A rate card flag on the WTC** (`proposal_wtc.is_rate_card` / `rate_class` / `rate_amount`) so P7's three T&M lines stop counting as contract dollars, stop appearing in the percent-billing list, and instead feed rates to tickets.
3. **A T&M path in the invoice modal** — pick unbilled tickets for the week, each becomes one invoice line at its full value. `invoice_lines.tm_ticket_id` is added the same way `billing_schedule_line_id` was added for pay apps.

**The percent cap is never touched.** A ticket is a closed number, so it bills once at 100% of itself.

Point-at proof: a T&M ticket entered on job 7215 for $6,765, appearing on an invoice with its labor breakdown, with the scanned paper attached to the email.

---

## §0 Baseline — verified current state (2026-08-07)

**Verification method:** code **read-verified** on `main @ 21dc918`; live data **run-verified** by SQL against project `pbgvgjjuhnpsumnowuym`. Each claim below is labelled.

### 0.1 The live proposal this is built for — 7215 STY 4 P7 [run-verified]

```sql
select id, proposal_number, customer, status, total, call_log_id from proposals where call_log_id = 3791;
```
→ P7 = `72572e85-98ae-476d-8067-ee5c3494fb69`, customer `Contract Flooring`, status `Sent`, total `28379.64`.
Job: `call_log.id = 3791`, `job_number = 7215`, `display_job_number = "7215 - STY 4"`, stage `Has Bid`.

Its four `proposal_wtc` rows [run-verified]:

| WTC | work_type_id | name | regular_hours | markup_pct | locked_line_total | what it actually is |
|---|---|---|---|---|---|---|
| `3310068b…` | 30 | Specialty | 1.00 | 0.00 | **27,999.64** | real money — material, bought all at once |
| `f220da87…` | 31 | T&M | 1.00 | 85.84 | **105** | the straight-time **rate**, $105/hr |
| `d4228e36…` | 31 | T&M | 1.00 | 121.24 | **125** | the time-and-a-half **rate**, $125/hr |
| `9f412aec…` | 31 | T&M | 1.00 | 165.49 | **150** | the double-time **rate**, $150/hr |

27,999.64 + 105 + 125 + 150 = 28,379.64 = `proposals.total`. **The proposal total is $27,999.64 of contract plus three hours.**

`work_types` 30 = `Specialty`, 31 = `T&M` [run-verified]. Across the whole database, `work_type_id = 31` appears on **3 WTCs on 1 proposal** — it is brand new and no code reads it [run-verified]:
```sql
select count(*), count(distinct proposal_id) from proposal_wtc where work_type_id = 31;  -- 3, 1
grep -rin "T&M\|time_and_material\|hourly" src/   -- zero hits [read-verified]
```

Customer `Contract Flooring` has `requires_pay_app = false` [run-verified] → this is the **regular invoice** route, not the pay-app/SOV route. (Note: two `Contract Flooring` customer rows exist — a duplicate, out of scope here.)

### 0.2 Invoicing is percent-of-WTC, capped at 100% [read-verified]

`src/pages/Invoices.jsx`:
- `:167` — existing lines loaded as `select("proposal_wtc_id, billing_pct")`
- `:186-189` — `getBilledPct(wtcId)` sums `billing_pct` across all non-deleted, non-voided invoices for the proposal
- `:191-193` — `getRemainingPct(wtcId)` returns `100 - getBilledPct(wtcId)`
- `:214-221` — `validatePcts()` rejects `pct > getRemainingPct(w.id)` with *"exceeds remaining % (N% left)"*
- `:196-206` — `getLineAmount(wtc)` = `calcWtcPrice(wtc, …) * (pct / 100)`, cent-rounded
- `:298-310` — writes one `invoice_lines` row per WTC with `billing_pct` + `amount`

**Consequence, verified by reading the cap:** WTC `f220da87…` has `calcWtcPrice = 105`. Cumulative `billing_pct` can never exceed 100. Maximum lifetime billing against the $105/hr rate line is **$105.00**. There is no code path that bills hours.

### 0.3 The one existing escape hatch is archive-only and capped [read-verified]

`Invoices.jsx:224-235` — when `selProposal.is_archive_proposal`, the modal takes a free-form dollar amount instead of percentages, validated against `remaining = proposals.total - archiveBilled`. `:288-296` inserts one `invoice_lines` row with `proposal_wtc_id: null, billing_pct: null`.

So a **null-WTC, null-percent, amount-only invoice line already exists and works** — including through the PDF, the public page, and QuickBooks. It is gated on `is_archive_proposal` and ceilinged by `proposals.total`.

### 0.4 `invoice_lines` already carries a second, non-WTC line identity [read-verified]

Live columns: `invoice_id, proposal_wtc_id, billing_pct, amount, tenant_id, billing_schedule_line_id, description` [run-verified via `information_schema`].

`billing_schedule_line_id` was added for pay apps and is handled everywhere as a **parallel line kind**: `invoicePdf.js:268-281` branches `const isSov = !wtc && sov`, deriving the label from the SOV line and the amount from `scheduled_value` instead of `calcWtcPrice`. **The precedent for adding a third line kind exists and is proven in production.**

### 0.5 The regular-invoice document is a web page, not a PDF [read-verified]

- `generateInvoicePdf` (`src/lib/invoicePdf.js:28`) has exactly **one caller**: `PayAppDetailModal.jsx:333`. Its WTC branch carries an in-code comment at `:276-280` confirming it is *"currently unreached — wired for a future regular-invoice PDF caller."*
- What the customer actually sees for a regular invoice is `src/pages/PublicInvoicePage.jsx` (`/invoice/:token`), which loads lines at `:50-51` (`select("*, proposal_wtc(*, work_types(name))")`) and renders each line at `:219-228` as **work-type name + billing % + amount**.
- `supabase/functions/send-invoice/index.ts` emails an HTML body; there is no invoice PDF attachment path.

**So "make the invoice look more professional" means PublicInvoicePage + the email body — not a PDF.**

### 0.6 Attaching the signed scan already works [read-verified]

`invoice_attachments` is live. Upload/delete/list at `Invoices.jsx:599, 1236, 1265, 1285`; `send-invoice/index.ts:73-137` loads the rows from storage, base64-encodes them with a size cap, and attaches them to the outgoing email. **No new work is needed to ship the scan with the invoice.**

### 0.7 `proposals.total` is written from the sum of all WTCs [read-verified]

`ProposalDetail.jsx:341-342` — on WTC lock:
```js
const proposalTotal = (allWtcs || []).reduce((sum, w) => sum + calcWtcPrice(w, undefined, exact), 0);
await supabase.from("proposals").update({ total: proposalTotal }).eq("id", p.id);
```
`:351-357` — if a billing schedule is seeded, `contract_sum = proposalTotal` and each line's `scheduled_value = calcWtcPrice(w, …)`.

Billed-vs-sold is read from `proposals.total`: `ProposalDetail.jsx:1699` (`remaining = p.total - totalBilled`), with `sumContractBilled` in `calc.js` summing non-voided, non-deleted, non-retention-release invoice amounts.

**This is why the rate WTCs currently inflate the contract value by $380.**

### 0.8 QuickBooks sync labels lines by work type [read-verified]

`supabase/functions/qb-sync-invoice/index.ts:150-152` loads lines with `proposal_wtc(*, work_types(name, cost_code))`; `:243-256` emits one QB `SalesItemLineDetail` per line with `Description = work_types.name || "Services"`, `Qty: 1`, `UnitPrice: line.amount`. A line with no WTC falls through to `Description = "Services"`.

**A ticket line will sync to QuickBooks with the right dollars but a useless description unless the description is wired.**

### 0.9 Where the ticket screen will live [read-verified]

- `CallLogDetail.jsx` is the job-detail screen; it has a reusable collapsible `Section` (`:42`) and already renders **Proposals** (`:928`) and **Invoices** (`:983`) blocks. A **T&M Tickets** block belongs alongside them.
- Routes: `App.jsx:240-245` — `/calllog/:id`, `/proposals/:id`, `/invoices/:id`.
- Repo convention (V52): page files are list views; detail/modals/wizards live in `src/components/`.

### 0.10 The paper form being replaced [run-verified against `CCF_000982.pdf`]

Header: **High Desert Surface Prep — T&M Authorization**. Date `8/4/26` · Location `STY 4 FSA` · Bill To *(blank)* · Description of Work `CAULKING PERIMETER WALLS`.

**LABOR** — columns: Date · Employee Count · Area Work Performed · Hours REG/OT · Rate · Amount

| Date | Emp | Area | REG | OT | Rate | Amount |
|---|---|---|---|---|---|---|
| 8/4/26 | 5 | FSA Priority Areas | 27 | 13 | $105/$125 | $4,460.00 |
| 8/5/26 | 2 | FSA Priority Areas | 16 | 5 | $105/$125 | $2,305.00 |
| | | | | | **TOTAL** | **$6,765.00** |

Arithmetic verified: (27×105)+(13×125) = 4,460 ✓ · (16×105)+(5×125) = 2,305 ✓ · total 6,765 ✓.

**MATERIAL/EQUIPMENT** — columns: Date · Description · Quantity · Unit Price · Amount. One row on this ticket (`8/4/26 · TREMCO DYMONIC 100`) with **no price** — material on this job is billed separately under P7's Specialty WTC.

Footer: `Prepared by: PAUL BASIL` (signed, 8/5/26) · `Accepted by:` **Chris Renteria** (signed) · `Date: 08/06/26`.

**Structural facts that shape the build:**
- Hours are **crew totals per day** ("5 guys, 27 REG, 13 OT"), not per-employee. No individual timesheet is needed for the ticket to be valid to the GC.
- The form **carries dollars** and the GC signed the dollar amount — unlike the industry-standard "quantities-only tag, priced later at the office" model (Procore, Clearstory).
- One ticket spans **multiple work days** (header date 8/4, rows for 8/4 and 8/5).

---

## §1 Problem statement [LOCKED]

Open-ended T&M work cannot be billed. The only billing mechanism is a percentage of a fixed price (§0.2), and T&M has no fixed price. Encoding an hourly rate as a one-hour WTC (§0.1) makes the rate *display* correctly on the proposal but caps lifetime billing at one hour's worth.

Meanwhile HDSP already produces the correct artifact on paper: a signed, priced, finite T&M ticket (§0.10). It is retyped nowhere and billed by hand.

The gap is a **ticket object** between the proposal (which sets rates) and the invoice (which bills finite amounts).

---

## §2 Data model [LOCKED unless noted]

All three tables are **new and additive**. Migrations author in `command-suite-db`, rehearsed via `./scripts/rehearse.sh` before any push to the shared DB.

### 2.1 `tm_tickets`

| column | type | notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `tenant_id` | uuid not null default, FK tenants | standard RLS pattern |
| `call_log_id` | int not null, FK call_log | **the job owns the ticket** (job detail is home) |
| `proposal_id` | text null, FK proposals | the rate-card proposal (P7). Nullable so a ticket can exist before/without one |
| `ticket_number` | text not null | auto-assigned, unique per tenant (§2.4) |
| `ticket_date` | date not null | the header date on the paper |
| `location` | text | "STY 4 FSA" |
| `bill_to` | text | blank on the paper today — §6.4 |
| `description` | text | "CAULKING PERIMETER WALLS" |
| `material_billed_separately` | boolean not null default false | prints the callout line (§3.4) |
| `prepared_by` | text | "PAUL BASIL" |
| `prepared_date` | date | |
| `accepted_by` | text | "Chris Renteria" — the GC's signer |
| `accepted_date` | date | |
| `notes` | text | |
| `created_at` / `updated_at` | timestamptz | `updated_at` trigger per repo pattern |

**No `status` column [LOCKED].** Every ticket entered is already signed on paper, so there is no draft/signed lifecycle. "Billed" is **derived**: a ticket is billed iff a live `invoice_lines` row references it (§5.3). Adding a status enum would create two sources of truth for the same fact.

### 2.2 `tm_ticket_labor` — one row per work day

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid not null | |
| `ticket_id` | uuid not null, FK tm_tickets **on delete cascade** | |
| `work_date` | date not null | |
| `employee_count` | int | crew size that day |
| `area` | text | "FSA Priority Areas" |
| `reg_hours` / `reg_rate` | numeric | |
| `ot_hours` / `ot_rate` | numeric | |
| `dt_hours` / `dt_rate` | numeric | double time |
| `amount` | numeric not null | stored: `reg_hours*reg_rate + ot_hours*ot_rate + dt_hours*dt_rate`, cent-rounded |
| `ordinal` | int | row order |

**Three fixed rate slots, not a generic rate-class table [LOCKED].** The printed form has a REG/OT column pair, P7 carries exactly three rates, and straight / time-and-a-half / double-time is the universal split in the trades. A generic rate-class table would be a fourth table and a join for zero present benefit. **Named limit:** a job needing a fourth rate class (e.g. a separate foreman rate) does not fit without a schema change.

`amount` is **stored, not derived** — it is a billed dollar figure that must not move if a rate is later edited on the proposal. Same reasoning as `proposal_wtc.locked_line_total`.

### 2.3 `tm_ticket_materials` — one row per material/equipment line

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid not null | |
| `ticket_id` | uuid not null, FK tm_tickets **on delete cascade** | |
| `work_date` | date | |
| `description` | text not null | |
| `qty` | numeric | |
| `unit_price` | numeric | |
| `amount` | numeric not null default 0 | stored; `0` for a listed-but-not-billed row (§0.10) |
| `ordinal` | int | |

### 2.4 Ticket numbering [LOCKED — auto, DESIGN-OPEN on format]

Chris's first instinct was to identify a ticket by date; §0.10 shows one ticket spans two dates and two tickets could share a header date, so **date is not an identifier**. Tickets get an auto-assigned `ticket_number`.

**[DESIGN-OPEN O1]** format. Candidates: global sequence (`TM-00001`), or per-job sequence (`7215-TM-01`). Per-job reads better on a GC's desk; global is simpler to allocate. Allocation must not use the read-max-and-increment pattern at `Invoices.jsx:270-278` (racy) — prefer a sequence or a unique constraint with retry.

### 2.5 RLS

All three tables follow the repo's standard 4-policy `tenant_id` pattern (default + FK + select/insert/update/delete scoped to the caller's tenant). No service-role write path. No edge function writes these tables.

### 2.6 `invoice_lines` gets a third line kind

Add `tm_ticket_id uuid null, FK tm_tickets`. Exactly parallel to `billing_schedule_line_id` (§0.4). A ticket line has `proposal_wtc_id = null`, `billing_pct = null`, `tm_ticket_id = <id>`, `amount = ticket total`.

**FK delete behavior [LOCKED]: `on delete restrict`.** A billed ticket must not be deletable out from under an invoice.

### 2.7 `proposal_wtc` gets rate-card columns

| column | type | notes |
|---|---|---|
| `is_rate_card` | boolean not null default false | this WTC is a price list, not a contract amount |
| `rate_class` | text null, check in ('regular','ot','dt') | which slot it feeds |
| `rate_amount` | numeric null | the dollars-per-hour, typed explicitly |

**`rate_amount` is explicit, not inferred [LOCKED].** Today the rate is readable only as `calcWtcPrice` of a WTC whose `regular_hours` happens to be 1 (§0.1). That is an accident of data entry, not a contract. Reading rates that way would break the moment someone edits hours.

**Keying off `is_rate_card`, not `work_type_id = 31` [LOCKED].** A work-type row is user-editable data; a rename or delete would silently un-mark every rate card. The flag is the contract.

---

## §3 Ticket entry screen [DERIVED from §0.9-0.10]

New component `src/components/TMTicketModal.jsx` (repo convention: modals live in `components/`). Opened from a new **T&M Tickets** `Section` on `CallLogDetail.jsx`, rendered alongside the existing Proposals (`:928`) and Invoices (`:983`) blocks.

### 3.1 The form is the paper form

Same field order, same section headings, same column headers as §0.10. The office user is transcribing a document in front of them; anything that reorders or renames fields makes transcription slower and more error-prone.

Header block → LABOR table → MATERIAL/EQUIPMENT table → footer (Prepared by / Accepted by + dates) → running TOTAL.

### 3.2 Rates prefill from the rate card, editable [LOCKED]

On open, load the job's proposals and their `is_rate_card` WTCs. Prefill `reg_rate` / `ot_rate` / `dt_rate` on each new labor row from `rate_amount` by `rate_class`. Every rate remains editable on the row (Chris: *"automatically pulled with the ability to edit"*).

If a rate is edited away from the card value, mark the row visually so the office can see it diverged. **Do not** write the edit back to the proposal.

**[DESIGN-OPEN O2]** if the job has more than one proposal carrying rate cards, which one prefills? Proposal picker on the ticket header is the likely answer.

### 3.3 Live total

Ticket total = Σ labor `amount` + Σ material `amount`, shown as the form is typed, so it can be checked against the handwritten total on the paper before saving. A mismatch against the paper is the single most likely transcription error.

### 3.4 Material-billed-separately callout [LOCKED]

`material_billed_separately` checkbox. When on, the ticket (screen, invoice, and PDF) prints a line: *"Material for this scope billed separately under Proposal P7."* Chris's call — stops the GC asking and stops double-billing.

### 3.5 Attaching the scan

The signed paper attaches to the **invoice**, not the ticket — `invoice_attachments` already exists and already rides the outgoing email (§0.6). No ticket-level attachment table this build.

**[DESIGN-OPEN O3]** this means the scan is attached at invoice time, one step removed from the ticket it proves. Worth checking whether the office would rather attach at ticket entry (which would need a `tm_ticket_attachments` table + a copy-to-invoice step). Not in scope unless Chris says otherwise.

---

## §4 Rate card on the WTC

### 4.1 Authoring

A **"This is a rate card"** checkbox in `WTCCalculator.jsx`. When on: hide the hours/materials/travel pricing inputs, show `rate_class` (Regular / Time-and-a-half / Double time) + `rate_amount`.

### 4.2 Rate-card WTCs are excluded from `proposals.total` [LOCKED]

`ProposalDetail.jsx:341` changes to skip `is_rate_card` WTCs. **P7's total goes from $28,379.64 → $27,999.64.**

Every other `calcWtcPrice`-over-all-WTCs site must be swept for the same exclusion — including the billing-schedule seed at `ProposalDetail.jsx:351-357`, which would otherwise put three phantom $105/$125/$150 lines on an SOV.

### 4.3 Rate-card WTCs are excluded from percent billing [LOCKED]

`Invoices.jsx` step 2 filters them out of the WTC list. **This is what makes the percent cap a non-issue rather than a thing to fight.**

### 4.4 Proposal display and PDF

Rate cards render as a rate card, not a price: rate per hour, with the schedule text from `sales_sow`, and no line total feeding the sum. The proposal footer reads material total **plus** "labor at rates shown, billed as incurred."

**[DESIGN-OPEN O4]** exact wording and layout on the customer-facing proposal PDF (`ProposalPDFModal.jsx`) and the public signing page.

### 4.5 Contract value with tickets [LOCKED — direction; DERIVED — mechanics]

Once §4.2 lands, P7's value is material only, and tickets bill **on top** of it. Anything reading `proposals.total` as the ceiling would read the job as overbilled.

Rule: **a job's value = `proposals.total` + the sum of its ticket totals.** The job's value grows as signed work accumulates — which is what T&M is.

Sites to fix: `ProposalDetail.jsx:1699` (`remaining`), and any billed-vs-sold display on `CallLogDetail`. Implement as one shared helper in `calc.js` next to `sumContractBilled` — **not** a second, drifting copy of the arithmetic.

### 4.6 Backfilling P7

P7's three existing T&M WTCs need `is_rate_card = true`, `rate_class`, `rate_amount` set. Three rows, one job, one tenant.

**[DESIGN-OPEN O5]** do it by hand in the new UI (safer, verifiable, three clicks) or as a one-time data migration? Hand-entry is recommended: it exercises the new UI and touches nothing else.

---

## §5 Invoicing from tickets

### 5.1 A third path in the New Invoice modal

`Invoices.jsx` step 2 currently branches archive (free-form amount) vs regular (percent per WTC). Add a **T&M section** that appears when the selected proposal has rate-card WTCs: a checkbox list of that job's **unbilled** tickets — number, date, description, total.

Both sections can appear together: an invoice may carry the material WTC at some percent **and** a set of tickets. That is the normal case for job 7215.

### 5.2 Line creation

One `invoice_lines` row per selected ticket:
`{ invoice_id, proposal_wtc_id: null, billing_pct: null, tm_ticket_id, amount: <ticket total>, description: "T&M Ticket <number> — <description>" }`

Invoice total = Σ percent lines + Σ ticket lines. No cap applies to a ticket line — its amount is the ticket's own signed total.

### 5.3 Unbilled = no live invoice line [LOCKED]

A ticket is billed iff an `invoice_lines` row references it on an invoice with `deleted_at is null and voided_at is null`. Voiding an invoice returns its tickets to the pickable list — matching how `getBilledPct` already treats voided invoices (§0.2).

**Weak point:** this is a read-then-insert with no unique constraint. Two invoices created concurrently could each bill the same ticket. Concurrency here is one office user (§ deployment context), but a **unique partial index on `invoice_lines.tm_ticket_id` where the invoice is live** is the durable fix and should be specified, not assumed away.

### 5.4 No unbilled-tickets list this build [LOCKED]

Chris considered and declined a standing "unbilled tickets" report. Weekly billing plus the picker in §5.1 is the whole control. Revisit only if a ticket is ever found unbilled.

---

## §6 What the customer sees

### 6.1 Public invoice page — the actual invoice document (§0.5)

`PublicInvoicePage.jsx:219-228` renders each line as work-type name + billing % + amount. A ticket line has neither a work type nor a percent, so it needs its own branch — same shape as the `isSov` branch already in `invoicePdf.js:270`.

A ticket line should render as a **block, not a one-liner**: ticket number and date, description of work, then the labor rows (date · crew · area · REG/OT/DT hours · rate · amount), then materials, then the ticket total. That breakdown is what makes the invoice look like something a GC's accounting department can approve without a phone call — Chris's stated goal.

Loader change at `:50-51` to embed `tm_tickets(*, tm_ticket_labor(*), tm_ticket_materials(*))`.

### 6.2 Invoice PDF

`invoicePdf.js` gets the same third branch (§0.4 precedent at `:268-281`). **Note it has no regular-invoice caller today (§0.5)** — so this is either (a) forward-wiring for parity, or (b) out of scope. Recommend **(b): out of scope**, and say so plainly, rather than building an unreachable branch. Flagged for the audit.

### 6.3 The signed scan

Already works (§0.6). Office attaches the scanned ticket to the invoice; `send-invoice` emails it. **Zero code.**

### 6.4 "Bill To" is blank on the paper

§0.10 — the form's Bill To line is empty. The field exists in `tm_tickets`; the office should fill it. Process note, not code.

### 6.5 QuickBooks

`qb-sync-invoice/index.ts:243-256` labels each QB line from `work_types.name` and falls back to `"Services"` (§0.8). A ticket line has no WTC → it would sync as `"Services"`.

Fix: prefer `line.description` when present. That is a two-line change and also improves the existing archive/null-WTC lines.

**Dollars are already correct** — `Amount`/`UnitPrice` come straight from `line.amount`. This is a labelling fix, not a money fix.

---

## §7 Estimate

| piece | est. code |
|---|---|
| Migration (3 tables + RLS + 4 columns + index) — authored in `command-suite-db` | ~180 lines SQL |
| `TMTicketModal.jsx` (entry form) | ~350 lines |
| `CallLogDetail` T&M Tickets section | ~70 lines |
| `WTCCalculator` rate-card fields | ~80 lines |
| `proposals.total` + contract-value helper sweep | ~60 lines |
| `Invoices.jsx` T&M picker + line creation | ~120 lines |
| `PublicInvoicePage` ticket block | ~90 lines |
| `qb-sync-invoice` description fix | ~5 lines |
| **Total** | **~955 lines** |

**Time budget: 60 min** — set by Chris, 2026-08-07. Finding cap = 6.

**Estimate divergence, recorded not resolved:** the drafter's read of this surface was 240 min (~955 lines across a migration, two existing screens, the invoice path, and the public invoice page). Chris locked 60. Per the standing rule that a **time budget is not a scope cap**, the named surface in §§2-6 is unchanged — nothing was trimmed to fit the number. If the build runs long, that is a Delta to name at close, not a reason to silently drop §6.1 or §4.5.

---

## §8 Build order

1. Migration in `command-suite-db` → **rehearse** → push → repair ledger if needed
2. Rate-card fields on the WTC + `proposals.total` exclusion + contract-value helper *(verifiable on its own: P7 reads $27,999.64)*
3. Backfill P7's three rate cards by hand (§4.6)
4. Ticket entry modal + job-detail section *(verifiable: ticket CCF_000982 entered, total reads $6,765)*
5. Invoice T&M picker + line creation *(verifiable: invoice carries the $6,765 line)*
6. Public invoice page ticket block
7. QB description fix

Steps 2 and 4 each produce something Chris can look at before the next step starts.

---

## §9 Open questions

| # | question | §  | blocking? |
|---|---|---|---|
| O1 | Ticket number format — global `TM-00001` or per-job `7215-TM-01`? Allocation must not copy the racy max+1 pattern at `Invoices.jsx:270` | §2.4 | no — pick at build |
| O2 | Which proposal's rate card prefills when a job has more than one? | §3.2 | no |
| O3 | Attach the scan at ticket entry instead of invoice time? (needs a new table if yes) | §3.5 | no |
| O4 | Rate-card wording/layout on the customer-facing proposal PDF and signing page | §4.4 | no |
| O5 | Backfill P7 by hand or by migration? | §4.6 | no — hand recommended |
| O6 | Build the unreachable `invoicePdf` branch, or leave it out? | §6.2 | **recommend out** |
| O7 | ~~Time budget confirmation~~ — **resolved: 60 min (Chris, 2026-08-07)**. Drafter's estimate was 240; scope deliberately not cut to match (§7) | §7 | closed |

---

## §10 Locked decisions summary

| # | decision |
|---|---|
| L1 | The ticket is a new object under the job, billed once at its full value. **The percent-cap model is not modified.** |
| L2 | Office entry only. No mobile app, no in-app signature capture, no Field Command punch integration. The paper is signed in the field. |
| L3 | The ticket **carries prices** (matching HDSP's existing form), not the industry quantities-only tag. |
| L4 | Auto-assigned ticket number. Date is not an identifier (§0.10 proves a ticket spans days). |
| L5 | Rates prefill from the proposal's rate card and stay editable per row. Edits never write back to the proposal. |
| L6 | Weekly invoicing; multiple tickets per invoice. |
| L7 | Materials are supported on tickets; where material is billed separately, the ticket prints a callout. |
| L8 | No unbilled-tickets report this build. |
| L9 | P7 stays **one** proposal. A rate card is not its own proposal and gets no proposal number. |
| L10 | `proposals.total` excludes rate cards; a job's value = proposal total + signed tickets to date. |
| L11 | Three fixed rate slots (regular / OT / double-time), matching the printed form. |
| L12 | No `status` column on tickets — "billed" is derived from live invoice lines. |
| L13 | Rate cards are keyed by `is_rate_card`, not by `work_type_id = 31`. |
| L14 | Migrations author in `command-suite-db` and are rehearsed before any push to the shared DB. |

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-07. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This plan adds a new kind of invoice line, and the invoice line is touched by eleven different files across the app — including three screens the plan never mentions. That's the thing most likely to break something that works today, so most of the review points there and at the money math. Four reviewers, and only the six most serious problems come back.

### Round
- Plan type: **feature**
- Current round: **1**
- Plan revision under audit: `fe95d49` + the uncommitted §7/O7 budget edit (committed with this manifest)
- Findings trend: n/a — round 1

### Prior rounds
`none — this is round 1`

**Briefing for agents**: do NOT re-find issues from prior rounds. Each round's revision-pass commit message is the canonical record of what was addressed. Attack ONLY material new to the plan revision under audit.

**Plateau signal**: plateau forms when round-N count is steady or higher than round-(N-1), not just at round 3+. The plateau is usually scope creep — each revision answers prior findings by ADDING mechanism, which adds surface, which produces new findings. `/runaudit` MUST present scope-cut as the only build-prompt option when plateau is detected. Hedged "do D or do A and also 13 items" prompts make the loop worse, not better.

### Deployment context
- **Live tenants**: **1** — HDSP (`246f6551-60de-4965-bb97-9a52971bc05d`, run-verified on P7's WTC rows). Multi-tenant onboarding blocked.
- **Prod / staging / dev**: the **modified** surfaces are all live in prod for a paying customer — invoice creation (`Invoices.jsx`), proposal totals (`ProposalDetail.jsx`), the public invoice page, and QuickBooks sync. The **new** tables are net-new with zero rows and zero blast radius.
- **Blocking feature flags**: none gate this work. `customers.requires_pay_app = false` for Contract Flooring routes job 7215 down the regular-invoice path, not the pay-app/SOV path.
- **Concurrency profile**: **solo** — one office user enters tickets and creates invoices.

Agents weight severity against these values. Cross-tenant findings cap at Med while `live_tenants == 1`. Multi-user race findings cap at Low while solo. Theoretical attacks against state that doesn't exist yet are not High.

### Time budget + finding cap
- **Time budget**: **60 min** (locked by Chris 2026-08-07; drafter's estimate was 240 — see §7, scope deliberately not cut)
- **Finding cap**: **6** findings

Synthesis MUST surface only the top-6 most consequential findings. Remainder go to "Quarantined findings (not actionable this loop)." Cap forces prioritization; without it, the audit defaults to dumping.

**Do not report unbuilt scope as a finding.** §7 records an open estimate divergence (60 locked vs 240 estimated) with scope intentionally preserved. That is a known, accepted Delta, not a defect.

### Surface
- Total lines: 446
- Sections: 11 (§0–§10)
- [LOCKED] decisions: 14 (§10 summary; 13 inline tags)
- [DESIGN-OPEN] items: 5 (§2.4, §3.2, §3.5, §4.4, §4.6)
- [OPEN] items: 6 live of 7 in §9 (O7 closed)
- Plan-to-code ratio: **446 : 955** ≈ 0.47:1 — well under the 50:1 flag. The plan is smaller than the build; no scope-creep signal.

### Layers touched
- UI / components — `TMTicketModal` (new), `CallLogDetail`, `WTCCalculator`, `Invoices` modal, `PublicInvoicePage`
- Data layer — invoice-line loaders and embeds in `Invoices.jsx`, `PublicInvoicePage.jsx`
- State model — 3 new tables, 4 new columns, stored-not-derived amounts, derived "billed" status
- RLS / auth / multi-tenancy — 12 new policies across 3 new tables
- Migrations / schema — authored in `command-suite-db`, shared forward-only ledger
- Edge functions — `qb-sync-invoice` description fix
- Cross-repo — shared Supabase project with Schedule Command and Field Command
- External integrations — QuickBooks

### New mechanisms introduced
- New tables: `tm_tickets`, `tm_ticket_labor`, `tm_ticket_materials`
- New columns: `invoice_lines.tm_ticket_id` (uuid, FK, on delete restrict); `proposal_wtc.is_rate_card` (bool), `.rate_class` (text, checked), `.rate_amount` (numeric)
- New RLS policies: 12 (4 × 3 tables) — **referenced by pattern, not written in the plan**
- New trigger: `updated_at` on `tm_tickets`
- New index: unique partial index on `invoice_lines.tm_ticket_id` scoped to live invoices (§5.3) — **named as the fix, never specified**
- New helper: contract-value helper in `calc.js` (§4.5) — **invented, signature and call sites undefined**
- New allocator: `ticket_number` assignment (§2.4) — **invented, mechanism and format undecided**
- New component: `src/components/TMTicketModal.jsx`
- New branch: third invoice-line kind in `PublicInvoicePage.jsx:219-228`
- New routes: **none** — reuses `/calllog/:id`

### Cross-system reach
- `command-suite-db` — sole authoring home for the migration; forward-only ledger shared with `sales-command`, `sch-command`, `field-command`
- Shared Supabase project `pbgvgjjuhnpsumnowuym` — Field Command and Schedule Command read/write the same database
- QuickBooks Online via `qb-sync-invoice` (service-role reader of `invoice_lines`)
- Resend email via `send-invoice` (unchanged; carries the signed-ticket scan through `invoice_attachments`)
- Service-role / bypass-RLS write paths to the new tables: **plan claims none — verify, don't accept**

### Irreversibility
- **Migration**: additive only (3 tables, 4 columns, 1 index, 1 trigger). Ledger-coordinated across three repos — a stray sibling ledger row blocks `db push`. Rehearsal via `command-suite-db/scripts/rehearse.sh` is mandatory (L14).
- **Backfill**: P7's three T&M WTCs get `is_rate_card`/`rate_class`/`rate_amount` (§4.6). Three rows, by hand, recommended over a migration.
- **Stored contract value mutation**: §4.2 rewrites `proposals.total` for P7 from $28,379.64 → $27,999.64. **P7 status is `Sent`** — this changes a stored figure on a proposal already in a customer's hands. Reversible in principle; the sent PDF is not.
- Public API changes: none.

### Known weak points
- **§2.6 / §5.2 — the invoice-line consumer sweep is incomplete.** `invoice_lines` is read in **11 distinct files**: `Invoices.jsx` (166, 288, 305, 1541, 1814, 1848-1854, 2144), `PublicInvoicePage.jsx:50`, `invoicePdf.js:22`, `qb-sync-invoice/index.ts:150,211`, `NewPayAppModal.jsx:209`, `PayAppDetailModal.jsx:335`, `CallLogDetail.jsx:306`, `Customers.jsx:517,707`, `SalesDash.jsx:417,496`, `dbErrors.js:15-34`. **The plan names only four of them.** `Customers.jsx`, `SalesDash.jsx`, and `CallLogDetail.jsx` are never mentioned — any of them that assumes a line has a `proposal_wtc` or a `billing_pct` will break or mis-total on a ticket line. Highest-risk item in the plan.
- **§4.2 — the `proposals.total` exclusion sweep is asserted, not enumerated.** "Every other `calcWtcPrice`-over-all-WTCs site must be swept" names no site list. A missed site silently mis-prices a live proposal. This is precisely the design-baseline failure mode that has passed clean audits before.
- **§4.5 — the contract-value helper is named but undefined.** Call sites given as "any billed-vs-sold display on `CallLogDetail`" — unenumerated. An undefined helper with unenumerated call sites is two unknowns stacked.
- **§4.2 — repricing a `Sent` proposal is unaddressed.** The repo has explicit prior art against this: `calc.js:30-33` sets `EXACT_PRICING_END` to a date chosen *specifically* to avoid repricing a proposal already sent to a customer. The plan changes P7's stored total without engaging that precedent.
- **§5.3 — double-billing race is named but not fixed.** Read-then-insert with no constraint. The plan proposes a unique partial index and then never specifies it. Concurrency is solo (cap severity accordingly), but the unspecified fix is a real gap.
- **§2.4 — ticket numbering has no mechanism.** The plan correctly warns off the racy max+1 pattern at `Invoices.jsx:270-278` and then proposes nothing concrete in its place.
- **§2.2 — `tm_ticket_labor.amount` is stored with no check constraint** tying it to `hours × rate`. A UI arithmetic bug writes a wrong billed dollar figure with nothing to catch it. The paper form's own total is the only cross-check, and it lives outside the system.
- **§2.2 — three fixed rate slots is a hard limit.** A fourth rate class (separate foreman rate, prevailing-wage split) requires DDL. Named in the plan; verify it is genuinely acceptable rather than convenient.
- **§2.5 — 12 RLS policies are referenced by pattern, not written.** "Standard 4-policy `tenant_id` pattern" is an instruction, not a spec.
- **§6.2 — the plan recommends NOT building the `invoicePdf` branch.** If the audit pushes back, that is scope growth against a 60-minute budget. Agents should take a position rather than leave it hanging.
- **§3.5 / O3 — the signed scan attaches to the invoice, one step removed from the ticket it proves.** If a ticket is ever billed on an invoice whose attachment is missing, nothing links the two.

### Open questions
- Count: **6** live (§9: O1–O6; O7 closed)
- Highest-pressure: **O1** (ticket numbering mechanism — the plan rejects the existing pattern without replacing it) and **O6** (build the unreachable PDF branch or not — the only open question that changes scope against a fixed 60-min budget)

### Suggested attack angles (4 total)

1. **Invoice-line consumer sweep** — covers data layer, UI, edge functions, external integrations. Required reading: all 11 files listed under Known weak points, especially `Customers.jsx:517,707`, `SalesDash.jsx:417,496`, `CallLogDetail.jsx:306` (unmentioned by the plan), plus `Invoices.jsx:1795-1854` and `qb-sync-invoice/index.ts:243-256`. Specific pressure: for **each** consumer, does it survive a line with `proposal_wtc_id = null`, `billing_pct = null`, `tm_ticket_id` set? Does it total correctly, render without crashing, and label sanely? Precedent to compare against: how each consumer already handles the archive null-WTC line (`Invoices.jsx:288-296`) and the SOV line (`billing_schedule_line_id`).

2. **Money-model correctness** — covers state model, business logic, data layer. Required reading: `src/lib/calc.js`, `src/components/ProposalDetail.jsx:320-360, 1690-1800`, `src/pages/Invoices.jsx:150-320`. Specific pressure: enumerate every `calcWtcPrice`-over-all-WTCs site §4.2 must touch and prove the list is complete; attack the undefined contract-value helper (§4.5) and its unenumerated call sites; challenge repricing a `Sent` proposal against the `EXACT_PRICING_END` precedent at `calc.js:30-33`; attack stored-vs-derived `amount` (§2.2) and derived-billed (§5.3).

3. **Schema / migration / cross-repo** — covers migrations, cross-repo reach. Required reading: `command-suite-db` ledger + `scripts/rehearse.sh`, `sales-command/docs/plans/shared_migrations_consolidation.md`, `scripts/check-migration-safety.sh`. Specific pressure: FK delete behavior (`on delete restrict` on `invoice_lines.tm_ticket_id` vs `cascade` on the ticket children — is that pair coherent?); the unspecified unique partial index (§5.3); shared-ledger coordination with `sch-command`/`field-command`; whether anything in Schedule or Field reads `proposal_wtc` and would see the three new columns.

4. **RLS / multi-tenancy** — covers RLS/auth. Required reading: an existing 4-policy migration in `command-suite-db` as the pattern of record, plus `qb-sync-invoice/index.ts` (a service-role reader of `invoice_lines`). Specific pressure: the 12 unwritten policies; `tenant_id` default + FK on all three new tables; whether the `invoice_lines → tm_tickets → tm_ticket_labor` embed on the **public** invoice page (`PublicInvoicePage.jsx`, unauthenticated, token-scoped) can expose ticket rows across tenants or beyond the invoice's own tickets; verify the plan's claim of "no service-role write path."

_(A fifth angle — UI / framework-fit — was scored and **dropped by Chris, 2026-08-07**, as the lowest value per token against a 6-finding cap. Not audited this round: V52 convention conformance, and the fact that the plan adds **no router URL** for a ticket and reuses `/calllog/:id` against the standing "every section and detail has a real URL" discipline. Recorded here so the gap is known, not forgotten.)_

### Suggested agent count: 4

Rationale: the formula yields 11 angles (8 layers + cross-system + ≥3 novel mechanisms + ≥5 open questions), so this was a 5 by ceiling rather than by fit; Chris cut the UI angle to bring agent spend closer to the 6-finding cap. The four remaining angles are all money- or data-integrity-bearing — none can be dropped further without leaving a live prod surface unexamined.
