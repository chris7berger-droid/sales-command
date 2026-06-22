# Deposit Tag — Plan v2 (radically simplified)

**Repo:** sales-command @ feat/billing-deposit · **Date:** 2026-06-21 · **ERD:** Loop #36
**Supersedes v1** (this same file's history) — v1 over-engineered "mark the deposit invoice" into `invoices.is_deposit` + a partial unique index + clear-before-set + failure-compensation + a `deposit_pending` stash/consume through the pay-app void flow — **3 migrations**. T5 findings #1/#2/#3 were bugs in that machinery, not the feature. This collapses it to **one pointer**.

**Intent (locked):** Flag a job deposit-required, bill it with the existing flow, mark which invoice is the deposit, surface required/due/paid. No new plumbing beyond one pointer.

## Model — one field
**`call_log.deposit_invoice_id`** (text FK → `invoices.id`, `ON DELETE SET NULL`, nullable). The job points at its deposit invoice. Single-select, badge, state, and atomicity all fall out of this — no other deposit-link state exists.

## Keep (already built, correct)
- §1b deposit checkbox + amount on `ProposalDetail` and `CallLogDetail` → write `call_log.deposit_required` / `deposit_amount`.
- Deposit invoices render their **real lines** (synthetic single-line render stripped).
- Retention guard — but re-key it off "is this the deposit invoice" (`call_log.deposit_invoice_id === inv.id`), non-pay-app branch only.

## Build
0. **Migration — ONE clean file.** Add to `call_log`: `deposit_required` (bool default false), `deposit_amount` (numeric default 0), **`deposit_invoice_id` (text FK → invoices.id ON DELETE SET NULL, null)**. **Delete the held files `…130000` + `…140000`.** db:push blocked (sibling ledger) → editor + `repair --status applied` at the gate.
   - `invoices.is_deposit`, the partial unique index, `deposit_pending` — **removed from scope.**
   - `…120000` is already on prod and now **fully vestigial** (`proposals.deposit_*`, `invoices.type`) — leave the dead columns (harmless); cleanup is a backlog one-liner.
1. **Mark toggle.** "Mark as deposit" on an invoice sets `call_log.deposit_invoice_id = inv.id`; untoggling the current one sets it `null`. **One atomic write** (verify-after-write). **Confirm first** only if the current `deposit_invoice_id` points at a **sent or paid** invoice — don't silently un-record a collected deposit.
2. **Badge.** An invoice shows "Materials Deposit" when `call_log.deposit_invoice_id === inv.id` (add `deposit_invoice_id` to the invoice's `call_log(...)` join). All 3 surfaces (preview, PDF, public).
3. **State (sent-gated + active).** Let **D** = the linked invoice, counted only if **active** (not voided/deleted) **and sent**:
   - `required` = `deposit_required` AND no active-sent D
   - `due` = active-sent, unpaid D → `sent_at` / `due_date`
   - `paid` = D.`paid_at`
   (Consumed by the Schedule indicator — Cycle 2.)

## RIP (the over-engineering)
- `invoices.is_deposit` column + **every** read of it (badge, state, retention guard → all re-key on the link or are deleted).
- The toggle's clear-before-set + failure-compensation → replaced by one atomic write.
- `deposit_pending` stash/consume in the pay-app void path **and** `NewPayAppModal`.
- The partial unique index.
- Void / pull-back **special handling** — state derives from the linked invoice's live status; no handlers needed. (`ON DELETE SET NULL` auto-clears the link if the invoice is deleted.)

## Why this kills the T5 findings (they stop existing)
- **#1 / #2** (un-record on untoggle / non-atomic move): a single atomic field write + a confirm on a sent/paid link. No half-state is reachable.
- **#3** (pay-app void loses tag): there's no tag to lose — after a void the link points at the voided invoice → state reads "required" → re-bill, re-mark. No `deposit_pending`.

## Out of scope
- GC retention rebuild. Schedule "deposit sent / days / due" indicator → Cycle 2 (own plan + audit).

## Backlog
- Drop the vestigial `120000` columns (`proposals.deposit_*`, `invoices.type`) in a cleanup migration.
