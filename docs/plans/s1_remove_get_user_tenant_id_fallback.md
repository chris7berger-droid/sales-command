# S1 — drop the COALESCE fallback in `public.get_user_tenant_id()`

## Context

`public.get_user_tenant_id()` is the helper RLS uses everywhere to scope rows to the caller's tenant. Its current prod body (per the audit comment in `supabase/migrations/20260505181452_set_search_path_security_functions.sql:108-114`, last verified 2026-05-05 against project `pbgvgjjuhnpsumnowuym`) is:

```sql
SELECT COALESCE(
  (SELECT tenant_id FROM public.team_members WHERE auth_id = auth.uid() LIMIT 1),
  (SELECT id FROM public.tenant_config LIMIT 1)
);
```

If an authenticated user has no matching `team_members` row, the COALESCE branch returns the first tenant in `tenant_config`. Single-tenant prod means today this happens to return the only legitimate tenant — net benign. The day F7 (multi-tenant onboarding) ships, the same code returns *some other tenant's* id for every misprovisioned auth session, and every RLS predicate `tenant_id = public.get_user_tenant_id()` evaluates to a cross-tenant read on every shared table. H4 closed the *anon* path of the same fallback last night via a BEFORE INSERT trigger (`supabase/migrations/20260508120000_proposal_signatures_tenant_id_trigger.sql`); S1 is the *authenticated* path of the same root cause.

Two findings during planning that shape the change:

1. **`archive.get_user_tenant_id()` was already fixed on 2026-04-16** by migration `20260416230000_archive_rls_fix.sql:82-93` — current archive body has no fallback. It is **out of scope** for this migration's body (no DDL needed). Stale seed copies in `sql/history_locker_phase1.sql:72` and `sql/rls_cleanup_and_remaining.sql:382` will be brought into sync with prod as part of seed hygiene.

2. **The codebase already treats a NULL return as expected.** `delete_customer` and `merge_customers` (`supabase/migrations/20260430120000_customer_delete_merge.sql:125, 218`) both contain `IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'`. The COALESCE fallback has been silently masking those checks. Removing it makes them reachable. Adopting the same convention everywhere keeps the change uniform.

```
Today                                     After fix
─────                                     ─────────
auth.uid() ─► team_members?               auth.uid() ─► team_members WHERE active=true?
              │                                          │
        hit ──┤── miss                            hit ───┤── miss
              │     │                                    │     │
        tenant_id   tenant_config LIMIT 1          tenant_id   NULL
              │     (silent, wrong tenant              │     │
              │      under multi-tenant)               │     │
              ▼     ▼                                  ▼     ▼
       RLS scopes correctly /              RLS scopes correctly /
       cross-tenant leak latent            deny-by-default + observable
                                           orphan view + pre-apply assert
```

## Decisions, defended

### Decision 1 — NULL vs RAISE on no-match

**Pick NULL.** Reasoning:

- **Codebase convention.** `delete_customer` (line 125) and `merge_customers` (line 218) are written to handle a NULL return with `RAISE EXCEPTION 'NO_TENANT'`. The archive sibling already returns NULL on miss. RAISE-inside-the-helper would make those `IF NULL` checks dead code and replace named errors (`NO_TENANT`) with a generic helper-level error.
- **Language churn.** The function is `LANGUAGE sql`. RAISE requires rewriting it as `plpgsql` — a metadata churn on a function with 237 call-sites for a behavioral change that is achievable inside `sql` by removing the second COALESCE branch.
- **RLS semantics.** With NULL, `USING (tenant_id = public.get_user_tenant_id())` evaluates NULL → FALSE per row → no rows visible. With RAISE, every row evaluation throws — Postgres short-circuits at the first row, the entire query errors, and the client gets a postgres-internal stack instead of an empty result set. Empty result is the existing UI's idle state; thrown errors are not.
- **INSERT failure mode is already loud.** Tenant-scoped tables have `tenant_id NOT NULL DEFAULT public.get_user_tenant_id()`. With NULL the DEFAULT resolves to NULL → constraint `23502` fires with a precise error naming the column. RAISE adds nothing here.
- **App-side login flow** (`src/lib/auth.js:34-46`, `src/App.jsx:109-154, 178-200`): an orphan auth user already lands on the dashboard today (with `displayRole = "Member"` and `displayName = email`). Today they see tenant 1's data because of the COALESCE bug. After NULL fix, they land on the dashboard with empty result sets — same chrome, no data, no rows to leak. Same UX as a brand-new user before any data. RAISE would convert that to a hard error toast on every page request — louder, but a bigger behavior change to ship without re-validating every page's empty state.

The legitimate counter-argument was diagnosability: NULL produces silent empty results, RAISE surfaces orphans on first request. The plan addresses diagnosability separately via an invariant check at apply time and a permanent admin view (see "Antifragile observability" below). That gives RAISE's benefit without changing query semantics.

### Decision 2 — `AND active = true` in the team_members lookup

**Include it.** The deactivate-user edge function (`supabase/functions/deactivate-user/index.ts:114`) clears `auth_id` AND sets `active=false`. So today, an `auth_id = auth.uid()` lookup already misses on deactivated rows. Adding `AND active = true` is belt-and-suspenders: closes the future case where a code path or a manual fix sets `active=false` without nulling `auth_id`. Aligned with "safe two years from now when... someone deletes a team_members row by accident."

### Decision 3 — `archive.get_user_tenant_id()`

**Out of scope for this migration's DDL.** Live body was rewritten on 2026-04-16 (`supabase/migrations/20260416230000_archive_rls_fix.sql:82-93`) to drop the fallback already. Pre-flight will dump the live body to confirm; if the dump matches the migration, no change. If the dump diverges (i.e. seed files were re-run over the migration), bundle the same body re-apply in this migration. Seed files (`sql/history_locker_phase1.sql:72`, `sql/rls_cleanup_and_remaining.sql:382`) are stale and will be edited to match prod regardless — they're a future regression risk if `supabase db reset` is ever run from seeds.

## Antifragile observability

The migration includes two operator-visible surfaces. Their scopes are distinct and worth naming explicitly so neither is mistaken for the other.

### Apply-time gate (one-shot)

The `DO $$ ... v_orphans` block runs **once, at the moment this migration is applied**, and then never again. It guarantees the schema cannot land while orphaned auth users exist — i.e. it protects the initial transition from buggy COALESCE to strict NULL. After apply, this block is dead code in the ledger; it does **not** catch orphans created later. Do not rely on it for steady-state safety.

### Steady-state guard

`public.v_orphan_auth_users` is the steady-state surface. After this migration, an orphan that appears at any point — a botched signup, a deactivate-user partial failure, a manual `team_members` delete — shows up as a row in this view. The view is the durable diagnostic that the silent COALESCE used to (incorrectly) approximate.

To catch orphans without manual polling, schedule a query that alerts ops if `count(*) > 0` (Supabase pg_cron, scheduled function, or a lightweight cron edge function reading the view). The scheduled query — not the DO block — is the steady-state guard.

### Trigger-based orphan prevention — considered, deferred

A `BEFORE INSERT ON auth.users` trigger that auto-provisions (or rejects) a `team_members` row would prevent orphans at the source. Considered and deferred because:

- `auth.users` writes are owned by GoTrue; trigger-side errors there surface as opaque 500s in the signup flow.
- The current onboarding surface is single-tenant and admin-controlled. Pre-emptively coupling GoTrue to a custom trigger now is more complexity than the failure mode warrants.
- The view + scheduled query gives us detection without coupling the signup path to bespoke DDL.

Re-evaluate when F7 (multi-tenant onboarding auto-provision) lands — trigger prevention may be the right place to enforce "every auth user has a team_members row" once self-serve signup exists.

## Pre-flight (run against prod, no DDL yet)

All queries run via Supabase Studio SQL Editor on project `pbgvgjjuhnpsumnowuym`. Save outputs in the handoff doc.

1. **Dump both live function bodies** (definitive — no seed file is authoritative):
   ```sql
   SELECT pg_get_functiondef('public.get_user_tenant_id()'::regprocedure);
   SELECT pg_get_functiondef('archive.get_user_tenant_id()'::regprocedure);
   ```
   Expected for `public`: COALESCE form. Expected for `archive`: no-fallback form per migration `20260416230000`. **If either is unexpected, stop and reframe the plan before proceeding.**

2. **Orphan auth-user inventory:**
   ```sql
   SELECT u.id, u.email, u.created_at, u.last_sign_in_at
     FROM auth.users u
     LEFT JOIN public.team_members tm
       ON tm.auth_id = u.id AND tm.active = true
    WHERE tm.id IS NULL
      AND u.deleted_at IS NULL
    ORDER BY u.created_at DESC;
   ```
   Expected: zero rows. **If any rows exist, do not apply the migration.** Triage each: either provision a `team_members` row or deactivate the auth user via `delete-user/index.ts`. Re-run until zero, then proceed.

3. **Call-site sweep — confirm 237 references and that all categories are NULL-tolerant:**
   ```bash
   grep -rn "get_user_tenant_id" supabase/migrations/ sql/ | wc -l   # expect 237
   grep -rn "get_user_tenant_id" supabase/migrations/ sql/ \
     | grep -vE "USING|WITH CHECK|DEFAULT|CREATE OR REPLACE FUNCTION|ALTER COLUMN|--|public.get_user_tenant_id\(\)$"
   ```
   The second command surfaces any callers outside the four expected categories: RLS predicates, column DEFAULTs, function definitions, and PL/pgSQL assignments (`v_tenant_id := public.get_user_tenant_id();`). Expect three PL/pgSQL assignments, all already guarded by `IF NULL THEN RAISE EXCEPTION 'NO_TENANT'`:

   - `customer_delete_merge.sql:123` (guard at 125)
   - `customer_delete_merge.sql:216` (guard at 218)
   - `call_log_merge.sql:121` (guard at 123) — added in migration `20260507120000`, post-dates the original plan draft

   If anything else surfaces (e.g. an unguarded assignment, or a call from outside these four categories), audit it before proceeding.

4. **App-side bootstrap inspection — already done in this plan:**
   - `src/lib/auth.js:34-46` (`getCurrentTeamMember`) returns `null` cleanly via `.single()` error path; no throw.
   - `src/App.jsx:109-154` sets `teamMember=null`, falls through to the main shell with `displayRole="Member"`. Pages render; lists query and get empty results. No login-flow change needed; no Login.jsx/WelcomeScreen guard to add.

## Migration

**Path:** `supabase/migrations/20260509120000_get_user_tenant_id_remove_fallback.sql`

**Body** (mirrors the comment-block style of `20260508120000_proposal_signatures_tenant_id_trigger.sql` and the search-path migration `20260505181452_set_search_path_security_functions.sql`):

```sql
-- ============================================================
-- S1: drop the COALESCE fallback in public.get_user_tenant_id().
--
-- Live body (confirmed against prod 2026-05-NN via
-- pg_get_functiondef before this migration was applied):
--
--   SELECT COALESCE(
--     (SELECT tenant_id FROM public.team_members
--       WHERE auth_id = auth.uid() LIMIT 1),
--     (SELECT id FROM public.tenant_config LIMIT 1)
--   );
--
-- The second branch returns "the first row of tenant_config"
-- whenever the caller has no team_members row. Today (single
-- tenant) the bug is latent; multi-tenant onboarding (F7) turns
-- it into a cross-tenant read on every RLS-scoped table. H4
-- (proposal_signatures BEFORE INSERT trigger, migration
-- 20260508120000) closed the anon path of this same fallback;
-- S1 is the authenticated path.
--
-- Fix: drop the fallback. NULL on miss is the convention used
-- by archive.get_user_tenant_id() (migration 20260416230000)
-- and is already handled by callers — public.delete_customer
-- and public.merge_customers (migration 20260430120000) both
-- check `IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'`.
--
-- Side-fix: scope to active=true so a deactivated team_members
-- row (active=false, auth_id non-null in some hypothetical
-- future state) cannot retain tenant access. The current
-- deactivate-user edge function clears auth_id, so this is a
-- no-op for current data — defense-in-depth only.
--
-- Pre-apply gate (one-shot, runs only at this migration's
-- apply time; the steady-state guard is v_orphan_auth_users
-- below paired with a scheduled query — see plan §Antifragile
-- observability):
-- ============================================================

DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans
    FROM auth.users u
    LEFT JOIN public.team_members tm
      ON tm.auth_id = u.id AND tm.active = true
   WHERE tm.id IS NULL
     AND u.deleted_at IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'S1 pre-flight failed: % orphan auth user(s) without an active team_members row. '
      'Provision or delete them before applying this migration.', v_orphans;
  END IF;
END $$;

-- ----- 1. Replace the function body. Metadata identical to
--          current prod (SECURITY DEFINER, STABLE, search_path).
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id
    FROM public.team_members
   WHERE auth_id = auth.uid()
     AND active = true
   LIMIT 1;
$$;

-- ----- 2. Permanent operator-visible orphan view. This is the
--          steady-state guard. Pair with a scheduled query
--          alerting on count(*) > 0 (see plan §Antifragile
--          observability).
CREATE OR REPLACE VIEW public.v_orphan_auth_users AS
SELECT u.id        AS auth_id,
       u.email,
       u.created_at,
       u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.team_members tm
    ON tm.auth_id = u.id AND tm.active = true
 WHERE tm.id IS NULL
   AND u.deleted_at IS NULL;

REVOKE ALL ON public.v_orphan_auth_users FROM public, anon;
-- No grant to authenticated: the view is SECURITY INVOKER over
-- auth.users, which the authenticated role cannot read. A grant
-- would be misleading. Reads happen via service_role (Studio,
-- scheduled cron functions); listed in handoffs/SC_Handoff_v102.txt
-- under "monitoring queries".

-- ============================================================
-- POST-APPLY VERIFICATION
-- ============================================================
-- 1) New body landed:
--    SELECT pg_get_functiondef('public.get_user_tenant_id()'::regprocedure);
--
-- 2) Authenticated path returns admin's tenant:
--    -- (run as the prod admin via Studio impersonation)
--    SELECT public.get_user_tenant_id();   -- expect uuid
--
-- 3) Anon path returns NULL (regression guard, was already true):
--    SET ROLE anon;
--    SELECT public.get_user_tenant_id();   -- expect NULL
--    RESET ROLE;
--
-- 4) Orphan view is empty:
--    SELECT count(*) FROM public.v_orphan_auth_users;  -- expect 0
--
-- 5) Live app smoke at scmybiz.com — see plan §Verification.
-- ============================================================
```

## Rollback

**Path:** `supabase/rollbacks/20260509120100_revert_get_user_tenant_id_remove_fallback.sql`

```sql
-- Reverts 20260509120000_get_user_tenant_id_remove_fallback.sql
-- Restores the COALESCE fallback. Note: re-introduces the
-- latent cross-tenant exposure described in S1 — only run if
-- the no-fallback body broke prod.
--
-- For an in-incident rollback, the CREATE OR REPLACE below
-- can be pasted into the Supabase SQL Editor directly; this
-- file exists for audit-trail completeness.

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tenant_id FROM public.team_members
      WHERE auth_id = auth.uid() LIMIT 1),
    (SELECT id FROM public.tenant_config LIMIT 1)
  );
$$;

DROP VIEW IF EXISTS public.v_orphan_auth_users;
```

Single SQL file, two statements, executes in well under 30 seconds via the SQL editor.

## Scratch-project test plan

The H4 scratch project (`eguyilfigafpwpwspxed`) is gone. Spin up a fresh scratch project (`supabase projects create sc-s1-scratch`); link with `supabase link --project-ref <new-ref>`; run `supabase db push --linked` from `main` to load the entire migration ledger (per CLAUDE.md the local stack is broken because of the seed-migration ledger gap; only `db push` works). The migration ledger as of today produces a working schema on a fresh project — `20260507130000_call_log_unique_job_number.sql` and `20260508120000_proposal_signatures_tenant_id_trigger.sql` are the latest and both apply cleanly.

After the ledger lands, seed two tenants and three test users:

```sql
-- Seed
INSERT INTO public.tenant_config (id, company_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tenant A'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B');

-- Auth users (use auth.admin.createUser via service-role from a script)
--   alice@a.test  -> team_members in tenant A
--   bob@b.test    -> team_members in tenant B
--   orphan@x.test -> NO team_members row
```

> ⚠ **Test 1 sequencing — important.** The initial `db push` above applied `20260509120000` with zero auth users, so the DO block already passed and the migration is recorded as applied. To exercise the gate honestly, the new migration must be marked **un-applied** before re-pushing with the orphan present. The sequence is in Test 1 below; do not skip it or the gate cannot fire.

**Test 1 — pre-apply gate fires:**

```bash
# Mark the new migration un-applied so db push will re-run it.
supabase migration repair --status reverted 20260509120000 --linked

# Confirm: the new migration shows as Local-only.
supabase migration list --linked
```

Then seed `orphan@x.test` (no `team_members` row) per the seed block. Run `supabase db push --linked`. **Expected:** migration aborts with `S1 pre-flight failed: 1 orphan auth user(s) without an active team_members row. Provision or delete them before applying this migration.` No DDL applied; `pg_get_functiondef` still shows the COALESCE body.

**Test 2 — provision orphan, apply succeeds:** add a `team_members` row for `orphan@x.test` in Tenant A → re-run `supabase db push --linked` → migration applies cleanly. Confirm new function body via `pg_get_functiondef`.

**Test 3 — Tenant A user can only see Tenant A data:** sign in as Alice via the React app (or an `auth.signInWithPassword` script), `SELECT count(*) FROM customers` should equal Tenant A row count only. Repeat as Bob — sees Tenant B count only. Confirms the new helper scopes correctly.

**Test 4 — re-create the orphan, exercise post-fix behavior:** remove `orphan@x.test`'s team_members row (set `active=false` AND clear `auth_id` to mirror the deactivate flow; also test with `active=false` alone to confirm the `AND active=true` clause works). Sign in as orphan and exercise the four call-site categories:

- **RLS read (deny-by-default):** `SELECT count(*) FROM public.customers` → 0.
- **DEFAULT INSERT (constraint fires):** `INSERT INTO public.customers (name) VALUES ('Test')` → constraint `23502` (`null value in column "tenant_id"`).
- **RPC with explicit guard:** `SELECT public.delete_customer(<some-uuid>)` → `RAISE EXCEPTION 'NO_TENANT'` (the previously-unreachable check is now reachable). Repeat with `merge_customers`.
- **Money-policy surface (RLS-gated table, largest call-site category):**
  - `SELECT count(*) FROM public.pay_apps` → 0 rows (RLS predicate `tenant_id = NULL` evaluates FALSE per row).
  - `INSERT INTO public.pay_apps (call_log_id, ...minimum required cols...) VALUES (...)` → constraint `23502` on `tenant_id` (DEFAULT resolves to NULL).

  This category — RLS-gated tables without explicit `IF NULL THEN RAISE` guards in their RPCs — is the bulk of the 237 call-sites. Validating it here confirms NULL flows correctly through the predicate path, not just through the two pre-guarded RPCs.

**Test 5 — anon path unchanged:** `SET ROLE anon; SELECT public.get_user_tenant_id();` → NULL. Public signing flow (`/sign/<token>`) renders via `request_signing_token()` + token-gated RPCs, no regression.

**Test 6 — rollback restores prior behavior:** apply the rollback file → orphan can again read Tenant A data via the COALESCE fallback. Confirm to validate the rollback works end-to-end before relying on it. Then re-apply the migration to leave the scratch project on the fixed state.

## Prod verification

After `supabase db push --linked` against `pbgvgjjuhnpsumnowuym`:

1. Re-run the post-apply queries embedded in the migration comment block (function-def dump, anon NULL check, orphan view count).
2. Live smoke at scmybiz.com — log in as the prod admin → Home loads, CallLog/Proposals/Invoices/Customers/Team all render rows. Open the most recent proposal's signing URL in a private window → public signing flow unaffected. Create a new call_log via the New Inquiry wizard → row inserts (DEFAULT path resolves to admin's tenant).
3. `SELECT count(*) FROM public.v_orphan_auth_users;` → 0.
4. Cross-repo grep (per `CLAUDE_RLS.md`): `cd ../sch-command && grep -rn "get_user_tenant_id" src/` (expect zero — sibling repos don't call the helper from JS, they only inherit RLS via the shared DB). Repeat for `field-command`, `AR-Command-Center`, `sub-con-command`. The fix flows to all of them automatically.

## Seed file hygiene (same PR)

These three files contain stale copies of the function body. They don't run as part of the migration ledger but will reintroduce the bug if anyone ever runs `supabase db reset` from seeds. Update each to match the new prod body:

- `sql/rls_cleanup_and_remaining.sql:373-380` — public function copy, currently COALESCE form.
- `sql/rls_identity_tables.sql:127-133` — second public function copy, currently COALESCE form.
- `sql/history_locker_phase1.sql:72-77` — archive function copy, currently `tenant_config LIMIT 1` only (way out of date — does not even include the `auth.uid()` lookup added by `20260416230000`). Update to match the migration-applied body.

These edits are pure file edits, no execution.

## BACKLOG + handoff updates (same session, per CLAUDE.md)

1. `docs/BACKLOG.md`:
   - Mark S1 row `In Progress` at session start.
   - On close, move to Completed Log with: date, ID, summary, migration filename, commit ref. Source row for archive variant follow-up is **not** needed — the archive variant was already fixed; the seed-file hygiene is part of this PR.
2. `docs/handoffs/SC_Handoff_v102.txt`:
   - New file. Summarize: pre-flight queries + outputs, migration applied, scratch-project test results, prod verification results, rollback rehearsal status, the `v_orphan_auth_users` view as a permanent monitoring surface (with a note on scheduling the steady-state count(*) query).

## Out of scope (do not bundle)

- Migration ledger gap repair (`supabase db pull` / `supabase start` are broken because `billing_schedule` and other tables were created via `sql/rls_child_tables.sql` outside the ledger). Tracked separately.
- `archive.get_user_tenant_id()` body change — already correct in prod since 2026-04-16. Seed-file copies updated as hygiene only.
- Redundant DELETE policy cleanup on `proposal_signatures` (v100 carryforward).
- Loader bypass for `/invoice/:token` and `/invoice-paid` (v100 carryforward).
- H5 (signing token expiry / single-use) — separate backlog row.
- Sibling-repo edits in `sch-command`, `field-command`, `AR-Command-Center`, `sub-con-command` — they don't call the helper from JS; the DB fix flows automatically. Verified via cross-repo grep in §Prod verification step 4.
