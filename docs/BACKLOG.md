# Sales Command — Backlog

**Single source of truth for all outstanding work.** Update on every session
that completes, defers, or discovers an item. Status values: `Open`,
`In Progress`, `Blocked`, `Done` (move Done items to the Completed Log
at the bottom and out of the active table within a session or two).

Last updated: 2026-05-05

---

## Active

### Security

| ID    | Pri | Status      | Item                                                                                              | Source                          | Notes                                                                                                                |
|-------|-----|-------------|---------------------------------------------------------------------------------------------------|---------------------------------|----------------------------------------------------------------------------------------------------------------------|
| H1/H7 | H   | In Progress | `SET search_path` on `get_user_tenant_id`, `request_signing_token`, `request_viewing_token`       | Deep audit 2026-04-30           | Tiny migration. Started 2026-05-05.                                                                                  |
| H4    | H   | Open        | `proposal_signatures` anon INSERT must bind `tenant_id`                                           | Deep audit 2026-04-30           |                                                                                                                      |
| H5    | H   | Open        | Token expiry / single-use (`signing_token_expires_at`)                                            | Deep audit 2026-04-30           | Add expiry column, enforce in policies + RPCs.                                                                       |
| H6    | H   | Open        | `PublicSigningPage` `select("*")` exposes pricing internals                                       | Deep audit 2026-04-30           | Replace with explicit column list.                                                                                   |
| L15   | L   | Open        | `qb_connection` stores refresh tokens in plaintext                                                | Original audit 2026-04-26       | Move to Supabase Vault.                                                                                              |
| —     | ?   | Open        | Triage remaining 13 Medium + 9 Low audit findings                                                 | Deep audit branch `claude/sweet-johnson-vvCCt` | Read report, file each as its own row here.                                                                          |
| —     | ?   | Open        | `get_user_tenant_id()` body — needs prod verification before severity                             | Found 2026-05-05 reading code   | Three versions exist in sql/ seeds; prod was populated manually so live body is unknown. Run PRE-APPLY query in migration `20260505181452` to determine. If body is `LIMIT 1` only → M (every auth user gets arbitrary tenant). If body has `team_members` COALESCE → L (fallback only fires for users missing a team_members row). |

### Bugs

| ID  | Pri | Status | Item                                                                          | Source           | Notes                                                          |
|-----|-----|--------|-------------------------------------------------------------------------------|------------------|----------------------------------------------------------------|
| B1  | M   | Open   | WTC step tabs clip at narrow widths, no nav to later steps                    | Found 2026-04-18 | Add horizontal scroll or wrap at small breakpoints.            |
| B2  | M   | Open   | `send-invoice` error surfacing — apply `fnErr.context.json()` pattern         | v90 carryforward | Pattern lives in QBLinkModal.                                  |
| B3  | L   | Open   | Page remount on list ↔ detail transitions                                     | v90 carryforward |                                                                |
| B4  | L   | Open   | History Locker pagination — `DataTable` sorts only the visible page           | v90 carryforward |                                                                |
| B5  | L   | Open   | `importApi.js` bulk CSV does NOT honor virtual `qb_skip_sync`                 | v90 carryforward |                                                                |

### Features

| ID  | Pri | Status | Item                                            | Source           | Notes                                                 |
|-----|-----|--------|-------------------------------------------------|------------------|-------------------------------------------------------|
| F1  | M   | Open   | Retention release workflow                      | v90 carryforward |                                                       |
| F2  | M   | Open   | Invoice numbering                               | v90 carryforward |                                                       |
| F3  | M   | Open   | Multi-invoice header link                       | v90 carryforward |                                                       |
| F4  | M   | Open   | Customer settings page                          | v90 carryforward |                                                       |
| F5  | L   | Open   | QB fan-out sweep                                | v90 carryforward |                                                       |
| F6  | H   | Open   | Pay app system redesign                         | v90 carryforward | Plan exists: `docs/plans/pay_app_system_redesign.md`. |

### Cleanup

| ID  | Pri | Status | Item                                                              | Source           | Notes                                                |
|-----|-----|--------|-------------------------------------------------------------------|------------------|------------------------------------------------------|
| C1  | L   | Open   | Delete SC Staging Supabase project (`zaeevatlpkrcmivhhrph`)       | v91 cleanup      | Served its purpose; clutter on dashboard.            |
| C2  | L   | Open   | Delete 10 stale remote branches (all merged or superseded)        | v91 cleanup      | No open PRs depend on them.                          |

### By-design (not bugs — kept here so we stop re-litigating)

- In-app invoice display ignores `show_cents` (intentional).

---

## How to use this file

1. **Every session starts by reading this file** (enforced via `CLAUDE.md`).
2. **Add new items** the moment you discover them — don't trust memory.
3. **Mark `In Progress` when starting** so a parallel session won't double-up.
4. **Move `Done` rows to the Completed Log** before closing the session.
5. **Each row's `Source` is non-negotiable** — it's how we trace why an item exists when context fades.

---

## Completed Log

Append rows as they finish — newest first. Once the log gets long, archive
older entries to a per-version handoff and trim here.

| Date       | ID  | Item                                                                                                | Where done                |
|------------|-----|-----------------------------------------------------------------------------------------------------|---------------------------|
| 2026-05-05 | —   | v91 prod smoke test — public signing page renders, signing flow transitions proposal/call_log → Sold | Session 2026-05-05        |
| 2026-05-02 | —   | Security audit v91 deploy — all 12 Criticals, anti-pattern policies dropped, edge fn tenant isolation | v91 handoff               |
