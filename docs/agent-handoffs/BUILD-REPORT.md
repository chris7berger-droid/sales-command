## Status

Partially Complete

## Root Cause

Field Command boards were reading "active" jobs through a `scheduled_start`-only model:

- `fetchActiveFieldJobs` filtered `jobs` with `scheduled_start IS NOT NULL`.
- Field date-window checks (`Today`, `Load-Outs`) only used `scheduled_start/scheduled_end`.

That excluded real active jobs whose operational dates live on `job_mobilizations` (or on `start_date/end_date` fallback) and caused downstream board slices to be empty/incomplete even when live field records existed.

Secondary issue found during implementation: importing Schedule's large query module directly into Field's read layer created an unnecessary coupling risk. The final fix keeps Field's read model local and lightweight while still honoring established date authority.

## Data Paths Verified

### Jobs

- **Data path:** `Jobs.jsx` → `fetchFieldJobs()` → `fetchActiveFieldJobs()` + `job_crew` count rollup.
- **Was wrong:** Active jobs were dropped when `scheduled_start` was null.
- **Changed:** Active job set now derives operational windows from live `job_mobilizations` rows (when present), otherwise falls back to effective job dates (`scheduled_*` then `start_date/end_date`).
- **Verification:** Query path read-verified in code; lint/build pass.

### Crews

- **Data path:** `Crews.jsx` → `fetchFieldCrews()` → active jobs + `job_crew`.
- **Was wrong:** Missing jobs in the active set suppressed associated crew coverage/missing-crew visibility.
- **Changed:** Crew reads now inherit repaired active-job windowing and preserve PR #58 command-board UI.
- **Verification:** Query path read-verified in code; lint/build pass.

### Daily Logs

- **Data path:** `DailyLogs.jsx` → `fetchFieldLogs()` → `daily_log_entries` filtered by active call-log IDs and date window.
- **Was wrong:** Active-ID list could be under-scoped when upstream jobs were excluded.
- **Changed:** Active-ID list now comes from repaired active-job derivation.
- **Verification:** Query path read-verified in code; lint/build pass.

### Load-Outs

- **Data path:** `LoadOuts.jsx` → `fetchLoadOutJobs()` → active jobs in window + `job_material_checks`; modal hydration via `loadJobWithWTCs()`.
- **Was wrong:** Near-term jobs were filtered out by `scheduled_start`-only window logic.
- **Changed:** Near-term inclusion now uses authoritative per-job operational windows derived from live mobilization rows (fallback effective dates when no mobilization rows exist).
- **Verification:** Query path read-verified in code; lint/build pass.

### Time Clock

- **Data path:** `TimeClock.jsx` → `fetchFieldPunches()` → `time_punches` for active call-log IDs.
- **Was wrong:** Upstream active-ID under-selection could hide valid punches tied to excluded jobs.
- **Changed:** Active-ID source repaired via new job-window derivation.
- **Verification:** Query path read-verified in code; lint/build pass.

### Today

- **Data path:** `Today.jsx` → `fetchTodayRows()` → active jobs that span today + `time_punches`, `daily_log_entries`, `daily_production_reports`, `job_crew`, `job_material_checks`, and `tenant_config` thresholds.
- **Was wrong:** "Running today" jobs were determined by `scheduled_start/scheduled_end` only.
- **Changed:** "Spans today" now evaluates against authoritative per-job operational windows (live mobilizations first, effective-date fallback).
- **Verification:** Query path read-verified in code; lint/build pass.

## Files Changed

- `docs/agent-handoffs/ACTIVE.md` — loaded approved implementation handoff text.
- `src/field/components/FieldScreen.jsx` — preserved/integrated approved command-board shared chrome from PR #58.
- `src/field/lib/display.js` — added stage/log visual helpers used by command-board chips.
- `src/field/lib/useAsync.js` — extracted async loader hook used across Field boards.
- `src/field/lib/queries.js` — repaired active-job/date-window read logic to honor live mobilizations and effective-date fallback.
- `src/field/views/Jobs.jsx` — preserved approved board treatment + live/scheduled/no-crew framing.
- `src/field/views/Crews.jsx` — preserved approved board treatment + people/missing-crew splits.
- `src/field/views/DailyLogs.jsx` — preserved approved board treatment + typed log chips/filters.
- `src/field/views/LoadOuts.jsx` — preserved approved board treatment + readiness chips/modal launch.
- `src/field/views/TimeClock.jsx` — preserved approved board treatment + punch-type chips.
- `src/field/views/Today.jsx` — preserved approved board treatment + operational status board.

## Implementation Decisions

- Preserved the approved PR #58 visual direction for all six desktop Field boards rather than redesigning.
- Repaired Field reads instead of changing authoritative writes:
  - no new write paths,
  - no duplicate date source,
  - no backfill/write-to-`jobs.scheduled_start` workaround.
- Operational date authority used in this order:
  1. live `job_mobilizations` date windows (when present),
  2. fallback effective job dates (`scheduled_*` then `start_date/end_date`).
- Expanded stage matching to include active operational variants seen in existing status vocabulary (`scheduled`, `in progress` variants, `mobilized`, `ongoing`, `on hold` variants).

## Verification

- `npx eslint src/field` ✅
- `npm run build` ✅
- PR preview deployment status on PR #60: **Ready** ✅
- Read-level trace of each Field board from UI component → query helper → source tables completed ✅

## Visual Verification

- Local app run attempted via dev server.
- Login page rendered and route guards behaved as expected.
- Full authenticated `/field/*` live-data walkthrough was blocked in this environment because no authenticated session/credentials were available to enter Field routes.
- Vercel preview is Ready for Chris review:
  - https://sales-command-git-cursor-fi-6116b8-chris7berger-droids-projects.vercel.app

## Deviations From Handoff

- Could not fully complete "rendered real-data visual verification for each Field board" inside this environment due authentication/session unavailability for `/field/*`.
- All implementation, lint/build verification, and preview creation steps were completed.

## Issues / Follow-up

- Chris preview walkthrough (authenticated) is still required to confirm real-data population on:
  - `/field/today`
  - `/field/jobs`
  - `/field/crews`
  - `/field/dailylogs`
  - `/field/loadouts`
  - `/field/timeclock`
- If any board remains unexpectedly empty in authenticated preview, capture the specific route + expected record and trace the exact filter/relationship path from the now-shared active-job window derivation.
