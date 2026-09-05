# Schedule Command Re-skin — Ideate Summary (vision, locked)

- **Repo:** sales-command (Schedule Command is a driver here, under `src/schedule/`)
- **Branch:** `feat/schedule-reskin`
- **Date:** 2026-09-04
- **Status:** IDEATE COMPLETE — ready for a PLAN session. No code written, no plan steps yet.
- **Origin:** Ideate conversation with Chris off two inspiration mockups (Home + Jobs, dark; Finance/Billing, linen). Mockups are DIRECTION, not literal — "vibe, adapt."

## Confidence legend
- **[LOCKED]** — Chris ratified this in ideate. Do not renegotiate.
- **[DERIVED]** — established by reading the current code this session.
- **[DESIGN-OPEN]** — deliberately left for the plan session to resolve.

---

## The vision (what we're building)

### Screen skeleton [LOCKED]
- **Old Home → becomes the new Jobs screen.** Same guts, repainted. This is HOW we keep every function — we relabel + repaint the screen that already has the working rows, we do not rebuild Jobs from scratch.
- **New Home** = built fresh as a pure high-level dashboard ("how are operations doing"). No working rows.
- **Old Jobs screen → retired.**
- **Finance / Billing** = new money screen (see below).
- **Everything else stays:** Crew Schedule, Calendar, Daily, Materials, Production Rate.

### Hard rule [LOCKED]
**Nothing gets dropped in the repaint.** The mockups are the *look*, not the *feature list*. Every function in the current rows/cards carries over.

### Theme [LOCKED — Option A]
- Keep the **linen page + creamy cards + dark sidebar + near-black "hero" cards + teal (#30cfac) pop** the app already uses.
- The all-dark Home/Jobs mockups = read as "make the hero cards pop," NOT "paint the whole page black."
- This is already the current theme (`src/schedule/index.css`: `--bg:#e7decb`, `--bg-card:#f3ede0`, near-black `--panel-dark:#111110`, teal accent). The Finance/Billing mockup already matches today's look. Stays on-brand + consistent with Sales/AR (linen is a core brand element).

### Nav / menu [LOCKED]
- Current routes (`src/schedule/ScheduleLayout.jsx`): home, jobs, jobs/:jobId, schedule (crew), billing, billing/forecast, materials, calendar, daily, schedules, production-rate, budget, settings, import.
- **Rename "Billing" → "Finance / Billing"**, and it becomes the one money screen.
- **Fold the separate Forecast and Budget screens INTO Finance/Billing** — three money screens become one.
- Mockup's "Logistics" = the existing **Materials/warehouse** screen; "Production Rate" already exists. Nothing new to add there.

---

## Finance / Billing screen — contents

### A. The worklist [LOCKED]
Replaces today's 4-card drill-in picker with **ONE list view.**
- **The 4 old card titles become row STATUSES:** Ready to Bill / Partially Billed / Billed Complete / Pay Apps. No cards, no drilling — one list, each row wears its status.
- **Filter bar** on the list (same shared FilterBar pattern used on the Sales side; **Status** is the only new filter to add):
  - Status · Work type · Date · Customer · Job # · Salesperson
- **Keep on the list:** Total to Bill (as a header number), Go Backs (as a flag/filter).
- **Keep per job (must survive the repaint):** status + billing badge (Deposit Due / Needs Final Bill / Partially Billed / Needs Review / Fully Billed) + "held — do not invoice"; Contract / Billed / Remaining; expand → invoices sent (X of Y) + which ones with amounts; editable billing notes; mark as Go Back; click through to open the job in Sales Command to invoice.

[DERIVED] Current implementation lives in:
- `src/schedule/views/Billing.jsx` (worklist shell)
- `src/schedule/components/BillingPicker.jsx` (the 4-card picker → to be replaced by the list)
- `src/schedule/components/BillingCard.jsx` (per-job billing card → its content becomes a list row + expand)
- `src/schedule/lib/billingForecast.js` — `BILLING_CARDS` (the 4 stages), `billingCardKey()`, `billingBadge()`, `buildBillingSurface()`, `authoritativeTotal()`, `billedTotal()`.

[DERIVED] Architecture truth to hold onto: this whole area is a **worklist / visibility layer.** It READS Sales invoices/proposals (via shared `call_log`) and shows what's owed; it only WRITES back `billing_worklist` flags + notes. Actual invoicing still happens in Sales Command. Finance/Billing does not create invoices.

### B. The dashboard cards
Traffic-lighted by "can we power it today?"

**🟢 Powerable now [DERIVED]:**
- Billing totals — this week / month / quarter / year (from sent invoices; `sent_at` + `amount`).
- Contract / Billed / Remaining, and Total to Bill (already computed in `billingForecast.js`).
- Cash-flow forecast — "when money lands" — already built (`computeForecast`, `expectedPayDate`).
- **Forecast chart** (Billed vs Scheduled-to-Bill vs Contract-Remaining) — powerable via the forecast formula below.

**Forecast formula [LOCKED]:** projected bill/cash date = **the job's end date + that customer's payment terms.**
- Regular jobs → end date (`jobs.scheduled_end`/`end_date`) + customer terms (`customers.billing_terms`, default 30).
- Pay-app jobs → their own billing schedule (already dated).
- Both pieces already on file; a terms-based helper (`expectedPayDate`) already exists to build on.

**🔴 Real build, NOT a repaint — the margin cards [LOCKED model]:**
- Cards: Margin Overview (avg margin, total margin, total billed, vs last month) + Highest / Lowest Margin Jobs.
- **Margin model:** `live margin = contract (incl. change orders) − actual cost (crew hours + materials logged)`.
  - Starting margin comes from the **proposal** (its markup over allocated hours/materials).
  - **Contract goes UP** via change orders (written on the Sales side).
  - **Cost goes UP** when crew log more hours/material than the proposal budgeted (overage) → margin down.
- [DERIVED] Nothing computes margin today. Raw ingredients exist but the calc doesn't:
  - Planned side: proposal WTCs (`proposal_wtc`: markup_pct, burden_rate, regular/ot hours, materials) → Sales `calc.js`.
  - Actual side: **Field Command** `daily_production_reports` (hours_regular, hours_ot, materials_used) + **Schedule** `job_material_lines` / warehouse-adds; Schedule already has a partial cost engine (`computeMobCosts` → material$ + labor$ per mobilization, but on PLANNED qty, not actuals-used).
- **Data-quality caveat [LOCKED]:** margin is only as truthful as crew logging. If crew don't log hours/materials in Field, cost is understated and margin reads too rosy. Margin leans on Field adoption — flag before it becomes a headline number.

---

## Build chunks & sequence [LOCKED intent]

1. **The repaint (chunk 1, plan first).** Paint + move, low risk, ships visible value alone:
   - New Home dashboard
   - Jobs = old Home repainted (keep every row function)
   - Retire old Jobs
   - Finance/Billing worklist: 4 cards → one filtered list; fold in Forecast + Budget; rename nav
   - The 🟢 dashboard cards (billing totals, Contract/Billed/Remaining, cash-flow + forecast chart)
2. **The margin build (chunk 2, its own later plan).** New math: planned margin from proposal + actual cost from crew-logged hours/materials → live margin → Margin Overview + Highest/Lowest Margin jobs. The repaint does NOT wait on this; margin cards slot in when ready.

---

## Open items for the PLAN session [DESIGN-OPEN]
- **First plan step:** inventory exactly what today's Home rows do (`src/schedule/views/Home.jsx` → `JobsToPrepare` + `HomeCapacityStrip`, `HomePanels`) so "keep every function" on the Jobs repaint is a real, itemized checklist — same as we did for the billing worklist above.
- Exact layout of the new Home dashboard (which cards, which of the mockup's Home tiles map to real data).
- Where the retired old-Jobs screen's unique bits (if any) need to land before deletion.
- Margin engine (chunk 2) gets its own plan doc.

## Explicitly NOT done
- No code changes. No plan steps. No branches beyond this doc branch. This file is the ideate artifact / file-as-memory handoff into planning.

---
---

# Chunk 1 Plan (The Repaint) — added 2026-09-04

> PLAN for **chunk 1 only** (repaint + screen split + Finance/Billing consolidation).
> **Margin engine is chunk 2** — a later, separate plan. Ready for `/auditcriteria` → `/runaudit`.

## Confidence legend
- **[LOCKED]** — ratified by Chris (ideate + the Home/Jobs mockup).
- **[DERIVED]** — established by reading current code this session.
- **[DESIGN-OPEN]** — deliberately left for build-time judgment; low-risk.

---

## Context — why this change

Schedule Command's Home and Jobs screens grew organically: today's Home mixes a high-level
dashboard with a working job list, and "Jobs" is a card-picker that drills in. Billing is split
across three screens (Billing worklist, Forecast, Budget). Chris produced a two-screen mockup that
sets the target: a **Home** that answers "how are operations doing" (no working rows) and a
**Jobs** screen where "you dig in and do the work" (capacity + attention panels + the full job
list). Separately, three money screens collapse into one **Finance / Billing**. The whole thing is
repainted onto the linen/cream/black/teal palette the app already uses in places.

**Hard rule [LOCKED]: nothing gets dropped.** The mockups are the *look*; every function in
today's rows/cards/panels carries over. New data is **not** built to feed the repaint — every card
is powered by data already loaded today (confirmed by a data-availability sweep this session). Cards
that lean on crew-logged production read honestly from what's logged now and become fully truthful
once **Field Command** is online (the final data piece).

## Scope

**In (chunk 1):** repaint theme app-wide · new Home dashboard · new Jobs (old Home's working list +
absorbed old-Jobs functions) · retire old Jobs screen · Finance/Billing consolidation (one list +
Forecast + Budget folded in) · nav rename · route redirects.

**Out (chunk 2, later plan):** the margin engine + Margin Overview / Highest-Lowest Margin cards.
Chunk 1 leaves a labeled placeholder slot only.

---

## §0 Baseline — current state (read-verified 2026-09-04)

**Verification method: read-verified** — code + grep this session across three Explore sweeps.
**NOT run-verified** — the app was not launched; in-browser confirmation is deferred to the
build/verify step. Every claim below is evidenced by `file:line` or a grep, not assumed.

- **Home today** (`src/schedule/views/Home.jsx`, ~150 ln) renders `HomeCapacityStrip` +
  `HomePanels` (NeedsAttention / NextUp / AtAGlance) **and** `JobsToPrepare` — a dashboard *and* a
  working job list on one screen. Data from `computeHomeDashboard()` (`src/schedule/lib/queries.js`
  ~1530), which today returns capacityDays / needCrews / conflicts / notReady / jobsScheduled /
  crewAssignmentsCount / completionPct / nextUp.
- **Jobs today** (`src/schedule/views/Jobs.jsx`, ~632 ln): `JobsPicker` (11 count-tiles) → tabbed
  stage drilling (`StagedCardList` / `OnHoldCardList` / `AllJobsList` wrapping `StageJobCard`) +
  **Recovery Bin** modal (~606-629) + a `?tab=` redirect map (~14-20). `StageJobCard` (913 ln) is
  the delete **writer** (~666); `Jobs.jsx restoreJob` (~374-392) is the **only** restore reader.
- **StageJobCard is shared** — imported by `JobsToPrepare` (variant `home-compact`) and the
  `*CardList` wrappers, **not** directly by `Jobs.jsx`. Owns all job-management modals + promote/
  kickoff/resume/delete + budget panel.
- **Billing today**: `views/Billing.jsx` → `BillingPicker.jsx` (4-card picker + drill-in) →
  `BillingCard.jsx` (Hold/GB/Terms/Notes, Admin-gated writes to `billing_worklist`).
  `views/Forecast.jsx` → `BillingForecast.jsx`. `views/Budget.jsx` = 10-line placeholder. All logic
  in `lib/billingForecast.js`. `Billing.jsx` already calls `buildBillingSurface()` returning **both**
  `rows` and `forecast` from one `loadBillingSurfaceData()`.
- **Nav**: defined in `src/lib/nav.js` (~line 31 `label:"Billing"`), rendered by `AppSidebar.jsx`.
  Grep-verified: `billing/forecast` and `budget` have **no** sidebar entries — reached via in-app
  buttons / a dead route only.
- **Theme**: `src/schedule/index.css` — base `.schedule-root` (~1-34) = sandy palette;
  `.schedule-root .home-screen` override (~41-51) **already carries** the linen/cream/black/teal
  target palette. Components consume `var(--x)`; there is **no** schedule JS tokens file (Sales uses
  `src/lib/tokens.js`).
- **Data availability for the new Home cards** (read-verified this session): every proposed card maps
  to **already-loaded** data — `computeHomeDashboard`, `buildBillingSurface` / `billedTotal` /
  `authoritativeTotal`, `loadPRTsForCallLogIds` (PRT `tasks[].target_pct/actual_pct`),
  `job_mobilizations.is_go_back`, and the `job_changes` audit table. **No card needs a new table,
  column, or fetch.** Confirmed gaps: some activity event types (PRT-submitted, crew-reassigned) are
  not yet written to `job_changes`; `daily_production_reports` has no due-date field (Milestones
  infers it from `scheduled_end`). These are rendered-as-available, not built, in chunk 1.

---

## The two mockup screens (what they dictate) [LOCKED]

| | **HOME** — "how are operations doing" | **JOBS** — "where you dig in and do the work" |
|---|---|---|
| Purpose | High-level, **no working job rows** | The working surface |
| Top | 5 KPI hero cards | Stage tabs (All/Staged/Ready/Active/On Hold/Completed) + **Weekly Crew Capacity** strip |
| Mid | Scheduled Workload chart + At-a-Glance | 4 panels: **Needs Attention · Go-Backs · Next Up · At-a-Glance** |
| Lower | Where-management-needs-to-look + Recent Activity + Upcoming Milestones | Filter bar + **full job list** + pagination |

The Jobs caption is explicit: *"Includes capacity, needs attention, go-backs, next up, and the full
job list."* So the crew-capacity strip + the four panels — which live on **today's Home** — move to
**Jobs**. The new Home is a genuinely fresh dashboard.

---

## Screen 1 — New Home (`src/schedule/views/Home.jsx`, rewritten in place)

Fresh operations dashboard. **No `JobsToPrepare`, no StageJobCard.** New code is (a) a few
aggregation lines threaded into the **existing** `computeHomeDashboard()` (`src/schedule/lib/queries.js`
~1530) — extend the canonical function, not a twin — and (b) **[R1:B1, ratified Option A]** Home's
`loadData` gains a call to the existing canonical **`loadBillingSurfaceData()` + `buildBillingSurface()`**
(the same loaders `Billing.jsx:28` already uses) so the two money cards show real dollars per the mockup.

**Data discipline [LOCKED, revised R1]:** no new tables, columns, migrations, or **data machinery**.
Reusing an existing canonical loader (`loadBillingSurfaceData`) on Home is allowed — that is reuse,
not the new-mechanism scope-creep Risk 10 guards against. (Supersedes the earlier "no new fetch"
absolute, which collided with the mockup's filled `$428,000` / `$84,200` hero cards.) Cards that
genuinely can't be powered render as labeled placeholders in the mockup's layout, not grown scope.

### KPI hero cards + panels — data traffic-light [DERIVED, corrected R1]
🟢 = powered now · 🟡 = powered now, reads fuller once Field Command is adopted · ⚙ = needs the build-time fix in its tag

| Card | Light | Powered by · build note |
|---|---|---|
| Scheduled Work $ (30d / week / upcoming) | 🟢 | `authoritativeTotal()` over `built.rows`; **[R1:B1]** needs the added Home billing-surface load; window by `jobs.scheduled_start` |
| Ready to Bill $ (jobs / wk) | 🟢 | `built.rows` `remaining`; **[R1:B1]** same added load; window by schedule dates |
| Crew Capacity % (this wk 🟢 · next wk / 2-wk ⚙) | 🟢/⚙ | `computeHomeDashboard().capacityDays[]` gives the current 6-day window only; **[R1:adj]** next-wk / 2-wk need the fn to emit forward windows — add them, or show this-week only at launch |
| Job Readiness % (ready / need attn) | 🟢 | `isReady()` predicate over jobs (add the ready/total rollup) |
| Production % of target (reporting / vs last wk) | 🟡⚙ | `daily_production_reports.tasks[].target_pct/actual_pct` (loaded, not passed); **[R1:C2]** thread `prtMap` into `computeHomeDashboard` (**signature change**), reuse the `taskRateSummary` null-guard (`ProductionRate.jsx:12-24`: skip null pairs, `null` when total=0, honor `target_pct ?? target` / `actual_pct ?? actual ?? pct_complete`); render "—" on empty |
| Scheduled Workload chart (Scheduled vs Completed $/wk) | 🟡⚙ | contract value bucketed by week; **[R1:C3]** "completed" = `status='Complete'` bucketed by `effectiveEnd` (`queries.js:1468`) **or** a "no date" bucket — do not silently drop null-end jobs |
| At-a-Glance (scheduled / crew assigns / completion % / go-backs) | 🟢⚙ | `computeHomeDashboard()` + go-back count; **[R1:C1]** `mobsByJobId` is a nested `[job_id][seq]` seq-map, **not** an array: `Σ Object.values(mobsByJobId[job_id]||{}).filter(m=>m.is_go_back).length` |
| Where management needs to look (crews / conflicts / behind target / go-backs) | 🟡 | `needCrews` + `conflicts` (exist) + production-behind rollup (C2) + go-back count (C1); **[R1:A3]** keep AtAGlance's "View Analytics →" link (`HomePanels.jsx:114` → `/schedule/billing?tab=forecast`) in the Home rebuild |
| Recent Activity feed | 🟡 | `job_changes` (logs status/field/billing edits). PRT-submitted / crew-reassigned not logged there yet — render what exists, don't add hooks |
| Upcoming Milestones (starts / completions / PRT deadlines) | 🟢 | `jobs.scheduled_start/end`; PRT deadline inferred from `scheduled_end` |

**[R1:E1] Realtime — must carry, not drop.** Home owns 3 Supabase channels + a 300 ms debounce +
`removeChannel` cleanup (`Home.jsx:99-108`). The from-scratch rewrite MUST port this `useEffect`.
Decide which channels the pure dashboard keeps: `jobs` + `assignments` minimum; the
`job_material_lines` channel only if a surviving card reads materials (it doesn't today → drop it
with the plumbing).

**Cleanup:** removing `JobsToPrepare` orphans some Home plumbing (`proposalMaterialsByCallLog`,
`logsByCallLog`) — remove the now-dead state/memo in the same edit so lint passes. **Keep**
`mobsByJobId` + `prtMap` (now consumed by the go-back / production aggregations) and
`assignmentsByJobId` (capacity).

---

## Screen 2 — New Jobs (`src/schedule/views/Jobs.jsx`, rewritten **in place**)

New Jobs = today's Home working-list pattern (`JobsToPrepare` + expandable `StageJobCard`),
repainted, **absorbing every old-Jobs function**. Composition per mockup: stage tabs → capacity
strip → 4 panels → filter bar → job list.

**Do not `git rm Jobs.jsx`.** Rewrite its body in place so the `jobs` route, the `jobs/:jobId`
sibling, the `?tab=` redirect map, and the Recovery Bin all stay in one already-wired file. [DERIVED]

### Carry-over matrix — nothing dropped [LOCKED intent]

| Old-Jobs function (file) | Lands in New Jobs as |
|---|---|
| Stage tabs / drilling (`StagedCardList`/`OnHoldCardList`/`AllJobsList` wrappers) | Reuse the wrappers; stage tabs pick the predicate. Keep local `jobs` state (`OnHoldCardList` needs `setJobs`). |
| Full `StageJobCard` (913 ln) + all modals (SOW/Materials/Days/Mobs/LoadOut/PRT/Logs) + promote/kickoff/resume/delete + budget panel | Rows render **full** variant (not `home-compact`). **[R1:G1] Prop-completeness is a build gate** (whether table or `*CardList`): must supply `crewByCallLog, matsByJobId, logsByCallLog, assignmentsByJobId, proposalMaterialsByCallLog, mobsByJobId, prtMap, today, stage, onJobUpdate`. `stage` gates `canDelete` (`StageJobCard.jsx:664`) — omit it and the delete affordance vanishes, which removes the **only writer** feeding the Recovery Bin. `OnHoldCardList` uniquely needs `setJobs`. |
| **Recovery Bin** (24h soft-delete) — modal + `restoreJob` (`Jobs.jsx` ~606-629, 374-392) **and its launch button** (`JobsPicker.jsx:83-85` `onOpenBin`) | **[R1:A1] Port the modal AND re-home the launch button.** The 🗑 button lives in the deleted picker; porting only the modal leaves the bin unreachable. New home for the button: the **Jobs stage-tab toolbar**. StageJobCard is the delete *writer* (~666); this bin is the only restore reader — sever = unrecoverable-in-app. |
| `?tab=` key handling (`Jobs.jsx` ~14-20 `TAB_REDIRECTS`; legacy `scheduled` renders the **Ready** stage, `Jobs.jsx:523-537`) | **[R1:F1] Not "verbatim" — the picker is deleted and keys change.** Specify the explicit legacy→new map: `scheduled → ready`; keep `pipeline`, `billing`, `ready-to-bill`. Add a tolerant reader with **`all` as the hard default** for unknown keys. `?tab=all` (alerts / "View All Jobs") → stage All. Test each legacy value resolves. |
| Capacity strip + Needs Attention / Next Up / At-a-Glance panels (today `HomeCapacityStrip`, `HomePanels`) | Move here as the band above the list (mockup). Reuse the components, repainted. **[R1:D1]** they render under `.jh-wrap`, not `.home-screen`, so the linen/panel/signal tokens must be promoted to base `.schedule-root` (see Repaint mechanics) or the band loses its charcoal panels + signal colors. |
| Go-Backs panel | `job_mobilizations.is_go_back` count — **[R1:C1]** iterate `Object.values(mobsByJobId[job_id])` (nested seq-map, not array). |
| **[R1:A2] JobsPicker attention math** (`JobsPicker.jsx:17-67`: missing SOW/mats/crew/date, multi-week, ready-to-bill) | **These are NOT computed in the panels today** — `HomePanels` consumes only `needCrews/conflicts/notReady` + `jobsScheduled/crewAssignments/completionPct` (`HomePanels.jsx:11-13, 95-97`). **Port the math** (inputs: `assignments` + `billingWorklist` + `crewByCallLog` + `matsByJobId`; multi-week needs `getJobMultiWeekAlert`) into a **named** panel/strip **before** deleting the picker (build step). |
| **[R1:A3] JobsPicker cross-screen nav jumps** (`JobsPicker.jsx:71-76`: `goBilling/goForecast/goProductionRate/goSchedule/goDaily`) | Die with the picker. **Decide:** re-surface as toolbar/quick-links, or accept as sidebar-only (the sidebar already carries these routes). Record the call. |
| **[R1:E1] Realtime** (`Jobs.jsx:318-339`: 3 channels + debounce + `removeChannel`) | Port the `useEffect` into the rewritten Jobs — a from-scratch rewrite easily omits it → screens stop live-updating (incl. from the crew's Field app). |
| Sync warning (partial-load banner) | Port the banner. |

### Deep links New Jobs must honor (no 404) [DERIVED]
- `?tab=all` (from `HomePanels` "View All Alerts", `JobsToPrepare` "View All Jobs") → stage = All.
- Legacy `?tab=pipeline|ready|staged|…` via the ported redirect map.
- `jobs/:jobId` sibling route unchanged.

**List presentation [DESIGN-OPEN]:** the mockup shows a dense table (Status · Job#/Name · Customer ·
Work Type · Start · Crew · Budget · ⋮). Chunk-1 build may render the repainted list either as that
table or as the current compact rows — **either way each row must still expand/click through to the
full `StageJobCard` + its modals** (the "keep every function" gate). Table styling is vibe, not a
functional requirement.

---

## Screen 3 — Finance / Billing consolidation (`src/schedule/views/Billing.jsx`)

Three money screens → one. `Billing.jsx` already calls `buildBillingSurface()` and gets both the
worklist `rows` **and** `forecast` from a single `loadBillingSurfaceData()` — so folding Forecast in
needs **no new queries**. [DERIVED]

### 4-card picker → one filtered list [LOCKED]
- Replace `BillingPicker.jsx`'s 4-card grid + drill-in with **one flat list** of `built.rows`, each
  rendered as the existing `BillingCard` (per-job card, expand, Hold/GB/Terms/Notes controls,
  Admin-gated writes to `billing_worklist`).
- **Per-row status label** = `billingCardKey(row)` → `BILLING_CARDS[].label` (Ready to Bill /
  Partially Billed / Billed Complete / Pay Apps). This single vocabulary powers **both** the row
  badge and the Status filter (avoid the `billingBadge` vs `billingCardKey` mismatch).
- **Shared FilterBar** (`src/components/FilterBar.jsx`) mounted on Schedule for the first time; add a
  new optional `statusOptions`/`status` prop set following its existing optional-prop pattern.
  Filters: Status (new) · Work type · Date · Customer · Job # · Salesperson.
  **[R1:H1] The FilterBar Clear button + `hasFilters` are hardcoded literals** (`FilterBar.jsx:17`
  destructure, `:20` `hasFilters`, `:66` reset object) — adding `status` requires: add it to the
  destructure, add it to `hasFilters`, and make Clear a **spread-reset**
  (`Object.fromEntries(Object.keys(filters).map(k=>[k,""]))`) so a status-only filter shows Clear and
  Clear actually resets it. (Adjacent: existing Sales callers lack `status` → `undefined` → safe.)
- **[R1:A4] Lift `toBill` / `toBillRows` / `goBackRows` out of `BillingPicker`.** They are local
  `useMemo`s today (`BillingPicker.jsx:25-37`), not in `billingForecast.js` — deleting the picker
  drops them. Preferred: **return them from `buildBillingSurface()`** so the list header + list body
  read one source (extend-canonical). Preserve **Total to Bill** (header) and **Go Backs**
  (`nothing_to_bill`) as a filter/chip.
- **[R1:I1] Admin write-gate is a property of `Billing.jsx` (`canEdit:17`, `onFlag:51`), not the
  picker — not a regression, but a required guard:** the new flat list must render
  `<BillingCard canEdit={canEdit} onFlag={onFlag}/>` (never default `canEdit` true).
- Preserve every per-job detail already on `BillingCard`: billing badge, "held — do not invoice",
  Contract/Billed/Remaining, invoices sent (X of Y) with amounts, editable notes, mark Go Back,
  click-through to open the job in Sales.

### Forecast + Budget folded in [LOCKED]
- **Forecast** → a section/tab rendering `BillingForecast` from **`built.forecast`** (past-due ·
  weekly buckets · held retention · drill-in reusing `BillingCard`). The `views/Forecast.jsx` **view**
  is retired; the `BillingForecast.jsx` **component** stays. **[R1:verified-safe]** consume the single
  `built.forecast` from Billing's existing `buildBillingSurface()` — **drop `Forecast.jsx:37`'s own
  second fetch**; do not add a parallel load.
- **[R1:F1] Tolerant `?tab=` reader is net-new code** (`Billing.jsx` reads no `?tab=` today): accept
  `worklist`/default → list, `forecast` → forecast section, `budget` → budget section; **unknown →
  list (hard default)**. `StageJobCard` links to `?tab=worklist`; the retired routes redirect here.
- **Budget** → the 10-line placeholder view folds in as a stub section = the **margin-card
  placeholder slot** (chunk 2). `views/Budget.jsx` retired.

### 🟢 dashboard cards on this screen [DERIVED]
Billing totals by period · Contract/Billed/Remaining (sum of row fields) · cash-flow + forecast
chart (`built.forecast`) — all from the single `buildBillingSurface()` call already present.

**Guard:** `onFlag` optimistically mutates `surface`; the forecast section must re-derive from the
same `built` memo so an override flip doesn't desync — the existing `useMemo([jobs, surface])`
covers this if both sections read `built`.

---

## Repaint mechanics [DERIVED]

The linen palette already exists as **token overrides** under `.schedule-root .home-screen`
(`src/schedule/index.css` ~41-51: `--bg:#e7decb`, `--bg-card:#f3ede0`, `--panel-dark:#111110`,
`--teal:#30cfac`, signal colors). Base `.schedule-root` (~1-34) holds the older sandy palette.
Every schedule class reads `var(--bg)` / `var(--bg-card)` / `var(--teal)`.

**Move (lowest risk, ~10-line diff, one file):** promote the linen token *values* from the
`.home-screen` override into the base `.schedule-root` block. This repaints all screens at once with
no per-class edits. File: **`src/schedule/index.css`** only.

**[R1:D1] Promote ALL of `index.css:42-50`, not a subset.** `--panel-dark`, `--teal-ink`, and all
four `--sig-*` are defined **only** under `.schedule-root .home-screen` today; base `.schedule-root`
has `--bg`/`--bg-card`/`--teal` but not these. The full promotion set is: `--bg:#e7decb`,
`--bg-card:#f3ede0`, `--panel-dark:#111110`, `--teal-ink:#0d5c4a`, `--sig-green:#3fae52`,
`--sig-orange:#e0892a`, `--sig-red:#d24b3e`, `--sig-purple:#8b6fc7`. This is **required** by the
Home→Jobs move: the capacity strip + panels now render under `.jh-wrap` (Jobs), not `.home-screen`,
so if these tokens stay scoped to `.home-screen` the Jobs headline band loses its charcoal panels and
signal colors. After promotion the `.home-screen` override is redundant (leave empty or delete).

**Regression audit (Step 2):** inline `#fff` / `var(--white)` that aren't token-driven won't repaint
and may become white patches on linen — check `views/Calendar.jsx`, `views/Daily.jsx`,
`views/Schedules.jsx`, and `App.css` literals. **Never touch print/PDF stylesheets** (`FieldSowModal`,
`CardSowModal`, `CrewTicket`, `ReceivingTicket`) — white is allowed in print (CLAUDE.md). Confirm
teal buttons keep black text (CLAUDE.md style rule 2).

---

## Nav + routing [DERIVED]

- **Rename:** `src/lib/nav.js` (~line 31) `label: "Billing"` → `"Finance / Billing"`. Keep
  `id`/`path` unchanged (avoids active-state churn). One line. (Forecast + Budget are **not** in the
  sidebar today — no menu entries to remove.)
- **Redirects** in `src/schedule/ScheduleLayout.jsx` (~251-268):
  - `billing/forecast` → `<Navigate to="/schedule/billing?tab=forecast" replace/>`
  - `budget` → `<Navigate to="/schedule/billing?tab=budget" replace/>`
  - Remove now-unused `Forecast` / `Budget` imports after redirects are in.
- **Tolerant `?tab=` reader on Billing:** accept `worklist`/default→list, `forecast`→forecast,
  `budget`→budget; unknown → default list (never 404). StageJobCard links to `?tab=worklist`.
- In-app buttons already pointing at `/schedule/billing/forecast` (`HomePanels` "View Analytics",
  any surviving `JobsPicker` caller) resolve via the redirect.

---

## Build step sequence (lowest-risk first, each independently testable)

1. **Repaint tokens** — `src/schedule/index.css`. Promote the **full 8-token set** (`--bg`,
   `--bg-card`, `--panel-dark`, `--teal-ink`, four `--sig-*`) from `.home-screen` to base
   `.schedule-root` **[R1:D1]**. Verify every screen on linen, no white page/card, teal buttons
   legible, Home unchanged, and a charcoal panel (e.g. capacity strip) keeps its `--panel-dark` +
   signal colors when rendered outside `.home-screen`. Reversible, no JS.
2. **Repaint regression cleanup** — `Calendar.jsx` / `Daily.jsx` / `Schedules.jsx` / `App.css`
   literals. Verify no white patches; open a Field SOW print preview to confirm print CSS untouched.
3. **Nav rename** — `src/lib/nav.js`. Verify sidebar label + active state.
4. **Finance/Billing consolidation** — `views/Billing.jsx`, `components/BillingPicker.jsx`,
   `lib/billingForecast.js` (**[R1:A4]** lift `toBill`/`toBillRows`/`goBackRows` into
   `buildBillingSurface`), `components/FilterBar.jsx` (**[R1:H1]** +Status prop, spread-reset Clear,
   `status` in `hasFilters` + destructure), `ScheduleLayout.jsx` redirects. Build the **tolerant
   `?tab=` reader** (list = hard default) and **drop `Forecast.jsx`'s own fetch** (consume
   `built.forecast`). Verify: one list with per-row status (from `billingCardKey`, never
   `billingBadge`); Status filter narrows + Clear resets it; Forecast + Budget tabs; `?tab=worklist`
   from a StageJobCard billed click lands; `/schedule/billing/forecast` + `/schedule/budget` redirect
   (no 404); Go Backs + Total to Bill preserved; **[R1:I1]** load as **non-Admin** → Hold/GB/terms/
   notes controls absent.
5. **Home/Jobs split (riskiest, last):**
   - 5a. Rewrite `views/Jobs.jsx`: stage tabs + capacity strip + 4 panels + filter bar + list;
     reuse `Staged/OnHold/AllJobs` wrappers. **Port BEFORE deleting the picker (step 6):** Recovery
     Bin modal **+ its launch button** into the stage-tab toolbar **[R1:A1]**; the attention-count
     math **[R1:A2]** into a named panel (inputs `assignments` + `billingWorklist` + crew + mats);
     the `?tab=` key map (`scheduled→ready`, keep `pipeline/billing/ready-to-bill`, `all` default)
     **[R1:F1]**; the realtime `useEffect` (3 channels + debounce + `removeChannel`) **[R1:E1]**;
     sync warning; and decide the cross-screen nav-jumps **[R1:A3]**. Pass StageJobCard the full
     prop set incl. `stage` + `setJobs` **[R1:G1]**. Verify: delete → Recovery Bin → restore
     round-trips; `?tab=all` sets stage All; legacy `?tab=scheduled` resolves to Ready; a row
     expands to full StageJobCard and every modal opens; list still live-updates.
   - 5b. Rewrite `views/Home.jsx`: remove `JobsToPrepare` + dead plumbing (keep `mobsByJobId`/
     `prtMap`/`assignmentsByJobId`); **add `loadBillingSurfaceData()` + `buildBillingSurface()` to
     `loadData` [R1:B1]**; add KPI cards + chart + At-a-Glance + management-needs (keep "View
     Analytics" link **[R1:A3]**) + Recent Activity + Upcoming Milestones + margin placeholder;
     extend `computeHomeDashboard()` — **thread `prtMap` (signature change) [R1:C2]**, add
     `goBacksCount` (**`Object.values` iteration [R1:C1]**) + `readyCount` + `productionPct`
     (`taskRateSummary` guard); port Home's realtime `useEffect` **[R1:E1]**. Verify: no working
     rows; both money cards show real $; production/go-back cards render numbers (or "—"), not
     NaN/$0; lint clean.
6. **Retire dead files** — only after 4+5 verified AND their stranded logic is confirmed re-homed:
   `views/Forecast.jsx`, `views/Budget.jsx`, and (fully absorbed) `components/JobsPicker.jsx`. Keep
   `BillingForecast.jsx`, `BillingCard.jsx`, `ForecastCard.jsx`, `StageJobCard.jsx`, all `*CardList`
   wrappers. Verify build + no dangling imports (`grep -rn "import.*\(Forecast\|Budget\|JobsPicker\)"`).

---

## Risk register [DERIVED]

_Round-1 audit confirmed each of these against code and refined the fix; `[R1:xx]` tags above are the
detailed spec._

1. **Recovery Bin severed from delete + launch button unreachable [R1:A1].** StageJobCard is the only
   delete writer; Jobs.jsx the only restore reader; `JobsPicker` holds the only launch button. →
   Rewrite Jobs.jsx in place; port modal **and** re-home the launch button to the stage-tab toolbar;
   test delete→restore before deleting the picker.
2. **`?tab=` keys change when the picker is deleted [R1:F1].** "Verbatim" is wrong. → Explicit
   `scheduled→ready` map; keep `pipeline/billing/ready-to-bill`; tolerant reader, `all` hard default.
3. **StageJobCard billed-click 404** (`/schedule/billing?tab=worklist`). → Billing's net-new tolerant
   `?tab=` reader → default list on unknown/`worklist` [R1:F1].
4. **`billing/forecast` + `budget` deep links 404** after retiring the views. → `<Navigate replace>`,
   not route deletion.
5. **Attention/multi-week counts silently dropped [R1:A2].** They are NOT in the panels today. → Port
   the math (incl. `assignments`+`billingWorklist` inputs) into a named panel **before** deleting the
   picker.
6. **Home dead-var lint break** removing JobsToPrepare. → Remove dead state/memo in the same edit;
   keep `mobsByJobId`/`prtMap`/`assignmentsByJobId`.
7. **Repaint white-patch regression** (non-token `#fff`) — verified over-worried: the Calendar/Daily/
   Schedules literals are text-on-dark chips, not backgrounds; print CSS is isolated. → Step-2 spot
   check; never touch print CSS.
8. **Billing/forecast desync** on optimistic override — verified already-correct. → One
   `buildBillingSurface` returns both `rows`+`forecast`; fold-in consumes `built.forecast`; **drop
   `Forecast.jsx:37`'s second fetch**.
9. **Row status vocabulary mismatch** (`billingCardKey` vs `billingBadge`) — verified clean partition.
   → Wire badge + Status filter to `billingCardKey` → `BILLING_CARDS[].label` only.
10. **Scope creep to power a card** — reframed [R1:B1]. → No new **machinery** (tables/columns/
    migrations/new mechanisms); reusing an existing canonical loader on Home is allowed. Unpowered
    cards → labeled placeholders (margin stays that way for chunk 2).
11. **[R1:E1] Realtime dropped in the rewrite.** Home (3 channels) + Jobs (3 channels) + 300 ms
    debounce + `removeChannel`. → Port each `useEffect`; name which channels the pure Home keeps.
12. **[R1:D1] Partial token promotion.** Promoting only `--bg/--bg-card/--panel-dark/--teal` leaves
    `--teal-ink` + four `--sig-*` behind → panels moved to Jobs lose signal colors. → Promote all 8.
13. **[R1:C1/C2/C3] Dashboard math traps.** Go-back count on a seq-map (not array) → NaN; production %
    with no null-guard / no `prtMap` passed → NaN/Infinity + signature change; completed-$ dropping
    null-`scheduled_end` jobs. → Object.values iteration; reuse `taskRateSummary` guard; `effectiveEnd`
    or a no-date bucket.

---

## Verification (end-to-end)

Run locally (`npm run dev`) on `feat/schedule-reskin`; verify in-browser against the mockup + the
design system (linen page, creamy cards, near-black hero cards, teal pop, no white in-app):

- **Repaint:** every schedule screen on linen; a charcoal panel outside `.home-screen` keeps
  `--panel-dark` + signal colors; print previews still white.
- **Home:** no working job rows; **both money cards show real $** (not $0); production / go-back /
  ready cards render numbers or "—" (never NaN/Infinity); "View Analytics" link works; screen
  live-updates (realtime ported).
- **Jobs:** stage tabs + capacity + 4 panels + filter bar + list; the **Recovery Bin launch button is
  reachable**, and **delete → Recovery Bin → restore** round-trips; attention counts show; a row
  expands to full StageJobCard and each modal opens (`stage`/`setJobs` wired); `?tab=all` → All and
  legacy `?tab=scheduled` → Ready both resolve; list live-updates.
- **Finance/Billing:** one list, per-row status (from `billingCardKey`); Status filter narrows **and
  Clear resets it**; Forecast + Budget tabs (forecast reads `built.forecast`, no second fetch);
  Go Backs + Total to Bill preserved; **load as non-Admin → Hold/GB/terms/notes controls absent**;
  `?tab=worklist`/`forecast`/`budget`/unknown all land (no 404); `/billing/forecast` + `/budget`
  redirect.
- **Build:** `npm run build` clean; `grep` shows no dangling imports to retired views.

**Verified-safe guards [R1] (confirmed correct — do not re-audit; verify the guard holds):**
- Admin write-gate is a `Billing.jsx` parent/closure property, not the picker — new list must forward
  `canEdit`+`onFlag` to `BillingCard`.
- `billingCardKey` has an unconditional `'ready'` fallthrough (no null bucket) — safe to drive the
  Status filter.
- Retired views (`Forecast.jsx`/`Budget.jsx`) are imported only in `ScheduleLayout.jsx:19,25`; keep
  `BillingForecast.jsx` (re-imported into Billing).
- Repaint over-worries: white literals in Calendar/Daily/Schedules are text-on-dark chips (won't
  patch); print CSS is a separate `window.open` doc with no `.schedule-root`; teal buttons already
  carry black text; Sales side unaffected (tokens scoped to `src/schedule/`).

## Explicitly out of scope (chunk 1)
- Margin engine + Margin Overview / Highest-Lowest Margin cards (chunk 2, its own plan). Placeholder
  slot only.
- New audit-log event types (PRT-submitted / crew-reassigned into `job_changes`).
- Any schema change / migration.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-09-04. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Big change, but low-risk plumbing-wise: no database, money-flow, or schema changes — it moves and
repaints screens on a product one office uses. The real danger is quietly **dropping a working
feature or breaking a bookmarked link** while shuffling screens. So I'm pointing **4 reviewers** at:
(1) did every existing function survive the move, (2) do the new dashboard numbers add up from data
we already have, (3) does the repaint break any screen's look or its live-updating, (4) does the
billing merge keep its Admin-only guardrail. Fuller pass (4h budget), not a security deep-dive.

### Round
- Plan type: **feature**
- Current round: **1**
- Plan revision under audit: `5990136` (+ §0 baseline & manifest added this commit)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1.

**Briefing for agents**: do NOT re-find issues from prior rounds (none exist yet). Attack the plan
as written in the revision under audit.

### Deployment context
- **Live tenants**: 1 — HDSP only (multi-tenant onboarding is F-tier, blocked).
- **Prod / staging / dev**: the affected screens (Home / Jobs / Billing under `src/schedule/`) are
  **live in prod** for HDSP today; this rewrite sits on `feat/schedule-reskin`, not yet deployed.
- **Blocking feature flags**: none gate the schedule screens themselves (`requires_pay_app` routes
  pay-app vs regular invoicing *within* billing, but doesn't gate the screen).
- **Concurrency profile**: solo / ≤5 (single small office).

Agents weight severity against these values. Cross-tenant findings cap at Med while
`live_tenants == 1`. Multi-user race findings cap at Low while concurrency ≤5. Theoretical attacks
against state that doesn't exist yet are not High.

### Time budget + finding cap
- **Time budget**: 240 min (Chris-set for the chunk-1 build loop).
- **Finding cap**: 24 findings.

Synthesis MUST surface only the top-24 most consequential findings. Remainder go to "Quarantined
findings (not actionable this loop)." Cap forces prioritization.

### Surface
- Total lines: 418 (ideate summary + chunk-1 plan + §0)
- Sections: 20 `##` (chunk-1 plan proper: 13; §-numbered: 1 — §0)
- [LOCKED] decisions: 17
- [DESIGN-OPEN] items: 4
- [OPEN] items: 0
- Plan-to-code ratio: ~418 plan : ~900 est code (≈0.5:1) — no flag (well under 50:1; the plan is
  smaller than the build, as expected for a 3-screen rewrite).

### Layers touched
- UI / components (all three screens — Home, Jobs, Billing — rewritten)
- Data layer (new aggregations extending `computeHomeDashboard`; reuse of `billingForecast.js`)
- Routing / navigation (nav rename, route redirects, `?tab=` deep-link map)
- Real-time / sync (existing Home/Jobs realtime subscriptions must survive the rewrites)
- Auth-gate (Billing Admin-only write-gate on `onFlag` — preserved, not changed)
- Cross-repo (READ-ONLY): reads Field Command-written `daily_production_reports` via the shared DB

### New mechanisms introduced
- New helper logic (extend canonical, not new files): `computeHomeDashboard()` gains
  `goBacksCount` / `readyCount` / `productionPct` + Scheduled-Work and Ready-to-Bill window sums
- New aggregation: Scheduled Workload weekly **Scheduled-vs-Completed $** bucketing (Monday-anchored)
- New prop: `FilterBar` gains an optional `statusOptions`/`status` Status filter (first Schedule use)
- New behavior: Billing 4-card picker → one filtered list + a tolerant `?tab=` reader
- New routes: none (2 `<Navigate>` **redirects** for `billing/forecast` + `budget`)
- New columns / tables / triggers / RLS / cron / webhooks: **none**

### Cross-system reach
- Field Command (shared Supabase DB): chunk 1 **reads** `daily_production_reports` (PRT
  `tasks[].target_pct/actual_pct`) — read-only, no write path, no service-role bypass.
- No other repo writes affected. No external service (QB/Stripe/email) touched.

### Irreversibility
none — all changes are UI/logic on a feature branch. No migrations, no backfills, no public-API or
schema-contract changes. Retired view files are recoverable via git.

### Known weak points
- **Recovery Bin severance** (Risk 1): `StageJobCard` is the delete **writer** (~666); `Jobs.jsx` is
  the **only** restore reader (~374-392). Rewriting Jobs.jsx risks unrecoverable-in-app deletes.
- **`?tab=` redirect map loss** (Risk 2): `Jobs.jsx` ~14-20 catches legacy bookmarks; silent drop = 404s.
- **Deep-link 404s** (Risks 3-4): `StageJobCard` → `/schedule/billing?tab=worklist`; `HomePanels` →
  `/schedule/billing/forecast`; `?tab=all` from alerts/"View All Jobs"; `budget` route.
- **Attention-count math dropped with JobsPicker** (Risk 5): missing-SOW/mats/crew/date + multi-week
  + ready-to-bill counts live only in `JobsPicker.jsx` 17-67.
- **Home dead-var lint break** (Risk 6) removing `JobsToPrepare` plumbing.
- **Repaint white-patch regression** (Risk 7): non-token `#fff`/`var(--white)` in Calendar/Daily/
  Schedules; and the inverse danger — wrongly "fixing" print CSS that must stay white.
- **Realtime survival** (added): Home/Jobs realtime subscriptions + debounce must be re-wired through
  the rewrites, not silently lost — not in the numbered risk register.
- **Billing/forecast optimistic-override desync** (Risk 8): `onFlag` mutates `surface`; folded-in
  forecast must read the same `built` memo.
- **Row status vocabulary mismatch** (Risk 9): `billingCardKey` vs `billingBadge`.
- **"Completed $" definition** (added): Scheduled Workload chart infers completed = `status='Complete'`
  with `scheduled_end` in week — an assumption the audit should pressure.

### Open questions
- Count: 1 material [DESIGN-OPEN] — Jobs list presentation (mockup table vs current compact cards);
  gate is that either must still reach the full `StageJobCard` + modals. (3 other [DESIGN-OPEN] tags
  are the legend + low-risk build-time calls.)
- Highest-pressure: does a table rebuild of the job list preserve the expand-to-StageJobCard path and
  every modal? (Function-preservation, not styling.)

### Suggested attack angles (4 total)

1. **"Nothing dropped" carry-over + deep-link trace** — covers UI/components + routing/nav.
   Required reading: `src/schedule/views/Jobs.jsx`, `views/Home.jsx`, `components/JobsToPrepare.jsx`,
   `components/JobsPicker.jsx`, `components/StageJobCard.jsx` (delete ~666), `ScheduleLayout.jsx`,
   `src/lib/nav.js`, `components/HomePanels.jsx`. Pressure: give every old-Home AND old-Jobs function
   a named destination in the new split; prove the Recovery-Bin delete-writer/restore-reader loop
   survives; confirm the `?tab=` map is ported and every deep link (`?tab=all`, `billing/forecast`,
   `budget`, `billing?tab=worklist`) resolves; catch any attention/multi-week count silently lost with
   JobsPicker. This is the mandatory function-preservation angle for a "keep every function" plan.

2. **Dashboard + data-layer correctness (incl. Field read dependency)** — covers data layer + state
   model + cross-repo read. Required reading: `src/schedule/lib/queries.js` (`computeHomeDashboard`
   ~1530, `loadPRTsForCallLogIds` ~677), `lib/billingForecast.js` (`buildBillingSurface` /
   `billedTotal` / `authoritativeTotal` / `computeForecast`), `views/Home.jsx`. Pressure: do the new
   aggregations read **already-loaded** data (no smuggled new fetch)? Is the "completed $" definition
   sound? Are PRT `tasks[].target_pct/actual_pct` field names + null-handling correct against what
   Field writes? Monday-anchored windowing off-by-ones. Verify the plan's "no new data" claim holds.

3. **Repaint regression + real-time/plumbing survival** — covers UI-theme (CSS) + real-time/sync.
   Required reading: `src/schedule/index.css` (~1-51), `App.css`, `views/Calendar.jsx`, `Daily.jsx`,
   `Schedules.jsx`, the realtime-subscription blocks in `views/Home.jsx` + `Jobs.jsx`, and the print
   modals (`FieldSowModal`/`CardSowModal`/`CrewTicket`/`ReceivingTicket`). Pressure: token promotion
   surfaces non-token white patches; print CSS must stay white (don't "fix"); teal-button black-text
   contrast; and the rewrites must preserve realtime subscriptions + debounce and not orphan data
   plumbing (dead-var lint).

4. **Finance/Billing consolidation integrity** — covers data layer + auth-gate + UI. Required
   reading: `views/Billing.jsx`, `components/BillingPicker.jsx`, `BillingCard.jsx`,
   `BillingForecast.jsx`, `src/components/FilterBar.jsx`, `lib/billingForecast.js`
   (`billingCardKey`/`billingBadge`/`BILLING_CARDS`). Pressure: Admin write-gate on `onFlag` survives
   the picker→list refactor; the new FilterBar Status prop doesn't break existing Sales usages;
   Go Backs + Total to Bill preserved; single status vocabulary (`billingCardKey`→`BILLING_CARDS.label`);
   optimistic-override desync between list + folded-in forecast (shared `built` memo); tolerant
   `?tab=` reader (`worklist`/`forecast`/`budget`/unknown→list).

**Framework-fit** is a cross-cutting check for all four: does each area match existing `queries.js`
conventions / component patterns / naming, and extend canonical functions rather than fork twins?

### Suggested agent count: 4

Rationale: raw formula = 6 (4 layers + read-only cross-system + novel mechanisms ≥3), which caps at
5 — but the cross-system reach is read-only and the novelty is already distributed across the four
layer angles, so a 5th/6th agent would overlap rather than add coverage. Four non-overlapping angles
cover the full surface (all three screens, routing, data, theme, real-time, auth-gate, Field read)
without a blind spot; going to 3 would force the billing-consolidation or repaint angle to share an
agent and lose focus on this plan's headline risk — silently dropping a function.
