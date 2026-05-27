# Self-Protection Layer — Living Scorecard

**Origin:** 2026-05-12 conversation comparing this build's patterns vs. a "real software engineer." A full-history scan of 741 commits / ~62.5k LOC / 64 days surfaced 6 learner bullets. This doc is the living tracker — it carries the baseline, current score, history, and what's next.

**Live constraint at time of writing:** GC multi-task build is paused on Chris's input in another session. Anything that touches `~/sales-command` working tree on `feat/multi-gc-1a` or modifies `~/.claude/settings.json` is unsafe right now.

---

## What's already strong (not in score — context for the score)

The score below is *what's still to improve*. These are markers of real-engineer behavior that the build already has, and they should be acknowledged before the scorecard implies otherwise:

- **Conventional Commits** — adopted by week 1.5, scope qualifiers (`feat(migration):`, `fix(ux):`) by week 8.
- **Feature branches + merge commits** — 15 branches, 27 merges. Most solo devs don't bother.
- **Audit-ID cross-referencing** — commits reference `Closes B8`, `Touches O5`, `audit M1`. Traceability better than most pro teams.
- **Plan-as-memory** — `docs/plans/` with §-numbered design rounds and confidence tags ([LOCKED]/[DERIVED]/[DESIGN-OPEN]).
- **Security audit discipline** — RLS hardening C1–C12, H1–H10. CVE upgrade pass. Enterprise behavior.
- **Migration discipline** (post-week-5) — `supabase/migrations/` + `supabase db push`, with `migration repair` known and used.
- **Documentation discipline** — handoffs `v1`→`v112`, `BACKLOG.md` with explicit scoring vocabulary.

Voice has gone `"initial scaffold"` → `"fix(migration): drop NOT NULL on proposal_clones.parent_proposal_id (audit M1)"` in 64 days. That's ~2 years of normal junior→mid progression.

---

## The 6 learner bullets (improvement targets)

1. **Zero tests.** No `.test.` or `.spec.` files. Most-churned money-math files (`Invoices.jsx`, `Proposals.jsx`, `WTCCalculator.jsx`) uncovered.
2. **Fix:feat ratio high.** 1.43 all-time, 1.35 last 30 days. Healthy is 0.5–0.8. Signals "ship, then debug."
3. **Schema-first late.** `supabase/migrations/` didn't appear until week 5; first month's DDL has no git history.
4. **No `src/hooks/` folder.** Reusable stateful logic duplicated inside components.
5. **Big-bang commits.** 13 commits >500 LOC in the last 30 days. Hard to review, hard to revert.
6. **File instability.** `Invoices.jsx` touched 37 times in 30 days. File is doing too much.

---

## Scorecard (100 points)

### Day-0 baseline — 2026-05-12

| Category | Sub-metric | Today | Target | Score |
|---|---|---|---|---|
| **Defensive coverage** (25) | | | | **0/25** |
| | Tests on `src/lib/*` | 0 of 12 files | 8 of 12 | 0/10 |
| | TS migration of `src/lib/` | 0 of 12 files | 8 of 12 | 0/5 |
| | Error monitoring (Sentry) | not installed | installed + triaged weekly | 0/10 |
| **Shipping discipline** (25) | | | | **0/25** |
| | Fix:feat ratio (30d) | 1.35 | <0.8 | 0/15 |
| | Big-bang commits (30d, >500 LOC) | 13 | ≤2 | 0/10 |
| **Architecture hygiene** (25) | | | | **0/25** |
| | Files in `src/hooks/` | 0 | ≥4 | 0/10 |
| | Max file touches (30d) | 37 (`Invoices.jsx`) | <15 | 0/15 |
| **Protection layer** (25) | | | | **3/25** |
| | `/pre-ship` slash command | built, awaiting merge | merged to main + used | 3/5 |
| | `discipline-check` skill | not built | auto-fires on drift language | 0/5 |
| | Hooks (PreCommit + push-to-main) | not configured | both active | 0/10 |
| | Scheduled weekly audit `/loop` | not running | running, posting reports | 0/5 |
| | | | | |
| **DAY-0 TOTAL** | | | | **3/100** |

### Scoring formulas (for repeatability)

| Metric | Formula |
|---|---|
| Tests on `src/lib/*` | `10 × (test files for src/lib) / (total src/lib *.js files)` |
| TS migration | `5 × (src/lib *.ts files) / (total src/lib files)` |
| Sentry | installed = 10, not = 0 |
| Fix:feat (30d) | `<0.6=15, 0.6–0.8=12, 0.8–1.0=8, 1.0–1.2=4, >1.2=0` |
| Big-bang (30d) | `0 commits >500 LOC=10, 1–2=8, 3–5=6, 6–10=3, 11+=0` |
| Hooks extraction | `0 files=0, 1–3=4, 4–7=7, 8+=10` |
| File stability (30d) | max single-file touches: `<10=15, 10–20=10, 20–30=5, 30+=0` |
| Protection layer items | binary built/not built per row, partial credit allowed |

A `/score` slash command (planned, not yet built) will recompute these from git state and append a new row to the history log below.

### History log

| Date | Score | Δ | Notes |
|---|---|---|---|
| 2026-05-12 | 3/100 | — | Day-0 baseline. `/pre-ship` built (3 pts). All other categories: zero. |

---

## ERD loop layer (Expectation / Result / Delta)

Companion methodology. Where the scorecard tracks **what's built**, the ERD log tracks **how Chris's predictions calibrate against reality** task by task. Many small ERD loops produce a calibrated engineer over time.

Canonical repo: **https://github.com/chris7berger-droid/erd-loop** (private). Methodology, per-task template, and chronological log all live there. Local stub in this repo at `docs/erd/README.md`.

- Day 0 of loop counter: **2026-05-12**
- SDK extraction attempt at **loop #15**

The two lenses are complementary:
- **Scorecard** answers: "Am I building the right defensive layers?"
- **ERD log** answers: "When I predict work, am I right?"

A high scorecard with chronic under-prediction means the engineer ships well but mis-estimates — a different gap than a low scorecard with accurate predictions. Tracking both surfaces both.

**Hard gate:** before any code change on a task, Claude prompts Chris for the locked expectation and refuses to start until it's written. After the change, Claude observes the result from repo state directly (diff, tests, file reads) — never asks "what happened?" Delta is named honestly, task-specific, no softening.

---

## Bullet → mechanism mapping + status

| # | Bullet | Mechanism | Status |
|---|---|---|---|
| 1 | No tests | Sentry first, then Vitest on `src/lib/calc.js`, then gradual TS migration of `src/lib/` | [DESIGN-OPEN] |
| 2 | Fix:feat ratio | Sentry + `discipline-check` skill | [DESIGN-OPEN] |
| 3 | Schema-first late | Hook: block `supabase db push` without a new migration file | [BLOCKED on settings.json] |
| 4 | No `src/hooks/` | Skill: auto-trigger when editing a component >N lines, suggest hook extraction | [DESIGN-OPEN] |
| 5 | Big-bang commits | `/pre-ship` warns >500 LOC + PreCommit hook | Partially [LOCKED] |
| 6 | File instability | Code: split `Invoices.jsx` + `Proposals.jsx`. Hook: warn on edits to files with >50 commits | [DESIGN-OPEN] |

---

## Layered protection model

| Mechanism | Strength | What it covers |
|---|---|---|
| Memory / CLAUDE.md | Soft (AI might forget) | Style + workflow rules |
| Skills (auto-trigger) | Medium (AI must notice trigger) | Language-pattern reactions |
| Slash commands | Manual (user invokes) | On-demand audits |
| Hooks (`settings.json`) | Hard (deterministic gate) | Action-blocking checks |
| Scheduled `/loop` | Hard (fires on cron) | Periodic sweeps |

**Existing soft rules already in memory** (policies are written; they need hard enforcement):
`feedback_testing`, `feedback_build_right`, `feedback_pace_check`, `feedback_minimal_fix_first`, `feedback_stay_scoped`, `feedback_never_push_discovery_to_main`, `feedback_make_it_live`, `feedback_parallel_session_collisions`.

Core insight: **Chris already wrote the rules.** The leverage is promoting soft memory rules to hard hooks.

---

## Self-protection layer status

| Layer | Status | Notes |
|---|---|---|
| `/pre-ship` slash command | [LOCKED] | This branch, `.claude/commands/pre-ship.md`. Pre-flight gate: branch, diff size, commit shape, money-math, migrations, edge fns, tests, backlog, handoff, preview. Reports CLEAR/YELLOW/RED. Never pushes or deploys itself. |
| `discipline-check` skill | [DESIGN-OPEN] | Auto-fires on "ship it" / "good enough" / "we'll fix it later" / "just push it." Pulls in `feedback_build_right` + `feedback_pace_check`. Build via worktree pattern. |
| PreCommit hook (diff size >500 LOC) | [BLOCKED on settings.json] | Touches `~/.claude/settings.json` — live in active sessions. Defer. |
| Push-to-main hook | [BLOCKED on settings.json] | Same. Refuses `git push origin main` unless on `main` and last commit subject has `(release)`. |
| Scheduled weekly `/loop` audit | [DESIGN-OPEN] | Weekly: recompute scorecard, append history row, surface top 3 churned files + commits >500 LOC + uncovered `src/lib/` files. |
| `/score` slash command | [DESIGN-OPEN] | Recompute the scorecard above on demand, append history row. Should be cheap (pure git/filesystem reads). |

---

## What "real engineers" do differently (the bug-catching menu)

| Method | Catches | Cost | Chris fit |
|---|---|---|---|
| **Error monitoring (Sentry)** | Prod errors with stack + user | ~30 min, free tier | **First move** — paying customers, zero visibility today |
| **Pure-function tests (Vitest)** | Math/logic regressions on refactor | ~2 hrs + 5 cases | Second — `src/lib/calc.js` is money math |
| **TypeScript (gradual)** | Wrong-shape data, undefined access, rename misses — at edit time | ~1 day for `src/lib/` | Third — pays off forever |
| **DB constraints** | Bad data regardless of client | Minutes per constraint | Partially adopted |
| **Integration tests (Playwright)** | Whole-flow breakage | ~1 day + maintenance | Low first-move ROI |
| **Unit tests on React components** | UI logic regressions | Slow + fragile | Lowest ROI for solo dev |

---

## Resume sequence

From home machine:

```bash
cd ~/sales-command
git fetch
git checkout feat/pre-ship-command
# read this doc — start with the scorecard
```

**If GC has shipped:**
1. Merge `feat/pre-ship-command` → main via PR: `https://github.com/chris7berger-droid/sales-command/pull/new/feat/pre-ship-command`
2. Build `discipline-check` skill
3. Build `/score` slash command (recompute scorecard on demand)
4. Add hooks to `~/.claude/settings.json` (now safe)
5. Schedule the weekly `/loop` audit (calls `/score`, appends history row)
6. Pivot to code-level bullets: #4 (extract hooks), #6 (split `Invoices.jsx` + `Proposals.jsx`)

**If GC still in flight:**
Stay on `feat/pre-ship-command` worktree pattern. Build `discipline-check` and `/score` here. Defer settings.json hooks.

---

## Open questions

- **Sentry vs. alternatives?** Sentry has the most mindshare + usable free tier. Logflare/Highlight are alternatives. [DESIGN-OPEN]
- **TypeScript scope.** Migrate just `src/lib/` first (pure functions, no JSX) or include `src/components/`? Recommendation: `src/lib/` first. [DESIGN-OPEN]
- **Test framework.** Vitest (fits Vite stack) is the default. Confirm before installing. [DESIGN-OPEN]
- **Hook location.** User-level (`~/.claude/settings.json`) is general; repo-level (`.claude/settings.json` in sales-command) is repo-specific. Big-bang + push-to-main are general; high-churn-file hook is repo-specific. Mix accordingly. [DESIGN-OPEN]
- **Score cadence.** Default plan: weekly. Should also re-run after any "milestone" event (Sentry installed, first test file landed, mega-file split). [DESIGN-OPEN]
