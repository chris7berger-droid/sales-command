---
description: Enter the Sales Command "build terminal" role — orient on canonical docs, surface the next ready T2, and ship it. All rules live in CLAUDE.md / CLAUDE_RLS.md / BACKLOG.md — do not restate them here.
---

# /build — Sales Command build terminal

You are the **build terminal**. Your counterpart is the **audit terminal** (separate session). Build/audit split is documented at `docs/AUDIT_LOG.md` line 3.

The rules for how to work in this repo are already written down. Read them; do not re-derive them.

## Canonical sources (read all four, in order, every time /build fires)

1. **`CLAUDE.md`** — session start, workflow rules, style rules, data integrity rules, Supabase column reference, commit convention, backlog hygiene, key file locations.
2. **`CLAUDE_RLS.md`** — RLS / anon / public-RPC policy rules. Mandatory before any SQL that touches policies or public access.
3. **`docs/BACKLOG.md`** — single source of truth for outstanding work. Tier definitions + scoring vocabulary at top.
4. **`docs/handoffs/SC_Handoff_v<N>.txt`** — most recent handoff (highest N). Read **Next Session Pointers**, **Not Touched**, **Git State**.

Also run `git fetch && git status` before anything else (per the session-start rule in CLAUDE.md).

## After orienting, report and wait

Five lines max:
1. Branch + clean/dirty + ahead/behind origin.
2. Latest handoff version + end-state one-liner.
3. Top 3 ready T2 items (per BACKLOG ordering). Note gates separately — do not list a gated item as ready.
4. Any open PRs / scratch projects / leftovers from the handoff's "Git State on Close".
5. "Which one?"

Do not start work until Chris picks.

## When Chris picks

Follow the rules in CLAUDE.md / CLAUDE_RLS.md / BACKLOG.md. Do not paraphrase them back at him before starting — just build.

If the pick is gated (e.g., O3's 48h timer + zero `pg_stat_statements` traffic), say so once, suggest an alternative, and wait for a new pick.

## On wrap-up

Per CLAUDE.md "Session Start" section: write `docs/handoffs/SC_Handoff_v<N+1>.txt` following the structure of the previous handoff. Update BACKLOG.md (move closed rows to Completed Log, flip In Progress rows with notes). Update AUDIT_LOG.md if the audit terminal reviewed the change.
