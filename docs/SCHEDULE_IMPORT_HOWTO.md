# How to use the Schedule Import tool — plain-English guide

This is the tool that moves your old **YES Schedule v2** Google Sheet into the
live Schedule. It's live now: **Schedule Command → Import** (under Schedules).

There are two halves:
- **What you do** (in the app — clicking, matching) — this doc.
- **What a technical session finishes** (the actual one-time data load) — points
  to the runbook at the bottom. You don't run that part by hand.

**Nothing moves until the very end.** Uploading and matching only builds a plan.
It auto-saves as you go, and you can close and come back — your work is kept.

---

## The big picture

Your old sheet has ~120 jobs. Each old job needs to be pointed at the matching
real job already in your app (or marked **Internal** if it isn't a customer job).
The tool suggests likely matches; you confirm them. When every old job is either
matched or marked Internal, the plan is ready to load.

---

## Part 1 — Get a fresh copy of the old sheet

1. Open the **YES Schedule v2** Google Sheet.
2. Download each of its four tabs as a CSV (File → Download → CSV), one file per tab:
   - Jobs
   - Assignments
   - Billing Log
   - Crew Status
3. Keep the four files somewhere you can find them.

*(Use a fresh export — not old April files — so the numbers are current.)*

## Part 2 — Upload them

1. Go to **Schedule Command → Import**.
2. Under **"1 · Upload the old schedule (CSV)"**, add all four files.
3. Each should show a green **"✓ N rows · columns OK"**. If one doesn't say
   columns OK, it's the wrong file or a changed header — re-download that tab.

## Part 3 — Match every job

This is the main work. The screen shows your old jobs on one side and your real
jobs on the other.

For each old job:
- The tool lists **Suggested matches**. If the right one is there, click it. Done.
- No good suggestion? Use **Search all records** to find the right real job and pick it.
- Not a real customer job (internal/shop/etc.)? Click **Internal**.
- Picked the wrong one? **Clear match** and redo it.

Keep going until the counters at the top read:
- **0 unmatched** (every job is handled), and
- **no duplicate warnings** (no two old jobs pointing at the same real job).

Your matching auto-saves the whole time. You can leave and come back.

## Part 4 — Hand off the final load

Once you're at **0 unmatched, no duplicates**, you're done with the clicking.

The actual load into the live schedule is a careful one-time step that a
technical session runs for you — it makes a full backup, clears the old test
data, and loads your matched jobs in a single all-or-nothing step, after
rehearsing it on a throwaway copy first so nothing can go wrong on the real one.

> Why you don't just hit "Apply": the **Apply** button on the screen is for a
> brand-new empty company. Your company (HDSP) already has test data that has to
> be cleared first, so we use the safer backup-and-replace step instead.

Tell the technical session: *"Import matching is done, 0 unmatched — run the
one-time HDSP load."* The exact steps they follow live in:
**`scripts/HDSP_MIGRATION_RUNBOOK.md`** (Steps 3–7: export the confirmed draft,
generate the load, rehearse, run, verify).

## Part 5 — Check it, then retire the old sheet

After the load, spot-check ~10 jobs in Schedule Command — they should show up
with their crew and dates. Sanity-check billing on a few known jobs. When it all
looks right, the old **YES Schedule v2** sheet can be retired.

---

## Good to know

- **Safe to explore.** Opening Import and uploading files changes nothing. Only
  the final load (Part 4) writes data, and that's deliberate and backed up.
- **Your matching is saved.** Close the tab, come back tomorrow — it's still there.
- **One company for now.** The tool is set up for HDSP. Before a *second* company
  could ever use it, there's a security cleanup to do first (noted in the runbook).

## Technical companion

`scripts/HDSP_MIGRATION_RUNBOOK.md` — the operator steps for the final load.
`scripts/generate_hdsp_migration_sql.mjs` — the script that builds the one-time load.
