## Status

Expected Job on Exceptions QA complete — waiting on Chris preview accept. **Do not merge.**

## Crews source-of-truth implementation

Unchanged from the prior pass: Field Command → Crews is a **read-only** office view of Crew Scheduler planned truth.

| Question | Source |
|---|---|
| Who is scheduled, on which job, on which date | `assignments` |
| Trip / mobilization | live `job_mobilizations` |
| Job / customer / site | `jobs` + `call_log` |
| Roster | `crew` (non-archived) |
| Exceptions | `crew_status` for dates in the selected window, `status !== 'available'` only |

Still unused: `job_crew`. No Schedule writer changes. No duplicate assignment table.

Out / Unassigned rows still use Schedule’s `crewWeekRows` / `crewRowInRange`. Expected Job on Exceptions is indexed from raw `assignments` × `jobs` for the person/date. Date changes re-query `assignments` and `crew_status` for `[from, to]`.

## Single-day behavior

- Default: Single Day → today.
- Table is **crew-first**. Assigned people sort by first name ascending (`"Last, First"` flipped).
- JOB # is the bare display number (`call_log.job_number`, else the token before `" - "` in `display_job_number`). JOB NAME is `job_name` with `work_type` as secondary. The composite `"10079 - Demo VCT - Carpet"` is no longer stuffed into JOB #.
- Cards / chips filter immediately. Clear Filters restores Single Day, today, All Crews, empty job search, All status, All category.

## Date-range behavior

- Modes: Single Day | Date Range.
- Range presets: This Week (Mon–Sun), Last Week, This Month, Custom (native from/to date inputs).
- Range table includes DATE. Daily assignment rows are not collapsed.
- With a specific crew selected, rows sort chronologically so “where was Adam this week?” is one scan.
- Range + job search and range + Exceptions compose on the same dataset.

## Summary-card count semantics

Counts are computed **after** Crew / Job / Status filters, **before** the category card/chip, from the same command-view rows.

| Card | Count |
|---|---|
| CREWS OUT | distinct people with ≥1 assignment in the window (not assignment-days) |
| JOBS COVERED | distinct jobs with ≥1 assignment in the window |
| JOBS UNASSIGNED | distinct jobs with ≥1 in-window coverage day and no assignment that day |
| EXCEPTIONS | recorded `crew_status` rows in the window (person-days), not distinct people |

A job can appear in both COVERED and UNASSIGNED in range mode if it was staffed some days and not others. CREWS OUT of 1 person with 4 daily rows stays **1**.

Single-day unfiltered hints remain `of N total` (roster) and `of N scheduled` (covered + unassigned). Range cards drop those hints so the number is not mistaken for assignment-days.

## Adaptive Unassigned presentation

Unassigned card/chip switches the same screen to **job-first**:

JOB # · JOB NAME · CUSTOMER · LOCATION · MOBILIZATION · STATUS (No Crew, amber) · NOTES

No fake “Unassigned” crew name. ALL / Crews Out stay crew-first; unassigned rows in ALL show “—” in Crew.

## Supported exception sources / types

Crew Scheduler `crew_status.status` is the only authoritative exception source today (`crew_name` + `date`, default available = no row).

| Stored value | Scheduler UI | Field Crews label |
|---|---|---|
| `sick` | Sick (S) | **Called Out** |
| `off` | Call In (O / CALL) | **Called Out** |
| `noshow` | No Show (N / N/S) | **No Show** |

Exceptions view: Crew, Date, Expected Job, Exception. No time-of-day column — `crew_status` has a date only.

Expected Job is the Crew Scheduler `assignments` row for that person/date. It is **not** taken from the `crewWeekRows` board projection. Called Out / No Show must not blank a scheduled job.

- If an `assignments` row exists and the job can be resolved, show that job.
- If no assignment exists for that person/date, Expected Job stays blank. Do not invent from punches or first-name guesses.
- Name keys accept stored `"Last, First"` and display `"First Last"`. Dates are normalized to `YYYY-MM-DD` so an ISO timestamp on the same calendar day still matches.
- Jobs referenced by an assignment but excluded from the merged/deleted jobs list are fetched by `job_id` so the real job number can still show.

If a person is both assigned and marked unavailable, they count as an exception (not Crews Out). The job still counts as covered because an assignment exists.

## Observed people (Misa Sep 15, Adam Little Sep 7)

This VM has no production Supabase credentials (`VITE_SUPABASE_URL` is localhost mock), so live `assignments` rows for those two people/dates could not be queried here.

Code-path result:

| Person | Date | If an `assignments` row exists | If none exists |
|---|---|---|---|
| Misa | 2026-09-15 | Expected Job shows that job (including timestamp dates) | blank is correct |
| Adam Little (`Little, Adam`) | 2026-09-07 | Expected Job shows that job | blank is correct |

The previous read could drop a real assignment: board `a.date <= end` fails for ISO timestamps on the selected day, then Expected Job looked up `name|YYYY-MM-DD` against the missing board key. That read is corrected. Authenticated confirmation of whether those two live rows exist is on the preview.

## Unsupported / deferred exception types

| Preferred label | Why not implemented |
|---|---|
| Left Early | No stored exception type. Time punches exist on the phone path; there is **no** existing rule that “clock-out before planned end = Left Early.” Do not infer it. |
| Scheduled Off | No distinct PTO/day-off type. Scheduler `off` is Call In, not a scheduled day off. |
| Late / Sent Home / Reassigned | No records. |

Do not treat “no punch” as No Show.

## Files changed (this pass)

- `src/field/lib/crewBoard.js` — Expected Job from raw `assignments` (date normalize, Last/First name keys); board projection no longer required for that cell
- `src/field/lib/crewBoard.test.mjs` — Misa Sep 15 timestamp assignment; Adam Little Sep 7; blank when no assignment / unknown job
- `src/field/lib/queries.js` — fetch jobs referenced by assignments but omitted from the merged/deleted jobs list; normalize `crew_status.date`

Not changed: Crews layout/chrome, other Field screens, phone UI, Crew Scheduler writes.

## Verification

- `node src/field/lib/crewBoard.test.mjs` ✅
- `npx eslint src/field` ✅
- `npm run build` ✅ (this pass)
- No live assignment query for Misa/Adam from this environment (mock Supabase only)
- PR #60 Vercel preview — recheck Exceptions after this commit
  - https://sales-command-git-cursor-fi-6116b8-chris7berger-droids-projects.vercel.app

Authenticated `/field/crews` live-data walk is for Chris on that preview.

## Deviations

- This Week is **Monday–Sunday** so Sunday assignments are not dropped. Crew Scheduler’s board week is Mon–Sat; Sunday work is a known backlog item (F60).
- Scheduler `off` (Call In) and `sick` both display as Called Out. There is no separate Scheduled Off type to show.
- Unassigned in ALL still appears as rows with “—” under Crew rather than hiding them until the Unassigned filter is used — same command dataset, no fake crew name.
