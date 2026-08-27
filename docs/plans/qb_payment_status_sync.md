# QuickBooks → Sales Command Payment Status Sync

**Branch:** `feat/qb-payment-status-sync`
**Status:** PLAN — not yet built
**Mode:** plan (opus 4.8, xhigh) → build gate before any code
**Author:** Chris + Claude, 2026-08-27

---

## 1. Problem (root cause, verified in code)

The feature "QuickBooks updates payment status inside Sales Command" **was never built.** There is no code path anywhere that reads payment status *from* QuickBooks and writes it back to SC. Every QB call in the app pushes one direction: **SC → QB**.

What was mistaken for the reverse sync is a UI refresher in `src/pages/Invoices.jsx:1759` ("Auto-refresh: poll for payment status updates") that re-reads Sales Command's **own** `invoices` table every 5s. It never touches QuickBooks. It only reacts when *something else* already set SC to Paid — i.e. the Stripe webhook.

**Consequence:** when a GC pays by check/ACH and the payment is recorded in QuickBooks, nothing carries that back to SC. The invoice sits at Sent / Waiting for Payment / Past Due forever.

**Measured size (2026-08-27, read-only):**
| Bucket | Count |
|---|---|
| QB-linked invoices showing unpaid in SC (candidate backlog) | **108** |
| Unlinked invoices showing unpaid | 3 |
| Invoices ever marked Paid in SC | 20 |
| Tenants | 1 |

108 vs. 20 is the missing reflector in one line.

---

## 2. Target architecture [LOCKED]

**One rule: payment status flows QB → SC only. QuickBooks is the single source of truth for "is it paid."**

Two non-human exceptions:
- **Stripe:** money moves outside QB, so the Stripe webhook keeps pushing the payment *into* QB (`qb-record-payment`, Stripe-triggered). This is the only legitimate SC→QB payment write.
- **QB → SC reader (NEW):** the missing feature — reflects QB payment status back into SC, and clears the backlog.

Coverage with no human ever "marking paid":
- **Check / ACH** → bookkeeper records in QB → reader reflects → SC Paid.
- **Stripe** → webhook sets SC Paid *and* records payment in QB → QB Balance 0 → reader agrees (idempotent no-op).

---

## 3. Decisions locked [LOCKED]

1. **QB is source of truth for payment status.** Reader flows QB → SC.
2. **"Mark as Paid" becomes local-only.** It sets SC `status = Paid` + `paid_at` and nothing else. It no longer calls `qb-record-payment`. (Chris: keep a local-only version as a manual override for invoices that don't live in QB — test jobs, archive/pay-app-only edge cases.)
3. **`qb-record-payment` stays, but Stripe becomes its only caller.** Remove the two `Invoices.jsx` callers.
4. **Precedence guardrail:** the reader only ever flips **unpaid → Paid**, never Paid → unpaid. A local manual Paid is never stomped; a QB payment is never lost.

---

## 4. Code deltas

### 4.1 Remove the backwards SC→QB payment pushes
- `src/pages/Invoices.jsx:1921` — drop the `qb-record-payment` invoke inside `updateStatus()` for the "Mark as Paid" action. Keep the local `status`/`paid_at` write.
- `src/pages/Invoices.jsx:1965` — drop the "if Paid, also record payment" push inside `handleQBSync()`. `handleQBSync` should sync the *invoice* only; payment reflection is the reader's job.
- Verify no other caller of `qb-record-payment` remains except `supabase/functions/stripe-webhook/index.ts:173`.

### 4.2 `qb-record-payment` — scope to Stripe only [DERIVED]
- Function body unchanged. It already tenant-binds and allows service-role internal calls (`_shared/tenantAuth.ts`). Once the two frontend callers are gone, Stripe is the sole caller.
- Optional hardening (DESIGN-OPEN): reject non-service-role callers outright so a stray frontend call can never push a payment again. Low effort, closes the door permanently.

### 4.3 NEW edge function: `qb-reflect-payments` [DERIVED]
Purpose: for each tenant with a QB connection, read QB payment status for the invoices SC still thinks are unpaid, and flip the fully-paid ones to Paid.

Algorithm (per tenant):
1. Load `qb_connection` → fresh access token (reuse the existing `getQBToken` pattern from `qb-record-payment` / `qb-sync-invoice`).
2. From SC: select invoices where `status not in ('Paid','New','Void')` AND `qb_invoice_id is not null` AND `deleted_at is null` AND `voided_at is null`. Collect `qb_invoice_id`s.
3. Query QB in batches: `SELECT Id, Balance, DocNumber FROM Invoice WHERE Id IN ('...')` (QB `IN` + `MAXRESULTS 1000` paging). **Targeted** query on our ~108 ids, not a full-table scan of QB.
4. For each returned QB invoice with `Balance == 0`: set SC `status = 'Paid'`, `paid_at = <payment date>`. Only flip if SC is currently unpaid (never un-pay).
5. Skip `qb_skip_sync` and archive-unlinked invoices (mirror the guards already in `qb-record-payment`).

Wiring: scheduled via `pg_cron` → `net.http_post` to the function, service-role key pulled from **Vault** (shared-DB pattern; custom GUCs are blocked from SQL). Deploy with `--no-verify-jwt`; the function authenticates via service-role internally.

Frequency (DESIGN-OPEN, recommend): every **15 min**. Payment reflection isn't latency-sensitive; 15 min is invisible to users and cheap.

### 4.4 Backfill = one run of the same reader [LOCKED principle]
No separate throwaway script. The one-time backlog cleanup is `qb-reflect-payments` run once across all linked unpaid invoices. This is the whole point of building the reader first: the fix and the ongoing sync share one code path, so they can't drift. Expect it to resolve most of the 108.

---

## 5. UI / UX [UI First-Class]

Current screen: `src/pages/Invoices.jsx` (list + detail modal). No layout restructure.

- **"Mark as Paid" action** stays in the same status menu (`Invoices.jsx:2000-2002`), same label, same place — behavior only changes (local-only). Preserves the existing mental model.
- **Consider (DESIGN-OPEN):** a small "Synced from QuickBooks" indicator or `paid_at` source tag on invoices the reader flipped, so Chris can tell QB-reflected Paid from manually-marked Paid. Not required for v1.
- No change to the Stripe-paid or send flows.

---

## 6. `paid_at` source [DESIGN-OPEN]

QB's Invoice object gives `Balance` but not the payment date directly. Options:
- **(a) Reader detection time** — simplest, but not the true payment date (accounting-inaccurate for aging/collected-this-month tiles).
- **(b) Query the linked QB `Payment` TxnDate** — one extra QB read per flipped invoice; gives the real payment date. **Recommended.** Fallback to (a) if no linked payment is found.

Decision needed before build.

---

## 7. Edge cases & guardrails

- **Never un-pay:** reader only transitions unpaid → Paid. Locked in §3.4.
- **Partial payments:** QB `Balance > 0 but < total` = partially paid. SC has no "partially paid" status. v1: only flip on `Balance == 0`; leave partials untouched. (Note for future: a partial indicator.)
- **Stripe coupling:** keep `qb-record-payment` on the Stripe path. If a Stripe-paid invoice were Paid in SC but not recorded in QB, the reader would see `Balance > 0` — but because §3.4 forbids un-paying, it still wouldn't corrupt SC. The coupling keeps QB *complete*, not just safe.
- **Retention:** SC invoices net retainage; QB invoice totals may differ. Irrelevant to the reader — `Balance == 0` in QB is still ground truth for "fully paid."
- **Token refresh / rate limits:** reuse existing `getQBToken`; batch the `IN` query (don't fire 108 single reads).
- **Voided / deleted:** excluded by the SC-side filter.
- **`qb_skip_sync` / archive-unlinked:** skip, mirroring `qb-record-payment` guards.

---

## 8. Schema

No required new columns. Optional observability (DESIGN-OPEN): `invoices.qb_reflected_at timestamptz` to mark reader-driven flips and power the §5 indicator. Author any migration in **command-suite-db** (single source of truth since 2026-06-29), not in-repo.

---

## 9. Rollout & smoke

1. Ship code deltas (§4.1–4.3) to a preview deploy.
2. Deploy `qb-reflect-payments` with `--no-verify-jwt`.
3. **Manual smoke before scheduling:** invoke the reader once by hand; verify it flips a *known* QB-paid invoice (cross-check by querying QB directly by DocNumber — ground truth, never infer QB state from SC fields) and does **not** touch a known-unpaid one.
4. Verify the "Mark as Paid" button no longer creates a QB payment (check QB — no new Payment txn).
5. Verify Stripe path still records a QB payment (regression check on the one legitimate push).
6. Only after smoke passes: schedule the pg_cron job (15 min) and run the full backfill.
7. Re-count: QB-linked-unpaid should drop from 108 toward the true still-open set.

---

## 10. Open questions (resolve before build)

- **§6** `paid_at` source: linked QB Payment TxnDate (rec) vs. detection time?
- **§4.3** cadence: 15 min ok?
- **§4.2** hard-reject non-service-role callers of `qb-record-payment`?
- **§5/§8** add the "reflected from QB" indicator + column, or defer to v2?

---

## 11. Build order

1. Local-only "Mark as Paid" + remove the two SC→QB pushes (§4.1). Smallest, self-contained, immediately correct.
2. `qb-reflect-payments` function (§4.3) + manual smoke (§9.1–9.5).
3. Backfill run (§4.4) + pg_cron schedule (§9.6).
4. Optional indicator/column (§5/§8) if kept.
