-- Call_log merge feature.
-- Mirrors customer_merges precedent (20260430120000_customer_delete_merge.sql).
-- Adds call_log_merges audit table + merge_call_log() SECURITY DEFINER RPC.
-- Re-points all FK children (proposals, invoices, job_work_types, CO children)
-- from loser -> survivor in one atomic transaction. Renumbers absorbed
-- proposals' proposal_number to next-available on survivor. Loser is archived
-- (NOT hard-deleted) so its row + storage attachments remain readable.

-- ---------------------------------------------------------------------------
-- Audit table: call_log_merges
-- ---------------------------------------------------------------------------
-- loser_id is intentionally NOT an FK — the loser stays archived, but if a
-- future cleanup hard-deletes archived rows we don't want the audit row to
-- disappear. survivor_id IS an FK with ON DELETE SET NULL.

CREATE TABLE IF NOT EXISTS public.call_log_merges (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loser_id                    integer NOT NULL,
  loser_display_job_number    text NOT NULL,
  loser_job_number            integer,
  survivor_id                 integer REFERENCES public.call_log(id) ON DELETE SET NULL,
  survivor_display_job_number text NOT NULL,
  proposals_moved             jsonb NOT NULL DEFAULT '[]'::jsonb,
  invoices_moved              jsonb NOT NULL DEFAULT '[]'::jsonb,
  job_work_types_moved        jsonb NOT NULL DEFAULT '[]'::jsonb,
  cos_repointed               jsonb NOT NULL DEFAULT '[]'::jsonb,
  performed_by                uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  performed_at                timestamptz NOT NULL DEFAULT now(),
  tenant_id                   uuid NOT NULL DEFAULT public.get_user_tenant_id()
                                  REFERENCES public.tenant_config(id)
);

CREATE INDEX IF NOT EXISTS idx_call_log_merges_tenant_id
  ON public.call_log_merges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_log_merges_survivor_id
  ON public.call_log_merges(survivor_id);

ALTER TABLE public.call_log_merges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_log_merges_select ON public.call_log_merges;
CREATE POLICY call_log_merges_select ON public.call_log_merges
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS call_log_merges_insert ON public.call_log_merges;
CREATE POLICY call_log_merges_insert ON public.call_log_merges
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS call_log_merges_update ON public.call_log_merges;
CREATE POLICY call_log_merges_update ON public.call_log_merges
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

DROP POLICY IF EXISTS call_log_merges_delete ON public.call_log_merges;
CREATE POLICY call_log_merges_delete ON public.call_log_merges
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.is_admin_or_manager()
  );

-- ---------------------------------------------------------------------------
-- merge_call_log(p_survivor_id integer, p_loser_id integer) -> jsonb
-- ---------------------------------------------------------------------------
-- Order of operations (single implicit transaction):
--   1. Auth gates (admin/manager + tenant)
--   2. Lock both rows in deterministic id order (deadlock prevention)
--   3. Refuse on: same id, missing rows, cross-tenant, loser is CO,
--      survivor already archived
--   4. Determine next proposal_number on survivor
--   5. Re-point active proposals with renumbering; soft-deleted proposals
--      repointed but NOT renumbered (preserves audit even after eventual
--      hard-delete)
--   6. Re-point invoices.job_id (handles both observed shapes:
--      display_job_number text and call_log.id::text)
--   7. job_work_types: dedupe overlapping work_type_ids on loser,
--      then move remainder
--   8. CO children: re-parent (co_number preserved; co_number collision
--      between survivor and loser is the user's responsibility post-merge)
--   9. Archive loser
--  10. Insert audit row
--  11. Return jsonb summary

CREATE OR REPLACE FUNCTION public.merge_call_log(p_survivor_id integer, p_loser_id integer)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant_id           uuid;
  v_survivor            public.call_log%ROWTYPE;
  v_loser               public.call_log%ROWTYPE;
  v_next_n              int;
  v_proposals_moved     jsonb := '[]'::jsonb;
  v_invoices_moved      jsonb := '[]'::jsonb;
  v_jwts_moved          jsonb := '[]'::jsonb;
  v_cos_repointed       jsonb := '[]'::jsonb;
  v_performed_by        uuid;
  r                     record;
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_survivor_id = p_loser_id THEN
    RAISE EXCEPTION 'SAME_JOB';
  END IF;

  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'NO_TENANT';
  END IF;

  -- Lock in deterministic order to prevent deadlock under concurrent merges
  IF p_survivor_id < p_loser_id THEN
    SELECT * INTO v_survivor FROM public.call_log WHERE id = p_survivor_id FOR UPDATE;
    SELECT * INTO v_loser    FROM public.call_log WHERE id = p_loser_id    FOR UPDATE;
  ELSE
    SELECT * INTO v_loser    FROM public.call_log WHERE id = p_loser_id    FOR UPDATE;
    SELECT * INTO v_survivor FROM public.call_log WHERE id = p_survivor_id FOR UPDATE;
  END IF;

  IF v_survivor.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SURVIVOR'; END IF;
  IF v_loser.id    IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_LOSER';    END IF;

  IF v_survivor.tenant_id <> v_tenant_id OR v_loser.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  IF v_loser.is_change_order = true THEN
    RAISE EXCEPTION 'LOSER_IS_CHANGE_ORDER';
  END IF;

  IF v_survivor.archived = true THEN
    RAISE EXCEPTION 'SURVIVOR_ARCHIVED';
  END IF;

  SELECT id INTO v_performed_by
    FROM public.team_members
   WHERE auth_id = auth.uid()
   LIMIT 1;

  -- 4. Next available proposal_number on survivor (active only)
  SELECT COALESCE(MAX(proposal_number), 0) INTO v_next_n
    FROM public.proposals
   WHERE call_log_id = p_survivor_id
     AND deleted_at IS NULL;

  -- 5a. Active proposals: repoint + renumber
  FOR r IN (
    SELECT id, proposal_number AS old_n,
           row_number() OVER (ORDER BY proposal_number NULLS LAST, created_at) AS pos
      FROM public.proposals
     WHERE call_log_id = p_loser_id
       AND deleted_at IS NULL
     ORDER BY proposal_number NULLS LAST, created_at
  ) LOOP
    UPDATE public.proposals
       SET call_log_id = p_survivor_id,
           proposal_number = v_next_n + r.pos
     WHERE id = r.id;
    v_proposals_moved := v_proposals_moved || jsonb_build_object(
      'proposal_id', r.id,
      'old_proposal_number', r.old_n,
      'new_proposal_number', v_next_n + r.pos,
      'was_deleted', false
    );
  END LOOP;

  -- 5b. Soft-deleted proposals: repoint, do NOT renumber
  FOR r IN (
    SELECT id, proposal_number AS old_n
      FROM public.proposals
     WHERE call_log_id = p_loser_id
       AND deleted_at IS NOT NULL
  ) LOOP
    UPDATE public.proposals
       SET call_log_id = p_survivor_id
     WHERE id = r.id;
    v_proposals_moved := v_proposals_moved || jsonb_build_object(
      'proposal_id', r.id,
      'old_proposal_number', r.old_n,
      'new_proposal_number', r.old_n,
      'was_deleted', true
    );
  END LOOP;

  -- 6. Invoices: handle both observed job_id shapes
  FOR r IN (
    SELECT id, job_id AS old_job_id
      FROM public.invoices
     WHERE deleted_at IS NULL
       AND (job_id = v_loser.display_job_number OR job_id = v_loser.id::text)
  ) LOOP
    UPDATE public.invoices
       SET job_id = v_survivor.display_job_number
     WHERE id = r.id;
    v_invoices_moved := v_invoices_moved || jsonb_build_object(
      'invoice_id', r.id,
      'old_job_id', r.old_job_id,
      'new_job_id', v_survivor.display_job_number
    );
  END LOOP;

  -- 7. job_work_types: dedupe then move
  FOR r IN (
    SELECT work_type_id
      FROM public.job_work_types
     WHERE call_log_id = p_loser_id
       AND work_type_id IN (SELECT work_type_id FROM public.job_work_types WHERE call_log_id = p_survivor_id)
  ) LOOP
    DELETE FROM public.job_work_types
     WHERE call_log_id = p_loser_id AND work_type_id = r.work_type_id;
    v_jwts_moved := v_jwts_moved || jsonb_build_object(
      'work_type_id', r.work_type_id, 'action', 'deduped'
    );
  END LOOP;

  FOR r IN (
    SELECT work_type_id FROM public.job_work_types WHERE call_log_id = p_loser_id
  ) LOOP
    v_jwts_moved := v_jwts_moved || jsonb_build_object(
      'work_type_id', r.work_type_id, 'action', 'moved'
    );
  END LOOP;

  UPDATE public.job_work_types
     SET call_log_id = p_survivor_id
   WHERE call_log_id = p_loser_id;

  -- 8. CO children: re-parent
  FOR r IN (
    SELECT id, co_number FROM public.call_log WHERE parent_job_id = p_loser_id
  ) LOOP
    v_cos_repointed := v_cos_repointed || jsonb_build_object(
      'co_call_log_id', r.id, 'co_number', r.co_number
    );
  END LOOP;

  UPDATE public.call_log
     SET parent_job_id = p_survivor_id
   WHERE parent_job_id = p_loser_id;

  -- 9. Archive loser
  UPDATE public.call_log
     SET archived = true
   WHERE id = p_loser_id;

  -- 10. Audit
  INSERT INTO public.call_log_merges (
    loser_id, loser_display_job_number, loser_job_number,
    survivor_id, survivor_display_job_number,
    proposals_moved, invoices_moved, job_work_types_moved, cos_repointed,
    performed_by, tenant_id
  ) VALUES (
    p_loser_id, v_loser.display_job_number, v_loser.job_number,
    p_survivor_id, v_survivor.display_job_number,
    v_proposals_moved, v_invoices_moved, v_jwts_moved, v_cos_repointed,
    v_performed_by, v_tenant_id
  );

  -- 11. Return summary
  RETURN jsonb_build_object(
    'survivor_id',          p_survivor_id,
    'survivor_display',     v_survivor.display_job_number,
    'loser_id',             p_loser_id,
    'loser_display',        v_loser.display_job_number,
    'proposals_moved',      v_proposals_moved,
    'invoices_moved',       v_invoices_moved,
    'job_work_types_moved', v_jwts_moved,
    'cos_repointed',        v_cos_repointed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_call_log(integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_call_log(integer, integer) TO authenticated;
