-- Archive schema RLS hardening.
--
-- Background: archive.{legacy_records, import_batches} were created via
-- /sql/history_locker_phase1.sql (run by hand in Studio, never under
-- migration discipline). Both tables have a tenant_id column and RLS
-- policies — but the helper function the policies depend on,
-- archive.get_user_tenant_id(), is broken: it returns the FIRST
-- tenant_config row regardless of the calling user. The moment a second
-- tenant exists, every authenticated user sees the wrong tenant's archive.
--
-- This migration:
--   1. Replaces archive.get_user_tenant_id() with auth.uid()→team_members
--      lookup (mirrors public.get_user_tenant_id() per SC_Handoff_v69),
--      but WITHOUT the tenant_config fallback — archive must never serve
--      anon, so returning NULL on no-match is safer than guessing.
--   2. Tightens grants: revokes anon entirely from the schema; narrows
--      authenticated from ALL to specific SELECT/INSERT/DELETE per table
--      (matches what the existing RLS policies allow).
--   3. Documents archive.import_batches and archive.legacy_records via
--      CREATE TABLE IF NOT EXISTS so future audits see them in the
--      migrations folder. Idempotent — does not modify existing rows.
--
-- See: /sql/history_locker_phase1.sql (canonical original definition)
--      /sql/rls_cleanup_and_remaining.sql (search_path fix that did NOT
--      touch the broken logic — line 382)

-- ---------------------------------------------------------------------------
-- 1. Documented schema (idempotent — won't touch existing prod tables)
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS archive;

CREATE TABLE IF NOT EXISTS archive.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant_config(id),
  source_system text NOT NULL,
  source_label text,
  record_type text NOT NULL,
  file_name text,
  file_storage_path text,
  row_count int DEFAULT 0,
  imported_by uuid REFERENCES auth.users(id),
  imported_at timestamptz DEFAULT now(),
  field_mapping jsonb,
  notes text
);

CREATE TABLE IF NOT EXISTS archive.legacy_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant_config(id),
  import_batch_id uuid NOT NULL REFERENCES archive.import_batches(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  record_type text NOT NULL,
  legacy_id text,
  customer_name text,
  job_address text,
  job_name text,
  record_date date,
  date_range daterange,
  amount numeric,
  status text,
  raw_data jsonb NOT NULL,
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

-- ---------------------------------------------------------------------------
-- 2. Fix the broken helper
-- ---------------------------------------------------------------------------
-- The original returned `SELECT id FROM tenant_config LIMIT 1` regardless of
-- caller — broken under multi-tenant. New version mirrors public.get_user_tenant_id
-- but drops the tenant_config fallback (archive must never leak to anon).

CREATE OR REPLACE FUNCTION archive.get_user_tenant_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, archive
AS $$
  SELECT tenant_id
    FROM public.team_members
   WHERE auth_id = auth.uid()
   LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. Tighten grants
-- ---------------------------------------------------------------------------
-- Original grants were `ALL ON ALL TABLES TO anon, authenticated` (overbroad).
-- Anon should have zero archive access. Authenticated needs only what the
-- existing RLS policies allow (SELECT/INSERT/DELETE on both tables).

-- Revoke everything from anon
REVOKE ALL ON ALL TABLES IN SCHEMA archive FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA archive FROM anon;
REVOKE USAGE ON SCHEMA archive FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA archive REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA archive REVOKE ALL ON SEQUENCES FROM anon;

-- Reset authenticated to least-privilege
REVOKE ALL ON ALL TABLES IN SCHEMA archive FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA archive FROM authenticated;

GRANT USAGE ON SCHEMA archive TO authenticated;
GRANT SELECT, INSERT, DELETE ON archive.legacy_records TO authenticated;
GRANT SELECT, INSERT, DELETE ON archive.import_batches TO authenticated;
-- Sequences: needed for default uuid generation if nextval-based; uuid PKs
-- here use gen_random_uuid() so no sequence usage is required.

-- Forward-default for any future archive table: tighten too
ALTER DEFAULT PRIVILEGES IN SCHEMA archive
  REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA archive
  GRANT SELECT, INSERT, DELETE ON TABLES TO authenticated;
