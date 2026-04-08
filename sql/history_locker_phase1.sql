-- History Locker Phase 1: Archive schema, tables, indexes, RLS
-- Run in Supabase SQL Editor with service role

-- 1. Create the archive schema
CREATE SCHEMA IF NOT EXISTS archive;

-- 2. Add history_locker_enabled flag to tenant_config
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS history_locker_enabled boolean DEFAULT false;

-- 3. Import batches table
CREATE TABLE archive.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant_config(id),
  source_system text NOT NULL,        -- 'buildertrend', 'glide', 'quickbooks', 'other'
  source_label text,                   -- user-provided friendly name
  record_type text NOT NULL,           -- 'customer', 'job', 'invoice', 'proposal', 'call_log', etc.
  file_name text,
  file_storage_path text,
  row_count int DEFAULT 0,
  imported_by uuid REFERENCES auth.users(id),
  imported_at timestamptz DEFAULT now(),
  field_mapping jsonb,                 -- how CSV columns mapped to searchable fields
  notes text
);

-- 4. Legacy records table
CREATE TABLE archive.legacy_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant_config(id),
  import_batch_id uuid NOT NULL REFERENCES archive.import_batches(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  record_type text NOT NULL,
  legacy_id text,                      -- original ID from source system (e.g. "7282CO1")
  customer_name text,
  job_address text,
  job_name text,
  record_date date,
  date_range daterange,
  amount numeric,
  status text,
  raw_data jsonb NOT NULL,             -- complete original row
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(customer_name, '') || ' ' ||
      coalesce(job_address, '') || ' ' ||
      coalesce(job_name, '') || ' ' ||
      coalesce(legacy_id, '') || ' ' ||
      coalesce(raw_data::text, '')
    )
  ) STORED,
  created_at timestamptz DEFAULT now()
);

-- 5. Indexes
CREATE INDEX idx_legacy_records_search ON archive.legacy_records USING gin(search_vector);
CREATE INDEX idx_legacy_records_raw_data ON archive.legacy_records USING gin(raw_data);
CREATE INDEX idx_legacy_records_tenant ON archive.legacy_records(tenant_id);
CREATE INDEX idx_legacy_records_source ON archive.legacy_records(source_system);
CREATE INDEX idx_legacy_records_type ON archive.legacy_records(record_type);
CREATE INDEX idx_legacy_records_date ON archive.legacy_records(record_date);
CREATE INDEX idx_legacy_records_customer ON archive.legacy_records(customer_name);
CREATE INDEX idx_legacy_records_composite ON archive.legacy_records(tenant_id, record_type, record_date DESC);
CREATE INDEX idx_import_batches_tenant ON archive.import_batches(tenant_id);

-- 6. Enable RLS
ALTER TABLE archive.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive.legacy_records ENABLE ROW LEVEL SECURITY;

-- 7. RLS policies — users see only their tenant's archive data
-- Helper: get tenant_id for the current auth user via team_members
CREATE OR REPLACE FUNCTION archive.get_user_tenant_id()
RETURNS uuid AS $$
  SELECT tc.id
  FROM public.tenant_config tc
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- import_batches policies
CREATE POLICY "Users can view their tenant import batches"
  ON archive.import_batches FOR SELECT
  USING (tenant_id = archive.get_user_tenant_id());

CREATE POLICY "Users can insert import batches for their tenant"
  ON archive.import_batches FOR INSERT
  WITH CHECK (tenant_id = archive.get_user_tenant_id());

CREATE POLICY "Users can delete their tenant import batches"
  ON archive.import_batches FOR DELETE
  USING (tenant_id = archive.get_user_tenant_id());

-- legacy_records policies
CREATE POLICY "Users can view their tenant legacy records"
  ON archive.legacy_records FOR SELECT
  USING (tenant_id = archive.get_user_tenant_id());

CREATE POLICY "Users can insert legacy records for their tenant"
  ON archive.legacy_records FOR INSERT
  WITH CHECK (tenant_id = archive.get_user_tenant_id());

CREATE POLICY "Users can delete their tenant legacy records"
  ON archive.legacy_records FOR DELETE
  USING (tenant_id = archive.get_user_tenant_id());

-- 8. Expose archive schema to PostgREST (required for Supabase client access)
-- Run this in Supabase dashboard > Settings > API > Exposed schemas, add 'archive'
-- Or via SQL:
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, archive';
NOTIFY pgrst, 'reload config';

-- 9. Grant access to the archive schema
GRANT USAGE ON SCHEMA archive TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA archive TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA archive TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA archive GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA archive GRANT ALL ON SEQUENCES TO anon, authenticated;
