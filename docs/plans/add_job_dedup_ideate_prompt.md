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

---

# BUILD PLAN — [workstream A: ship now] 2026-09-05

Written in the ID8 terminal with full ideate context (no /decide handoff, per
Chris). Scope = workstream A only (forward fix + guardrail). Workstream B (manual
allocation of the 67) and F59 (overhead report) are explicitly out.

## Outcome (what "done" looks like)

- The schedule "+ Job" button can no longer create a floating, unlinked job.
- Three outcomes only: attach a **mobilization** to an existing job, **block** a
  new customer job ("create in Sales first"), or create a **Shop Work** overhead
  record.
- The import tool's "internal bucket" writes **Shop Work overhead records**, not
  null-`call_log_id` rows.
- Invariant holds in prod: **no code path writes a `jobs` row with a null
  `call_log_id`.** Any remaining null row is therefore, by definition, an
  un-migrated orphan awaiting workstream-B allocation.
- The 10252 "Crew not assigned" mismatch stops being produced going forward
  (existing instance handled in B).

## Ground truth (verified 2026-09-04/05, prod pbgvgjjuhnpsumnowuym)

- `jobs`: `call_log_id bigint NULL`, `status text default 'Parked'`,
  `is_change_order bool`, `co_number int`, `deleted text 'Yes'/'No'`. No overhead
  flag exists. ("Parked" already means new-job default — do NOT reuse it for
  orphans.)
- `call_log` (Sales record) has no overhead flag (see CLAUDE.md column ref).
- `job_mobilizations` already has `is_go_back` + `addJobMobilization()` in
  `src/schedule/lib/queries.js` — reuse as-is.
- Clean "Send to Schedule" (`ProposalDetail.jsx:752`) already stamps
  `call_log_id` — that path is correct and untouched.

## Schema change (author in `command-suite-db`, NOT here)

Per repo rule, DB changes live in `command-suite-db` (`npm run db:push` there),
rehearsed first (`scripts/rehearse.sh`). One column:

1. **`call_log.is_overhead boolean NOT NULL DEFAULT false`** — marks a Sales
   record as no-customer overhead (shop work / training). Standard tenant RLS
   already applies (inherited by column). No anon grant needed — `call_log` is
   authenticated-only and no public page selects it (confirm against
   `check-public-select-grants` — expected no-op).

**Derived state, no column:** "Unallocated" = `jobs.call_log_id IS NULL`. After
this fix that state is unambiguous (nothing writes it intentionally — overhead
rows carry their overhead `call_log_id`). So the parking bucket is a filter, not
a new field.

## Code changes (all in `sales-command`)

**Step 1 — Rework the "+ Job" flow** (`src/schedule/ScheduleLayout.jsx`,
`doAddJob` + Add Job modal, lines ~90–317).
- Remove the blind `supabase.from('jobs').insert([row])`.
- Add a **searchable dropdown** of existing Sales jobs (source: `call_log` joined
  to its `jobs` row; show `display_job_number` · customer · job_name). New helper
  in `queries.js` e.g. `searchExistingJobs(term)`.
- Resolve to one of three outcomes:
  - **Existing job picked** → "Add mobilization" panel → **"Is this go-back
    work?"** checkbox → existing crew/dates/prevailing-wage inputs → call the
    existing `addJobMobilization(job_id, {…, is_go_back})`. No new `jobs` row.
  - **Typed job# not found in Sales** → **block** with message *"Job #### isn't in
    Sales yet — create it in Sales first."* No insert.
  - **Shop Work button** (see Step 2).

**Step 2 — Shop Work creation** (shared helper `createShopWorkRecord()` in
`queries.js`; entry points: schedule "+ Job" modal button + a Sales-side action).
- Insert a `call_log` row with `is_overhead=true`, `customer_id=null`, a generated
  hidden identifier (no user-facing job#), then create its linked `jobs` row
  (`call_log_id` set) exactly like Send-to-Schedule does — so it obeys the
  invariant.
- Button copy: *"This work has no customer. It's overhead to the business."*
- Overhead records must be excluded from customer-billing surfaces (they have no
  customer) — verify billing/forecast readers skip `is_overhead` (see Step 5).

**Step 3 — Import path** (`src/schedule/lib/importData.js`, ~line 145–162).
- The "Internal bucket" branch (`clId = null`) must instead create an **overhead
  `call_log` record** per internal job and link the imported `jobs` row to it —
  reuse `createShopWorkRecord()` logic. Result: import produces zero null-
  `call_log_id` rows.

**Step 4 — Parking bucket + live-view exclusion** (`queries.js`,
`computeHomeDashboard`/`buildCrewByCallLog` + Jobs/Schedule list readers).
- Add a dedicated **"Unallocated" view** listing `jobs WHERE call_log_id IS NULL
  AND deleted='No'`.
- **Exclude** those same rows from Home "Next Up", Jobs list, and the crew grid so
  orphans stop cluttering / mis-reporting. This makes the dashboard read path safe
  without rewriting crew keying (Q5 resolution).

**Step 5 — Overhead billing safety** (billing readers:
`src/schedule/lib/billingForecast.js`, billing worklist).
- Confirm overhead records (no customer, `is_overhead`) never enter billing/
  forecast/pay-app surfaces. Add an `is_overhead` exclusion where those readers
  key off `call_log_id`.

## UI / layout (per UI-first rule)

Add Job modal, redesigned — preserves the existing field set:
```
┌ Add to Schedule ───────────────────────────┐
│  [ 🔎 Search existing job by #, customer…  ]│  ← dropdown of Sales jobs
│                                             │
│  (on pick)  ▸ Job #10231 · Acme · Ste 200   │
│             ☐ Is this go-back work?          │
│             Crew# [ ] Lead [ ] Dates [ ][ ]  │  ← existing inputs
│             ☐ Prevailing wage    [ Add trip ]│
│                                             │
│  ─ or ─                                      │
│  [ + Shop Work (no customer · overhead) ]    │
│                                             │
│  Typed a # not in Sales?  → "Create it in    │
│  Sales first."  (blocks, links to Sales)     │
└─────────────────────────────────────────────┘
```
Style per CLAUDE.md (linen bg, teal buttons w/ black text). End the build with an
in-browser verify against the design system.

## Files to touch

- `src/schedule/ScheduleLayout.jsx` — `doAddJob`, Add Job modal (Steps 1–2).
- `src/schedule/lib/queries.js` — `searchExistingJobs`, `createShopWorkRecord`,
  live-view exclusion, Unallocated view (Steps 1,2,4).
- `src/schedule/lib/importData.js` — internal bucket → overhead (Step 3).
- `src/schedule/lib/billingForecast.js` — overhead exclusion (Step 5).
- Sales-side entry point for Shop Work (component TBD in build — likely a
  `CallLog`/`NewInquiryWizard` action).
- `command-suite-db` — the `call_log.is_overhead` migration (separate repo).

## Out of scope (do NOT build here)

- **Workstream B:** manual allocation/merge of the existing 67 orphans + 8
  phantoms (incl. retiring 10252 job_id 1278). Parked worklist; Chris researches.
- **F59:** overhead-hours cost report.
- No hard DB uniqueness constraint on `job#` (breaks change orders).

## Verification / smoke (run before calling done)

1. "+ Job" → pick existing job → add mobilization → confirm **one** new
   `job_mobilizations` row, **zero** new `jobs` rows; go-back checkbox sets
   `is_go_back`.
2. "+ Job" → type a job# not in Sales → **blocked**, no insert.
3. Shop Work → creates one `call_log` (`is_overhead=true`, no customer) + one
   linked `jobs` row; appears on schedule; **absent** from billing/forecast.
4. Run import on a throwaway with an internal-bucket job → produces an overhead
   record, **zero** null-`call_log_id` rows.
5. Dashboard: a normal job shows crew consistently on grid AND Next Up (no
   mismatch); an orphan (if any remain) appears only in the Unallocated view.
6. `npm run build` clean; in-browser design check.

## §7 Estimate

- **Code:** ~300–400 lines across 4 files (`ScheduleLayout.jsx`, `queries.js`,
  `importData.js`, `billingForecast.js`) + 1 additive migration in
  `command-suite-db` + a Sales-side Shop Work entry point.
- **Build time budget:** ~150 min (workstream A only; B + F59 excluded).

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
