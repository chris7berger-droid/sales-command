# Plan — Subcon Command Home (executive command center)

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PARKED (scaffolded 2026-09-05) — not yet planned. Next: ID8 (ideate) → T6 build.

**Migrations:** none expected. This is a read-only summary/launch surface that reuses existing module queries. No DDL → no shared-DB collision with the live sales/schedule builds. Confirm during planning; if any KPI needs an upstream aggregate that requires DDL, flag it before writing a migration.

**Design source:** mockup at `~/Downloads/ChatGPT Image Sep 5, 2026, 02_19_29 PM.png` (executive dashboard: 4 command cards + Company Snapshot + Needs Attention + What's Happening). Treat as a **guide, not gospel** (Chris) — evolve the existing `src/pages/SubconHome.jsx` toward it, don't rebuild from scratch.

---

## §0 Baseline (observed current state) [read-verified 2026-09-05]
Current home: `src/pages/SubconHome.jsx` (route `/`). Renders one nav-quadrant card per *visible* app group via `groupVisible` (same predicate as sidebar) — deliberately no data wiring, no fake tiles (§1j comment). Plain/boring (Chris). Shell/nav: `src/lib/nav.js`, `src/components/AppSidebar.jsx`, `src/components/Logo.jsx`.

**CRITICAL — not cross-repo.** All four commands are already mounted INSIDE sales-command: `nav.js` `AVAILABLE_APPS = ["sales","schedule","field","ar"]`, with embedded modules `src/schedule/`, `src/field/`, `src/ar/`. The standalone repos (`~/sch-command`, `~/field-command`, `~/AR-Command-Center`) are the pre-consolidation sources — read the EMBEDDED modules, not those.

KPI source inventory (read-verified against the embedded code):
- **Sales — live.** Active leads / hot opps / potential revenue: `src/lib/followUp.js` (`pipelineStats`, `digSummary`, `OWED_STAGES`, non-archived filter). Billed YTD: `src/pages/Managers.jsx` (approved_at-bucketed). Avg Margin: per-WTC via `calc.js` (`calcWtcBreakdown`) — no closed-jobs-YTD rollup yet (buildable, sales-owned). Jobs YTD: no counter yet (buildable, sales-owned).
- **Schedule — live.** `src/schedule/lib/queries.js` `computeHomeDashboard(...)` + `src/schedule/lib/billingForecast.js` `buildBillingSurface(...)` already return: crew capacity %, jobs assigned (distinct, multi-day=1, allocations excluded), Scheduled Work $ (next-30-day contract value), Ready to Bill $, needCrews/conflicts/notReady/goBacksCount, productionPct. `src/schedule/views/Home.jsx` renders all of it. Recent activity from `job_changes` table.
- **Field — data not flowing yet.** `src/field/views/*` query real tables but daily logs / production reports (DPRs) that drive On-Track % and Need-Attention aren't populated until the Field mobile app ships. Precedent: Schedule Home's Margin slot already coming-soons "once Field Command DPRs are flowing." Jobs-In-Progress IS derivable now from schedule job status.
- **AR — prototype.** `src/ar/*` runs off a manual QuickBooks-export upload (`src/ar/lib/ARContext.jsx`, `arStore.js`), NOT the live `invoices` table. Outstanding AR + Open Invoices ARE derivable now from the live `invoices` table (active = not deleted/voided/paid); Expected-cash forecast doesn't exist.

Existing "coming soon" pattern to match: `src/pages/Home.jsx:199` (Crew Runway) and `src/schedule/views/Home.jsx:331` (Margin slot). Performance: reuse each module's existing calc, fetch summaries in parallel, never re-download raw rows to total on Home.

## ID8 decisions (locked 2026-09-05)
- **Beat 1 — build philosophy [LOCKED]:** Build the full scaffold now (4 cards + Company Snapshot + Needs Attention + What's Happening); wire every cell; not-yet-live sources render a "Coming soon" slot already wired for plug-in. No scope-cutting. Ref memory `feedback_coming_soon_scaffold`.
- **Beat 2 — Field & AR treatment [LOCKED = Option A]:** Light what's real, coming-soon only the specific unbacked cells. Live now: Sales (all), Schedule (all), Field Jobs-In-Progress, AR Outstanding AR + Open Invoices, Company Snapshot (Billed YTD, Active Crews; Avg-Margin-closed + Jobs-YTD to be built, sales-owned). "Coming soon": Field On-Track % + Need-Attention, AR Expected-this-month.
- **Beat 3a — Welcome hero [LOCKED]:** KEEP the photographic hero band from the mockup (construction-sunset photo + "Welcome to SubCon Command" + tagline + three value-props + "Build smarter. Run stronger." quote card). Needs a hero image asset. Photo band sits above "Your Command Center".
- **Beat 3b — What's Happening source [LOCKED]:** Compose the v1 feed from live sources — Schedule `job_changes`, proposal sends, invoice issued / payment received (`invoices`), job stage moves. Field events (job started, production completed) wear "Coming soon" until DPRs flow. Default This Week, ~5 events, View All.
- **Beat 3c — Trend arrows [LOCKED]:** Omit week-over-week % trends for v1 (no historical snapshots; spec §9 = don't fake). Show a trend chip ONLY when it's a real live count (e.g. "3 new leads this week"), never a computed delta.

**ID8 status: COMPLETE (2026-09-05).** Ready for T6 build.

## §1 Problem / intent [LOCKED]
The Subcon Command home is the company-level executive command center. Give management a fast cross-command read (Sales / Schedule / Field / AR) + a launch surface to drill into each module. It is NOT another operational workspace — Home identifies; the Commands handle. Current home is plain and needs to become the richer dashboard in the mockup, reusing existing logic.

## §2 Proposed change [LOCKED via ID8]
Rebuild `SubconHome.jsx` into: (0) photographic welcome hero [beat 3a], (1) FOUR command cards with live KPIs — light-what's-real, coming-soon the unbacked cells [beat 2], (2) Company Snapshot, (3) Needs Attention, (4) What's Happening [beat 3b]. No fake trend deltas [beat 3c]. Full display + wiring spec below.

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

## §3 Files to touch [DERIVED — confirm exact reuse when building]
- **`src/pages/SubconHome.jsx`** — full rewrite into the dashboard (hero + 4 cards + snapshot + attention + activity). Keep the `groupVisible` gating so a tenant/member without an app still degrades gracefully.
- **New `src/lib/subconSummary.js`** (thin) — one loader that fetches all card summaries in PARALLEL and REUSES existing calcs; no raw-row re-download. Reuse:
  - Sales: `pipelineStats` / `digSummary` from `src/lib/followUp.js`; Billed-YTD logic from `src/pages/Managers.jsx` (extract if needed, don't duplicate); margin via `src/lib/calc.js`.
  - Schedule: import `computeHomeDashboard` + loaders (`loadJobs`, `loadBillingSurfaceData`, etc.) from `src/schedule/lib/queries.js` and `buildBillingSurface` from `src/schedule/lib/billingForecast.js` — these already produce crew/jobs/scheduled-$/needs-attention. Map their outputs to the card KPIs.
  - AR-live: query `invoices` directly for Outstanding AR + Open Invoices (active = not deleted/voided/paid) — do NOT go through the QB-import `ARContext`.
  - New sales-owned calcs: Avg-Margin-closed-YTD, Jobs-YTD (build here; small).
- **New card/primitive components** — KPI card, stat cell, `ComingSoonSlot`, needs-attention row, activity row, company-snapshot tile, hero band. Match tokens (`src/lib/tokens.js`) + style rules (linen bg, teal-on-dark badges). Reuse existing "coming soon" pattern from `src/pages/Home.jsx:199`.
- **Hero image asset** — add under `src/assets/` (or `public/`); construction-sunset per mockup.
- Drill-downs via `navigate()` to existing filtered routes (`/sales/calllog`, `/schedule/jobs`, `/ar/invoices`, each command home).

## §4 Out of scope / deferred
- No new operational workflows on Home (launch surface only — Home identifies, Commands handle).
- No migrations (read-only summary UI). If a KPI turns out to need an upstream aggregate, STOP and flag before writing DDL (shared DB, live Sales/Schedule builds in flight).
- Week-over-week % trend deltas — deferred until historical snapshots exist [beat 3c].
- Field On-Track %/Need-Attention + AR Expected-this-month — wired "Coming soon" slots now; plug in when Field DPRs flow / AR goes live off `invoices`.
- Don't add dashboard content just because data exists (design-priority discipline, spec §15).

## §5 Estimate / time budget [DERIVED]
Half-day to a day: most numbers already computed (Schedule `computeHomeDashboard`, Sales pipeline). Real work is the layout/components, the two small sales-owned calcs (Jobs-YTD, Avg-Margin-closed), the AR-live invoice query, and the coming-soon wiring. Build ends with an in-browser verify against the design system (memory `feedback_ui_first_class`) + a check that no cell shows a loading-0.
