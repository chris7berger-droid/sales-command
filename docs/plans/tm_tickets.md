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

**A ticket gets a real URL [DERIVED — corrects an omission].** The standing repo discipline is that every section and detail has its own router URL and is reached with `navigate()`, not local state. An earlier draft of this plan reused `/calllog/:id` with no ticket address, which breaks that rule: a half-typed ticket couldn't be linked, bookmarked, or reopened by back-button.

Add to `App.jsx` beside the existing `/calllog/:id` (`:241`):

```
/calllog/:id/ticket/new          → open a blank ticket on that job
/calllog/:id/ticket/:ticketId    → open that ticket
```

`CallLog` reads the params and opens `TMTicketModal`; closing navigates back to `/calllog/:id`. Same shape as the existing `/proposals/:id` and `/invoices/:id` routes.

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

**Every `calcWtcPrice` site, enumerated [read-verified 2026-08-07 via `grep -rn "calcWtcPrice" src`].** An earlier draft said only "must be swept"; that is the exact failure mode that has passed clean audits before, so here is the list.

**Sums across all WTCs of a proposal — MUST exclude rate cards:**

| # | site | what it computes | verdict |
|---|---|---|---|
| S1 | `ProposalDetail.jsx:341` | `proposals.total` on WTC lock | **exclude** |
| S2 | `ProposalDetail.jsx:357` | `billing_schedule_lines.scheduled_value` on SOV seed | **exclude** — else 3 phantom SOV lines |
| S3 | `Invoices.jsx:109` | `billing_schedule.contract_sum` on the auto-seed for `requires_pay_app` customers | **exclude** |
| S4 | `Invoices.jsx:117` | `billing_schedule_lines.scheduled_value`, same auto-seed | **exclude** |
| S5 | `ProposalPDFModal.jsx:189` | **the customer-facing proposal PDF total** | **exclude** — see below |
| S6 | `MultiGCWizard.jsx:530` | per-tier total in the multi-GC preview | **exclude** |
| S7 | `MultiGCWizard.jsx:635` | per-tier total written on multi-GC clone | **exclude** |

**S5 is the one that bites.** `ProposalPDFModal.jsx:189` computes the printed proposal total independently. Miss it and the PDF prints $28,379.64 while the app says $27,999.64 — a customer-facing number diverging from the billed number. That is the **exact defect** the exact-penny work was written to kill: see `calc.js:12-18`, *"the customer-facing proposal PDF printed its own raw, un-rounded sum… Customers paid what the proposal said and came up cents short."* Repeating it would be repeating a known, documented mistake.

**S3/S4 note:** Contract Flooring is `requires_pay_app = false` (§0.1), so job 7215 never reaches this path. The path is live for other customers.

**Per-WTC display sites — must render a rate card as a rate, not a price:**

| # | site | verdict |
|---|---|---|
| D1 | `ProposalDetail.jsx:933` | rate-card render |
| D2 | `ProposalPDFModal.jsx:358` | rate-card render (customer-facing) |
| D3 | `Invoices.jsx:456` | filtered out entirely by §4.3 |
| D4 | `MultiGCWizard.jsx:588-589` | rate-card render |
| D5 | `invoicePdf.js:281` | unreachable today (§0.5, §6.2) — no action |

### 4.2b The public signing page needs a migration, not a JSX edit [DERIVED — run-verified]

`PublicSigningPage.jsx:551` renders each WTC's price as `w.locked_line_total`. For P7's rate cards that value is **105 / 125 / 150** — so the customer's signing page would print "$105" as a line price for a $105/hr rate.

It cannot be fixed in the component. The page deliberately does **not** import calc helpers (`PublicSigningPage.jsx:7-11`, audit finding H6 — cost basis must not cross the wire) and instead reads a `SECURITY DEFINER` RPC. The RPC hand-builds a fixed key list [run-verified via `pg_get_functiondef`]:

```sql
'wtc', json_agg(json_build_object(
  'id', w.id, 'sales_sow', w.sales_sow,
  'locked_line_total', w.locked_line_total, 'work_type_name', wt.name))
```

`is_rate_card` and `rate_amount` are not in that list and cannot reach the page without changing the function.

**Action:** `get_public_proposal_view` gets a forward migration in `command-suite-db` adding `is_rate_card` and `rate_amount` to the `wtc` object. Both are safe to expose — a published hourly rate is already on the customer's proposal; neither reveals cost basis, so H6 is not reopened.

The RPC also returns `'total', p.total`, which after §4.2 is material-only. The signing page then needs the "plus labor at rates shown, billed as incurred" line so the customer isn't shown a contract value that omits the labor they're agreeing to.

**This is a second migration the plan previously missed entirely.** It is on the customer-signature path — the highest-consequence surface in the build.

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

**Double-billing guard — specified, not deferred [DERIVED]:**

```sql
create unique index tm_ticket_billed_once
  on public.invoice_lines (tm_ticket_id)
  where tm_ticket_id is not null;
```

A plain partial unique index on the column, **not** one conditioned on invoice liveness — a partial index cannot reference another table, so "live invoice only" is not expressible here. The consequence is deliberate: once a ticket is billed, re-billing it is refused at the database level even if the first invoice was later voided.

That is the correct trade for this build. Re-billing a voided invoice's ticket is a rare correction; silently double-billing a GC is a dispute. If the correction case ever comes up, the operator deletes the voided invoice (its lines cascade — `CallLogDetail.jsx:306-308` already hard-deletes soft-deleted invoices for a job) and the ticket frees up.

**The picker's "unbilled" filter still excludes voided-invoice tickets** (they read as billed), so §5.1 must not offer a ticket the index will then reject. Filter and index agree: a ticket with **any** `invoice_lines` row is not pickable.

### 5.4 Every existing `invoice_lines` consumer, enumerated [read-verified 2026-08-07]

Adding a third line kind is only safe if every reader survives a row with `proposal_wtc_id = null` **and** `billing_pct = null`. `grep -rn "invoice_lines" src supabase/functions` returns **11 files**. An earlier draft named four. All of them:

| # | site | reads | verdict |
|---|---|---|---|
| C1 | `Invoices.jsx:166` | `proposal_wtc_id, billing_pct` for the cap | **safe** — ticket lines carry null on both, contribute 0 to `getBilledPct`. Correct: a ticket must not consume WTC percentage. |
| C2 | `Invoices.jsx:288-296` | archive line insert | untouched |
| C3 | `Invoices.jsx:305-310` | percent line insert | extended (§5.2) |
| C4 | `Invoices.jsx:946` | line display `rowAmount` | **needs a branch** — falls to `0` with no WTC |
| C5 | `Invoices.jsx:1790-1854` | invoice line **editing** | **needs review** — the edit path recomputes from `billing_pct`; a ticket line has none. Must be read-only or ticket-aware, never silently zeroed. |
| C6 | `Invoices.jsx:2144, 2370` | line rows in the detail view | **needs a branch** (`isSov`/`isArchiveLine` pattern exists at 2370) |
| C7 | `PublicInvoicePage.jsx:50, 219-228` | customer-facing lines | **needs the §6.1 branch** |
| C8 | `invoicePdf.js:22, 267-281` | pay-app PDF | unreachable for regular invoices (§6.2) |
| C9 | `qb-sync-invoice/index.ts:150, 243-256` | QB line push | **needs the §6.5 description fix**; dollars already correct |
| C10 | `NewPayAppModal.jsx:209` / `PayAppDetailModal.jsx:335` | pay-app path | **not reached** — pay-app invoices are SOV-lined; verify, don't assume |
| C11 | `CallLogDetail.jsx:306-308` | comment + invoice hard-delete | **interaction to verify** — lines cascade off invoices, which frees the ticket. Correct behavior, but confirm the `on delete restrict` FK (§2.6) doesn't block the delete. |
| C12 | `Customers.jsx:517, 707` | `invWtNames(inv.invoice_lines)` → work-type name column | **cosmetic break** — a T&M-only invoice shows "—" in Work Types |
| C13 | **`SalesDash.jsx:417, 494-502`** | **buckets invoiced/paid dollars by work type** | **money-reporting break — see below** |

**C13 is the real one.** `SalesDash.jsx:497` buckets every dollar as `line.proposal_wtc?.work_types?.name || "Unknown"`, so all T&M revenue lands in a bucket named **"Unknown."** Worse, `:498`:

```js
if (filterWt !== "__all__" && String(line.proposal_wtc?.work_type_id) !== filterWt) continue;
```

With no WTC this is `String(undefined) !== filterWt` → `"undefined" !== filterWt` → always true → **`continue`**. Under any work-type filter, T&M dollars **silently disappear from the dashboard**.

**This is a pre-existing bug, not one this plan creates** — archive invoices (null WTC, `Invoices.jsx:288-296`) already fall into it today. T&M would make it materially worse, because T&M revenue on this job is recurring weekly rather than a one-off archive import.

**Scope call:** fix C13's bucketing to fall back to `line.description` and stop dropping null-WTC lines under a filter. It is ~6 lines in a file the plan otherwise doesn't touch, and leaving it means shipping a revenue dashboard that under-reports the new feature. C12 is cosmetic and can ride along or wait.

### 5.5 No unbilled-tickets list this build [LOCKED]

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
| Migration A (3 tables + 12 RLS policies + 4 columns + unique index + trigger) — `command-suite-db` | ~180 lines SQL |
| Migration B (`get_public_proposal_view` RPC — expose `is_rate_card`/`rate_amount`) — §4.2b | ~60 lines SQL |
| `TMTicketModal.jsx` (entry form) | ~350 lines |
| `CallLogDetail` T&M Tickets section + `App.jsx` ticket routes (§3) | ~90 lines |
| `WTCCalculator` rate-card fields | ~80 lines |
| Rate-card exclusion across S1–S7 + rate-card render across D1–D4 (§4.2) | ~110 lines |
| Contract-value helper + call sites (§4.5) | ~40 lines |
| `Invoices.jsx` T&M picker + line creation + consumer branches C4/C5/C6 (§5.4) | ~170 lines |
| `PublicInvoicePage` ticket block (C7) | ~90 lines |
| `PublicSigningPage` rate-card render (§4.2b) | ~30 lines |
| `SalesDash.jsx` null-WTC bucketing fix (C13) | ~10 lines |
| `qb-sync-invoice` description fix (C9) | ~5 lines |
| **Total** | **~1,215 lines** |

**Time budget: 60 min** — set by Chris, 2026-08-07. Finding cap = 6.

**Estimate divergence, recorded not resolved:** the drafter's read of this surface was 240 min; a post-draft sweep (2026-08-07, prompted by Chris asking why known gaps weren't just fixed) raised it — the enumerations in §4.2, §4.2b and §5.4 found a **second migration on the customer-signature path**, four more sum-sites, and seven more invoice-line consumers than the first draft named. Honest read is now **~300 min**. Chris locked **60**.

Per the standing rule that a **time budget is not a scope cap**, the named surface in §§2-6 is unchanged — nothing was trimmed to fit the number. If the build runs long, that is a Delta to name at close, not a reason to silently drop §4.2b or §5.4.

---

## §8 Build order

1. Migration A + Migration B in `command-suite-db` → **rehearse both** → push → repair ledger if needed
2. Rate-card fields on the WTC + the S1–S7 exclusion sweep + D1–D4 renders + contract-value helper *(verifiable: P7 reads $27,999.64 in the app **and** on the proposal PDF **and** on the signing page — all three, or the sweep isn't done)*
3. Backfill P7's three rate cards by hand (§4.6)
4. Ticket entry modal + job-detail section + routes *(verifiable: ticket CCF_000982 entered at `/calllog/3791/ticket/…`, total reads $6,765 against the paper)*
5. Invoice T&M picker + line creation + consumer branches C4/C5/C6 *(verifiable: invoice carries the $6,765 line and the existing percent lines still bill correctly)*
6. Public invoice page ticket block (C7)
7. QB description fix (C9) + SalesDash bucketing fix (C13)

Steps 2 and 4 each produce something Chris can look at before the next step starts.

**Step 2 is the risky one and it comes first on purpose** — it changes a stored contract value and three customer-facing surfaces. If anything in this build gets cut for time, it is not step 2; a half-done step 2 is worse than not starting it, because the app and the printed proposal would disagree.

---

## §9 Open questions

| # | question | §  | blocking? |
|---|---|---|---|
Only questions that need **Chris's judgment** remain here. Everything that was merely unlooked-up — the sum-site list, the consumer list, the index definition, the signing-page path, the ticket route — was resolved in the 2026-08-07 sweep and moved into the plan body where it belongs.

| # | question | §  | blocking? |
|---|---|---|---|
| O1 | Ticket number format — global `TM-00001` or per-job `7215-TM-01`? (Mechanism is settled: a Postgres sequence, **not** the racy max+1 pattern at `Invoices.jsx:270-278`. Only the display format is open.) | §2.4 | no — pick at build |
| O2 | Which proposal's rate card prefills when a job has more than one? | §3.2 | no |
| O3 | Attach the scan at ticket entry instead of invoice time? (needs a new table if yes) | §3.5 | no |
| O4 | Rate-card wording on the proposal PDF and signing page — what the customer reads under the material total | §4.4, §4.2b | no |
| O5 | Backfill P7 by hand or by migration? | §4.6 | no — hand recommended |
| O6 | Build the unreachable `invoicePdf` branch, or leave it out? | §6.2 | **recommend out** |
| O7 | ~~Time budget confirmation~~ — **resolved: 60 min (Chris, 2026-08-07)**; drafter's post-sweep estimate is 300. Scope deliberately not cut (§7) | §7 | closed |
| O8 | C13 (`SalesDash` null-WTC bucketing) is a **pre-existing** bug this build worsens. Fix it here (~10 lines) or file it? Plan recommends fixing in-flow. | §5.4 | no |

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
| L15 | A ticket has its own router URL (`/calllog/:id/ticket/:ticketId`), per the standing every-detail-has-a-URL rule. |
| L16 | Double-billing is refused by a unique index on `invoice_lines.tm_ticket_id`, accepting that a voided invoice's ticket needs the invoice deleted before it can be re-billed (§5.3). |
| L17 | The rate-card exclusion must land on **all seven** sum-sites S1–S7 including the customer-facing proposal PDF, and on the signing-page RPC (§4.2, §4.2b). A partial sweep is a worse outcome than not starting. |

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-07. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Two things in this plan reach the customer: the price printed on the proposal, and the page they sign. Changing what a rate card is worth changes both, and one of them can only be fixed down in the database — so that's where most of the review points. The rest goes to the money math and to the eleven places in the app that read an invoice line. Four reviewers, and only the six most serious problems come back.

**Note for `/runaudit`:** this plan was swept once already (2026-08-07) after Chris asked why known gaps were being reported instead of fixed. Everything that was merely unlooked-up got looked up and written into the plan body — the seven sum-sites (§4.2), the signing-page RPC (§4.2b), all eleven invoice-line consumers (§5.4), the unique index (§5.3), the ticket route (§3). **Do not re-report those as findings; they are now the spec.** Attack whether the spec is *right*, and what it still misses.

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
- Total lines: 677 (446 pre-sweep)
- Sections: 11 (§0–§10)
- [LOCKED] decisions: 17
- [DESIGN-OPEN] items: 6
- [OPEN] items: 7 live of 8 in §9 (O7 closed)
- Plan-to-code ratio: **677 : 1,215** ≈ 0.56:1 — well under the 50:1 flag. Plan grew, but the build grew with it; no scope-creep signal.

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
- New index: `tm_ticket_billed_once` — unique partial on `invoice_lines(tm_ticket_id) where tm_ticket_id is not null` (§5.3, now specified)
- **Modified RPC**: `get_public_proposal_view` (`SECURITY DEFINER`) gains `is_rate_card` + `rate_amount` in its `wtc` payload (§4.2b) — **second migration, on the customer-signature path**
- New helper: contract-value helper in `calc.js` (§4.5) — **still invented; signature undefined, call sites listed but not enumerated**
- New allocator: `ticket_number` via a Postgres sequence (§2.4) — mechanism settled, display format open (O1)
- New component: `src/components/TMTicketModal.jsx`
- New branch: third invoice-line kind in `PublicInvoicePage.jsx:219-228`, `Invoices.jsx:946/2144/2370`, `qb-sync-invoice:243`
- New routes: `/calllog/:id/ticket/new`, `/calllog/:id/ticket/:ticketId` (§3)

### Cross-system reach
- `command-suite-db` — sole authoring home for the migration; forward-only ledger shared with `sales-command`, `sch-command`, `field-command`
- Shared Supabase project `pbgvgjjuhnpsumnowuym` — Field Command and Schedule Command read/write the same database
- QuickBooks Online via `qb-sync-invoice` (service-role reader of `invoice_lines`)
- Resend email via `send-invoice` (unchanged; carries the signed-ticket scan through `invoice_attachments`)
- Service-role / bypass-RLS write paths to the new tables: **plan claims none — verify, don't accept**

### Irreversibility
- **Migration A**: additive only (3 tables, 4 columns, 1 unique index, 1 trigger, 12 policies). Ledger-coordinated across three repos — a stray sibling ledger row blocks `db push`. Rehearsal via `command-suite-db/scripts/rehearse.sh` is mandatory (L14).
- **Migration B — `CREATE OR REPLACE` on a live `SECURITY DEFINER` function** (`get_public_proposal_view`, §4.2b). Not additive: it replaces a function that serves the **unauthenticated public signing page**. A malformed replacement breaks proposal signing for every customer, and there is no feature flag in front of it. Highest-consequence single step in the build.
- **Backfill**: P7's three T&M WTCs get `is_rate_card`/`rate_class`/`rate_amount` (§4.6). Three rows, by hand, recommended over a migration.
- **Stored contract value mutation**: §4.2 rewrites `proposals.total` for P7 from $28,379.64 → $27,999.64. **P7 status is `Sent`** — this changes a stored figure on a proposal already in a customer's hands. Reversible in principle; the sent PDF is not.
- Public API changes: none.

### Known weak points

**Resolved in the 2026-08-07 sweep — do not re-report:** the invoice-line consumer sweep (now §5.4, all 11 files with a verdict each), the `calcWtcPrice` sum-site list (now §4.2, S1–S7 + D1–D5), the double-billing index (now specified in §5.3), ticket-number allocation (sequence, §2.4), and the missing ticket route (now §3, L15).

**Still open — attack these:**

- **§4.2b — Migration B replaces a live `SECURITY DEFINER` function serving the unauthenticated signing page.** No flag, no staged rollout, and the plan gives it one line in the build order. Break it and no customer can sign anything. The plan also asserts exposing `rate_amount` doesn't reopen audit finding H6 (cost basis over the wire) — **that claim deserves adversarial checking, not acceptance**: `rate_amount` is a sell rate, but confirm nothing in the new payload lets a customer back into burden rate or markup.
- **§4.2 — repricing a `Sent` proposal is still unaddressed.** The repo has explicit prior art: `calc.js:30-33` sets `EXACT_PRICING_END` to a date chosen *specifically* to avoid repricing a proposal already in a customer's hands. This plan changes P7's stored total ($28,379.64 → $27,999.64) while P7 is `Sent`, and does not engage that precedent. The counter-argument (the old number was never a real contract value) may well be right — but the plan asserts it rather than arguing it.
- **§4.5 — the contract-value helper remains undefined.** Signature unwritten; call sites given as "any billed-vs-sold display on `CallLogDetail`" and never enumerated. This is the one enumeration the sweep did **not** finish, and it is the arithmetic that decides whether a T&M job reads as overbilled. Highest-value remaining gap.
- **§5.3 — the unique index trades a rare correction for a common protection.** Once billed, a ticket cannot be re-billed even if its invoice was voided; recovery requires hard-deleting the invoice. The plan calls this the right trade. Pressure it: is "void then re-bill" actually rare in this office, or routine?
- **§5.4 / C5 — the invoice line-edit path (`Invoices.jsx:1790-1854`) is flagged "needs review", not specified.** It recomputes from `billing_pct`, which a ticket line does not have. Left as-is it may silently zero a billed ticket line. This is money, and it is the least-specified consumer.
- **§5.4 / C13 — `SalesDash.jsx:498` drops null-WTC lines under any work-type filter** (`String(undefined) !== filterWt` → always `continue`). Pre-existing (archive lines hit it today), worsened by weekly T&M. Plan proposes a ~10-line in-flow fix (O8). Verify the proposed fix doesn't change existing archive-line reporting in a way nobody expects.
- **§2.2 — `tm_ticket_labor.amount` is stored with no check constraint** tying it to `hours × rate`. A UI arithmetic bug writes a wrong billed dollar with nothing to catch it. The paper form's own total is the only cross-check and it lives outside the system.
- **§2.2 — three fixed rate slots is a hard limit.** A fourth rate class (foreman rate, prevailing-wage split) requires DDL. Named in the plan; verify it's genuinely acceptable rather than merely convenient — HDSP runs prevailing-wage jobs (`proposal_wtc.prevailing_wage`, `pw_rate`, `pw_ot_rate` all exist).
- **§2.5 — 12 RLS policies are referenced by pattern, not written.** "Standard 4-policy `tenant_id` pattern" is an instruction, not a spec.
- **§6.2 / O6 — the plan recommends NOT building the `invoicePdf` branch.** Agents should take a position rather than leave it hanging; reversing it is scope growth against a 60-minute budget.
- **§3.5 / O3 — the signed scan attaches to the invoice, one step removed from the ticket it proves.** If a ticket is billed on an invoice whose attachment is missing, nothing links the two.
- **Budget vs surface.** Post-sweep estimate is 300 min against a 60-min lock (§7). The plan explicitly refuses to cut scope. Agents must **not** report unbuilt scope as a finding — but should flag if the build order (§8) puts a customer-facing half-change at risk of being left half-done.

### Open questions
- Count: **7** live (§9: O1–O6, O8; O7 closed)
- Highest-pressure: **O6** (build the unreachable PDF branch or not — the only open question that changes scope against a fixed 60-min budget) and **O8** (fix a pre-existing dashboard bug in-flow or file it)

### Suggested attack angles (4 total)

1. **Customer-facing surfaces + the signing-page RPC** — covers migrations, edge/RPC, UI, external reach. Required reading: `src/pages/PublicSigningPage.jsx:1-20, 540-560`, the live `get_public_proposal_view` definition (§4.2b quotes it), `src/components/ProposalPDFModal.jsx:177-195, 358`, `src/lib/calc.js:1-35`. Specific pressure: **Migration B replaces a live `SECURITY DEFINER` function on the unauthenticated signing path with no flag** — what breaks if the replacement is wrong, and is a `CREATE OR REPLACE` on that function safe to rehearse? Does adding `rate_amount` to the payload reopen audit H6 (cost basis over the wire)? Does site S5 (`ProposalPDFModal.jsx:189`) actually get excluded, or does the printed proposal diverge from the app — the precise defect `calc.js:12-18` documents? Is repricing a **`Sent`** proposal defensible against the `EXACT_PRICING_END` precedent at `calc.js:30-33`?

2. **Money-model correctness** — covers state model, business logic, data layer. Required reading: `src/lib/calc.js`, `src/components/ProposalDetail.jsx:320-360, 1690-1800`, `src/pages/Invoices.jsx:100-320, 1780-1860`. Specific pressure: the S1–S7 list in §4.2 is now enumerated — **verify it is complete**, don't re-derive it. Then attack what the sweep did *not* finish: the undefined contract-value helper (§4.5) and its unenumerated call sites, which decide whether a T&M job reads as overbilled. Also C5 (`Invoices.jsx:1790-1854`, the line-edit path) — the least-specified money consumer; and stored-not-derived `tm_ticket_labor.amount` with no check constraint.

3. **Schema / migration / cross-repo** — covers migrations, cross-repo reach. Required reading: `command-suite-db` ledger + `scripts/rehearse.sh`, `sales-command/docs/plans/shared_migrations_consolidation.md`, `scripts/check-migration-safety.sh`. Specific pressure: coherence of `on delete restrict` on `invoice_lines.tm_ticket_id` against `on delete cascade` on the ticket children — and against `CallLogDetail.jsx:306-308`, which hard-deletes invoices for a job (C11: does the restrict FK block that delete?); the `tm_ticket_billed_once` index and its voided-invoice trade (§5.3); two migrations in one push across a three-repo shared ledger; whether Schedule or Field read `proposal_wtc` and would see the three new columns.

4. **RLS / multi-tenancy** — covers RLS/auth. Required reading: an existing 4-policy migration in `command-suite-db` as the pattern of record, `src/pages/PublicInvoicePage.jsx:35-60`, `supabase/functions/qb-sync-invoice/index.ts` (service-role reader of `invoice_lines`). Specific pressure: the 12 unwritten policies; `tenant_id` default + FK on all three new tables; whether the `invoice_lines → tm_tickets → tm_ticket_labor` embed on the **public, unauthenticated, token-scoped** invoice page can expose ticket rows across tenants or beyond the invoice's own tickets — note this page reads via PostgREST with an anon key, unlike the signing page which was deliberately moved behind an RPC for exactly this reason; verify the plan's claim of "no service-role write path."

_(A fifth angle — UI / framework-fit — was scored and **dropped by Chris, 2026-08-07**, as the lowest value per token against a 6-finding cap. Not audited this round: V52 convention conformance, and the fact that the plan adds **no router URL** for a ticket and reuses `/calllog/:id` against the standing "every section and detail has a real URL" discipline. Recorded here so the gap is known, not forgotten.)_

### Suggested agent count: 4

Rationale: the formula yields 11 angles (8 layers + cross-system + ≥3 novel mechanisms + ≥5 open questions), so this was a 5 by ceiling rather than by fit; Chris cut the UI angle to bring agent spend closer to the 6-finding cap. The four remaining angles are all money- or customer-facing — none can be dropped further without leaving a live prod surface unexamined. The 2026-08-07 sweep did not reduce the count: it converted three angles from "find what the plan missed" into "verify what the plan now claims," and it surfaced a second migration (§4.2b) that made angle 1 the most consequential rather than the least.
