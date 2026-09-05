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

## §0 Reproduction (observed, verified 2026-09-04/05)

**Trigger (third-party reproducible):** In Schedule Command → click **"+ Job"** →
enter a job number that already exists (e.g. `10252`) → fill the form → **Add**.
`doAddJob` (`src/schedule/ScheduleLayout.jsx:100`) runs
`supabase.from('jobs').insert([row])` with **no existence check and no
`call_log_id`** → a second, unlinked `jobs` row is created.

**Observed pre-fix state — run-verified against prod `pbgvgjjuhnpsumnowuym`:**
- `10252` has two rows: `job_id 1191` (real, `call_log_id 3847`, fully crewed) +
  `job_id 1278` (phantom, `call_log_id NULL`, 1 stray "Bash Dave" assignment).
  ```sql
  select job_id, job_num, call_log_id, crew_needed from jobs where job_num='10252';
  -- 1191 | 10252 | 3847 | (crewed)   ← real
  -- 1278 | 10252 | NULL | (phantom)  ← manual add
  ```
- **Systemic:** 289 active jobs; **42** job#s have duplicate rows; **67** active
  jobs have `call_log_id IS NULL`; of the 42 dupes, **8** are phantoms (null-
  call_log) and **34** are multiple Sales-linked rows (legit change orders sharing
  a job#). (Query in "Useful queries" below.)

**Gate evidence (why two views disagree):** the crew grid keys crew by `job_id`
→ shows the phantom's 1 assignment. `computeHomeDashboard` → `buildCrewByCallLog`
(`src/schedule/lib/queries.js`) keys crew by `call_log_id` → the phantom's is
NULL → "Crew not assigned." Two readers, two answers, because a null-`call_log_id`
row exists at all. Read-verified in code + run-verified in prod.

**Baseline verification:** run-verified (prod SQL, 2026-09-04) + read-verified
(code paths `doAddJob`, `importData.js` internal bucket, `buildCrewByCallLog`).

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

> **Surfacing gap found in smoke (2026-09-05):** adding the block saves it but the
> schedule board still keys off the job's first start/end and never renders it. The
> board must show a job on EVERY allocation's dates — see the AMENDMENT
> "allocation-aware schedule board" (workstream C / B87) below.

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
3. **Shop work / no customer** → the **Shop Work** button (overhead record).
   *(Sequencing, rev1 2026-09-05: this button + the overhead record type are
   deferred to their own loop — `docs/plans/shop_work_overhead_type.md` — so it is
   NOT in workstream A. The design decision stands; only the build order changed.)*

Net effect (end-state, across workstream A + the Shop Work loop): the blind `jobs`
INSERT in `doAddJob` is gone, and every remaining path attaches to a Sales record,
bounces to Sales, or creates a typed overhead record. No path produces a schedule
row with a null `call_log_id`. **In workstream A alone**, the button is closed and
orphans are hidden; the import writer is closed later in the Shop Work loop.
*(rev2: "Send to Schedule" is NOT a live phantom source — prod 0/378 — so it is
not part of A; see Guardrail writer #3.)*

## Scope split — [LOCKED 2026-09-05]

The forward fix and the cleanup are **independent** and ship separately:

- **Ship now (workstream A):** new "+ Job" button (dropdown → mobilization + go-back
  checkbox; block when no Sales job) + hide orphans (incl. exports). UI-level; does
  not depend on clean data. *(rev1: Shop Work split out. rev2: Send-to-Schedule
  guard dropped — dead code, prod 0/378.)*
- **Shop Work loop (`docs/plans/shop_work_overhead_type.md`):** the overhead
  record type — Shop Work button, `is_overhead` column, import→overhead, Field
  sync + UI, billing exclusion. Split out after round-1 audit (carries findings
  C, D, E, F). Does not block A.
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
- **Prevention lives at the app layer. Job-writers (round-2 corrected):**
  1. `doAddJob` "+ Job" button → dropdown/mobilization/block. **[workstream A —
     the one live phantom source.]**
  2. **"Send to Schedule"** (`ProposalDetail.jsx:729`, `call_log_id || null`) →
     **NOT a live source, not touched.** Prod: 0/378 proposals have a null
     `call_log_id`; `ArchiveProposalModal.jsx:100` always sets it, so `|| null` is
     inert. (Round-1 "guard it" was a misdiagnosis; round-2 verified vs prod.)
  3. `importData.js` "Internal bucket" (deliberate `call_log_id = null`, the old
     BuilderTrend 1111 shop work) → becomes a Shop Work overhead record.
     **[Shop Work loop]** — still writes nulls until then; parked (1 tenant,
     onboarding-only), and hidden as orphans by A's reader exclusion meanwhile.
  4. `createShopWorkRecord` (new). **[Shop Work loop]**
- **Invariant (end-state, after both loops):** a null `call_log_id` on a schedule
  row *always* means "bug / unallocated," never "intentional." Workstream A closes
  the one live writer (the "+ Job" button) and hides existing nulls everywhere
  (grids + exports); the import writer is closed in the Shop Work loop. That single
  unambiguous rule is what makes the dashboard read path safe (killed the 10252
  mismatch) and prevents recurrence.

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

---

# BUILD PLAN — [workstream A: ship now] 2026-09-05 · rev2 (round-2 audit response)

Written in the ID8 terminal with full ideate context (no /decide handoff, per
Chris). Shop Work + import-overhead are SPLIT into their own loop (see
`docs/plans/shop_work_overhead_type.md`), ratified after round 1.

**Round-2 audit (verified vs prod) killed two round-1 fixes that were written
against the wrong field:** the Send-to-Schedule guard guarded nothing (0/378
proposals have a null link), and the "not in Sales" match keyed on a composite
label so it would have blocked *every* job. Both corrected below.

**Workstream A = the guardrail only:** route the "+ Job" button to a mobilization
or a clean block, and hide the orphans that already exist. One writer actively
fixed (the button), no new column, no Shop Work, no import change.

## Outcome (what "done" looks like)

- The schedule "+ Job" button can no longer create a floating, unlinked job —
  it either attaches a **mobilization** to an existing job (resolved by the picked
  job's `job_id`) or **blocks** ("create it in Sales first").
- Existing orphans (null `call_log_id`) are **hidden from every live view**,
  including exports, and surface only in a dedicated "Unallocated" bucket.
- The 10252 "Crew not assigned" mismatch stops being produced going forward, and
  the existing instance reads as "unallocated" (existing-data merge handled in B).

**Known remaining writer, accepted:** the import tool still writes null "internal
bucket" rows until the Shop Work loop lands. Those rows are hidden as orphans by
this workstream's reader exclusion, and import only runs per new-tenant onboarding
(1 tenant live) — parked as a known writer, not a regression.

## Ground truth (verified 2026-09-04/05, re-verified vs prod 2026-09-05)

- **Job-writers (round-2 corrected):**
  1. `doAddJob` — the "+ Job" button (`ScheduleLayout.jsx:100`, blind insert).
     **The one live phantom source. Fixed in A (Step 1).**
  2. `applyImport` — import "internal bucket" (`importData.js:149`, deliberate
     null). → deferred to Shop Work loop; parked.
  3. **Send to Schedule** (`ProposalDetail.jsx:729`, `call_log_id: p.call_log_id
     || null`) — **NOT a live phantom source.** Prod: **0/378** active proposals
     have a null `call_log_id`; `ArchiveProposalModal.jsx:100` always sets
     `call_log_id: selJob.id`, so the `|| null` never resolves to null. The
     round-1 "guard it" finding was a misdiagnosis — no A change here.
  4. `createShopWorkRecord` — new, in the Shop Work loop.
- `job_number` is a **bare integer**; `display_job_number` is a **composite label**
  (`"10276 - Grind & Seal…"`, `"10017 CO1 - …"`) — verified in prod. Match logic
  must use `job_number`, never the label (see Step 1 / R2).
- `jobs`: `call_log_id bigint NULL`, `status text default 'Parked'`,
  `deleted text 'Yes'/'No'`. (Orphan signal = `call_log_id IS NULL`.)
- `job_mobilizations` already has `is_go_back` + `addJobMobilization()`
  (`queries.js:1220`), called by **two** sites: the new "+ Job" flow AND
  `MobsModal.jsx:103` — so the parent-null guard belongs in the function (N1).
- Central list loader = `loadJobs()` (`queries.js:481`, current signature
  `{includeDeleted, withWTCs}`). Most grids route through it, but `exports.js`
  (4 raw reads) and `StatsBar.jsx:53` do not (N3).

## Derived state (no new column in A)

"Unallocated" = `jobs.call_log_id IS NULL AND deleted<>'Yes'`. Workstream A needs
**no `is_overhead` column** — the orphan-vs-live decision keys purely on
`call_log_id` null-ness. (`is_overhead` and the billing distinction land with the
Shop Work loop, since overhead is the only consumer.)

## Code changes (all in `sales-command` — no migration in A)

**Step 1 — Rework the "+ Job" flow** (`src/schedule/ScheduleLayout.jsx`,
`doAddJob` + Add Job modal). Integrates R2, G, H, N1, N2.
- Remove the blind `supabase.from('jobs').insert([row])`.
- New helper `searchExistingJobs(term)` in `queries.js` (N2 — spec it precisely):
  base table **`call_log`**, embed **`jobs!inner(...)`** (inner embed drops
  phantoms so a phantom parent can never be picked); return
  `{ job_id, call_log_id, job_number, display_job_number, customer, job_name }`.
  Paginate with a **qualified order column** (`call_log.id`); confirm
  `loadAllRows` `.range()` tolerates the embed, else write a bespoke paginated
  query — do NOT cite `loadAllRows` blindly (its signature is single-table). Input
  **debounced**; filter `jobs.deleted<>'Yes'`.
- Two outcomes only in A:
  - **Existing job picked from the dropdown** → resolve by the row's **`job_id`**
    (never re-derive from typed text) → "Add mobilization" panel → **"Is this
    go-back work?"** checkbox → existing crew/dates/prevailing-wage inputs →
    `addJobMobilization(job_id, {…, is_go_back})`. No new `jobs` row.
  - **Typed text matches nothing** → **block**: *"Job #### isn't in Sales yet —
    create it in Sales first."* No insert.
- **R2 — match key:** the search matches on **`call_log.job_number`** (the bare
  integer, compared as `::text`), NOT `display_job_number` (a composite label like
  `"10252 - Flattening"` — a bare "10252" never equals it, which would block every
  job). The label is display-only.
- **N1 — parent guard in the function:** put the "refuse if parent has null
  `call_log_id`" check **inside `addJobMobilization()`** (`queries.js:1220`), not
  in the "+ Job" caller — because `MobsModal.jsx:103` also calls it. (The dropdown
  inner-embed already prevents picking a phantom on the "+ Job" side; the function
  guard covers the other caller.)
- (Shop Work button is NOT in A — it arrives with the Shop Work loop.)

**Step 2 — Hide orphans across ALL readers + Unallocated bucket** (`queries.js`,
`exports.js`). Integrates B + N3 + N5.
- Add `includeUnlinked = false` to `loadJobs()` (`queries.js:481` — the param does
  NOT exist yet); when false, append `.not('call_log_id','is',null)`. Most grids
  already route through `loadJobs()` (Schedule/Calendar/Daily/Materials/Schedules/
  Home/Jobs) — that's a **verify, largely no-op**, not the fix.
- **The real leak is `exports.js`** — 4 raw `from('jobs')` reads (lines
  **63, 94, 113, 140**) that bypass `loadJobs()`, so an orphan prints as a
  blank-customer line in exported schedule/materials/crew spreadsheets. **Mandatory
  fix:** route these through `loadJobs()` or append `.not('call_log_id','is',null)`
  inline. (`StatsBar.jsx:53` is also raw but **safe — corrected reason (buildvsplan
  T2-1/T2-2, 2026-09-05):** NOT "orphans have no assignments" — that's false, §0's
  phantom job 1278 carries a stray "Bash Dave" assignment. It's safe because
  StatsBar's actual output (avail/out counts) is computed from crew + assignments
  ONLY (lines 69–85) and never touches `jobs`; `jobs` is consumed solely as a
  name-lookup in the day drill-down modal (line 102). The fixed "+ Job" flow can't
  mint new orphan assignments, so any exposure is bounded to pre-existing
  workstream-B data, and filtering it here would only swap the label `10252 - Dave
  Lee` for `?` in that modal — worse, not better. Leave it; real cleanup is
  workstream B retiring job 1278.)
- **N5:** confirm `attachDepositState` (called inside `loadJobs`) is null-safe on
  orphan rows (null `call_log_id` → null-keyed deposit join); the Unallocated view
  is the only true `includeUnlinked:true` caller.
- Add a dedicated **"Unallocated" view** = `loadJobs({ includeUnlinked: true })`
  filtered to null-`call_log_id`, so orphans are worked from one place (workstream
  B allocates them).

## UI / layout (per UI-first rule)

Add Job modal, redesigned — preserves the existing field set:
```
┌ Add to Schedule ───────────────────────────┐
│  [ 🔎 Search existing job by #, customer…  ]│  ← dropdown: call_log⨝jobs
│                                             │
│  (on pick)  ▸ Job #10231 · Acme · Ste 200   │
│             ☐ Is this go-back work?          │
│             Crew# [ ] Lead [ ] Dates [ ][ ]  │  ← existing inputs
│             ☐ Prevailing wage    [ Add trip ]│
│                                             │
│  Typed text matches nothing?  → "Create it   │
│  in Sales first."  (blocks, links to Sales)  │
└─────────────────────────────────────────────┘
   (Shop Work button added in the Shop Work loop)
```
Style per CLAUDE.md (linen bg, teal buttons w/ black text). End the build with an
in-browser verify against the design system.

## Files to touch (A)

- `src/schedule/ScheduleLayout.jsx` — `doAddJob`, Add Job modal (Step 1).
- `src/schedule/lib/queries.js` — `searchExistingJobs` (call_log + jobs!inner),
  parent-null guard **inside `addJobMobilization`** (covers `MobsModal` too),
  `loadJobs` `includeUnlinked` param + orphan filter, `attachDepositState`
  null-safety, Unallocated view (Steps 1, 2).
- `src/schedule/lib/exports.js` — 4 raw `from('jobs')` reads (63/94/113/140) get
  the orphan filter (Step 2, N3) — **the real leak.**
- **NOT touched:** `ProposalDetail.jsx` (R1 — guard was dead code, dropped),
  `StatsBar.jsx` (raw but safe), `importData.js`/`billingForecast.js`/
  `command-suite-db` (Shop Work loop). No migration.
- **Field / PowerSync — no A change needed** (round-2 disproved the worry):
  orphans sync to phones but **cannot render** — every Field entry point drives
  off `call_log WHERE stage IN(...)` and resolves jobs by `call_log_id`, so a
  null-`call_log_id` orphan is unreachable on-device (`HomeScreen.js:60`,
  `TasksTab.js:104`). Residual wasted sync bandwidth only → Shop Work loop.

## Out of scope (do NOT build here)

- **Shop Work loop** (`docs/plans/shop_work_overhead_type.md`): the `is_overhead`
  column, `createShopWorkRecord`, import-overhead rework, Field sync-rule + UI, and
  billing/forecast overhead exclusion — carries round-1 findings C, D, E, F.
- **Workstream B:** manual allocation/merge of the existing 67 orphans + 8
  phantoms (incl. retiring 10252 job_id 1278). Parked worklist.
- **F59:** overhead-hours cost report.
- No hard DB uniqueness constraint on `job#` (breaks change orders).

## Verification / smoke (run before calling done)

1. "+ Job" → search an existing job by its **bare number** (e.g. `10252`) → it
   appears in the dropdown → pick it → add mobilization → **one** new
   `job_mobilizations` row, **zero** new `jobs` rows; go-back checkbox sets
   `is_go_back`. (R2 guard: a real job is NOT wrongly blocked.)
2. "+ Job" → type a number with no Sales job → **blocked**, no insert.
3. `addJobMobilization` on a null-`call_log_id` parent is refused **from both**
   the "+ Job" flow and `MobsModal` (N1).
4. Orphan job (null `call_log_id`) is **absent from every live reader AND from an
   actual schedule/materials export run with an orphan present** (N4), and appears
   **only** in the Unallocated view.
5. `npm run build` clean; in-browser design check.

## §7 Estimate (rev2)

- **Code:** ~180–230 lines across 3 files (`ScheduleLayout.jsx`, `queries.js`,
  `exports.js`). **No migration; `ProposalDetail.jsx` no longer touched.**
- **Build time budget:** ~110 min (workstream A only).

---

## AMENDMENT — allocation-aware schedule board [LOCKED 2026-09-05, post-smoke]

**How this surfaced:** smoke of workstream A on the branch preview. Added a go-back
to job **7069 (South Side / Clorox)** for **Sep 19** → it SAVED correctly
(`job_mobilizations` row, `is_go_back`, Sep 19) but never appeared on the Crew
Schedule board. Root cause: the board picks which jobs show in a week purely by the
**job's own start/end** (`Schedule.jsx` `jobOverlapsWeek` → `effStart/effEnd` =
`scheduled_start/start_date …`). It is blind to the dated blocks on
`job_mobilizations`. So workstream A saves the block but no schedule view renders it —
the "+ Job → go-back" flow is only **half-built**.

**Model — [LOCKED] (Chris, 2026-09-05):**
- A job has one or more **allocations** = blocks of days on the crew schedule.
- Continuous days = ONE allocation; a gap = the NEXT allocation (a month straight = 1;
  every-other-week = 4). The job's start/end only ever described the **first** block.
- A **go-back is just an allocation**, flagged so the job card can track its cost. NOT
  a new job, NOT a new record type.
- Same underlying records, two labels by screen: **"allocation"** on the scheduler,
  **"mobilization"** on the job-card / cost view. Do NOT show the word "mobilization"
  in scheduler-facing UI — it conflates with the job-card cost meaning.

**Scope correction:** workstream A (guardrail — no phantom jobs + hide orphans) is
built, 3-gate-green, and pushed; it stands. But the outcome it promised — a usable
"+ Job → go-back" — is not reached until the board renders allocations. That surfacing
is its own pass:

### Workstream C — allocation-aware board [next build]
Show a job on EVERY allocation's dates, not just the first.
- **Read model:** load `job_mobilizations` (allocations) for the visible job set; a
  job appears in a week if the job's own dates OR any allocation overlaps the week.
  Per-day crew cells key off `assignments` as today.
- **First allocation = the job's existing start/end** (don't require a
  `job_mobilizations` row for block #1); additional/go-back blocks come from
  `job_mobilizations`.
- **Views to cover** (all use the same job-by-date-range selection today — verify
  each): `Schedule.jsx` (`jobOverlapsWeek`/`jobInRange`→`weekJobs`), `Calendar`,
  `Daily`, and the matching `exports.js` reads.
- **Naming:** scheduler-facing copy says "allocation"; the job-card cost view keeps
  "mobilization"; the "+ Job" go-back panel stays go-back-oriented.
- **Out of scope:** billing/cost changes, the job-card mobilization view, workstream B
  cleanup.

Tracked as **B87** (see `docs/BACKLOG.md`).

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-09-05. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Contained but wide-reaching fix: it changes how every job gets created and adds a
no-customer "shop work" type, and it rests on one promise — **no job ever lands on
the schedule without a real record behind it.** I'm pointing 4 reviewers at the
places that promise could quietly break: every spot that creates a job, the
shop-work save, anywhere billing or the dashboard reads jobs, and the new database
column. Medium-size check, not a deep one.

### Round
- Plan type: bug (duplicate-job defect; §0 Reproduction recorded)
- Current round: 1
- Plan revision under audit: HEAD of `feat/add-job-dedup` (build-plan draft commit)
- Sizing basis: full-surface — round 1
- Delta scope (round N>1 only): n/a
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: do NOT re-find issues from prior rounds (none exist).
Attack the build plan (workstream A) as specified.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding is F-tier / blocked.
- **Prod / staging / dev**: **live in prod.** Schedule Command is in daily use;
  the "+ Job" button is live; the import tool runs per new-tenant onboarding.
- **Blocking feature flags**: none.
- **Concurrency profile**: solo / ≤5 (small office schedulers).

Agents weight severity against these: cross-tenant findings cap at **Med** while
`live_tenants == 1`; multi-user race findings cap at **Low** while concurrency is
solo/≤5. Theoretical attacks on not-yet-existing state are not High.

### Time budget + finding cap
- **Time budget**: 150 min (§7 Estimate)
- **Finding cap**: 15 findings (`max(3, ceil(150/10))`)

Synthesis MUST surface only the top-15 most consequential findings; remainder go
to "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: ~430
- Sections: 22
- [LOCKED] decisions: 5 (Identity, Shop work, +Job button, Scope split, Guardrail)
- [DESIGN-OPEN] items: 0
- [OPEN] items: 0
- Plan-to-code ratio: ~430 : ~350 ≈ 1.2:1 (healthy — not scope-crept)

### Layers touched
- UI / components (Add Job modal rework; Sales-side Shop Work entry point)
- Data layer (queries.js: `searchExistingJobs`, `createShopWorkRecord`, live-view
  exclusion; billingForecast overhead exclusion)
- State model (new `call_log.is_overhead`; derived "Unallocated" = null call_log_id)
- Migrations / schema (`call_log.is_overhead`, authored in command-suite-db)
- Cross-repo (command-suite-db migration)
- Real-time / sync (PowerSync — Field reads `jobs`/`call_log`; overhead + import
  changes reach the mobile app)
- External-ish (billing / forecast / pay-app readers — internal money surfaces)

### New mechanisms introduced
- New column: `call_log.is_overhead` (boolean NOT NULL default false)
- New helpers: `searchExistingJobs(term)`, `createShopWorkRecord()` (in queries.js)
- New view/filter: "Unallocated" bucket (`jobs WHERE call_log_id IS NULL`) + live-
  view exclusion of those rows
- Reworked mechanisms: import "internal bucket" → overhead record; billing/forecast
  overhead exclusion; `doAddJob` replaced with dropdown/block/shop-work resolver

### Cross-system reach
- `command-suite-db` — the `is_overhead` migration (separate repo, single ledger)
- Shared Supabase DB read by Field Command via PowerSync (jobs/call_log sync)
- Billing/forecast/pay-app readers that key off `call_log_id`

### Irreversibility
- One **additive** column (`is_overhead`, default false) — reversible.
- No data backfill in this workstream (the 42/67 cleanup is workstream B, out of
  scope). Import behavior change is forward-only, not destructive.

### Known weak points
- **Writer-inventory completeness (Steps 1,3).** The invariant ("no null
  call_log_id") holds only if EVERY path that inserts a `jobs` row is covered. Plan
  names the button + import; a missed writer (grep `from('jobs').insert`) reopens
  the null path silently.
- **Shop-work two-insert atomicity (Step 2).** `createShopWorkRecord()` inserts a
  `call_log` then a `jobs` row from the client with no transaction. Partial failure
  → an orphaned overhead call_log or an unlinked jobs row — the exact defect we're
  killing. Needs a rollback like `ProposalDetail.rollbackNewJobRow`.
- **Reader coverage (Steps 4,5).** Overhead exclusion must hit ALL money readers
  (billingForecast, worklist, pay-app, invoices) — one miss leaks overhead into
  billing. Live-view exclusion must hit ALL live readers (Home, Jobs, grid,
  calendar, daily) — one miss still shows orphans.
- **"Not in Sales" match key (Step 1).** Blocking a new-customer job depends on
  matching the typed job# to a Sales record; `display_job_number` vs `job_number`
  format mismatch could wrongly block a legit job or wrongly allow a phantom.
- **Field/PowerSync reach.** Overhead jobs + import-created overhead syncing to
  Field crews is unverified — confirm sync rules don't choke on `is_overhead` /
  no-customer rows.
- **Grants.** Confirm `is_overhead` needs no anon grant and `check-public-select-
  grants` stays a no-op.

### Open questions
- Count: 0 (all 7 ideate questions resolved this session).
- Highest-pressure: no formally open questions; the real uncertainty is
  writer-inventory completeness + shop-work atomicity (see weak points).

### Suggested attack angles (4 total)
1. **User-path writer-inventory + invariant trace** — covers UI + state model.
   Required reading: `ScheduleLayout.jsx` (`doAddJob`), `queries.js`
   (`createShopWorkRecord`, `searchExistingJobs`), `importData.js`, and a repo-wide
   grep for `from('jobs').insert`. Pressure: does every job-creating path now set
   `call_log_id`? Is the writer inventory complete? Can the "not in Sales" block be
   bypassed by a job#-format mismatch?
2. **Data-layer / reader coverage** — covers data layer + money surfaces. Required
   reading: `queries.js` (`buildCrewByCallLog`, `computeHomeDashboard`, live-view
   readers), `billingForecast.js`. Pressure: is live-view exclusion applied to
   EVERY live reader, and overhead exclusion to EVERY billing reader? N+1 /
   pagination regressions from the new dropdown join.
3. **Schema / migration / cross-repo** — covers migrations + cross-repo. Required
   reading: command-suite-db conventions + ledger rules, `CLAUDE_RLS.md`,
   `check-public-select-grants`. Pressure: `is_overhead` RLS inheritance + tenant
   scoping, additive/reversible, anon exposure, ledger coordination.
4. **Shop-work write atomicity + Field/PowerSync fit** — covers real-time/sync +
   framework fit. Required reading: `ProposalDetail.jsx` Send-to-Schedule +
   `rollbackNewJobRow`, PowerSync sync rules, Field readers of `jobs`/`call_log`.
   Pressure: two-insert partial-failure orphans; does overhead sync correctly to
   crews; does `createShopWorkRecord` mirror the canonical Send-to-Schedule
   (tenant_id, audit logging, required fields)?

### Suggested agent count: 4

Rationale: the formula yields 5 (4 layers + cross-system + ≥3 novel mechanisms),
but the UI change is a single modal rework that folds cleanly into angle 1 and the
migration is one additive column that folds into angle 3 — so 4 angles give full
coverage without two agents double-covering the data layer. 3 would force schema
and Field/PowerSync into one over-broad angle.
