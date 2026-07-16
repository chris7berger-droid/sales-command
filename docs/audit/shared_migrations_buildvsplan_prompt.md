# Build-vs-Plan audit prompt — migration consolidation Pass 2

Paste the block below into a fresh `/buildvsplan` terminal. It gates the merge of
the three retire PRs (sales #32, sch #9, field #1). Read-only.

---

```
/buildvsplan

You are the build-vs-plan audit terminal. READ-ONLY: no edits, commits, pushes, deploys, links/unlinks, or migration applies. Inherit the /audit hard rules. Your job is to verify a finished build against its plan BEFORE the PRs merge — this is the merge gate.

CONTEXT — this build spans MULTIPLE repos (unusual):
- PLAN (the spec): ~/sales-command/docs/plans/shared_migrations_consolidation.md — read the whole thing, including all four "Amendments" sections (rounds 1–4). §6 as amended through round 4 is the procedure; the round-4 "Pass-1 CERTIFIED" + "Remaining work = Pass 2 only" section is what was just executed.
- BUILT ARTIFACT #1: the new repo ~/command-suite-db (github chris7berger-droid/command-suite-db). This is where migrations + tooling were assembled. It has NO plan doc of its own — judge it against the sales-command plan.
- BUILT ARTIFACT #2 (retire diffs, all OPEN PRs): sales-command #32 (branch plan/shared-migrations-consolidation), sch-command #9 and field-command #1 (branch retire/migration-consolidation each).
- Shared Supabase project: pbgvgjjuhnpsumnowuym. command-suite-db is the only repo that should be linked.

WHAT THE BUILD CLAIMS (verify each independently — don't trust the handoff):
1. BIJECTION: command-suite-db/supabase/migrations/ is exactly the 82 ledger (version,name) rows — 0 orphans, 0 extras, 0 duplicate versions. Reproduce it yourself: pull the ledger [SELECT version,name FROM supabase_migrations.schema_migrations] read-only, enumerate the migration files, match on (version,name). (Note: a 83rd row now exists — the smoke migration 20260629231336_consolidation_smoke_test — so live ledger = 83. Confirm 82 canonical + 1 smoke, not 83 canonical.)
2. The 6 EXCLUDED files are genuinely abandoned (not in ledger): create_token_rpcs & tighten_anon_rls_signing_flow @20260427120000, drop_anon_signing_policies @20260427120100, multi_gc_allocation @20260512120000, deposit_tag @20260620130000, billing_schedule_deposit_pending @20260620140000.
3. ASSEMBLED BODIES are byte-identical to their source files in sales-command / sch-command (no corruption, no silent edits).
4. RETIRE COMPLETENESS: each of the 3 PRs removes EVERY push path — the db:push npm script AND the collision script (sales also: check-migration-safety.sh + git-hooks/pre-push + install-git-hooks.sh). Confirm no other invocation of these remains in live config (not docs/history). Confirm migrations/ files + config.toml were intentionally LEFT (per §9 deferral), not missed.
5. TOOLING MOVE: command-suite-db has the collision script WITH the dir-arg, the safety script, the hook + installer, and the hook is actually installed; package.json db:push wrapper present.
6. LINK STATE: only command-suite-db is linked to pbgvgjjuhnpsumnowuym; verify the claim that sales/sch/field (+ sales worktrees) are unlinked. (Read-only check of supabase/.temp/project-ref presence.)

ALSO PRESSURE (build-execution gaps the plan can't show):
- Any (version,name) that the bijection matched to a file on an UNPUSHED branch (would falsely look fine locally but be invisible to others).
- Timestamp-collision edge cases in the assembled set.
- Whether the smoke migration being committed to command-suite-db creates any stray or mismatch.
- The migration-safety hard rule was honored: NO repair --status reverted anywhere; this was file-reorg, not schema re-runs.

DELIVERABLE: a punch-list — for each claim, VERIFIED / GAP / CANNOT-CONFIRM, with the evidence you ran. End with a single GO / NO-GO on merging the 3 PRs. If NO-GO, name the exact blocking item.
```
