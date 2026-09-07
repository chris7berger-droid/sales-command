# Plan — Schedule Command Calendar Modernization

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** Chunk A **SHIPPED** (gates clean, 2026-09-06). **Chunk B/C planned** (§8) + audit-ready (B/C manifest at end, 2 agents). Build B/C on one branch off `main` once A merges.

> **Provenance note:** the original ID8 planning session was accidentally closed before its decisions were captured, so this plan was reconstructed from the `/detach` stub (only §1 survived) + a later mockup. Several decisions below were **re-ratified verbally by Chris on 2026-09-06** (color scheme, lead handling, Sunday split) — those are the authority, not the mockup, where they differ.

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
  - **Bar color → alternating palette, NOT work type.** Work-type coloring was **voided in ID8** (too many work types — prod has ~85 names). Reuse the existing `JOB_COLORS` palette + per-job color index (`Calendar.jsx:8–16, 276–287`) so adjacent/stacked jobs read as distinct. No `job_work_types`/`work_types` join, no color map. (Dissolves round-2 finding B.)
  - **Health status (On Track / Behind / Issue) → no data source.** `getJobStatus` (`jobStatus.js:8–17`) returns *workflow* states (Scheduled/In Progress/On Hold/Complete/Ongoing), not schedule-health; nothing computes health. → **"Coming soon"** (round-2 finding A).
  - **Crew count + lead per bar → real, via the effective-value fallback.** Lead is `pickAllocField(block, job, 'lead')` = block `lead` **else job-level `jobs.lead`** (a real, editable field on `JobDetail.jsx:274–281` + `Schedule.jsx:736`; imported by yesv2). Daily already renders lead this way (`Daily.jsx:227`). Crew count = block `crew_needed` else `assignments` count that day. Source lead/crew via `pickAllocField`, **not** `jobRanges` (which drops both). (Resolves round-2 finding C — the audit checked only the empty block field, missing `jobs.lead` + the fallback.)
  - Allocations / Mobilizations counts, avg crew size, "Total Scheduled Work Days" → `getJobMobilizations`/`computeMobCosts` (`queries.js:128,173`) + the weekend-aware day count above. [DERIVED.]
  - Production % , photo, Recent Activity → PRT (`loadPRTsForJob`), job attachments, `job_changes`/daily logs (`loadDailyLogsForJob`). **These are the "Coming soon" stubs** (see §2.7) — not wired this build.
- **Styling:** schedule module uses **CSS variables** (`var(--…)`), NOT the sales `C`/`F` tokens. New work matches that.
- **Absence checks:** no existing week-view, day-pane, job-pane, spanning-bar, work-type-color, or filter code in `src/schedule/` — all net-new UI on existing (or coming-soon) data. No `assignments`/`jobs` writer added (read-only).
- **Sunday gap (verified):** you cannot **create or view Sunday crew** on the Mon–Sat surfaces (Daily/Schedule/capacity/exports/`wkDates`) — Sunday is structurally absent there. The month calendar *shows* a Sunday column and the weekend-exception *counts* an assigned weekend day, but there is no path to schedule Sunday work. **Out of scope here → sibling plan** `docs/plans/sunday-scheduling.md` (§4).

## §1 Problem / intent [LOCKED]
Modernize the Schedule Command > Calendar screen into the high-level visual command center for scheduling
(month + week views, day pane, job details pane), reusing existing source-of-truth data. Not a greenfield
calendar, not a parallel scheduling system. Inspect → reuse → derive.

**Ratified 2026-09-06 (mockup + verbal decisions):** continuous weekend-aware spanning bars (not per-day bars); bars labeled with crew count + lead; **alternating colors for readability** (NOT work type — voided in ID8; NOT lead/customer); Month/Week toggle; filters; a tabbed day pane; a full tabbed job pane scaffolded now with live data wired and not-yet-wired sources ("Coming soon"). Health-status badges deferred to "Coming soon" (no data source). Lead-mandatory tweak to the crew-allocation modal folded in.

## §2 Proposed change

Replace the month-only per-cell grid with the mockup's **command-center layout**. All data is read-only reuse; no new tables, no writers. Three columns: **main calendar** (left/center), **day pane** (opens center-right), **job pane** (opens right).

### §2.0 Toolbar + chrome [LOCKED — mockup]
- Left: `MONTH YEAR` title + `‹ Today ›` period nav.
- Center: **Month | Week** segmented toggle (default Month). State `view ∈ {'month','week'}`.
- Right: **filter dropdowns — All Crews / All Work Types / All Statuses** (client-side filters over the loaded set; each narrows which job bars render).
- **Capacity strip:** the existing `WeeklyCapacityBand` (already renders above `BAND_PATHS` views) — the mockup's "20 Crew Available / 19 Assigned / 1 Open Spots + per-day MON 19/20 95% …" row. Reuse as-is; do not rebuild.
- **Legend:** minimal. Bar colors are **alternating for readability** (no data meaning) → no work-type swatch legend. Health status chips (On Track/Behind/Issue) are **"Coming soon"** (no data source). A small PW marker and the "+N more" affordance are the only legend items worth keeping.
- **Filters:** keep **All Crews** + **All Statuses** (workflow status via `getJobStatus` — real data). **All Work Types** filter is optional/[DESIGN-OPEN] — needs work-type-per-job data (`_wtcs`); default it to "Coming soon" if not trivial. (Filtering ≠ coloring — the work-type *color* is voided, a work-type *filter* is still valid if cheap.)

### §2.1 Weekend-aware continuous spanning bars [LOCKED — this is the core change]
Replaces the per-cell `dayJobs.map` paint (`Calendar.jsx:396–415`).
- **Unit of a bar = a maximal run of consecutive *worked* days for one allocation block, within one week row.** A job = ≥1 allocation blocks (B87: own start/end = block 1; go-backs = extra blocks). crew_needed + lead are effectively constant within a block (via `pickAllocField` fallback to job-level), so a continuous bar can carry one crew count + one lead honestly.
- **Block attribution caveat (round-2 finding G):** the weekend-exception predicate keys `assignments` per **job×day** (assignments has no block FK). Go-back blocks share the parent `job_id`, so a weekend assignment can't be attributed to a specific block. Chunk-A rule: attribute a weekend day to the block whose date range contains it; if two blocks overlap that weekend (rare), the earlier block wins. Document this.
- **Worked days = the block's date range MINUS weekend days (Sat/Sun) that have no `assignments` row, PLUS any weekend day that DOES** — i.e., the **exact weekend-exception predicate** from `DaysModal.jsx:48–50` / `StageJobCard.jsx:51–53`. Reuse it.
  - No weekend work → a run stops before Sat/Sun and a **new bar** resumes Monday (the "8-day job = bar up to the weekend, then a bar after the weekend" behavior).
  - Weekend work scheduled → the bar runs **through** that Sat/Sun continuously.
- **Week-row wrap:** the grid renders Sun–Sat rows; a run crossing a row boundary starts a **new segment** on the next row, with the label repeated.
- **Compute order (round-2 finding I):** compute the worked-day set FIRST (apply the weekend rule over the block range), THEN split that set into runs per Sun–Sat grid row. Wrap and weekend-skip are not independent — sequence them this way so a Thu→Tue run resolves deterministically.
- **Render:** each segment is ONE continuous element spanning its day-columns (CSS `grid-column` span within the week row). Go-back blocks render as separate spans (B87 preserved).
- **Month/Week Sunday consistency (round-2 finding D — required):** Month grid is Sun–Sat (7 col); `wkDates` is Mon–Sat (6 col, no Sunday). A Sunday-*worked* bar must not appear in Month and vanish in Week. Chunk-A rule: **Week view shows a Sunday column only when the focused week has Sunday work**, else stays Mon–Sat. Same data → same answer in both views. (Sunday *creation* remains the sibling plan; this is display-consistency only.)
- **Lane packing (round-2 finding H):** sort jobs by an explicit comparator — **start-date → job_num → seq** — then greedy-assign lanes so a job keeps a stable lane across the days it shares within a row. Cap lanes to the cell/row height; surplus → **"+N more"** link that opens the **day pane** for that date.
- **Bar label [LOCKED]:** `job# · job_name` + **crew count** + **lead name**. Crew count = `pickAllocField(block, job, 'crew_needed')` else `assignments` count (for a multi-day bar, use the block's start-day count — round-2 Low); lead = `pickAllocField(block, job, 'lead')` (block lead else `jobs.lead`). Blank lead renders nothing (no placeholder text on the bar); Chris fills missing job leads, and the §3 mandatory-lead tweak prevents new blanks going forward.
- **Color [LOCKED — alternating, ratified 2026-09-06]:** reuse the existing `JOB_COLORS` palette + per-job color index (`Calendar.jsx:8–16, 276–287`) — **alternating colors purely for readability**, encoding nothing. Not work type (voided), not lead, not customer. Keep a small PW marker/tag (do NOT recolor the whole bar purple for PW — that would fight the alternating scheme).

### §2.2 Month view [LOCKED]
Sun–Sat 6-row grid (existing `buildGrid`), now rendering §2.1 spanning bars + "+N more" overflow. Clicking a day cell → day pane for that date; clicking a bar → job pane for that job.

### §2.3 Week view [LOCKED — Option 1, ratified]
Single Mon–Sat strip of 6 day-columns for the focused week. `getMonday` from `weeks.js`; `wkDates(weekMonday)` from **`queries.js`** (NOT `weeks.js`). Membership per column via the in-file `jobsForDate(d)` (`Calendar.jsx:312`) so Week matches Month (fixes F); needs no `allocForWeek`/`pickAllocField`. Same spanning/label/color rules as §2.1 within the single row.

### §2.4 Day pane [LOCKED — mockup]
Header: selected date + close. Tabs **Jobs (N) / Crew View / Summary** (Jobs wired this build; Crew View / Summary may be "Coming soon" stubs if their aggregation isn't trivial — [DERIVED]). Jobs tab = list of every job active that date (`jobsForDate`), each row: the job's alternating-palette color dot, `job# · name`, subtitle (work-type *text* / scope — text is fine; only the *color* was voided), **crew count** + **lead**, chevron → selects the job pane. Opened by clicking a day or a "+N more".

### §2.5 Job pane — full scaffold, wire-what's-live [LOCKED — "scaffold full pane" ratified]
Build the mockup's pane **layout in full**; wire live data; stub the rest behind **"Coming soon"** (do NOT fabricate values).
- **Header:** `job# · job_name`, **workflow** status badge (`getJobStatus` — Scheduled/In Progress/etc.; NOT the voided health badge), work-type subtitle, close.
- **Tabs:** Overview / Crew / Production / Files. **Overview wired; Crew partial; Production + Files = "Coming soon."**
- **Photo slot:** "Coming soon" placeholder (attachments not wired this build).
- **Overview (wire live):** Customer, Location, Job Type, Job Status, Start/End dates, **Total Scheduled Work Days**, Crew Size (avg), Allocations count, Mobilizations count (+ View Details/View Dates → existing modals if present, else stub), Notes.
  - **Total Scheduled Work Days source (round-2 finding F):** `DaysModal.collectScheduledDates` derives days from `field_sow` tagged dates (the WTC path) for most jobs and only runs the weekend predicate in its zero-WTC fallback — so the pane count and the bar days can disagree. Chunk-C rule: the pane's day count MUST be computed the **same way the bars are** (weekend rule over block ranges) so pane ≡ bars, OR label the pane figure as the WTC-planned count distinctly. Do not silently show two different "work days."
  - Requires `loadJobs({ withWTCs:true })` for the mobilization/avg-crew counts (round-2 finding E) — the current `loadJobs()` omits WTCs so `getJobMobilizations`/`computeMobCosts` return empty.
- **Schedule Progress:** derive from dates (Day X of N) — wire if trivial, else stub.
- **Production Progress %, Recent Activity:** **"Coming soon"** (PRT + activity feed not wired this build).
- **Actions:** **Open Job** / **Edit Schedule** → `useNavigate()` to `/schedule/jobs/:jobId` (existing `JobDetail`). `Calendar.jsx` must add the `react-router-dom` import (`Jobs.jsx:75` pattern).
- **D1 — sanctioned edit bridge:** the Calendar writes nothing; `JobDetail` is the writable screen reached via Open Job/Edit Schedule. Intended, not a leak.

### §2.6 Interaction contract [LOCKED]
- Selection is local state (`view, year, month, weekMonday, selectedDate, selectedJobId`, plus filter state). No URL params, no persistence, **no mutation** of `assignments`/`jobs`/allocations (read-only).
- **Selection-reset (E1 + round-2 finding K):** on view toggle, Prev/Next/Today, **and any filter change** (crew/status/work-type), clear or re-validate `selectedDate`/`selectedJobId` — a filtered-out selected job must not leave a stale pane open.
- **Event-bubbling (E2 + round-2 finding M):** enumerate every nested clickable that must `stopPropagation()` so it doesn't also fire the parent cell: job bars, day-pane rows, **"+N more"**, chevrons, filter dropdowns, tabs, close buttons.
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
- **Legend re-scope (G):** the (now-minimal) legend scopes to the visible period.
- **Color needs no new reads** — alternating palette reuses in-file `JOB_COLORS`/`jobColorMap`. Pane data reuses `getJobStatus`/`getJobMobilizations`/`computeMobCosts` (with `loadJobs({withWTCs:true})`). Paginate any `.in()` via `loadAllRows`/`fetchAll` (B89/B90).
- **Consistent "Coming soon" placeholder (round-2 finding L):** one shared placeholder component for all stubbed slots (health badge, Production %, Files, photo, Recent Activity). Guard "Day X of N" schedule-progress so a start-only block (N=1) never renders "Day 5 of 1" (N≤0 guard).
- **Pane pattern (adjacent finding N):** `src/schedule/components/` has only centered modals — **no side-pane / tab-state precedent**. Pin one convention (local `useState` tabs, CSS-var styling) and apply it to all three panes. (Backlog note filed: "schedule module has no canonical side-pane pattern.")

**Folded-in write change — make lead mandatory in the crew-allocation modal (Chris, 2026-09-06):**
- `ScheduleLayout.jsx:397` — the block-level Lead is a free-text `<input>`. Convert to a **pick-from-crew `<select>`** (populate from `loadTeamMemberMap`) and **require it on save** (block the mobilization save with a clear message if empty).
- Also require the **job-level** Lead (`JobDetail.jsx:274`, `Schedule.jsx:736`) when a job is scheduled, so the primary block (most jobs) can't be lead-blank going forward.
- This is a **write-path** change to the scheduler modal (small, ~1–2h) — the Calendar view itself stays read-only. Do it in Chunk A so bars have lead data to show.

**Capacity band is period-blind (round-2 finding J):** `WeeklyCapacityBand:17` hardcodes `getMonday(new Date())` → always shows *this* week even when the calendar is navigated elsewhere. §2.0 says "reuse as-is" but the mockup implies it tracks the viewed period. **Decision needed at Chunk-A:** either (a) leave the band pinned to the current week and label it "This week" (smallest, honest), or (b) pass the viewed week into the band (a real change to a shared component — bigger). *Default: (a) label it, defer (b).*

- **No changes to:** route/table/RLS/migration. Sunday *creation* (Mon–Sat grids + `wkDates` 7-day extension) is **excluded** — sibling plan `sunday-scheduling.md`.

## §4 Out of scope / deferred
- **Work-type coloring** — voided in ID8; bars use an alternating readability palette instead.
- **Sunday-scheduling (create/view Sunday crew across the Mon–Sat grids)** → sibling plan `docs/plans/sunday-scheduling.md` + backlog F60. This build makes bars weekend-aware and keeps Month/Week Sunday *display* consistent; it adds no Sunday create path.
- **Coming-soon (this build scaffolds the slot, does not wire the source):** health-status badges (no data source), Production Progress %, Files tab, job-pane photo, Recent Activity feed; possibly Day-pane Crew View / Summary tabs, and the All-Work-Types filter.
- **Drag-to-reschedule / any write path** — Calendar stays read-only; editing happens in `JobDetail` via Open Job/Edit Schedule.
- **Global schedule reskin / teal-accent swap** — separate polish pass.
- **Mobile-native / Field** — web Schedule driver only.

## §5 Estimate / time budget
- **Materially larger than the original half-day.** Realistic whole-feature: **~2 days**, driven by the weekend-aware segmentation + lane-packing algorithm, filters, the mandatory-lead modal tweak, and two new panes with a scaffolded job pane. (Alternating color reuses existing code — near-zero cost; work-type color/map removed.)
- **Recommend phasing into 3 build chunks, each its own build + gates + audit:**
  - **Chunk A** — grid + weekend-aware spanning bars (`calendarBars.js`) + alternating color + crew/lead labels + mandatory-lead modal tweak + Month/Week toggle + filters + "+N more". *(the risky core)*
  - **Chunk B** — day pane (tabs).
  - **Chunk C** — job pane scaffold (wire live + coming-soon).
- **Work mode:** build (after audit). Model: opus 4.8, medium.

## §6 Decisions
- **D1 — Week render:** Option 1 (light strip on in-file `jobsForDate`). [RESOLVED 2026-09-06]
- **D2 — Job pane:** full scaffold, wire-what's-live + "Coming soon" stubs (not the minimal link-out). [RESOLVED 2026-09-06]
- **D3 — Layout:** three-column — calendar main, day pane center-right, job pane right (per mockup). [RESOLVED 2026-09-06]
- **D4 — Bar segmentation:** weekend-aware; break before an unworked weekend, resume after; run through a worked weekend; reuse the `DaysModal`/`StageJobCard` predicate. [RESOLVED 2026-09-06]
- **D5 — Color:** **alternating readability palette** (reuse `JOB_COLORS`/`jobColorMap`), NOT work type (voided in ID8), NOT lead/customer. Small PW marker only. [RESOLVED 2026-09-06]
- **D6 — Sunday scheduling:** sibling plan, not this build. [RESOLVED 2026-09-06 — Chris chose (b)]
- **D7 — Health-status badges:** "Coming soon" — no data source computes On Track/Behind/Issue. [RESOLVED 2026-09-06 — round-2 A]
- **D8 — Lead on bars:** kept, via `pickAllocField` (block lead else `jobs.lead`); + fold in the mandatory-lead modal tweak (§3). [RESOLVED 2026-09-06 — round-2 C]
- **D9 — Capacity band period-tracking:** default = label it "This week," defer wiring the viewed period. [RESOLVED default 2026-09-06 — round-2 J; revisit at Chunk-A if the band should follow navigation]
- **[DESIGN-OPEN, non-blocking]** which day-pane tabs (Crew View/Summary) wired vs coming-soon; All-Work-Types filter wired vs coming-soon; whether Schedule Progress is wired now. Build decides by triviality; each has a safe "Coming soon" default.

## §7 Audit history
- **Round 1 (2026-09-06, 2 agents, `phantom-helper-refs`)** — surfaced 6 caused-by + 4 cleanup + 1 adjacent, all accepted: A1 helper mis-sourcing (corrected: `wkDates`←`queries.js`; `allocForWeek`/`pickAllocField` canonical on main post-B89), B1 assignments range, C1 rebase gate, D1 write-bridge, E1/E2 selection-reset/bubbling, E3/G/TDZ/F build notes, ADJ-1 → backlog B92. **These fixes carry forward into this re-scope.**
- **Round 2 (2026-09-06, 3 agents, `mockup-outruns-data`)** — 4 High + 7 Med + 3 Low + 2 adjacent, 0 regressions (round-1 fixes confirmed intact). Scope-cut clause fired; **ratified "wire what's real"** + Chris's ID8 correction. Resolution:
  - **A (health badges, no data)** → "Coming soon" (D7).
  - **B (work-type color map fantasy)** → **dissolved** — work-type color was voided in ID8; bars use an alternating palette (D5). No map.
  - **C (lead blank)** → **resolved** — audit checked only the empty block field; `jobs.lead` + `pickAllocField` fallback is the real source (D8). Lead kept; mandatory-lead modal tweak folded in (§3).
  - **D (Month/Week Sunday inconsistency)** → §2.1 display-consistency rule.
  - **E (missing `withWTCs`)** → §2.5 loads `loadJobs({withWTCs:true})`; work-type join dropped (color voided).
  - **F (work-day-count source mismatch)** → §2.5 rule (pane count computed like the bars).
  - **G (block attribution), H (lane comparator), I (wrap∘weekend order), J (band period-blind), K (filter reset), L (placeholder + N-guard), M (stopPropagation enumeration)** → folded into §2.1/§2.6/§3.
  - **N (no side-pane precedent)** → §3 pin-one-convention + backlog note.
  - **Net: surface shrank** (color map + work-type join removed; health stubbed). Additions are small (mandatory-lead tweak; alternating color reuses existing code). **No round 3 needed** — Chunk-A build may proceed after the rebase.
- **Chunk A — SHIPPED 2026-09-06, all gates clean** (branch `feat/calendar-modernization`, commits `6808237`/`8a5c728`/`1c875e1`). Grid + weekend-aware spanning bars (`calendarBars.js`, `CalendarBar.jsx`) + extracted `workdays.js` predicate (DaysModal/StageJobCard refactored to it) + alternating color + crew/lead labels + Month/Week toggle + filters + "+N more" + mandatory-lead modal/job-level gate. Filed follow-ups **B96** (mandatory-lead invariant leaks via the SOW date editor) + **B97** (UI-only invariant, no DB constraint) — both T4, not blockers.
- **Chunk B/C — audited separately** (this pass). Fresh, B/C-scoped manifest below (2 agents); round-2/Chunk-A history summarized above.

## §8 Chunk B + C — build spec (grounded in merged Chunk A)

Chunk A shipped (gates clean, §7). It left explicit seams for the panes. **Build B+C on one branch off `main` once A merges** (A is not yet on main).

### §8.0 The seam Chunk A provides (verified in `Calendar.jsx`)
- **Selection state, set but unconsumed:** `selectedDate` (ymd) + `selectedJobId` (`:170–171`). `selectDay(ds,e)` (`:394`) + `selectJob(jobId)` (`:398`) toggle them; **"+N more" already calls `selectDay`** (`:522`), a bar click calls `selectJob` (`:510`). `changeView` clears both (E1, `:350`).
- **Data already in-component (reuse for the day pane — don't refetch):** `jobs` (from `loadJobs()`, **no WTCs**), `allocsByJobId`, `crewCountMap` + `getCrewCountByYmd(jobId,ds)` (`:278`), `jobBlocks(job,allocs)` (`calendarBars.js:28`), `barMeta(seg)→{crewCount,lead}` (`:334`), `getJobColor`, `getJobStatus`, `filteredJobs` (`:285`), and **`workdays.js`** `isWorkedDay`/`workedDaySet` (the canonical predicate A extracted).
- **Layout:** the calendar renders as a **single full-width column** (`:420–547`) — **no rail/pane container yet**. B/C add the D3 three-column wrapper.

### §8.1 Chunk B — Day pane (renders off `selectedDate`)
- New `components/CalendarDayPane.jsx`, shown in the new rail when `selectedDate` is set.
- **Day's jobs = `filteredJobs` worked on `selectedDate`, derived the SAME way as the bars** — `jobBlocks` + `workdays.isWorkedDay(date, assignmentsForJob)` — so the list ≡ what the grid draws (no separate membership rule). Reuse `getCrewCountByYmd`/`barMeta` for crew + lead.
- Row: `getJobColor` dot · `job# · name` · subtitle · crew count · lead · chevron → `selectJob(jobId)` (opens Chunk C).
- Tabs **Jobs** (wired) / **Crew View** / **Summary** (Coming-soon unless trivial). Close → `setSelectedDate(null)`.
- **Verify "+N more" now opens the pane** (it already sets `selectedDate`; B supplies the consumer).
- `stopPropagation` on rows/chevrons/close/tabs (M). Pane convention (N): local `useState` tabs, CSS-var styling.

### §8.2 Chunk C — Job pane (renders off `selectedJobId`)
- New `components/CalendarJobPane.jsx`, shown in the rail when `selectedJobId` is set.
- **Lazy-load the selected job on selection** — `loadJobWithWTCs(selectedJobId)` (`queries.js:598`) + `getJobMobilizations`/`computeMobCosts`. **Do NOT switch whole-grid `loadJobs()` to `withWTCs:true`** (would hydrate every job) — fetch the one job (resolves round-2 E cheaply). Handle loading + not-found + rapid-switch race (cancel stale response).
- Header: `job# · name`, **workflow** status badge (`getJobStatus` — NOT the voided health badge), work-type subtitle, close.
- Tabs Overview/Crew/Production/Files — **Overview wired; Crew partial; Production + Files "Coming soon."**
- Overview (wire live): Customer, Location, Job Type, Job Status, Start/End, **Total Scheduled Work Days**, Crew Size (avg), Allocations, Mobilizations, Notes.
  - **Work-day count MUST match the bars (round-2 F):** compute via `workedDaySet` over the job's block ranges — the same source the bars use — NOT `DaysModal`'s WTC-tagged-date path. Pane ≡ bars, or label a differing figure distinctly.
- Schedule Progress (Day X of N) with **N≤0 guard** (round-2 L). Production %, photo slot, Recent Activity → shared **"Coming soon"** placeholder (L).
- **Open Job / Edit Schedule** → `useNavigate()` to `/schedule/jobs/:jobId`. Health badge omitted/Coming-soon (D7).

### §8.3 Interaction (both panes)
- **Filter change closes a filtered-out selection (round-2 K):** if a crew/status filter drops the `selectedJobId`, clear it; the day pane re-derives from `filteredJobs`. Verify A's filter handlers do this; add if not.
- **Coming-soon integrity:** honest placeholders only — never a fabricated/zero value that reads as real.
- One shared `ComingSoon` placeholder component (L); pin the side-pane convention (N).

### §8.4 Files
- **New:** `components/CalendarDayPane.jsx`, `components/CalendarJobPane.jsx`, a shared `ComingSoon` placeholder.
- **Edit:** `Calendar.jsx` — three-column layout wrapper + render both panes off `selectedDate`/`selectedJobId` + the lazy per-job fetch.
- **Reuse:** `loadJobWithWTCs`, `getJobMobilizations`, `computeMobCosts`, `workdays.js`, `barMeta`, `getJobColor`, `getJobStatus`. **No** table/RLS/migration; read-only (Open/Edit navigates to `JobDetail`).

### §8.5 Estimate
~1 day (B ~half, C ~half). Build both on one branch off updated `main`; gate together. Model: opus 4.8, medium.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-09-06 — **Chunk B/C scope** (day pane + job pane). Consumed by `/runaudit`._

### Bottom line (plain English)
This slice is the two side panels — the day list and the job-detail card. The day panel reuses data the calendar already has; the job card fetches one job's details when you click it. Nothing writes, no money or database. Point **2 reviewers** at it: one on the job card's data (does its "work days" number match the bars, does the single-job fetch handle loading/rapid-clicking cleanly, do the "Coming soon" slots never show fake numbers), one on the click + layout behavior (panels open/close right, the new 3-column layout doesn't break the grid or the capacity strip, filtering closes a stale-open panel). Small, focused check.

### Round
- Plan type: feature
- Slice: **Chunk B/C** (separate build slice from the shipped Chunk A)
- Sizing basis: full-surface for the B/C slice (§8) — the bar algorithm (Chunk A) is already shipped + audited; do NOT re-audit it.
- Findings trend: round 1 (11) → round 2 / Chunk A (14, shipped clean) → Chunk B/C (?)

### Prior rounds
- Round 1: `a41283d`/`23b68dc` · 2H/4M/5L · `phantom-helper-refs`
- Round 2 (Chunk A): `f9bafa7` · 4H/7M/3L · `mockup-outruns-data` (shipped, gates clean)

**Briefing for agents:** attack ONLY the §8 B/C surface (the two panes + the 3-column layout wrapper + the lazy per-job fetch). Chunk A (bars/color/labels/mandatory-lead) is shipped and separately audited — don't re-litigate it. Its seams (`selectedDate`/`selectedJobId`, `workdays.js`, `barMeta`, `jobBlocks`) are the givens you build on.

### Deployment context
- **Live tenants:** 1 — HDSP only
- **Prod/staging/dev:** Calendar is live in prod (`www.scmybiz.com`, `/schedule/calendar`); Chunk A merging
- **Blocking flags:** none
- **Concurrency:** solo / ≤5

Read-only surface → severity inherently bounded. Cross-tenant caps at Med; multi-user races cap at Low.

### Time budget + finding cap
- **Time budget:** ~1 day (~480 min). Finding cap `max(3, ceil(480/10))` = 48 — upper bound, not a target; prioritize job-pane data parity + coming-soon integrity + layout-doesn't-break-the-grid, quarantine the rest.

### Surface
- Section: §8 (+ §2.4/§2.5 design)
- [LOCKED] decisions: pane behaviors (§8.1–§8.3), D2/D3/D7 apply
- [DESIGN-OPEN] items: day-pane Crew View/Summary tabs wired vs coming-soon; Schedule Progress wired now — safe coming-soon defaults
- Plan-to-code ratio: healthy

### Layers touched
- UI / components (two panes + the three-column layout wrapper)
- Data layer (lazy per-job `loadJobWithWTCs` on selection + `getJobMobilizations`/`computeMobCosts` derivations; day pane reuses already-loaded data)

### New mechanisms introduced
- New components: `CalendarDayPane.jsx`, `CalendarJobPane.jsx`, shared `ComingSoon`
- New data path: **per-job lazy fetch on `selectedJobId` change** (loading / not-found / stale-race handling)
- New layout: three-column wrapper around the existing grid
- No new columns/tables/triggers/RLS/routes/cron. Reuses `/schedule/jobs/:jobId`.

### Cross-system reach
none — read-only web UI; no other repo, no external service, no service-role/bypass write path.

### Irreversibility
none — all reversible; no migration/backfill/public-API change.

### Known weak points
- **Job-pane work-day count diverging from the bars (round-2 F, highest risk).** Must compute via `workedDaySet` over block ranges — the same source the bars use — not `DaysModal`'s WTC-tagged path, or the pane count silently contradicts the rendered bars.
- **Lazy per-job fetch races.** Rapid job switching: a slow earlier response must not overwrite a newer selection (cancel/guard). Loading + not-found states must be explicit.
- **Coming-soon integrity.** Health badge, Production %, photo, Files, Recent Activity must be honest placeholders — never fabricated/zero values that read as real.
- **Layout wrapper breaking existing surface.** The three-column wrapper must not break the grid, the day-name header, the week rows, or the `WeeklyCapacityBand` above.
- **Day-pane membership must match the bars.** Use the same `jobBlocks` + `workdays.isWorkedDay` predicate, not a separate "active on this date" rule, or the pane lists jobs the grid doesn't show (and vice-versa).
- **Filter-out selection not closing the pane (round-2 K).** A filtered-out `selectedJobId`/`selectedDate` must clear.
- **Read-only guarantee.** Panes mutate nothing; Open Job/Edit Schedule navigate to `JobDetail` (the only write path, intended).

### Open questions
- Count: ~2 (day-pane Crew View/Summary wired vs coming-soon; Schedule Progress wired now) — safe coming-soon defaults.

### Suggested attack angles (2 total)
1. **Job-pane data correctness + lazy fetch.** Covers Data layer. Required reading: `CalendarJobPane.jsx` (new), `queries.js` (`loadJobWithWTCs:598`, `getJobMobilizations:128`, `computeMobCosts:173`), `workdays.js` (`workedDaySet`), `calendarBars.js` (`jobBlocks`). Pressure: does the pane's "Total Scheduled Work Days" match the bars (F, via `workedDaySet` over blocks, not the DaysModal WTC path)? single-job fetch loading/not-found/**stale-race** handling? mob/cost derivations get the hydrated job (E)? pagination on any `.in()`? no fabricated "Coming soon" values?
2. **UI / interaction + layout + read-only.** Covers UI/components. Required reading: `Calendar.jsx` render (`:420–547`) + the new layout wrapper, `CalendarDayPane.jsx` (new), `JobDetail.jsx` (nav target), module styling. Pressure: 3-column wrapper doesn't break grid/day-header/week-rows/`WeeklyCapacityBand`; panes open/close off `selectedDate`/`selectedJobId`; **"+N more" opens the day pane**; day-pane membership matches the bars (same `workdays` predicate); filter-out closes a stale selection (K); `stopPropagation` on pane internals (M); read-only guarantee; CSS-var styling; pinned pane convention (N).

### Suggested agent count: 2

Rationale: two distinct risk layers (job-pane data/lazy-fetch correctness vs UI/layout/interaction), read-only with zero cross-system/irreversible surface, low novelty (panes render off Chunk A's existing selection hooks). The bar algorithm — the reason Chunk A needed 3 — is already shipped and out of scope here.
