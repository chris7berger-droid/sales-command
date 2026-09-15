## Status

Scheduled Off date-range workflow complete — waiting on Chris preview accept. **Do not merge.**

No production `crew_status` rows were migrated. No `assignments` rows are deleted or moved by this flow.

## Summary

Scheduled Off is planned availability. The office must be able to mark a crew member off for any future date or date range without first navigating Crew Scheduler to that week.

The previous pass added stored `scheduled-off` but still used the visible-week day picker, so Oct 12–16 could not be entered while viewing Sep 14–19.

This pass gives Scheduled Off its own FROM/TO modal. Sick, Call In, and No Show keep the existing week day-picker.

## Interaction

- Chip **Off** opens `ADAM LITTLE — SCHEDULED OFF` (display name, uppercase).
- FROM and TO are native date inputs. Defaults: both = today (one-day is one click).
- Presets: Today, Tomorrow, This Week (Mon–Sat), Next Week (Mon–Sat).
- Custom range is not clamped to the displayed week. Inclusive FROM→TO. TO cannot precede FROM.
- Primary **Schedule Off** (renders as SCHEDULE OFF). Secondary **Cancel**.
- Sick / Call In / No Show still open the Mon–Sat day picker for the week on screen.

## Storage

Canonical stored value remains `scheduled-off`.

One `crew_status` row per person/date in the inclusive range (`UNIQUE(crew_name, date)` upsert). Available stays “no row.” Legacy `off` rows are not rewritten.

This Week / Next Week presets follow Crew Scheduler’s Mon–Sat week. A custom range may include Sunday (no new Sunday skip was invented). Sunday still does not appear on the Mon–Sat board (F60).

## Conflict behavior

Before write, the modal loads `crew_status` and `assignments` for the selected person and date range (not the visible week).

| Existing row on a day in range | Write |
|---|---|
| no row / `available` | upsert `scheduled-off` |
| already `scheduled-off` | leave as-is |
| `sick` / `off` (Call In) / `noshow` / other | do **not** overwrite; list the days |

If any day in the range has an `assignments` row:

- Do not delete, move, or reassign it.
- Show: “{Name} has existing job assignments during this Scheduled Off period.” plus date + job number/name.
- Explain that Scheduled Off records planned unavailability; existing assignments stay and may need coverage.
- User may Cancel or Confirm Scheduled Off.

If there are no assignment conflicts and no blocking status conflicts, Schedule Off writes immediately.

Cancel closes the modal with no writes.

`assignments` = planned work. `crew_status.status = scheduled-off` = planned unavailability. They may coexist; that is a real conflict, not auto-resolved.

## Model (unchanged)

| Stored `crew_status.status` | Crew Scheduler | Field Crews |
|---|---|---|
| *(no row)* | Available | not an exception |
| `sick` | Sick (S) | **Called Out** |
| `off` | Call In (C) | **Called Out** |
| `scheduled-off` | Scheduled Off (Off) | **Scheduled Off** |
| `noshow` | No Show (N) | **No Show** |

## Files changed (this pass)

- `src/schedule/lib/crewStatus.js` — range helpers + `planScheduledOff`
- `src/schedule/lib/crewStatus.test.mjs` — inclusive range, week presets, status/assignment conflicts
- `src/schedule/components/ScheduledOffModal.jsx` — FROM/TO modal + confirm warning
- `src/schedule/views/Schedule.jsx` — Off opens range modal; S/C/N unchanged; write only `writeDays`
- `src/schedule/App.css` — Scheduled Off modal styles
- `docs/agent-handoffs/BUILD-REPORT.md`
- `docs/BACKLOG.md` — F56 note

Not changed: Field Command (mapping already compatible), Sick / Call In / No Show pickers, assignment writers, legacy `off` rows, PTO table, Left Early.

## Verification

- `node src/schedule/lib/crewStatus.test.mjs` ✅
- `node src/field/lib/crewBoard.test.mjs` ✅ (unchanged this pass)
- `npx eslint src/schedule/lib/crewStatus.js src/schedule/components/ScheduledOffModal.jsx` ✅
- `npm run build` ✅
- Pre-existing unused-var eslint on `Schedule.jsx` not cleaned up

This VM has mock Supabase (`localhost`). Authenticated Crew Scheduler walk (Off → Oct range while viewing Sep, conflict warning, Cancel vs Confirm) is for Chris on the preview.

## Visual verification

Layout/CSS reviewed against existing Crew Scheduler modal language (sand card, uppercase title, `sch-btn`). Live click-through requires preview login.

## Deviations From Handoff

None.

## Issues / Follow-up

- Existing `off` person-days still display as Call In / Called Out until marked Scheduled Off.
- If a production CHECK rejects `scheduled-off`, add that value additively in `command-suite-db`. Do not remap `off`.
- Coexistence of assignment + `scheduled-off` is left for Field Command to surface operationally later. Not in this pass.
