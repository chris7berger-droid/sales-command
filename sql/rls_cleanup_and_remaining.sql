-- ============================================================
-- RLS Cleanup: Drop legacy always-true policies + secure remaining tables
--
-- 1. Drop old USING(true) policies that predate our tenant-scoped ones
-- 2. Add tenant_id + RLS to 7 remaining Schedule Command tables
-- 3. Fix function search_path warnings
--
-- Run in Supabase SQL Editor with service role, top-to-bottom
-- ============================================================


-- ============================================================
-- SECTION 1: DROP LEGACY ALWAYS-TRUE POLICIES
-- These predate our tenant-scoped policies and bypass RLS
-- ============================================================

-- call_log legacy
DROP POLICY IF EXISTS "call_log: auth insert" ON public.call_log;
DROP POLICY IF EXISTS "call_log: auth update" ON public.call_log;
DROP POLICY IF EXISTS "call_log: auth delete" ON public.call_log;
DROP POLICY IF EXISTS "call_log: auth read"   ON public.call_log;

-- customers legacy
DROP POLICY IF EXISTS "customers: auth insert" ON public.customers;
DROP POLICY IF EXISTS "customers: auth update" ON public.customers;
DROP POLICY IF EXISTS "customers: auth delete" ON public.customers;
DROP POLICY IF EXISTS "customers: auth read"   ON public.customers;

-- proposals legacy
DROP POLICY IF EXISTS "proposals: auth insert" ON public.proposals;
DROP POLICY IF EXISTS "proposals: auth update" ON public.proposals;
DROP POLICY IF EXISTS "proposals: auth delete" ON public.proposals;
DROP POLICY IF EXISTS "proposals: auth read"   ON public.proposals;

-- invoices legacy
DROP POLICY IF EXISTS "invoices: auth insert" ON public.invoices;
DROP POLICY IF EXISTS "invoices: auth update" ON public.invoices;
DROP POLICY IF EXISTS "invoices: auth delete" ON public.invoices;
DROP POLICY IF EXISTS "invoices: auth read"   ON public.invoices;

-- proposal_wtc legacy
DROP POLICY IF EXISTS "proposal_wtc: auth insert" ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_wtc: auth update" ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_wtc: auth delete" ON public.proposal_wtc;
DROP POLICY IF EXISTS "proposal_wtc: auth read"   ON public.proposal_wtc;

-- proposal_recipients legacy
DROP POLICY IF EXISTS "auth_manage_proposal_recipients" ON public.proposal_recipients;

-- proposal_signatures legacy
DROP POLICY IF EXISTS "proposal_signatures: anon insert" ON public.proposal_signatures;
DROP POLICY IF EXISTS "proposal_signatures: auth insert" ON public.proposal_signatures;
DROP POLICY IF EXISTS "proposal_signatures: auth update" ON public.proposal_signatures;
DROP POLICY IF EXISTS "proposal_signatures: auth delete" ON public.proposal_signatures;
DROP POLICY IF EXISTS "proposal_signatures: auth read"   ON public.proposal_signatures;

-- invoice_lines legacy
DROP POLICY IF EXISTS "invoice_lines: auth insert" ON public.invoice_lines;
DROP POLICY IF EXISTS "invoice_lines: auth update" ON public.invoice_lines;
DROP POLICY IF EXISTS "invoice_lines: auth delete" ON public.invoice_lines;
DROP POLICY IF EXISTS "invoice_lines: auth read"   ON public.invoice_lines;

-- job_work_types legacy
DROP POLICY IF EXISTS "job_work_types: auth insert" ON public.job_work_types;
DROP POLICY IF EXISTS "job_work_types: auth update" ON public.job_work_types;
DROP POLICY IF EXISTS "job_work_types: auth delete" ON public.job_work_types;
DROP POLICY IF EXISTS "job_work_types: auth read"   ON public.job_work_types;

-- customer_contacts legacy
DROP POLICY IF EXISTS "Authenticated users can delete customer_contacts" ON public.customer_contacts;
DROP POLICY IF EXISTS "Authenticated users can insert customer_contacts" ON public.customer_contacts;
DROP POLICY IF EXISTS "Authenticated users can update customer_contacts" ON public.customer_contacts;
DROP POLICY IF EXISTS "Authenticated users can select customer_contacts" ON public.customer_contacts;

-- work_types legacy
DROP POLICY IF EXISTS "auth_delete_work_types" ON public.work_types;
DROP POLICY IF EXISTS "auth_insert_work_types" ON public.work_types;
DROP POLICY IF EXISTS "auth_update_work_types" ON public.work_types;
DROP POLICY IF EXISTS "auth_read_work_types"   ON public.work_types;


-- ============================================================
-- SECTION 2: REMAINING SCHEDULE COMMAND TABLES
-- ============================================================

-- 2a. jobs (Schedule Command main table — has job_id as PK-ish, call_log_id FK)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.jobs AS j
SET tenant_id = cl.tenant_id
FROM public.call_log cl
WHERE (j.call_log_id = cl.id OR j.job_id = cl.id)
  AND j.tenant_id IS NULL;

UPDATE public.jobs
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.jobs
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON public.jobs(tenant_id);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_delete_jobs"  ON public.jobs;
DROP POLICY IF EXISTS "auth_insert_jobs"  ON public.jobs;
DROP POLICY IF EXISTS "auth_update_jobs"  ON public.jobs;
DROP POLICY IF EXISTS "auth_read_jobs"    ON public.jobs;
DROP POLICY IF EXISTS "jobs_select" ON public.jobs;
DROP POLICY IF EXISTS "jobs_insert" ON public.jobs;
DROP POLICY IF EXISTS "jobs_update" ON public.jobs;
DROP POLICY IF EXISTS "jobs_delete" ON public.jobs;

CREATE POLICY "jobs_select" ON public.jobs
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "jobs_insert" ON public.jobs
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "jobs_update" ON public.jobs
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "jobs_delete" ON public.jobs
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());


-- 2b. assignments (Schedule — crew assignments to jobs)
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.assignments AS a
SET tenant_id = j.tenant_id
FROM public.jobs j
WHERE a.job_id = j.job_id
  AND a.tenant_id IS NULL;

UPDATE public.assignments
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.assignments
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_assignments_tenant ON public.assignments(tenant_id);

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_delete_assignments" ON public.assignments;
DROP POLICY IF EXISTS "auth_insert_assignments" ON public.assignments;
DROP POLICY IF EXISTS "auth_update_assignments" ON public.assignments;
DROP POLICY IF EXISTS "auth_read_assignments"   ON public.assignments;
DROP POLICY IF EXISTS "assignments_select" ON public.assignments;
DROP POLICY IF EXISTS "assignments_insert" ON public.assignments;
DROP POLICY IF EXISTS "assignments_update" ON public.assignments;
DROP POLICY IF EXISTS "assignments_delete" ON public.assignments;

CREATE POLICY "assignments_select" ON public.assignments
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "assignments_insert" ON public.assignments
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "assignments_update" ON public.assignments
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "assignments_delete" ON public.assignments
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());


-- 2c. billing_log (Schedule — billing entries per job)
ALTER TABLE public.billing_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.billing_log AS bl
SET tenant_id = j.tenant_id
FROM public.jobs j
WHERE bl.job_id = j.job_id
  AND bl.tenant_id IS NULL;

UPDATE public.billing_log
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.billing_log
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_billing_log_tenant ON public.billing_log(tenant_id);

ALTER TABLE public.billing_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_delete_billing_log" ON public.billing_log;
DROP POLICY IF EXISTS "auth_insert_billing_log" ON public.billing_log;
DROP POLICY IF EXISTS "auth_update_billing_log" ON public.billing_log;
DROP POLICY IF EXISTS "auth_read_billing_log"   ON public.billing_log;
DROP POLICY IF EXISTS "billing_log_select" ON public.billing_log;
DROP POLICY IF EXISTS "billing_log_insert" ON public.billing_log;
DROP POLICY IF EXISTS "billing_log_update" ON public.billing_log;
DROP POLICY IF EXISTS "billing_log_delete" ON public.billing_log;

CREATE POLICY "billing_log_select" ON public.billing_log
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "billing_log_insert" ON public.billing_log
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "billing_log_update" ON public.billing_log
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "billing_log_delete" ON public.billing_log
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());


-- 2d. crew (Schedule — crew members, no job_id — standalone)
ALTER TABLE public.crew
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.crew
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.crew
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_crew_tenant ON public.crew(tenant_id);

ALTER TABLE public.crew ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_delete_crew" ON public.crew;
DROP POLICY IF EXISTS "auth_insert_crew" ON public.crew;
DROP POLICY IF EXISTS "auth_update_crew" ON public.crew;
DROP POLICY IF EXISTS "auth_read_crew"   ON public.crew;
DROP POLICY IF EXISTS "crew_select" ON public.crew;
DROP POLICY IF EXISTS "crew_insert" ON public.crew;
DROP POLICY IF EXISTS "crew_update" ON public.crew;
DROP POLICY IF EXISTS "crew_delete" ON public.crew;

CREATE POLICY "crew_select" ON public.crew
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "crew_insert" ON public.crew
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "crew_update" ON public.crew
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "crew_delete" ON public.crew
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());


-- 2e. crew_status (Schedule — daily crew status, no direct job FK)
ALTER TABLE public.crew_status
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.crew_status
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.crew_status
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_crew_status_tenant ON public.crew_status(tenant_id);

ALTER TABLE public.crew_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_delete_crew_status" ON public.crew_status;
DROP POLICY IF EXISTS "auth_insert_crew_status" ON public.crew_status;
DROP POLICY IF EXISTS "auth_update_crew_status" ON public.crew_status;
DROP POLICY IF EXISTS "auth_read_crew_status"   ON public.crew_status;
DROP POLICY IF EXISTS "crew_status_select" ON public.crew_status;
DROP POLICY IF EXISTS "crew_status_insert" ON public.crew_status;
DROP POLICY IF EXISTS "crew_status_update" ON public.crew_status;
DROP POLICY IF EXISTS "crew_status_delete" ON public.crew_status;

CREATE POLICY "crew_status_select" ON public.crew_status
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "crew_status_insert" ON public.crew_status
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "crew_status_update" ON public.crew_status
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "crew_status_delete" ON public.crew_status
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());


-- 2f. materials (Schedule — materials per job)
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

UPDATE public.materials AS m
SET tenant_id = j.tenant_id
FROM public.jobs j
WHERE m.job_id = j.job_id
  AND m.tenant_id IS NULL;

UPDATE public.materials
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.materials
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_materials_tenant ON public.materials(tenant_id);

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_delete_materials" ON public.materials;
DROP POLICY IF EXISTS "auth_insert_materials" ON public.materials;
DROP POLICY IF EXISTS "auth_update_materials" ON public.materials;
DROP POLICY IF EXISTS "auth_read_materials"   ON public.materials;
DROP POLICY IF EXISTS "materials_select" ON public.materials;
DROP POLICY IF EXISTS "materials_insert" ON public.materials;
DROP POLICY IF EXISTS "materials_update" ON public.materials;
DROP POLICY IF EXISTS "materials_delete" ON public.materials;

CREATE POLICY "materials_select" ON public.materials
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "materials_insert" ON public.materials
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "materials_update" ON public.materials
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "materials_delete" ON public.materials
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());


-- 2g. work_type_sow_templates (system-level, similar to work_types)
ALTER TABLE public.work_type_sow_templates
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenant_config(id);

-- This table is empty but set up for future use
UPDATE public.work_type_sow_templates
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

-- Allow NULL tenant_id for system templates (like work_types)
ALTER TABLE public.work_type_sow_templates
  ALTER COLUMN tenant_id SET DEFAULT (public.get_user_tenant_id());

ALTER TABLE public.work_type_sow_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage SOW templates" ON public.work_type_sow_templates;
DROP POLICY IF EXISTS "wt_sow_select" ON public.work_type_sow_templates;
DROP POLICY IF EXISTS "wt_sow_insert" ON public.work_type_sow_templates;
DROP POLICY IF EXISTS "wt_sow_update" ON public.work_type_sow_templates;
DROP POLICY IF EXISTS "wt_sow_delete" ON public.work_type_sow_templates;

CREATE POLICY "wt_sow_select" ON public.work_type_sow_templates
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.get_user_tenant_id());
CREATE POLICY "wt_sow_insert" ON public.work_type_sow_templates
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "wt_sow_update" ON public.work_type_sow_templates
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "wt_sow_delete" ON public.work_type_sow_templates
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());


-- ============================================================
-- SECTION 3: FIX FUNCTION SEARCH_PATH WARNINGS
-- Set search_path explicitly on all custom functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid AS $$
  SELECT COALESCE(
    (SELECT tenant_id FROM public.team_members WHERE auth_id = auth.uid() LIMIT 1),
    (SELECT id FROM public.tenant_config LIMIT 1)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public;

CREATE OR REPLACE FUNCTION archive.get_user_tenant_id()
RETURNS uuid AS $$
  SELECT tc.id FROM public.tenant_config tc LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, archive;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

CREATE OR REPLACE FUNCTION public.fn_auto_in_progress()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;


-- ============================================================
-- SECTION 4: VERIFY
-- ============================================================

-- Any remaining always-true policies?
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename, policyname;

-- Any tables without RLS?
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false
ORDER BY tablename;
