# Plan — Schedule Command: Ability to Schedule Sunday Work

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PARKED (scaffolded 2026-09-06) — split out of calendar-modernization; not yet planned. Own its own /decide → plan when picked up.

Repo: `sales-command` · Branch: TBD (own branch off main) · Related: `docs/plans/calendar-modernization.md` §0/§4

---

## §0 Baseline (observed current state) [read-verified against `main` @ 2c2d5ed]

The business runs a **6-day week (Mon–Sat)** and every crew/week surface is **hardcoded Mon–Sat — Sunday is structurally absent**:
- `views/Daily.jsx:11` `DAYS = ['Mon'..'Sat']` · `views/Schedule.jsx:9–10` `['Mo'..'Sa']` / `['Mon'..'Sat']` · `components/StatsBar.jsx:4` `['Mon'..'Sat']` · `lib/exports.js:60,135` `['Mon'..'Sat']`.
- `wkDates(monday)` (canonical export `lib/queries.js:1621`; local copies in `Daily`/`StatsBar`/`exports`) returns **6 days Mon–Sat**. `getMonday()` folds Sunday back into the prior Monday's week.
- **Weekend-exception (partial support already exists):** `DaysModal.jsx:48–50` + `StageJobCard.jsx:51–53` count a weekend day (`dow===0||dow===6`) *only if* an `assignments` row exists that day. So a Sunday assignment, if one somehow existed, would be *counted* and would *show on the month calendar* (`Calendar.jsx`/`Schedules.jsx` render a Sunday column) — but there is **no UI path to create one** (the Mon–Sat crew grids have no Sunday column) and it is invisible on Daily/Schedule/capacity/exports.

**Net gap:** Sunday work can be *counted/shown* by exception but cannot be *scheduled or managed*. The original version omitted it.

## §1 Problem / intent [LOCKED]
Give schedulers the ability to schedule (create/view/manage) crew work on **Sunday** when a job genuinely runs on a Sunday — without forcing Sunday onto the normal 6-day week. Sunday remains the default day off; this is the exception path made real.

## §2 Proposed change [TODO — plan when picked up]
Likely surface (verify): add a 7th (Sunday) column/handling to the Mon–Sat crew surfaces — `Daily.jsx`, `Schedule.jsx`, `StatsBar.jsx` (capacity band), `exports.js` — and to `wkDates` (extend to optionally include Sunday, or a parallel 7-day helper). Decide: always-on 7-day grid vs on-demand Sunday column that appears only when Sunday work exists (mirrors the existing weekend-exception mental model). Ensure the assign/day modals allow picking Sunday. Cross-check `getMonday`/week-bucketing so a Sunday isn't mis-bucketed.

## §3 Files to touch [TODO]
## §4 Out of scope / deferred [TODO]
## §5 Estimate / time budget [TODO — cross-cutting change across the Mon–Sat surfaces; not trivial]

---
_Split from calendar-modernization on 2026-09-06 (Chris chose to keep Sunday-scheduling as a sibling, not fold it into the calendar build). The calendar build makes bars weekend-aware (shows an assigned weekend day) but adds no create-Sunday path — that lives here._
