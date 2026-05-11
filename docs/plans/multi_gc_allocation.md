# Multi-GC Proposal Allocation — Design Plan

_Draft v0.2, re-derived 2026-05-11. Owner: Plan subagent (read-only); main session executes file writes on `feat/multi-gc-allocation`. Section tags: **[LOCKED]** (durable from v98/memory, do not re-derive) · **[DERIVED]** (mechanical from schema/precedent) · **[DESIGN-OPEN]** (needs Chris's input) · **[BLOCKED]** (depends on C1–S1 or H-C2/H-B2/F7)._

---

## §1 Problem statement

**[LOCKED]** Sales reps frequently receive RFPs from multiple General Contractors for the same underlying project (owner + jobsite + scope). Today they rebuild the proposal N times in Sales Command, generating typo drift, divergent pricing, and zero project-level pipeline visibility. The product gap: one project mentally, but N disconnected proposals in the data model.

**[LOCKED]** Multi-GC Proposal Allocation lets reps **build once, allocate to N GCs** by cloning a parent proposal into sister proposals stacked under a single shared `call_log` row. Sisters share content (scope of work, sizes, materials) sourced from the parent; they diverge on commerce (GC customer, RFP#, due date, markup, signed PDF). When a winner is awarded, sisters auto-flip to Lost.

**[LOCKED]** Scope of this plan: schema additions, one clone RPC, two sync RPCs, an award-flow RPC, a 4-screen wizard, and the migration of three customer-jobs surfaces to the new fallback pattern. Not in scope: the underlying RFP intake form, change-orders on sisters, multi-tenant RLS for sister cross-tenant scenarios (F7 handles that orthogonally).

---

## §2 Locked decisions

**[LOCKED]** (durable from v98, do not reopen)

| # | Decision |
|---|----------|
| Q1 | One `call_log` per project. `call_log.job_name` = project title (no new column). Sisters stacked under it. On Mark Awarded → winner → `proposals.status='Sold'` + `call_log.stage='Sold'`; sisters → `proposals.status='Lost'` + `lost_reason` + `lost_at`. Reversible. Never hard-deleted. |
| Q2 | Source-driven sync on content: `proposals.intro`; `proposal_wtc.sales_sow` (text) + `field_sow` / `materials` / `sub_areas` / `travel` (jsonb) + `size` / `unit` / `discount` / `discount_reason`. Per-GC on commerce: customer, contact, RFP#, due date, markup override. Sister overrides via `proposal_wtc.locally_edited_fields text[]`; conflict prompt fires when a source-edit hits an overridden field. |
| Q3 | Resolved by Q1. |
| Q4 | Two entry surfaces, one wizard: ProposalDetail `+ Send to Additional GCs` and CallLogDetail `+ Add Another GC`. |
| Q5 | Forward-only. No retro-link UI. Manual SQL for rare in-flight cases. |
| Sweep-1 | Nullable `proposals.customer_id` FK → `customers`. NULL falls back to `call_log.customer_id`. Client reads `p.customer_id ?? p.call_log?.customer_id` everywhere. |
| Sweep-2 | Nullable `proposals.markup_override_pct numeric`. Per-proposal multiplier on top of per-WTC `markup_pct`. |

---

## §3 Schema additions

**[DERIVED]** Single migration `supabase/migrations/20260512120000_multi_gc_allocation.sql` (slot is open — 0510 is the most recent applied). All columns nullable so the migration is reversible without data loss; F7-clean: every new column on a tenant-scoped table gets implicit `tenant_id` inheritance via parent FK.

**Sweep-1 — `proposals.customer_id`**
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_customer_id ON public.proposals(customer_id);
```
Semantics: NULL = inherit from `call_log.customer_id`. Backfill: none — every existing row reads through fallback. Trigger NOT added (we want NULL-means-inherit to be explicit, not auto-populated).

**Sweep-2 — `proposals.markup_override_pct`**
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS markup_override_pct numeric;
```
Semantics: NULL = no override. Effective per-WTC markup = `(proposal_wtc.markup_pct + COALESCE(p.markup_override_pct, 0))` (additive, not multiplicative — **[DESIGN-OPEN]** confirm with Chris: additive vs. multiplicative). `calc.js` must be updated.

**Sisters lineage — `proposals.cloned_from_proposal_id`**
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS cloned_from_proposal_id text
    REFERENCES public.proposals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_cloned_from ON public.proposals(cloned_from_proposal_id);
```
**[DERIVED]** Type is `text` (proposals.id is text — C4 resolved). Parent row has NULL; each sister points back to its parent. Used by sync RPCs to fan out source edits, and by award flow to find siblings under a `call_log`.

**Award-flow loss tracking — `proposals.lost_reason`, `proposals.lost_at`**
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz;
```
**[DERIVED]** Free-text reason. Set only by `award_proposal()` RPC and the reversal RPC. Index unnecessary (low-cardinality, write-once-mostly).

**Sister overrides — `proposal_wtc.locally_edited_fields text[]`**
```sql
ALTER TABLE public.proposal_wtc
  ADD COLUMN IF NOT EXISTS locally_edited_fields text[] NOT NULL DEFAULT '{}';
```
Stores the list of source-driven field names this WTC has locally overridden (e.g. `{'sales_sow','materials'}`). Sync RPCs read this to skip / prompt-on-conflict. `proposal_wtc` does NOT have its own tenant_id (it inherits from parent proposal); no RLS change needed.

**Audit table — `proposal_clones`**
```sql
CREATE TABLE IF NOT EXISTS public.proposal_clones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_proposal_id text NOT NULL REFERENCES public.proposals(id) ON DELETE SET NULL,
  sister_proposal_id text NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  call_log_id     integer NOT NULL REFERENCES public.call_log(id) ON DELETE CASCADE,
  wtc_count       integer NOT NULL,
  cloned_by       uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  cloned_at       timestamptz NOT NULL DEFAULT now(),
  tenant_id       uuid NOT NULL DEFAULT public.get_user_tenant_id()
                    REFERENCES public.tenant_config(id)
);
```
**[DERIVED]** Mirrors `call_log_merges` audit-row precedent. Full RLS block (SELECT scoped on tenant; INSERT scoped on tenant + `is_admin_or_manager()` — or just tenant, depending on whether wizard can be invoked by sales reps — **[DESIGN-OPEN]**).

**Open schema question — [DESIGN-OPEN]**
- Do sisters need their own `proposal_number` series, or do they share the parent's number and disambiguate by GC name only? Today `proposal_number` is unique per call_log (no DB constraint, but UI assumes it). The clone RPC has to assign new numbers; suggest `parent_number, parent_number+1, parent_number+2…` continuing from current max on the call_log. Ask Chris.

---

## §4 RPC `clone_proposal_to_gcs`

**[DERIVED + BLOCKED on H-C2]** Function signature, types, and structure are mechanical from the `merge_call_log` precedent, but the per-GC commerce inputs depend on the H-C2 fix shape for `send-proposal` (the wizard will eventually invoke `send-proposal` N times, and we want to commit to a body shape that survives the H-C2 fix).

```sql
CREATE OR REPLACE FUNCTION public.clone_proposal_to_gcs(
  p_source_proposal_id text,
  p_targets            jsonb  -- array of {customer_id, rfp_number, bid_due, markup_override_pct, signer_contact_id, viewer_contact_ids[]}
) RETURNS TABLE (sister_proposal_id text, customer_id uuid, proposal_number int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_source    public.proposals%ROWTYPE;
  v_target    jsonb;
  v_sister_id text;
  v_next_n    int;
  v_performed_by uuid;
BEGIN
  -- Auth + tenant gates
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_source FROM public.proposals
    WHERE id = p_source_proposal_id FOR UPDATE;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SOURCE'; END IF;
  IF v_source.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_DELETED'; END IF;

  SELECT id INTO v_performed_by
    FROM public.team_members WHERE auth_id = auth.uid() LIMIT 1;

  -- Next proposal_number on the shared call_log (active only)
  SELECT COALESCE(MAX(proposal_number), 0) INTO v_next_n
    FROM public.proposals
   WHERE call_log_id = v_source.call_log_id
     AND deleted_at IS NULL;

  FOR v_target IN SELECT * FROM jsonb_array_elements(p_targets)
  LOOP
    v_next_n := v_next_n + 1;
    v_sister_id := gen_random_uuid()::text;  -- proposals.id is text

    -- (a) Insert sister proposals row
    INSERT INTO public.proposals (
      id, call_log_id, status,
      intro,                                -- SOURCE-DRIVEN
      customer_id, markup_override_pct,     -- PER-GC
      proposal_number, cloned_from_proposal_id,
      tenant_id, signing_token, created_at
      -- approved_at, signing_token_expires_at, signing_token_consumed_at: NULL on insert; trigger auto-fills expires_at
    ) VALUES (
      v_sister_id, v_source.call_log_id, 'Draft',
      v_source.intro,
      (v_target->>'customer_id')::uuid, (v_target->>'markup_override_pct')::numeric,
      v_next_n, p_source_proposal_id,
      v_tenant_id, gen_random_uuid(), now()
    );

    -- (b) Clone proposal_wtc rows — C2 FIX: locked=false AND locked_line_total=NULL
    INSERT INTO public.proposal_wtc (
      proposal_id, work_type_id,
      sales_sow, field_sow, materials, sub_areas, travel,
      size, unit, discount, discount_reason,
      regular_hours, ot_hours, markup_pct,
      burden_rate, ot_burden_rate, tax_rate, prevailing_wage,
      start_date, end_date,
      locked, locked_line_total,           -- C2 fix here
      locally_edited_fields                -- empty array
    )
    SELECT
      v_sister_id, work_type_id,
      sales_sow, field_sow, materials, sub_areas, travel,
      size, unit, discount, discount_reason,
      regular_hours, ot_hours, markup_pct,
      burden_rate, ot_burden_rate, tax_rate, prevailing_wage,
      start_date, end_date,
      false, NULL,                         -- C2: H6 invariant preserved
      '{}'::text[]
    FROM public.proposal_wtc
    WHERE proposal_id = p_source_proposal_id;

    -- (c) Insert proposal_recipients from wizard's per-GC contact list
    -- (signer + viewers via customer_contacts ids passed in v_target)
    -- ... INSERT INTO proposal_recipients ...

    -- (d) Audit row
    INSERT INTO public.proposal_clones (
      parent_proposal_id, sister_proposal_id, call_log_id,
      wtc_count, cloned_by, tenant_id
    ) VALUES (
      p_source_proposal_id, v_sister_id, v_source.call_log_id,
      (SELECT count(*) FROM public.proposal_wtc WHERE proposal_id = v_sister_id),
      v_performed_by, v_tenant_id
    );

    sister_proposal_id := v_sister_id;
    customer_id := (v_target->>'customer_id')::uuid;
    proposal_number := v_next_n;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.clone_proposal_to_gcs(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.clone_proposal_to_gcs(text, jsonb) TO authenticated;
```

**[DESIGN-OPEN]** Per-WTC date sync. Sweep noted `start_date`/`end_date` on `proposal_wtc` (CLAUDE.md:142). Are these source-driven or per-GC? They're commercially relevant (each GC wants their own schedule). Suggest: per-GC, not source-driven — but ask Chris.

**[BLOCKED on H-C2]** Wizard ultimately invokes `send-proposal` N times. After H-C2's fix lands, `send-proposal` will accept only `proposalId` and load everything from DB. Design the wizard's invoke loop accordingly: `for each sister: supabase.functions.invoke("send-proposal", { body: { proposalId } })`. If the wizard ships before H-C2, it temporarily reads sister.signing_token + GC contact email + tenant_config and passes them through; the call site becomes a `git mv`-style change once H-C2 ships. Recommend: **block wizard send-on-create until H-C2 ships** so we never push a regression through.

---

## §5 Sync logic (`preview_sync_to_sisters` + `apply_source_edit_to_sisters`)

> **→ Resolved 2026-05-11. The granularity question, RPC bodies, conflict-prompt UX, and downstream implications are nailed down in "§5 Sync Semantics — Resolution" below. The text in this section is the original stub, kept as the trail of how we got there. Final answer: Option A+ (column-level for the 3 jsonb arrays; sub-key level for `travel`).**

**[DESIGN-OPEN — see resolution]** This is the highest-uncertainty section. Two-RPC pattern (preview returns conflicts, apply commits) is the right shape, but the exact column-vs-jsonb-field handling of `field_sow` / `materials` / `sub_areas` / `travel` needs Chris's input.

**Preview RPC** (read-only, returns conflict report):
```sql
CREATE FUNCTION public.preview_sync_to_sisters(
  p_source_proposal_id text,
  p_changed_fields text[]  -- e.g. {'intro','wtc:<wtc_id>:sales_sow','wtc:<wtc_id>:materials'}
) RETURNS jsonb
```
Returns `{ sisters: [{ sister_id, conflicts: [{ field, sister_value, source_value }] }] }`. A "conflict" is when the sister's `proposal_wtc.locally_edited_fields[]` contains the field key the source-edit is touching.

**Apply RPC**:
```sql
CREATE FUNCTION public.apply_source_edit_to_sisters(
  p_source_proposal_id text,
  p_changed_fields  text[],
  p_force_overwrite text[]  -- subset of p_changed_fields to overwrite despite local edits
) RETURNS jsonb
```

**[DESIGN-OPEN] Granularity for jsonb fields.** `materials` is a jsonb array of line items. If the rep edits one line on the source, do we:
- (a) overwrite the whole `materials` jsonb on every sister (simple, but blasts sister-local material additions)
- (b) treat each material row by some stable key (`item.name`? a synthetic id?) and merge row-by-row (complex, prone to identity drift)
- (c) keep it at "this whole jsonb is dirty" granularity in `locally_edited_fields` — i.e. once a sister edits ANY material row, the `'materials'` field is locked from sync.

Recommend (c) for v1 — coarse-grained, easy to reason about, matches mental model "I customized this sister's materials, leave them alone." Same applies to `field_sow`, `sub_areas`, `travel`.

**[DESIGN-OPEN] What triggers `locally_edited_fields` to populate?** Today's UI writes to `proposal_wtc` via WTCCalculator.jsx + ProposalDetail.jsx. Two implementation choices:
1. **DB trigger** — `BEFORE UPDATE OF sales_sow, field_sow, materials, …` on `proposal_wtc` appends the changed column name to `locally_edited_fields` IF the parent proposal's `cloned_from_proposal_id IS NOT NULL`. Pro: invisible to client. Con: requires column-aware logic in PL/pgSQL.
2. **Client-side** — wrap every WTC write in a helper that diffs old→new and writes `locally_edited_fields` alongside. Pro: explicit. Con: every edit site has to know.

Recommend (1) — DB trigger. Less burden on every code path.

---

## §5 Sync Semantics — Resolution

_Resolved 2026-05-11 (round-2 Plan agent). Reads the v109-era code: `src/pages/WTCCalculator.jsx` line citations below are against the WTC save path._

### 1. Pre-question — do the four jsonb columns have stable per-row identifiers?

**Answer: row-id presence is uneven; none of the IDs are durable, globally unique, or DB-enforced.**

Evidence from the WTC save path (`src/pages/WTCCalculator.jsx`) — these IDs are generated client-side and round-trip through Supabase only because the save handler at `WTCCalculator.jsx:1744-1750` writes the full jsonb blob verbatim (`materials: materials`, `field_sow: sow.field_sow`, `sub_areas: sow.sub_areas ?? []`, `travel: travel`) with no shape transformation.

| Column | Shape | Per-row id? | Generator | Stable? |
|---|---|---|---|---|
| `materials` | jsonb array of line-items | `id` field | `WTCCalculator.jsx:413` `addFromDB`: `{ id: Date.now(), product, kit_size, … }`; `:414` `addCustom`: same | **No.** `Date.now()` collides on rapid-fire adds and is not unique across sisters. Not a DB key. |
| `field_sow` | jsonb array of day-entries, each with nested `tasks[]` and nested `materials[]` | `id` on the day; `id` on each task | `:732` `addDay`: `{ id: Date.now(), day_label, tasks: [newTask()], crew_count, hours_planned, materials: [] }`; `:731` `newTask()`: `{ id: Date.now() + Math.random(), description, pct_complete }` | **No.** Day ids collide across sisters (same `Date.now()` epoch when cloned). Task ids use a random fraction to disambiguate but only within one session — not durable across clones. |
| `sub_areas` | jsonb array of `{ id, label, size, unit }` | `id` | `:727` `addSubArea`: `{ id: Date.now(), label: "", size: 0, unit: "SQFT" }` | **No.** Same `Date.now()` story. |
| `travel` | jsonb **object** (not array) — flat keys: `drive_rate`, `drive_miles`, `fly_rate`, `fly_tickets`, `stay_rate`, `stay_nights`, `per_diem_rate`, `per_diem_days`, `per_diem_crew` | N/A — no rows | Set as a flat object in `WTCCalculator.jsx:1520` and read in `calc.js:29` (`(t.drive_rate \|\| 0) * (t.drive_miles \|\| 0)`) | N/A — there are no rows to identify. Subfields are stable named keys. |

Implication: Option B (row-level merge with row-stable identifiers) is **not free**. To make it correct we would need to (a) backfill row ids into existing jsonb arrays via a one-time migration, (b) change every UI insertion site to generate `crypto.randomUUID()` instead of `Date.now()`, and (c) make `clone_proposal_to_gcs` rewrite all child ids in the cloned jsonb (otherwise sisters would share the parent's row ids and a "merge by id" model would treat divergent edits as the "same row"). That's a schema migration in spirit even if no DDL ALTER lands — it's an invariant migration across the jsonb payload.

Travel is the exception: it's not an array, so per-key sync is trivially available without any id question.

### 2. Recommendation — **Option A with one carve-out: travel is keyed by sub-key.**

Call it A+. For the three array-shaped jsonbs (`materials`, `field_sow`, `sub_areas`) — column-level granularity. For `travel` — sub-key granularity (each named travel key is its own entry in `locally_edited_fields[]`).

Rationale: the row identifiers don't exist durably, so Option B for the arrays would build sync correctness on a foundation that has been unstable since the WTC was first written — and the cost to fix that foundation (rewrite every id generator + backfill migration + clone-time id rewrite) is several days of work on a code path that's not the bottleneck. Column-level granularity matches the rep's mental model: "I customized this sister's materials list" is the level reps will think about overrides at. The carve-out for `travel` costs nothing because travel is already keyed.

So `locally_edited_fields[]` entries are exactly one of: `'intro'`, `'sales_sow'`, `'field_sow'`, `'materials'`, `'sub_areas'`, `'size'`, `'unit'`, `'discount'`, `'discount_reason'`, `'travel:drive_rate'`, `'travel:drive_miles'`, `'travel:fly_rate'`, `'travel:fly_tickets'`, `'travel:stay_rate'`, `'travel:stay_nights'`, `'travel:per_diem_rate'`, `'travel:per_diem_days'`, `'travel:per_diem_crew'`.

Note: `intro` lives on `proposals`, not `proposal_wtc`. Tracking it in `proposal_wtc.locally_edited_fields[]` is awkward (which WTC's row holds the flag?). Two options: (a) store `'intro'` only on the lowest-numbered WTC row per proposal, (b) add a sibling column `proposals.locally_edited_fields text[]` for proposal-scope fields. **[DESIGN-OPEN]** — recommend (b) for clarity; flagging rather than picking arbitrarily.

### 3. Row-id strategy / migration

N/A — Option A is chosen. No row-id strategy needed. No additional schema migration beyond `proposal_wtc.locally_edited_fields text[]` already in §3, plus the **[DESIGN-OPEN]** `proposals.locally_edited_fields text[]` for the `intro` carve-out.

### 4. RPC bodies

Both RPCs follow `merge_call_log` conventions: `SECURITY DEFINER`, `SET search_path = public`, `NO_TENANT` guard, `TENANT_MISMATCH` on cross-tenant, `RETURN jsonb`, `REVOKE … FROM public; GRANT EXECUTE … TO authenticated`. No audit-table writes — sync is high-frequency (every parent save), and `merge_call_log` itself only writes audit on a once-per-merge event. Compare-with-precedent decision: skip audit for sync. If demanded later, add `proposal_sync_events` with similar shape to `proposal_clones` (§3). **[DESIGN-OPEN]** — flagging rather than picking.

```sql
-- ----------------------------------------------------------------------------
-- preview_sync_to_sisters(p_source_proposal_id text)
-- ----------------------------------------------------------------------------
-- Read-only. Walks all sisters of p_source_proposal_id and reports, per
-- sister, which source-driven fields differ from source AND are flagged
-- on that sister's proposal_wtc.locally_edited_fields[] (conflicts), vs
-- which differ but are NOT flagged (will be quietly synced by apply).
--
-- Tracked fields:
--   proposals: intro
--   proposal_wtc scalars: sales_sow, size, unit, discount, discount_reason
--   proposal_wtc jsonb columns (column-level): field_sow, materials, sub_areas
--   proposal_wtc jsonb object subkeys (key-level): travel:<key>
--
-- Returns jsonb:
--   { sisters: [
--       { sister_id text,
--         pending: [{ field text, scope text }],     -- will auto-sync
--         conflicts: [{ field text, scope text,
--                       source_value jsonb, sister_value jsonb }]
--       },
--       ...
--     ]
--   }
-- where scope ∈ { 'proposal', 'wtc:<work_type_id>' }.
--
-- "Conflicts" gate on locally_edited_fields[] containing the field name
-- (or 'travel:<key>' for travel sub-keys, or 'intro' on the
-- proposals.locally_edited_fields[] sibling column if §3 adds it).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_sync_to_sisters(p_source_proposal_id text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant_id     uuid;
  v_source        public.proposals%ROWTYPE;
  v_result        jsonb := jsonb_build_object('sisters', '[]'::jsonb);
  v_sister        record;
  v_sister_obj    jsonb;
  v_pending       jsonb;
  v_conflicts     jsonb;
  v_wtc_source    record;
  v_wtc_sister    record;
  v_travel_key    text;
  v_travel_keys   text[] := ARRAY[
    'drive_rate','drive_miles','fly_rate','fly_tickets',
    'stay_rate','stay_nights','per_diem_rate','per_diem_days','per_diem_crew'
  ];
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_source FROM public.proposals
    WHERE id = p_source_proposal_id;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SOURCE'; END IF;
  IF v_source.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_DELETED'; END IF;

  FOR v_sister IN
    SELECT * FROM public.proposals
     WHERE cloned_from_proposal_id = p_source_proposal_id
       AND deleted_at IS NULL
       AND tenant_id = v_tenant_id
       AND status NOT IN ('Lost','Sold')   -- skip awarded/lost sisters
  LOOP
    v_pending   := '[]'::jsonb;
    v_conflicts := '[]'::jsonb;

    -- ---- proposal-scope: intro ----
    IF v_source.intro IS DISTINCT FROM v_sister.intro THEN
      -- DESIGN-OPEN: where does 'intro' live as a locked flag?
      -- Assuming §3 adds proposals.locally_edited_fields text[].
      IF 'intro' = ANY (COALESCE(v_sister.locally_edited_fields, '{}')) THEN
        v_conflicts := v_conflicts || jsonb_build_object(
          'field','intro','scope','proposal',
          'source_value', to_jsonb(v_source.intro),
          'sister_value', to_jsonb(v_sister.intro)
        );
      ELSE
        v_pending := v_pending || jsonb_build_object('field','intro','scope','proposal');
      END IF;
    END IF;

    -- ---- wtc-scope: walk source WTCs, join sister WTCs by work_type_id ----
    -- (Sisters were cloned 1:1 from source so work_type_id is the join key.)
    FOR v_wtc_source IN
      SELECT * FROM public.proposal_wtc WHERE proposal_id = p_source_proposal_id
    LOOP
      SELECT * INTO v_wtc_sister
        FROM public.proposal_wtc
       WHERE proposal_id = v_sister.id
         AND work_type_id = v_wtc_source.work_type_id
       LIMIT 1;

      IF v_wtc_sister.id IS NULL THEN
        CONTINUE;  -- sister missing this WTC (manual deletion); skip
      END IF;

      -- Inline diff for one scalar (size) — repeat block for sales_sow,
      -- unit, discount, discount_reason:
      IF v_wtc_source.size IS DISTINCT FROM v_wtc_sister.size THEN
        IF 'size' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_object(
            'field','size',
            'scope', 'wtc:' || v_wtc_source.work_type_id::text,
            'source_value', to_jsonb(v_wtc_source.size),
            'sister_value', to_jsonb(v_wtc_sister.size)
          );
        ELSE
          v_pending := v_pending || jsonb_build_object(
            'field','size',
            'scope','wtc:' || v_wtc_source.work_type_id::text
          );
        END IF;
      END IF;
      -- ... repeat for unit, discount, discount_reason, sales_sow ...

      -- jsonb columns (column-level granularity)
      IF v_wtc_source.field_sow::jsonb IS DISTINCT FROM v_wtc_sister.field_sow::jsonb THEN
        IF 'field_sow' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_object(
            'field','field_sow',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', v_wtc_source.field_sow,
            'sister_value', v_wtc_sister.field_sow
          );
        ELSE
          v_pending := v_pending || jsonb_build_object(
            'field','field_sow',
            'scope','wtc:' || v_wtc_source.work_type_id::text
          );
        END IF;
      END IF;
      -- ... repeat for materials, sub_areas ...

      -- travel (key-level granularity)
      FOREACH v_travel_key IN ARRAY v_travel_keys LOOP
        IF (v_wtc_source.travel -> v_travel_key) IS DISTINCT FROM (v_wtc_sister.travel -> v_travel_key) THEN
          IF ('travel:' || v_travel_key) = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
            v_conflicts := v_conflicts || jsonb_build_object(
              'field','travel:' || v_travel_key,
              'scope','wtc:' || v_wtc_source.work_type_id::text,
              'source_value', v_wtc_source.travel -> v_travel_key,
              'sister_value', v_wtc_sister.travel -> v_travel_key
            );
          ELSE
            v_pending := v_pending || jsonb_build_object(
              'field','travel:' || v_travel_key,
              'scope','wtc:' || v_wtc_source.work_type_id::text
            );
          END IF;
        END IF;
      END LOOP;
    END LOOP;

    v_sister_obj := jsonb_build_object(
      'sister_id', v_sister.id,
      'pending',   v_pending,
      'conflicts', v_conflicts
    );
    v_result := jsonb_set(v_result, '{sisters}',
                          (v_result->'sisters') || v_sister_obj);
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_sync_to_sisters(text) FROM public;
GRANT EXECUTE ON FUNCTION public.preview_sync_to_sisters(text) TO authenticated;


-- ----------------------------------------------------------------------------
-- apply_source_edit_to_sisters(p_source_proposal_id text, p_changed_fields text[])
-- ----------------------------------------------------------------------------
-- Writes source values into sisters. For each sister × field pair:
--   - field NOT in sister's locally_edited_fields[]  -> overwrite quietly
--   - field IS in sister's locally_edited_fields[]   -> skipped (returned
--       in 'skipped' so the client can decide whether to re-invoke with
--       p_force_overwrite).
--
-- p_force_overwrite shape: array of '<sister_id>:<field>' strings.
-- Conflict modal emits these from the user's per-row toggle decisions.
--
-- p_changed_fields[] uses the same vocabulary as locally_edited_fields[]:
--   'intro', 'sales_sow', 'size', 'unit', 'discount', 'discount_reason',
--   'field_sow', 'materials', 'sub_areas',
--   'travel:drive_rate' … 'travel:per_diem_crew'
-- For wtc-scoped fields, all WTC rows on the sister with matching
-- work_type_id are updated. (Multi-WTC of the same work_type is not
-- currently a supported shape — confirm with Chris.) **[DESIGN-OPEN]**
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_source_edit_to_sisters(
  p_source_proposal_id text,
  p_changed_fields     text[],
  p_force_overwrite    text[] DEFAULT '{}'::text[]
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_source      public.proposals%ROWTYPE;
  v_sister      record;
  v_field       text;
  v_force_key   text;
  v_should_skip boolean;
  v_synced      jsonb := '[]'::jsonb;
  v_skipped     jsonb := '[]'::jsonb;
  v_wtc_source  record;
  v_locked      boolean;
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_source FROM public.proposals
    WHERE id = p_source_proposal_id FOR UPDATE;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SOURCE'; END IF;
  IF v_source.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_DELETED'; END IF;

  FOR v_sister IN
    SELECT * FROM public.proposals
     WHERE cloned_from_proposal_id = p_source_proposal_id
       AND deleted_at IS NULL
       AND tenant_id = v_tenant_id
       AND status NOT IN ('Lost','Sold')
     FOR UPDATE
  LOOP
    FOREACH v_field IN ARRAY p_changed_fields LOOP
      v_force_key   := v_sister.id || ':' || v_field;
      v_should_skip := FALSE;

      -- Proposal-scope field
      IF v_field = 'intro' THEN
        IF 'intro' = ANY (COALESCE(v_sister.locally_edited_fields, '{}'))
           AND NOT (v_force_key = ANY (p_force_overwrite)) THEN
          v_should_skip := TRUE;
        END IF;

        IF v_should_skip THEN
          v_skipped := v_skipped || jsonb_build_object(
            'sister_id', v_sister.id, 'field', v_field, 'reason','locked');
        ELSE
          UPDATE public.proposals
             SET intro = v_source.intro
           WHERE id = v_sister.id;
          v_synced := v_synced || jsonb_build_object(
            'sister_id', v_sister.id, 'field', v_field);

          -- If forced over a lock, the override is gone -> remove the flag.
          IF 'intro' = ANY (COALESCE(v_sister.locally_edited_fields, '{}')) THEN
            UPDATE public.proposals
               SET locally_edited_fields = array_remove(locally_edited_fields, 'intro')
             WHERE id = v_sister.id;
          END IF;
        END IF;

      ELSE
        -- WTC-scope field. Walk source WTCs; for each, sync into sister's
        -- matching-work_type_id WTC row.
        FOR v_wtc_source IN
          SELECT * FROM public.proposal_wtc WHERE proposal_id = p_source_proposal_id
        LOOP
          -- Explicit lock-state read into a local (avoids brittle FOUND
          -- semantics across nested loops).
          SELECT v_field = ANY (COALESCE(locally_edited_fields, '{}'))
            INTO v_locked
            FROM public.proposal_wtc
           WHERE proposal_id = v_sister.id
             AND work_type_id = v_wtc_source.work_type_id
           LIMIT 1;

          IF NOT FOUND THEN
            -- Sister is missing this WTC (manually deleted). Surface, skip.
            v_skipped := v_skipped || jsonb_build_object(
              'sister_id', v_sister.id,
              'field', v_field,
              'scope', 'wtc:' || v_wtc_source.work_type_id::text,
              'reason', 'missing_on_sister');
            CONTINUE;
          END IF;

          IF v_locked AND NOT (v_force_key = ANY (p_force_overwrite)) THEN
            v_skipped := v_skipped || jsonb_build_object(
              'sister_id', v_sister.id,
              'field', v_field,
              'scope', 'wtc:' || v_wtc_source.work_type_id::text,
              'reason', 'locked');
            CONTINUE;
          END IF;

          -- Field-specific write.
          IF v_field = 'sales_sow' THEN
            UPDATE public.proposal_wtc SET sales_sow = v_wtc_source.sales_sow
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'size' THEN
            UPDATE public.proposal_wtc SET size = v_wtc_source.size
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'unit' THEN
            UPDATE public.proposal_wtc SET unit = v_wtc_source.unit
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'discount' THEN
            UPDATE public.proposal_wtc SET discount = v_wtc_source.discount
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'discount_reason' THEN
            UPDATE public.proposal_wtc SET discount_reason = v_wtc_source.discount_reason
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'field_sow' THEN
            UPDATE public.proposal_wtc SET field_sow = v_wtc_source.field_sow
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'materials' THEN
            UPDATE public.proposal_wtc SET materials = v_wtc_source.materials
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'sub_areas' THEN
            UPDATE public.proposal_wtc SET sub_areas = v_wtc_source.sub_areas
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field LIKE 'travel:%' THEN
            DECLARE
              v_tkey text := substring(v_field FROM 8);
              v_tval jsonb := v_wtc_source.travel -> v_tkey;
            BEGIN
              UPDATE public.proposal_wtc
                 SET travel = jsonb_set(COALESCE(travel, '{}'::jsonb), ARRAY[v_tkey], v_tval, true)
               WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
            END;
          ELSE
            RAISE EXCEPTION 'UNKNOWN_FIELD: %', v_field;
          END IF;

          v_synced := v_synced || jsonb_build_object(
            'sister_id', v_sister.id,
            'field', v_field,
            'scope', 'wtc:' || v_wtc_source.work_type_id::text);

          -- Forced over a lock -> clear the flag on that sister-WTC.
          IF v_locked THEN
            UPDATE public.proposal_wtc
               SET locally_edited_fields = array_remove(locally_edited_fields, v_field)
             WHERE proposal_id = v_sister.id
               AND work_type_id = v_wtc_source.work_type_id;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'source_id', p_source_proposal_id,
    'synced',    v_synced,
    'skipped',   v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_source_edit_to_sisters(text, text[], text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_source_edit_to_sisters(text, text[], text[]) TO authenticated;
```

**Sub-points flagged rather than picked:**
- **`'intro'` flag column.** Recommend `proposals.locally_edited_fields text[]` sibling column. **[DESIGN-OPEN]**.
- **Audit-table writes on sync.** Skipped for v1 (high-frequency vs. `merge_call_log`'s once-per-event). **[DESIGN-OPEN]** if a sync audit is later required, mirror `proposal_clones` shape.
- **Duplicate `work_type_id` on one proposal.** Today nothing prevents two `proposal_wtc` rows with the same `work_type_id` on the same proposal. Sync would fan source value into both. **[DESIGN-OPEN]** — needs a uniqueness constraint, or accept current behavior.

### 5. Conflict-prompt UX (plain English)

**When the prompt fires.** Every parent save in WTCCalculator/ProposalDetail that touches one of the source-driven fields, when at least one active sister exists (`EXISTS (SELECT 1 FROM proposals WHERE cloned_from_proposal_id = p.id AND deleted_at IS NULL AND status NOT IN ('Lost','Sold'))`). Trigger: client computes the diff between previous-saved state and new state, calls `preview_sync_to_sisters(parent_id)`, and shows the modal if the response has any sister with a non-empty `conflicts[]`. If all sister responses have empty `conflicts[]`, skip the modal and silently call `apply_source_edit_to_sisters(parent_id, changed_fields)` to push the pending updates.

**What it shows.** A modal titled "Sync to sister proposals." Body has two regions:
1. Top — "Will be synced automatically" — a flat list of sister × field rows from `pending[]` (read-only, just confirms what's about to happen).
2. Bottom — "These fields conflict with sister edits" — a grouped list, one card per sister. Each card shows the sister's GC name (via `customer_id`), and for each conflicting field a row with: field label, a small "their version" preview of `sister_value`, a small "your edit" preview of `source_value`, and a per-row toggle ("Keep sister's version" | "Overwrite with my edit").

**Actions.**
- **Sync** (primary, teal button per CLAUDE.md style rule 2 — teal background, black text): invokes `apply_source_edit_to_sisters(parent_id, changed_fields, force_overwrite)` where `force_overwrite[]` contains `'<sister_id>:<field>'` strings for every toggle the user set to "Overwrite." On return, success toast: "Synced N fields to M sisters. P sister fields kept their local edits." Closes modal.
- **Don't sync** (secondary, ghost button): skips the apply entirely. Parent change persists; sisters stay diverged on every field. Sisters' `locally_edited_fields[]` is unchanged.
- **Cancel parent edit** (tertiary, ghost link): reverts the parent save itself. Useful when the rep realizes "wait, I didn't mean to touch the parent's materials list." Implementation: the parent save must be staged-not-yet-committed when the modal opens, so the cancel path is a no-op on DB. **[DESIGN-OPEN]** — whether to ship Cancel in v1 or pure two-button (Sync / Don't sync). Adds save-staging complexity; recommend defer.

**Effect on `locally_edited_fields[]` after each action.**

| User action | sister field NOT in `locally_edited_fields[]` | sister field IS in `locally_edited_fields[]` and user picked "Keep sister's" | sister field IS in `locally_edited_fields[]` and user picked "Overwrite" |
|---|---|---|---|
| Sync | Field overwritten with source value. `locally_edited_fields[]` unchanged (still empty for this field). | Field NOT overwritten. `locally_edited_fields[]` unchanged (still contains the flag — sister stays diverged). | Field overwritten with source value. **Flag removed from `locally_edited_fields[]`** (sister is now back in sync, future source edits on this field will sync quietly). |
| Don't sync | Field NOT overwritten. **Flag NOT added** (the sister never edited it; it's just temporarily diverged because the user declined the sync). Next time the rep edits this field on the parent, the same pending-list will reappear. | Field NOT overwritten. Flag unchanged. | Same as "Keep sister's" — Overwrite toggle is ignored when the user dismisses the modal. |

The "Don't sync, never-edited field" cell is the trickiest behavior. The honest alternative: "Don't sync" could add the flag for all currently-pending-and-not-yet-locked fields, treating the rep's dismissal as "yes, sister is supposed to diverge here." Reasonable both ways; **[DESIGN-OPEN]** — recommend the not-adding behavior (less surprising — the rep can always edit the sister directly to lock it).

**`locally_edited_fields[]` population on sister-side edits** (separate from the conflict modal). Already locked in §5 stub as DB trigger: a `BEFORE UPDATE` trigger on `proposal_wtc` that, when the proposal has `cloned_from_proposal_id IS NOT NULL`, appends to `locally_edited_fields[]` whichever of `{sales_sow, size, unit, discount, discount_reason, field_sow, materials, sub_areas}` is changing in this UPDATE, plus `'travel:<key>'` for any key in `NEW.travel` that differs from `OLD.travel`. Idempotent via `array_append` + dedupe.

### 6. Downstream implications

**§6 award flow.** Adding A+ has no direct effect on `award_proposal`. Indirect: once a winner is picked, sisters flip to 'Lost' and the sync loops in both RPCs already exclude `status IN ('Lost','Sold')`. Reversal (`reverse_award`) also benefits — sisters flipped back from 'Lost' re-enter the sync pool automatically. **No award-flow changes needed.**

**§7 wizard / detail surfaces.** Three surfaces fire the conflict modal:
1. ProposalDetail toolbar saves that touch `intro` (the intro editor on the proposal-level form). Detection: on save, diff `intro` against pre-edit snapshot; if changed AND parent has active sisters, call preview.
2. WTCCalculator save that touches any source-driven WTC field. Detection: in `handleSave` (`WTCCalculator.jsx:1729`), wrap the existing DB write so that after the parent's `proposal_wtc` update succeeds, if the parent has active sisters AND any of the source-driven fields changed since pre-edit snapshot, call preview. The "since pre-edit snapshot" requires `WTCCalculator` to capture the previous values when loading the row — a small refactor (it already loads them; just hold onto them rather than dropping).
3. Bulk operations that update source-driven fields (today only "Load default SOW" at `WTCCalculator.jsx:1690`). Treat identically.

Wizard itself: doesn't fire the conflict modal — at clone time `locally_edited_fields[]` is empty on every sister, so there's nothing to conflict with.

**§8 edge cases this granularity creates.**

a. **Source-deleted-row vs sister-edited-row.** Parent deletes one material from its `materials` jsonb array. Sister had marked `'materials'` as locally edited. `apply_source_edit_to_sisters` is called with `p_changed_fields=['materials']`. The whole sister materials column is locked → preview returns a conflict → modal shows it. If rep overwrites: the deleted-from-parent row vanishes from sister too. If rep keeps sister: sister retains its full list including any sister-added rows AND the now-deleted parent row. Column-level granularity means this is intuitive — "I customized this sister's materials, including keeping a row the parent deleted."

b. **Sister-deleted-row vs source-edited-row.** Sister had marked `'materials'` (deleting a row counts as an edit; the trigger fires on any change to the column). Parent edits a different row. Same outcome as (a): one conflict on `'materials'` column, rep picks at column level. The deleted-on-sister row stays gone if rep keeps sister; comes back if rep overwrites.

c. **Sister-edited then source-undoes the change.** Sister edits `materials[0].qty` from 5 to 10, locking `'materials'`. Parent later sets the same row's qty back to 5. `preview_sync_to_sisters` compares the full `materials` jsonb (parent's vs sister's) — they're still different (sister still has 10). Conflict fires. Rep is shown source.materials[0].qty=5 and sister.materials[0].qty=10 in the preview and can decide. **Quirk:** at column-level granularity, even if the rep wants to "re-sync the qty," they can't ungate just that row — it's the whole materials column or nothing. This is the explicit tradeoff of A. If this becomes a regular workflow complaint, the Option-B path with row-ids is the upgrade.

d. **Travel sub-key undo same scenario.** Better at travel because it's keyed: sister edited `drive_miles` (locked `'travel:drive_miles'`), parent later changes `drive_rate`. No conflict — `'travel:drive_rate'` isn't in sister's `locally_edited_fields[]`. Parent's drive_rate syncs quietly. Sister keeps its drive_miles. Confirms the carve-out earns its complexity.

e. **Auto-sync removing a previously-locked field via overwrite.** When the rep overwrites a locked field, the flag is removed (§5 table above). Next time the parent edits that same field, the sister will silently sync. If the rep wanted "permanent override," they need to remember to re-edit the sister after the conflict resolution. Acceptable; document in §7 UX copy.

f. **Sister WTC missing because of work_type_id divergence.** Clone copies all WTCs 1:1, but a rep could later delete a WTC from a sister. `apply_source_edit_to_sisters` joins by `work_type_id` — if the sister's WTC is gone, it now returns `reason='missing_on_sister'` in `skipped[]` (improved from the original "silently no-op"). UI can surface this as a third bucket in the conflict modal so the rep knows.

### Critical files this resolution adds/changes

- `supabase/migrations/20260512120000_multi_gc_allocation.sql` — both sync RPC bodies + `BEFORE UPDATE` trigger on `proposal_wtc` for `locally_edited_fields[]` auto-population + optional `proposals.locally_edited_fields text[]` sibling column for `intro` (if DESIGN-OPEN resolves yes).
- `src/pages/WTCCalculator.jsx` (lines 1729-1782 `handleSave` — capture pre-edit snapshot + invoke preview/apply on parent save when sisters exist).
- `src/components/ProposalDetail.jsx` (intro editor save path — same preview/apply pattern).
- `src/components/SyncConflictModal.jsx` (new — renders preview output, collects per-row overwrite toggles, invokes apply with `force_overwrite[]`).

---

## §6 Award flow

**[BLOCKED on C1] + [DERIVED]** Section is structurally clear but the C1 collision determines whether the auto-Sold path can stay or has to be re-routed.

**Happy path (sisters case, C1 resolved):**
```sql
CREATE FUNCTION public.award_proposal(
  p_winner_proposal_id text,
  p_lost_reason        text DEFAULT 'Lost to other GC'
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_winner      public.proposals%ROWTYPE;
  v_call_log_id integer;
  v_sister_ids  text[];
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_winner FROM public.proposals
    WHERE id = p_winner_proposal_id FOR UPDATE;
  IF v_winner.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_WINNER'; END IF;
  IF v_winner.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;

  v_call_log_id := v_winner.call_log_id;

  -- Winner -> Sold
  UPDATE public.proposals
     SET status = 'Sold', approved_at = now()
   WHERE id = p_winner_proposal_id;

  -- Sisters under same call_log -> Lost
  UPDATE public.proposals
     SET status = 'Lost',
         lost_reason = p_lost_reason,
         lost_at = now()
   WHERE call_log_id = v_call_log_id
     AND id <> p_winner_proposal_id
     AND deleted_at IS NULL
     AND status NOT IN ('Sold','Lost')   -- idempotent
   RETURNING id INTO v_sister_ids;

  -- call_log -> Sold
  UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;

  RETURN jsonb_build_object(
    'winner_id', p_winner_proposal_id,
    'sisters_lost', v_sister_ids,
    'call_log_id', v_call_log_id
  );
END;
$$;
```

**Reversal RPC** — `reverse_award(p_call_log_id)`: flips winner back to 'Sent' (or 'Has Bid' — **[DESIGN-OPEN]**), sisters back to whatever they were before (we need to capture prior_status before the flip — add a column `proposals.pre_lost_status text` or use a JSON snapshot on the audit table — **[DESIGN-OPEN]**), and call_log back to its prior stage.

**QB sync** **[DERIVED]**: only the winner triggers `qb-create-job`. The current ProposalDetail.jsx:601-613 handleInternalApprove flow needs to be replaced — see C1 resolution below.

---

## §7 UI surfaces

**[DESIGN-OPEN + DERIVED]**

**Wizard — 4 screens** (per v98 mockup, reproduced from memory; not blocked but needs design pass since mockup HTML was deleted):
1. **Pick GCs** — list of `customers` rows where `customer_type` is some GC tag, OR a free-create path. Multi-select.
2. **Per-GC details** — for each selected GC: contact (signer + viewers from `customer_contacts`), RFP#, bid due date.
3. **Pricing** — per-GC `markup_override_pct` input. Shows preview of total per GC.
4. **Review & Create** — confirm; invokes `clone_proposal_to_gcs(p_source_proposal_id, p_targets)`; on success either (a) stays on shared `call_log` detail to "send later" or (b) immediately fans out `send-proposal` calls. **[DESIGN-OPEN]** which default.

**Entry points** **[LOCKED via Q4]**:
- ProposalDetail toolbar: `+ Send to Additional GCs` (only when `cloned_from_proposal_id IS NULL` and `status ∈ {'Draft','Sent','Has Bid'}` — i.e. this proposal isn't already a sister and isn't archived/lost/sold).
- CallLogDetail toolbar: `+ Add Another GC` (visible when at least one active non-Sold proposal exists on the call_log; opens wizard pre-pointed at the most recent non-Lost proposal as parent).

**ProposalDetail "sister sidebar"** **[DERIVED]**: when `cloned_from_proposal_id IS NOT NULL` OR `EXISTS (SELECT 1 FROM proposals WHERE cloned_from_proposal_id = p.id)`, show a "Sister proposals" panel listing siblings under the same call_log with their GC name + status pill + a `Mark Awarded` action on each.

**CallLogDetail "GCs" panel** **[DERIVED]**: replaces single-proposal display with a list grouped by GC (customer name from `p.customer_id ?? cl.customer_id`).

**Source-edit conflict modal** **[DESIGN-OPEN]**: when an edit on the parent triggers `preview_sync_to_sisters` and conflicts come back, modal lists sisters × conflicting fields, lets user pick "skip" or "force overwrite" per row, then invokes `apply_source_edit_to_sisters` with the chosen `p_force_overwrite` set. Trigger point: every save in WTCCalculator/ProposalDetail when the proposal has sisters.

**Customer-jobs surface fix** **[BLOCKED on S1 resolution]**: see S1 below.

---

## §8 Edge cases

**[DERIVED + BLOCKED]**

1. **First-signer-while-others-pending (C1).** A sister signs before Mark Awarded runs. See C1 resolution below — `mark_proposal_signed` must NOT flip `call_log.stage='Sold'` when sisters exist, AND must NOT trigger qb-create-job from ProposalDetail.handleInternalApprove on a non-awarded sister.

2. **Source proposal deleted while sisters exist.** `cloned_from_proposal_id` has `ON DELETE SET NULL`. Sync RPCs already gate on source existence and just no-op when source is gone. Soft-delete on parent is fine (status flips to deleted, sisters orphaned-but-functional). Hard-delete blocked elsewhere.

3. **Sister status drift via direct status edits in UI.** A sales rep could manually set a sister to 'Sold' without going through `award_proposal`. Defend with a CHECK constraint or trigger: when a proposal's status flips to 'Sold' AND the call_log has other non-Lost sisters, raise a warning / require explicit confirmation. **[DESIGN-OPEN]** — strict enforcement vs. UX-permissive.

4. **Shared `job-attachments` storage paths between sisters.** When sister proposals share a `call_log_id`, they share the storage bucket prefix `{call_log_id}/...`. The H-B2 audit finding (`job-attachments` delete policy lacks tenant scope) is already on the radar; multi-GC adds the sister-shares-attachment dimension. Recommend: leave shared-by-design (one project, one attachment library), document in §9 test plan. **[BLOCKED on H-B2]** for cross-tenant story (F7-future).

5. **Invoices on the call_log.** Today invoices key off `call_log.display_job_number` or `call_log.id::text`. Sisters share the call_log — so invoicing happens only after Mark Awarded, against the winner's `proposal_id`. No change.

6. **Re-cloning a sister.** Wizard refuses if `cloned_from_proposal_id IS NOT NULL` — only parents can spawn sisters. (Prevents diamond inheritance.)

7. **Source-edit during in-flight sister signing.** A customer is reading sister X's signing page. The rep edits the parent. Should sister X's signing page see the new SOW mid-read? Probably yes (Q2 source-driven semantics) — but the customer might be confused. **[DESIGN-OPEN]** — surface a "your proposal has been updated, please refresh" banner via Realtime? Or accept the rarity.

8. **Tenant boundary on `clone_proposal_to_gcs`.** All sisters land on the source's tenant via the RPC's tenant lookup. Cross-tenant clones impossible (RPC raises TENANT_MISMATCH). F7-clean.

9. **proposals.signing_token uniqueness.** The new `uq_proposals_signing_token_active` unique index (migration 0510) means each sister gets `gen_random_uuid()` as its token — already handled in §4 RPC.

10. **Markup additivity vs multiplicativity.** See §3 [DESIGN-OPEN].

11. **`proposal_recipients` per sister.** Each sister needs its own recipients (one signer, viewers). Wizard collects per-GC; RPC inserts. Recipients are NOT source-synced. **[LOCKED via Q2]** (commerce side).

---

## §9 Test plan

**[DERIVED]**

**Unit (psql, fresh scratch DB):**
- T1. Create call_log + parent proposal + 3 WTCs. Lock + send parent. Call `clone_proposal_to_gcs` with 3 targets. Verify: 3 sister proposals inserted with distinct customer_ids, 3×3=9 proposal_wtc rows, all sisters' WTCs have `locked=false AND locked_line_total IS NULL` (C2), all sisters have distinct `signing_token` and matching `cloned_from_proposal_id`.
- T2. Edit parent's `intro` text. Call `preview_sync_to_sisters` → expect 3 sisters with no conflicts. Call `apply_source_edit_to_sisters` → verify 3 sisters now have the new intro.
- T3. Edit sister 2's `proposal_wtc.materials`. Verify `locally_edited_fields` contains `'materials'` (DB trigger fires). Edit parent's materials. `preview_sync_to_sisters` returns sister 2 with a conflict. `apply_source_edit_to_sisters` with empty force_overwrite leaves sister 2 alone, updates sisters 1 + 3.
- T4. Call `award_proposal(sister 1)`. Verify sister 1 → Sold, sisters 2 + 3 → Lost with lost_reason + lost_at, call_log.stage = Sold. Verify QB sync hook fires for sister 1 only.
- T5. Call `mark_proposal_signed(sister 2's token)` (simulating customer signing) BEFORE award. **C1 BLOCKED** — desired behavior pending resolution. Once resolved, T5 verifies the new behavior.
- T6. Tenant isolation: create proposals under tenant A, try to clone as tenant B user → expect TENANT_MISMATCH.
- T7. `customer_jobs` surface (S1 fix verification): customer X with proposal where `proposals.customer_id = X` but `call_log.customer_id = Y` → verify X's detail page shows the proposal.

**Integration (Vercel preview branch):**
- I1. Full wizard happy path from ProposalDetail entry. Mockup-style 4 screens. End state: 3 sisters appear in CallLogDetail's GC panel.
- I2. Wizard entry from CallLogDetail. Same end state.
- I3. Customer signing flow on one sister. C1 behavior verification.
- I4. Mark Awarded flow with reversal.
- I5. Source-edit conflict modal (T3 user-visible).
- I6. PublicSigningPage on each sister renders the sister's own GC customer (verify `get_public_proposal_view` COALESCE update is live).

**Smoke (prod, after merge):**
- S1. Single live test job. Clone to 1 fake-GC. Verify status. Delete after.

---

## §10 Implementation order

**[DERIVED]**

1. **Verifications first.** Run §11 verification queries against prod (read-only). Confirm proposals.status / call_log.stage are text (no ALTER TYPE needed). Confirm proposals.id is text. Captures C3 + C4 resolution evidence in the plan itself.
2. **Migration 1 — schema columns + audit table.** All ALTERs in §3. Apply to staging. Smoke read paths (existing proposals still load). Apply to prod.
3. **Client fallback pattern rollout.** Replace `call_log?.customer_id` with `customer_id ?? call_log?.customer_id` everywhere in src/. Three known sites: ProposalDetail.jsx:62, :282; ProposalPDFModal.jsx:31. Plan agent's prior delivery flagged "Customers.jsx + 4 other files" — re-grep to be sure. Update `get_public_proposal_view` RPC to COALESCE customer chain (§11 v98 finding still valid).
4. **S1 fix** — pick one of (a)/(b)/(c) below, ship before any sister can be created with a divergent customer_id.
5. **C1 fix** — modify `mark_proposal_signed` (5-arg) + replace ProposalDetail.handleInternalApprove path. Migration B-style two-step to stay compat-safe.
6. **RPCs** — `clone_proposal_to_gcs`, `award_proposal`, `preview_sync_to_sisters`, `apply_source_edit_to_sisters`, `reverse_award`. Single migration, all SECURITY DEFINER, all check `NO_TENANT`.
7. **DB trigger** for `locally_edited_fields` auto-population on proposal_wtc UPDATE.
8. **Wizard component** — scaffold under feat/multi-gc-allocation. 4 screens. Local state only at first, then wire to RPCs.
9. **UI surfaces** — sister sidebar in ProposalDetail, GCs panel in CallLogDetail, source-edit conflict modal, entry buttons.
10. **Preview deploy.** I1–I6 smoke.
11. **Merge to main → prod smoke S1.** Add BACKLOG row pointing at this doc. Update CLAUDE.md verified-columns block with the new columns.

---

## §11 Verifications

**[DERIVED]**

To run before migration drafting (read-only, against prod):

```sql
-- V1: confirm proposals.status is text, no ENUM constraint
SELECT data_type, udt_name
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='proposals' AND column_name='status';
-- expect: text / text

-- V2: confirm call_log.stage is text
SELECT data_type, udt_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='call_log' AND column_name='stage';
-- expect: text / text

-- V3: confirm proposals.id is text (C4)
SELECT data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='proposals' AND column_name='id';
-- expect: text

-- V4: enumerate all FKs into proposals to catch any cloned_from constraints needed
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE contype='f' AND confrelid = 'public.proposals'::regclass;

-- V5: inventory call sites that filter proposals via call_log.customer_id
-- (run grep, not SQL, but record results in the plan doc)
```

**[LOCKED but updates needed]** From v98:
- `get_public_proposal_view` (now in 20260510120000:344) needs the one-line update: change `WHERE c.id = cl.customer_id` to `WHERE c.id = COALESCE(p.customer_id, cl.customer_id)` after Sweep-1 ships.
- Plan agent's prior delivery verified 6 things as correct (call_log.job_name as project title, content surface column list, is_admin_or_manager + get_user_tenant_id helpers, no source coupling on send-proposal/PDF, audit table pattern, forward-only retro-link decision). Pre-H-C2: `send-proposal` is "no source coupling" only because it trusts the body — the H-C2 fix moves that to DB-load. Re-check this verification after H-C2.

---

## §12 Out of scope

**[LOCKED]**

- Multi-tenant cross-tenant sister proposals (F7-blocked).
- Sister-level change orders.
- Retro-linking pre-existing manually-duplicated proposals (Q5).
- GC-side dashboards / customer portals.
- Bid-due reminders for sisters (covered by F11 backlog).
- Per-WTC granular jsonb diff/merge — coarse `locally_edited_fields` only (§5 [DESIGN-OPEN] resolution).
- Bulk-edit "set markup_override_pct on all sisters at once" — handled by editing each individually for v1.
- QB job-per-sister. Only the winner syncs to QB. Lost sisters never touch QB.

---

## Critical-issue resolution proposals

### C1 — `mark_proposal_signed` auto-Sold collision with sisters

**Resolution: reroute, don't accept "first-signer = winner".** First-signer-wins is too coarse: real-world reps need explicit Mark Awarded to pick which GC's signed copy becomes the live contract.

**Specific change to `mark_proposal_signed` (5-arg, migration 20260510120000:439-533):**
Replace lines 525-527:
```sql
IF v_call_log_id IS NOT NULL THEN
  UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;
END IF;
```
with:
```sql
IF v_call_log_id IS NOT NULL THEN
  -- Sister-aware: only flip call_log.stage when this is the only
  -- active non-Lost proposal under the call_log.
  IF EXISTS (
    SELECT 1 FROM public.proposals other
     WHERE other.call_log_id = v_call_log_id
       AND other.id <> v_proposal_id
       AND other.deleted_at IS NULL
       AND other.status NOT IN ('Lost')
  ) THEN
    -- Sisters exist; defer call_log.stage flip to award_proposal()
    NULL;
  ELSE
    UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;
  END IF;
END IF;
```
Wrapper (1-arg) inherits this automatically.

**Specific change to `src/components/ProposalDetail.jsx:598-617` (handleInternalApprove):**
- Detect sister presence via `p.cloned_from_proposal_id` OR a new query `SELECT count(*) FROM proposals WHERE call_log_id = ? AND id != ? AND status NOT IN ('Lost')`.
- If sisters exist: skip the `call_log.stage='Sold'` update AND skip the `qb-create-job` invoke. Both are handled by `award_proposal` later.
- If no sisters: existing behavior unchanged.

**Tradeoff:** Adds one EXISTS check inside a SECURITY DEFINER function and one client-side query. Negligible perf hit. Behavior becomes intuitive: signing a sister still works (signature persists, status flips to Sold on that one proposal), but the project-level (call_log) status doesn't change until Mark Awarded.

**Side note:** The "Sold" status on a sister before award is itself confusing — a customer signed, but we say "Lost" later if another wins. Two cleaner options:
- (a) Keep status='Sold' on signed sister; reverse to 'Lost' in `award_proposal` when sister is non-winner. **Cost:** brief weird state.
- (b) Introduce a new status 'Signed' that's distinct from 'Sold'; only winner flips to 'Sold'. **Cost:** new status value, UI changes.

Recommend (a) — minimal surface change, mental model "Sold means this customer signed; award means we picked this one." **[DESIGN-OPEN]** — Chris's call.

---

### C2 — Clone RPC must not violate H6 locked_line_total invariant

**Resolution: already encoded in §4 RPC.** Specifically the `INSERT INTO public.proposal_wtc … VALUES (… false, NULL, '{}'::text[])` line. Sisters always start `locked=false AND locked_line_total=NULL`. Sales rep must lock + send each sister (mirrors today's flow). No further migration change needed.

**Verification in test plan T1.**

---

### C3 — proposals.status / call_log.stage enum-vs-text

**Resolution: text, not enum. Verified.** Evidence:
- `grep -rn "CREATE TYPE\|TYPE.*AS ENUM" supabase/migrations/ sql/` returns zero results for status/stage.
- Migration 20260510120000:98, :125 etc. use `WHERE p.status = 'Draft'` and `WHERE status = 'Sold'` as plain string literals — would fail at apply-time if the column were an ENUM with different values.
- React UI already uses 'Lost' freely (`src/pages/Proposals.jsx:67 STATUS_TABS`, `src/components/CallLogDetail.jsx:11 STAGES`).

**Action:** Run V1 + V2 in §11 against prod during pre-migration verification to capture evidence in commit notes. No ALTER TYPE needed.

---

### C4 — proposals.id is text, not uuid

**Resolution: type-correct everywhere in this plan.** All clone-related references:
- `proposals.cloned_from_proposal_id` → `text` (§3).
- `proposal_clones.parent_proposal_id` + `.sister_proposal_id` → `text` (§3).
- `clone_proposal_to_gcs(p_source_proposal_id text, ...)` (§4).
- Sister-id generation: `gen_random_uuid()::text` (§4 line `v_sister_id := gen_random_uuid()::text`).

**Verification:** V3 in §11 captures evidence at apply time.

---

### S1 — Customers.jsx invisible-sister regression

**Resolution: choice between (a), (b), (c). Recommendation: (b) RPC.**

Three options:

**(a) Denormalized `call_log.primary_customer_id`.**
Add a column, populate it from `proposals.customer_id` of the FIRST sister (or via trigger keeping it in sync). Customers.jsx swaps `.eq("customer_id", customer.id)` → `.or("customer_id.eq.X,primary_customer_id.eq.X")`.
- **Pro:** No new RPC; PostgREST stays fast; one extra column.
- **Con:** Denorm always rots. Which sister's customer becomes "primary"? Race conditions on clone. If primary is awarded-lost later, do we re-sync?

**(b) RPC `customer_jobs(p_customer_id uuid) RETURNS SETOF public.call_log`.**
SECURITY DEFINER function that returns the union of call_logs where:
- `call_log.customer_id = p_customer_id`, OR
- `EXISTS (SELECT 1 FROM proposals p WHERE p.call_log_id = call_log.id AND COALESCE(p.customer_id, call_log.customer_id) = p_customer_id AND p.deleted_at IS NULL)`

Customers.jsx swaps the direct `.from("call_log").eq("customer_id", X)` for `supabase.rpc("customer_jobs", { p_customer_id: X })`. Same shape change on the proposals query (becomes `customer_proposals(p_customer_id)`).
- **Pro:** Authoritative; no denorm to rot; explicit fallback semantics live in one place; F7-clean (RPC checks tenant); reusable from SalesDash + any future surface that lists "jobs for customer X".
- **Con:** Two new RPCs. Slightly slower than direct query. RLS doesn't need to change (RPC runs SECURITY DEFINER but explicitly filters on tenant via `get_user_tenant_id()` inside).

**(c) PostgREST OR filter.**
Customers.jsx changes:
```js
.from("call_log")
.select("id, …, proposals!inner(customer_id)")
.or(`customer_id.eq.${id},proposals.customer_id.eq.${id}`)
```
- **Pro:** Zero migration. Pure client change.
- **Con:** Fragile — embedded resource filters via `.or` are quirky in PostgREST and you get dupes when a call_log has multiple matching proposals; needs DISTINCT. Same problem repeats in proposals query, invoices query, and any future surface. Spreads multi-GC awareness across all client filter sites.

**Recommendation: (b).** Builds the fallback semantics into one durable place. The S1 surface is already paying for query duplication today (jobs + proposals + invoices separately filtered) — moving to one RPC per concept simplifies. Cost is one migration + 4 client-call-site changes.

**Sites to update under (b):**
- `src/pages/Customers.jsx:514` → `supabase.rpc("customer_jobs", { p_customer_id: customer.id })`
- `src/pages/Customers.jsx:516-519` → `supabase.rpc("customer_proposals", { p_customer_id: customer.id })`
- `src/pages/Customers.jsx:253-260` (PayAppTemplateModal proposal list) → `supabase.rpc("customer_proposals", ...)`
- Any future surface listing "what does this customer own" — same pattern.

---

## Section completeness summary

| Section | Mostly tag | Confidence |
|---|---|---|
| §1 problem | LOCKED | High |
| §2 decisions | LOCKED | High |
| §3 schema | DERIVED + 2 DESIGN-OPEN | High on columns; OPEN on markup arithmetic + proposal_number scheme |
| §4 clone RPC | DERIVED + BLOCKED on H-C2 | High on RPC shape; BLOCKED on send-proposal invoke timing |
| §5 sync RPCs | **mostly DESIGN-OPEN** | Low — needs Chris's input on jsonb granularity + trigger-vs-client population |
| §6 award | BLOCKED on C1 + DERIVED | High once C1 resolved; one DESIGN-OPEN on reversal snapshotting |
| §7 UI | DERIVED + 3 DESIGN-OPEN | Medium — wizard mockup HTML deleted; needs re-walk with Chris |
| §8 edge cases | DERIVED + BLOCKED on H-B2 + 2 DESIGN-OPEN | Medium |
| §9 test plan | DERIVED | High; one BLOCKED case (T5) |
| §10 order | DERIVED | High |
| §11 verifications | DERIVED | High |
| §12 out-of-scope | LOCKED | High |

**Where SendMessage rounds should focus next, in priority order:**
1. **§5 sync logic** — biggest design-open block; without it the wizard can ship but multi-GC editing won't have intended semantics.
2. **C1 resolution sub-question** — "When a sister is signed before award, should its status flip to 'Sold' immediately and then to 'Lost' on award of a different sister, OR should we introduce a 'Signed' status distinct from 'Sold'?"
3. **§3 markup arithmetic** — additive vs multiplicative for `markup_override_pct`.
4. **§7 wizard re-spec** — mockup HTML is gone; rebuild the screen-by-screen spec from product intent.

---

### Critical Files for Implementation

- `/Users/chrisberger/sales-command/supabase/migrations/20260512120000_multi_gc_allocation.sql` (new — schema + RPCs)
- `/Users/chrisberger/sales-command/supabase/migrations/20260510120000_signing_token_expiry_and_consume.sql` (modify `mark_proposal_signed` for C1)
- `/Users/chrisberger/sales-command/src/components/ProposalDetail.jsx` (C1 handleInternalApprove rewrite + customer_id fallback + sister sidebar UI)
- `/Users/chrisberger/sales-command/src/pages/Customers.jsx` (S1 fallback via new RPCs at :253-260, :514, :516-519)
- `/Users/chrisberger/sales-command/src/components/MultiGCWizard.jsx` (new — 4-screen wizard; entry from ProposalDetail + CallLogDetail)
