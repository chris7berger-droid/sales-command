-- ============================================================
-- DB Hardening Phase 1: tenant_id, updated_at, soft-delete
-- Run in Supabase SQL Editor with service role
-- Each section is independent — run top-to-bottom, review as you go
-- ============================================================

-- ============================================================
-- SECTION 1: Helper function — get tenant ID (reuse across schemas)
-- ============================================================

-- Move to public schema so all tables can share it
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid AS $$
  SELECT id FROM public.tenant_config LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- SECTION 2: Add tenant_id to core tables
-- These are safe ADD COLUMN IF NOT EXISTS with defaults
-- ============================================================

-- 2a. Customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tenant_id uuid
    DEFAULT (public.get_user_tenant_id())
    REFERENCES public.tenant_config(id);

-- Backfill any existing rows that got NULL
UPDATE public.customers
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

-- Now make it NOT NULL
ALTER TABLE public.customers
  ALTER COLUMN tenant_id SET NOT NULL;

-- 2b. Call Log
ALTER TABLE public.call_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid
    DEFAULT (public.get_user_tenant_id())
    REFERENCES public.tenant_config(id);

UPDATE public.call_log
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.call_log
  ALTER COLUMN tenant_id SET NOT NULL;

-- 2c. Proposals
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS tenant_id uuid
    DEFAULT (public.get_user_tenant_id())
    REFERENCES public.tenant_config(id);

UPDATE public.proposals
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.proposals
  ALTER COLUMN tenant_id SET NOT NULL;

-- 2d. Invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tenant_id uuid
    DEFAULT (public.get_user_tenant_id())
    REFERENCES public.tenant_config(id);

UPDATE public.invoices
SET tenant_id = (SELECT id FROM public.tenant_config LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE public.invoices
  ALTER COLUMN tenant_id SET NOT NULL;

-- ============================================================
-- SECTION 3: Composite indexes for fast tenant-scoped queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_customers_tenant
  ON public.customers(tenant_id);

CREATE INDEX IF NOT EXISTS idx_call_log_tenant
  ON public.call_log(tenant_id);

CREATE INDEX IF NOT EXISTS idx_call_log_tenant_stage
  ON public.call_log(tenant_id, stage);

CREATE INDEX IF NOT EXISTS idx_call_log_tenant_created
  ON public.call_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proposals_tenant
  ON public.proposals(tenant_id);

CREATE INDEX IF NOT EXISTS idx_proposals_tenant_status
  ON public.proposals(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant
  ON public.invoices(tenant_id);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status
  ON public.invoices(tenant_id, status);

-- ============================================================
-- SECTION 4: Add updated_at with auto-update trigger
-- ============================================================

-- Shared trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4a. Customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4b. Call Log
ALTER TABLE public.call_log
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE TRIGGER trg_call_log_updated_at
  BEFORE UPDATE ON public.call_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4c. Proposals
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE TRIGGER trg_proposals_updated_at
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4d. Invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4e. Proposal WTC
ALTER TABLE public.proposal_wtc
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE TRIGGER trg_proposal_wtc_updated_at
  BEFORE UPDATE ON public.proposal_wtc
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- SECTION 5: Soft-delete on proposals and invoices
-- ============================================================

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Partial indexes: only index non-deleted rows (most queries skip deleted)
CREATE INDEX IF NOT EXISTS idx_proposals_active
  ON public.proposals(tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_active
  ON public.invoices(tenant_id, status)
  WHERE deleted_at IS NULL;

-- ============================================================
-- SECTION 6: Verify — run these SELECTs to confirm everything landed
-- ============================================================

-- Check new columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('customers', 'call_log', 'proposals', 'invoices', 'proposal_wtc')
  AND column_name IN ('tenant_id', 'updated_at', 'deleted_at')
ORDER BY table_name, column_name;

-- Check indexes exist
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%tenant%'
   OR indexname LIKE 'idx_%active%'
ORDER BY indexname;

-- Check triggers exist
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE 'trg_%updated_at'
ORDER BY event_object_table;
