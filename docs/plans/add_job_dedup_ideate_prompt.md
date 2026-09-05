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

## Chris's mental model (the starting hypothesis — NOW REFINED + LOCKED, see Identity model below)

> **RESOLVED 2026-09-05.** The hypothesis was right for go-backs but needed one
> correction: a change order is NOT a mobilization (it has its own SOW/billing).
> Identity keys on the **Sales link (`call_log_id`)**, not the job#. See the
> "Identity model — [LOCKED]" section below. Original hypothesis kept for history.


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

## Identity model — [LOCKED 2026-09-05]

Traced Sales → schedule → billing before locking. A change order is created back
at the Sale as its **own record** (own proposal, own scope, tagged CO1/CO2,
pointed at the parent). Billing is keyed off that **Sales record**
(`call_log_id`), not the job number — each CO carries its own proposal /
invoices / pay-app series. Folding a CO into a mobilization would strip its scope
+ billing, so it can't be one.

The rule:

- One **job number** can hold several **Sales records** — the base job plus each
  change order.
- A **change order stays its own record** because it has a **different SOW /
  field SOW** — new work, bills on its own. (Chris's anchoring reason.)
- **Same work, another trip** = a **mobilization**, not a new record.
- A schedule row with **no Sales record behind it** (null `call_log_id`) = the
  phantom bug we're killing. All 8 phantoms are exactly this.

**Identity of "the same job" = the Sales link (`call_log_id`), NOT the job#.**
Two rows on one job# that are different Sales records (base + CO) are correct;
two rows where one has no Sales link is the bug.

## Shop work / no-customer overhead — [LOCKED 2026-09-05]

Retires the old BuilderTrend "job #1111" catch-all (shop work, training, no
customer). Instead of an *exception* to the identity rule, shop work is a
**first-class record type** so it still has a record behind it and never becomes
a phantom.

- A **"Shop Work"** button creates a real record flagged **no customer ·
  overhead**. Button note: *"This work has no customer. It's overhead to the
  business."*
- **No visible job number** — hidden backend ID only.
- **Born on the Sales side** (records are born there; shows up in reporting as
  overhead), but the schedule **"+ Job"** button opens the same creation flow —
  one creation path, two doors.
- Typed **overhead** → stays out of customer billing and job-cost.
- **Follow-on (out of scope for this fix):** a report rolling shop/overhead crew
  hours into a single "cost of overhead to the business" number. Labor is already
  captured because shop work carries crew like any job; only the rollup view is
  new. Log as its own backlog item.

## "+ Job" button behavior — [LOCKED 2026-09-05]

Clicking "+ Job" on the schedule resolves to one of three outcomes:

1. **Job already exists** (matched by Sales record on that job#) → pick it from a
   **searchable dropdown** → **Add mobilization** → checkbox **"Is this go-back
   work?"** → the existing add-job questions (crew, dates, prevailing wage, etc.).
   - The checkbox sets the **existing `job_mobilizations.is_go_back`** flag via the
     **existing `addJobMobilization()`** (queries.js). Go-back costs already track
     off this flag — reuse it, don't invent a new mechanism.
   - Go-backs are mobilizations (same work, another trip), distinct from change
     orders (new SOW, own Sales record).
2. **New job that has a customer** → **BLOCK**: *"Create it in Sales first."*
   Jobs with customers are born in Sales; the schedule never creates them net-new.
3. **Shop work / no customer** → the **Shop Work** button (overhead record, see
   above).

Net effect: the blind `jobs` INSERT in `doAddJob` is gone. Every path either
attaches to an existing Sales record (mobilization), bounces to Sales (new
customer job), or creates a typed overhead record (shop work). No path produces a
schedule row with a null `call_log_id`.

## Scope split — [LOCKED 2026-09-05]

The forward fix and the cleanup are **independent** and ship separately:

- **Ship now (workstream A):** new "+ Job" button (dropdown → mobilization + go-back
  checkbox; block new-customer jobs → "create in Sales first"; Shop Work button) +
  the guardrail. UI-level; does not depend on clean data.
- **Parked worklist (workstream B):** the 67 unlinked jobs get a status
  **"Unallocated — needs Sales link."** That status routes them **out of the live
  schedule + dashboard views** into a parking bucket Chris allocates over time.
  Side benefit: 10252's "Crew not assigned" reads honestly as "unallocated"
  instead of a half-broken card. Merging Dave Lee's stray crew into the real row
  is one manual row, anytime — not a blocker.

Workstream A does not wait on B.

## Guardrail — [LOCKED 2026-09-05]

- **No hard DB uniqueness on job#.** A "one row per job number" constraint would
  break legit change orders (which share a job#) and choke on the existing dupes.
- **Prevention lives at the "+ Job" button** — the blind `jobs` INSERT in
  `doAddJob` is removed; every path attaches to a Sales record, bounces to Sales,
  or creates a typed overhead record.
- **The import tool is the other writer.** `importData.js` deliberately writes
  no-customer rows (its "Internal bucket", `call_log_id = null`) — the likely
  source of much of the 67, from the old BuilderTrend 1111 shop work. It's a live
  feature going forward (run once per new-tenant migration), so it must be brought
  under the model: **import's internal/no-customer jobs → created as Shop Work
  overhead records**, not raw null rows.
- **Invariant after this fix:** a null `call_log_id` on a schedule row *always*
  means "bug / unallocated," never "intentional." No path writes an intentional
  null. That single unambiguous rule is what makes the dashboard read path safe
  (killed the 10252 mismatch) and prevents recurrence.

## Open design questions — RESOLVED 2026-09-05

All 7 closed during this ideate. Status below; detail in the [LOCKED] sections above.

1. **Identity of a "job"** → **RESOLVED.** = the Sales link (`call_log_id`), NOT
   job#. See Identity model.
2. **Add Job when job# exists** → **RESOLVED.** Searchable dropdown → pick job →
   Add mobilization (+ "is this go-back?" checkbox). See "+ Job button behavior."
3. **Should Add Job create net-new job#s?** → **RESOLVED.** No — new customer jobs
   are blocked ("create in Sales first"). Only two non-Sales creators: a
   mobilization on an existing job, or a Shop Work overhead record. The 67 are a
   mix of manual phantoms + old import "internal bucket" rows.
4. **What "add a mobilization" means** → **RESOLVED.** Reuse `job_mobilizations` +
   existing `addJobMobilization()` as-is; go-backs are the `is_go_back` flag. Not a
   new mobilization type.
5. **Dashboard crew logic** → **RESOLVED by the invariant.** Once null
   `call_log_id` *only* means "unallocated" (never intentional) and orphans are
   parked out of the live views, the `buildCrewByCallLog` path is safe as-is. No
   read-path rewrite needed. (Revisit only if a mismatch survives after cleanup.)
6. **Backfill / cleanup of 42 + 67** → **RESOLVED as scope decision.** Deferred to
   workstream B (parked worklist, "Unallocated — needs Sales link"); does NOT block
   workstream A. The 34 change-order rows are correct — leave them. See Scope split.
7. **Guardrails** → **RESOLVED.** No hard DB constraint; prevention at the button +
   bring the import's internal bucket under Shop Work. See Guardrail.

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
