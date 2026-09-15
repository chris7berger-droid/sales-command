## Status

Scheduled Off model/UI correction complete — waiting on Chris preview accept. **Do not merge.**

No production `crew_status` rows were migrated.

## Summary

Crew Scheduler had no Scheduled Off type. The **O** control stored `off`, which Daily already treated as **Call In**, while the Crew Schedule legend said **Off**. Field mapped both `sick` and `off` to **Called Out**. That is why a planned day off (Misa) could appear as Called Out.

This pass adds a distinct stored status `scheduled-off`, maps it to **Scheduled Off** in Field Crews, and relabels Call In so **O/Off** is no longer the Call In control.

Existing `off` rows are left unchanged (Call In / Field **Called Out**). Remapping them to Scheduled Off would be an ambiguous data migration.

## Root cause

- Data model: `crew_status.status` had only `sick` / `off` / `noshow`. Available = no row.
- UI vocabulary: Crew Schedule legend **Off** wrote Call In (`off`).
- Field mapping: `sick` and `off` both displayed **Called Out**.

Missing assignment is still not treated as Scheduled Off.

## Model

| Stored `crew_status.status` | Crew Scheduler | Field Crews |
|---|---|---|
| *(no row)* | Available | not an exception |
| `sick` | Sick (S) | **Called Out** |
| `off` | Call In (C) | **Called Out** |
| `scheduled-off` | Scheduled Off (Off) | **Scheduled Off** |
| `noshow` | No Show (N) | **No Show** |

Available remains “delete the row.” No punches. No invented jobs.

## Data migration

**Not performed.** Existing `off` rows stay Call In. Misa on Sep 15 will keep showing **Called Out** until an operator marks that day **Scheduled Off** (writes `scheduled-off`). This environment still cannot read the live row.

No CHECK constraint for `crew_status.status` exists in this repo. YESv2 import already writes the sheet `Status` string as-is. If production rejects `scheduled-off` on upsert, stop and add an **additive** allowed-value (not a remap of `off`).

## Files changed (this pass)

- `src/schedule/lib/crewStatus.js` — stored values + UI labels
- `src/schedule/lib/crewStatus.test.mjs`
- `src/schedule/views/Schedule.jsx` — C = Call In (`off`); Off = Scheduled Off (`scheduled-off`); legend/modal/week-popup labels
- `src/schedule/App.css` — `sch-cdot-soff`, wider Off button
- `src/schedule/views/Daily.jsx` — Scheduled Off section; empty cell legend **Not assigned** (was **Off**)
- `src/schedule/lib/exports.js` — print uses UI labels
- `src/schedule/components/StatsBar.jsx` / `HomeCapacityStrip.jsx` — Out detail uses UI labels
- `src/field/lib/crewBoard.js` — Scheduled Off exception label/filter/key
- `src/field/lib/crewBoard.test.mjs`
- `src/field/views/Crews.jsx` — muted chip for Scheduled Off (Called Out / No Show stay red)

Not changed: other Field screens, phone UI, assignment writes, existing `crew_status` rows.

## Implementation decisions

- New stored value `scheduled-off` rather than reusing `off`.
- Call In keeps stored `off` so historical Call In data is not rewritten.
- Crew Schedule **C** matches Daily’s Call In letter; **Off** writes the new type.
- Field still collapses Sick + Call In to Called Out (approved earlier). Only Scheduled Off is split out.
- Scheduled Off still counts as out / exception (not available to assign). Expected Job still comes from `assignments` when one exists.
- No inference from a blank assignment.

## Verification

- `node src/schedule/lib/crewStatus.test.mjs` ✅
- `node src/field/lib/crewBoard.test.mjs` ✅
- `npx eslint src/field src/schedule/lib/crewStatus.js src/schedule/views/Daily.jsx src/schedule/lib/exports.js` ✅
- `npm run build` ✅ (this pass)
- Pre-existing eslint noise in `Schedule.jsx` / `StatsBar.jsx` / `HomeCapacityStrip.jsx` (unused vars / hooks) not cleaned up

This VM has mock Supabase only. Live Misa/Adam rows and the new Off control on Crew Schedule must be checked on the preview.

## Visual verification

Unit tests cover Field labels: `scheduled-off` → Scheduled Off; `sick`/`off` → Called Out; no assignment → blank Expected Job. Authenticated Crew Schedule (C / Off buttons, legend) and Field Exceptions chips are for Chris on the preview.

## Deviations From Handoff

None.

## Issues / Follow-up

- Existing `off` person-days (including Misa if her Sep 15 row is `off`) still display as Call In / Called Out until marked Scheduled Off in Crew Scheduler.
- If a production CHECK rejects `scheduled-off`, do not remap `off`; add the new value to the constraint in `command-suite-db`.
