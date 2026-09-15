## Status

Scheduled Off lifecycle (create → see → edit → remove) complete — waiting on Chris preview accept. **Do not merge.**

No production `crew_status` rows were migrated. No `assignments` rows are deleted or moved.

## Summary

Scheduled Off is planned availability. The office can:

1. **Create** a future FROM/TO range without navigating to that week.
2. **See** gray Mon–Sat compact dots on that week from stored `scheduled-off` rows.
3. **Edit** a contiguous range from the crew detail view.
4. **Remove** that range after confirmation.

Sick, Call In, and No Show keep the existing week day-picker. Legacy `off` is not treated as Scheduled Off.

## Compact indicators

Crew chips render M/T/W/T/F/S dots for:

- assigned crew (existing job rows), and
- unassigned crew who have `scheduled-off` on any day this week.

`scheduled-off` uses legend gray (`sch-cdot-soff` / `sch-dot-of`). Legacy `off` stays the Call In orange dot. Empty days stay the faint unused dot.

Example: Adam Little `scheduled-off` Oct 12–16 while viewing that week → gray Mon–Fri. Sat Oct 17 is unchanged.

`crew_status.date` keys are normalized to `YYYY-MM-DD` so timestamp-shaped values still match the week dates.

## Crew detail

The existing crew week popup still shows the week STATUS grid.

It also loads that person’s `scheduled-off` rows (not `off` / `sick` / `noshow`) and groups contiguous calendar days:

```
SCHEDULED OFF
Oct 12 – Oct 16, 2026
EDIT DATES
REMOVE SCHEDULED OFF
```

Separate gaps are separate ranges, each with its own Edit / Remove.

## Edit Dates

Opens the existing FROM/TO modal with that range pre-filled.

Save updates **only** `scheduled-off` rows belonging to that range:

- days added: upsert `scheduled-off` (unless another explicit status is already there)
- days removed from the range: delete `status = scheduled-off` only
- other Scheduled Off ranges, `sick`, `off`, `noshow`, and `assignments` are untouched

Expanding onto Sick / Call In / No Show still surfaces a conflict and does not overwrite. Assignments in the new range still warn; they are not deleted or moved.

Example: Oct 12–16 edited to Oct 12–14 → Oct 12–14 remain `scheduled-off`; Oct 15–16 `scheduled-off` rows are deleted.

## Remove Scheduled Off

Confirmation:

```
Remove Adam Little's Scheduled Off
Oct 12 – Oct 16, 2026?
```

Confirm deletes only `crew_status` rows with `status = scheduled-off` for that person and those dates. Cancel writes nothing.

## Storage (unchanged)

| Stored `crew_status.status` | Crew Scheduler | Field Crews |
|---|---|---|
| *(no row)* | Available | not an exception |
| `sick` | Sick (S) | **Called Out** |
| `off` | Call In (C) | **Called Out** |
| `scheduled-off` | Scheduled Off (Off) | **Scheduled Off** |
| `noshow` | No Show (N) | **No Show** |

Not inferred from a missing assignment, punch, or phone activity.

## Files changed (this pass)

- `src/schedule/lib/crewStatus.js` — contiguous ranges, labels, edit add/remove plan, compact-dot kind
- `src/schedule/lib/crewStatus.test.mjs`
- `src/schedule/components/ScheduledOffModal.jsx` — pre-filled FROM/TO; edit remove-day note
- `src/schedule/views/Schedule.jsx` — gray week dots, detail ranges, edit/remove writers
- `src/schedule/App.css` — detail range actions
- `docs/agent-handoffs/BUILD-REPORT.md`
- `docs/BACKLOG.md`

Not changed: Field Command, Sick / Call In / No Show pickers, assignment writers, leftover `off` rows.

## Verification

- `node src/schedule/lib/crewStatus.test.mjs` ✅ (Oct 12–16 gray Mon–Fri / Sat empty; shrink deletes 15–16; sick not overwritten; assignment warning; legacy `off` not deleted)
- `npx eslint src/schedule/lib/crewStatus.js src/schedule/components/ScheduledOffModal.jsx` ✅
- `npm run build` ✅
- Pre-existing unused-var eslint on `Schedule.jsx` not cleaned up

This VM has mock Supabase. Authenticated create → navigate to week → gray dots → detail range → edit → remove is for Chris on the preview.

## Visual verification

CSS reuses Crew Scheduler modal/button language. Live click-through requires preview login.

## Deviations From Handoff

None.

## Issues / Follow-up

- Existing `off` person-days still display as Call In / Called Out until marked Scheduled Off.
- If a production CHECK rejects `scheduled-off`, add that value additively in `command-suite-db`. Do not remap `off`.
- Assignment + `scheduled-off` coexistence is still a real conflict; this pass does not auto-reassign.
