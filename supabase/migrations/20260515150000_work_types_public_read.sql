-- ============================================================
-- work_types: allow anon SELECT for reference data
--
-- Context: work_types holds only id, name, cost_code — pure
-- reference data with no tenant scoping. The public invoice
-- page joins proposal_wtc → work_types(name) to show the
-- Description column. Without an anon SELECT policy the join
-- returns null and customers see "—" instead of the work type
-- name.
--
-- USING (true) is appropriate here because the table contains
-- no sensitive or tenant-scoped data.
--
-- Also adds an authenticated SELECT policy — if RLS was
-- previously disabled, enabling it without this would lock
-- out the internal app.
-- ============================================================

ALTER TABLE public.work_types ENABLE ROW LEVEL SECURITY;

-- Authenticated users: read all reference data
DROP POLICY IF EXISTS "work_types_authenticated_read" ON public.work_types;

CREATE POLICY "work_types_authenticated_read" ON public.work_types
  FOR SELECT TO authenticated
  USING (true);

-- Anon users: read all reference data (for public invoice joins)
DROP POLICY IF EXISTS "work_types_public_read" ON public.work_types;

CREATE POLICY "work_types_public_read" ON public.work_types
  FOR SELECT TO anon
  USING (true);

NOTIFY pgrst, 'reload schema';
