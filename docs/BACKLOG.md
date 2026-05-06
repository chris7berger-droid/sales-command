# Sales Command — Backlog

**Single source of truth for all outstanding work.** Update on every session
that completes, defers, or discovers an item. Status values: `Open`,
`In Progress`, `Blocked`, `Done` (move Done items to the Completed Log
at the bottom and out of the active table within a session or two).

Last updated: 2026-05-06 (B9/B10 added) (B8 added)

---

## Active

### Security

| ID    | Pri | Status      | Item                                                                                              | Source                          | Notes                                                                                                                                                                                       |
|-------|-----|-------------|---------------------------------------------------------------------------------------------------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| H4    | H   | Open        | `proposal_signatures` anon INSERT must bind `tenant_id`                                           | Deep audit 2026-04-30           |                                                                                                                                                                                             |
| H5    | H   | Open        | Token expiry / single-use (`signing_token_expires_at`)                                            | Deep audit 2026-04-30           | Add expiry column, enforce in policies + RPCs.                                                                                                                                              |
| L15   | L   | Open        | `qb_connection` stores refresh tokens in plaintext                                                | Original audit 2026-04-26       | Move to Supabase Vault.                                                                                                                                                                     |
| S1    | L   | Open        | `get_user_tenant_id()` COALESCE fallback fires for auth users with no `team_members` row          | Found 2026-05-05; verified prod | Prod body uses `auth.uid() → team_members.tenant_id` w/ COALESCE fallback to `tenant_config LIMIT 1`. Sharp edge only on data-hygiene failure. Severity confirmed L after prod read.        |
| —     | ?   | Open        | Triage remaining 13 Medium + 9 Low audit findings                                                 | Deep audit (branch was `claude/sweet-johnson-vvCCt`, deleted by v93 cleanup) | Audit report needs to be retrieved from PR/cache before triage — branch was deleted with other claude/* branches.                                                                          |

### Bugs

| ID  | Pri | Status | Item                                                                          | Source           | Notes                                                                                                                                                       |
|-----|-----|--------|-------------------------------------------------------------------------------|------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| B1  | M   | Open   | WTC step tabs clip at narrow widths, no nav to later steps                    | Found 2026-04-18 | Add horizontal scroll or wrap at small breakpoints.                                                                                                         |
| B2  | M   | Open   | `send-invoice` error surfacing — apply `fnErr.context.json()` pattern         | v90 carryforward | Pattern lives in QBLinkModal.                                                                                                                               |
| B3  | L   | Open   | Page remount on list ↔ detail transitions                                     | v90 carryforward |                                                                                                                                                             |
| B4  | L   | Open   | History Locker pagination — `DataTable` sorts only the visible page           | v90 carryforward |                                                                                                                                                             |
| B5  | L   | Open   | `importApi.js` bulk CSV does NOT honor virtual `qb_skip_sync`                 | v90 carryforward |                                                                                                                                                             |
| B6  | H   | Open   | QuickBooks "Connection Failed" 403 on `/qb/callback`                          | v92 open bug     | qb-auth `exchange` returning 403; gotrue lock timeout on stale session. **Hypothesis**, not a recipe: try redeploying qb-auth with `--no-verify-jwt` + retry/await-session in QBCallbackPage.jsx. Verify the auth surface before shipping — `--no-verify-jwt` makes the function callable without auth, which may be appropriate for an OAuth callback mid-dance but is not a no-brainer (the function still uses `requireAdminOrManager()` internally, so caller-tenant isolation must be re-confirmed). Files: `supabase/functions/qb-auth/index.ts`, `_shared/tenantAuth.ts`, `src/pages/QBCallbackPage.jsx`, `src/pages/Settings.jsx:382`. |
| B7  | L   | Open   | Archive imports were landing `archived=true` (root cause unknown)              | Found 2026-05-06 | Defensive fix shipped (explicit `archived: false` in ImportToLiveWizard call_log insert, commit `eb0b94f`). DB column default is `false`, no INSERT triggers, auto-archive doesn't match Sold + fresh rows. Suspect: accidental "Move to Old Jobs" click on CallLogDetail (`CallLogDetail.jsx:414`) during testing, OR an unfound code path. Reproducible test on prod will tell us if defensive fix alone is enough. |
| B8  | M   | Open   | NewPayAppModal: negative `Gross This Billing` / `Current Payment Due` + misleading "Less Previous Billings" placement | Found 2026-05-06 | When `THIS APP $` inputs are empty, Line 5 (Less Previous Billings) shows the prior-billed sum and Line 6 (Gross This Billing) goes negative (e.g. `-$43,091`); Line 8 follows. Math should clamp Line 6 ≥ 0 when nothing entered, OR Line 5 should be visually de-emphasized so it doesn't read as "you are about to bill this." File: `src/components/NewPayAppModal.jsx`. Repro: Plenium AGRU pay app on preview deploy `fix/restore-create-invoice-flow`. |
| B9  | H   | In Progress | Merge Job feature — `merge_call_log()` RPC + `MergeJobModal.jsx` + Merge button on Job Detail | Found 2026-05-06 | Mirrors `customer_merges` precedent (migration `20260430120000`, `CustomerMergeModal.jsx`). Re-points proposals (renumbering as P+n), invoices (handles both observed `job_id` shapes), `job_work_types` (dedupes overlapping), CO children's `parent_job_id`. Archives loser. Admin/Manager only; hidden on COs and archived rows. Confirm token: type the loser's `display_job_number`. Blocks B10. |
| B10 | M   | Open        | Unique partial index on `call_log(tenant_id, job_number, co_number)` excluding archived | Found 2026-05-06 | Prevents future `job_number` dupes per tenant. Includes `co_number` so parent + COs (which share `job_number`) coexist. Migration depends on B9 shipping AND user cleaning up existing dupe groups (e.g. 6507 has 4 bare rows that need merging into one). Add wizard retry guards on `unique_violation` (PG 23505) in `NewInquiryWizard.jsx` and `ImportToLiveWizard.jsx` legacy-num path. |

### Features

| ID  | Pri | Status | Item                                                                          | Source           | Notes                                                                                                                                                                                                                  |
|-----|-----|--------|-------------------------------------------------------------------------------|------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| F1  | M   | Open   | Invoice numbering                                                             | v92/v93 carry    |                                                                                                                                                                                                                        |
| F2  | M   | Open   | Multi-invoice header link                                                     | v92/v93 carry    |                                                                                                                                                                                                                        |
| F3  | M   | Open   | Customer settings page                                                        | v92/v93 carry    |                                                                                                                                                                                                                        |
| F4  | L   | Open   | QB fan-out sweep                                                              | v92/v93 carry    |                                                                                                                                                                                                                        |
| F5  | M   | Open   | C2: Retention reminders + scheduled emails per invoice                        | v93              | Half day to a day. Needs: new table, datepicker UI, cron edge function, Resend wiring, dedupe + state-change skip logic.                                                                                              |
| F6  | M   | Open   | D: Retainage Release flow (cumulative-release invoice when job substantially complete) | v93              | Was Phase 5 of original SOV plan.                                                                                                                                                                                      |
| F7  | M   | Open   | E: Multi-tenant onboarding auto-provision of QB retention item + Other Current Asset account | v93              | Without this, other subs (Essentials/Plus) won't have correct routing on first connect.                                                                                                                                |
| F8  | M   | Open   | Go-backs flow (re-scheduling invoiced work)                                   | v93 carry        |                                                                                                                                                                                                                        |
| F9  | M   | Open   | Work Types Phase 2 — Smart Field SOW suggestion                               | v93 carry        |                                                                                                                                                                                                                        |
| F10 | L   | Open   | Call Log Archiver                                                             | v93 carry        |                                                                                                                                                                                                                        |
| F11 | L   | Open   | Sales Rep Reminders                                                           | v93 carry        |                                                                                                                                                                                                                        |
| F12 | L   | Open   | PandaDoc PDF attachment                                                       | v93 carry        |                                                                                                                                                                                                                        |
| F13 | L   | Open   | Contacts import from Glide (1,612 records)                                    | v93 carry        |                                                                                                                                                                                                                        |

### Refactor

| ID  | Pri | Status | Item                                                                          | Source           | Notes                                                                                                |
|-----|-----|--------|-------------------------------------------------------------------------------|------------------|------------------------------------------------------------------------------------------------------|
| R1  | M   | Open   | Extract Invoices.jsx (~1,200 lines)                                           | v93 carry        | Page is now hosting Retention list view + retention header cards on top of the original invoice CRUD. |
| R2  | M   | Open   | Extract WTCCalculator.jsx (~2,100 lines)                                      | v93 carry        |                                                                                                      |
| R3  | M   | Open   | RLS simplification — use `tenant_id` directly instead of JOIN-based scoping   | v93 carry        |                                                                                                      |

### Cleanup / Ops

| ID  | Pri | Status | Item                                                                                            | Source     | Notes                                                                                                                            |
|-----|-----|--------|-------------------------------------------------------------------------------------------------|------------|----------------------------------------------------------------------------------------------------------------------------------|
| O1  | L   | Open   | Delete SC Staging Supabase project (`zaeevatlpkrcmivhhrph`)                                     | v91        | Served its purpose; clutter on dashboard.                                                                                        |
| O2  | M   | Open   | HDSP bookkeeper journal entry — move $41,734.78 from "AR Retention" to Construction in Progress-Retent (or Retention Receivable), then deactivate AR Retention | v93        | Not a code task. Three retention accounts exist; bookkeeper context unclear (likely intentional split between in-progress vs ready-to-release). |

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

| Date       | ID  | Item                                                                                                                          | Where done         |
|------------|-----|-------------------------------------------------------------------------------------------------------------------------------|--------------------|
| 2026-05-06 | —   | Import to Live wizard re-import handling — when an archive collides with its own prior import, Step 7 offers Open Existing Job (navigate) or Replace Existing Import (typed `REPLACE NNNN` confirm, only when existing call_log has zero proposals/invoices). | `feat/billing-contact-flag` → main (`c8af84e`) |
| 2026-05-06 | —   | `is_billing_contact` flag on customer_contacts decouples billing from role. Migration `20260506100000` adds column + backfills role='Billing Contact' rows. New "Use as billing contact" checkbox in Edit Contact modal, BILLING badge on cards, back-compat resolution everywhere (ContactBillingPicker, Invoices.loadContact, PayAppDetailModal, send-invoice edge fn). | `feat/billing-contact-flag` → main (`c8af84e`); send-invoice deployed |
| 2026-05-06 | —   | Smarter customer auto-match in Import to Live wizard — exact → acronym (IVGID ↔ Incline Village General Improvement District) → token-overlap with stopword filter. SearchSelect replaces native `<select>` for the Use Existing dropdown. | PR not opened, merged via `34f926a` |
| 2026-05-06 | —   | Field SOW materials picker empty state — split misleading "✓ All Tab 3 materials added" into two distinct empty messages so zero-materials WTCs point users at Step 3. Copy-only change to src/pages/WTCCalculator.jsx (~line 687). | PR #9 (`d5a72f6`), branch `fix/field-sow-empty-materials-copy` (deleted) |
| 2026-05-05 | H6  | PublicSigningPage no longer exposes pricing internals. Migrations 20260505190200 (proposal_wtc.locked_line_total column) + 20260505190300 (get_public_proposal_view RPC) applied to prod; backfill ran (127 rows written, 0 failed); Vercel preview smoke test passed; PR #8 merged. handleLock writes per-WTC totals at lock time (no SQL recompute, no calc.js drift surface). | PR #8, branch `fix/h6-public-signing-locked-totals` |
| 2026-05-05 | H1/H7 | `SET search_path = public` on get_user_tenant_id, request_signing_token, request_viewing_token. Migration applied via `supabase db push --linked`; verified all 3 proconfig=["search_path=public"] on prod. | Migration `20260505181452`, branch `fix/h1-h7-search-path` |
| 2026-05-05 | —   | Stale remote branch cleanup — 9 claude/* + 3 feature branches deleted (handles former "delete 10 stale branches" cleanup row) | v93 (`ca2e984`)    |
| 2026-05-05 | —   | Pay app system redesign shipped (delete cascade fix, retention to invoice, QB retention to Other Current Asset, retention list view) — replaces former "F6 Pay app system redesign" row pointing at `docs/plans/pay_app_system_redesign.md` | v93                |
| 2026-05-05 | —   | v91 prod smoke test — public signing page renders, signing flow transitions proposal/call_log → Sold                          | Session 2026-05-05 |
| 2026-05-02 | —   | Security audit v91 deploy — all 12 Criticals, anti-pattern policies dropped, edge fn tenant isolation                         | v91 handoff        |
