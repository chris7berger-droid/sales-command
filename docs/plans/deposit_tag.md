# Deposit Tag — Plan (corrected, simplified)

**Repo:** sales-command @ feat/billing-deposit
**Date:** 2026-06-20 · **ERD:** Loop #36
**Supersedes** the deposit half of `~/sch-command/docs/plans/billing_redesign_buildorder.md` §1 — which overbuilt a standalone deposit-invoice creation path.

**Intent (locked with Chris 2026-06-20):** Flag a job as needing a deposit, bill it with the **existing** invoice flow (pay-app for a GC, regular invoice for direct), and make its **required / due / paid** state visible — **no new invoice plumbing.**

## Done
- **§1b checkbox + amount** on `ProposalDetail` summary. Verified it renders for **all** customers — the summary panel isn't customer-type-gated, so GC and direct proposals both show it. `proposals.deposit_required` / `deposit_amount` are live on prod.

## Build
0. **Move the flag to the job (`call_log`)** — locked 2026-06-20. Migration adds `call_log.deposit_required` + `deposit_amount`; the `proposals.deposit_*` columns we shipped go **vestigial** (leave; file cleanup). Why: a job is the universal record (proposal-less archive jobs can still carry a deposit), and Schedule reads it straight off the job — no proposal join.
   - Repoint the §1b proposal-summary checkbox to write `call_log`.
   - **Add the same deposit control to the job-detail screen (`CallLogDetail`)** — per Chris's principle, the call_log job-detail is *the* home and should always carry all info.
1. **Strip the overbuild (§1c):** remove the "Create Deposit Invoice" button, the archive-path deposit creation, and the forced no-retention guard. Deposits are billed through the **normal flow** — a pay-app for a GC (retention handled there already), a regular invoice for direct.
2. **Tag the deposit invoice:** when you bill the deposit, mark that invoice as *the deposit* so state can link back. **[DECISION NEEDED — see Open.]**
3. **Badge:** "Materials Deposit" badge on the tagged invoice (preview + PDF + public page), driven off the tag.
4. **State:** `required` = `proposals.deposit_required`; `due` = tagged invoice's `sent_at` / `due_date`; `paid` = `paid_at`. (Consumed by the Schedule indicator — Cycle 2.)

## Open — one decision
**How to tag the deposit invoice:**
- **A) `invoices.is_deposit` boolean** — orthogonal to `type`. A GC deposit is `type='pay-app'` AND `is_deposit=true`. Small additive migration. **Recommended.**
- **B) Proposal-side link** (`proposals.deposit_invoice_id`) — no per-invoice flag; the proposal points at its deposit invoice.

> The `invoices.type='deposit'` we already shipped **does not fit** this model — a GC deposit billed as a pay-app is `type='pay-app'` and can't also be `'deposit'`. So `type` is the wrong home for the tag; it goes vestigial — leave it, don't build on it.

## Out of scope
- GC retention / pay-app rebuild — use the existing flow.
- The Schedule "deposit sent / days-passed / due" indicator — **Cycle 2** (its own plan + audit).

## Resolved
- Archive-imported jobs (no proposal) — **resolved 2026-06-20** by storing the flag on `call_log` (Build #0). Proposal-less jobs carry the deposit via the job-detail home.
