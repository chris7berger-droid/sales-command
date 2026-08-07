# T&M Billing — Build Plan (v2)

**Type:** feature
**Status:** BUILD PLAN — rewritten 2026-08-07 against Chris's model. Supersedes v1 (ticket-object design).
**Repo/branch:** `sales-command` @ `feat/tm-tickets`
**Migrations live in:** `command-suite-db` (single source of truth since 2026-06-29)
**Driving artifact:** `CCF_000982.pdf` — HDSP's paper "T&M Authorization", filled + signed, job 7215 STY 4
**Round-1 audit:** `b29a3b1` · 1C/5H/15M/4L · pattern `rate-card-exclusion-overreach`. This rewrite is the response.

Confidence tags: **[LOCKED]** decided by Chris · **[DERIVED]** mechanical from code/schema read · **[DESIGN-OPEN]** needs a decision.

---

## What changed from v1, and why

v1 built a **T&M ticket** as its own object — three tables, twelve RLS policies, its own routes, a picker that copied tickets onto invoices. The round-1 audit returned 1 Critical and 5 High, and the pattern was clear: most of the damage came from that extra object and from over-reaching on the rate-card exclusion.

Chris's model deletes the object: **the invoice line *is* the ticket row.** You type the day's hours straight onto the invoice, it multiplies by the approved card rate, and the signed paper rides along as the attachment.

What that dissolves outright:

| v1 finding | status under v2 |
|---|---|
| **F** — anon can't read ticket tables through the public invoice page | **gone** — no new tables |
| **A2** — tickets-only invoice misread as an archive invoice | **gone** — T&M lines carry a WTC (§3.3) |
| double-billing the same ticket / the unique index and its voided-invoice trade | **gone** — nothing to double-bill |
| ticket routes, ticket numbering, `unique(tenant_id, ticket_number)` | **gone** |
| 3 tables, 12 RLS policies, `updated_at` trigger, composite-FK and cross-tenant-child concerns | **gone** |
| **E** — billed-vs-sold helper pointing at a dead call site | **gone** — replaced by a separate T&M row (§6) |

What survives and is answered here: **A1** (§5.4), **A3** (§5.5), **B** (§4.4), **C** (§4.2), **D** (§7).

---

## Brief summary (≤300 words)

Sales Command bills a proposal only as a **percentage of a fixed WTC price**, capped so cumulative billing never passes 100% (`Invoices.jsx:186-193, 214-221`). T&M has no fixed price, so there is nothing to take a percentage of. Proposal 7215 P7 encodes three hourly rates as WTCs with `regular_hours = 1`, which makes a $105/hr rate look like a $105 line item — billable, lifetime, to exactly $105.

Four pieces:

1. **A rate card instead of a price.** Choosing the T&M work type opens a rate-card form, not the pricing form. It stores a rate per class (straight / time-and-a-half / double) and marks the WTC `is_rate_card`. The proposal prints "$105 per hour — billed as incurred, no cap," not a dollar line.
2. **A T&M invoice form.** One line per work day, matching the paper: date · crew count · area · regular/OT/double hours · rate (prefilled from the card, editable) · amount. Optional **not-to-exceed for that week**, printed either way. The invoice total is the sum of the day rows.
3. **Rate cards stop counting as contract dollars.** The exclusion goes **inside `calcProposalTotal`** (`calc.js:186`) so every caller inherits it, and `proposals.total` is rewritten on rate-card save.
4. **A T&M row on the job screen** showing the card, hours billed, and dollars billed — separate from Sold/Billed/Remaining, which keeps only fixed-price work.

**The percent cap is never modified.** A day row is a finite amount and bills once at its own value.

Point-at proof: ticket CCF_000982 entered as two day rows on an invoice for **$6,765**, printing date · crew · area · hours · rate, with the signed scan attached.

---

## §0 Baseline — verified current state (2026-08-07)

**Method:** code **read-verified** on `feat/tm-tickets`; live data **run-verified** by SQL against `pbgvgjjuhnpsumnowuym`. Labelled per claim.

### 0.1 The live proposal — 7215 STY 4 P7 [run-verified]

P7 = `72572e85-98ae-476d-8067-ee5c3494fb69` · customer `Contract Flooring` · status **`Sent`** · total `28379.64` · job `call_log.id = 3791` (`7215 - STY 4`, stage `Has Bid`).

Its four `proposal_wtc` rows:

| WTC | work_type | regular_hours | markup_pct | locked_line_total | what it is |
|---|---|---|---|---|---|
| `3310068b…` | 30 Specialty | 1.00 | 0.00 | **27,999.64** | real money — material, bought all at once |
| `f220da87…` | 31 T&M | 1.00 | 85.84 | **105** | straight-time **rate**, $105/hr |
| `d4228e36…` | 31 T&M | 1.00 | 121.24 | **125** | time-and-a-half **rate**, $125/hr |
| `9f412aec…` | 31 T&M | 1.00 | 165.49 | **150** | double-time **rate**, $150/hr |

27,999.64 + 105 + 125 + 150 = 28,379.64. **The proposal total is $27,999.64 of contract plus $380 of phantom hours.**

All four are `locked: true`. Tenant `246f6551-60de-4965-bb97-9a52971bc05d`.

`work_types` 30 = `Specialty`, 31 = `T&M` [run-verified]. `work_type_id = 31` exists on **3 WTCs, 1 proposal**, and no code reads it — `grep -rin "T&M\|time_and_material\|hourly" src/` returns zero hits [read-verified].

`Contract Flooring.requires_pay_app = false` [run-verified] → regular invoice route, not pay-app/SOV.

### 0.2 Invoicing is percent-of-WTC, capped at 100% [read-verified]

`Invoices.jsx` — `:167` loads existing lines as `proposal_wtc_id, billing_pct`; `:186-189` `getBilledPct` sums `billing_pct` per WTC across live invoices; `:191-193` `getRemainingPct = 100 - billed`; `:214-221` `validatePcts` rejects anything over remaining; `:196-206` line amount = `calcWtcPrice(wtc) * pct/100`.

Maximum lifetime billing against the $105/hr WTC: **$105.00**.

**Key consequence for v2:** `getBilledPct` sums `billing_pct`. A T&M line stores `billing_pct = null` → contributes 0 → **a T&M line can carry a WTC reference without ever consuming that WTC's percentage.** This is what makes §3.3 safe.

### 0.3 The archive escape hatch [read-verified]

`Invoices.jsx:224-235` — `is_archive_proposal` proposals take a free-form amount capped at `proposals.total - archiveBilled`; `:288-296` inserts one line with `proposal_wtc_id: null, billing_pct: null`. A null-WTC, null-percent, amount-only line already works end to end.

### 0.4 `invoice_lines` already carries a second line kind [read-verified]

Live columns: `invoice_id, proposal_wtc_id, billing_pct, amount, tenant_id, billing_schedule_line_id, description` [run-verified].

`billing_schedule_line_id` (pay apps) is handled as a parallel kind — `invoicePdf.js:268-281` branches `const isSov = !wtc && sov`. Precedent for a third kind exists and is in production.

### 0.5 The regular-invoice document is a web page, not a PDF [read-verified]

`generateInvoicePdf` (`invoicePdf.js:28`) has one caller — `PayAppDetailModal.jsx:333`. Its WTC branch is annotated at `:276-280` as *"currently unreached."* What the customer sees is `PublicInvoicePage.jsx` (`/invoice/:token`), loading lines at `:50-51` and rendering work-type name + billing % + amount at `:219-228`. `send-invoice` emails HTML; there is no invoice PDF.

### 0.6 Attaching the signed scan already works [read-verified]

`invoice_attachments` is live — upload/delete/list at `Invoices.jsx:599, 1236, 1265, 1285`; `send-invoice/index.ts:73-137` loads from storage, base64-encodes under a size cap, attaches to the email. **Zero new work.**

### 0.7 `proposals.total` has exactly one writer, and it is a lock toggle [read-verified — this is finding B]

`ProposalDetail.jsx:341-342`, inside `toggleWtcLock`:
```js
const proposalTotal = (allWtcs || []).reduce((sum, w) => sum + calcWtcPrice(w, undefined, exact), 0);
await supabase.from("proposals").update({ total: proposalTotal }).eq("id", p.id);
```
The only other writer is `ProposalDetail.jsx:1718`, inside `ArchiveProposalPanel` — archive proposals only.

**P7's WTCs are already locked.** So changing the reduce at `:341` alone leaves `28379.64` in the database forever. `:568` also nulls `locked_line_total` on unlock, so an unlock/re-lock cycle would blank the live signing page mid-window. §4.4 addresses both.

### 0.8 The real aggregator is `calcProposalTotal`, not the call sites [read-verified — this is finding C]

`calc.js:186-188`:
```js
export function calcProposalTotal(wtcs, markup_override_pct, exact = false) {
  return (wtcs || []).reduce((sum, w) => sum + calcWtcPrice(w, markup_override_pct, exact), 0);
}
```
A `grep calcWtcPrice` misses this and misses `ProposalDetail.jsx:1268-1271`, which sums `calcWtcBreakdown` across all WTCs for the margin panel. v1 claimed a complete sweep on the strength of that grep and was wrong. §4.2 fixes the aggregator instead of chasing callers.

### 0.9 QuickBooks labels lines by work type [read-verified]

`qb-sync-invoice/index.ts:150-152` loads lines with `proposal_wtc(*, work_types(name, cost_code))`; `:243-256` emits one line per invoice line with `Description = work_types.name || "Services"`, `Qty: 1`, `UnitPrice: line.amount`.

**Under §3.3, a T&M line carries the rate-card WTC → `Description = "T&M"` with no change to the edge function.**

### 0.10 Void-and-replace copies four fields [read-verified — this is finding A3]

`Invoices.jsx:2137-2143` maps replacement lines as exactly `{invoice_id, proposal_wtc_id, billing_schedule_line_id, billing_pct, amount}`. Any new column not added here is dropped on void-and-replace.

### 0.11 The invoice picker lists Sold proposals only [read-verified — blocker]

`Invoices.jsx:71` — `.eq("status", "Sold")`. **P7 is `Sent`.** It cannot be invoiced at all until it is marked Sold. Work is done and signed (§0.12); this is a data step, not a code change.

### 0.12 The paper form being replaced [run-verified against `CCF_000982.pdf`]

**High Desert Surface Prep — T&M Authorization.** Date `8/4/26` · Location `STY 4 FSA` · Bill To *(blank)* · Description `CAULKING PERIMETER WALLS`.

LABOR — Date · Employee Count · Area Work Performed · Hours REG/OT · Rate · Amount:

| Date | Emp | Area | REG | OT | Rate | Amount |
|---|---|---|---|---|---|---|
| 8/4/26 | 5 | FSA Priority Areas | 27 | 13 | $105/$125 | $4,460.00 |
| 8/5/26 | 2 | FSA Priority Areas | 16 | 5 | $105/$125 | $2,305.00 |
| | | | | | **TOTAL** | **$6,765.00** |

Verified: (27×105)+(13×125)=4,460 ✓ · (16×105)+(5×125)=2,305 ✓ · 6,765 ✓.

MATERIAL/EQUIPMENT — Date · Description · Quantity · Unit Price · Amount. One row (`8/4/26 · TREMCO DYMONIC 100`) with **no price** — material on this job bills separately under the Specialty WTC.

Footer: `Prepared by: PAUL BASIL` (signed 8/5) · `Accepted by:` **Chris Renteria** (signed) · `08/06/26`.

Structural facts:
- Hours are **crew totals per day** ("5 guys, 27 REG, 13 OT"), not per employee. No individual timesheet is needed.
- The form **carries dollars** and the GC signed the dollar amount — unlike the industry quantities-only tag.
- One form spans **multiple work days** (header 8/4; rows 8/4 and 8/5).

---

## §1 Problem statement [LOCKED]

Open-ended T&M cannot be billed. The only mechanism is a percentage of a fixed price (§0.2), and T&M has no fixed price. Encoding an hourly rate as a one-hour WTC (§0.1) displays the rate correctly and caps lifetime billing at one hour.

HDSP already produces the right artifact on paper (§0.12): a signed, priced, finite authorization. It is retyped nowhere and billed by hand.

---

## §2 Rate card on the WTC

### 2.1 New columns on `proposal_wtc` [LOCKED]

| column | type | notes |
|---|---|---|
| `is_rate_card` | boolean not null default false | this WTC is a price list, not a contract amount |
| `rate_class` | text null, check in ('regular','ot','dt') | which slot it feeds |
| `rate_amount` | numeric null | dollars per hour, typed explicitly |

**`rate_amount` is explicit, not inferred [LOCKED].** Today the rate is readable only as `calcWtcPrice` of a WTC that happens to have `regular_hours = 1` (§0.1) — an artifact of data entry, not a contract. Reading rates that way breaks the moment anyone edits hours.

**Keyed by `is_rate_card`, not `work_type_id = 31` [LOCKED].** A work-type row is user-editable; a rename or delete would silently un-mark every rate card.

### 2.2 Authoring [LOCKED]

Picking the **T&M** work type in `WTCCalculator.jsx` opens a **rate-card form** instead of the pricing form: rate class + rate amount + the schedule text that already lives in `sales_sow`. The hours / materials / travel / markup inputs are hidden — they don't apply.

`is_rate_card` is set by that choice, not by a separate checkbox the user could forget.

### 2.3 What the proposal shows [LOCKED]

A rate card prints as a rate, never a line price:

```
T&M — LABOR RATE FOR JOINT FILL          $105.00 / hour
T&M — TIME AND A HALF                    $125.00 / hour
T&M — DOUBLE TIME                        $150.00 / hour
                     Billed as incurred · no cap
```

Contract total below reads **$27,999.64** (material), with the labor stated as rates, not folded into the number.

**"No cap" is a statement, not a stored field.** The not-to-exceed is set per week on the invoice (§5.3), so the proposal-level text is fixed copy.

**[DESIGN-OPEN O1]** exact wording on the customer-facing proposal PDF and signing page.

---

## §3 The T&M invoice line

### 3.1 New columns on `invoice_lines` [LOCKED]

One row per work day, matching a row on the paper:

| column | type | notes |
|---|---|---|
| `work_date` | date null | |
| `crew_count` | int null | employees that day |
| `area` | text null | "FSA Priority Areas" |
| `reg_hours` / `reg_rate` | numeric null | |
| `ot_hours` / `ot_rate` | numeric null | |
| `dt_hours` / `dt_rate` | numeric null | |

`amount` and `description` already exist. `amount` stores `reg_hours*reg_rate + ot_hours*ot_rate + dt_hours*dt_rate`, cent-rounded.

**Three fixed rate slots [LOCKED].** The paper has a REG/OT pair, P7 carries exactly three rates, and straight / time-and-a-half / double-time is the universal split. **Named limit:** a fourth class (foreman rate, prevailing-wage split) needs DDL — and note `proposal_wtc.prevailing_wage`, `pw_rate`, `pw_ot_rate` already exist, so a PW T&M job would not fit today.

**`amount` is stored, not derived [LOCKED].** It is a billed figure and must not move if a rate is later edited on the proposal. Same reasoning as `locked_line_total`.

**Known gap [DERIVED]:** no check constraint ties `amount` to `hours × rate`. A UI arithmetic bug writes a wrong billed dollar with nothing to catch it — the paper's own total is the only cross-check and it lives outside the system. §5.2's live total against the paper is the mitigation.

### 3.2 A day row bills once, at its own value [LOCKED]

`billing_pct = null`. The percent cap never applies. Nothing is modified in `getBilledPct`.

### 3.3 A T&M line carries the rate-card WTC [LOCKED — dissolves four v1 findings]

`proposal_wtc_id` = the rate-card WTC the rate came from.

Safe because `getBilledPct` (§0.2) sums `billing_pct`, which is null here — the line never consumes the rate card's percentage. What it buys:

- `isArchiveInvoice` (`Invoices.jsx:1747`, `:2358`) tests `lines.every(l => !l.proposal_wtc_id && !l.billing_schedule_line_id)` — a T&M line **has** a WTC, so a T&M-only invoice is never misread as archive. **Round-1 finding A2 dissolves with no code change.**
- QuickBooks gets `Description = "T&M"` for free (§0.9) — no edge-function change.
- `Customers.jsx:707` work-type column and `SalesDash.jsx:497` bucketing both resolve the work type normally. **Round-1 C12/C13 no longer bite on T&M lines.**

*(`SalesDash.jsx:498` still drops genuinely null-WTC archive lines under a work-type filter. That is a pre-existing bug this build no longer worsens — filed as backlog, out of scope.)*

**Multi-rate days:** the paper's 8/4 row mixes 27 REG @ $105 and 13 OT @ $125 — two rate classes on one row. The line points at **one** WTC. Convention: point at the `regular` card; the OT and DT rates are carried on the row itself.

**[DESIGN-OPEN O2]** a day of pure double-time would point at the `regular` card while billing only DT hours. Cosmetically odd in the work-type column; harmless to the money. Accept, or point at the highest class actually used?

---

## §4 Rate cards stop counting as contract dollars

### 4.1 The rule [LOCKED]

A rate card contributes **$0** to any proposal total. P7 goes $28,379.64 → **$27,999.64**.

### 4.2 The exclusion lives inside `calcProposalTotal` [LOCKED — round-1 finding C]

v1 tried to patch each call site off a `grep calcWtcPrice`, which is structurally blind to `calcProposalTotal` (`calc.js:186`) and to the `calcWtcBreakdown` sum at `ProposalDetail.jsx:1268-1271` (§0.8).

**Fix the aggregator, not its callers:**

```js
export function calcProposalTotal(wtcs, markup_override_pct, exact = false) {
  return (wtcs || [])
    .filter(w => !w.is_rate_card)
    .reduce((sum, w) => sum + calcWtcPrice(w, markup_override_pct, exact), 0);
}
```

Every caller inherits it, including `MultiGCWizard.jsx:221` where v1 would have shown P7 at $28,379.64 against sister cards at $27,999.64 and made every "delta vs source" wrong by exactly $380.

**Call sites that hand-roll their own reduce and must be routed through `calcProposalTotal` (or filtered in place):**

| # | site | what it computes |
|---|---|---|
| S1 | `ProposalDetail.jsx:341` | `proposals.total` (see §4.4) |
| S2 | `ProposalDetail.jsx:357` | `billing_schedule_lines.scheduled_value` on SOV seed |
| S3 | `Invoices.jsx:109` | `billing_schedule.contract_sum`, auto-seed for `requires_pay_app` |
| S4 | `Invoices.jsx:117` | `billing_schedule_lines.scheduled_value`, same auto-seed |
| S5 | `ProposalPDFModal.jsx:189` | **the customer-facing proposal PDF total** |
| S6 | `MultiGCWizard.jsx:530` | per-tier total, preview |
| S7 | `MultiGCWizard.jsx:635` | per-tier total, written on clone |
| S8 | `ProposalDetail.jsx:1268-1271` | margin panel — sums `calcWtcBreakdown`, injects $380 of phantom price **plus its cost basis**, corrupting margin % |

**S5 is the one that bites.** Miss it and the printed proposal says $28,379.64 while the app says $27,999.64. That is the exact defect `calc.js:12-18` documents — *"the customer-facing proposal PDF printed its own raw sum… Customers paid what the proposal said and came up cents short."*

**S3/S4 note:** Contract Flooring is `requires_pay_app = false`, so job 7215 never reaches that path. It is live for other customers.

**Per-WTC display sites — render a rate card as a rate, not a price:** `ProposalDetail.jsx:933`, `ProposalPDFModal.jsx:358`, `MultiGCWizard.jsx:588-589`. `Invoices.jsx:456` is filtered out entirely by §4.3. `invoicePdf.js:281` is unreachable (§0.5) — no action.

### 4.3 Rate cards are excluded from percent billing [LOCKED]

`Invoices.jsx` step 2 filters `is_rate_card` WTCs out of the percentage list. **This is what makes the percent cap a non-issue instead of a thing to fight.**

### 4.4 Rewriting `proposals.total` [LOCKED — round-1 finding B]

§0.7: `proposals.total` is written only inside `toggleWtcLock`, and P7's WTCs are already locked. Editing that reduce alone leaves `28379.64` in the database forever, and forcing an unlock/re-lock would blank the live signing page mid-window (`:568` nulls `locked_line_total`).

**Fix — recompute on rate-card save, not only on lock toggle.** Saving a WTC in `WTCCalculator.jsx` (`handleSave`, `:1956`) already writes `proposal_wtc`; it additionally recomputes `calcProposalTotal` over the proposal's WTCs and writes `proposals.total`. This is idempotent, fires whenever a rate card is created or changed, and requires **no unlock**.

P7's backfill (§4.5) then rides the same path: open each rate-card WTC, set its class and rate, save — the total corrects itself on the first save.

**Extract the recompute into one shared function** used by both `toggleWtcLock` and `handleSave`, so the two writers cannot drift.

### 4.5 Backfilling P7 [LOCKED]

Three WTCs get `is_rate_card` + `rate_class` + `rate_amount` by hand in the new form (§2.2). Three rows, one job. Hand-entry over a migration: it exercises the new UI, corrects the total via §4.4, and touches nothing else.

### 4.6 The signing page needs a migration [DERIVED — run-verified, round-1 finding D]

`PublicSigningPage.jsx:551` renders each WTC's price as `w.locked_line_total`. For P7's rate cards that is **105 / 125 / 150** — the customer's signing page would print "$105" as a line price for a $105/hr rate.

It cannot be fixed in the component. The page deliberately does **not** import calc helpers (`:7-11`, audit finding H6 — cost basis must not cross the wire) and reads a `SECURITY DEFINER` RPC instead. That RPC hand-builds a fixed key list [run-verified via `pg_get_functiondef`]:

```sql
'wtc', json_agg(json_build_object(
  'id', w.id, 'sales_sow', w.sales_sow,
  'locked_line_total', w.locked_line_total, 'work_type_name', wt.name))
```

`is_rate_card` and `rate_amount` are not in that list and cannot reach the page without replacing the function.

**Migration B:** `get_public_proposal_view` gains `is_rate_card` and `rate_amount` in its `wtc` object. Both are safe to publish — a quoted hourly rate is already on the customer's proposal and neither reveals cost basis, so H6 is not reopened. The `'total', p.total` key needs no change; §4.4 makes that value correct at the source.

**This is a `CREATE OR REPLACE` on a live function serving the unauthenticated signing path, with no feature flag.** Handling is specified in §7.

---

## §5 Entering and billing the work

### 5.1 Where [DERIVED]

The existing **New Invoice** modal in `Invoices.jsx`, extended with a third mode. No new screen, no new route, no new component tree — v1's ticket modal and its routes are gone.

Step 2 already branches archive (free-form amount) vs regular (percent per WTC). A **T&M** section appears when the selected proposal has rate-card WTCs. Both sections can appear on one invoice: the material WTC at some percent **and** the week's day rows. That is the normal case for job 7215.

### 5.2 The day-row form [LOCKED]

Same columns as the paper, same order (§0.12): **Date · Crew · Area · REG hrs · OT hrs · DT hrs · Rate · Amount**, "add row" for each work day.

Rates prefill from the rate cards by class and stay editable per row; a row edited off the card value is marked so the office can see it diverged. Edits never write back to the proposal.

A **live total** updates as rows are typed, so it can be checked against the handwritten total on the paper before saving. A mismatch against the paper is the single most likely transcription error, and it is the only check on §3.1's unconstrained `amount`.

Material rows use the existing archive-style amount line — no new mechanism.

### 5.3 Weekly not-to-exceed [LOCKED]

`invoices.nte_amount numeric null`. Set when the GC has given a ceiling for that week, blank when they haven't. The form warns when the day rows exceed it; it does not block.

It prints on the invoice either way — *"Not to exceed $X this week"* or *"No cap — billed as incurred."*

**Deliberately per-invoice, not per-job [LOCKED].** A GC may impose a cap partway through a job; billing is weekly, so the week is the granularity at which the call actually gets made. A job-level ceiling was considered and rejected — no live use for it.

**Consequence, accepted:** a weekly cap gives the job no running ceiling, so it does not make the job's Remaining figure meaningful for labor. §6 handles that a different way.

### 5.4 The line-edit path must preserve T&M amounts [DERIVED — round-1 finding A1, Critical]

`handleSaveEdit` (`Invoices.jsx:1795-1811`) has preserve branches for synced-lock, archive, and SOV lines, then falls through to a WTC recompute. A T&M line **has** a WTC (§3.3) whose pricing inputs are blank, so it recomputes to ~$0 — a $6,765 line silently becomes $0.00, `invoices.amount` is overwritten, and QuickBooks is re-synced full-replace with the wrong figure.

This is the third occurrence of the `calcWtcPrice → 0` mechanism (archive `14000c5`, pay-app `33c385e`).

**Fix — a preserve branch, matching the three that already exist at `:1798`/`:1801`/`:1810`:**

```js
if (l.proposal_wtc?.is_rate_card) {
  return { id: l.id, billing_pct: null, amount: parseFloat(l.amount) || 0 };
}
```

The existing select at `Invoices.jsx:1541` must embed `proposal_wtc(is_rate_card)` for the test to have an input. **Preserve is the only correct behavior — recompute is unreachable, because the line's hours live on the row and not on the WTC.**

### 5.5 Void-and-replace must carry the day fields [DERIVED — round-1 finding A3]

`Invoices.jsx:2137-2143` copies exactly four fields (§0.10). The nine day columns from §3.1 must be added, or a replacement invoice keeps the dollars and loses the breakdown that justifies them.

### 5.6 Display branches [DERIVED]

Sites that render a line's "full value" as `calcWtcPrice(wtc)` need a rate-card branch returning the stored `amount`: `Invoices.jsx:946`, `:2370`, `PublicInvoicePage.jsx:225`. The `isSov` / `isArchiveLine` discrimination at `:2370` is the pattern to copy.

### 5.7 What the customer sees [LOCKED]

`PublicInvoicePage.jsx:219-228` renders line = work-type name + billing % + amount. A T&M line has no percent, so it needs its own branch rendering **the day breakdown** — date · crew · area · hours by class · rate · amount — then the week's total and the NTE statement.

That breakdown is what makes the invoice approvable without a phone call. The signed scan rides along via `invoice_attachments` (§0.6) — **zero code**.

`invoicePdf.js` gets no change: it has no regular-invoice caller (§0.5). **[DESIGN-OPEN O3]** confirm leaving it out.

---

## §6 The T&M row on the job screen [LOCKED — replaces round-1 finding E]

`CallLogDetail.jsx:885-914` renders **Job Totals**: `Sold` (sum of `proposals.total` for Sold proposals) · `Billed` (`sumContractBilled`, every live invoice amount) · `Remaining` · `% Invoiced`.

That box assumes a fixed contract. T&M has none, so forcing T&M dollars through it makes Remaining drift negative — about $6,765 further off per week.

**Don't bend the box. Add a row beside it:**

```
Sold  $607,840   Billed  $340,120   Remaining  $267,720   67%

T&M   $105 / $125 / $150 per hr
      43 reg · 18 OT hrs                        $6,765 billed
```

- The top row keeps **fixed-price work only** — `sumContractBilled` gains a filter excluding lines on rate-card WTCs.
- The T&M row shows the card, hours billed by class, and dollars billed — summed from the day rows.

Both numbers are then true, and **no contract-value helper needs inventing** — which is what round-1 finding E was about (v1's helper pointed at `ProposalDetail.jsx:1699`, inside `ArchiveProposalPanel`, where archive proposals have no WTCs and the fix would have been a no-op).

**Also missed by v1 and still out of scope:** `CallLogDetail.jsx:948`, `SalesDash.jsx:131-137`, `Home.jsx:130-133` — T&M revenue will not count toward billing goals. **[DESIGN-OPEN O4]** should it?

---

## §7 Migrations

Both author in `command-suite-db`. **Rehearse before any push to the shared DB.**

**Migration A — additive columns only.** 3 on `proposal_wtc` (§2.1), 9 on `invoice_lines` (§3.1), 1 on `invoices` (§5.3). No new tables, no new policies, no triggers, no indexes. Existing RLS on both tables already covers the new columns.

**Migration B — `CREATE OR REPLACE` on `get_public_proposal_view`** (§4.6). Not additive. It replaces a live `SECURITY DEFINER` function serving the **unauthenticated** signing page, with no flag in front of it.

**Round-1 finding D — the rehearsal harness cannot verify Migration B, and is stale today:**

- `rehearse.sh` fingerprints the baseline before candidates and re-runs only `check_anon_exposure` afterward. A replacement that silently drops `signing_token_consumed_at`, the `signing_token_expires_at > now()` guard, the nested `call_log → customers` object, `ORDER BY`, the `COALESCE` fallback, or `SET search_path` applies clean, moves zero fingerprint counts, and **passes vacuously**.
- The harness fails before it starts regardless: `EXPECT_TABLES=49` against a prod with ≥52 (`job_assets`, `ar_week_decisions`, `ar_job_billing` all post-date the baseline).

**Required, before anything is applied:**

1. Refresh the rehearsal baseline `--against-prod` and re-derive `EXPECT_*`. The refresh carries a mandatory hand-edit (`REVOKE SELECT ON invoices FROM anon`) that `db dump` cannot emit.
2. Add a **behavioural** check for Migration B, since the fingerprint check cannot see it: call `get_public_proposal_view` with a live token before and after, and diff the returned JSON keys. Anything other than "same keys plus `is_rate_card`, `rate_amount`" is a fail.
3. Author `rollbacks/<ts>_revert_tm_billing.sql` in the same PR — `command-suite-db/supabase/rollbacks/` holds 22 paired reverts; v1 named none.
4. **Drop "repair ledger if needed"** — the README forbids `migration repair --status reverted` on a live entry.

§7 estimate for Migration B is ~90 lines: the current function body is ~90 and `CREATE OR REPLACE` restates all of it.

---

## §8 Estimate

| piece | est. code |
|---|---|
| Migration A (13 additive columns) | ~40 lines SQL |
| Migration B (`get_public_proposal_view` restated + rollback + behavioural check) | ~140 lines SQL |
| Rehearsal baseline refresh (§7 step 1) | procedural |
| `WTCCalculator` rate-card form + total recompute (§2.2, §4.4) | ~120 lines |
| `calcProposalTotal` exclusion + S1–S8 routing (§4.2) | ~90 lines |
| Rate-card render at the 3 per-WTC display sites | ~50 lines |
| `Invoices.jsx` T&M day-row form + NTE (§5.2, §5.3) | ~220 lines |
| A1 preserve branch, A3 field carry, display branches (§5.4–5.6) | ~60 lines |
| `PublicInvoicePage` day breakdown (§5.7) | ~80 lines |
| `PublicSigningPage` rate-card render (§4.6) | ~30 lines |
| `CallLogDetail` T&M row + `sumContractBilled` filter (§6) | ~70 lines |
| **Total** | **~900 lines** |

**Time budget: 60 min** (Chris, 2026-08-07). **Finding cap: 6.**

**Estimate divergence, recorded not resolved:** honest read is **~180 min** — down from v1's 300, because deleting the ticket object removed three tables, twelve policies, a modal, routes, and a picker. Still three times the lock. Per the standing rule that a **time budget is not a scope cap**, nothing in §§2-7 was trimmed to fit the number. If the build runs long, that is a Delta to name at close.

---

## §9 Build order

0. **Mark P7 Sold** (§0.11) — nothing downstream can be proved until this is done. Data step, not code.
1. Refresh the rehearsal baseline (§7 step 1). **Migration A + B do not get applied until this passes.**
2. Migration A + Migration B → rehearse → behavioural check on B → push. Rollbacks authored in the same PR.
3. Rate-card form + `calcProposalTotal` exclusion + total recompute + S1–S8 *(verifiable: P7 reads **$27,999.64** in the app, on the proposal PDF, and on the signing page — all three, or the sweep isn't done)*
4. Backfill P7's three rate cards by hand (§4.5)
5. T&M day-row form + NTE + A1/A3/display branches *(verifiable: ticket CCF_000982 entered as two rows totalling **$6,765**, and the existing percent lines still bill correctly)*
6. Public invoice page day breakdown (§5.7)
7. Job-screen T&M row (§6)

Steps 3 and 5 each produce something to look at before the next starts.

**Step 3 is the risky one and it comes first on purpose** — it changes a stored contract value and three customer-facing surfaces. If anything gets cut for time, it is not step 3: a half-done step 3 leaves the app and the printed proposal disagreeing, which is worse than not starting.

---

## §10 Open questions

Only questions needing Chris's judgment. Everything look-up-able was resolved in the §0 baseline.

| # | question | § | blocking? |
|---|---|---|---|
| O1 | Rate-card wording on the proposal PDF and signing page | §2.3, §4.6 | no |
| O2 | A pure-double-time day points at the `regular` card in the work-type column — accept, or point at the highest class used? | §3.3 | no |
| O3 | Confirm `invoicePdf.js` stays untouched (it has no regular-invoice caller) | §5.7 | no |
| O4 | Should T&M revenue count toward billing goals (`SalesDash.jsx:131-137`, `Home.jsx:130-133`)? | §6 | no |
| O5 | Prevailing-wage T&M does not fit the three fixed slots. Real need or theoretical? | §3.1 | no |

---

## §11 Locked decisions summary

| # | decision |
|---|---|
| L1 | **The invoice line is the ticket.** No ticket object, no ticket tables, no ticket routes. |
| L2 | One invoice line per work day, matching a row on the paper: date · crew · area · REG/OT/DT hours · rate · amount. |
| L3 | Office entry only. No mobile app, no in-app signature capture, no crew-punch integration. The paper is signed in the field; the scan attaches to the invoice. |
| L4 | Picking the T&M work type opens a rate-card form, not the pricing form. |
| L5 | Rates prefill from the card and stay editable per row. Edits never write back to the proposal. |
| L6 | Weekly invoicing; a week's worth of day rows per invoice. |
| L7 | Not-to-exceed is **per invoice (per week)**, not per job. Prints either way, warns but does not block. |
| L8 | Materials ride the existing amount-line mechanism. |
| L9 | P7 stays **one** proposal. A rate card is not its own proposal and gets no proposal number. |
| L10 | Rate cards contribute $0 to any proposal total, enforced **inside `calcProposalTotal`**, not at call sites. |
| L11 | `proposals.total` is recomputed on rate-card save, not only on lock toggle — no unlock, no blank-signing-page window. |
| L12 | A T&M line carries the rate-card WTC. Safe because `billing_pct` is null; it dissolves the archive misclassification and gives QuickBooks its description for free. |
| L13 | Rate cards are keyed by `is_rate_card`, never by `work_type_id = 31`. |
| L14 | Three fixed rate slots (regular / OT / double). A fourth class needs DDL. |
| L15 | The job screen gets a **separate T&M row**; Sold/Billed/Remaining keeps fixed-price work only. No contract-value helper is invented. |
| L16 | Migrations author in `command-suite-db`. The rehearsal baseline is refreshed **before** anything is applied, and Migration B gets a behavioural check because the fingerprint check cannot see it. |
| L17 | Rollbacks are authored in the same PR. No `migration repair --status reverted`. |
