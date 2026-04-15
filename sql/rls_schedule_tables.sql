-- ============================================================
-- RLS Phase 4: Schedule/Field Command tables
-- Tables: time_punches, daily_production_reports, job_crew, job_changes
-- All link to call_log via job_id — no anon access needed
--
-- Run in Supabase SQL Editor with service role, top-to-bottom
-- ============================================================


-- ============================================================
-- SECTION 1: ADD tenant_id + BACKFILL
-- ============================================================

-- 1a. time_punches (parent: call_log via job_id)
ALTER TABLE public.time_punches
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.time_punches AS tp
SET tenant_id = cl.tenant_id
FROM public.call_log cl
WHERE tp.job_id = cl.id
  AND tp.tenant_id IS NULL;

UPDATE public.time_punches
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.time_punches
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_time_punches_tenant
  ON public.time_punches(tenant_id);


-- 1b. daily_production_reports (parent: call_log via job_id)
ALTER TABLE public.daily_production_reports
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.daily_production_reports AS dpr
SET tenant_id = cl.tenant_id
FROM public.call_log cl
WHERE dpr.job_id = cl.id
  AND dpr.tenant_id IS NULL;

UPDATE public.daily_production_reports
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.daily_production_reports
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_daily_production_reports_tenant
  ON public.daily_production_reports(tenant_id);


-- 1c. job_crew (parent: call_log via job_id)
ALTER TABLE public.job_crew
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.job_crew AS jc
SET tenant_id = cl.tenant_id
FROM public.call_log cl
WHERE jc.job_id = cl.id
  AND jc.tenant_id IS NULL;

UPDATE public.job_crew
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.job_crew
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_job_crew_tenant
  ON public.job_crew(tenant_id);


-- 1d. job_changes (parent: call_log via job_id or call_log_id)
ALTER TABLE public.job_changes
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.job_changes AS jch
SET tenant_id = cl.tenant_id
FROM public.call_log cl
WHERE (jch.job_id = cl.id OR jch.call_log_id = cl.id)
  AND jch.tenant_id IS NULL;

UPDATE public.job_changes
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.job_changes
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_job_changes_tenant
  ON public.job_changes(tenant_id);


-- ============================================================
-- SECTION 2: ENABLE RLS + POLICIES
-- ============================================================

-- 2a. time_punches
ALTER TABLE public.time_punches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_punches_select" ON public.time_punches;
DROP POLICY IF EXISTS "time_punches_insert" ON public.time_punches;
DROP POLICY IF EXISTS "time_punches_update" ON public.time_punches;
DROP POLICY IF EXISTS "time_punches_delete" ON public.time_punches;

CREATE POLICY "time_punches_select" ON public.time_punches
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "time_punches_insert" ON public.time_punches
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "time_punches_update" ON public.time_punches
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "time_punches_delete" ON public.time_punches
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- 2b. daily_production_reports
ALTER TABLE public.daily_production_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dpr_select" ON public.daily_production_reports;
DROP POLICY IF EXISTS "dpr_insert" ON public.daily_production_reports;
DROP POLICY IF EXISTS "dpr_update" ON public.daily_production_reports;
DROP POLICY IF EXISTS "dpr_delete" ON public.daily_production_reports;

CREATE POLICY "dpr_select" ON public.daily_production_reports
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "dpr_insert" ON public.daily_production_reports
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "dpr_update" ON public.daily_production_reports
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "dpr_delete" ON public.daily_production_reports
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- 2c. job_crew
ALTER TABLE public.job_crew ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_crew_select" ON public.job_crew;
DROP POLICY IF EXISTS "job_crew_insert" ON public.job_crew;
DROP POLICY IF EXISTS "job_crew_update" ON public.job_crew;
DROP POLICY IF EXISTS "job_crew_delete" ON public.job_crew;

CREATE POLICY "job_crew_select" ON public.job_crew
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "job_crew_insert" ON public.job_crew
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "job_crew_update" ON public.job_crew
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "job_crew_delete" ON public.job_crew
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- 2d. job_changes
ALTER TABLE public.job_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_changes_select" ON public.job_changes;
DROP POLICY IF EXISTS "job_changes_insert" ON public.job_changes;
DROP POLICY IF EXISTS "job_changes_update" ON public.job_changes;
DROP POLICY IF EXISTS "job_changes_delete" ON public.job_changes;

CREATE POLICY "job_changes_select" ON public.job_changes
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "job_changes_insert" ON public.job_changes
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "job_changes_update" ON public.job_changes
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "job_changes_delete" ON public.job_changes
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- ============================================================
-- SECTION 3: VERIFY
-- ============================================================

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('time_punches', 'daily_production_reports', 'job_crew', 'job_changes')
ORDER BY tablename;

SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('time_punches', 'daily_production_reports', 'job_crew', 'job_changes')
ORDER BY tablename, policyname;

SELECT 'time_punches' AS tbl, count(*) FROM public.time_punches
UNION ALL
SELECT 'daily_production_reports', count(*) FROM public.daily_production_reports
UNION ALL
SELECT 'job_crew', count(*) FROM public.job_crew
UNION ALL
SELECT 'job_changes', count(*) FROM public.job_changes;
