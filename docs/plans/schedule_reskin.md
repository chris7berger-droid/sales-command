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

Fresh operations dashboard. **No `JobsToPrepare`, no StageJobCard.** Every card below is powered by
data already loaded; the only new code is a few aggregation lines added to the **existing**
`computeHomeDashboard()` in `src/schedule/lib/queries.js` (extend the canonical function, not a twin).

### KPI hero cards + panels — data traffic-light [DERIVED]
🟢 = real data now, just sum/rollup · 🟡 = real data now but reads fuller once Field Command is adopted

| Card | Light | Powered by (already loaded) |
|---|---|---|
| Scheduled Work $ (30d / week / upcoming) | 🟢 | `authoritativeTotal()` (`proposals.total` / `billing_schedule.contract_sum`) × `jobs.scheduled_start` window |
| Crew Capacity % (wk / next wk / 2-wk) | 🟢 | `computeHomeDashboard().capacityDays[]` |
| Job Readiness % (ready / need attn) | 🟢 | `isReady()` predicate over jobs |
| Production % of target (reporting / vs last wk) | 🟡 | `daily_production_reports.tasks[].target_pct/actual_pct`, already loaded via `loadPRTsForCallLogIds()` |
| Ready to Bill $ (jobs / wk) | 🟢 | `buildBillingSurface()` row `remaining` / `authoritative` |
| Scheduled Workload chart (Scheduled vs Completed $/wk) | 🟡 | jobs + contract value bucketed by week; "completed" = `status='Complete'` with `scheduled_end` in week |
| At-a-Glance (scheduled / crew assigns / completion % / go-backs) | 🟢 | `computeHomeDashboard()` + `job_mobilizations.is_go_back` (already loaded, add count) |
| Where management needs to look (crews / conflicts / behind target / go-backs) | 🟡 | `needCrews` + `conflicts` (exist) + production-behind rollup + go-back count |
| Recent Activity feed | 🟡 | `job_changes` audit table (already logs status/field/billing edits) |
| Upcoming Milestones (starts / completions / PRT deadlines) | 🟢 | `jobs.scheduled_start/end`; PRT deadline inferred from `scheduled_end` |

**Data discipline [LOCKED]:** no new tables, columns, migrations, or fetches for these cards.
Recent Activity renders only event types already written to `job_changes` (PRT-submitted /
crew-reassigned aren't logged there yet — not added in chunk 1). PRT "deadline" is inferred, not a
new field. Where a card genuinely can't be powered, it renders as a labeled placeholder in the
mockup's layout rather than growing scope.

**Cleanup:** removing `JobsToPrepare` orphans its data plumbing on Home
(`proposalMaterialsByCallLog`, `mobsByJobId`, `prtMap`, `logsByCallLog`, `assignmentsByJobId`) —
remove the now-dead state/memo in the same edit so lint passes. (Note: `mobsByJobId`/`prtMap` are
now consumed by the new go-back / production aggregations, so keep those.)

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
| Full `StageJobCard` (913 ln) + all modals (SOW/Materials/Days/Mobs/LoadOut/PRT/Logs) + promote/kickoff/resume/delete + budget panel | Rows render **full** variant (not `home-compact`); pass every prop the wrappers pass. |
| **Recovery Bin** (24h soft-delete) — `openBin`/`restoreJob` + modal (`Jobs.jsx` ~606-629, 374-392) | **Port verbatim — critical.** Only reader of soft-deleted jobs; StageJobCard is the delete *writer* (line ~666). Sever = deletes become unrecoverable-in-app. |
| `?tab=` redirect map (`Jobs.jsx` ~14-20: pipeline/ready/billing/ready-to-bill → canonical) | **Port verbatim.** Legacy bookmarks + StageJobCard's `/schedule/billing?tab=worklist` links depend on it. |
| Capacity strip + Needs Attention / Next Up / At-a-Glance panels (today `HomeCapacityStrip`, `HomePanels`) | Move here as the band above the list (mockup). Reuse the components, repainted. |
| Go-Backs panel | `job_mobilizations.is_go_back` count (already loaded). |
| JobsPicker 11 count-tiles + attention math (`JobsPicker.jsx` 17-67: missing SOW/mats/crew/date, multi-week, ready-to-bill) | Picker *navigation* is replaced by stage tabs. Preserve the **attention counts** — they surface in the Needs Attention panel / At-a-Glance, not dropped. |
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
- Preserve **Total to Bill** (header number) and **Go Backs** (`nothing_to_bill`) as a filter/chip.
- Preserve every per-job detail already on `BillingCard`: billing badge, "held — do not invoice",
  Contract/Billed/Remaining, invoices sent (X of Y) with amounts, editable notes, mark Go Back,
  click-through to open the job in Sales.

### Forecast + Budget folded in [LOCKED]
- **Forecast** → a section/tab rendering `BillingForecast` from `built.forecast` (past-due · weekly
  buckets · held retention · drill-in reusing `BillingCard`). The `views/Forecast.jsx` **view** is
  retired; the `BillingForecast.jsx` **component** stays.
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

1. **Repaint tokens** — `src/schedule/index.css`. Promote linen tokens to `.schedule-root`. Verify
   every screen on linen, no white page/card, teal buttons legible, Home unchanged. Reversible, no JS.
2. **Repaint regression cleanup** — `Calendar.jsx` / `Daily.jsx` / `Schedules.jsx` / `App.css`
   literals. Verify no white patches; open a Field SOW print preview to confirm print CSS untouched.
3. **Nav rename** — `src/lib/nav.js`. Verify sidebar label + active state.
4. **Finance/Billing consolidation** — `views/Billing.jsx`, `components/BillingPicker.jsx`,
   `components/FilterBar.jsx` (+Status), `ScheduleLayout.jsx` redirects. Verify: one list with
   per-row status; Status filter; Forecast + Budget tabs; `?tab=worklist` from a StageJobCard billed
   click lands; `/schedule/billing/forecast` + `/schedule/budget` redirect (no 404); Go Backs
   preserved; Admin write-gate on `onFlag` intact.
5. **Home/Jobs split (riskiest, last):**
   - 5a. Rewrite `views/Jobs.jsx`: stage tabs + capacity strip + 4 panels + filter bar + list;
     reuse `Staged/OnHold/AllJobs` wrappers; **port Recovery Bin + `?tab=` map + sync warning +
     attention counts**. Verify: delete a job → appears in Recovery Bin → restore round-trips;
     `?tab=all` sets stage=All; legacy `?tab=pipeline` redirects; a row expands to full StageJobCard
     and every modal opens.
   - 5b. Rewrite `views/Home.jsx`: remove `JobsToPrepare` + dead plumbing; add KPI cards + chart +
     At-a-Glance + management-needs + Recent Activity + Upcoming Milestones + margin placeholder;
     extend `computeHomeDashboard()` with `goBacksCount`/`readyCount`/`productionPct`. Verify: no
     working rows; cards render real numbers; lint clean.
6. **Retire dead files** — only after 4+5 verified: `views/Forecast.jsx`, `views/Budget.jsx`, and
   (if fully absorbed) `components/JobsPicker.jsx`. Keep `BillingForecast.jsx`, `BillingCard.jsx`,
   `ForecastCard.jsx`, `StageJobCard.jsx`, all `*CardList` wrappers. Verify build + no dangling
   imports (`grep -rn "import.*\(Forecast\|Budget\|JobsPicker\)"`).

---

## Risk register [DERIVED]

1. **Recovery Bin severed from delete.** StageJobCard deletes; only Jobs.jsx restores. → Rewrite
   Jobs.jsx in place; port bin first; test delete→restore before removing anything.
2. **`?tab=` redirect map lost** → 404 on legacy bookmarks. → Port the map verbatim.
3. **StageJobCard billed-click 404** (`/schedule/billing?tab=worklist`). → Billing tolerates unknown/
   `worklist` tab → default list.
4. **`billing/forecast` + `budget` deep links 404** after retiring the views. → `<Navigate replace>`,
   not route deletion.
5. **Attention/multi-week counts dropped with JobsPicker.** → Port the count math into the Needs
   Attention / At-a-Glance panels.
6. **Home dead-var lint break** removing JobsToPrepare. → Remove dead state/memo in the same edit.
7. **Repaint white-patch regression** (non-token `#fff`). → Step-2 targeted audit; never touch print
   CSS.
8. **Billing/forecast desync** on optimistic override. → Both sections read the same `built` memo.
9. **Row status vocabulary mismatch** (`billingCardKey` vs `billingBadge`). → `billingCardKey` →
   `BILLING_CARDS[].label` is the single source for badge + filter.
10. **Scope creep to power a card.** → No new tables/columns/fetches; unpowered cards render as
    labeled placeholders (margin card stays that way for chunk 2).

---

## Verification (end-to-end)

Run locally (`npm run dev`) on `feat/schedule-reskin`; verify in-browser against the mockup + the
design system (linen page, creamy cards, near-black hero cards, teal pop, no white in-app):

- **Repaint:** every schedule screen on linen; print previews still white.
- **Home:** no working job rows; all KPI cards + chart + feeds render real numbers (or labeled
  placeholder); go-back/ready/production aggregations correct vs spot-checked data.
- **Jobs:** stage tabs + capacity + 4 panels + filter bar + list; **delete → Recovery Bin → restore**
  round-trips; a row expands to full StageJobCard and each modal opens; `?tab=all` + a legacy
  `?tab=` both resolve.
- **Finance/Billing:** one list, per-row status; Status filter narrows; Forecast + Budget tabs;
  Go Backs + Total to Bill preserved; Admin-only write-gate holds; `?tab=worklist`, `/billing/forecast`,
  `/budget` all land (no 404).
- **Build:** `npm run build` clean; `grep` shows no dangling imports to retired views.

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
