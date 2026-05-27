---
description: Pre-flight check before "making it live" — gate against big-bang commits, untested money math, missing migrations, undeployed edge functions, scope creep, and pushing discovery work to main. Read the rules; do not skip checks.
---

# /pre-ship — Sales Command pre-flight gate

This is a **gate**, not a deployer. You do not push, deploy, or run migrations from this command. You report findings and wait for Chris's explicit confirmation. The rules being enforced already live in CLAUDE.md and memory — do not re-derive them.

## What "making it live" means here

Per `feedback_make_it_live` and `feedback_terminology`: "push" / "make it live" / "ship" means the union of:
- `git push` to the branch's remote
- Edge function deploy (with `--no-verify-jwt` per `feedback_edge_functions`)
- Supabase migration apply (`supabase db push` per `project_supabase_migrations`)
- Config / env var sync if touched

A pre-ship gate must check *all* of these, not just the git push.

## Run all checks in parallel, then report

Run these as parallel Bash calls — they're independent reads:

1. **Branch state.** `git status` + `git rev-parse --abbrev-ref HEAD` + `git log --oneline @{u}..HEAD` (commits ahead of remote). Flag if branch is `main`.
2. **Diff size.** `git diff --stat origin/main...HEAD` — total LOC across all unpushed commits on this branch. Threshold: >500 lines = yellow, >1500 = red (per the big-bang commit anti-pattern).
3. **Commit shape.** `git log --format="%s" origin/main..HEAD` — count `fix:` vs `feat:` vs other. Flag if >50% of commits on this branch are `fix:` (signals the work is still settling — per `feedback_build_right`).
4. **Money-math files touched.** Check if any of these are in the unpushed diff: `src/lib/calc.js`, `src/lib/tokens.js` (security tokens, not design tokens), `src/lib/auth.js`, any file matching `*[Ii]nvoice*`, `*[Pp]ayApp*`, `*[Bb]illing*`, `*WTC*`, `*[Rr]etention*`. These have no test coverage and are revenue-affecting — surface them explicitly so Chris can manually verify.
5. **New migrations.** `ls supabase/migrations/` filtered to files newer than the last commit on `origin/main`. For each: has it been applied locally (check `supabase migration list` if cheap)? Has `supabase db push` been run against prod? Per `feedback_migration_ledger_repair`, if any were applied via Supabase web UI bypassing the CLI, the ledger needs `migration repair --status applied <ts>`.
6. **Edge functions touched.** Any changes under `supabase/functions/`? List them. Each needs an explicit `supabase functions deploy <name> --no-verify-jwt` before the change is live. Do not run the deploy from this command.
7. **Tests.** `git ls-files '*.test.*' '*.spec.*' | wc -l` — currently 0. If money-math files were touched (check 4) and tests still = 0, note this as a known gap, not a blocker.
8. **Backlog.** Does the latest commit subject reference `Closes B<N>` / `Touches F<N>` / etc.? If commits closed work but didn't update `docs/BACKLOG.md`, flag (per CLAUDE.md "Backlog hygiene").
9. **Handoff.** Latest `docs/handoffs/SC_Handoff_v<N>.txt` — does its "Git State on Close" reflect what's about to ship? If the work happened since the last handoff and Chris is about to push without writing v<N+1>, flag.
10. **Vercel preview.** Is there a recent preview deploy for this branch? (Per `feedback_preview_deploys`, all feature-branch work should be tested on Vercel preview, not localhost, before merging.) If you can't tell from local state, ask.

## Report format

Render exactly this shape — one line per check, color-coded verdict, plus a tail summary:

```
PRE-SHIP CHECK — <branch> → <target> (main / preview / prod)

 ✓ / ⚠ / ✗  Branch state       — <one line>
 ✓ / ⚠ / ✗  Diff size          — <N lines across M commits>
 ✓ / ⚠ / ✗  Commit shape       — <N fix:, M feat:, K other>
 ✓ / ⚠ / ✗  Money-math files   — <list, or "none touched">
 ✓ / ⚠ / ✗  New migrations     — <list, or "none">
 ✓ / ⚠ / ✗  Edge functions     — <list with deploy status, or "none">
 ✓ / ⚠ / ✗  Tests              — <pure-math files touched / test coverage>
 ✓ / ⚠ / ✗  Backlog            — <closed rows referenced? BACKLOG updated?>
 ✓ / ⚠ / ✗  Handoff            — <up to date? or "v<N> stale">
 ✓ / ⚠ / ✗  Preview deploy     — <URL or "unknown — ask Chris">

VERDICT: <CLEAR / YELLOW / RED>
Blockers (red): <list, or "none">
Surface for manual confirmation (yellow): <list, or "none">

Ready to make-it-live? Confirm by listing what to actually run:
  - git push origin <branch>
  - supabase functions deploy <name> --no-verify-jwt   (per fn)
  - supabase db push                                    (per migration)
  - any other step
```

## Verdict rules

- **CLEAR** — all checks green, safe to push without extra friction. Still wait for Chris's "go" before running any push/deploy.
- **YELLOW** — one or more soft flags (big diff, money math touched, recent `fix:` cluster). Not blocking. Surface them, get explicit acknowledgment per item, then proceed if Chris says go.
- **RED** — at least one hard flag: pushing to `main` from a feature branch directly, edge function changes with no plan to deploy, migration created but not applied, RLS-touching SQL without `CLAUDE_RLS.md` 6-gate check. Stop. Do not push.

## Hard rules

- Never run `git push`, `supabase db push`, or `supabase functions deploy` from this command. Report only. Chris runs the actions or explicitly tells you to.
- Never silently downgrade a red flag to yellow. If you're unsure, escalate up, not down.
- Do not re-derive the rules in CLAUDE.md, CLAUDE_RLS.md, or memory — cite them. Format: `(per <source>)`.
- If you can't determine a check's state cheaply (e.g., preview deploy URL), say "unknown — ask Chris" rather than guessing.
- A `CLEAR` verdict on a branch that touches `supabase/migrations/*.sql` policy files OR `CLAUDE_RLS.md` rules requires you to also confirm the 6-gate runbook (per `project_security_audit` / `feedback_canonical_docs_first`) — point at the runbook, do not paste it.
