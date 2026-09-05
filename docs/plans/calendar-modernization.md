# Plan — Schedule Command Calendar Modernization

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PARKED (scaffolded 2026-09-05) — inspection started, not yet planned.

Repo: `sales-command` · Branch: `feat/calendar-modernization` · Route: `/schedule/calendar` → `src/schedule/views/Calendar.jsx`

---

## §0 Baseline (observed current state) [TODO — verify before planning]
<!-- What exists today, file:line / query evidence; read-verified vs run-verified. -->
- Calendar route: `src/schedule/ScheduleLayout.jsx:322` → `src/schedule/views/Calendar.jsx`
- Schedule module: `src/schedule/` (views, components, lib) — Mobs, allocations, weeks, capacity strips present.
- TODO: capture mobilization + allocation data model, jobsByDate derivation, crew/capacity source, production/PRT source.

## §1 Problem / intent [LOCKED]
Modernize the Schedule Command > Calendar screen into the high-level visual command center for scheduling
(month + week views, day pane, job details pane), reusing existing source-of-truth data. Not a greenfield
calendar, not a parallel scheduling system. Inspect → reuse → derive. Full spec: see /detach invocation.

## §2 Proposed change [TODO — after ID8]

## §3 Files to touch [TODO]

## §4 Out of scope / deferred [TODO]

## §5 Estimate / time budget [TODO]
