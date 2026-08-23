# Plan — Screen Refresh + Sales Dash Retirement

**Branch:** `feat/screen-refresh-dash-retire`
**Repo:** sales-command
**Author:** ideate → plan session, 2026-08-22 (revised post round-1 audit)
**Status:** Revised after round-1 audit (`9c24604`), then **re-scoped 2026-08-22** to add the Home→Call Log
rebalance (Home = performance-only; Dig/Hunt/Sleepers/Owe move to Call Log; one shared pipeline selector).
Cash Flow + Analytics decision (delete → AR Command) unchanged. See §1/§2.1/§3.1 and `## Round-1 audit response`.

---

## §0 Baseline (current state — verified)

The Home screen was rebuilt in F47 (PR #35, commit `4bb33a4`, live in prod). **Read-verified** foundation
this plan reuses:

- **Design tokens** (`src/lib/tokens.js`): `C` (teal `#30cfac`, linen card/deep, dark, semantic
  red/amber/green, **and `C.purple #8e44ad` at :24**), `F` fonts, `SP`/`R`/`FS`. No inline hex.
- **Shared components:** `StatCard.jsx`, `SectionHeader.jsx`, `Btn.jsx`, `Pill.jsx`, `DataTable.jsx`,
  `FilterBar.jsx`, plus the F47 followup set.
- **Style rules (CLAUDE.md):** no white backgrounds internally; teal buttons get black text; dollar
  badges = dark bg + teal text.

**Current-state facts the plan changes (read-verified against code + prod schema in round-1 audit):**
- Call Log / Proposals / Invoices are plain tables today (list + filter + detail), no stat rows.
- `SalesDash.jsx` hosts: pipeline stage StatCards, a Pipeline Overview segmented bar + legend
  (`:245-264`), a live conversion-rate calc (`:199-201`), a GoalCard scorecard (`:15-56`), and two
  inline modals — **CashFlow** (`:289-393`) and **Analytics** (`:396-662`).
- `/dashboard` route (`App.jsx:246`) is **nav-gated only** — no component-level role guard today, so a
  rep can already reach it by URL. (Closed by this plan via deletion.)
- **Invoices schema (prod-verified, corrects stale CLAUDE.md list):** `invoices` HAS `created_at`,
  `retention_amount`, `retention_pct`, `retention_released` (plus `sent_at`, `paid_at`, `due_date`,
  `deleted_at`/void). The earlier "these columns don't exist" assumption was wrong.
- Opened-tracking is real: `proposal_recipients.viewed_at`, set by the `mark_recipient_viewed` RPC on the
  public signing page. `Proposals.jsx` load (`:46-50`) does **not** currently select it.
- Proposal statuses in live use include `Parked` (written at `ProposalDetail.jsx:697`) in addition to
  Draft/New/In Progress/Sent/Viewed/Approved Internally/Signed/Sold/Lost.

**Design baseline for THIS work = the four mockups Chris provided 2026-08-22.** The stat-row content in §2
supersedes the raw mockups where noted.

---

## §1 Goal & scope

Bring Call Log, Proposals, and Invoices up to the Home aesthetic, **rebalance Home and Call Log so Home is
performance-only and Call Log is the operational command center**, and **retire Sales Dash by deleting it.**

### In scope
1. **Aesthetic refresh** — Call Log, Proposals, Invoices: top stat row (+ Needs-Attention where specified),
   built on the Home token/component foundation.
2. **Home → Call Log rebalance [Decision: Chris, 2026-08-22].** Home becomes **performance-only** (hero,
   personal monthly sales + target, company/team goal, crew runway, three "Your Book" nav cards). Move the
   operational intelligence **off Home and onto Call Log** — **Where to Dig**, **Where to Hunt** (incl.
   Biggest Bid Hanging), **Sleepers**, **What You Owe** (overdue bids + follow-ups) — by **relocating the
   existing F47 `components/followup/*` components**, not rebuilding them. The `useAlerts()` / `followUp.js`
   engine (snapshot, selectors, suppression/supersede, Log-outcome flow) stays wired; only the render
   location changes. This partially reverses F47's placement (which put that content on Home) to match the
   current mockups.
3. **Delete Sales Dash entirely** — nav item, `/dashboard` route, `SalesDash.jsx` and everything it hosts
   (both modals, GoalCard, pipeline Overview bar, conversion-rate calc), and all references (including the
   Directory chapter).

### Out of scope (explicitly)
- **Cash Flow Forecast + Analytics** — **deleted, not relocated.** Chris will rebuild them later in
  **AR Command** (backlog row filed). No `/cash-flow` or `/analytics` routes, no Home manager cards, no
  route-level role-gating are created by this plan (there is no surviving financial screen to gate).
- Pipeline Overview bar + conversion-rate display — dropped (never used; Chris confirmed).
- Retention/pay-app logic changes; we only *display* existing invoice data.
- Deferred: add Yearly Sales back to Home later; confirm/remove the dead "New Inquiry" call_log stage.

---

## §2 Locked design decisions

### 2.1 Sales Dash deletion + Home/Call Log rebalance [Decision: Chris, 2026-08-22]
Sales Dash is deleted whole; its pipeline stage counts move to the Call Log pipeline row (§3.1). Cash Flow +
Analytics are **removed** and deferred to AR Command (F53). **Home is NOT static:** it sheds its operational
intelligence (Where to Dig / Where to Hunt / Sleepers / What You Owe) to Call Log and keeps only performance
+ the three "Your Book" nav cards. Home's "Your Book" and Call Log's pipeline row read **one shared selector**
(§3.1) so their numbers are identical.

### 2.2 Call Log stat row — "Your Pipeline"
`All · Wants Bid ↑ · Has Bid ($ open) · Sold ($ this month)`
- **Swapped "New Inquiry" → "All"** (New Inquiry reads 0 / suspected unused; deferred).
- **Dropped the `↑8` trend arrow** that lived on New Inquiry; `Wants Bid` keeps its own `↑` trend.
- **$ figures via `calcWtcPrice()` over joined `proposal_wtc`, NOT `proposals.total`** (Data Integrity
  Rule #2 — `total` is stale). See §3.1.
- Subtext: "Pipeline shows Active Jobs assigned to you."

### 2.3 Proposals — top row + Needs-Attention
- **Top row (mutually-exclusive buckets that MUST sum to All):** `All · Draft · Sent · Sold · Lost`
  - Bucket mapping must be **exhaustive** — every live status lands in exactly one bucket, incl. `Parked`.
    Proposed: `Draft`={Draft, New, In Progress, **Parked**}; `Sent`={Sent, Viewed, Approved Internally};
    `Sold`={Signed, Sold}; `Lost`={Lost}. Build adds an assertion that `Σ buckets === All`.
- **Needs-Attention (4):** `Sent – not opened` · `Opened – no response` · `Drafts to finish` · `$ potential`
  - Opened rides `proposal_recipients.viewed_at` (a flag, not a stage — stays out of the top row).
  - `Sent – not opened` = status `Sent`, no recipient with `viewed_at`. `Opened – no response` = a
    recipient has `viewed_at` but not yet Signed/Sold.

### 2.4 Invoices — top row + Needs-Attention (this-month rhythm)
- **Top row (3, this-month flow, with $):** `Drafted · Invoiced · Collected`
  - `Drafted` keys off `invoices.created_at` (exists). `Invoiced` off `sent_at`. `Collected` off `paid_at`.
  - Monthly *flows*, not a partition — they do **not** sum to a fixed total. Intended.
- **Needs-Attention (4):** `Overdue` · `Due this week` · `Awaiting retention` · `Paid this month`
  - `Awaiting retention` reuses the canonical predicate `retention_amount > 0 && !retention_released`
    over `activeInvoices` (voided excluded) — same as `Invoices.jsx:3264`. Do NOT derive from
    billing_schedule.

---

## §3 Workstream 1 — Aesthetic refresh (Call Log, Proposals, Invoices)

Pattern: a `SectionHeader`-labeled `StatCard` row (+ Needs-Attention row for Proposals/Invoices) inserted
**above** the existing FilterBar + DataTable. No table/detail/routing changes. Reuse tokens + `StatCard` +
`SectionHeader`; no new white surfaces; no bespoke twins of existing components.

### 3.1 Call Log — `src/pages/CallLog.jsx` (operational command center)
Three layers above the existing table/filters/detail (all untouched): **(a) pipeline row, (b) relocated
intelligence, (c) table.**

**(a) Pipeline row — shared selector with Home's "Your Book."**
- The Wants Bid / Has Bid / Sold numbers here are the SAME as Home's "Your Book" cards. Compute them
  **once** in `followUp.js`; both screens read that selector. Do **not** compute pipeline numbers
  independently in `CallLog.jsx`.
- **Counts / timelines (identical on both screens):** `All` / `Wants Bid` / `Has Bid` = all-time open,
  rep-scoped; **`Sold` = current month** for BOTH count and $, via `creditedSoldMonth()`. "this month" =
  `tod().slice(0,7)`, never `new Date().getMonth()` on a date column.
- **Dollars:** via `calcProposalTotal()` / `calcWtcPrice()`, **never `proposals.total`** (Data Rule #2).
- **De-dup one bid per job (closes F52):** collapse revisions/versions to newest/live; keep multi-GC sisters
  as separate bids. `followUp.js` sums every proposal per job today (~`:303`/`:422`/`:493`) — fix at the
  shared selector so Home's Your Book gets the corrected numbers too.
- Pagination via `supabaseHelpers.fetchAll`; per-rep view via the existing FilterBar "Sales Rep" dropdown.

**(b) Relocated intelligence (moved from Home).** Render, in order under the pipeline row: **Where to Dig**,
**Where to Hunt** (incl. Biggest Bid Hanging), **Sleepers**, **What You Owe**. Relocate the existing
`components/followup/*` components as-is; keep the `useAlerts()` / `followUp.js` data + suppression +
Log-outcome flow wired. Remove them from `Home.jsx` in the same slice; verify no capability is lost and the
Home + Call Log pipeline numbers match.

### 3.2 Proposals — `src/pages/Proposals.jsx`
- Insert top stat row (5 buckets, exhaustive per §2.3) + Needs-Attention row (4).
- **Opened data:** extend the existing paginated select (`Proposals.jsx:48`) with
  `, proposal_recipients(viewed_at, role)` so it rides parent pagination. Do **not** add a separate
  `.in(proposal_ids)` fetch (breaks past ~1k IDs on URL length).
- **Bucket assertion:** build-time check `Σ buckets === All`; if a new status appears, it must be bucketed
  or shown as an explicit remainder — never silently dropped.
- `$ potential` = Σ `calcWtcPrice()` of the drafts + no-response buckets (define precisely at build).

### 3.3 Invoices — `src/pages/Invoices.jsx`
- Invoices already renders a KPI header (`:3361-3375`) that is **view-conditional** (`isRetentionView`
  swaps the trio at `:3369-3373`). The this-month row **replaces only the non-retention branch**; the
  retention trio stays intact.
- **This-month flows:** `Drafted` = `created_at` in month; `Invoiced` = `sent_at` in month; `Collected` =
  `paid_at` in month.
- **Date handling:** use wall-clock `.slice(0,7)` / `tod()` on date columns — never `new Date().getMonth()`
  on a `date` column. Note `paid_at` is timestamptz vs `sent_at` date — normalize to avoid month-boundary
  misbucketing. Count over `activeInvoices` (excludes `deleted_at`/void).
- **Needs-Attention:** `Overdue` (`due_date` < today, unpaid), `Due this week` (≤7d, unpaid),
  `Awaiting retention` (`retention_amount > 0 && !retention_released` over activeInvoices — reuse
  `:3264`), `Paid this month`.

---

## §4 Workstream 2 — Delete Sales Dash

Delete the whole screen and everything unique to it. Nothing is extracted or relocated except the stage
counts (already covered by §3.1).

**Remove:**
- `src/App.jsx:41` — the `{ id: "dashboard", label: "Sales Dash", … }` NAV entry.
- `src/App.jsx:246` — the `/dashboard` route. **Delete in the first WS2 commit** (closes the pre-existing
  unguarded-route exposure, A3 — do not leave it live while other steps land).
- `src/pages/SalesDash.jsx` — the file, including CashFlowModal, AnalyticsModal, GoalCard, `GOALS` state,
  the Pipeline Overview bar + legend (`:245-264`), and the conversion-rate calc (`:199-201`). These are
  **intentionally dropped** (never used).
- `src/components/TableOfContents.jsx:255-289` — the Ch.5 "Sales Dash" block (`id:"dashboard"` + sub-pages).
  Remove the chapter entirely (no replacement pages exist). Verify the Directory renders cleanly without it.

**Grep-clean (include in the deletion commit):** sweep for `SalesDash`, `/dashboard`, `id:"dashboard"`,
`GoalCard`, `GOALS` across `src/` (imports, links, `TableOfContents.jsx`, tests, redirects). No dangling refs.

---

## §5 Data-layer notes (cross-cutting)

- **Pagination:** every new aggregate uses `supabaseHelpers.fetchAll` / `.range()` — PostgREST caps at 1000.
- **Money from `calcWtcPrice()`**, never `proposals.total` (stale). Applies to Call Log $ and `$ potential`.
- **Reuse canonical predicates** (retention `:3264`) rather than re-deriving.

---

## §6 Role model

- No surviving financial screen → **no new role predicate, no new route guard** in this plan.
- Deleting `/dashboard` (§4) closes the one pre-existing role-gap (an unguarded financial route reachable by
  URL today).
- **Known residual (not this plan):** RLS on `proposals`/`proposal_wtc`/`invoices`/`customers` is scoped by
  `tenant_id` only, no role predicate — so any authenticated tenant user can read those tables directly via
  PostgREST. This is unchanged by this plan and equals today's exposure. It becomes relevant when Cash Flow +
  Analytics are rebuilt in AR Command → captured in the AR Command backlog row; **the rebuild must gate
  server-side (edge fn returning computed numbers, or role-aware RLS), not via a client route guard.**

---

## §7 UI / layout spec (UI-first-class)

- Stat rows: responsive `StatCard` grid (`repeat(auto-fit, minmax(...))`, `SP.lg` gap) under a
  `SectionHeader`; `fmt$` for dollars; $ badges = dark bg + teal text.
- Needs-Attention icons use semantic tokens: red overdue, amber due-soon, **`C.purple` (`:24`, a real token,
  not raw hex) for retention/potential**, green paid. Note `C.purple` moves from an 8px legend dot to a full
  icon — acceptable, just a prominence bump, not a violation.
- **Build ends with an in-browser verify** on a preview deploy against these mockups: no white surfaces,
  teal-on-dark badges, and Sales Dash fully gone (nav, route, Directory chapter).

---

## §8 Boundary carry-over — everything on Sales Dash accounted for

Per "carry items across boundaries," nothing on the deleted screen rides along unowned:

| Sales Dash asset | Disposition |
|---|---|
| Pipeline stage StatCards | → Call Log stat row (§3.1) |
| Per-rep filtering | → Call Log FilterBar (already exists) |
| CashFlow modal | **Deleted** → rebuild in AR Command (backlog row) |
| Analytics modal | **Deleted** → rebuild in AR Command (backlog row) |
| GoalCard scorecard (`:15-56`) | **Dropped** (Home covers the monthly goal; rest not relocated) |
| Pipeline Overview bar + legend (`:245-264`) | **Dropped** — never used |
| Conversion-rate calc (`:199-201`) | **Dropped** — never used |
| Directory Ch.5 "Sales Dash" (`TableOfContents.jsx:255-289`) | **Removed** |

**Deferred (not this build):** Yearly Sales onto Home (Chris intends to); confirm/remove dead "New Inquiry"
stage.

---

## §9 Build sequence

1. Branch cut: `feat/screen-refresh-dash-retire` (done).
2. **WS1**, one screen at a time — Call Log → Proposals → Invoices. Each: add stat row, wire data
   (paginated, `calcWtcPrice`, bucket assertion / retention predicate), in-browser check. Commit per screen.
3. **WS2 delete** in one commit: remove nav item, `/dashboard` route (first), `SalesDash.jsx`, Directory
   Ch.5; grep-clean all refs. In-browser verify Directory + nav render clean.
4. **Preview deploy** + full in-browser verify (incl. a rep login sees no broken links). Then
   buildvsplan → code-review → security-review in their own cold terminals before merge.
5. **Backlog:** file the AR Command rebuild row + update any touched rows in the same commit as the change.

---

## §10 Risks & confidence

- **Bucket exhaustiveness (§3.2):** the `Σ buckets === All` assertion is the guard — without it, a new
  status silently breaks the count. Highest-value check.
- **Money source (§3.1):** must use `calcWtcPrice()`; the SalesDash `p.total` pattern is a trap to avoid.
- **Directory regression (§4):** removing the Ch.5 block must not break `getPageNumber`/PageBadge on other
  chapters — verify the Directory renders.
- **No security surface added:** the financial-leak concern is fully removed by deleting the screens; the
  residual RLS fact (§6) is unchanged-from-today and owned by the AR Command backlog row.

---

## Round-1 audit response

Round-1 audit (3 agents, commit `9c24604`, pattern *client-guard-not-data-boundary*) returned 12 top
findings + 6 adjacent. Chris's decision — **delete Cash Flow + Analytics rather than reparent them behind a
role guard** — reshaped the response:

**Mooted by the delete decision** (no surviving financial screen): **A1** (route guard mistaken for data
boundary — no guard shipped, no false claim), **A2** (Home cards), **A4** (financial predicate), **C3**
(CashFlow extraction), **D1** (extract reusable fn), **E2/E3/E4** (standalone-page filter/guard-race/dual
predicate). **A3** (unguarded `/dashboard`) is closed by deletion, moved to the first WS2 commit.

**Applied to the plan** (WS1 mechanical): **B1** Parked bucket + `Σ===All` assertion (§2.3/§3.2); **B2**
invoices schema corrected + retention predicate reused (§0/§2.4/§3.3), **and CLAUDE.md column list fixed**;
**B3** `calcWtcPrice` not stale `total` (§2.2/§3.1/§5); **B4** recipients join on the paginated select
(§3.2); **C1** Directory Ch.5 removed + grep-clean (§4); **C2** Overview bar + conversion-rate explicitly
dropped (§4/§8); **C6** retention KPI branch preserved (§3.3); **D2** `C.purple` is a real token (§0/§7);
**E1** wall-clock date handling (§3.3).

**No round-2 audit needed:** the decision *reduced* scope and removed the entire security dimension; the
residual findings are WS1 data-correctness items now written into §3. (Per the round-1 synthesis, re-audit
was only required if the A1 ratification changed scope — it did, in the direction of less surface.)

**Backlog filed:** AR Command rebuild of Cash Flow Forecast + Analytics, with the server-side-gating
requirement noted (§6).

---

## As-shipped amendments (2026-08-22, PR #36) — live-directed beyond the written plan

The build was finished collaboratively with Chris; several things diverged from or extended the
sections above. Recorded here so the doc matches `main`. All shipped on `feat/screen-refresh-dash-retire`,
all three cold gates green (buildvsplan 0 blockers · code-review 0 blockers/2 should-fix fixed ·
security-review 0 exploitable). Zero migrations.

- **Shared calculator (supersedes §3.1's "group call_log by stage").** Home "Your Book" and Call Log's
  pipeline row read ONE selector — `followUp.js pipelineStats(snapshot,{repName})` — so they're identical
  by construction. Money via `bidValue`/`calcProposalTotal` (archive → `historical_billed_amount`);
  `dedupeBids` = one bid per (call_log_id, customer_id), newest revision wins, sisters kept (**closes
  F52 #2**; also applied to `goneQuietBids`/`huntResults`). Sold = current month via `creditedSoldMonth`
  (archive-aware, **B70**). `loadSnapshot` extended with `archived` + `proposal_wtc` financial cols.
- **Home → Call Log rebalance (per §2.1 amendment).** Home is performance-only; Where-to-Dig / Hunt /
  Sleepers / log-outcome relocated to Call Log via new `src/components/followup/SalesIntelligence.jsx`
  (leaf components reused as-is).
- **Dark hero panel (overrides §3/§7 "reuse StatCard / no bespoke twins").** New reusable
  `src/components/PipelinePanel.jsx` — dark panel with icon circles + gradient bar, used on Call Log,
  Proposals, Invoices. Chris's explicit call to match the 2026-08-22 mockups.
- **Clickable stats → filter + scroll (all three screens).** Pipeline/bucket/aging stats + Where-to-Dig
  cards filter the existing table (Call Log filters to the exact job-id set the stat counted — Sold =
  this-month ids, not the all-time stage) and scroll to the list. Reuses each screen's existing filter
  state via added lenses (`pipeFilter`/`digFilter`, `propFilter`, `invFilter`), which clear each other.
- **Call Log orientation.** Command Center ↔ All Jobs nav pills, "ALL JOBS · N" divider, direction-aware
  floating button (scroll-position via a `[data-app-content]` listener), manager just-me/company toggle
  on the intelligence.
- **Invoices — reshaped (supersedes §2.4/§3.3's 3-flow + 4-attention layout).** Top bar = Drafted · Sent ·
  Paid (this-month $) · **Past Due** (running overdue $). Needs-Attention → **Receivables Aging** =
  QuickBooks buckets Current / 1–30 / 31–60 / 61–90 / 90+ (via `dayDiff`; late buckets reconcile to Past
  Due) + a Retention chip → the Retention view (view + logic untouched).
- **"Mark received" (new, not in original plan).** Per-recipient action on `ProposalDetail` stamping
  `proposal_recipients.viewed_at`, so a proposal delivered out-of-band drops off "Sent – not opened."
  Extended to invoices as a deferred item (**F54**).
- **Backlog delta this branch:** closed F52 #2; progressed B70; filed **F53** (AR Command rebuild),
  **F54** (opened/unopened tag — proposals + invoices), **R5** (2 low-sev code-review hardening).
