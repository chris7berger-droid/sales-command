# Deposit Tag — Plan (corrected, simplified)

**Repo:** sales-command @ feat/billing-deposit
**Date:** 2026-06-20 · **ERD:** Loop #36
**Supersedes** the deposit half of `~/sch-command/docs/plans/billing_redesign_buildorder.md` §1 — which overbuilt a standalone deposit-invoice creation path.

**Intent (locked with Chris 2026-06-20):** Flag a job as needing a deposit, bill it with the **existing** invoice flow (pay-app for a GC, regular invoice for direct), and make its **required / due / paid** state visible — **no new invoice plumbing.**

## Done
- **§1b checkbox + amount** on `ProposalDetail` summary. Verified it renders for **all** customers — the summary panel isn't customer-type-gated, so GC and direct proposals both show it. `proposals.deposit_required` / `deposit_amount` are live on prod.

## Build
0. **Move the flag to the job (`call_log`)** — locked 2026-06-20. Migration adds `call_log.deposit_required` + `deposit_amount`; the `proposals.deposit_*` columns we shipped go **vestigial** (leave; file cleanup). Why: a job is the universal record (proposal-less archive jobs can still carry a deposit), and Schedule reads it straight off the job — no proposal join.
   - Repoint the §1b proposal-summary checkbox to write `call_log` — and **init it from `call_log`, not the proposal** (audit #5: a job can have multiple proposals; it's now a job-level field, so every proposal of the job shows the same shared value — don't frame it as per-proposal).
   - **Add the same deposit control to the job-detail screen (`CallLogDetail`)** — per Chris's principle, the call_log job-detail is *the* home and should always carry all info.
1. **Strip the overbuild (§1c):** remove the "Create Deposit Invoice" button and the archive-path deposit creation. Deposits are billed through the **normal flow** — a pay-app for a GC (retention handled there already), a regular invoice for direct.
   - **Retention guard [audit #4 — don't kill it]:** the `handleSaveEdit` force-retention-0 + hidden retention input currently key on `invoiceKind==='deposit'`, which goes permanently false after the strip → a direct deposit edited in the form would re-acquire retention (the bug we closed). **Repoint the guard to `is_deposit`, and force-0 ONLY on the non-pay-app branch** (`type='regular'`). A pay-app deposit's retention is owned by the pay-app flow — don't double-zero it.
2. **Tag the deposit invoice — RESOLVED 2026-06-20:** a **"Mark as deposit" toggle on the invoice** sets `is_deposit=true`.
   - **Intent until sent:** the toggle can be set on a draft (`New`) invoice, but the deposit is **not "recorded"** — not counted in state, not shown as billed — **until that invoice is sent** (`sent_at` set). An unsent toggle leaves the job still showing deposit *required*.
   - **Single-select per job [audit r2 #3/#5]:** at most one active `is_deposit` invoice per `call_log`. Marking a new one may freely steal the tag from an **unsent draft** prior; if the prior deposit is **sent or paid** (a real collected deposit), **refuse/confirm before stealing** — don't silently un-record a collected deposit. Enforce in-DB with a scoped partial unique index: `CREATE UNIQUE INDEX ... ON public.invoices (call_log_id) WHERE is_deposit AND deleted_at IS NULL AND voided_at IS NULL` (the WHERE scope is mandatory so a void-then-re-mark doesn't collide; do clear-before-set ordering). UI single-select alone is not the backstop.
   - **Void-replacement copies the tag [audit r2 #2]:** the non-pay-app void path (`Invoices.jsx:1584-1602`) copies `type` to the replacement but **must also copy `is_deposit`** (replacement is `New`, so it won't count until re-sent — but the intent must survive the void).
   - **Pull-back [audit r2 #4 — DECISION PENDING, see Open]:** plan said "clear `is_deposit` on pull-back"; the audit argues against it. Held for ratification.
3. **Badge — NOT line render [audit #1, BLOCKING]:** the badge reads `is_deposit`. **DELETE the synthetic single-line "Materials Deposit / 100% / flat amount" branches** (`invoicePdf.js:256-267`, `Invoices.jsx:901-922`, `PublicInvoicePage.jsx:207-213`) — they only fit the old archive-create shape. Under the new model a deposit is a normal pay-app (real SOV lines) or regular invoice (real WTC lines) and must render its **real lines**. Badge ≠ line-itemization; only the badge keys on `is_deposit`.
4. **State (sent-gated) [audit r2 #1 — must exclude voided + deleted]:** the deposit counts only when its invoice is sent **and still active**. The canonical filter is `is_deposit AND sent_at IS NOT NULL AND deleted_at IS NULL AND voided_at IS NULL` (mirrors the dashboard's active filter — neutralizes void/delete exits without per-handler clears).
   - `required` = `call_log.deposit_required` AND no **active sent** `is_deposit` invoice (flag is on call_log, not proposals).
   - `due` = an active sent `is_deposit` invoice, unpaid → `sent_at` / `due_date`.
   - `paid` = that invoice's `paid_at` (a paid deposit is sent + not voided/deleted → stays satisfied).
   - A draft (unsent), voided, or deleted `is_deposit` invoice does **not** flip the job out of *required*. (Consumed by the Schedule indicator — Cycle 2.)

## Deposit-invoice tag — RESOLVED (A, 2026-06-20)
**`invoices.is_deposit` boolean** — orthogonal to `type`. A GC deposit is `type='pay-app'` AND `is_deposit=true`; a direct deposit is `type='regular'` AND `is_deposit=true`. Set when the user marks an invoice as the deposit. The badge + required/due/paid state read off `is_deposit`.

> The `invoices.type='deposit'` we already shipped **does not fit** and goes **vestigial** (a GC deposit is a pay-app, can't also be type 'deposit') — leave it, don't build on it; file cleanup.

## Out of scope
- GC retention / pay-app rebuild — use the existing flow.
- The Schedule "deposit sent / days-passed / due" indicator — **Cycle 2** (its own plan + audit).

## Resolved
- Archive-imported jobs (no proposal) — **resolved 2026-06-20** by storing the flag on `call_log` (Build #0). Proposal-less jobs carry the deposit via the job-detail home.
