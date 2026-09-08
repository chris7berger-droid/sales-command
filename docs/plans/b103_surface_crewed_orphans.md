# B103 — Surface crewed orphan jobs on the schedule

Branch: `fix/b103-surface-crewed-orphans` (off main @ origin/main, 2026-09-08)
Backlog: `docs/BACKLOG.md` B103 (T1). Part of B86/B87 workstream.

## The bug (plain)

The schedule board, calendar, daily view, and exports hide any job that has no
Sales link (`call_log_id IS NULL`). B86 shipped that hide on the premise "no
Sales link = phantom row." Wrong: some of those jobs have **real crew assigned**.
So Weekly Crew Capacity says 19 assigned, but the board shows fewer, tooltips
show raw IDs, and Daily Crew Status prints "—" for crew who ARE working.

Data is fine. It's a display filter, not data loss.

## Why it mismatches (verified in code)

- `WeeklyCapacityBand.jsx:27` reads the `assignments` table directly → counts
  every assigned crew-day, including on hidden jobs.
- All other readers go through `loadJobs()` in `src/schedule/lib/queries.js:515`,
  which does `.not('call_log_id','is',null)` → drops the crewed orphans.
- Same filter is copy-pasted 4× in `src/schedule/lib/exports.js` (lines 65, 97,
  116, 143).
- "Has crew" is NOT a column on `jobs`; it's the existence of an `assignments`
  row for that `job_id`. So the fix can't be a one-line PostgREST filter swap.

## The rule (LOCKED)

Hide an unlinked job **only if it also has no crew**.

- `call_log_id` present            → show (unchanged).
- `call_log_id` NULL + has crew    → **show** (real-but-unlinked). NEW.
- `call_log_id` NULL + no crew     → hide (true phantom, unchanged).

## AMENDMENT 2026-09-08 — show everything, flag the broken (supersedes the rule above)

Chris's call: the app must never be the one deciding what he doesn't see. Real
people are never assigned to something he shouldn't be looking at, so crew on a
job proves it's real — but "hide unless crewed" still hides the empty ones, and
hidden bugs are the dangerous ones (his standing discipline). New model:

- **Show EVERY active job** — linked or not, crewed or not. No hide, ever.
- An unlinked job (no Sales link) is **flagged, not hidden**: keep its name/number
  and mark it with a **⚠**; if it has no name at all, show **"Needs fixing — not
  linked to Sales"** instead of a blank or a bare id.
- The empty phantoms now show too — with the ⚠ and no crew — which is the nudge
  to clean them up, not something to bury.

This also fixes the reported symptom directly: nothing is dropped, so the board
count matches the Weekly Crew Capacity count. The crewed-set filter is gone;
the flag lives in `normalizeJob` so every surface (board, calendar, daily,
exports, modals) shows it from one place.

## Plan

### Part 1 — resolve the 3 current jobs (do first, data-only, no code)
Verified in prod 2026-09-07, only these 3 unlinked jobs are current/future:
- #6665 K7 — Darrin Ary, Adam Little
- #6814 Kalb — Axel
- #10252 Dave Lee (job_id 1278) — Bash Dave, Fri

Action: link each to its call_log if one exists; otherwise leave unlinked — the
Part 2 fix will surface them because they have crew. (No hide-flag exists; the
only lever is `call_log_id`.) Decide per-job at build time.

### Part 2 — fix the filter (the actual code change)
In `loadJobs()` (`queries.js`):
1. Stop hiding purely on null `call_log_id`.
2. Fetch the set of `job_id`s that appear in `assignments` (any date — a crewed
   job is real regardless of when).
3. Keep a job when: `call_log_id` is present **OR** its id is in the crewed set.
   Drop only null-link + no-crew rows.
4. Do the crew check server-side if clean, else post-filter the fetched rows
   client-side (small row counts; fine).

Keep the `includeUnlinked: true` escape hatch working — the Unallocated bucket
(`queries.js:580`) must still see genuine phantoms, so it opts out of the new
crew filter too (it wants everything unlinked, crewed or not).

Then apply the same show-crewed-orphans logic to the **4 exports.js reads** so
exports match the board. Prefer routing exports through `loadJobs` if feasible;
otherwise replicate the crewed-set filter.

### Part 3 — historical orphans (no urgency, defer)
~50 unlinked jobs have past `last_date`. Once Part 2 ships, crewed historical
orphans surface in history views; truly phantom ones stay hidden. No cleanup
task unless Chris wants a sweep. Leave as a backlog note.

## Files to touch
- `src/schedule/lib/queries.js` — `loadJobs()` (the one shared choke point).
- `src/schedule/lib/exports.js` — 4 reads (lines 65, 97, 116, 143).
- No new columns, no DB migration, no RLS, no edge fn. Read-path only.

## Verify (before calling done)
- Board / Calendar / Daily now show #6665, #6814, #10252 with real crew names
  (not raw IDs, not "—").
- Weekly Crew Capacity count matches what the board shows for the week.
- A genuine phantom (null link, zero assignments) still does NOT appear on the
  board but DOES appear in the Unallocated bucket.
- Exports include the crewed orphans.
- `npm run build` clean. Smoke on preview against the 3 known jobs.

## Not doing
- No security review (T6): no access rules, grants, auth, money, or public page.
- No tombstone UI for phantoms — hiding them is the existing behavior; keep it.
- No historical cleanup sweep (Part 3) unless asked.
