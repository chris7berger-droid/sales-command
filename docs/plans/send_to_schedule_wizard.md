I have everything I need. Now let me synthesize the plan. Given my constraint to not write files, I will deliver the full plan content as my final message.

---

# Send-to-Schedule Wizard — Implementation Plan

## Brief summary first (≤300 words)

The plan resolves **Q6** as **option (c) hybrid: `jobs` row = card, new `job_wtcs` join table** for per-WTC attributes. Rationale: every existing FK (`billing_log.job_id`, `materials.job_id`, `assignments.job_id`, `job_changes.job_id`) points to `jobs.job_id` — adding `card_group_id` (option a) requires every aggregator to learn group semantics; jsonb-list (option b) makes partial-send re-join require either jsonb mutation in place (no FK integrity) or a destructive row-split that breaks existing materials/billing/assignments rows. The hybrid keeps `jobs.job_id` as the single card identity (one FK target for the entire downstream graph) and isolates WTC-level attributes (`field_sow`, `material_status`, `proposal_wtc_id`, `start_date`) in `job_wtcs`. Join = INSERT a new `job_wtcs` row pointing at the existing `jobs.job_id`. Unjoin = the inverse. Legacy merged rows continue working unchanged (0 or N `job_wtcs` rows attached; readers fall back to `jobs.field_sow` when `job_wtcs` is empty).

**M5** is resolved as **sch-command owns** the migration (`jobs` is sch-command-owned per CLAUDE.md table-owner principle), with a **5-step pure-schema additive sequence** (not 6-gate — no RLS/auth-touching change). Forward + rollback files paired in `~/sch-command/supabase/migrations/` and `~/sch-command/supabase/rollbacks/`. The **existing UNIQUE index on `source_proposal_id` must be dropped** to allow per-WTC rows.

**New risks** not in the planning doc: (1) the existing `UNIQUE(source_proposal_id)` partial index will block any second insert and is the #1 hidden-blocker; (2) `fn_auto_in_progress` trigger updates `jobs.status` for `Scheduled`/`Parked` only — removing `Parked` from the sales side does not regress, but the trigger should be sanity-grepped; (3) `jobs` has no `tenant_id` column, so the new edge function must scope by `call_log.tenant_id`; (4) Step-3 deep link is in-memory state on `ProposalDetail`, not a URL — wizard state is lost on detour, which is by design (NEW-E) but must be loudly signaled.

---

Below is the full plan content to be saved at `~/sales-command/docs/plans/send_to_schedule_wizard.md`.

---

````markdown
# Send-to-Schedule Wizard — Implementation Plan

_Draft v0.1, 2026-05-11. Owner: Plan subagent (read-only). Source of truth contract: `~/sch-command/docs/planning/JOBS_IA_REFACTOR.md`. Scope: sales-command UI + edge function + cross-repo schema migration. Out of scope: sch-command IA refactor (separate planning agent)._

Tags: **[LOCKED]** (durable from JOBS_IA_REFACTOR.md, do not re-derive) · **[DERIVED]** (mechanical from schema/precedent) · **[RESOLVED]** (this plan resolves a planning-doc-deferred Q) · **[OPEN]** (one ask back to Chris).

---

## §1 Problem statement

**[LOCKED]** Today, the "Send to Schedule" button on `ProposalDetail.jsx` does too much in one click: it merges all `proposal_wtc.field_sow` arrays from a proposal into a **single** `jobs` row, copies legacy materials boolean state, and writes `call_log.stage = 'Parked'`. The result is jobs landing in Schedule Command with no dates, no materials decided, sometimes no Field SOW, and a confusing one-card-per-proposal model that can't represent the real per-work-type cadence of a project.

**[LOCKED]** The new wizard replaces the 1-click button with a **5-step, per-WTC-run** flow that enforces:
- One WTC selected per run (NEW-D resolution, option B).
- A confirmed `start_date` on that WTC.
- A non-empty `field_sow` on that WTC (blocks otherwise, with a guided detour to the canonical WTC editor — NEW-E).
- An explicit `material_status` enum value (replacing the boolean `materials_needed`).
- A sibling-detection prompt at Step 5 that offers join-with-existing-card when other WTCs on the same proposal were already sent (Q7).

**[LOCKED]** `call_log.stage` is **not** touched by the wizard. The sales-side pipeline ends at `'Sold'` once the proposal is sold; the "this was sent to Schedule" signal is the existence of a `jobs` row with `source_proposal_id = p.id` (already drives the existing badge). The line ~588 `call_log.stage = 'Parked'` write is removed.

---

## §2 Locked decisions (from JOBS_IA_REFACTOR.md, do not reopen)

| # | Decision |
|---|---|
| NEW-D | One WTC per wizard run (option B). Three WTCs = three runs. |
| NEW-E | All SOW authoring goes through `src/pages/WTCCalculator.jsx` — no SOW authoring inside the wizard. Step 3 either shows a read-only summary or blocks with a guided detour. |
| NEW-G | Card label: single-WTC = `10085 - Test - Epoxy`; joined card (2+) = `10085 - Test - N work types`; chip below shows WTC numbers. |
| Q4 | Card title + WTC chip below. |
| Q5 | JobDetail in sch-command drops embedded crew grid (separate planning agent). |
| Q7 | Step-5 sibling detection: 1 unjoined card → Yes/No; N unjoined cards → enumerate. |
| NEW-B | `call_log.stage` stays `Sold`; remove the existing Parked write. |
| Schema | `material_status` is an enum of `ordered`, `partially_ordered`, `not_ordered`, `on_hand`, `local_store_pickup` (snake_case storage; display-label map in UI). |
| Schema | `end_date` is derived server-side as `start_date + (field_sow.length - 1) days`. Never user-input. |
| Block | A WTC must have `start_date` AND `field_sow.length ≥ 1` to be sendable. |

---

## §3 Q6 Resolution — Multi-WTC join model

### 3.1 Pre-question — what currently keys off `jobs.job_id`?

`jobs.job_id` is a sch-command-owned BIGSERIAL integer (per `migration_workflow_refactor.sql` + observed FK usage). Every aggregator and audit reader in sch-command joins to it:

- `billing_log.job_id` → `jobs.job_id` (`JobCardList.jsx:139-150`, `JobDetail.jsx:79`, `Jobs.jsx:151`, `exports.js:109-110`).
- `materials.job_id` → `jobs.job_id` (`JobDetail.jsx:80`, `Materials.jsx:127`, `exports.js:137-138`).
- `assignments.job_id` → `jobs.job_id` (`JobDetail.jsx:78`, `Schedule.jsx:153/338/341/352/364/368`, `Schedules.jsx:147`, `Calendar.jsx:247`, `exports.js:64/110/162`, `StatsBar.jsx:51`).
- `job_changes.job_id` → `jobs.job_id` (`queries.js:102/144`, `JobDetail.jsx:81`).

**Gotcha (from sch-command CLAUDE.md):** `job_crew.job_id` is **NOT** `jobs.job_id` — it's a FK to `call_log.id`. This is a deliberate exception (FK mismatch) and is unaffected by the multi-WTC model since it lives at the call_log layer.

**Per-WTC attributes that need a home:** `field_sow` (jsonb day-list), `material_status` (new enum), `start_date`, `end_date` (derived from field_sow), `proposal_wtc_id` (lineage back to sales), the WTC's work-type name (for the chip in NEW-G), and the position-in-card (WTC chip "WTC 1, WTC 2…" comes from order).

**Today's `jobs` row already carries** `field_sow`, `materials_needed`, `start_date`, `end_date`, `source_proposal_id`, `source_call_log_id`. Today's merge is flat — one row's `field_sow` is a `flatMap` across all the proposal's WTCs.

**Hidden blocker:** `~/sch-command/add_source_columns.sql` line 9-10 creates a partial UNIQUE index on `source_proposal_id` (`idx_jobs_source_proposal_id`). Sales-command relies on the `23505` error path to UX "already sent" (line 557). **This UNIQUE index must be dropped** before any second-WTC-from-same-proposal insert can succeed under any of the three candidate models.

### 3.2 Pressure-test each candidate

**Option (a) Row-per-WTC + `card_group_id` on `jobs`**

- One `jobs` row per WTC. Cards with 2+ WTCs share a `card_group_id` (new uuid column, nullable).
- Joining = update both rows' `card_group_id` to a shared value.

| Concern | Verdict |
|---|---|
| `billing_log.job_id` semantics | **Bad.** Billing-percent is a card-level concept, not a WTC-level concept. If card has 3 WTC-rows under one `card_group_id`, which `job_id` does a billing-log entry attach to? Aggregators have to learn `GROUP BY card_group_id`. |
| `assignments.job_id` semantics | **Bad** for the same reason — crew is assigned to the card, not the WTC. Either every aggregator GROUPs by `card_group_id`, or you duplicate every assignment across N rows. |
| `materials.job_id` semantics | Mixed. Materials are naturally per-WTC (each WTC has its own materials list). But existing rows are per-card (one ordinal series). New per-WTC rows would split nicely; legacy merged rows stay 1-row-per-card. **Tolerable.** |
| Historical merged-row shape | Legacy rows would each become their own "1-WTC card" with `card_group_id` NULL. Acceptable. |
| Step 5 sibling detection enumeration | Needs to query distinct `card_group_id`s for the proposal. Doable but requires a CASE-style fallback for NULLs. |
| Volume of code churn | Heavy. Every billing/assignment/JobCardList/StatsBar/exports.js aggregator must be touched. |

**Option (b) Row-per-card with WTC list as jsonb on `jobs`**

- One `jobs` row per card. Card carries a `wtcs jsonb` array — each element `{ proposal_wtc_id, field_sow, material_status, work_type_name, start_date, end_date }`.

| Concern | Verdict |
|---|---|
| `billing_log.job_id` | **Good.** Card-level identity preserved; existing FK semantics unchanged. |
| `assignments.job_id` | **Good.** Same. |
| `materials.job_id` | **Workable** — material rows still attach to `jobs.job_id`. But per-WTC `material_status` lives inside the jsonb, separate from `materials` table. Schema clarity suffers. |
| Card join | INSERT into `jobs.wtcs` jsonb array, mutating in place. Possible, but mutation of jsonb arrays has no FK integrity, no audit trail per WTC, and `job_changes` can only log the whole-array diff. |
| Card unjoin (later, sch-command card-merge inverse) | jsonb-array splice + INSERT new card. Concurrent-edit risk. |
| Per-WTC field_sow editing on sch-command side | Awkward. Reader of `field_sow` for "Edit field SOW" detail page must descend into `wtcs[idx].field_sow`. Today `FieldSowModal.jsx:92` writes `jobs.field_sow` directly. |
| Historical merged-row shape | Legacy `jobs.field_sow` is a flat list, `wtcs` jsonb is NULL. Two readers needed. |

**Option (c) Hybrid: `jobs` = card; `job_wtcs` join table = per-WTC attributes** ← **CHOSEN**

- One `jobs` row per card. `jobs.job_id` remains the single FK target for `billing_log`, `materials`, `assignments`, `job_changes`.
- New table `job_wtcs` holds per-WTC attributes: `(id uuid PK, job_id int8 FK jobs, proposal_wtc_id uuid FK proposal_wtc, work_type_id int, work_type_name text snapshot, position int, field_sow jsonb, material_status text enum, start_date date, end_date date, created_at timestamptz)`.
- Card-level fields on `jobs` (start_date, end_date) are derived from MIN/MAX across child `job_wtcs` rows; the wizard writes both card-level and child-level on insert so existing aggregators keep working.
- Join = INSERT a new `job_wtcs` row pointing at the existing `jobs.job_id`. Refresh card-level `jobs.start_date/end_date` to MIN/MAX of child rows. Refresh card-level `jobs.field_sow` to flat-concat of children (preserves the legacy reader contract).
- Unjoin = DELETE the `job_wtcs` row + INSERT a new `jobs` row + INSERT a fresh `job_wtcs` row pointing at the new job. (Separate sch-command planning agent owns the unjoin UI.)

| Concern | Verdict |
|---|---|
| `billing_log.job_id` | **Good.** Unchanged. |
| `assignments.job_id` | **Good.** Unchanged. |
| `materials.job_id` | **Good.** Unchanged. Per-WTC `material_status` is a column on `job_wtcs`; legacy boolean `materials_needed` is mirrored at the card level on `jobs` for read-back during the additive window. |
| `job_crew.job_id` (FK to `call_log.id`) | Unaffected. |
| Card join | Pure INSERT — full FK integrity, fully auditable via `job_changes`. |
| Card unjoin | Pure DELETE + INSERT — auditable. |
| Historical merged-row shape | **Backwards-compatible without migration.** Legacy rows have zero `job_wtcs` children. Readers in sch-command fall back to `jobs.field_sow` / `jobs.materials_needed` when `job_wtcs` rows are absent. Backfill is optional and non-destructive — can run later, or never. |
| Step 5 sibling detection enumeration | Single LEFT JOIN: `SELECT j.* FROM jobs j WHERE j.source_proposal_id = $1`. Per-card count of WTCs = `SELECT count(*) FROM job_wtcs WHERE job_id = j.job_id`. Clean. |
| Per-WTC field_sow editing on sch-command | New code can read `job_wtcs.field_sow` for new rows; legacy reads continue from `jobs.field_sow`. |
| Tenant scoping (no `tenant_id` on `jobs`) | `job_wtcs` also has no `tenant_id`; scope inherits via `jobs.call_log_id → call_log.tenant_id`. RLS pattern matches existing `materials`/`assignments`. |
| RLS surface | `job_wtcs` needs a SELECT/INSERT/UPDATE/DELETE policy set scoped via `jobs → call_log.tenant_id`. New policy; not auth-touching (does not change anon paths). |
| Edge function complexity | Two inserts (`jobs` + `job_wtcs`) inside one transaction (RPC-wrapped). |

**Verdict: Option (c).** Single FK target preserves the entire downstream aggregator graph without changes. Join/unjoin are pure DML on a new table — no jsonb mutation, no group-by sleight-of-hand. Legacy data needs no migration. Future per-WTC features (per-WTC material status, per-WTC display chip, per-WTC schedule range) have a natural home.

**Rejected: Option (a)** — pushes aggregation burden to every reader. **Rejected: Option (b)** — silently destroys FK integrity at every join; jsonb-mutation concurrency is a footgun the codebase has no precedent for.

### 3.3 Concrete shape

```sql
-- job_wtcs join table
CREATE TABLE IF NOT EXISTS public.job_wtcs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           int8 NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  proposal_wtc_id  uuid NOT NULL REFERENCES public.proposal_wtc(id) ON DELETE RESTRICT,
  work_type_id     int  NOT NULL,
  work_type_name   text NOT NULL,   -- snapshot for label rendering
  position         int  NOT NULL,   -- 1-based, for "WTC 1, WTC 2…" chip ordering
  field_sow        jsonb NOT NULL,  -- denormalized snapshot from proposal_wtc at send time
  material_status  text NOT NULL,   -- enum: ordered | partially_ordered | not_ordered | on_hand | local_store_pickup
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_wtcs_job_id ON public.job_wtcs(job_id);
CREATE INDEX idx_job_wtcs_proposal_wtc_id ON public.job_wtcs(proposal_wtc_id);
-- A given proposal_wtc can only be sent once (block re-send of same WTC).
CREATE UNIQUE INDEX idx_job_wtcs_proposal_wtc_uniq ON public.job_wtcs(proposal_wtc_id);

-- material_status as a CHECK (not a Postgres enum type — avoids ALTER TYPE pain
-- and matches the precedent of `jobs.status` being plain text).
ALTER TABLE public.job_wtcs
  ADD CONSTRAINT job_wtcs_material_status_chk CHECK (
    material_status IN (
      'ordered', 'partially_ordered', 'not_ordered',
      'on_hand', 'local_store_pickup'
    )
  );
```

**Why a CHECK constraint, not a Postgres enum:**

- `jobs.status` is plain text today (per `JobCardList.jsx:18-27` normalizer accepting many forms).
- Postgres enums require an `ALTER TYPE … ADD VALUE` migration to extend, which can't be run inside a transaction in some PG versions and is a footgun for future material-status additions.
- A CHECK constraint with a plain text column is cheap to extend (DROP/ADD constraint) and reads natively in PostgREST without type coercion.

This also satisfies planning-doc constraint "`material_status` enum — replaces today's `materials_needed` boolean" semantically; storage is text with constraint.

### 3.4 `jobs` column add (card-level)

```sql
-- Mirror material_status onto jobs for card-level summary (so JobCardList /
-- Materials view can show a single status when card has 1 WTC, or "mixed"
-- when card has N WTCs with non-uniform statuses).
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS material_status text;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_material_status_chk CHECK (
    material_status IS NULL
    OR material_status IN (
      'ordered', 'partially_ordered', 'not_ordered',
      'on_hand', 'local_store_pickup', 'mixed'
    )
  );
```

`mixed` is a card-level-only value, set by the join RPC when child statuses diverge.

### 3.5 Drop the blocker UNIQUE index

```sql
-- Was: CREATE UNIQUE INDEX idx_jobs_source_proposal_id ON jobs(source_proposal_id)
--      WHERE source_proposal_id IS NOT NULL.
-- Blocks per-WTC sends from the same proposal. Drop early.
DROP INDEX IF EXISTS public.idx_jobs_source_proposal_id;
```

Sales-command read path that uses the unique-error UX (`23505`) now needs a different guard. We move "already sent for this WTC" check **upstream** in the edge function: `SELECT … FROM job_wtcs WHERE proposal_wtc_id = $1`. The new UNIQUE on `job_wtcs.proposal_wtc_id` (3.3) replaces the old card-level guard with a tighter, WTC-level guard.

---

## §4 M5 Resolution — migration ownership + sequencing

### 4.1 Repo ownership

**Decision: sch-command owns the migration file.**

Confirms the planning doc's leaning. Rationale:

- `jobs` is sch-command-owned per `~/sch-command/CLAUDE.md` ("Schedule-owned tables: jobs, crew, assignments, crew_status, materials, billing_log, job_changes, job_crew").
- The new `job_wtcs` table is a sch-command extension of `jobs` (per-WTC attributes), even though sales-command writes the first row at wizard send-time. Same precedent as `materials` — sch-command owns it; sales currently writes initial rows via `handleSendToSchedule`.
- `~/sch-command/supabase/migrations/` is sparse (1 file). This work doubles the directory size, which is fine.
- Sales-command's `supabase/migrations/` history is dense and consistent; mixing a sch-command-owned table's DDL into it muddies the "this repo owns these tables" story (CLAUDE_RLS.md cross-repo grep rule).

### 4.2 RLS / 6-gate vs. lighter additive pattern

**This migration is pure schema. It is not RLS-touching. The 6-gate pattern does NOT fully apply.**

Per `~/sch-command/docs/planning/JOBS_IA_REFACTOR.md` "For non-RLS schema migrations" block, we follow the **lighter additive-mutate-cleanup pattern**:

1. **Additive** — add new columns + new table + new RLS policies for the new table; do not drop anything legacy yet.
2. **Verify** — read + write both shapes work in prod.
3. **Cleanup** — optionally tighten constraints once 100% populated.

There is ONE RLS surface: new SELECT/INSERT/UPDATE/DELETE policies on the new `job_wtcs` table. These are net-additive (the table didn't exist before, so no overlap with old policies). They are **NOT** in the `signing_token IS NOT NULL` anti-pattern shape; they scope via `EXISTS (SELECT 1 FROM jobs j WHERE j.job_id = job_wtcs.job_id …)` and via the standard authenticated-tenant predicate. No anon role surface. **6-gate pattern still does not apply.** (Per planning-doc text: "6-gate deploy for any RLS/auth-touching migration. … For pure schema changes (no policy impact), the lighter additive pattern above suffices." Adding a table with sane policies is "no policy-impact" because no existing read or write path changes.)

### 4.3 Deploy sequence — 5 steps

Each forward migration paired with a rollback in `~/sch-command/supabase/rollbacks/`. Cross-repo grep must clear before each push.

| Step | Action | File | Verification query |
|---|---|---|---|
| S1 | Add `material_status` text column on `jobs` (nullable, with CHECK). | `~/sch-command/supabase/migrations/20260512120000_jobs_material_status_additive.sql` | `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='jobs' AND column_name='material_status';` — expect 1 row, text, YES. |
| S2 | Create `job_wtcs` table + indexes + UNIQUE on `proposal_wtc_id` + CHECK on `material_status` + RLS policies. | `~/sch-command/supabase/migrations/20260512120100_job_wtcs_create.sql` | `SELECT count(*) FROM job_wtcs;` returns 0. `\d+ job_wtcs` shows 4 indexes + 1 CHECK + 4 RLS policies. |
| S3 | Drop the blocker `idx_jobs_source_proposal_id` UNIQUE index. **Run only AFTER** sales-command edge function is deployed and references the new `job_wtcs.proposal_wtc_id` UNIQUE for the duplicate guard. | `~/sch-command/supabase/migrations/20260512120200_jobs_drop_source_proposal_unique.sql` | `SELECT indexname FROM pg_indexes WHERE tablename='jobs' AND indexname='idx_jobs_source_proposal_id';` returns 0 rows. |
| S4 | (Optional backfill, lazy.) Populate `jobs.material_status` from `materials_needed` for existing rows where the value is unambiguous. | `~/sch-command/supabase/migrations/20260512120300_jobs_material_status_backfill.sql` | `SELECT material_status, count(*) FROM jobs GROUP BY 1;` — expect non-null where legacy boolean was set. |
| S5 | (Cleanup, deferred ≥30 days.) Drop legacy `materials_needed` boolean from `jobs` once sch-command UI no longer reads it. | `~/sch-command/supabase/migrations/<future>_jobs_drop_materials_needed.sql` | `SELECT column_name FROM information_schema.columns WHERE table_name='jobs' AND column_name='materials_needed';` returns 0 rows. **Out of scope for this plan** — sch-command IA-refactor agent should own. |

**Why S3 is sequenced after edge function deploy, not before:** the unique-index is currently the "already sent" UX guard on the sales side (`ProposalDetail.jsx:557`). Until the edge function ships with the new `job_wtcs.proposal_wtc_id` UNIQUE-based guard, dropping the index removes the guard altogether. Order: ship edge fn first (it uses the new check), then drop the legacy index.

**Why S4 is lazy/optional:** legacy `jobs` rows have unknown true material status. The planning doc asks ("true → `not_ordered` as default; false → `not_ordered` as well? or skip? planning agent decides"). **Decision: skip the backfill for false-valued rows; set `not_ordered` only for `true`-valued legacy rows.** Reasoning: `materials_needed = false` historically meant "I confirmed no materials are needed" (true negative). Mapping that to `not_ordered` would silently re-open a closed loop. Rows with `materials_needed = false` keep `material_status = NULL`, and the sch-command UI (separate agent's scope) reads "Not decided" for NULL — preserving the legacy semantic. Rows with `materials_needed = true` and ≥1 unordered material map to `not_ordered`; those with all `Ordered` materials map to `ordered`. The backfill SQL is documented but applying it is at sch-command-IA-agent's discretion.

### 4.4 Forward migration content sketches

**S1: `20260512120000_jobs_material_status_additive.sql`**

```sql
BEGIN;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS material_status text;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_material_status_chk CHECK (
    material_status IS NULL
    OR material_status IN (
      'ordered', 'partially_ordered', 'not_ordered',
      'on_hand', 'local_store_pickup', 'mixed'
    )
  );
COMMENT ON COLUMN public.jobs.material_status IS
  'Per-card material status (new wizard). NULL = legacy row / not decided. '
  '"mixed" reserved for joined cards with non-uniform child WTC statuses. '
  'Per-WTC granularity lives on job_wtcs.material_status.';
COMMIT;
```

**S1 rollback: `20260512120001_revert_jobs_material_status_additive.sql`**

```sql
BEGIN;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_material_status_chk;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS material_status;
COMMIT;
```

**S2: `20260512120100_job_wtcs_create.sql`** — full body in §3.3 above plus RLS:

```sql
ALTER TABLE public.job_wtcs ENABLE ROW LEVEL SECURITY;

-- Authenticated reads scoped by tenant via parent jobs.call_log_id chain.
CREATE POLICY job_wtcs_select_authenticated ON public.job_wtcs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.call_log cl ON cl.id = j.call_log_id
    WHERE j.job_id = job_wtcs.job_id
      AND cl.tenant_id = public.get_user_tenant_id()
  ));

CREATE POLICY job_wtcs_insert_authenticated ON public.job_wtcs
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.call_log cl ON cl.id = j.call_log_id
    WHERE j.job_id = job_wtcs.job_id
      AND cl.tenant_id = public.get_user_tenant_id()
  ));

CREATE POLICY job_wtcs_update_authenticated ON public.job_wtcs
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.call_log cl ON cl.id = j.call_log_id
    WHERE j.job_id = job_wtcs.job_id
      AND cl.tenant_id = public.get_user_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.call_log cl ON cl.id = j.call_log_id
    WHERE j.job_id = job_wtcs.job_id
      AND cl.tenant_id = public.get_user_tenant_id()
  ));

CREATE POLICY job_wtcs_delete_authenticated ON public.job_wtcs
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.call_log cl ON cl.id = j.call_log_id
    WHERE j.job_id = job_wtcs.job_id
      AND cl.tenant_id = public.get_user_tenant_id()
  ));
```

**S2 rollback: `20260512120101_revert_job_wtcs_create.sql`**

```sql
BEGIN;
DROP TABLE IF EXISTS public.job_wtcs;
COMMIT;
```

**S3: `20260512120200_jobs_drop_source_proposal_unique.sql`**

```sql
BEGIN;
DROP INDEX IF EXISTS public.idx_jobs_source_proposal_id;
-- Defense in depth: keep a non-unique index for query perf.
CREATE INDEX IF NOT EXISTS idx_jobs_source_proposal_id_nonunique
  ON public.jobs(source_proposal_id) WHERE source_proposal_id IS NOT NULL;
COMMIT;
```

**S3 rollback: `20260512120201_revert_jobs_drop_source_proposal_unique.sql`**

```sql
BEGIN;
-- WARNING: this rollback can fail if any proposal now has ≥2 jobs rows
-- pointing at it (post-wizard normal state). If failure, manually consolidate.
DROP INDEX IF EXISTS public.idx_jobs_source_proposal_id_nonunique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_proposal_id
  ON public.jobs(source_proposal_id) WHERE source_proposal_id IS NOT NULL;
COMMIT;
```

**Per-step verification queries** are inline in the table at §4.3.

### 4.5 Cross-repo grep checklist (before each push)

For each affected table, confirm no other repo will break:

- `jobs` — already shared (sales writes; sch reads/writes). `grep -rn "from('jobs')\|from(\"jobs\")" ~/sales-command/src ~/sch-command/src ~/field-command/src` before S1 and S3.
- `job_wtcs` — net new; no cross-repo refs to grep.
- `proposal_wtc` — sales-owned, FK target. Verify `grep -rn "proposal_wtc" ~/sch-command/src` shows only the `JobDetail.jsx:101-103` proposal-materials read path (already exists; unaffected).
- `materials_needed` — verify which repos still read it; sales-command must stop writing it after wizard ships (but reading is fine during the additive window).

---

## §5 File-by-file implementation plan (sales-command only)

Order matters. The executor should work top-to-bottom; each row's "depends on" makes the chain explicit.

| # | Path | New/Mod | Responsibility | Depends on |
|---|---|---|---|---|
| 1 | `~/sch-command/supabase/migrations/20260512120000_jobs_material_status_additive.sql` | NEW (in sch-command) | S1 of the additive sequence. | — |
| 2 | `~/sch-command/supabase/rollbacks/20260512120001_revert_jobs_material_status_additive.sql` | NEW | S1 rollback. | — |
| 3 | `~/sch-command/supabase/migrations/20260512120100_job_wtcs_create.sql` | NEW | S2: create `job_wtcs` + indexes + RLS. | 1 |
| 4 | `~/sch-command/supabase/rollbacks/20260512120101_revert_job_wtcs_create.sql` | NEW | S2 rollback. | — |
| 5 | `~/sales-command/supabase/functions/send-to-schedule/index.ts` | NEW | The wizard's commit endpoint. Pattern mirrors `send-pay-app/index.ts` (C9 fix). Loads proposal/WTC/customer/tenant from DB by ID. Inserts `jobs` + `job_wtcs` rows in a single RPC call. Returns `{ jobId, wtcId, joined: bool }`. **No `call_log.stage` write.** | 3 |
| 6 | `~/sales-command/supabase/functions/send-to-schedule/deno.json` | NEW (if convention) | Standard. | 5 |
| 7 | `~/sch-command/supabase/migrations/20260512120150_send_to_schedule_rpc.sql` | NEW | `SECURITY DEFINER` RPC `send_to_schedule(p_proposal_id text, p_proposal_wtc_id uuid, p_material_status text, p_existing_job_id int8 default null)`. Atomically inserts/updates `jobs` and `job_wtcs`. Asserts tenant via `public.get_user_tenant_id()` against `proposals.tenant_id`. **Returns** `{ job_id, job_wtcs_id, joined }`. | 3 |
| 8 | `~/sch-command/supabase/rollbacks/20260512120151_revert_send_to_schedule_rpc.sql` | NEW | Drop RPC. | — |
| 9 | `~/sales-command/src/components/SendToScheduleWizard.jsx` | NEW | 5-step wizard component. Owns local state for the run; no persistence across detours (per NEW-E). Imports `WTCCalculator` only as a child for the Step-3-detour path (mirroring how `ProposalDetail.jsx:622` mounts it). Calls the edge function on Step 5 Send. | 5 |
| 10 | `~/sales-command/src/components/ProposalDetail.jsx` | MOD | Replace `handleSendToSchedule()` body with `setShowSendWizard(true)`. Remove the inline `call_log.stage='Parked'` write at line ~588 (no longer needed). Add `<SendToScheduleWizard …/>` mount in render tree when `showSendWizard`. Update the badge logic at lines 68–69 / 492–493 to count `jobs.source_proposal_id = p.id` rows (already correct — just verify after S3 drops the UNIQUE, the badge still flips on first send). | 9 |
| 11 | `~/sch-command/supabase/migrations/20260512120200_jobs_drop_source_proposal_unique.sql` | NEW | S3: drop legacy UNIQUE. Run AFTER 5/9/10 are deployed. | 5, 9, 10 |
| 12 | `~/sch-command/supabase/rollbacks/20260512120201_revert_jobs_drop_source_proposal_unique.sql` | NEW | S3 rollback. | — |
| 13 | `~/sales-command/docs/handoffs/SC_Handoff_v<N+1>.txt` | NEW | Standard session closeout. | all |
| 14 | `~/sales-command/docs/BACKLOG.md` | MOD | Add a "completed log" row for the wizard work. Note F7 (multi-tenant) is unaffected (no new T2-class finding introduced). | all |

### 5.1 Detail — `SendToScheduleWizard.jsx`

**Props:** `{ proposal, wtcs, onClose, onSent }` — `proposal` is the loaded `p` from `ProposalDetail`; `wtcs` is the loaded `wtcs` array.

**State shape:**

```js
const [step, setStep] = useState(1);              // 1..5
const [selectedWtcId, setSelectedWtcId] = useState(null);
const [confirmedStartDate, setConfirmedStartDate] = useState(null);
const [materialStatus, setMaterialStatus] = useState(null);   // enum value
const [siblings, setSiblings] = useState([]);     // loaded at Step 5
const [joinTarget, setJoinTarget] = useState(null);  // null = create new card
const [sending, setSending] = useState(false);
const [showWTCEditor, setShowWTCEditor] = useState(false);  // Step 3 detour
```

**Step 1 — Select WTC.**
- Render each WTC in `wtcs` as a card. Disable + show "Sent" badge for WTCs already in `job_wtcs.proposal_wtc_id` (load this once on wizard mount via a single query `select proposal_wtc_id from job_wtcs where proposal_wtc_id in (...)`).
- "Next" disabled until selected.

**Step 2 — Confirm Start Date.**
- Pre-fill from `proposal_wtc.start_date`. If NULL, prompt — but per planning doc, start_date is a block condition: if it's NULL we still show this step but the "Next" button is gated until set. Save on continue: PATCH `proposal_wtc.start_date` (the date can be set without leaving the wizard — `proposal_wtc` is a small write that doesn't require the WTC editor).
- Date input uses `C.linenDeep` background per style rules.

**Step 3 — Field SOW.**
- Read `wtcs.find(w => w.id === selectedWtcId).field_sow`.
- If `field_sow.length === 0`: render the **guided "no SOW yet" panel** per NEW-E (exact copy from planning doc §54-79). Primary button "Open WTC Editor →" calls `setShowWTCEditor(true)`, which renders the `WTCCalculator` component in-place (same pattern as `ProposalDetail.jsx:622`) with the field-SOW tab pre-selected. When the user closes the editor, the wizard re-mounts at Step 1 (state is lost — this is intentional per NEW-E).
- If `field_sow.length ≥ 1`: render the read-only summary:
  - "N days planned, M-man crew" where `M = Math.max(...field_sow.map(d => d.crew_count || 0))`.
  - "Edit in WTC Editor →" link (same detour, but optional — user can proceed without editing).
- "Next" button gated on `field_sow.length ≥ 1`.

**Step 4 — Material Status.**
- Render 5 radio cards: Ordered, Partially Ordered, Not Ordered, On Hand, Local Store Pick Up.
- Pre-select `not_ordered` as default (matches the legacy behavior + matches sch-command's "Not Ordered" string in `JobCardList.jsx`).
- Selection writes to `materialStatus`.

**Step 5 — Summary + sibling detection.**
- Load existing `jobs` rows for this proposal: `select j.job_id, count(jw.id) as wtc_count from jobs j left join job_wtcs jw on jw.job_id = j.job_id where j.source_proposal_id = $1 group by j.job_id`. **This is the sibling list.**
- Cases:
  - **Zero siblings** (first WTC sent for this proposal): no prompt. Default = create new card.
  - **Exactly 1 sibling**: "Join with existing card for proposal {jobNumber}?" — Yes/No.
  - **N siblings**: enumerate each as a clickable row: `Job #{job_id} · {wtc_count} WTC(s) · {workTypeNames}` + a "Create new card" option.
- On Send: call edge function with `{ proposalId, proposalWtcId, materialStatus, existingJobId: joinTarget || null }`.

**Color tokens used:** All from `C.linen*` family per style rules. Teal buttons get `C.dark` text. No white.

### 5.2 Detail — edge function `send-to-schedule/index.ts`

Mirror `send-pay-app/index.ts` shape exactly:

1. CORS + service-role check.
2. `authenticateCaller(supabase, req, SERVICE_ROLE_KEY)` → reject if `caller.isServiceRole` (this is user-initiated UI).
3. Request body: `{ proposalId, proposalWtcId, materialStatus, existingJobId? }`. Validate presence + that `materialStatus` is in the allowed set.
4. **Load proposal from DB by ID** (`select id, tenant_id, call_log_id, total, proposal_number, call_log(display_job_number, job_name, is_change_order, co_number)` from `proposals` where `id = proposalId`). Assert `proposal.tenant_id === caller.tenantId`.
5. **Load WTC from DB by ID** (`select id, proposal_id, work_type_id, work_types(name, cost_code), field_sow, start_date, end_date, size, unit, prevailing_wage, sales_sow, materials` from `proposal_wtc`). Assert `wtc.proposal_id === proposalId` (same-tenant + same-proposal coupling). Assert `wtc.field_sow && wtc.field_sow.length >= 1` and `wtc.start_date IS NOT NULL` (defense in depth — the wizard should have gated, but the server re-checks per constraint 1).
6. **Already-sent guard:** `select id from job_wtcs where proposal_wtc_id = $1` — if returns a row, 409 `ALREADY_SENT`.
7. **End-date computation:** `derivedEndDate = startDate + (field_sow.length - 1) days`.
8. **Compute card-level fields** (only used when creating a new card): `work_type` = `wtc.work_types.name`, `sow` = `wtc.sales_sow`, `field_sow` = `wtc.field_sow`, `start_date` = `wtc.start_date`, `end_date` = `derivedEndDate`, `prevailing_wage` = `'Yes'` if `wtc.prevailing_wage` else `'No'`, etc. Mirror today's `handleSendToSchedule` shape **for backwards-compat** with all sch-command readers — minus the merge logic (we now write one WTC's worth).
9. **Call SECURITY DEFINER RPC** `send_to_schedule(proposalId, proposalWtcId, materialStatus, existingJobId)` which:
   - If `existingJobId IS NULL`: INSERT into `jobs` (card-level fields) + INSERT into `job_wtcs` (per-WTC fields) + INSERT `materials` rows from `wtc.materials` (with `material_status = $3` — wait, no, materials rows have their own status. Keep today's behavior: per-material `status = 'Not Ordered'`; the card-level + WTC-level enum is **about the materials-as-a-whole**, not per-material.). Return `{ job_id, job_wtcs_id, joined: false }`.
   - If `existingJobId IS NOT NULL`: assert the existing job's `source_proposal_id = proposalId` and `tenant_id` chain matches. INSERT into `job_wtcs` only (`job_id = existingJobId`). Refresh card-level `jobs.start_date / end_date / field_sow / material_status`:
     - `start_date = LEAST(jobs.start_date, new wtc.start_date)`
     - `end_date = GREATEST(jobs.end_date, derivedEndDate)`
     - `field_sow = jobs.field_sow || new wtc.field_sow` (concat for legacy reader compat)
     - `material_status = 'mixed'` if existing children's statuses diverge from new one, else the uniform value
   - Also INSERT `materials` rows for the new WTC, ordinal continuing from current MAX.
10. Return 200 with `{ jobId, jobWtcsId, joined }`. Frontend uses this to toast and to call `onSent(jobId)`.

**No HTML, no email, no PDFs — this is purely a DB write endpoint.** The C9 SSRF guard is unnecessary (no URLs trusted), but the C9 **auth + body-trust** pattern is fully mirrored.

### 5.3 RPC body — `send_to_schedule(...)` SQL sketch

```sql
CREATE OR REPLACE FUNCTION public.send_to_schedule(
  p_proposal_id      text,
  p_proposal_wtc_id  uuid,
  p_material_status  text,
  p_existing_job_id  int8 DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant         uuid;
  v_proposal       record;
  v_wtc            record;
  v_call_log_id    int;
  v_job_id         int8;
  v_job_wtcs_id    uuid;
  v_derived_end    date;
  v_joined         boolean := false;
  v_card_status    text;
BEGIN
  -- Tenant from caller's session.
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'NO_TENANT';
  END IF;

  -- Load proposal + assert tenant.
  SELECT id, tenant_id, call_log_id, proposal_number, total
    INTO v_proposal
    FROM public.proposals
   WHERE id = p_proposal_id;
  IF NOT FOUND OR v_proposal.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_IN_TENANT';
  END IF;
  v_call_log_id := v_proposal.call_log_id;

  -- Load WTC + assert proposal coupling.
  SELECT id, proposal_id, work_type_id, field_sow, start_date,
         (SELECT name FROM public.work_types WHERE id = w.work_type_id) AS work_type_name,
         materials, prevailing_wage, sales_sow, size, unit
    INTO v_wtc
    FROM public.proposal_wtc w
   WHERE id = p_proposal_wtc_id;
  IF NOT FOUND OR v_wtc.proposal_id <> p_proposal_id THEN
    RAISE EXCEPTION 'WTC_NOT_IN_PROPOSAL';
  END IF;
  IF v_wtc.start_date IS NULL OR jsonb_array_length(v_wtc.field_sow) < 1 THEN
    RAISE EXCEPTION 'WTC_NOT_READY';
  END IF;

  v_derived_end := v_wtc.start_date + (jsonb_array_length(v_wtc.field_sow) - 1);

  -- Already-sent guard at WTC level.
  IF EXISTS (SELECT 1 FROM public.job_wtcs WHERE proposal_wtc_id = p_proposal_wtc_id) THEN
    RAISE EXCEPTION 'ALREADY_SENT';
  END IF;

  IF p_existing_job_id IS NULL THEN
    -- Create new card.
    INSERT INTO public.jobs (
      call_log_id, source_proposal_id, source_call_log_id,
      work_type, sow, field_sow, scheduled_start, scheduled_end,
      start_date, end_date, status, size, size_unit,
      prevailing_wage, amount, proposal_number,
      material_status,
      job_num, job_name, is_change_order, co_number
    )
    SELECT
      v_call_log_id, p_proposal_id::text, v_call_log_id,
      v_wtc.work_type_name, v_wtc.sales_sow, v_wtc.field_sow,
      v_wtc.start_date, v_derived_end,
      v_wtc.start_date, v_derived_end,
      'Scheduled',  -- per JOBS_IA_REFACTOR.md: jobs land directly as Scheduled, no Parked
      v_wtc.size, COALESCE(v_wtc.unit, 'SF'),
      CASE WHEN v_wtc.prevailing_wage THEN 'Yes' ELSE 'No' END,
      v_proposal.total::text, v_proposal.proposal_number,
      p_material_status,
      cl.display_job_number, cl.job_name, cl.is_change_order, cl.co_number
    FROM public.call_log cl
    WHERE cl.id = v_call_log_id
    RETURNING job_id INTO v_job_id;
  ELSE
    -- Join with existing card.
    PERFORM 1 FROM public.jobs WHERE job_id = p_existing_job_id
      AND source_proposal_id::text = p_proposal_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'JOIN_TARGET_INVALID'; END IF;

    v_job_id := p_existing_job_id;
    v_joined := true;

    -- Refresh card-level start_date / end_date / field_sow.
    UPDATE public.jobs SET
      start_date = LEAST(start_date, v_wtc.start_date),
      end_date   = GREATEST(end_date, v_derived_end),
      scheduled_start = LEAST(scheduled_start, v_wtc.start_date),
      scheduled_end   = GREATEST(scheduled_end, v_derived_end),
      field_sow  = COALESCE(field_sow, '[]'::jsonb) || v_wtc.field_sow,
      material_status = CASE
        WHEN material_status IS NULL THEN p_material_status
        WHEN material_status = p_material_status THEN material_status
        ELSE 'mixed'
      END,
      work_type  = work_type || ',' || v_wtc.work_type_name
    WHERE job_id = v_job_id;
  END IF;

  -- INSERT job_wtcs row in both branches.
  INSERT INTO public.job_wtcs (
    job_id, proposal_wtc_id, work_type_id, work_type_name,
    position, field_sow, material_status, start_date, end_date
  ) VALUES (
    v_job_id, p_proposal_wtc_id, v_wtc.work_type_id, v_wtc.work_type_name,
    1 + COALESCE((SELECT count(*) FROM public.job_wtcs WHERE job_id = v_job_id), 0),
    v_wtc.field_sow, p_material_status, v_wtc.start_date, v_derived_end
  ) RETURNING id INTO v_job_wtcs_id;

  -- Materials rows (sync from WTC).
  INSERT INTO public.materials (job_id, ordinal, name, status, notes)
  SELECT v_job_id,
         COALESCE((SELECT MAX(ordinal) FROM public.materials WHERE job_id = v_job_id), -1) + row_number() OVER () AS ordinal,
         TRIM(COALESCE(m->>'product','') || COALESCE(' ('||(m->>'kit_size')||')','')) AS name,
         'Not Ordered',
         NULLIF(TRIM(
           COALESCE('Qty: ' || (m->>'qty'),'') ||
           COALESCE(CASE WHEN m ? 'supplier' THEN ' | Supplier: ' || (m->>'supplier') END,'')
         ),'')
  FROM jsonb_array_elements(COALESCE(v_wtc.materials, '[]'::jsonb)) AS m
  WHERE COALESCE(m->>'product','') <> '';

  RETURN jsonb_build_object(
    'job_id', v_job_id,
    'job_wtcs_id', v_job_wtcs_id,
    'joined', v_joined
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_to_schedule(text, uuid, text, int8) FROM public;
GRANT EXECUTE ON FUNCTION public.send_to_schedule(text, uuid, text, int8) TO authenticated;
```

**Note:** `jobs.status = 'Scheduled'` — sales-command writes the new vocab directly, since the planning doc locks "jobs land directly in Scheduled" (no Parked). This is in the sch-command refactor scope, but the wizard's INSERT statement has to choose **a** value. Writing `'Scheduled'` is forward-compatible: sch-command's existing `getJobStatus` normalizer (`JobCardList.jsx:18-27`) already maps `'scheduled'` correctly. Until the sch-command IA agent ships the picker/tab rename, the new card will appear under the existing "Ready" tile (which surfaces `Scheduled`-status jobs). Acceptable interim state.

### 5.3.1 [CLOSED] — Status value

**Resolution (2026-05-11, Chris):** Wizard writes `status = 'Scheduled'`. No interim `'Parked'` bridge value. The planning doc locks the new vocab (Q3 closed); the wizard must respect it.

The "what if sch-command picker hasn't been renamed yet?" concern is reframed as a **shipping-order constraint**, not a status-value question:

- **Wizard ships AFTER sch-command IA refactor** — recommended. No interim weirdness.
- **Wizard ships TOGETHER with sch-command IA refactor** — acceptable. Atomic flip.
- **Wizard ships BEFORE sch-command IA refactor** — NOT recommended. Avoid this ordering; the new `Scheduled`-status cards would land under the stale "Ready" tile until the picker rename catches up.

Implementation: the INSERT writes `'Scheduled'` literally. No flag, no later flip. (See §10 implementation order for the cross-repo sequencing this implies.)

---

## §6 Smoke / test plan

**Non-prod-mutating only.** Two paths:

- **Path A** — Vercel preview branch + TEST customer/proposal on prod Supabase. Use a customer flagged "test" so post-test cleanup is grep-able.
- **Path B** — Scratch Supabase project (per S1 precedent, `~/sales-command/docs/handoffs/SC_Handoff_v102.txt:70-184`). Spin up `xuovwlhqztqljyvveicu`-style scratch, apply migrations, link sales-command env to it, smoke, delete project.

**Path A is preferred** for the wizard work because the surface touches two repos and Path B requires re-pointing both repos' envs.

### 6.1 Test matrix

| # | Test | Setup | Action | Expected | Verification query |
|---|---|---|---|---|---|
| T1 | Single-WTC send (create new) | TEST customer "Test Customer 99", TEST proposal P99 with 1 WTC ("Epoxy"), `field_sow.length=3`, `start_date='2026-06-01'`, status=Sold. | Open ProposalDetail → click Send to Schedule → Step 1: pick Epoxy → Step 2: confirm 2026-06-01 → Step 3: see "3 days, 4-man crew" summary → Step 4: pick On Hand → Step 5: no siblings shown, click Send. | Toast "Sent to Schedule." Badge flips to "✓ Sent to Schedule". New `jobs` row created with `status='Scheduled'`. New `job_wtcs` row. **`call_log.stage` unchanged at 'Sold'.** | `SELECT j.job_id, j.status, j.start_date, j.end_date, j.material_status, jw.proposal_wtc_id, jw.position FROM jobs j JOIN job_wtcs jw ON jw.job_id = j.job_id WHERE j.source_proposal_id = 'P99';` — expect 1 row, status=Scheduled, dates=2026-06-01/2026-06-03, material_status=on_hand. Then `SELECT stage FROM call_log WHERE id = <P99.call_log_id>;` — expect 'Sold'. |
| T2 | Partial send → second-WTC join | After T1, edit P99 in sales to add a second WTC ("Caulking") with `field_sow.length=2`, `start_date='2026-06-05'`. | Open ProposalDetail → Send to Schedule → Step 1: Epoxy shows "Sent" badge and is disabled; pick Caulking → Step 2: 2026-06-05 → Step 3: pass → Step 4: not_ordered → Step 5: 1 sibling enumerated; click "Join with existing card" → Send. | New `job_wtcs` row inserted with `job_id=<from T1>`, position=2. `jobs.start_date` = 2026-06-01 (unchanged, LEAST), `jobs.end_date` = 2026-06-06 (GREATEST). `jobs.material_status='mixed'` (on_hand + not_ordered diverge). `jobs.work_type='Epoxy,Caulking'`. | `SELECT count(*) FROM job_wtcs WHERE job_id = <T1.job_id>;` — expect 2. `SELECT material_status, work_type FROM jobs WHERE job_id = <T1.job_id>;` — expect 'mixed', 'Epoxy,Caulking'. |
| T3 | Blocked send (Field SOW missing) | TEST proposal P98 with 1 WTC, `field_sow=NULL` or `field_sow=[]`, `start_date='2026-06-01'`, status=Sold. | Wizard Step 1 → pick WTC → Step 2: confirm date → Step 3: see "guided no-SOW" panel; click "Open WTC Editor →". | WTCCalculator mounts in place; the "Send to Schedule" wizard state is dismissed (per NEW-E note "leaving the wizard ends this session"). Verify the next-steps copy is exactly: "1. Click Open WTC Editor below. / 2. Build your day-by-day plan… / 3. Save your changes. / 4. Click Send to Schedule again on this proposal to come back here." Verify "Heads up: leaving the wizard ends this session…" appears. | No DB change expected. `SELECT count(*) FROM jobs WHERE source_proposal_id='P98';` — expect 0. |
| T4 | Re-entry after SOW save | After T3, in WTC editor add 3 day-entries + save. Return to ProposalDetail. Re-open the wizard. | Step 1: WTC no longer shows "Sent" badge. Pick it. Step 3: passes (read-only summary "3 days, M-man crew"). | Same as T1 above. | `SELECT jsonb_array_length(field_sow) FROM proposal_wtc WHERE id=<wtc_id>;` — expect 3 after save. |
| T5 | `material_status` enum write + readback on sch-command side | Open the new job in sch-command JobDetail. | Verify `material_status` column populates per WTC; verify card-level value reflects child statuses (or 'mixed'). | Read `jobs.material_status` and per-child `job_wtcs.material_status`. | `SELECT j.material_status AS card, jw.proposal_wtc_id, jw.material_status AS child FROM jobs j LEFT JOIN job_wtcs jw ON jw.job_id=j.job_id WHERE j.source_proposal_id='P99';` |
| T6 | `call_log.stage` does NOT change | After T1 + T2, inspect `call_log`. | `stage` stays at `'Sold'` for the proposal's call_log row. | — | `SELECT stage FROM call_log WHERE id = <P99.call_log_id>;` — expect 'Sold'. Confirm zero new `job_changes` rows with `field='stage'` from sales source. |
| T7 | Existing "Sent to Schedule" badge | After T1, refresh ProposalDetail. | Badge shows "✓ Sent to Schedule"; button disabled. | — | UI-only. Verify by inspecting the badge logic in `ProposalDetail.jsx:68-69` still finds a `jobs` row via `source_proposal_id`. |
| T8 | Tenant scoping | As a TEST tenant B user, try to send a proposal owned by tenant A via direct `fetch` to the edge function. | 403 Forbidden, no row created. | — | `SELECT count(*) FROM jobs WHERE source_proposal_id='<TENANT_A_PROP>' AND created_at > <test_start>;` — expect 0. |
| T9 | Server-side block re-checks (body trust) | Hand-craft a `fetch` to the edge function with a WTC ID whose `field_sow` is empty (bypassing the wizard gate). | 400 `WTC_NOT_READY`. No row created. | — | Server logs show `WTC_NOT_READY`. |
| T10 | Cross-repo rollback rehearsal | On scratch (Path B), apply S1+S2+S3, then apply rollbacks for S3+S2+S1 in reverse. | All migrations + rollbacks complete cleanly. No orphan FKs left behind. | Verify table/index existence flips per §4.3 verification queries. | `\d+ jobs`, `\d+ job_wtcs` before and after each. |

### 6.2 Smoke order

Run T1 → T2 → T3 → T4 → T5 → T6 → T7 sequentially on the preview branch (Path A). T8 + T9 run via curl with a hand-crafted JWT or on scratch (Path B). T10 runs on scratch only.

Before any production migration push:
1. T1–T9 green on preview against TEST customer/proposal.
2. T10 green on scratch.
3. Cross-repo grep checklist (§4.5) clear.

---

## §7 Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Cross-repo migration timing.** Sales edge function references `job_wtcs` and `material_status` before sch-command pushes the migration → 500 errors on Send. | Deploy order is locked in §4.3: S1+S2 first (sch-command), then sales edge function deploy, then S3. No sales-code-on-main references `job_wtcs` until after step S2 succeeds. |
| R2 | **RLS policy on `job_wtcs`.** New table needs SELECT/INSERT/UPDATE/DELETE policies scoped via `jobs.call_log_id → call_log.tenant_id` chain. Policy bug = either no reads (sch-command breaks) or cross-tenant reads (T2-class incident). | Policy bodies sketched in §4.4 use the existing `EXISTS(... call_log cl WHERE cl.tenant_id = public.get_user_tenant_id())` pattern (matches `materials` precedent). Verify on preview before pushing to prod. **NOT in `signing_token IS NOT NULL` anti-pattern shape** (no anon surface, all authenticated). |
| R3 | **Tenant scoping audit for the new edge function.** | Checklist:<br>- `authenticateCaller(...)` called and result checked (line 86 in C9 send-pay-app).<br>- `isServiceRole` rejected (this is user-initiated UI).<br>- Proposal loaded by ID + `.eq("tenant_id", caller.tenantId)` asserted.<br>- WTC loaded by ID + `.eq("proposal_id", proposalId)` asserted (transitively covers tenant).<br>- All DB inserts inside `send_to_schedule` RPC (SECURITY DEFINER) re-derive tenant from `public.get_user_tenant_id()`.<br>- No body field is ever interpolated into SQL via string concat; all parameterized.<br>- No body URL trusted; we don't accept any URLs in this fn. |
| R4 | **Historical data backfill failure modes.** Legacy merged-row jobs have `field_sow` spanning N WTCs but no `job_wtcs` children. The chosen Q6 option (c) is non-destructive — legacy rows continue working unchanged. | Acceptance: legacy rows have `job_wtcs.count = 0`; readers fall back to `jobs.field_sow` / `jobs.materials_needed`. Test verified in T1 (legacy row read still works while new row carries job_wtcs). |
| R5 | **Wizard state loss across the "leave to WTC editor → return" round trip (Step 3 NEW-E).** Users may not realize their Step 1/2/4 inputs are gone. | Mitigation already in NEW-E copy: "Heads up: leaving the wizard ends this session…" — surface this in **bold** in the panel. T3+T4 test verifies the user re-enters the wizard cleanly. |
| R6 | **Backwards-compatibility for `handleSendToSchedule` removal.** Does any other call site invoke this function? | `grep -rn "handleSendToSchedule\|sendToSchedule" ~/sales-command/src` confirmed ONLY 2 hits in `ProposalDetail.jsx`. Safe to replace inline. **No other call site.** |
| R7 | **The blocker UNIQUE index drop (S3).** Between S2 deploy and S3 deploy, two attempted sends of the second WTC on the same proposal will fail with `23505`. | Acceptable: this is the existing UX, plus the new wizard's Step 5 sibling-detection will offer "Join" before reaching the INSERT, so the path is taken before the UNIQUE bites. After S3, the old guard is replaced by the new `job_wtcs.proposal_wtc_id` UNIQUE (per-WTC, not per-proposal). |
| R8 | **`fn_auto_in_progress` trigger interactions.** This trigger on `time_punches` does `UPDATE jobs SET status='In Progress' WHERE call_log_id = NEW.job_id AND status IN ('Scheduled', 'Parked')`. Removing `Parked` from sales doesn't break it (filter is `IN ('Scheduled','Parked')` — extra status names are tolerated). | No action. Trigger is forward-compatible. Will simplify when sch-command IA agent ships the Parked drop. |
| R9 | **Missing runbook for 6-gate.** `CLAUDE_RLS.md:65-66` references `docs/runbooks/rls-deploy-gates.md` which does not exist. This migration is **not** RLS-touching so 6-gate doesn't apply, but the missing runbook is debt. | Recommend the cleanup (extract canonical 6-gate text from `SC_Handoff_v83.txt:64-89` into `~/sales-command/docs/runbooks/rls-deploy-gates.md`) **before** any later RLS-touching work in this area (e.g. F7 multi-tenant onboarding). Not a blocker for this plan. |
| R10 | **`sales_sow` truncation in joined cards.** Today's merge concatenates `sales_sow` text across WTCs with "WTC N — name:" labels (`ProposalDetail.jsx:511-514`). New wizard's joined-card refresh concatenates `field_sow` only; the card-level `jobs.sow` text is set from the first WTC and not re-merged on join. | Acceptable — `sales_sow` is sales-side note text, not a load-bearing field on sch-command's card display. Per-WTC `sales_sow` lives on `proposal_wtc` and is reachable via the proposal link if needed. If Chris wants per-WTC sales_sow snapshots on `job_wtcs`, that's a small addition. **Flag for review.** |
| R11 | **Sch-command JobDetail readiness-check writes to `materials_needed`.** `JobDetail.jsx:250/260/273` still writes the legacy boolean. Until the sch-command agent ships the readiness-checklist removal, these writes coexist with the new `material_status` column. | Non-blocker. Boolean and enum are independent columns. The sch-command agent's scope includes the JobDetail readiness-checklist removal (per planning doc) — which removes the boolean writes. |
| R12 | **No new T2-class finding introduced.** | Audit checklist:<br>- No new anon RLS policies.<br>- No new policy in `signing_token IS NOT NULL` shape.<br>- Edge function uses `authenticateCaller` and rejects service-role.<br>- Tenant assertion on every read + every write (via SECURITY DEFINER RPC).<br>- No body-trusted data on the server.<br>- No new HTML escape surfaces (no email sent).<br>- No new attachment / SSRF surface (no URLs trusted).<br>**Closed: no new T2 security finding.** F7 unaffected. |

---

## §8 Critical files for implementation

The top 5 by impact:

- `~/sales-command/supabase/functions/send-to-schedule/index.ts` (new edge function; mirrors C9 fix pattern)
- `~/sales-command/src/components/SendToScheduleWizard.jsx` (new 5-step wizard)
- `~/sales-command/src/components/ProposalDetail.jsx` (replace `handleSendToSchedule` body; remove the line ~588 stage write)
- `~/sch-command/supabase/migrations/20260512120100_job_wtcs_create.sql` (new join table + RLS)
- `~/sch-command/supabase/migrations/20260512120150_send_to_schedule_rpc.sql` (atomic SECURITY DEFINER RPC; the single transaction that all wizard sends route through)

Adjacent supporting files (not in the top 5 but load-bearing):

- `~/sch-command/supabase/migrations/20260512120000_jobs_material_status_additive.sql`
- `~/sch-command/supabase/migrations/20260512120200_jobs_drop_source_proposal_unique.sql` (and the three paired rollbacks)
- `~/sales-command/supabase/functions/_shared/tenantAuth.ts` (no change — referenced by the new edge fn for the standard auth shape)

---

## §9 Out of scope

- sch-command UI work: picker rename, `/jobs?tab=…` list views, JobDetail readiness-checklist removal, ScheduledCardList, multi-week pulse, multi-WTC card display, card-merge/unjoin action. Separate planning agent.
- Backfill of legacy `materials_needed` rows beyond S4's lazy/optional sketch.
- Anything that touches the `signing_token` policy surface (not relevant to this work).
- F7 multi-tenant onboarding (this work must not introduce new T2-class findings but does not unblock F7).
- The missing `docs/runbooks/rls-deploy-gates.md` cleanup (recommended in R9, not in scope).

---

## §10 Implementation order (executor's checklist)

1. **Migrations S1 + S2 on scratch.** Apply, then apply rollbacks. Confirm clean. (T10)
2. **RPC `send_to_schedule` on scratch.** Manual smoke via `curl` against scratch PostgREST. Verify tenant assertions.
3. **Edge function `send-to-schedule` on Supabase preview env.** Deploy via `supabase functions deploy send-to-schedule --no-verify-jwt false` (we DO want JWT verification — this is user-initiated). Smoke T8 + T9.
4. **`SendToScheduleWizard.jsx` + `ProposalDetail.jsx` edits on a feature branch.** PR-preview on Vercel. Smoke T1–T7 against TEST customer/proposal.
5. **Apply S1 + S2 to prod.** Run verification queries (§4.3). Confirm zero existing rows in `job_wtcs`.
6. **Deploy `send_to_schedule` RPC + edge function to prod.** Smoke T1 with the real TEST customer.
7. **Merge sales-command PR to main.** Vercel auto-deploys. Smoke T1+T2 in prod.
8. **Apply S3 (drop UNIQUE) to prod.** Smoke that "already sent" UX still works (via the new `job_wtcs.proposal_wtc_id` UNIQUE path).
9. **(Optional)** Apply S4 backfill or defer to sch-command-IA agent.
10. **Write handoff** `SC_Handoff_v<N+1>.txt`. Update `BACKLOG.md` Completed Log. Note F7 still unblocked.

---

## §11 Open question (closed)

**Closed 2026-05-11.** Wizard writes `status = 'Scheduled'`. The picker-rename interim concern is a shipping-order constraint (see §5.3.1) — wizard must not ship before the sch-command IA refactor. No open questions back to Chris.

````

---

## Reporting back

**What's in the plan:** Full design at the rigor of `multi_gc_allocation.md` (§1–§11). Q6 resolved as **option (c) hybrid (`jobs` card + `job_wtcs` join table)**. M5 resolved as **sch-command owns the migration**, **5-step pure-schema additive sequence** (lighter pattern, not 6-gate), with forward + rollback pairs and inline verification queries. File-by-file order (14 rows, ordered for top-to-bottom execution). Edge function pattern mirrors the C9 fix on `send-pay-app` exactly. 10-test smoke matrix with per-test setup/action/expected/verification. 12-row risk register.

**Q6 = (c) hybrid** because every downstream FK in sch-command (`billing_log`, `materials`, `assignments`, `job_changes`) targets `jobs.job_id`. Options (a) and (b) push aggregation/mutation burden into every reader or sacrifice FK integrity. Hybrid preserves `jobs.job_id` as the single card identity and isolates per-WTC attributes cleanly. Legacy merged rows continue working with zero migration.

**M5 = sch-command** owns the migration files (table-owner principle confirmed). Sequence: add `jobs.material_status` (S1) → create `job_wtcs` + RLS (S2) → deploy sales edge fn + UI → drop blocker UNIQUE `idx_jobs_source_proposal_id` (S3) → optional lazy backfill (S4). Cleanup of legacy `materials_needed` deferred to sch-command IA agent.

**New risks surfaced (not in planning doc):**
1. **Existing `UNIQUE(source_proposal_id)` partial index on `jobs`** — created by `~/sch-command/add_source_columns.sql` — silently blocks any second-WTC INSERT under any Q6 model. Must drop in S3, sequenced after sales code switches to the new `job_wtcs.proposal_wtc_id` UNIQUE-based guard.
2. **`jobs` has no `tenant_id` column** — the new edge function and RPC must scope through `jobs.call_log_id → call_log.tenant_id`. Pattern matches existing `materials`/`assignments`; risk is bookkeeping only.
3. **Status-name interim mismatch** — wizard writes `'Scheduled'` but sch-command's picker still says "Ready"/"Parked"; new cards appear under the Ready tile until the sch-command agent ships the rename. Flagged as the one [OPEN] question back to Chris (§5.3.1 / §11).
4. **`fn_auto_in_progress` trigger** on `time_punches` is forward-compatible (the `IN ('Scheduled','Parked')` filter tolerates the eventual Parked drop).
5. **`sales_sow` not concatenated on join** — the card's text-level `jobs.sow` keeps the first WTC's text; per-WTC `sales_sow` is reachable via `proposal_wtc`. Flagged in R10 for review if Chris wants per-WTC text snapshots on `job_wtcs`.

### Critical files for implementation
- /Users/chrisberger/sales-command/supabase/functions/send-to-schedule/index.ts (NEW)
- /Users/chrisberger/sales-command/src/components/SendToScheduleWizard.jsx (NEW)
- /Users/chrisberger/sales-command/src/components/ProposalDetail.jsx (MODIFY — replace `handleSendToSchedule` body, remove line ~588 `call_log.stage='Parked'` write)
- /Users/chrisberger/sch-command/supabase/migrations/20260512120100_job_wtcs_create.sql (NEW)
- /Users/chrisberger/sch-command/supabase/migrations/20260512120150_send_to_schedule_rpc.sql (NEW)