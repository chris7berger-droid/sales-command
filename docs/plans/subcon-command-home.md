# Plan — Subcon Command Home (executive command center)

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PARKED (scaffolded 2026-09-05) — not yet planned. Next: ID8 (ideate) → T6 build.

**Migrations:** none expected. This is a read-only summary/launch surface that reuses existing module queries. No DDL → no shared-DB collision with the live sales/schedule builds. Confirm during planning; if any KPI needs an upstream aggregate that requires DDL, flag it before writing a migration.

**Design source:** mockup at `~/Downloads/ChatGPT Image Sep 5, 2026, 02_19_29 PM.png` (executive dashboard: 4 command cards + Company Snapshot + Needs Attention + What's Happening). Treat as a **guide, not gospel** (Chris) — evolve the existing `src/pages/SubconHome.jsx` toward it, don't rebuild from scratch.

---

## §0 Baseline (observed current state) [TODO — verify before planning]
Current home: `src/pages/SubconHome.jsx` (route `/`, "Your command center. Pick an app to get to work."). Renders one quadrant card per app group — currently plain/boring (Chris: "those two cards are just boring and plain"). Shell/nav: `src/lib/nav.js`, `src/components/AppSidebar.jsx`, `src/components/Logo.jsx`.

**Before planning, inventory the EXISTING source of every KPI below** (design-baseline check — do not invent logic that already exists):
- Sales: active-stage / hot-opportunity / pipeline-revenue logic in Call Log (`src/pages/CallLog.jsx`) + queries layer.
- Schedule: crew availability, jobs-assigned-this-week, scheduled-to-bill forecast — `~/sch-command` finance/billing forecast (see memory: Billing Forecast Integration, SOV/billing schedule).
- Field: jobs-in-progress, Production Rate Tracker on-track %, field exceptions — `~/field-command`.
- AR: outstanding AR, open invoices, expected-this-month collections — `~/AR-Command-Center`.
- Company: Billed YTD, avg margin (CLOSED jobs), jobs YTD, active crews.

Cross-repo note: this shell lives in `sales-command` but pulls from schedule/field/AR domains over the shared Supabase DB (ref pbgvgjjuhnpsumnowuym). Determine per-KPI whether a live query/RPC already exists vs. must be built. Prefer existing aggregate queries; fetch summaries in parallel; do NOT pull hundreds of raw rows to total a few numbers.

## §1 Problem / intent [LOCKED]
The Subcon Command home is the company-level executive command center. Give management a fast cross-command read (Sales / Schedule / Field / AR) + a launch surface to drill into each module. It is NOT another operational workspace — Home identifies; the Commands handle. Current home is plain and needs to become the richer dashboard in the mockup, reusing existing logic.

## §2 Proposed change [DESIGN-OPEN — settle in ID8]
Rebuild `SubconHome.jsx` into: (1) FOUR command cards with live KPIs, (2) Company Snapshot, (3) Needs Attention, (4) What's Happening. Full display + wiring spec below.

### Card 1 — SALES COMMAND ("Fill the pipeline")
- **Active Leads** — count active sales opportunities (existing Call Log active-stage logic).
- **Hot Opportunities** — high-priority/attention opportunities (reuse Call Log priority/attention logic).
- **Potential Revenue** — sum active-pipeline potential revenue (exclude sold/lost/archived unless existing pipeline logic includes them).
- Enter → Sales Command Home. Quick links: Call Log, Proposals, Customers. Metrics clickable → filtered records.

### Card 2 — SCHEDULE COMMAND ("Plan the work")
- **Crew Available** — current-week crew/employee availability (existing Schedule availability logic).
- **Jobs Assigned** — distinct jobs scheduled this week. **Multi-day job = ONE job. Allocation ≠ new mobilization.**
- **Scheduled to Bill** — $ expected to become billable THIS MONTH (existing Schedule finance/billing forecast). This is FUTURE EXPECTED BILLING, not AR.
- Enter → Schedule Command Home. Quick links: Jobs, Crew Schedule, Calendar.

### Card 3 — FIELD COMMAND ("Execute the work")
- **Jobs In Progress** — production started, not complete.
- **On Track %** — % of applicable active/reporting jobs meeting production target (Production Rate Tracker). Don't invent when data insufficient → show "—" / "Not enough data".
- **Need Attention** — active field jobs with real execution exceptions (behind target, missing daily logs, go-backs, other existing field exceptions).
- Enter → Field Command Home. Quick links: Daily Logs, Production Rate, Photos/Reports.

### Card 4 — AR COMMAND ("Get paid")
- **Outstanding AR** — total open A/R.
- **Open Invoices** — count of invoices with outstanding balance.
- **Expected This Month** — expected cash collections this month (existing AR/payment forecast). AR ≠ Schedule billing forecast.
- Enter → AR Command Home. Quick links: A/R Aging, Payments, Statements.

### Company Snapshot (keep small)
- **Billed YTD** (existing billing calc) · **Average Margin** = CLOSED jobs YTD (Margin Closed, NOT in-progress) · **Jobs YTD** = distinct jobs in production this year (no workday/allocation double-count) · **Active Crews** = current deployed crews.

### Needs Attention (compact cross-command exception list)
Rows: count · description · severity indicator · click-through with filter applied. Examples: jobs behind schedule, change orders pending approval, invoices >30 days, crew conflicts, jobs behind production target, missing daily logs, go-backs. Home identifies; does NOT resolve.

### What's Happening (lightweight activity feed)
Meaningful business events only (job→Completed, proposal sent, job scheduled/started, production completed, go-back created, major crew reassignment, invoice issued, payment received). Default THIS WEEK, ~4–6 events, VIEW ALL. Not every DB change.

### Cross-cutting rules
- **Time periods** (don't force one period): Leads/Hot/Pipeline = current · Crew/Jobs-assigned = current week · Scheduled-to-bill/Expected-cash = current month · Field = current active · Billed/Margin/Jobs = YTD · Active Crews = current.
- **Trend indicators** (↑12%, ↑3 this week): show ONLY with real comparison data. Never manufacture to match mockup — omit if unavailable.
- **Loading/empty states:** skeletons while loading (never a temporary 0) · true zero → 0 · no applicable data → — · insufficient calc data → "Not enough data".
- **Performance:** conceptual summaries (Sales/Schedule/Field/AR/Company/Attention/Activity) fetched in PARALLEL; reuse existing aggregate endpoints; don't download raw rows to total in React.
- **Drill-down:** actionable metrics link to filtered records (Hot Opps→filtered Call Log, Jobs Assigned→Schedule jobs, Need Attention→Field jobs, Open Invoices→AR list, etc.).
- **Responsive:** desktop 4-across → medium 2×2 → mobile 1-per-row; Snapshot/Attention/Happening stack on small screens.
- **Design priority (hierarchy):** 1) Four Commands (where do I go) 2) Company Snapshot (how are we doing) 3) Needs Attention (what's wrong) 4) What's Happening (what changed). Keep it clean/calm/high-level — not an operational workspace.

### Business rules (LOCKED)
- JOB ≠ SCHEDULED DAY (multi-day = one job).
- MOBILIZATION ≠ ALLOCATION (allocations aren't extra sold mobilizations).
- SCHEDULED BILLING ≠ AR.
- MARGIN IN PROGRESS ≠ MARGIN CLOSED (headline avg margin uses CLOSED).

## §3 Files to touch [TODO]
Primary: `src/pages/SubconHome.jsx`. Likely: a summary data layer (new `src/lib/` hooks/queries or reuse of existing per-module queries), shared KPI-card/stat components. Confirm during planning after §0 inventory.

## §4 Out of scope / deferred [TODO]
- No new operational workflows on Home (launch surface only).
- No migrations unless a KPI provably requires an upstream aggregate (flag first).
- Do not add dashboard content just because data exists (design priority discipline).

## §5 Estimate / time budget [TODO — set at ID8/plan]
