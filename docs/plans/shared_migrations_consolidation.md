# Plan — Single Source of Truth for Command Suite Database Migrations

**Author:** Sales Command session, 2026-06-29
**Status:** DRAFT — for plan-audit, not yet ratified
**Scope:** Database migrations across the Command Suite (Sales / Schedule / Field / AR). Edge functions are explicitly out of scope (noted in §9).

---

## Confidence tags
- **[LOCKED]** One shared Supabase backend (`pbgvgjjuhnpsumnowuym`) is required and correct. The four drivers exchange too much data to split; the shared DB is an advantage, not a problem. (Chris, 2026-06-29)
- **[LOCKED]** The thing to fix: migration *history* is fragmented across four repos' `supabase/migrations/` folders while the database keeps **one** ledger. Every repo therefore flags its siblings' ledger entries as "strays," which forces the manual `db query -f` + `repair --status applied` workaround and repeatedly tempts the dangerous `repair --status reverted` (the 2026-05-18 incident).
- **[DERIVED]** Fix direction: a single canonical migrations home; app repos stop owning migrations.
- **[DESIGN-OPEN]** Exact home — new dedicated repo vs. designating one existing repo (§4–§5).
- **[DESIGN-OPEN]** Whether app repos keep read-only migration copies for local `supabase start` (§9).

---

## 1. Problem (plain English)
The database keeps one master checklist of every change ever applied to it. That checklist is shared — all four apps add to it. But the actual change *files* live in four separate app folders. So the database has one history, but the files behind it are scattered across four places. When any app reads the checklist and sees a change a sibling app made, it looks in its own folder, can't find the file, and warns "I don't recognize this." Nothing is broken — it just can't see its sibling's files. The warning recurs constantly and will keep growing as all four apps grow.

## 2. Root cause
Leftover plumbing from the original design intent of **four separately-sellable apps**, where four separate change-histories made sense. The pivot to **one product with four drivers** (~3/4 through the build) unified the database but left the migration setup in its old, split shape. This plan lets the database setup catch up to a decision already made.

## 3. Goals (what "done" looks like)
1. One change-history that matches the database's one ledger — zero strays from any repo.
2. Plain `supabase db push` works again; the manual `db query -f` + `repair` workaround is retired.
3. No remaining situation that tempts `repair --status reverted` on a live migration.
4. Daily routine: database changes are authored in exactly one place.
5. Nothing destructive happens to the live database during the move (no schema re-runs, no ledger rewrites).

## 4. Options considered
- **Option A — Dedicated DB repo (`command-suite-db`). [RECOMMENDED]** A new, small repo holds *all* migrations and is the only thing linked to the Supabase project + the only thing that pushes. App repos stop carrying migrations.
  - *Pros:* cleanest match to "one database → one history"; no app repo is privileged over another; obvious single home for the safety tooling.
  - *Cons:* a new repo to create + wire; daily DB changes authored outside the app you're working in (a habit change, but simpler — one place).
- **Option B — Designate one existing app repo as the canonical migrations home.** e.g. all migrations live in `sales-command`; other repos stop carrying them.
  - *Pros:* no new repo; reuses existing tooling/hooks already in `sales-command`.
  - *Cons:* makes one app "special," which contradicts the one-product-four-drivers framing; mixes shared-DB concerns into an app's history.
- **Option C — Shared submodule / symlinked migrations folder.** One canonical folder referenced by all repos via git submodule or symlink.
  - *Pros:* files stay visible inside each repo for local `supabase start`.
  - *Cons:* submodules are fiddly and error-prone for a non-engineer to operate day-to-day; symlinks break across machines/clones. High operational friction.
- **Option D — Keep split, make each repo's safety tooling sibling-aware (band-aid).** Teach `check-migration-safety.sh` to look in sibling folders before flagging.
  - *Pros:* tiny, low-risk, fast.
  - *Cons:* does not fix the root mismatch; requires all four checkouts present + in sync on every machine; the warning returns whenever one is missing or stale. Explicitly **rejected as the durable fix** — but see §10, it is a reasonable *interim* step if cutover is deferred.

**Recommendation:** Option A. It is the only option that makes the file history structurally match the single ledger, which is the actual problem.

## 5. Chosen design (pending ratify) — Option A
- New repo `command-suite-db` (private, under the same GitHub org).
- It holds `supabase/migrations/` (the union of all current migrations, reconciled — see §6), the `config.toml`, the safety script, the `db:push` wrapper, and the pre-push hook.
- It is the **only** repo linked to `pbgvgjjuhnpsumnowuym` for migration purposes and the **only** place `db push` runs.
- App repos (`sales-command`, `sch-command`, `field-command`, `AR-Command-Center`) no longer author or push migrations. (Decision in §9 on whether they keep read-only copies for local dev.)
- Each app repo's `CLAUDE.md` updated to point at `command-suite-db` for all DB-change work.

## 6. Cutover plan (the careful part)
**Step 0 — Freeze.** Pause all migration pushes from all four repos for the duration of cutover. Coordinate so no parallel session pushes mid-move.

**Step 1 — Inventory.** Collect every migration file from all four repos. Pull the full remote ledger (`supabase_migrations.schema_migrations`). Build a reconciliation table: each row = one timestamp, with (a) which repo(s) hold a file for it and (b) whether the ledger has it.

**Step 2 — Resolve discrepancies (read-only; nothing applied or reverted yet):**
- *File present + in ledger* → canonical, keep.
- *Ledger entry + no file in ANY repo* → **true orphan.** Investigate the actual prod schema before touching anything. Do **not** `repair --status reverted` (this is the 2026-05-18 trap). Most likely the file was lost and should be reconstructed from the live schema, not erased from history.
- *File present + not in ledger* → unapplied. Decide apply-or-drop per file.
- *Timestamp collisions across repos* (two different files, same timestamp) → known hazard the safety script already watches for; detect and rename one before assembling.

**Step 3 — Assemble.** Copy all canonical files into `command-suite-db/supabase/migrations/` in timestamp order.

**Step 4 — Verify against prod.** From `command-suite-db`, `supabase migration list --linked` must show **full sync, zero strays**. This is the go/no-go gate.

**Step 5 — Move tooling.** Relocate `check-migration-safety.sh`, the `npm run db:push` wrapper, and the pre-push hook into `command-suite-db`.

**Step 6 — Retire app-repo migrations.** Remove (or freeze read-only per §9) `supabase/migrations/` in the four app repos. Update each `CLAUDE.md`.

**Step 7 — Smoke.** Author one trivial, reversible no-op migration in the new home, push via the normal path, confirm a clean apply with zero strays. This proves the new routine end-to-end.

## 7. Risks & safety
- **No ledger rewrites.** Reconciliation is read-only on the ledger; assembly only moves files. The one forbidden action throughout is `repair --status reverted` on a live entry.
- **No schema re-runs.** The live schema is never re-applied; we are reorganizing files, not changing the database.
- **Parallel sessions.** The freeze (Step 0) is mandatory; a mid-cutover push from another repo would corrupt the inventory.
- **True orphans.** If any ledger entry has no file anywhere, **stop** and investigate before proceeding — do not assume it's safe to drop.
- **Reversibility.** Through Step 4, nothing destructive has occurred (files copied, ledger untouched), so abort is free at any point before then.

## 8. Daily workflow after cutover
- Need a database change (new table, column, policy, grant)? Author it in `command-suite-db`, push from there. One place, every time.
- App repos never touch migrations again — they just consume the schema the shared DB provides.
- The recurring "stray" warning is structurally gone, because there is exactly one folder and exactly one ledger.

## 9. Open questions to ratify
1. **Home:** Option A (new `command-suite-db` repo) vs. Option B (designate `sales-command`)? *Plan recommends A.*
2. **Read-only copies:** Do app repos keep read-only migration copies so `supabase start` works locally, or remove migrations entirely and rely on a seeded local DB? *Lean: keep a generated read-only snapshot if local dev needs it; otherwise remove.*
3. **Edge functions:** Functions also live per-repo and deploy to the shared project — same fragmentation class, different mechanism. *Recommend: separate follow-up plan, not this one.*
4. **Push owner:** Local-only pushes (status quo) vs. a CI job in `command-suite-db`. *Lean: keep local for now; revisit CI later.*

## 10. Interim option if cutover is deferred
If we don't want to do the full move immediately, Option D (sibling-aware safety script) is a safe stopgap that silences the warning without touching the ledger. It does **not** replace this plan — it buys time. Track as a small standalone task.

## 11. Audit manifest
*For the plan-audit terminal (`/runaudit`). Suggested 3 agents. Focus the adversarial pass on:*
1. **Ledger-reconciliation safety** — does §6 Step 2 correctly handle every file↔ledger combination, and does it truly avoid `repair --status reverted` in the true-orphan case?
2. **Cutover-freeze completeness** — can a parallel session or a forgotten repo (incl. `field-command`, `AR-Command-Center`) corrupt the inventory despite Step 0?
3. **Timestamp-collision handling** — is the cross-repo collision detection (Step 2) sufficient, given the safety script already flags collisions today?
4. **Tooling-move completeness** — after Step 5, is there any push path left in an app repo that bypasses the new safety tooling (e.g. a stray `supabase db push` or pre-push hook still installed)?
5. **Reversibility claim** — is the "abort is free before Step 4" claim actually true at every prior step?

---

# Amendments — Audit Round 1 (2026-06-29)

**[VERIFIED]** All six findings were checked against the actual repos before integration (per "revise against code, not prose"), not adopted from audit prose alone. This block **supersedes** the cited original steps; the originals above are kept for history per the schema-amendment rule. Result: plan goal is sound, but it was **not safe to execute as written** — three load-bearing safety promises (read-only reconciliation, enforced freeze, single-pusher) were false or unenforced.

**Verification evidence (concrete):**
- Collision detection is a **separate** script `scripts/check-migration-collision.mjs`; `check-migration-safety.sh` only does branch-behind + ledger-divergence. `sch`/`field` `db:push` runs *only* the collision script (no safety.sh); `sales-command` runs both. The pre-push hook is a **symlink** (`.git/hooks/pre-push → scripts/git-hooks/pre-push`): source version-controlled, activation not.
- `.temp/project-ref == pbgvgjjuhnpsumnowuym` in sales / sch / field. **AR-Command-Center has no `supabase/` and no link** — contributes zero migrations.
- **False-orphan trap is real and live:** the `feat/inquiry-modal-redesign` worktree holds 72 migrations, missing two on `origin/main` — `20260626150000_pricing_anchor_at.sql` and `20260629104507_anon_invoices_grant_token_expiry.sql` (the B52 grant shipped today). An inventory built from that checkout brands both as true orphans → the revert trap.

### A1 [LOCKED] — Cutover is file-reorg ONLY: zero applies, zero renames of applied versions — CRITICAL
*(supersedes §6 Step 2 + Goal 5)*
- Forbid **all** apply / `supabase db push` actions during cutover. Every "apply-or-drop per file" defers to *post-cutover* normal `db:push`.
- Collision-rename is allowed **only** when the version is **NOT in the ledger**. Renaming an already-applied version manufactures a true orphan and makes the file look unapplied — the revert trap.
- This is also the precondition that makes the §7 reversibility claim true (A7).

### A2 [LOCKED] — Inventory is dynamic across ALL checkouts/worktrees, from full git history — HIGH
*(supersedes §6 Step 1)*
- Define the cutover set dynamically as *every checkout/worktree whose `supabase/.temp/project-ref == pbgvgjjuhnpsumnowuym`* — not a fixed list of four.
- Build the file inventory from `git log --all` + `git worktree list` across each, **not** the currently-checked-out tree.
- Before Step 1: `git fetch --all` in every repo and **assert no checkout is behind its remote**; abort otherwise.

### A3 [LOCKED] — Freeze is mechanical; ledger re-locked at the gate — HIGH
*(supersedes §6 Step 0 + Step 4)*
- For the window, replace each linked checkout's `db:push` with an `exit 1 "CUTOVER FREEZE"` stub and/or a freeze-flag file the collision script honors.
- Re-pull the ledger immediately before the Step 4 gate; abort on any delta vs the Step-1 snapshot.

### A4 [LOCKED] — Step 6 actively unlinks siblings — HIGH
*(supersedes §6 Step 6)*
- Per app repo: `supabase unlink` (remove `supabase/.temp/`), remove `config.toml`, remove the `db:push` npm script, neutralize `check-migration-collision.mjs` + the hook.
- This unlink **is** the enforcement of §5's "only command-suite-db pushes" — without it that guarantee is unenforced prose.

### A5 [LOCKED] — Move the RIGHT tooling; fix the false wording — HIGH
*(supersedes §6 Step 5 + §5)*
- Add `check-migration-collision.mjs` AND `install-git-hooks.sh` (+ `scripts/git-hooks/`) to the inventory and move list. Run the hook installer in `command-suite-db` (otherwise the hook is a dormant symlink on a fresh clone).
- Strike the §2/§6 claim that "the safety script already watches collisions" — it does not.

### A6 [DERIVED] — Orphan recovery source order; no live-schema reconstruction — HIGH (Partial)
*(supersedes §6 Step 2 orphan case + §7)*
- True-orphan recovery order: (1) `schema_migrations.statements` (verbatim SQL that ran), else (2) `git log --all` across all repos, else (3) **STOP**. Never "reconstruct from live schema" (lossy — later migrations alter/replace earlier objects).
- Add a canonical-winner rule for same-version-different-content collisions.
- **Caveat (verified):** the `statements` column is **empty** for versions inserted via the `repair --status applied` workaround (e.g. B52's `20260629104507`), so the statements content-diff at the Step 4 gate is **best-effort, not a guaranteed gate**. Git history is the primary recovery source in practice.

### A7 [LOCKED] — Reversibility claim, with its precondition stated
*(supersedes §7)*
- "Abort is free before Step 4" is **true only if** Step 2 does zero applies and no rename of an already-applied version (A1). Mechanics confirmed sound: `supabase link` writes a per-directory `.temp/project-ref`, so linking `command-suite-db` does not unlink siblings, and `migration list --linked` is read-only.

### Design decision — sequence the move (Option 2) — [LOCKED] RATIFIED 2026-06-29
- **Pass 1** (all reversible): mechanical freeze → dynamic complete inventory → unlink siblings → prove the ledger fully reconciles with **zero true orphans**. Hard gate — Pass 2 does not begin until Pass 1 verifies clean.
- **Pass 2** (irreversible): file assembly into `command-suite-db` + tooling relocation.
- Rationale: the irreversible move never runs against an unverified inventory. Audit-recommended; matches the "build it right" posture. **Chris ratified two-pass on 2026-06-29; Option 1 (one-pass) is closed.**

### Adjacent findings → backlog (not this plan)
- AR-Command-Center unwired — no `supabase/`, no link. Drop from cutover scope; discover linked checkouts dynamically (A2) rather than assume a fixed set.
- Known push bypasses: raw `supabase db push`, `--skip-collision-check`, dashboard SQL. Unlink (A4) is the real enforcement.
- Tooling parity never existed: only `sales-command` had the hook/`safety.sh`; `sch`/`field` had only the collision script. "Move sales-command's copy" doesn't retro-protect repos that were never protected.
- No CI pushers / no pg_cron DDL found — freeze need not cover CI.
- Hook is a symlink — activation not version-controlled; worth a one-line README note wherever relied on.

### Round 2 audit focus
- Does the dynamic inventory (A2) + mechanical freeze (A3) actually close the false-orphan path end-to-end?

---

# Amendments — Audit Round 2 (2026-06-29): Scope Cut to Manual Checklist

**[LOCKED] RATIFIED 2026-06-29 (Chris).** Round 2 fired the plateau: the automated discover/freeze/verify machinery (A2 dynamic discovery, A3 mechanical freeze, automated Pass-1 gate) is over-built for a one-time, single-tenant move of 74 live files with zero collisions found, and it has **no post-cutover consumer** — it would be thrown away the moment the move completes. **This section supersedes §6 and the automation portions of A2/A3** with a one-time MANUAL reconciliation checklist. Surviving amendments folded in: A1 (re-keyed on file identity), A4 (unlink, made per-repo), A5 (tooling moves to `command-suite-db`), A6 (ledger-driven recovery), A7 (reversibility with stated precondition).

## Keystone correction — the inventory is LEDGER-DRIVEN, not git-driven
*(verified against prod 2026-06-29)*

The source of truth for "which migrations belong" is the **prod ledger** (`supabase_migrations.schema_migrations`) — the record of what actually ran. Git is only where the file *bodies* are fetched. This dissolves both round-2 failure modes at once:

- **Over-collect (verified):** git history holds **79** distinct migration files vs **74** live. Of the 5 history-only files, **3 never ran** (not in ledger) and must be **EXCLUDED** — copying them would re-run deliberately-killed DDL:
  - `20260427120100_drop_anon_signing_policies.sql`
  - `20260620130000_deposit_tag.sql`
  - `20260620140000_billing_schedule_deposit_pending.sql`
- **Under-collect (verified):** **2** history-only files **did run** (in ledger, file not on `main`) and must be **KEPT** — a ref-tips-only inventory would falsely orphan them:
  - `20260427120000_tighten_anon_rls_signing_flow.sql` (ledger: applied, has-statements)
  - `20260512120000_multi_gc_allocation.sql` (ledger: applied, has-statements)

**Rule:** canonical set = every ledger version. For each, locate its file (ref tips → else `git log --all` recover → else `statements` column → else **STOP**). Any history file whose version is **not** in the ledger is abandoned → exclude. This supersedes A2's "inventory from git log --all" (which over-collected) and the audit's "ref tips only" counter (which would under-collect the 2 applied-history-only files).

## §6 REWRITTEN — two-pass manual checklist

### Pass 1 — Reconcile & freeze (all reversible)
1. **All-machines-pushed assertion.** On every machine + checkout/worktree: `git fetch --all`, then confirm `git log --branches --not --remotes` is empty (nothing applied from an unpushed local branch); push first if not. The operator enumerates the machine/checkout set **by hand** — sales / sch / field + their worktrees; AR excluded (unwired). Stated cross-machine precondition, not automated discovery.
2. **Freeze = unlink siblings.** `supabase unlink` in `sch-command` and `field-command` (the real freeze; a db:push stub is theater — round-2 D). Keep `sales-command` linked for the reconciliation reads. **Abort/restore:** re-`supabase link` siblings — `sch`/`field` `.temp/` is gitignored, so re-link needs the CLI token + DB password (not a git-trivial restore — round-2 E).
3. **Build the reconciliation table by hand** (one-time, ~79 rows). Pull the full ledger; for each ledger version find its file and classify: (a) live & matched; (b) applied but file only in history → KEEP (recover from history); (c) true orphan = ledger version, no file anywhere → recover SQL from `statements`, else STOP; (d) same-version-different-content → canonical winner = file whose content matches the ledger `statements`. Separately list history files NOT in the ledger → EXCLUDE (the 3 abandoned above). *Caveat: `statements` is empty for versions inserted via the `repair --status applied` workaround — best-effort, lean on git history first.*
4. **Pass-1 gate (procedural — operator tick).** Proceed only when: zero unresolved true orphans AND zero unresolved content collisions. Manual checklist tick, appropriate at 1 tenant — do not build mechanical enforcement for a one-time move (round-2 F). Nothing irreversible has happened — abort = re-link siblings.

### Pass 2 — Assemble & cut over (irreversible)
5. **Create `command-suite-db`.** Assemble the ledger-driven canonical set into its `supabase/migrations/` in timestamp order, recovering history-only bodies as classified. Move tooling: `check-migration-collision.mjs`, `check-migration-safety.sh`, `scripts/git-hooks/` + `install-git-hooks.sh`; run the hook installer there (round-2 A5).
6. **Verify gate.** Link `command-suite-db`; `supabase migration list --linked` must show **full sync, zero strays** vs prod. Go/no-go.
7. **Retire siblings (per-repo, non-uniform).** Remove the `db:push` npm script + neutralize collision/hook in each app repo. **Do NOT remove `config.toml` yet** — it kills local `supabase start` and is coupled to §9's open read-only-snapshot decision (round-2 F); sequence after §9. (`sch-command` has no `config.toml` anyway — A4 is per-repo, not uniform.)
8. **Post-cutover smoke (the ONE permitted apply).** Author a trivial no-op migration in `command-suite-db`, push via the normal path, confirm clean apply + zero strays. Explicitly carved out of A1's apply-ban as post-cutover (round-2 over-cap).

### Freeze-window note
The freeze now spans both passes (longer than the original single-step freeze). Emergency-push path: if a production migration is genuinely needed mid-cutover, re-link the affected repo, push, then add the new version to the reconciliation table before continuing.

### A1 re-key (folded in, round-2 D)
A1's "rename only when version NOT in ledger" is re-keyed on **file identity**: a collision is resolved by matching the ledger entry's recorded name/`statements`, not by the bare 14-digit timestamp. (The collision script fires precisely when a version IS in the ledger under a different filename — the old wording forbade the exact case it must handle.)

## Round 3 audit focus
- Does the ledger-driven inventory correctly KEEP the 2 applied-history-only files and EXCLUDE the 3 abandoned ones?
- Is the Pass-1 → Pass-2 order now correct (reconcile + gate before any assembly)?
- Any remaining apply or rename-of-applied-version inside Pass 1?

---

# Amendments — Audit Round 3 (2026-06-29): Mechanical Gate

**[LOCKED] RATIFIED 2026-06-29 (Chris).** Round 3 found the round-2 hand-built KEEP/EXCLUDE list **factually inverted** — independently confirmed by two agents and reproduced. Root cause: it matched on the 14-digit version alone, but the ledger stores `(version, name)` and this shared history has same-version twins from renames/reverts across repos. **This section supersedes the round-2 "Keystone correction" hand-built file list and §6 Pass-1 step 3's hand-built table.** The canonical set is now DERIVED mechanically and GATED by the existing collision script — no hand-typed list anywhere.

## Ground truth (verified against prod 2026-06-29)
- The ledger (`schema_migrations`) holds **82** applied versions — **not 74**. The 74 was sales-command's `main` only; the ledger also holds Schedule's and Field's applied migrations on the shared backend. **The canonical set = the 82 ledger rows, spanning all repos.** A one-repo hand-count structurally cannot see this — it is the core reason hand-derivation failed every round.
- The ledger stores `(version, name)`; matching on version alone is wrong. Illustrative (verified), NOT a canonical hand-list:
  - Version `20260427120000` is a **3-way** twin in git history (`create_token_rpcs`, `tighten_anon_rls_signing_flow`, `invoices_intro`). The ledger names the winner **`invoices_intro`** (live on main); the other two are abandoned.
  - Version `20260512120000` → ledger name **`jobs_material_status_additive`** (a Schedule Command migration). The history-only `20260512120000_multi_gc_allocation` is an abandoned pre-rename draft; the real `multi_gc_allocation` ran at `20260513000000` (ledger-named, live).
- The round-2 "KEEP these 2 history-only files" instruction is **STRUCK** — both were abandoned twins.

## §6 Pass-1 step 3 + gate — REWRITTEN as a mechanical derivation
Replace the hand-built reconciliation table with:

**3. Derive the canonical set mechanically (no hand judgement).**
   a. Pull the full ledger: every `(version, name)` row (the 82) — the authoritative record of what ran.
   b. For each `(version, name)`, locate exactly one file whose 14-digit version **AND** name-slug match, searching across **all** linked repos' git (ref tips + history) — sales, sch, field. The name disambiguates same-version twins.
   c. Any git file whose `(version, name)` is **not** a ledger row → abandoned/superseded → EXCLUDE.
   d. A ledger `(version, name)` with no matching file anywhere → true orphan → recover SQL from `statements`, else **STOP**.

**4. Mechanical Pass-1 gate.** Assemble the derived candidate set into a scratch dir and run `scripts/check-migration-collision.mjs` against it. Gate passes ONLY on **zero collisions** (no two assembled files share a 14-digit version) AND zero unresolved orphans. This is the tool you already own, run once as the gate — not new automation. A hand-typed KEEP/EXCLUDE list is **not permitted**.

## Folded corrections (round-3 C/D/E/F)
- **C (regression fix):** §6 Pass-2 step 7 must `supabase unlink` **all** app repos **including sales-command** (sales is linked only through Pass 1 for reconciliation reads; unlink it at retire). Independent of the `config.toml`/§9 deferral — `supabase start` needs no remote link. Restores A4's "unlink is the real enforcement."
- **D:** This block **supersedes A6's recovery source order** → **git-first, statements-last** (git ref tips → git history → `statements` → STOP). `statements` is empty for `repair --status applied` rows, so it is the last resort, not the first.
- **E:** The freeze-window emergency-push path must ALSO copy the pushed file into `command-suite-db/supabase/migrations/` and re-run the step-6 verify gate — otherwise the new prod ledger row is an instant stray at the zero-strays go/no-go.
- **F:** Strike the round-2 "under-collect: ref-tips would falsely orphan these 2" rationale — it rested on the misclassified twins. The ledger-driven `(version, name)` rule stands on its own; no genuine applied-history-only example is claimed.
- **Step-5 assertion:** add an explicit "no two assembled files share a 14-digit version" check (belt-and-suspenders alongside the collision script).

## Round 4 audit focus
- Mechanical confirmation only: does the ledger-derived `(version, name)` set, run through `check-migration-collision.mjs`, pass with zero collisions, with all 82 ledger rows matched to exactly one file or a STOP-flagged orphan? No hand-verification of a hand-built list.

---

# Amendments — Audit Round 4 (2026-06-29): Bijection Gate + Pass-1 CERTIFIED

**[LOCKED] RATIFIED 2026-06-29 (Chris).** Design converged (4 flat rounds). Final gate re-spec below, and the reversible Pass-1 certification was **EXECUTED read-only** — result recorded. No round 5: further prose audit adds nothing; execution is the proof.

## Gate re-spec (supersedes round-3 "collision script as the gate")
Reading `check-migration-collision.mjs` confirmed it only flags same-version-different-name, (a) hardcodes `MIGRATION_DIR`, (b) never asserts ledger coverage → misses orphans + extras. Therefore:
- **PRIMARY GATE = `(version,name)` set-equality (bijection):** the assembled candidate set must map one-to-one onto the ledger `(version,name)` rows — zero orphans (ledger row w/o file), zero extras inside the canonical set, zero duplicate versions. This is pass/fail.
- **Collision script = SECONDARY.** To point it at a scratch dir add: `const MIGRATION_DIR = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "supabase/migrations";` run from cwd=linked sales-command. Require the real success line; **forbid `--skip-collision-check`** at the gate.
- **Step 3e:** multiple bodies for one `(version,name)` → canonical = latest commit on `main`.
- The round-2 hand-typed EXCLUDE-3 list is **struck** (extras are derived, not hand-listed).

## Pass-1 certification — EXECUTED 2026-06-29 (read-only; nothing mutated, nothing unlinked)
Pulled all 82 ledger `(version,name)` rows; enumerated every migration file across sales+sch+field (all git history + working trees → 88 distinct); matched on `(version,name)`:
- **82/82 ledger rows matched to exactly one file · 0 orphans · 0 duplicate versions → BIJECTION CLEAN.**
- Because all 82 matched on this machine with zero orphans, no ledger migration is hiding on an unpushed branch elsewhere.
- **6 extras (abandoned → excluded):** `20260427120000_create_token_rpcs`, `20260427120000_tighten_anon_rls_signing_flow`, `20260427120100_drop_anon_signing_policies`, `20260512120000_multi_gc_allocation`, `20260620130000_deposit_tag`, `20260620140000_billing_schedule_deposit_pending`. (Confirms round-3: the round-2 "KEEP" files are abandoned.)

**Conclusion: Pass-1 reconciliation is CERTIFIED clean.** Canonical set for `command-suite-db` = the 82 ledger-matched files; the 6 abandoned files excluded. Design proven.

## Remaining work = Pass 2 only (build session)
Per §6 as amended: create `command-suite-db`, assemble the 82 certified files in timestamp order, move tooling (incl. the collision-script dir-arg), verify `migration list` zero strays, `supabase unlink` ALL app repos incl. sales, post-cutover smoke. Execute with the freeze (all-machines-pushed assertion + unlink) actually in place. **No further plan audit — BUILD-READY.**
