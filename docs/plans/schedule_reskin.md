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
