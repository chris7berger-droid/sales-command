# Add Job / Duplicating-Jobs — IDEATE prompt

**Phase:** ID8 — ideate (opus 4.8, xhigh effort). Design/think-through ONLY. No
code, no build, no schema changes this phase. Goal = a locked model + a
plan-ready design, then hand to `/decide` → plan → build on THIS branch.

**Repo:** sales-command (the Schedule Command app lives here under `src/schedule/`).
**Branch:** `feat/add-job-dedup` (off main). This doc is the durable memory —
update it as the design firms up (File-as-Memory).

> Was tracked as backlog item **F58**. Reframed the night of 2026-09-04 after prod
> data showed it's systemic, not a one-off. Spun out of the reskin smoke session
> (see sales-command `docs/handoffs/SC_Handoff_v212.txt`).

---

## The problem, in real-world terms

When someone uses the manual **"Add Job"** button in Schedule Command and types a
job number that already exists, the app **blind-INSERTs a second `jobs` row** for
that same job number. You end up with two rows for one real job — a "phantom."

The smoke bug that surfaced it: job **#10252 "Dave Lee"** shows crew assigned on
the Crew Schedule grid but **"Crew not assigned"** on the Home/Jobs "Next Up"
card. Cause: two `jobs` rows —
- `job_id 1191` — the real Sales-linked job (`call_log_id 3847`), fully crewed.
- `job_id 1278` — the phantom manual add (`call_log_id NULL`), 1 stray "Bash Dave"
  assignment.

The **grid** counts crew by the job row itself → shows the phantom's 1 assignment.
The **Next Up card** checks crew through the Sales/call-log link → the phantom has
none → "not assigned." Two views, two answers, because the data is wrong.

## Chris's mental model (the starting hypothesis — NOT yet locked)

> "A job number is ONE job. Going out again is a **mobilization**, not a new job."

Mobilizations already exist in the schema (`job_mobilizations`) — that's how
**go-backs** are modeled. So the hypothesis is: manual Add Job should **dedup on
job#** — if the job exists, attach a **mobilization** to the existing job; if the
job# is new, create it as today.

**Do not treat this as decided.** The prod data below shows it's more tangled than
"just add a mobilization." Work the logistics before locking anything.

---

## Prod reality (verified against pbgvgjjuhnpsumnowuym on 2026-09-04)

- **289** active jobs total.
- **42** job#s have duplicate `jobs` rows.
- **67** active jobs have **NULL `call_log_id`** (no Sales link).
- Of the 42 dup job#s:
  - **8** have a phantom (a null-call_log manual-add row) — the 10252 pattern.
  - **34** have **multiple Sales-linked rows** — these are probably **change
    orders legitimately sharing a job#** (see `call_log.is_change_order`,
    `co_number`, `co_standalone`, `parent_job_id`), NOT manual-add dupes.

**This is the crux of the ideate:** a blanket "job# = one row, dedup everything"
rule would wrongly collapse legitimate change-order rows. The design has to
distinguish: (a) manual-add phantoms, (b) legit change orders on the same job#,
(c) true accidental dupes.

## Open design questions (the "logistics to work through")

1. **What is the identity of a "job"?** job# alone? job# + call_log_id? job# +
   CO number? Nail this first — everything else follows. Reconcile with how change
   orders currently share a job#.
2. **Manual Add Job when job# exists:** always add a mobilization? Confirm dialog
   ("10252 exists — add another mobilization?") to cover typo-vs-deliberate? Block
   entirely and force selecting the existing job?
3. **Should manual Add Job create net-new job#s at all?** Jobs normally come from
   Sales (via call_log). Is manual add a legit quick-add, or should it only ever
   attach to an existing Sales job? What are the 67 null-call_log jobs — all
   manual adds, or something else (imports)?
4. **What does "add a mobilization" concretely mean here?** Reuse
   `job_mobilizations` (the go-back model) as-is, or is a manual re-add a distinct
   mobilization type? Does it carry `crew_needed`, dates, work types?
5. **Dashboard crew logic.** `computeHomeDashboard` derives crew via
   `buildCrewByCallLog` (keyed by call_log_id), so ANY null-call_log job reads
   "not assigned" even when it has assignments by job_id. The grid keys crew by
   job_id and is correct. Should the crew source of truth be job_id everywhere
   (align dashboard to the grid), independent of the dedup work? (Simplify: fixing
   the data may make this moot — decide whether to also harden the read path.)
6. **Backfill / cleanup of the existing 42 + 67.** Separate the 8 phantoms (merge
   their stray assignments into the real row, retire the phantom) from the 34
   change-order cases (leave alone / model correctly). This is a data-migration
   design of its own — likely a one-time script + a review pass, NOT a blind
   dedup. Include job#10252 → job_id 1278 here (don't delete it piecemeal).
7. **Guardrails to stop recurrence.** A DB uniqueness constraint on job# is
   tempting but would break legit change-order sharing — verify the jobs vs
   job_mobilizations vs call_log schema before proposing any constraint. What's
   the right prevention: UI dedup at Add Job, a partial unique index, a trigger?

## Where the code lives (for the eventual plan/build — not this phase)

- Manual Add Job handler: `src/schedule/ScheduleLayout.jsx` → `doAddJob` (blind
  `supabase.from('jobs').insert([row])`). Note: the amount-column bug that had
  fully broken this path was fixed 2026-09-04 (`d9f9131`), so it works now and
  will produce dupes if unchanged.
- Mobilizations: `job_mobilizations` table; `loadMobilizationsByJobId` in
  `src/schedule/lib/queries.js`; go-back flow already uses it.
- Crew derivation: `computeHomeDashboard` + `buildCrewByCallLog` in
  `src/schedule/lib/queries.js` (call_log-keyed — see Q5).
- Change-order fields on `call_log`: `is_change_order`, `co_number`,
  `co_standalone`, `parent_job_id` (see sales-command CLAUDE.md column reference).

## Deliverable of this ideate

A locked identity model + decisions on Q1–Q7 written back into this doc (tag
sections [LOCKED]/[DESIGN-OPEN] as you go), enough to hand to `/decide` → plan.
Two workstreams will likely fall out: (A) fix Add Job going forward (dedup +
mobilization), (B) a one-time backfill/cleanup of the 42 dupes / 67 orphans.

## Useful queries to re-run (read-only)

```sql
-- dup job#s and the phantom vs multi-sales-linked split
with dups as (select job_num from jobs where deleted='No' group by job_num having count(*)>1)
select (select count(*) from dups) as dup_jobnums,
  (select count(*) from dups d where exists (select 1 from jobs j where j.job_num=d.job_num and j.deleted='No' and j.call_log_id is null)) as dups_with_phantom,
  (select count(*) from dups d where (select count(*) from jobs j where j.job_num=d.job_num and j.deleted='No' and j.call_log_id is not null)>1) as dups_multi_saleslinked;

-- the 10252 example
select job_id, job_num, job_name, call_log_id, crew_needed, deleted from jobs where job_num='10252' order by job_id;
```
