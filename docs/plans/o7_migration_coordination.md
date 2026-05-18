# O7 — Multi-repo Supabase migration coordination (Plan, Round 1)

**Branch:** `feat/o7-migration-coordination`
**Status:** Round 1 — design surfacing only; no code, no migrations, no scripts written.
**Round 2 changelog:** §1–§9 unchanged. Audit findings F1–F4 addressed in [§10 Round 2 Amendments](#10-round-2-amendments-audit-f1f4) at the bottom. New Phase 0 and Phase 1.5 introduced there; convention rule in §3 conditionally gated on Phase 0 outcome.
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

---

## 10. Round 2 Amendments (audit F1–F4)

[DERIVED] These amendments respond to a parallel audit pass (findings F1–F4). §1–§9 above remain unchanged; this section is additive and authoritative wherever it overlaps. Per the standing rule on schema amendment vs overwrite, conflicts between §1–§9 and §10 are resolved in favour of §10.

### 10.F1 — Reconciling §5's "Cross-repo coordination doc" with §6 risk #1

[LOCKED] §5's "Cross-repo coordination doc" sub-section proposes editing `CLAUDE.md` in sch-command, field-command, and AR-Command-Center to point at this plan. §6 risk #1 simultaneously asserts Phase 1 makes "no edits to sch-command, field-command, AR-Command-Center." Both statements as written cannot be true. Audit F1 is correct.

**Resolution chosen: (b) — split CLAUDE.md edits into a new Phase 1.5 with its own rollback covering all 3 repos.**

[DERIVED] Tradeoff (2–3 lines):
- (a) Folding into Phase 1 muddies the "sales-command only, prove it, then propagate" frame of §5. Phase 1 becomes a 4-repo change masquerading as 1-repo, and the §6 risk #1 statement loses meaning. Cleaner to keep Phase 1 truly single-repo.
- (b) A dedicated Phase 1.5 has its own atomic rollback (revert 3 doc edits, nothing else) and is explicitly text-only — no scripts, no `package.json` changes, no enforcement, just pointer notes in 3 `CLAUDE.md` files. Lower risk than (a) and preserves §5's narrative.

[DESIGN-OPEN] **Phase 1.5 — Documentation pointer fan-out (text-only)**
- Trigger: ships AFTER Phase 1 acceptance test passes (a real `npm run db:push` from sales-command).
- Scope: edit `~/sch-command/CLAUDE.md`, `~/field-command/CLAUDE.md`, and `~/AR-Command-Center/CLAUDE.md` (latter may not exist — if not, skip and pick up in Phase 4) to add a one-line pointer to `~/sales-command/docs/plans/o7_migration_coordination.md`.
- Sch-command's existing top-of-CLAUDE.md ledger-repair note is preserved verbatim; the new pointer is appended below it, not replacing it.
- Acceptance: 3 doc edits committed on 3 separate branches (one per repo), each PR-able independently. No code changes.
- **Rollback (Phase 1.5):** `git revert` the doc commit in each of the 3 repos. Phase 1 (sales-command wrapper) is unaffected. No shared state to clean up — this phase touches only repo-local markdown.

[LOCKED] §6 risk #1 is now narrowed to: "Phase 1 makes no edits to other repos. Phase 1.5 makes pointer-only `CLAUDE.md` edits in 3 other repos with an atomic per-repo revert path."

### 10.F2 — Gap-period risk + parallel-install decision

[LOCKED] Audit F2 surfaced a real gap. Adding this to §6's risk list:

> **Risk 13 (Round 2) — Gap-period exposure, both directions.** [DERIVED] Until each repo ships its own wrapper install, that repo's operators continue to use raw `supabase db push` and remain exposed to the original silent-skip bug. The REVERSE case also exists: if sales-command pushes a migration via the new hook (Phase 1 active), and sch-command's raw `db push` (no hook installed yet) happens next with a colliding timestamp, sch-command's push will still silently skip its own DDL — the SC-side hook cannot protect SCH-side pushes. The bug class is symmetric; protection is per-repo, not central. Mitigation: minimise the gap period by installing the wrapper in SCH and FC IN PARALLEL with Phase 1 (see decision below).

**Decision chosen: PARALLEL install of the wrapper in sales-command, sch-command, and field-command (Phase 1 ships to 3 repos simultaneously).** AR-Command-Center stays on Phase 4 since it has no `supabase/` directory yet.

[DERIVED] Justification (2–3 lines):
- Parallel install closes the symmetric gap period to ~zero. The wrapper is purely additive (per §5 Phase 1 rollback), so installing it where there are no pending pushes is risk-free for the install itself.
- Sch-command's first **verified** `npm run db:push` is still gated on O8 (the outstanding `migration repair --status applied 20260512120000 20260512120100` documented in `~/sch-command/CLAUDE.md`) — the wrapper installs and is usable, but the acceptance test (a real push that surfaces zero collisions) waits until O8 lands. This is the right ordering: install the safety net first, then resolve the known pre-existing collision under its protection.
- Field-command has zero migrations today, so acceptance is "wrapper present + no-op run on an empty migrations dir returns exit 0" (matches §4.4 "No `supabase/migrations/` dir" branch).

[DESIGN-OPEN] **Phase 1 (revised) — Parallel install to SC + SCH + FC.** Steps 1–3 of §5 Phase 1 apply per repo. Step 5 (real `db push` acceptance) only runs in sales-command; SCH's first verified push waits on O8; FC's acceptance is the empty-dir no-op. Original §5 Phase 2 (sch-command install) and §5 Phase 3 (field-command install) collapse into this revised Phase 1. §5 Phase 4 (AR-Command-Center) is unchanged.

[LOCKED] Rollback for revised Phase 1 is per-repo and independent: revert the wrapper commit in any single repo without affecting the others.

### 10.F3 — Fail-loud branch in Phase 1 step 4 (dry-run)

[LOCKED] §5 Phase 1 step 4 ("Run the check against current local migrations + prod ledger") needs an explicit halt-and-investigate rule. Adding this as a concrete decision rule (not advice):

> **Decision rule (Phase 1 step 4 dry-run).** [LOCKED] If the dry-run reports ANY mismatch where a local file's 14-character timestamp prefix matches a ledger row's `version` but the local filename-without-extension does NOT equal that ledger row's `name`, the operator MUST:
> 1. HALT Phase 1 immediately. Do not proceed to step 5 (real `npm run db:push`).
> 2. NOT auto-normalize by renaming the local file.
> 3. NOT auto-edit or `migration repair` the ledger row.
> 4. Open the mismatch as an investigation item: capture (a) the local filename, (b) the ledger row's `version` + `name`, (c) `git log -- <local-file>` to see who/when authored it, (d) any recent `migration repair` notes in the four repos' `CLAUDE.md` files.
> 5. Resolve by human judgement only. The mismatch is a signal that the ledger has drifted from local truth (or vice versa) — it is data, not noise. Either the local file was renamed without a ledger repair, or the ledger row was authored by a different repo with a colliding timestamp, or someone hand-edited the ledger. None of those are safe to auto-resolve.
> 6. Phase 1 may resume only after the mismatch is explained AND either (a) the local file is intentionally renamed by the operator with a fresh free timestamp, or (b) the ledger drift is documented and a separate repair plan is opened.

[DERIVED] This rule applies to revised Phase 1 in all three repos in parallel (per F2). If any of the three repos surfaces a mismatch in its own dry-run, only that repo halts; the other two may continue independently.

### 10.F4 — Phase 0 sanity-read of ledger `name` column format

[LOCKED] §4.2 pseudocode line `if matching_row exists AND matching_row.name != local_filename_without_extension` assumes the ledger's `name` column stores filenames without extension and without path. Audit F4 is right: this assumption has not been verified against the actual ledger. Adding a Phase 0 before Phase 1.

**Phase 0 — Ledger name-format sanity read (must complete before revised Phase 1 begins)**

[DESIGN-OPEN] Concrete steps:

1. **Query (read-only, no writes):**
   ```
   SELECT version, name
   FROM supabase_migrations.schema_migrations
   ORDER BY version DESC
   LIMIT 5;
   ```
   Run via the same auth path the hook will use (see §4.3 — try `supabase` CLI shell-out first since it's already authenticated). Capture full output to a local scratch file (NOT committed) for the operator to inspect.

2. **Compare** the returned `name` values against the actual sales-command migration filenames. [LOCKED] Five known recent SC filenames (from `/Users/chrisberger/sales-command/supabase/migrations/`):
   - `20260515150000_work_types_public_read.sql`
   - `20260515140000_proposal_wtc_public_view_token.sql`
   - `20260514130000_invoices_call_log_id_fk.sql`
   - `20260416200000_materials_catalog.sql`
   - `20260416175646_billing_schedule_and_archive_links.sql`

   The expected mapping under the hook's current assumption is: ledger `version` = `20260515150000`, ledger `name` = `20260515150000_work_types_public_read` (filename minus `.sql`, no path).

3. **Outcomes and what each means for revised Phase 1:**

   | Observed `name` format | Meaning | Phase 1 action |
   |---|---|---|
   | Exactly `<timestamp>_<slug>` (no extension, no path) | Assumption holds. | [LOCKED] Proceed to Phase 1 with §4.2 pseudocode as-written. |
   | Includes `.sql` extension (e.g. `20260515150000_work_types_public_read.sql`) | Format differs. | [DESIGN-OPEN] LOCK the hook's collision rule to strip `.sql` from `matching_row.name` OR append `.sql` to local filename before comparing. Pick one and document. |
   | Includes path prefix (e.g. `supabase/migrations/20260515150000_…`) | Format differs significantly. | [DESIGN-OPEN] LOCK the hook to strip leading directory from `matching_row.name`. |
   | Uses different separator (e.g. dash instead of underscore between timestamp and slug) | Format differs significantly. | [DESIGN-OPEN] LOCK the hook to normalise both sides to a canonical form before comparing. Document the canonicalisation in §4.2. |
   | Only `version` matches, `name` is something else entirely (e.g. empty, hash, or hand-written description) | Assumption is wrong; comparison key needs rethink. | [BLOCKED] HALT before Phase 1. Open as a design question to user — possibly the collision detector can only key on `version` and must surface ALL version matches for human review rather than mismatching-name autodetect. |
   | Query returns zero rows | Ledger is empty or query auth failed. | [BLOCKED] HALT. Diagnose auth (§4.4 failure modes) before Phase 1. |

4. **Output of Phase 0:** a short note appended to this plan doc as `## 11. Phase 0 result` (or as a per-section amendment under §4.2) recording (a) the observed name format, (b) which row in the outcome table applied, (c) the locked comparison rule for the hook, and (d) date/operator. No code is written in Phase 0 — it is a read-only design-grounding step.

[DERIVED] Phase 0 cost: one SELECT, ~30 seconds. Skipping it risks shipping a hook whose collision rule never fires (false negatives) because it's comparing against the wrong field shape.

---
