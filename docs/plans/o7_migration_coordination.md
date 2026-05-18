# O7 — Multi-repo Supabase migration coordination (Plan, Round 1)

**Branch:** `feat/o7-migration-coordination`
**Status:** Round 1 — design surfacing only; no code, no migrations, no scripts written.
**Tag legend:** [LOCKED] stated by user / proven from repo · [DERIVED] inference · [DESIGN-OPEN] needs user decision next round · [BLOCKED] needs external input

---

## 1. Problem statement

[LOCKED] Four local repos push DDL to one shared Supabase project `pbgvgjjuhnpsumnowuym`: `sales-command`, `sch-command`, `field-command`, `AR-Command-Center`. Supabase's `supabase_migrations.schema_migrations` ledger is keyed by the filename timestamp prefix. When two repos pick the same timestamp, `supabase db push` from the second repo will see the version already present, mark the local file as "already applied," and SKIP its DDL with no error surface. This already happened on 2026-05-12 (Migration 1a, `20260512120000_multi_gc_allocation` collided with a sch-command pre-reserved row of the same version and had to be renamed to `20260513000000_*`).

The fix must work without forcing the other three repos to change anything at the same time, and must fail-loud (never silently approve or silently block).

---

## 2. Evidence

### 2.1 Shared project confirmed

[LOCKED] `supabase/.temp/project-ref` in three of four repos:

| Repo | project-ref |
|---|---|
| `~/sales-command` | `pbgvgjjuhnpsumnowuym` |
| `~/sch-command` | `pbgvgjjuhnpsumnowuym` |
| `~/field-command` | `pbgvgjjuhnpsumnowuym` |
| `~/AR-Command-Center` | (no `supabase/` dir at all yet) |

[LOCKED] `~/AR-Command-Center/` has no `supabase/` directory — it is **not yet** a producer of migrations against this project. It is still in scope per the backlog because the user expects it to start producing migrations soon, but no constraint exists on it today.

### 2.2 Migration count + range per repo

[LOCKED]
- `sales-command/supabase/migrations/` — **47 files**, range `20260416132135` → `20260515150000` (work_types_public_read).
- `sch-command/supabase/migrations/` — **3 files**, range `20260503190000` → `20260512120100`.
  - Note: per sch-command's `CLAUDE.md`, two of these (`20260512120000_jobs_material_status_additive`, `20260512120100_job_wtcs_create`) still need `migration repair --status applied` before its next `db push` — that is the O8 follow-up, not O7.
- `field-command/supabase/migrations/` — **0 files** (only `config.toml` + `functions/upload-photo/`). It uses the shared project for edge functions + auth but has not yet authored a migration.
- `AR-Command-Center/supabase/` — **does not exist**.

[DERIVED] Net producer count today is effectively **2** (sales-command and sch-command). Field-command and AR-Command-Center will become producers later. The convention has to scale from 2 to 4 without rework.

### 2.3 What credentials are already available locally (no new secret needed)

[LOCKED] Inspected without exposing values:
- `supabase` CLI v2.84.2 is installed at `/opt/homebrew/bin/supabase` and authenticated (`supabase projects list` returns a `LINKED` row, no auth prompt).
- Each linked repo has `supabase/.temp/pooler-url` — a full `postgresql://...pooler.supabase.com:5432/postgres` connection string with embedded password, scoped to that project.
- `sch-command/.env.local` carries `VITE_SUPABASE_SERVICE_ROLE_KEY`; `sales-command/.env.local` carries only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. **The service-role key is NOT uniformly available** across repos.
- `~/.supabase/` contains only `telemetry.json` — the CLI's access-token is stored elsewhere (likely macOS keychain), and is implicitly used by any `supabase` CLI subcommand the user invokes from the terminal.

[DERIVED] The hook has **three plausible auth paths**, in order of "least new infrastructure":
  1. Shell out to `supabase` CLI (uses its existing keychain session). Pro: zero new secrets, works in any linked repo. Con: requires CLI installed.
  2. Read `supabase/.temp/pooler-url` and connect with `psql` / a tiny postgres client. Pro: deterministic, no CLI required after first link. Con: file is git-ignored and only populated after `supabase link`; FC + AR would need to link before the hook works.
  3. Add a new env var (e.g. `SUPABASE_MIGRATION_LEDGER_DB_URL`) to each repo's `.env.local`. Pro: explicit. Con: adds a secret to manage, easy to forget.

### 2.4 Hook infrastructure today

[LOCKED] No `.husky/` directory in any of the four repos. `.git/hooks/` contains only Git's defaults (`*.sample`). Any pre-push enforcement is greenfield.

### 2.5 Backlog row (O7) verbatim recommendation

[LOCKED] BACKLOG.md recommends **(a) + (d)** — query the ledger before drafting a migration, and add a pre-push hook that enforces it.

---

## 3. Convention decision

[DESIGN-OPEN] Recommended combination: **(a) + (d) + a light version of (b)** — query before drafting, hook before pushing, prefix filenames for human discovery only.

### Why (a) — query-before-draft

[DERIVED] Cheapest possible discipline. Already documented in `~/sch-command/CLAUDE.md`. A one-line `supabase` query (or `psql` against `pooler-url`) returning the latest 20 versions tells the operator what timestamps are taken before they pick one. Cost: ~10 seconds per migration. Cannot prevent collision on its own (humans forget), so (a) alone is insufficient.

### Why (d) — pre-push hook

[DERIVED] The only mechanism that closes the silent-skip hole. Even with (a) as discipline, two parallel sessions can independently query the ledger, both see the same "next free" timestamp, and both author files for it. The hook is the last line of defense before `db push` runs.

### Why a light (b) — `_sc_` / `_sch_` / `_fc_` / `_ar_` prefix in filename

[DERIVED] Does NOT prevent collision (version key is timestamp-only — Supabase ignores the rest of the filename). BUT it makes ledger forensics dramatically easier when reading `SELECT version, name FROM supabase_migrations.schema_migrations` — you can see at a glance which repo authored each row. Cost: rename convention only, zero machinery. Existing 47 SC files and 3 SCH files do NOT need to be renamed; convention is forward-only.

### Why NOT (c) — pre-allocated timestamp blocks per app per day

[DERIVED] Adds a coordination artifact (a shared block-allocation doc) that itself becomes a single point of failure and needs syncing across 4 repos. Doesn't survive parallel-session work. Reject for round 1; revisit only if (a)+(b)+(d) prove insufficient.

### Convention summary (proposed)

[DESIGN-OPEN] Single rule to ratify next round:

> Every new migration file is named `<UTC_timestamp>_<app>_<slug>.sql` where `<app>` ∈ `{sc, sch, fc, ar}`. Before drafting the timestamp, query the prod ledger. Before `db push`, a hook re-queries the prod ledger and aborts if any local file's timestamp is already present with a different name OR if any local file's timestamp clashes with another pending local file in another repo's working tree (the hook can only see its own repo, so the cross-repo case is caught at push-time on the second-mover).

[DESIGN-OPEN] Question: do we also require migration **names** to be unique within a calendar month, to make `SELECT name FROM ...` searches less noisy? Not strictly needed for correctness.

---

## 4. Hook design (pseudocode only — no script written this round)

### 4.1 When it runs

[DESIGN-OPEN] Three trigger options:
  1. **npm script wrapper** — replace direct `supabase db push` with `npm run db:push` which runs the check then forwards. Pro: opt-in per repo, no global git config. Con: operators can bypass by typing `supabase db push` directly.
  2. **Git `pre-push` hook installed via Husky** — runs on `git push`. Con: `git push` does NOT push migrations; `supabase db push` does. Wrong trigger point. **Reject.**
  3. **Custom CLI alias / shim** — alias `supabase` in operator's shell to intercept `db push`. Con: machine-global, breaks the "additive per repo" constraint. **Reject.**

[DERIVED] Option 1 (npm script wrapper) is the only one that fits the constraints. Sales-command, sch-command, AR-Command-Center all have `package.json`. Field-command also has `package.json` (Expo). Even non-frontend operators run `npm` already in these repos.

### 4.2 What it checks (pseudocode)

```
function check_migration_collision():
    local_files = list "supabase/migrations/*.sql" sorted by name
    local_versions = [first 14 chars of each filename]

    ledger_rows = query prod: "SELECT version, name FROM supabase_migrations.schema_migrations"
                  via [supabase CLI | pooler-url | env-var DB URL]
                  with timeout 10s

    if query failed:
        print "COULD NOT VERIFY LEDGER: <reason>. Re-run with --skip-collision-check to override."
        exit non-zero

    for each local_version V in local_versions:
        matching_row = ledger_rows where row.version == V
        if matching_row exists AND matching_row.name != local_filename_without_extension:
            print "COLLISION: local file <X> uses timestamp <V>, but prod ledger already has row '<matching_row.name>' at that version. Rename your file to the next free timestamp."
            exit non-zero

    print "Ledger check OK. <N> local migrations, <M> already in ledger, no collisions."
    exit zero
```

### 4.3 Where credentials come from

[DESIGN-OPEN] Recommended fallback chain (use first that works):
  1. Env var `SUPABASE_MIGRATION_LEDGER_DB_URL` if set
  2. `supabase/.temp/pooler-url` if present (set by `supabase link`)
  3. Shell out to `supabase` CLI with the current linked project
  4. Fail loud with the exact remediation step

[DERIVED] No new secret is strictly required if every repo has run `supabase link` (sales-command, sch-command, field-command already have). AR-Command-Center will need to `supabase link` once before the hook works there; until then the hook fails loud per rule 4 in the constraints — which is correct behaviour (it shouldn't push without verification).

### 4.4 Failure modes (must all fail-loud, never silent)

[DERIVED]
- **Network/DNS failure to pooler** → exit non-zero, message includes "check network and `supabase/.temp/pooler-url`".
- **Auth rejected (rotated password / expired keychain)** → exit non-zero, message says "run `supabase login` and `supabase link --project-ref pbgvgjjuhnpsumnowuym`".
- **`supabase` CLI not installed** → exit non-zero, message says "install supabase CLI or set `SUPABASE_MIGRATION_LEDGER_DB_URL`".
- **Collision detected** → exit non-zero, message names the colliding file + the ledger row's name.
- **No `supabase/migrations/` dir** → exit zero with a one-line "no migrations to check" log (matters for field-command today).
- **Operator override** → `--skip-collision-check` flag prints a loud `WARNING: SKIPPING LEDGER CHECK` banner and continues. Logged in a local file (e.g. `.migration-check.log`) so the next session can see it was bypassed.

### 4.5 What the hook does NOT do

[LOCKED]
- It does NOT write to the ledger.
- It does NOT modify any `supabase_migrations.*` row (constraint #3).
- It does NOT scan other repos' working trees (it can't see them, and trying would violate the additive-per-repo rule).
- It does NOT call `supabase db push` itself — it just gates the npm-script wrapper.

---

## 5. Rollout sequence

[DESIGN-OPEN] Proposed order (sales-command first, alone, prove it, then propagate):

### Phase 1 — Sales-command only

1. Add an `npm` script `db:push` in `sales-command/package.json` that runs the new collision-check script then `supabase db push`.
2. Add the check script under `sales-command/scripts/check-migration-collision.{mjs|sh}`.
3. Add operator doc to `sales-command/CLAUDE.md` ("always use `npm run db:push`, never the raw command").
4. Run the check against current local migrations + prod ledger. Expected: zero collisions (we already manually deconflicted on 2026-05-12).
5. Do one real `npm run db:push` of any pending migration to prove the wrapper works.

**Rollback for Phase 1:** delete the script, remove the `npm` script entry. The raw `supabase db push` continues to work because the wrapper is purely additive.

### Phase 2 — sch-command

6. Copy the same script to `sch-command/scripts/`, add the same `npm` script.
7. Add the same operator note to `sch-command/CLAUDE.md`.
8. Verify the existing ledger-repair note (top of sch-command CLAUDE.md) is still required as a one-time predecessor to the next push.

**Rollback for Phase 2:** same as Phase 1, in that repo. Phase 1 is unaffected.

### Phase 3 — field-command

9. Same as Phase 2, even though field-command has zero migrations today — install before the first one ever lands.

### Phase 4 — AR-Command-Center

10. Wait until AR-Command-Center has a `supabase/` directory and is linked to the project. Install the wrapper as part of that bootstrap.

[DESIGN-OPEN] Each phase is independently revertible and does NOT require simultaneous changes anywhere else. This satisfies constraint #1.

### Cross-repo coordination doc

[DESIGN-OPEN] Once Phase 1 ships, drop a short note in each other repo's `CLAUDE.md` (sch-command already has one, just extend it) pointing at `~/sales-command/docs/plans/o7_migration_coordination.md` as the canonical convention. This is the canonical-docs-first pattern (point, don't duplicate).

---

## 6. Risks to the other 3 repos

[DERIVED] Bias toward listing more, not fewer. Each is "what could break if Phase 1 ships in sales-command alone."

### Direct risks (something we change here, affects them)

1. **None at the file level.** Phase 1 only adds files to sales-command. No edits to sch-command, field-command, AR-Command-Center, or to the shared Supabase project itself.
2. **None at the ledger level.** Phase 1 reads from `supabase_migrations.schema_migrations` but never writes to it.

### Indirect risks (behavioural / operator-level)

3. **False sense of safety in sch-command operators.** Once they hear "the hook is in," they may stop manually querying the ledger before drafting timestamps in sch-command. But the hook is NOT installed in sch-command yet (until Phase 2). Mitigation: explicit per-repo handoff note "hook is sales-command-only until Phase 2 ships."
4. **Operator confusion about which command to run.** If they alias-train themselves to `npm run db:push` in sales-command, they may type it in sch-command and get "script not found." Low-severity; the error message is clear.
5. **Pooler-url drift.** If Supabase rotates the pooler password and a repo's `.temp/pooler-url` is stale, the hook will fail-loud in that repo on its next push attempt. Correct behaviour, but worth flagging in the per-repo runbook: remediation is `supabase link --project-ref pbgvgjjuhnpsumnowuym`.
6. **Field-command edge functions deploy via `supabase functions deploy`, not `db push`.** This hook does not gate function deploys. No regression there, but worth being explicit that O7 scope is DDL only.
7. **sch-command's outstanding ledger-repair (O8 follow-up).** If a sch-command operator runs the new wrapper (after Phase 2) before running `migration repair --status applied 20260512120000 20260512120100`, the check will report TWO collisions (local file vs. ledger rows with mismatching names) and abort. This is technically correct behaviour but will confuse anyone who hasn't read the existing CLAUDE.md note. Mitigation: keep the existing top-of-CLAUDE.md repair note prominent until those two repairs are run; Phase 2 install doc should reference it.
8. **AR-Command-Center bootstrap.** When AR finally adds a `supabase/` dir, it will get the hook installed in Phase 4 — but if anyone authors a migration in AR before Phase 4 and pushes via raw `supabase db push`, they bypass the hook entirely. Risk is low because there are no AR migrations yet. Mitigation: include the hook in AR's initial `supabase/` bootstrap.
9. **Parallel Claude/operator sessions.** Per the user's `feedback_parallel_session_collisions` memory: if two sessions in two different repos both draft a migration with the same next-free timestamp, the **first to push wins** and the second's hook will catch the collision and abort. This is correct, but the loser has to rename their file. Worth calling out in the operator runbook so it's not surprising.
10. **CI/CD systems** (if any later push migrations automatically) bypass `npm run db:push` and call `supabase db push` directly. Out of scope today (no CI does this), but the hook design should be re-evaluated if/when that changes.

### Risks specifically to the shared Supabase project

11. **Ledger read traffic.** The hook queries `SELECT version, name FROM supabase_migrations.schema_migrations` on every push. This table is tiny (50 rows) and read-only from our side; negligible load.
12. **No write surface to the project at all from the hook.** Constraint #3 satisfied.

---

## 7. Design-open questions (for the user, next round)

- [DESIGN-OPEN] **Convention rule wording.** Do we adopt `<UTC_timestamp>_<app>_<slug>.sql` going forward (forward-only, no rename of existing files)? Or do we also retro-rename SC's 47 files for consistency? (Recommend forward-only.)
- [DESIGN-OPEN] **Cred source for the hook.** Three options ranked in §4.3. Recommend pooler-url first, supabase CLI shell-out fallback, and a documented `SUPABASE_MIGRATION_LEDGER_DB_URL` env-var override for explicit setups. Pick one ordering to lock.
- [DESIGN-OPEN] **Trigger point.** Confirm npm-script wrapper (`npm run db:push`) is the right enforcement layer vs. some other interception (e.g. a tiny `bin/supabase` shim in `PATH` that wraps the real CLI). Recommend npm-script — simpler, per-repo, additive.
- [DESIGN-OPEN] **Override flag policy.** Should `--skip-collision-check` exist at all? If yes, should it require a confirmation prompt (`type SKIP to continue`) rather than a flag? Recommend: yes-with-loud-banner-and-log, no interactive prompt (interactive prompts break automation later).
- [DESIGN-OPEN] **Operator runbook location.** Add to each repo's `CLAUDE.md`, or to a shared doc the user keeps at `~/erd-loop/` or similar? Recommend per-repo `CLAUDE.md` so it loads automatically on `cd`.
- [DESIGN-OPEN] **Hook language.** Bash, Node (`.mjs`), or Deno? Sales-command is JS-heavy; Node `.mjs` reads `process.env`, can shell out to `supabase` CLI, can `import('postgres')` if we go pooler-url. Recommend Node `.mjs` to match the JS toolchain everywhere.
- [DESIGN-OPEN] **Rollout pace.** Phase 1 only this week, or Phase 1+2 together since sch-command also has an outstanding migration concern (O8)? Recommend Phase 1 only — verify the wrapper survives one real push before propagating.

---

## 8. [BLOCKED] items

- **[BLOCKED] AR-Command-Center owner buy-in.** AR has no `supabase/` directory yet. Whoever bootstraps AR's migrations must agree to install the wrapper as part of that bootstrap (Phase 4). If that's the same operator (the user), this is implicitly resolved — but worth flagging explicitly so the convention isn't forgotten when AR starts producing DDL.
- **[BLOCKED] field-command operator buy-in.** Field-command has `supabase/` but no migrations yet. When the first migration is authored there, the wrapper must already be installed (Phase 3) or that migration will collide silently with the next sales-command push.
- **[BLOCKED] sch-command outstanding repair.** Phase 2 cannot ship cleanly until the two `migration repair --status applied` commands documented in `~/sch-command/CLAUDE.md` are run. Otherwise Phase 2's install acceptance test (a real `npm run db:push`) will fail loudly on those two pre-existing collisions. Resolve O8 follow-up first.

---

## 9. Out of scope (round 1)

- **(c) Pre-allocated timestamp blocks.** Considered, rejected for round 1 — adds a coordination artifact without proportional safety gain over (a)+(d). Revisit only if (a)+(d) prove insufficient in practice.
- **Retro-renaming existing migration files to add `_sc_` / `_sch_` prefix.** Forward-only convention proposed; retro rename is a separate decision.
- **Edge function deploy coordination.** O7 scope is DDL only. Functions deploy via `supabase functions deploy` and have no shared ledger.
- **CI/automated migration push.** No CI today pushes migrations. If/when added, the hook design must be re-evaluated.
- **Cross-repo lock file** (e.g. a `migration-reservations.json` in a shared gist that each repo writes to before drafting). Adds infrastructure; rejected unless (a)+(d) fail.
- **Changes to `supabase_migrations.schema_migrations` itself.** Forbidden by constraint #3 — never proposed.
- **Migration content review** (RLS, search_path, etc.) — separate discipline, separate audit.
- **A2-PrdEnv audit of the shared project for orphan/stale ledger rows.** Useful but a separate audit task, not part of O7's coordination convention.
