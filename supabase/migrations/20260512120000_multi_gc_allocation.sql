-- Multi-GC Allocation — Migration 1a (schema additions, audit table, intro
-- trigger). Plan: docs/plans/multi_gc_allocation.md §3, §3 amendment, §5(a).
-- §10 step 2 split: this migration intentionally does NOT add the
-- UNIQUE (proposal_id, work_type_id) constraint on proposal_wtc — V8
-- (2026-05-12) returned 17 dup pairs across 14 proposals; UNIQUE deferred
-- to Migration 1b (BACKLOG O5) until B17 root-cause + B18 dup triage land.
--
-- All columns nullable, no DEFAULT (except array-with-default-empty),
-- so the migration is reversible without data loss. Every new column on a
-- tenant-scoped table inherits tenant_id via parent FK — F7-clean.

-- ---------------------------------------------------------------------------
-- proposals — Sweep-1 (customer_id) + Sweep-2 (markup_override_pct) +
-- sister lineage (cloned_from_proposal_id) + award-loss tracking +
-- proposal-scope override flag (locally_edited_fields) + §3 amendment
-- (rfp_number, bid_due_date)
-- ---------------------------------------------------------------------------

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS markup_override_pct numeric,
  ADD COLUMN IF NOT EXISTS cloned_from_proposal_id text
    REFERENCES public.proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz,
  ADD COLUMN IF NOT EXISTS locally_edited_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rfp_number text,
  ADD COLUMN IF NOT EXISTS bid_due_date date;

CREATE INDEX IF NOT EXISTS idx_proposals_customer_id
  ON public.proposals(customer_id);
CREATE INDEX IF NOT EXISTS idx_proposals_cloned_from
  ON public.proposals(cloned_from_proposal_id);

COMMENT ON COLUMN public.proposals.rfp_number IS
  'GC-supplied RFP/bid number, per-proposal. Distinct from proposal_number '
  '(internal sequence). Captured by the multi-GC wizard Screen 2 and may also '
  'be set manually on single-GC proposals. Internal-only (not returned to '
  'anon callers via get_public_proposal_view).';

COMMENT ON COLUMN public.proposals.bid_due_date IS
  'Per-proposal bid due date supplied by the GC. Drives reminders + sort '
  'priority on Proposals.jsx. Captured by multi-GC wizard Screen 2; may '
  'also be set manually. Distinct from call_log.bid_due which is the '
  'project-level inquiry date.';

-- ---------------------------------------------------------------------------
-- proposal_wtc — sister override tracking (§5(a))
-- ---------------------------------------------------------------------------

ALTER TABLE public.proposal_wtc
  ADD COLUMN IF NOT EXISTS locally_edited_fields text[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- proposal_clones — audit table (one row per clone-event)
-- ---------------------------------------------------------------------------
-- Mirrors call_log_merges precedent (20260507120000). Written by
-- clone_proposal_to_gcs RPC. SELECT scoped on tenant; INSERT/UPDATE/DELETE
-- require admin/manager (mirror call_log_merges; relax later if sales reps
-- are granted clone privilege).

CREATE TABLE IF NOT EXISTS public.proposal_clones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_proposal_id text NOT NULL REFERENCES public.proposals(id) ON DELETE SET NULL,
  sister_proposal_id text NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  call_log_id        integer NOT NULL REFERENCES public.call_log(id) ON DELETE CASCADE,
  wtc_count          integer NOT NULL,
  cloned_by          uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  cloned_at          timestamptz NOT NULL DEFAULT now(),
  tenant_id          uuid NOT NULL DEFAULT public.get_user_tenant_id()
                       REFERENCES public.tenant_config(id)
);

CREATE INDEX IF NOT EXISTS idx_proposal_clones_tenant_id
  ON public.proposal_clones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposal_clones_call_log_id
  ON public.proposal_clones(call_log_id);
CREATE INDEX IF NOT EXISTS idx_proposal_clones_parent
  ON public.proposal_clones(parent_proposal_id);

ALTER TABLE public.proposal_clones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposal_clones_select ON public.proposal_clones;
CREATE POLICY proposal_clones_select ON public.proposal_clones
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS proposal_clones_insert ON public.proposal_clones;
CREATE POLICY proposal_clones_insert ON public.proposal_clones
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS proposal_clones_update ON public.proposal_clones;
CREATE POLICY proposal_clones_update ON public.proposal_clones
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS proposal_clones_delete ON public.proposal_clones;
CREATE POLICY proposal_clones_delete ON public.proposal_clones
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

-- ---------------------------------------------------------------------------
-- proposals_track_local_edits — BEFORE UPDATE OF intro trigger (§5(a))
-- ---------------------------------------------------------------------------
-- On sister rows (cloned_from_proposal_id IS NOT NULL), if intro changes and
-- 'intro' is not already in locally_edited_fields, append it. Parents NO-OP.
-- Sync RPCs (§5, deferred) read this flag to skip / prompt-on-conflict.

CREATE OR REPLACE FUNCTION public.proposals_track_local_edits()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NEW.cloned_from_proposal_id IS NULL THEN
    RETURN NEW;  -- parent proposal: no flagging
  END IF;
  IF NEW.intro IS DISTINCT FROM OLD.intro
     AND NOT ('intro' = ANY (COALESCE(NEW.locally_edited_fields, '{}'))) THEN
    NEW.locally_edited_fields := array_append(
      COALESCE(NEW.locally_edited_fields, '{}'), 'intro');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposals_track_local_edits ON public.proposals;
CREATE TRIGGER trg_proposals_track_local_edits
  BEFORE UPDATE OF intro ON public.proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.proposals_track_local_edits();
