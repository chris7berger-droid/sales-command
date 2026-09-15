## Status

Crews correction complete — waiting on Chris preview accept. **Do not merge.**

## Crews source-of-truth decision

Field Command → Crews is an office operational command view of **Crew Scheduler scheduled truth**.

| Question | Source |
|---|---|
| Who is scheduled, on which crew/job, on which date | `assignments` (`job_id` = `jobs.job_id`, `crew_name`, `date`, `mobilization_id`) |
| Trip / mobilization window and label | live `job_mobilizations` |
| Job / customer / location | `jobs` + `call_log` (same flattening Crew Scheduler uses) |
| Roster | `crew` (non-archived) |
| Crews Off | `crew_status` for the selected date, `status !== 'available'` only |

**Not used for this screen:** `job_crew`. There is no Schedule → `job_crew` bridge and no duplicated assignment writes.

The board is assembled with Schedule's existing `crewWeekRows` / `crewRowInRange` helpers (`src/schedule/lib/crewScheduleRows.js`) so Field does not invent a second definition of who is on a trip that day. Unassigned rows are in-range saved trips with **zero** assignments that date — not people who happen to be free. Off is never inferred from an empty assignment day.

Planned/scheduled status on assigned rows is `getJobStatus(job)` (Scheduled / In Progress / On Hold / Ongoing). This pass does not manufacture On Site / Mobilizing / clock times from missing phone Field data. Mobilization shows the trip label or dated trip range. Notes show existing `job_mobilizations.note` only.

Date default is today (`tod()`). Changing Date re-queries that day (`fetchFieldCrewBoard({ date })`). Crew / Job / Status / category filters compose client-side on that day's command-view dataset. Clear Filters restores today + All Crews + empty job search + All status + All category.

Default row order: assigned crews by **first name** ascending (`"Last, First"` flipped the same way Crew Scheduler does), then off rows (same first-name sort), then unassigned jobs by job number. Crew name is the first column. Unassigned is labeled Unassigned — no fabricated crew record.

Summary cards are clickable filters (Crews Out / Jobs Covered / Jobs Unassigned / Crews Off) and share one `category` state with the All · Crews Out · Unassigned · Crews Off chips. Counts come from the same underlying command-view dataset.

## Prior Field window repair (still on this branch)

Other Field boards (Jobs, Today, Time Clock, Daily Logs, Load-Outs) still use the earlier read-window repair: live `job_mobilizations` dates first, then effective job dates. Those screens were **not** changed in this Crews pass.

## Files changed (this Crews pass)

- `src/field/lib/crewBoard.js` — command-view assembly + first-name sort + filters (reuses `crewWeekRows`)
- `src/field/lib/crewBoard.test.mjs` — assertions for sort, unassigned vs off, filters
- `src/field/lib/queries.js` — `fetchFieldCrewBoard({ date })` read of assignments / trips / crew / crew_status / jobs
- `src/field/views/Crews.jsx` — approved office command layout
- `src/field/components/FieldScreen.jsx` — optional clickable StatStrip + compact/rowStyle table (other Field screens unchanged unless they opt in)

Not changed: Schedule assignment writers, `job_crew`, Jobs / Today / Time Clock / Daily Logs / Load-Outs, phone UI.

## Implementation decisions

- Import `crewWeekRows` from Schedule, not `schedule/lib/queries.js` (that module still balloons the bundle).
- Crews Off labels: `sick` → Sick, `off` → Off, `noshow` → No Show (Crew Scheduler's stored values).
- JOBS COVERED card filters to the same assigned rows as CREWS OUT (counts still differ: unique people vs unique jobs).
- View Schedule links to `/schedule/schedule`. Refresh remains for live reload.

## Verification

- `node src/field/lib/crewBoard.test.mjs` ✅
- `npx eslint src/field` ✅
- `npm run build` ✅
- PR #60 Vercel preview: **Ready** ✅
  - https://sales-command-git-cursor-fi-6116b8-chris7berger-droids-projects.vercel.app
  - this-commit alias: https://sales-command-2qe3l3c5k-chris7berger-droids-projects.vercel.app

## Visual verification

Rendered the real Field Crews chrome (`FieldScreen`, `StatStrip`, `FilterChips`, `StatusChip`, `PlainTable`) against a fixture built by `buildCrewCommandView` from assignments + trips + `crew_status`:

- Heading CREWS / subtitle Who's where. What's the plan.
- Clickable cards: Crews Out 2 of 3 total (active state), Jobs Covered 1 of 2 scheduled, Jobs Unassigned 1, Crews Off 1
- Crew-first table: Amy Nguyen then Chris Berger (first-name sort), Pat Diaz Sick (red, not treated as unassigned), Unassigned #10025 No Crew
- Espresso header, teal chips, linen surfaces, no white board background; teal CTA uses black text

The committed `Crews.jsx` also has the Date / Crew / Job / Status / Clear Filters row (not in that fixture snapshot). Authenticated `/field/crews` live-data walk is for Chris on the Ready preview — this environment has no real Supabase session.

## Deviations

- Did not invent mock “Crew 1 / Crew 2” grouped labels from the review mockup. Authoritative crew records are people on `crew.name`; first-name sort matches that.
- Did not invent On Site / Mobilizing / clock-in times. Status is scheduled job status or real off/no-crew labels.
- Did not add row kebab menus (screen is read-only).
- Did not paginate; footer is a showing-count only.

## Issues / follow-up

- Chris: walk `/field/crews` on the Ready preview for a real schedule date. Do not merge until accepted.
- Other Field boards still use `job_crew` / phone tables where that is the execution path (Today crew names, Jobs crew counts, punches, logs). Out of scope for this Crews-only correction.
