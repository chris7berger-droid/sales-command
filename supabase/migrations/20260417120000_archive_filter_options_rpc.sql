-- Archive filter-options RPC.
--
-- ArchiveSearchView's filter dropdowns (source_system, record_type) were
-- populated by loading up to 1000 rows from archive.legacy_records and
-- reducing client-side. That's expensive, hits the PostgREST row cap, and
-- is the wrong shape of query for "give me the distinct values."
--
-- This RPC returns both filter-option sets in a single round-trip,
-- tenant-scoped via archive.get_user_tenant_id() (fixed in 20260416230000).
-- SECURITY DEFINER so the function can read across RLS — tenant scoping
-- happens explicitly inside.

CREATE OR REPLACE FUNCTION archive.get_filter_options()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, archive
AS $$
  SELECT jsonb_build_object(
    'sources', coalesce((
      SELECT jsonb_agg(v ORDER BY v)
        FROM (
          SELECT DISTINCT source_system AS v
            FROM archive.legacy_records
           WHERE tenant_id = archive.get_user_tenant_id()
             AND source_system IS NOT NULL
        ) s
    ), '[]'::jsonb),
    'types', coalesce((
      SELECT jsonb_agg(v ORDER BY v)
        FROM (
          SELECT DISTINCT record_type AS v
            FROM archive.legacy_records
           WHERE tenant_id = archive.get_user_tenant_id()
             AND record_type IS NOT NULL
        ) t
    ), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION archive.get_filter_options() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION archive.get_filter_options() FROM anon;
GRANT EXECUTE ON FUNCTION archive.get_filter_options() TO authenticated;
