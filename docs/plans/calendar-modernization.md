# Plan — Schedule Command Calendar Modernization

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PLANNED — re-scoped against ratified mockup (2026-09-06). Ready for audit (round 2, re-sized). Build still gated on the rebase (step 0) + the audit.

Repo: `sales-command` · Branch: `feat/calendar-modernization` · Route: `/schedule/calendar` → `src/schedule/views/Calendar.jsx`

**Design reference:** ratified mockup 2026-09-06 (Subcon Command › Schedule Command › Calendar). The mockup is described in full prose in §2 so this plan is self-contained for a fresh build agent (the image is local-only and not in the repo).

> **Branch is 16 commits behind `main` — rebase onto `main` is build step 0, and it is REQUIRED (not a formality).**
> - **B89** promoted `allocForWeek` + `pickAllocField` to real exports of `lib/allocations.js` (`:75,:92`) and repointed `Daily.jsx`. On the **branch** these do NOT exist as exports yet — Week code importing them fails to build **until the rebase lands**.
> - **B90** made `loadMobilizationsByJobId` (`queries.js`) paginate via `loadAllRows`. On the branch it's an unpaginated `.in()`. Calendar calls it (`Calendar.jsx:259`) — skip the rebase and go-back blocks past 1000 rows silently vanish on a live prod screen.
>
> **Do NOT reason from "`Calendar.jsx` is byte-identical branch↔main, so the rebase is cosmetic."** The dependency risk lives in `queries.js` + `allocations.js`. (C1)
> **Post-rebase gate:** `grep loadAllRows src/schedule/lib/queries.js` inside `loadMobilizationsByJobId` must hit, and `grep "export function allocForWeek" src/schedule/lib/allocations.js` must hit, before writing any grid code. §0 is verified against **`main`** (the post-rebase baseline), NOT the branch.

---

## §0 Baseline (observed current state) [read-verified against `main` @ 2c2d5ed]

What exists today (file:line evidence; **read-verified** unless tagged):

- **Entry point (single):** `ScheduleLayout.jsx:322` — `<Route path="calendar" element={<Calendar />} />`. Calendar is a `BAND_PATHS` view (`:74`), so the shared `WeeklyCapacityBand` already renders above it (this is the capacity strip in the mockup — reuse, don't rebuild). Nav lives in the host sidebar.
- **Current Calendar = month grid only** (`Calendar.jsx`, 443 lines):
  - Toolbar: `Prev`/`Today`/`Next` + `MONTH YEAR` (`:365–372`). No week view, no toggle, no filters.
  - 7×6 grid, Sun–Sat, `buildGrid` (`:49–60`). **Each day cell independently paints one bar per job active that day** (`dayJobs.map` inside each cell, `:396–415`) → a multi-day job shows **one separate bar per day**, not a continuous span. **This per-cell rendering is what the modernization replaces.**
  - No day pane, no job pane (bars are `title`-tooltip only). Bottom legend of all dated jobs.
- **Data already loaded (source-of-truth — reuse):**
  - `loadJobs()` (`queries.js:499`) → dated jobs. `assignments` (`job_id, crew_name, date`) filtered to the visible range (`:248–253`) → per-job/day crew counts (`crewCountMap`). `loadMobilizationsByJobId(jobs,{liveOnly:true})` (`queries.js:290`) → live allocation blocks (B87). `jobRanges`/`inRange` (`allocations.js:30,61`).
- **Weekend rule already in the code (reuse — do NOT reinvent):**
  - The business runs a **6-day week (Mon–Sat)**; every crew/week surface is hardcoded Mon–Sat: `Daily.jsx:11`, `Schedule.jsx:9–10`, `StatsBar.jsx:4`, `exports.js:60,135`, and `wkDates()` returns **6 days Mon–Sat** (no Sunday). Month calendars (`Calendar.jsx:42`, `Schedules.jsx:8`) show a Sunday column.
  - **Weekend-exception (the canonical rule for this plan):** `DaysModal.jsx:48–50` and `StageJobCard.jsx:51–53` compute worked days as `start→end`, **excluding both weekend days (`dow===0||dow===6`) UNLESS an `assignments` row exists on that weekend day.** This is exactly the bar-segmentation rule §2 needs — reuse this predicate, don't author a new one.
- **Data sources the richer panes need** (for the mockup's job pane; tagged [DERIVED — verify at build] where not yet re-read):
  - Work-type per job → `job_work_types` (`call_log_id → work_type_id`) + `work_types(name, cost_code)`. Drives the **work-type color** + legend categories (Waterproofing/Coatings/Polish/Surface Prep/Demo/Caulking/Other). [DERIVED — confirm the join + a name→category map at build.]
  - Status (On Track / Behind / Issue / Complete) → `jobStatus.js` `getJobStatus`/`getStatusBadgeClass` (used by `JobDetail.jsx:6`). [DERIVED — confirm the status vocabulary maps to the 4 legend states.]
  - Crew count + **lead** per bar → allocation block `crew_needed` + `lead` (B87 columns on `job_mobilizations`); fall back to `assignments` count where a block has no `crew_needed`. [DERIVED.]
  - Allocations / Mobilizations counts, avg crew size, "Total Scheduled Work Days" → `getJobMobilizations`/`computeMobCosts` (`queries.js:128,173`) + the weekend-aware day count above. [DERIVED.]
  - Production % , photo, Recent Activity → PRT (`loadPRTsForJob`), job attachments, `job_changes`/daily logs (`loadDailyLogsForJob`). **These are the "Coming soon" stubs** (see §2.7) — not wired this build.
- **Styling:** schedule module uses **CSS variables** (`var(--…)`), NOT the sales `C`/`F` tokens. New work matches that.
- **Absence checks:** no existing week-view, day-pane, job-pane, spanning-bar, work-type-color, or filter code in `src/schedule/` — all net-new UI on existing (or coming-soon) data. No `assignments`/`jobs` writer added (read-only).
- **Sunday gap (verified):** you cannot **create or view Sunday crew** on the Mon–Sat surfaces (Daily/Schedule/capacity/exports/`wkDates`) — Sunday is structurally absent there. The month calendar *shows* a Sunday column and the weekend-exception *counts* an assigned weekend day, but there is no path to schedule Sunday work. **Out of scope here → sibling plan** `docs/plans/sunday-scheduling.md` (§4).

## §1 Problem / intent [LOCKED]
Modernize the Schedule Command > Calendar screen into the high-level visual command center for scheduling
(month + week views, day pane, job details pane), reusing existing source-of-truth data. Not a greenfield
calendar, not a parallel scheduling system. Inspect → reuse → derive.

**Ratified 2026-09-06 (mockup + decisions):** continuous weekend-aware spanning bars (not per-day bars); bars labeled with crew count + lead; color by work type + status; Month/Week toggle; filters; a tabbed day pane; a full tabbed job pane scaffolded now with live data wired and not-yet-wired sources behind "Coming soon."

## §2 Proposed change

Replace the month-only per-cell grid with the mockup's **command-center layout**. All data is read-only reuse; no new tables, no writers. Three columns: **main calendar** (left/center), **day pane** (opens center-right), **job pane** (opens right).

### §2.0 Toolbar + chrome [LOCKED — mockup]
- Left: `MONTH YEAR` title + `‹ Today ›` period nav.
- Center: **Month | Week** segmented toggle (default Month). State `view ∈ {'month','week'}`.
- Right: **filter dropdowns — All Crews / All Work Types / All Statuses** (client-side filters over the loaded set; each narrows which job bars render).
- **Capacity strip:** the existing `WeeklyCapacityBand` (already renders above `BAND_PATHS` views) — the mockup's "20 Crew Available / 19 Assigned / 1 Open Spots + per-day MON 19/20 95% …" row. Reuse as-is; do not rebuild.
- **Legend:** work-type swatches (Waterproofing/Coatings/Polish/Surface Prep/Demo/Caulking/Other) + status chips (On Track/Behind/Issue/Complete).

### §2.1 Weekend-aware continuous spanning bars [LOCKED — this is the core change]
Replaces the per-cell `dayJobs.map` paint (`Calendar.jsx:396–415`).
- **Unit of a bar = a maximal run of consecutive *worked* days for one allocation block, within one week row.** A job = ≥1 allocation blocks (B87: own start/end = block 1; go-backs = extra blocks). Crew_needed + lead are constant within a block, so a continuous bar can carry one crew count + one lead honestly.
- **Worked days = the block's date range MINUS weekend days (Sat/Sun) that have no `assignments` row, PLUS any weekend day that DOES** — i.e., the **exact weekend-exception predicate** from `DaysModal.jsx:48–50` / `StageJobCard.jsx:51–53`. Reuse it.
  - No weekend work → a run stops before Sat/Sun and a **new bar** resumes Monday (the "8-day job = bar up to the weekend, then a bar after the weekend" behavior).
  - Weekend work scheduled → the bar runs **through** that Sat/Sun continuously.
- **Week-row wrap:** the grid renders Sun–Sat rows; a run crossing a row boundary starts a **new segment** on the next row, with the label repeated.
- **Render:** each segment is ONE continuous element spanning its day-columns (CSS `grid-column` span within the week row). Go-back blocks render as separate spans (B87 preserved). This makes Month and Week consistent for the same data.
- **Lane packing:** overlapping jobs stack in lanes; a job keeps a consistent lane across the days it shares within a row. Cap lanes to the cell/row height; surplus → **"+N more"** link that opens the **day pane** for that date (mockup: "Click +X more to open the day pane").
- **Bar label [LOCKED — mockup + crew/lead ask]:** `job# · job_name` + **crew count** + **lead name**. Crew count = block `crew_needed` (fallback: `assignments` count that day); lead = block `lead`.
- **Color [LOCKED — mockup]:** by **work type** (not the old per-job hash), from `job_work_types → work_types` mapped to the legend categories; a **status** indicator (On Track/Behind/Issue/Complete) via `getJobStatus`. PW handling folds into this (keep a PW marker).

### §2.2 Month view [LOCKED]
Sun–Sat 6-row grid (existing `buildGrid`), now rendering §2.1 spanning bars + "+N more" overflow. Clicking a day cell → day pane for that date; clicking a bar → job pane for that job.

### §2.3 Week view [LOCKED — Option 1, ratified]
Single Mon–Sat strip of 6 day-columns for the focused week. `getMonday` from `weeks.js`; `wkDates(weekMonday)` from **`queries.js`** (NOT `weeks.js`). Membership per column via the in-file `jobsForDate(d)` (`Calendar.jsx:312`) so Week matches Month (fixes F); needs no `allocForWeek`/`pickAllocField`. Same spanning/label/color rules as §2.1 within the single row.

### §2.4 Day pane [LOCKED — mockup]
Header: selected date + close. Tabs **Jobs (N) / Crew View / Summary** (Jobs wired this build; Crew View / Summary may be "Coming soon" stubs if their aggregation isn't trivial — [DERIVED]). Jobs tab = list of every job active that date (`jobsForDate`), each row: work-type color dot, `job# · name`, subtitle (work type / scope), **crew count**, chevron → selects the job pane. Opened by clicking a day or a "+N more".

### §2.5 Job pane — full scaffold, wire-what's-live [LOCKED — "scaffold full pane" ratified]
Build the mockup's pane **layout in full**; wire live data; stub the rest behind **"Coming soon"** (do NOT fabricate values).
- **Header:** `job# · job_name`, status badge, work-type subtitle, close.
- **Tabs:** Overview / Crew / Production / Files. **Overview wired; Crew partial; Production + Files = "Coming soon."**
- **Photo slot:** "Coming soon" placeholder (attachments not wired this build).
- **Overview (wire live):** Customer, Location, Job Type, Job Status, Start/End dates, **Total Scheduled Work Days** (weekend-aware count — reuse §0 predicate), Crew Size (avg), Allocations count, Mobilizations count (+ View Details/View Dates → existing modals if present, else stub), Notes.
- **Schedule Progress:** derive from dates (Day X of N) — wire if trivial, else stub.
- **Production Progress %, Recent Activity:** **"Coming soon"** (PRT + activity feed not wired this build).
- **Actions:** **Open Job** / **Edit Schedule** → `useNavigate()` to `/schedule/jobs/:jobId` (existing `JobDetail`). `Calendar.jsx` must add the `react-router-dom` import (`Jobs.jsx:75` pattern).
- **D1 — sanctioned edit bridge:** the Calendar writes nothing; `JobDetail` is the writable screen reached via Open Job/Edit Schedule. Intended, not a leak.

### §2.6 Interaction contract [LOCKED]
- Selection is local state (`view, year, month, weekMonday, selectedDate, selectedJobId`, plus filter state). No URL params, no persistence, **no mutation** of `assignments`/`jobs`/allocations (read-only).
- **Selection-reset (E1):** on view toggle and Prev/Next/Today, clear or re-validate `selectedDate`/`selectedJobId`.
- **Event-bubbling (E2):** bar/job-row `onClick` must `e.stopPropagation()` so a bar click sets only `selectedJobId`, not also the cell's `selectedDate`.
- **Empty states:** day pane with no jobs / job pane with no crew this week → explicit "None…" copy, not blank (E3).
- **TDZ:** new `useEffect`s referencing new state go **after** the `useState` block (`Calendar.jsx:221–227`). ([[useeffect_tdz]])
- **"Coming soon" integrity:** stubbed tabs/fields must render a clear placeholder, never a fabricated or zero value that reads as real.

## §3 Files to touch

- `src/schedule/views/Calendar.jsx` — main rewrite (grid → spanning-bar layout, toggle, filters, panes). **This will substantially exceed ~600 lines → extract components** (per module convention):
  - `src/schedule/components/CalendarBar.jsx` (a single spanning segment + label/color/status)
  - `src/schedule/components/CalendarDayPane.jsx` (tabs Jobs/Crew View/Summary)
  - `src/schedule/components/CalendarJobPane.jsx` (tabbed pane + coming-soon stubs)
  - `src/schedule/lib/calendarBars.js` — pure helper: given jobs + blocks + assignments + week rows, produce weekend-aware, lane-packed bar segments. **Reuse the weekend-exception predicate** (extract the shared one from `DaysModal`/`StageJobCard` rather than a 3rd copy — "extend canonical, not a twin").
- **Assignments range fix (B1 — required).** Load effect is keyed `[year, month]` (`:270`) and fetches `assignments` only for the month range (`:243–253`); Week nav won't re-fire → blank crew counts. Fix: `[rangeStart,rangeEnd]` = union of month-grid range and `wkDates(weekMonday)[0..5]`; put those **`YYYY-MM-DD` string** bounds in the dep array (not a `Date`). Stay bounded — never load-all.
- **Legend re-scope (G):** scope the legend to the visible period (Week vs Month).
- **New reads:** `job_work_types` + `work_types` for color; reuse `getJobStatus`, `getJobMobilizations`, `computeMobCosts`. Paginate any `.in()` via `loadAllRows`/`fetchAll` (B89/B90 discipline).
- **No changes to:** `ScheduleLayout.jsx` (route + band correct), `WeeklyCapacityBand`, any table/RLS/migration. Sunday-scheduling touches (Mon–Sat grids + `wkDates`) are **explicitly excluded** — sibling plan.

## §4 Out of scope / deferred
- **Sunday-scheduling (create/view Sunday crew across the Mon–Sat grids)** → sibling plan `docs/plans/sunday-scheduling.md` + backlog row. This build only makes bars weekend-aware (shows an assigned weekend day; does not add a create path).
- **Coming-soon (this build scaffolds the slot, does not wire the source):** Production Progress %, Files tab, job-pane photo, Recent Activity feed; possibly Day-pane Crew View / Summary tabs.
- **Drag-to-reschedule / any write path** — Calendar stays read-only; editing happens in `JobDetail` via Open Job/Edit Schedule.
- **Global schedule reskin / teal-accent swap** — separate polish pass.
- **Mobile-native / Field** — web Schedule driver only.

## §5 Estimate / time budget
- **Materially larger than the original half-day.** Realistic whole-feature: **~2 days**, driven by the weekend-aware segmentation + lane-packing algorithm, work-type/status coloring, filters, and two new panes with a scaffolded job pane.
- **Recommend phasing into 3 build chunks, each its own build + gates + audit:**
  - **Chunk A** — grid + weekend-aware spanning bars (`calendarBars.js`) + work-type/status color + crew/lead labels + Month/Week toggle + filters + "+N more". *(the risky core — audit this first)*
  - **Chunk B** — day pane (tabs).
  - **Chunk C** — job pane scaffold (wire live + coming-soon).
- **Work mode:** build (after audit). Model: opus 4.8, medium.

## §6 Decisions
- **D1 — Week render:** Option 1 (light strip on in-file `jobsForDate`). [RESOLVED 2026-09-06]
- **D2 — Job pane:** full scaffold, wire-what's-live + "Coming soon" stubs (not the minimal link-out). [RESOLVED 2026-09-06]
- **D3 — Layout:** three-column — calendar main, day pane center-right, job pane right (per mockup). [RESOLVED 2026-09-06]
- **D4 — Bar segmentation:** weekend-aware; break before an unworked weekend, resume after; run through a worked weekend; reuse the `DaysModal`/`StageJobCard` predicate. [RESOLVED 2026-09-06]
- **D5 — Color:** by work type + status (not per-job hash). [RESOLVED 2026-09-06]
- **D6 — Sunday scheduling:** sibling plan, not this build. [RESOLVED 2026-09-06 — Chris chose (b)]
- **[DESIGN-OPEN, non-blocking]** which day-pane tabs (Crew View/Summary) are wired vs coming-soon; exact work-type→category map; whether Schedule Progress is wired now. Build decides by triviality; each has a safe "Coming soon" default.

## §7 Audit history
- **Round 1 (2026-09-06, 2 agents, `phantom-helper-refs`)** — surfaced 6 caused-by + 4 cleanup + 1 adjacent, all accepted: A1 helper mis-sourcing (corrected: `wkDates`←`queries.js`; `allocForWeek`/`pickAllocField` canonical on main post-B89), B1 assignments range, C1 rebase gate, D1 write-bridge, E1/E2 selection-reset/bubbling, E3/G/TDZ/F build notes, ADJ-1 → backlog B92. **These fixes carry forward into this re-scope.**
- **This revision (re-scope against mockup)** materially expands the surface → round 2 is a **fresh full-surface audit**, re-sized below (not a delta pass).

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-09-06 (round 2 — re-scoped against mockup). Consumed by `/runaudit`._

### Bottom line (plain English)
The screen got a lot bigger than the first plan: instead of tweaking the existing calendar, we're rebuilding it into a real command center — continuous job bars that break around weekends, color by work type, filters, and two side panels. It still writes nothing (no money, no database, no other customers), so the risk is "does it draw the schedule correctly," not "can it break data." Point **3 reviewers** at it: one on the bar-drawing math (especially the weekend break rule and go-back trips), one on the new data it reads (work types, crew/lead, counts), one on the click-behavior + making sure the "Coming soon" placeholders never show fake numbers. Audit **Chunk A (the bars) first** — that's where the hard logic lives.

### Round
- Plan type: feature
- Current round: 2 (re-scope)
- Sizing basis: **full-surface** — the mockup re-scope materially expanded the plan (spanning-bar algorithm, work-type/status color, filters, two panes, job-pane scaffold), so this is a fresh full audit, NOT a delta pass.
- Findings trend: round 1 (2H/4M/5L) → round 2 (?)

### Prior rounds
- Round 1: `a41283d`/`23b68dc` · 2H/4M/5L · pattern: `phantom-helper-refs`

**Briefing for agents:** round-1 fixes (helper sourcing, B1 range, rebase gate, selection reset, stopPropagation) are folded into §0–§3 — verify they survived the re-scope, but attack the NEW surface (spanning-bar algorithm, weekend rule, coloring, panes, coming-soon integrity). Don't re-litigate settled round-1 items.

### Deployment context
- **Live tenants:** 1 — HDSP only
- **Prod/staging/dev:** Calendar is live in prod (`www.scmybiz.com`, `/schedule/calendar`)
- **Blocking flags:** none
- **Concurrency:** solo / ≤5

Read-only surface → data-integrity/leak severity inherently bounded. Cross-tenant caps at Med; multi-user races cap at Low.

### Time budget + finding cap
- **Time budget:** whole feature ~2 days; **audit Chunk A first** (~480 min). Finding cap for a Chunk-A pass: `max(3, ceil(480/10))` = 48 — an upper bound, not a target; prioritize the spanning-bar algorithm + data-range + coming-soon integrity and quarantine the rest.

### Surface
- Sections: §0–§7
- [LOCKED] decisions: many (§2.0–§2.6, §6 D1–D6) — the mockup is now the contract; heavily attack-worthy
- [DESIGN-OPEN] items: ~3 (which day-pane tabs wired; work-type→category map; Schedule Progress wired now) — each with a safe "Coming soon" default
- Plan-to-code ratio: healthy (plan is smaller than the ~2-day build)

### Layers touched
- UI / components (grid, spanning bars, panes, filters, toggle)
- Data layer (new reads: `job_work_types`+`work_types`, status, mobilizations/PRT counts; existing `assignments`/allocations)
- State model (work-type→color mapping, status→4-state mapping, weekend-aware segmentation, lane packing)

### New mechanisms introduced
- New helper/module: `lib/calendarBars.js` (weekend-aware, lane-packed bar segmentation) — **the novel algorithm; where bugs will live**
- New components: `CalendarBar.jsx`, `CalendarDayPane.jsx`, `CalendarJobPane.jsx`
- New derived data: work-type color map, status indicator map, per-block crew/lead labels, weekend-aware "Total Scheduled Work Days"
- New UI: Month/Week toggle, 3 filters, "+N more" overflow, "Coming soon" stubs
- No new columns/tables/triggers/RLS/routes/cron. Reuses `/schedule/jobs/:jobId`.

### Cross-system reach
none — read-only web UI; no other repo, no external service, no service-role/bypass write path.

### Irreversibility
none — all reversible; no migration/backfill/public-API change.

### Known weak points
- **Weekend-segmentation correctness (highest risk).** The break rule must match the existing `DaysModal.jsx:48–50` / `StageJobCard.jsx:51–53` predicate exactly (Sat+Sun excluded unless an `assignments` row exists), including break-before / resume-after and run-through-a-worked-weekend. A divergent copy = drift from the rest of the app and wrong bars.
- **Lane packing + overflow.** Unstable lane assignment makes bars jump between rows; overflow cap must reliably route surplus to "+N more" → day pane.
- **B1 assignments range** — Week/cross-month crew counts blank unless the fetch range unions month+week and the dep array keys on strings.
- **Coming-soon integrity** — Production %, photo, Files, activity must show placeholders, never fabricated/zero values that read as real.
- **Work-type→color + status→4-state maps** — unmapped work types must fall back to "Other," not crash or mis-color; PW marker preserved.
- **Read-only guarantee** — nothing on the Calendar mutates; Open Job/Edit Schedule navigate to `JobDetail` (the only write path, intended).
- **Rebase gate + week-math sourcing** (carried from round 1) — `wkDates`←`queries.js`; no re-derivation.

### Open questions
- Count: ~3 (§6 [DESIGN-OPEN]) — all have safe "Coming soon" defaults; highest-pressure is the work-type→category map completeness.

### Suggested attack angles (3 total)
1. **Bar-drawing math — weekend segmentation + lane packing + data range** (Chunk A). Covers State model + Data layer. Required reading: `calendarBars.js` (new), `DaysModal.jsx:48–50`, `StageJobCard.jsx:51–53`, `allocations.js` (`jobRanges`/`inRange`), `Calendar.jsx` load effect + `jobsForDate`, `queries.js:1621` (`wkDates`). Pressure: does the weekend predicate match the canonical one exactly? break-before/resume-after vs run-through-worked-weekend? week-row wrap? go-back blocks as separate spans (B87)? stable lanes + overflow? B1 union-range + string dep keys? no re-derived week math?
2. **Data layer — new loaders + framework fit.** Covers Data layer. Required reading: `queries.js` (`getJobMobilizations`/`computeMobCosts`/`loadMobilizationsByJobId`), `job_work_types`/`work_types` join, `jobStatus.js`. Pressure: pagination on any new `.in()` (B89/B90); correct joins; reuse canonical loaders not twins; work-type→category completeness + "Other" fallback; crew_needed-vs-assignments fallback; weekend-aware work-day count matches `DaysModal`.
3. **UI / interaction + read-only safety + coming-soon integrity.** Covers UI/components. Required reading: `Calendar.jsx` render, `CalendarDayPane`/`CalendarJobPane`, `JobDetail.jsx` (nav target), module styling. Pressure: selection reset (E1), stopPropagation (E2), filters compose correctly, empty states (E3), CSS-variable styling, **no mutation path on Calendar**, and **coming-soon stubs never fabricate data**.

### Suggested agent count: 3

Rationale: three genuinely distinct risk layers (novel segmentation/lane algorithm; new data reads; UI interaction + coming-soon integrity). Zero cross-system/irreversible surface keeps it at 3, not 4–5; the algorithm is the reason it's not 2.
