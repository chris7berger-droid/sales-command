# S3 — Move `v_orphan_auth_users` from public to private schema

**Status:** Shipped to prod 2026-05-20 (Loop #19). Branch: `fix/orphan-auth-view-to-private`. Commit: `a7456e7`.
**Audience:** audit terminal — verify each claim independently against the live repo + prod DB before ratifying.

## Why this exists

Supabase advisor email 2026-05-17 flagged two ERROR-level findings on Command Suite DB (`pbgvgjjuhnpsumnowuym`), both pointed at `public.v_orphan_auth_users`:

1. `auth_users_exposed` — "View 'v_orphan_auth_users' in the public schema may expose `auth.users` data to anon or authenticated roles." Metadata: `exposed_to: ["authenticated"]`.
2. `security_definer_view` — "View `public.v_orphan_auth_users` is defined with the SECURITY DEFINER property."

The view was created in migration `20260509120000_get_user_tenant_id_remove_fallback.sql` (S1) as the steady-state operator guard for the `get_user_tenant_id()` fallback removal. It is read by Studio / `service_role` only — there is no app-code consumer.

Two root causes:

- **R1 — exposed via PostgREST.** Any view in a PostgREST-exposed schema (default: `public`, `graphql_public`, `storage`) that references `auth.users` is reachable by the `authenticated` role through Supabase's default grant chain, even after `REVOKE ALL FROM public, anon`. The S1 migration revoked from `public` and `anon` but not `authenticated`, and the lint metadata confirms that role still had access.
- **R2 — runs as creator.** The S1 migration's comment claimed "SECURITY INVOKER" but the view was created without `WITH (security_invoker = on)`, so the Postgres default (DEFINER) applied — the view ran with the owner's grants on `auth.users`, bypassing RLS.

## What changed

Forward migration `supabase/migrations/20260520120000_orphan_auth_view_to_private.sql`:

1. `CREATE SCHEMA IF NOT EXISTS private`; revoke from `public`/`anon`/`authenticated`; grant `USAGE` to `service_role` only.
2. `CREATE OR REPLACE VIEW private.v_orphan_auth_users WITH (security_invoker = on) AS …` (body identical to the old public view — `auth_id`, `email`, `created_at`, `last_sign_in_at`).
3. `REVOKE ALL ON private.v_orphan_auth_users FROM public, anon, authenticated` + `GRANT SELECT … TO service_role`.
4. `DROP VIEW IF EXISTS public.v_orphan_auth_users`.

Rollback `supabase/rollbacks/20260520120100_revert_orphan_auth_view_to_private.sql`: restores `public.v_orphan_auth_users` to its S1-era definition; drops `private.v_orphan_auth_users`; keeps the `private` schema itself (idempotent `CREATE SCHEMA IF NOT EXISTS` is harmless to leave behind, and removing it could break unrelated future objects).

BACKLOG edit: closed S3 in the security table; updated S2's referenced view path from `public.v_orphan_auth_users` to `private.v_orphan_auth_users`.

## Verification checklist

| # | Item | How to verify | Expected |
|---|------|---------------|----------|
| 1 | Old view gone | Supabase SQL: `SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='v_orphan_auth_users';` | 0 rows |
| 2 | New view present | Supabase SQL: `SELECT 1 FROM pg_views WHERE schemaname='private' AND viewname='v_orphan_auth_users';` | 1 row |
| 3 | New view uses security_invoker | Supabase SQL: `SELECT reloptions FROM pg_class WHERE relnamespace = 'private'::regnamespace AND relname = 'v_orphan_auth_users';` | array containing `security_invoker=on` (Postgres normalizes the reloption regardless of how the DDL phrased it) |
| 4 | Grant set is minimal | Supabase SQL: `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='private' AND table_name='v_orphan_auth_users';` | `service_role` SELECT; the view owner (`postgres`) will also appear with all privileges — that's owner-implicit, not granted by this migration, and not API-reachable (PostgREST only authenticates as `anon`/`authenticated`/`service_role`, never as `postgres`). **Pass criterion:** no `anon`, no `authenticated`, no `public`. |
| 5 | View body is correct | Supabase SQL: `SELECT definition FROM pg_views WHERE schemaname='private' AND viewname='v_orphan_auth_users';` | joins `auth.users` LEFT JOIN `public.team_members` on `auth_id`/`active`, filters `tm.id IS NULL AND u.deleted_at IS NULL` |
| 6 | Returns 0 rows in prod | Supabase SQL (service_role context, e.g. Studio): `SELECT count(*) FROM private.v_orphan_auth_users;` | 0 (no orphans today) |
| 7 | `private` schema not in PostgREST exposed list | `cat supabase/config.toml` — confirm no `[api]` block, so defaults `public, graphql_public, storage` apply | no override; `private` not in exposed list |
| 8 | No app code references the view | `grep -rn "v_orphan_auth_users" src/ supabase/functions/` | 0 hits |
| 9 | Migration ledger aligned | `cd ~/sales-command && bash scripts/check-migration-safety.sh` on `fix/orphan-auth-view-to-private` | "All checks passed" |
| 10 | Advisor findings cleared | Refresh Supabase Studio advisor on Command Suite DB; check both `auth_users_exposed` and `security_definer_view` | both gone (or at minimum not pointing at `v_orphan_auth_users`) |
| 11 | BACKLOG hygiene | `grep "v_orphan_auth_users" docs/BACKLOG.md` | only `private.v_orphan_auth_users` references; S3 row marked Closed 2026-05-20 |
| 12 | No new public views referencing auth.users | Supabase SQL: `SELECT schemaname, viewname FROM pg_views WHERE schemaname IN ('public','graphql_public') AND definition ILIKE '%auth.users%';` | 0 rows |

## Known not touched

- **S2 (daily alarm).** Open. Path updated from `public.` to `private.` in this commit but the alarm itself is still unbuilt. Service_role bypasses RLS and can read the `private` schema, so the scheduled-edge-function plan from `docs/handoffs/SC_Handoff_v102.txt:213-216` works unchanged.
- **`get_user_tenant_id()` body.** Unchanged — S1's fix stays in effect; this migration only moves the steady-state monitoring view.
- **Other advisor findings.** Only the two findings tied to this view were addressed. The 2026-05-11 security audit (0C/6H/14M/6L) and its remaining open rows (H11, B13, L15, plus the 13M/9L triage row) are untouched and still tracked in BACKLOG.

## Risk surface for the auditor to weigh

1. **R1 — does the new `private` view still serve S2?** Service_role bypasses RLS and can `USAGE`/`SELECT` on the `private` schema (granted explicitly). Edge functions invoked with the service-role key (the existing pattern for cron-driven Resend functions) will read it fine.
2. **R2 — was the `private` schema name a poor choice?** Convention in Postgres / Supabase docs uses `private` or `internal` for non-API-exposed schemas. No collision in the current repo (no other `private.*` objects). Re-naming later is cheap (single ALTER SCHEMA RENAME).
3. **R3 — file-vs-ledger alignment.** Migration applied to prod (ledger has `20260520120000`) but file lives only on `fix/orphan-auth-view-to-private` until merge. `scripts/check-migration-safety.sh` will fail on `main` for anyone else until this branch is merged. Mitigation: merge to main shortly after audit clears.
4. **R4 — rollback recreates the bad state.** Documented at the top of the rollback file — the revert intentionally re-opens both advisor findings, only run if S2 monitoring breaks.

## References

- Migration: `supabase/migrations/20260520120000_orphan_auth_view_to_private.sql`
- Rollback: `supabase/rollbacks/20260520120100_revert_orphan_auth_view_to_private.sql`
- Source of the original view: `supabase/migrations/20260509120000_get_user_tenant_id_remove_fallback.sql` (lines 78-94)
- BACKLOG rows: S2 (open, path updated), S3 (closed 2026-05-20)
- Branch: `fix/orphan-auth-view-to-private` (commit `a7456e7`)
- ERD loop: #19 (LOG.md), locked 2026-05-20 07:19
- Supabase advisor docs: https://supabase.com/docs/guides/database/database-linter?lint=0002_auth_users_exposed · https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
