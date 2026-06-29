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
