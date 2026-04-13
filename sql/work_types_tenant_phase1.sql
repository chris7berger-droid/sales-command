-- ============================================================
-- Work Types: Tenant support + Sales SOW defaults
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
-- Run top-to-bottom, one section at a time
-- ============================================================

-- ============================================================
-- SECTION 1: Add columns to work_types
-- tenant_id NULL  = system default (existing rows, read-only)
-- tenant_id = UUID = tenant's own custom type (editable)
-- ============================================================

ALTER TABLE public.work_types
  ADD COLUMN IF NOT EXISTS tenant_id uuid
    REFERENCES public.tenant_config(id),
  ADD COLUMN IF NOT EXISTS sales_sow text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Index for fast tenant lookups
CREATE INDEX IF NOT EXISTS idx_work_types_tenant
  ON public.work_types(tenant_id);

-- ============================================================
-- SECTION 2: Auto-update trigger for updated_at
-- (set_updated_at() function already exists from db_hardening_phase1)
-- ============================================================

CREATE OR REPLACE TRIGGER trg_work_types_updated_at
  BEFORE UPDATE ON public.work_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- SECTION 3: Row Level Security
-- Authenticated users can:
--   SELECT  — system types (tenant_id IS NULL) + their own
--   INSERT  — only their own tenant rows
--   UPDATE  — only their own tenant rows
--   DELETE  — only their own tenant rows
-- ============================================================

ALTER TABLE public.work_types ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "work_types_select"   ON public.work_types;
DROP POLICY IF EXISTS "work_types_insert"   ON public.work_types;
DROP POLICY IF EXISTS "work_types_update"   ON public.work_types;
DROP POLICY IF EXISTS "work_types_delete"   ON public.work_types;

CREATE POLICY "work_types_select" ON public.work_types
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NULL
    OR tenant_id = public.get_user_tenant_id()
  );

CREATE POLICY "work_types_insert" ON public.work_types
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "work_types_update" ON public.work_types
  FOR UPDATE TO authenticated
  USING  (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "work_types_delete" ON public.work_types
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- ============================================================
-- SECTION 4: Verify — run these to confirm everything landed
-- ============================================================

-- New columns on work_types
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'work_types'
ORDER BY ordinal_position;

-- RLS policies
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'work_types';

-- Spot check: system rows still visible, no tenant_id set
SELECT id, name, cost_code, tenant_id, sales_sow
FROM public.work_types
LIMIT 5;
