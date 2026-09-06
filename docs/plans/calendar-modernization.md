# Plan — Schedule Command Calendar Modernization

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PLANNED (drafted 2026-09-06) — ready for audit.

Repo: `sales-command` · Branch: `feat/calendar-modernization` · Route: `/schedule/calendar` → `src/schedule/views/Calendar.jsx`

> **Branch is 16 commits behind `main`** (only 1 ahead — the plan stub). `main` has since shipped schedule-lib work the Calendar depends on: B89/B90 (paginated mobilization load + `allocForWeek` deduped to a shared helper in `allocations.js`) and the Weekly Crew Capacity strip fixes. **Build step 0 = rebase `feat/calendar-modernization` onto `main`** so the Calendar reuses current helpers instead of reintroducing drift. Baseline below is verified against `main` (`Calendar.jsx` / `ScheduleLayout.jsx` are byte-identical on branch and main, so the rebase is clean for this file).

---

## §0 Baseline (observed current state) [read-verified against `main` @ 2c2d5ed]

What exists today (file:line evidence; **read-verified** — code read, not yet run in browser):

- **Entry point (single):** `src/schedule/ScheduleLayout.jsx:322` — `<Route path="calendar" element={<Calendar />} />`. Grep of `src/schedule/` for `calendar` confirms no second entry point. Calendar is one of `BAND_PATHS` (`ScheduleLayout.jsx:74`), so the shared `WeeklyCapacityBand` renders above it. Nav label/link lives in the host sidebar (ScheduleLayout comment L6: "the host handles … navigation").
- **Current Calendar = month grid only** (`src/schedule/views/Calendar.jsx`, 443 lines):
  - Toolbar: `Prev` / `Today` / `Next` + `MONTH YEAR` label (`Calendar.jsx:365–372`). **No week view. No view toggle.**
  - 7×6 grid via `buildGrid(year, month)` (`:49–60`, 42 cells). Each cell paints one colored bar per job active that day, with a crew-count badge (`:382–418`).
  - **No day pane** (clicking a cell does nothing). **No job details pane** — job bars are `title`-tooltip only (`:405`), no click handler.
  - Legend of all dated jobs at bottom (`:421–440`).
- **Data sources it already reuses (source-of-truth — reuse, do not duplicate):**
  - `loadJobs()` (`lib/queries.js:499`) → jobs with `scheduled_start`/`start_date` (`Calendar.jsx:236–237`).
  - `assignments` table, direct query, columns `job_id, crew_name, date`, filtered to the visible grid range (`Calendar.jsx:248–253`) → crew counts per job/day (`crewCountMap`, `:290–297`).
  - `loadMobilizationsByJobId(jobs, { liveOnly: true })` (`queries.js:290`) → live allocations so go-back blocks land on their own dates (B87) (`Calendar.jsx:259`).
  - Date-range logic: `jobRanges(job, allocs)` + `inRange(ranges, ds)` (`lib/allocations.js:30,61`) via `Calendar.jsx:300–319`.
- **Sibling views to reuse patterns from (do not rebuild):**
  - `views/Daily.jsx` — already a **week** view (Mon–Sat crew × day grid) using `getMonday`/`fmtWk`/`wkDates` + `overlapsWeek`/`allocForWeek`/`pickAllocField` from `allocations.js`. Canonical week/crew rendering.
  - `views/JobDetail.jsx` — canonical full job view; route `/schedule/jobs/:jobId` (`ScheduleLayout.jsx:315`). Fields available: `job_num`, `job_name`, effective start/end (`scheduled_start||start_date`), PW flag, status via `getJobStatus`, address, WTCs.
  - `lib/weeks.js` — canonical `getMonday`/`fmtD`/`fmtWk` (Daily/Schedule/exports share these).
- **Styling convention (verified):** the schedule module styles with **CSS variables** (`var(--bg-card)`, `var(--header-dark)`, `var(--font-heading)`), NOT the `C`/`F` token objects from `src/lib/tokens.js` used by the sales side. Job-bar palette is a local `JOB_COLORS` hex array (`Calendar.jsx:8–12`); `Daily.jsx` scopes its own linen palette locally on purpose (Daily.jsx L7 comment). **New work matches the schedule module's CSS-variable convention**, not the sales `C` tokens.
- **Absence checks:** grep of `src/schedule/` finds no week-view calendar, no day-pane, no job-pane component — this is net-new UI on top of existing data. No `assignments` writer is added (read-only reuse).

## §1 Problem / intent [LOCKED]
Modernize the Schedule Command > Calendar screen into the high-level visual command center for scheduling
(month + week views, day pane, job details pane), reusing existing source-of-truth data. Not a greenfield
calendar, not a parallel scheduling system. Inspect → reuse → derive. Full spec: see /detach invocation.

## §2 Proposed change

Rework `Calendar.jsx` from a month-only grid into a **command-center layout** with four coordinated regions, all reading the **same data the current Calendar already loads** (no new writers, no new tables):

1. **View toggle — Month | Week** [DERIVED]
   - Add a `Month`/`Week` segmented toggle to the existing toolbar (`Calendar.jsx:365`). State: `view ∈ {'month','week'}`, default `'month'`.
   - **Month view** = existing 6-row grid, unchanged in data, but cells become **clickable** (select day → day pane) and job bars become **clickable** (select job → job pane).
   - **Week view** = a single Mon–Sat strip of 6 day-columns for the focused week, each column listing that day's jobs + crew count. Reuse `getMonday`/`wkDates`/`fmtWk` (`lib/weeks.js`) and `overlapsWeek`/`allocForWeek` (`allocations.js`) exactly as `Daily.jsx` does — **do not re-derive week math**. (See D1.)

2. **Day pane** [DERIVED]
   - Clicking a day cell (month) or a day-column header (week) sets `selectedDate`. The day pane lists every job active that date (via existing `jobsForDate(d)`), each with crew count (`getCrewCount`), PW tag, color swatch. Clicking a job there selects it into the job pane.

3. **Job details pane** [DERIVED]
   - Clicking any job bar / day-pane row sets `selectedJobId`. Pane shows a **compact read-only summary** from data already in `jobs` + allocations: `job_num`, `job_name`, effective start/end, status (`getJobStatus`), PW flag, crew-per-day for the selected week, jobsite address. A **"Open full job"** link routes to `/schedule/jobs/:jobId` (existing `JobDetail`) — the pane does not re-implement JobDetail. (See D2.)

4. **Layout arrangement** [DESIGN-OPEN — D3]
   - Recommended default: **calendar grid as the main column + a right rail** stacking the day pane (top) over the job pane (bottom). Toolbar (view toggle + period nav) spans the top; legend collapses under the calendar. On narrow widths the right rail drops below the grid.

**Interaction contract [DERIVED]:** selection is local component state (`view`, `year`, `month`, `weekMonday`, `selectedDate`, `selectedJobId`). No URL params, no persistence (matches current Calendar). **No mutation** of `assignments`, `jobs`, or allocations — the Calendar stays read-only (consistent with §1 "not a parallel scheduling system").

## §3 Files to touch

- `src/schedule/views/Calendar.jsx` — primary rewrite: add view toggle, week render, day pane, job pane, click handlers. Keep the existing month grid + data-loading effect; extend the visible-range logic so Week loads its week's `assignments`.
- **(optional, [DERIVED])** extract `src/schedule/components/CalendarDayPane.jsx` + `CalendarJobPane.jsx` if `Calendar.jsx` exceeds ~600 lines — matches the module's "detail/panes in components/" pattern. Decide during build by size, not upfront.
- **No changes to:** `lib/queries.js`, `lib/allocations.js`, `lib/weeks.js` (reuse as-is), `ScheduleLayout.jsx` (route + band already correct), any table/RLS/migration. If a shared helper is genuinely missing, extend the canonical lib rather than adding a local copy ("extend canonical, not a twin").

## §4 Out of scope / deferred

- **Drag-to-reschedule / any write path** — Calendar remains read-only; rescheduling stays on the board/Daily (LOCKED §1: not a parallel scheduling system).
- **New data overlays** (crew names on bars, production/PRT, capacity math) beyond what's already loaded — deferred; the WeeklyCapacityBand above already carries capacity.
- **Nav/sidebar changes** — entry point unchanged.
- **Global schedule-module reskin / teal-accent swap** — separate deferred polish pass (per "SC Pop Color = Teal": global swap is deferred).
- **Mobile-native / Field** — web Schedule driver only.

## §5 Estimate / time budget

- **Est. code:** ~250–350 net new/changed lines in `Calendar.jsx` (443 → ~700), + optional ~120 lines if panes extracted. No SQL, no migration, no edge fn.
- **Time budget:** **210 min (3.5h)** — half-day build. Single view file, reused data layer, no schema.
- **Work mode:** build (after audit). Model: opus 4.8, medium.

## §6 Open decisions (resolve before/at build)

- **D1 [DESIGN-OPEN]** — Week view: reuse Daily's full crew×day grid, or a lighter Calendar-scoped day-column strip? *Recommended: lighter strip; Daily stays the crew grid.*
- **D2 [DESIGN-OPEN]** — Job pane field set: minimal (num/name/dates/status/PW/crew/address) vs richer (WTC list, mobilizations). *Recommended: minimal + "Open full job" link.*
- **D3 [DESIGN-OPEN]** — Layout: right-rail (grid + stacked panes) vs below-grid panes. *Recommended: right-rail, collapses below on narrow width.*

None of D1–D3 block the audit; each has a recommended default the build can proceed on. Surfaced for Chris to ratify before build.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-09-06. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a **screen makeover that only reads data it already loads** — no database, money, or customer-facing changes. It needs a **small, focused check (2 reviewers)**: one on the calendar math (making sure the new Week view pulls the right days and reuses the existing week/crew code instead of reinventing it), one on the screen behavior (clicking around, and confirming nothing here can accidentally *change* a schedule). Quick pass, not a deep one.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: this commit (round-1 draft — plan + manifest)
- Sizing basis: full-surface — round 1
- Delta scope (round N>1 only): n/a
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: attack the plan revision under audit. Round 1, so no prior findings to avoid.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked (F-tier)
- **Prod / staging / dev**: Calendar is **live in prod** (`www.scmybiz.com`, `/schedule/calendar`), used by the scheduler
- **Blocking feature flags**: none
- **Concurrency profile**: solo / ≤5

Cross-tenant findings cap at Med while `live_tenants == 1`. Multi-user race findings cap at Low while solo/≤5. This surface writes nothing, so data-integrity/leak severity is inherently bounded.

### Time budget + finding cap
- **Time budget**: 210 min (§5 Estimate)
- **Finding cap**: 21 findings (formula `max(3, ceil(210/10))`) — but the surface is small (single UI file, read-only); expect far fewer. Surface the top consequential findings; quarantine the rest.

### Surface
- Total lines: ~130 (incl. manifest)
- Sections: 7 (§0–§6)
- [LOCKED] decisions: 1 (§1 intent)
- [DESIGN-OPEN] items: 3 (D1 week-render, D2 job-pane fields, D3 layout)
- [OPEN] items: 0
- Plan-to-code ratio: ~90 : ~300 ≈ 0.3:1 (not flagged; well under 50:1)

### Layers touched
- UI / components (primary — the whole change)
- Data layer (read-only reuse of `queries.js` / `allocations.js` / `weeks.js`; no new loaders, but Week must extend the `assignments` visible-range fetch)

### New mechanisms introduced
- New columns: none
- New tables: none
- New helpers/hooks: local week-render function; optional `CalendarDayPane.jsx` / `CalendarJobPane.jsx` component extraction (only if file > ~600 lines). No new lib APIs.
- New triggers / RLS policies: none
- New routes / endpoints: none (reuses `/schedule/jobs/:jobId`)
- New jobs / cron / webhooks: none

### Cross-system reach
none — no other repo, no external service, no service-role/bypass write path. Pure read-only web UI.

### Irreversibility
none — all changes reversible (single UI file, no migration/backfill/public-API change).

### Known weak points
- **Week-math drift (highest risk).** The module has a documented history of 3-way-duplicated week math (`weeks.js` header). If Week view re-derives `getMonday`/`wkDates`/`overlapsWeek` instead of reusing them, it will drift from Daily/Schedule. §2.1 mandates reuse — verify the build honors it.
- **`assignments` load-range bug.** The current effect fetches `assignments` only for the **month grid** range (`Calendar.jsx:243–253`). Week view of a week straddling that range (or a week outside the loaded month) will show **empty/wrong crew counts** unless the fetch range is extended to cover the focused week. This is the most likely functional defect.
- **Stale-helper drift from not rebasing.** Branch is 16 behind `main`; if build skips the mandated rebase (build step 0), it reintroduces pre-B89/B90 mobilization loading (unpaginated + un-deduped `allocForWeek`).
- **Selection-state staleness across month↔week toggle** — `selectedDate` / `selectedJobId` must clear or stay valid when switching views or navigating periods.
- **Read-only guarantee** — no click handler should mutate `assignments`/`jobs`/allocations; confirm no write path is introduced (§2 interaction contract).
- **Styling convention** — must use the schedule module's CSS-variable convention (`var(--…)`), NOT the sales `C`/`F` tokens (design-baseline consistency).

### Open questions
- Count: 3 (§6 — D1/D2/D3), each with a recommended default
- Highest-pressure: D1 (Week render approach) — determines whether week-math reuse vs re-derivation risk materializes

### Suggested attack angles (2 total)
1. **Data-layer / loader correctness + week-math reuse** — covers the Data layer. Required reading: `Calendar.jsx` (load effect `:230–270`, `jobsForDate`/`inRange` `:300–319`), `lib/allocations.js`, `lib/weeks.js`, `views/Daily.jsx` (canonical week reuse). Specific pressure: does Week extend the `assignments` fetch range (else empty crew counts)? Does it reuse `getMonday`/`wkDates`/`overlapsWeek`/`allocForWeek` rather than re-deriving? Does the rebase-onto-main step land the B89/B90 helpers? Is B87 go-back allocation behavior preserved in both views?
2. **UI / interaction model + framework fit** — covers UI/components. Required reading: `Calendar.jsx` (render `:362–443`), `views/JobDetail.jsx` (job-pane link target + fields), module styling convention. Specific pressure: month↔week toggle selection-state staleness; clickable cells/bars wired correctly; **read-only guarantee** (no mutation path introduced); CSS-variable vs `C`-token styling; whether pane extraction (if triggered) follows the module's components/ pattern; "Open full job" routes to the real `/schedule/jobs/:jobId`.

### Suggested agent count: 2

Rationale: two genuinely distinct risk layers (calendar/week-math correctness vs UI interaction + read-only safety), low novelty, zero cross-system/irreversible surface — 2-agent split fits the "2-layer touch, low novelty" band; a 3rd agent would have no distinct layer to attack.
