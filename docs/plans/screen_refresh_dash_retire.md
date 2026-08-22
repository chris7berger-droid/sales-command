# Plan — Screen Refresh + Sales Dash Retirement

**Branch:** `feat/screen-refresh-dash-retire`
**Repo:** sales-command
**Author:** ideate → plan session, 2026-08-22
**Status:** Draft, ready for adversarial audit (see `## Audit manifest`)

---

## 0. Context & design baseline

The Home screen was rebuilt in F47 (PR #35, commit `4bb33a4`, live in prod). That build left a
reusable foundation this plan stands on:

- **Design tokens:** `src/lib/tokens.js` — `C` (colors: teal `#30cfac`, linen card/deep, dark, semantic
  red/amber/green), `F` (fonts), `SP`/`R`/`FS` (spacing, radius, font-size). No inline hex anywhere.
- **Shared components:** `src/components/StatCard.jsx`, `SectionHeader.jsx`, `Btn.jsx`, `Pill.jsx`,
  `DataTable.jsx`, `FilterBar.jsx`, plus the F47 followup set (`MoneyDonut`, `GoalThermometer`, etc.).
- **Style rules (CLAUDE.md):** no white backgrounds internally; teal buttons get black text; dollar
  badges = dark bg + teal text.

**Design baseline for THIS work = the four mockups Chris provided 2026-08-22** (New Home, New Call Log,
Proposals/Invoices, Cash Flow/Analytics). The stat-row content below supersedes the raw mockups where
noted (decisions taken in the ideate pass).

---

## 1. Goal & scope

Bring Call Log, Proposals, and Invoices up to the Home aesthetic (a stat row + Needs-Attention row on
top of the existing tables), retire the now-redundant Sales Dash screen, and relocate its two real
assets — **Cash Flow Forecast** and **Analytics** — to become **manager-only sub-pages of Home**,
reached via two cards on the Home screen.

### In scope
1. **Aesthetic refresh** — Call Log, Proposals, Invoices: add a top stat row (and Needs-Attention row
   where specified) using the Home token/component foundation.
2. **Retire Sales Dash** — remove nav item + `/dashboard` route + `SalesDash.jsx`.
3. **Reparent** — Cash Flow Forecast and Analytics become standalone routes under Home, **manager-only**
   (no nav entry for reps; direct URL 403s for reps).
4. **Home manager cards** — two entry cards on Home (Cash Flow, Analytics) rendered only for managers,
   linking to the sub-pages.

### Out of scope (explicitly)
- Embedding cash-flow/analytics data *inline* on Home (we chose Option A: cards → sub-pages, not embed).
- Investigating whether the "New Inquiry" stage is dead (flagged, deferred — see §8 open items).
- Any change to Customers, Our Team, History Locker, Settings, The Directory.
- Retention/pay-app logic changes; we only *display* existing invoice data.

---

## 2. Locked design decisions (from ideate pass)

### 2.1 Home — reparenting model
- **Option A locked:** Cash Flow + Analytics are **sub-pages** reached by cards on Home, not embedded.
- **Manager-only** means BOTH: (a) no nav/card entry point for reps, AND (b) the sub-routes return a
  403/Placeholder for reps even if the URL is pasted directly.

### 2.2 Call Log stat row — "Your Pipeline"
`All · Wants Bid ↑ · Has Bid ($ open) · Sold ($ this month)`
- **Swapped "New Inquiry" → "All"** (New Inquiry currently reads 0 / suspected unused; deferred).
- **Dropped the `↑8 this week` trend arrow** that lived on New Inquiry. `Wants Bid` keeps its own `↑` trend.
- Subtext retained: "Pipeline shows Active Jobs assigned to you."

### 2.3 Proposals — top row + Needs-Attention
- **Top row (5, mutually-exclusive stage buckets that sum to All):**
  `All · Draft · Sent · Sold · Lost`
  - **Collapsed "Signed" into "Sold"** (Signed=3, barely used, confusing vs Sold). The **Sold** card
    counts status ∈ {`Signed`, `Sold`} so nothing is dropped from the count.
- **Needs-Attention row (4):** `Sent – not opened` · `Opened – no response` · `Drafts to finish` · `$ potential`
  - **"Opened" is a flag, not a stage** — it rides on `proposal_recipients.viewed_at` (already tracked
    via the `mark_recipient_viewed` RPC on the public signing page). It deliberately lives in
    Needs-Attention, NOT the top row, because it does not partition the population.
  - `Sent – not opened` = status `Sent` with **no** recipient having `viewed_at` set → chase delivery.
  - `Opened – no response` = a recipient has `viewed_at` set but proposal not yet Signed/Sold → chase decision.

### 2.4 Invoices — top row + Needs-Attention (this-month rhythm)
- **Top row (3, this-month flow, with $):** `Drafted · Invoiced · Collected`
  - Chosen over lifetime totals to match the Needs-Attention row's cadence and kill the
    `Total Paid` ≈ `Paid This Month` duplication in the mockup.
  - **Note:** these are monthly *flows*, not a partition — they do **not** sum to a fixed total (an
    invoice drafted last month, collected this month, lands in two months). This is correct and intended.
- **Needs-Attention row (4, unchanged from mockup):** `Overdue` · `Due this week` · `Awaiting retention` · `Paid this month`.

---

## 3. Workstream 1 — Aesthetic refresh (Call Log, Proposals, Invoices)

Pattern for all three: a `SectionHeader`-labeled stat row of `StatCard`s (and a Needs-Attention row for
Proposals/Invoices) inserted **above the existing FilterBar + DataTable**. No table/detail/routing
changes. Reuse tokens + `StatCard` + `SectionHeader`; no new white surfaces.

### 3.1 Call Log — `src/pages/CallLog.jsx`
- Insert "Your Pipeline" stat row above the current list.
- **Data:** stage counts come from grouping `call_log` rows by `stage` (pattern already exists in
  `SalesDash.jsx:195`). `Has Bid`/`Sold` counts are **all-time**; `Wants Bid` is **this-month** (mirror
  the SalesDash `["Has Bid","Sold"] ? rows : monthRows` rule).
- **NEW dollar figures (not currently computed):**
  - `Has Bid — $ open` = Σ proposal `total` for active (non-Sold/Lost) jobs in Wants Bid + Has Bid.
  - `Sold — $ this month` = Σ proposal `total` for jobs Sold this month.
  - ⚠️ **Confidence: DERIVED** — requires joining proposal totals to call_log stage; verify the exact
    join + which amount field is canonical during build (see §5).
- Manager filtering by rep is already available via the existing Call Log `FilterBar` "Sales Rep"
  dropdown — so the per-rep pipeline view SalesDash offered is preserved here.

### 3.2 Proposals — `src/pages/Proposals.jsx`
- Insert top stat row (5 buckets) + Needs-Attention row (4) above the list.
- **Data — status counts:** group `proposals.status` (values in code: Draft, New, In Progress, Sent,
  Viewed, Approved Internally, Signed, Sold, Lost). Map to the 5 display buckets:
  - `All` = all non-deleted; `Draft` = {Draft, New, In Progress}? — ⚠️ **DECISION for build:** confirm
    whether "Draft" bucket includes `New`/`In Progress` or only literal `Draft`. Default: **Draft-bucket
    = {Draft, New, In Progress}** (everything pre-Sent), so buckets partition cleanly.
  - `Sent` = {Sent, Viewed, Approved Internally}; `Sold` = {Signed, Sold}; `Lost` = {Lost}.
- **Data — Needs-Attention (opened tracking):** the proposals query must join `proposal_recipients`
  (fields `viewed_at`, `role`). Load pattern: fetch proposals, fetch recipients, join in JS (mirror the
  existing embedded-array approach used in `followUp.js:263`). ⚠️ **Confidence: DERIVED** — verify the
  recipients load is paginated (PostgREST 1000-row cap) and covers all proposals.
- `$ potential` = Σ `total` of the drafts + no-response buckets (define precisely at build).

### 3.3 Invoices — `src/pages/Invoices.jsx`
- Invoices already imports `StatCard` and shows a KPI header — **extend/replace** that header to the
  this-month row; add the Needs-Attention row. Do NOT add a second competing KPI block.
- **Data (this-month flows):**
  - `Drafted` = status draft/new AND `created_at` in current month.
  - `Invoiced` = sent (status ≠ draft) AND `sent_at` in current month.
  - `Collected` = status Paid AND `paid_at` in current month.
  - Needs-Attention: `Overdue` (`due_date` < today, unpaid), `Due this week` (due within 7d, unpaid),
    `Awaiting retention` (pay-app retention held), `Paid this month`.
- ⚠️ **Confidence: BLOCKED-until-verified** — the exact invoice column names (`sent_at`, `paid_at`,
  `due_date`, retention field) were **not** confirmed against live schema in exploration. **First build
  step for this screen: read `Invoices.jsx` + live `invoices` schema and confirm every field** before
  writing counts. Do not assume.

---

## 4. Workstream 2 — Retire Sales Dash + reparent to Home

### 4.1 Remove Sales Dash
- `src/App.jsx:41` — delete the `{ id: "dashboard", label: "Sales Dash", … }` NAV entry.
- `src/App.jsx:246` — delete the `/dashboard` route.
- Delete `src/pages/SalesDash.jsx` **after** its two assets are extracted (§4.2) and boundary items
  resolved (§8). Grep for any other `/dashboard`, `SalesDash`, or `id: "dashboard"` references and clean.

### 4.2 Extract Cash Flow + Analytics into standalone manager-only pages
Both currently live as inline modals in `SalesDash.jsx`:
- **CashFlowModal** (`SalesDash.jsx:289–393`) — reads a `forecastData` array built by the SalesDash
  effect (`:153–187`, queries `proposal_wtc` → proposals/call_log/customers, maps WTC `end_date` to
  invoice month and payment month via `customers.billing_terms`). **Extraction: MEDIUM** — move the
  forecast query into the new page's own loader; modal body becomes the page body.
- **AnalyticsModal** (`SalesDash.jsx:396–662`) — **self-contained**, fetches its own data in a `useEffect`
  (`:411–426`: work_types, team_members, proposal_wtc, invoices) with its own rep/work-type/date
  filters. **Extraction: MEDIUM** — lift effect + local state into the new page as-is.

Create:
- `src/pages/CashFlow.jsx` (route `/cash-flow`) — forecast page.
- `src/pages/Analytics.jsx` (route `/analytics`) — analytics page.
- Both breadcrumb as `HOME › CASH FLOW FORECAST` / `HOME › ANALYTICS` (matches mockup).
- The Analytics page **retains its own rep filter**, so the manager "view by rep" capability that lived
  on SalesDash is preserved. Cash Flow is company-wide (no rep filter needed).

### 4.3 Home manager entry cards
- `src/pages/Home.jsx:42` — add `displayRole` to the signature (App.jsx already passes it at `:245`).
- Insert a **manager-only** block (`displayRole === "Manager"` — see §6 for exact predicate) between
  Box 3 (Crew Runway / Goal Thermometer, ends ~`:232`) and Box 4 (Your Book, ~`:235`).
- Two cards ("Company Cash Flow", "Analytics") in a grid matching the existing Box-3 card pattern
  (`C.linenCard` bg, `R.card` radius, `SP.lg` gap), each `navigate()`-ing to its sub-page.
- Import `StatCard`/`SectionHeader` if used; cards may be simple entry tiles (label + one-line hook +
  chevron), not live data — keeps Home fast (per Option A).

### 4.4 Role gating for the sub-routes
- Add `/cash-flow` and `/analytics` routes using the **existing component-level 403 pattern**
  (`App.jsx:255`, the Managers route): `element={ROLE_OK ? <CashFlow/> : <Placeholder label="Cash Flow"/>}`.
- No NAV entries for these (they're reached only via Home cards).

---

## 5. Data-layer notes (cross-cutting)

- **Pagination:** every new aggregate that fetches rows to count/sum must use the paginated `fetchAll`
  helper or `.range()` — PostgREST caps at 1000 rows and several of these tables exceed that. Naive
  single fetches will undercount silently. (Known repo footgun — audit will check.)
- **Reuse over new helpers:** stage-count and forecast logic already exist in `SalesDash.jsx`. Extract
  the reusable computation rather than writing drifting twins; if a canonical function needs extra
  numbers, extend its return.
- **Amount source of truth:** confirm which field is the canonical job/proposal dollar amount before
  wiring the Call Log `$ open` / `$ sold` figures (proposal `total` vs a WTC-summed value).

---

## 6. Role model

- Role comes from `team_members.role`; surfaced app-wide as `displayRole`
  (`App.jsx:209–216`); values: `Admin`, `Manager`, `Sales Rep`, fallback `Member`.
- **Predicate decision:** Sales Dash today is gated to `["Admin","Manager"]`. Cash Flow + Analytics are
  company financials → **gate to `["Admin","Manager"]`** (Admin retains access; only Sales Rep/Member are
  blocked). Use one shared predicate constant, not scattered string checks.
- Reps (and Member fallback) get: no Home cards, no nav entry, and a `Placeholder` on direct navigation.

---

## 7. UI / layout spec (UI-first-class)

- All three refreshed screens: stat row is a responsive grid of `StatCard`
  (`repeat(auto-fit, minmax(...))`, `SP.lg` gap), under a `SectionHeader`. Dollar values use `fmt$`.
  Trend arrows and $ badges follow the mockup + token rules (dark badge, teal text).
- Needs-Attention cards reuse the mockup's colored-icon treatment (red overdue, amber due-soon, purple
  retention/potential, green paid) — map to `C.red/amber/…` tokens, no raw hex.
- Home manager cards match Box-3 card styling exactly.
- Sub-pages (Cash Flow, Analytics) keep the existing modal visuals, now as full pages with breadcrumb.
- **Build ends with an in-browser verify** against these mockups on a preview deploy (per discipline),
  checking: no white surfaces, teal-on-dark badges, and that rep login sees none of the manager surfaces.

---

## 8. Boundary carry-over — open decisions

Per the "carry items across boundaries" discipline, everything that lives ONLY on Sales Dash must move
or be explicitly closed — nothing rides along unowned:

| Sales Dash asset | Disposition | Status |
|---|---|---|
| Cash Flow modal | → `/cash-flow` page (§4.2) | Planned |
| Analytics modal | → `/analytics` page (§4.2) | Planned |
| Pipeline stage StatCards | → Call Log stat row (§3.1) | Planned |
| Per-rep filtering | → Call Log FilterBar (pipeline) + Analytics page rep filter | Preserved |
| **GoalCard scorecard** (Monthly Billings, Yearly Sales, Conversion Rate, Proposals Sent — `SalesDash.jsx:15–56`) | **Drop** — dies with Sales Dash | Resolved (Chris, 2026-08-22) |

**RESOLVED — GoalCard:** Drop the 4-metric scorecard entirely; it dies with Sales Dash. Home already
covers the monthly goal (GoalThermometer), and the other three metrics (yearly sales, conversion rate,
proposals sent) are not being relocated. Delete the `GoalCard` component and its `GOALS` state along
with `SalesDash.jsx`; do not extract it.

**Deferred (not this build):**
- Add **Yearly Sales** back onto the Home screen later (Chris intends to; explicitly out of scope here).
- Confirm whether the "New Inquiry" call_log stage is dead and remove if so.

---

## 9. Build sequence

1. **Branch already cut:** `feat/screen-refresh-dash-retire`.
2. **Verify schema** for Invoices fields + proposal amount source (§3.3, §5) — read before writing.
3. **WS1 aesthetic** in isolation, one screen at a time: Call Log → Proposals → Invoices. Each: add
   stat row, wire data (paginated), in-browser check. Commit per screen.
4. **WS2 extract** Cash Flow + Analytics into standalone manager-only pages; verify they render with
   real data and 403 for a rep. Commit.
5. **WS2 Home cards** + `displayRole` wiring; verify manager sees cards, rep does not. Commit.
6. **Resolve GoalCard** open decision (§8), then delete `SalesDash.jsx` + nav + route; grep clean. Commit.
7. **Preview deploy** + full in-browser verify (manager AND rep login). Then buildvsplan → code-review →
   security-review in their own cold terminals before merge.

---

## 10. Risks & confidence

- **DERIVED / verify-at-build:** Call Log `$ open`/`$ sold` join; Proposals Draft-bucket composition;
  Proposals recipients pagination.
- **BLOCKED-until-verified:** Invoices column names (`sent_at`/`paid_at`/`due_date`/retention). Read live
  schema first; do not assume.
- **Security-sensitive:** the rep-facing 403 on `/cash-flow` and `/analytics` — company financials must
  not leak to Sales Rep/Member via direct URL. This is the highest-stakes item; verify by logging in as a
  rep, not just by reading the guard.
- **Regression:** deleting SalesDash must not orphan a link/import; grep-sweep required.
- **Design drift:** stat rows must match the ratified decisions in §2 (which override the raw mockups).

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-22. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Medium-size change that's mostly cosmetic (three screens get the new Home look) plus one
money-and-privacy-sensitive move: cash-flow and analytics get pulled off the retired Sales Dash and
must stay invisible to sales reps. Three reviewers — one on the numbers/queries, one on the
"reps-can't-see-company-financials" gate, one making sure nothing breaks when the old Sales Dash screen
is deleted. Normal check, not a deep one.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: `fe096dd` (content); manifest added this commit
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: no prior rounds to avoid. Attack the whole plan revision.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding not live
- **Prod / staging / dev**: live in prod (scmybiz.com); the three refreshed screens are the running app.
  Cash Flow + Analytics are currently manager-gated behind Sales Dash.
- **Blocking feature flags**: none on this surface
- **Concurrency profile**: solo / low (≤5)

Agents weight severity against these. Cross-tenant findings cap at Med while `live_tenants == 1`;
multi-user race findings cap at Low while solo. **Exception — do NOT down-cap the rep-facing financial
leak:** company cash-flow/analytics leaking to a Sales Rep is a real single-tenant exposure (HDSP's own
reps), so a broken `/cash-flow`·`/analytics` 403 is legitimately High, not capped.

### Time budget + finding cap
- **Time budget**: 120 min
- **Finding cap**: 12 findings

Synthesis surfaces only the top-12 most consequential findings; remainder go to "Quarantined findings
(not actionable this loop)."

### Surface
- Total lines: 311 (pre-manifest, revision fe096dd)
- Sections: 11 (§0–§10) + manifest
- [LOCKED] decisions: 4 (§2.1–2.4 — ratified in ideate; not literally tagged, but locked)
- [DESIGN-OPEN] items: 0
- [OPEN] items: 0 (GoalCard resolved to drop; 2 items explicitly deferred out of scope)
- Plan-to-code ratio: ~311 plan : ~500–700 est code ≈ 0.5:1 (well under the 50:1 scope-creep flag)

### Layers touched
- UI / components (stat rows on 3 screens, 2 Home cards, 2 extracted pages)
- Data layer (new count/sum aggregates, proposal_recipients join)
- RLS / auth / multi-tenancy (route-level role gating — authorization, not RLS)
- Edge functions / API routes (2 new client routes: `/cash-flow`, `/analytics`)
- Performance / pagination (new aggregates must use paginated `fetchAll`)

### New mechanisms introduced
- New routes: `/cash-flow`, `/analytics`
- New page components: `CashFlow.jsx`, `Analytics.jsx` (extracted from SalesDash modals)
- New aggregate computations: Call Log `$ open`/`$ sold`; Proposals status-bucket + opened counts;
  Invoices this-month flow counts
- New shared role predicate constant (manager/admin gate)
- New columns / tables / triggers / RLS policies / cron / webhooks: none

### Cross-system reach
none — read-only display. Shared Supabase DB with Schedule/Field, but this change adds no schema, no
cross-repo write, and no service-role/bypass path.

### Irreversibility
none — all changes reversible (UI/route/component only; SalesDash deletion recoverable via git; no
migrations, backfills, or public API changes).

### Known weak points
- **Rep-facing financial leak (highest stakes, §4.4/§6):** `/cash-flow` + `/analytics` must 403 for Sales
  Rep/Member on direct URL, not just hide nav. Verify by role, not by reading the guard.
- **Invoices schema reality (§3.3):** per CLAUDE.md the `invoices` table has `sent_at`, `paid_at`,
  `due_date` — but **no `created_at`** and **no retention column**. So "Drafted this month" cannot key off
  `created_at` as the plan sketches, and "Awaiting retention" must derive from the pay-app/billing_schedule
  source, not `invoices`. The plan's "BLOCKED-until-verified" tag understates this — the fields are
  knowable and two are wrong.
- **Call Log `$` amount source (§3.1):** plan proposes summing `proposals.total`, but CLAUDE.md Data
  Integrity Rule #2 says proposal money must come from live WTC via `calcWtcPrice()` — `proposals.total`
  can be stale. Reconcile before wiring.
- **Pagination undercount (§5):** new count/sum fetches over `proposals`/`proposal_recipients`/`call_log`
  can exceed PostgREST's 1000-row cap; must use `supabaseHelpers.fetchAll`. Silent undercount if not.
- **Proposal status-bucket exhaustiveness (§3.2):** confirm every real status maps into exactly one of
  {All, Draft, Sent, Sold, Lost} with none dropped.
- **SalesDash deletion regressions (§8):** GoalCard/`GOALS` and any SalesDash-only view must be accounted
  for; grep for dangling `SalesDash` / `/dashboard` / `id:"dashboard"` refs.

### Open questions
- Count: 0 (all §8 decisions resolved; yearly-sales-on-Home and New-Inquiry-dead-check deferred, §1/§8)
- Highest-pressure: none open — flag if an agent believes a "resolved" item is actually still open.

### Suggested attack angles (3 total)
1. **Data & aggregation correctness** — covers Data layer + Performance/pagination. Required reading:
   `CallLog.jsx`, `Proposals.jsx`, `Invoices.jsx`, `SalesDash.jsx`, `lib/supabaseHelpers.js`, CLAUDE.md
   schema + Data Integrity Rules. Pressure: invoices `created_at`/retention gaps; `calcWtcPrice` vs
   `proposals.total`; status-bucket exhaustiveness; opened-tracking logic; pagination undercount.
2. **Role gating & financial-data leak** — covers RLS/auth + new routes. Required reading: `App.jsx`
   (NAV + routes + `displayRole`), `Home.jsx`, SalesDash gating. Pressure: Sales Rep/Member blocked on
   direct URL to `/cash-flow` + `/analytics`; no leftover `/dashboard`; Home cards gated + no data fetched
   for reps; single shared predicate, not scattered string checks.
3. **Boundary carry-over, regression & design-baseline** — covers UI/components + deletion. Required
   reading: `SalesDash.jsx`, `App.jsx`, grep for SalesDash/dashboard refs, `tokens.js`/`StatCard`/
   `SectionHeader`. Pressure: nothing lost on SalesDash deletion (GoalCard/`GOALS`); dangling refs; token
   reuse (no white bg, teal-on-dark badges, no bespoke twins); stat rows match ratified §2.

### Suggested agent count: 3

Rationale: three coherent attack surfaces (data, auth-leak, boundary/design); novel mechanisms present but
cross-system reach is empty and open questions are zero, so 3 not 4.
