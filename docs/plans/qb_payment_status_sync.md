# QuickBooks → Sales Command Payment Status Sync

**Branch:** `feat/qb-payment-status-sync`
**Status:** PLAN — build-ready (all decisions locked), not yet built
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
- **QB → SC reflection (NEW):** the missing feature — reflects QB payment status back into SC. Built as **two mechanisms feeding one shared "reflect" core**:
  1. **Instant webhook (primary):** QuickBooks pushes a notification the moment a payment posts → SC updates in seconds. This is the real experience 99% of the time.
  2. **15-min sweep (backup):** a self-healing safety net that catches anything a webhook ping missed, and clears the existing backlog.

  Both call the *same* reflect logic (§4.3a), so they can never drift. The webhook says *which* invoices changed; the sweep re-checks *all* still-unpaid invoices.

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
- Function body unchanged except the guard below. It already tenant-binds and allows service-role internal calls (`_shared/tenantAuth.ts`). Once the two frontend callers are gone, Stripe is the sole caller.
- **Hard-reject non-service-role callers [LOCKED: yes].** Add an early guard: if `caller.isServiceRole` is false, return 403. Stripe calls in as service-role; any app-side/user-JWT call is now impossible, so a stray or reintroduced frontend push can never double-record a payment in QB. Permanent belt over the "remove the two callers" suspenders.

**Design: one reflect core, two triggers.** Instant webhook is the everyday path; the 15-min sweep is the backup that can't lose anything. Both call the same core so they never drift.

### 4.3a Shared reflect core [DERIVED]
A single function `reflectInvoicesFromQB(tenantId, qbInvoiceIds | "all-unpaid")` — the only code that writes Paid status from QB. Both triggers below call it.

Per invocation:
1. Load `qb_connection` for the tenant → fresh access token (reuse the existing `getQBToken` pattern from `qb-record-payment` / `qb-sync-invoice`).
2. Resolve the candidate set: either the specific `qb_invoice_id`s handed in (webhook), or all SC invoices where `status not in ('Paid','New','Void')` AND `qb_invoice_id is not null` AND `deleted_at is null` AND `voided_at is null` (sweep + backfill).
3. Query QB in batches: `SELECT Id, Balance, DocNumber FROM Invoice WHERE Id IN ('...')` (QB `IN` + `MAXRESULTS 1000` paging). Targeted, never a full-table scan.
4. For each QB invoice with `Balance == 0`: set SC `status = 'Paid'`, `paid_at = <real QB Payment date, §6>`. **Only flip if SC is currently unpaid — never un-pay** (§3.4).
5. Skip `qb_skip_sync` and archive-unlinked invoices (mirror the guards in `qb-record-payment`).

### 4.3b Instant webhook `qb-webhook` — PRIMARY, v1 [DERIVED]
New public edge function (deployed `--no-verify-jwt`) that receives Intuit **Event Notifications**.
1. **Register** the webhook URL in the Intuit developer portal; subscribe to **Invoice** (fires when balance changes on payment) and **Payment** entities.
2. **Verify** every request: HMAC-SHA256 the raw body with the webhook **verifier token** (new secret `QB_WEBHOOK_VERIFIER_TOKEN`) and compare to the `intuit-signature` header. Reject mismatches — this is the auth boundary for a public endpoint.
3. Payload gives `realmId` + changed entity IDs (not full data). Map `realmId → tenant` via `qb_connection.realm_id`. Resolve to affected `qb_invoice_id`s (for a Payment event, read its `LinkedTxn` invoice ids).
4. Call `reflectInvoicesFromQB(tenantId, thoseIds)`. Return 200 fast (do the QB read/flip inline; it's a tiny set).
- **Idempotent:** re-delivered or duplicate pings just re-confirm Paid — the never-un-pay rule makes repeats harmless.

### 4.3c 15-min sweep `qb-reflect-payments` — BACKUP, v1 [DERIVED]
Thin scheduled wrapper that calls `reflectInvoicesFromQB(tenant, "all-unpaid")` for each tenant with a QB connection.
- Wiring: `pg_cron` → `net.http_post`, service-role key from **Vault** (shared-DB pattern; custom GUCs blocked from SQL). Deploy `--no-verify-jwt`; authenticates via service-role internally.
- **Every 15 min [LOCKED].** Negligible cost (~96 runs/day, a few hundred QB reads/day vs a ~500-req/min limit). Self-healing: a failed run or a webhook ping that never arrived is swept up on the next pass — nothing is ever silently lost. This is why the webhook can be "fire-and-forget" without risk.

### 4.4 Backfill = one sweep run [LOCKED principle]
No separate throwaway script. The one-time backlog cleanup is the §4.3c sweep run once across all linked unpaid invoices — same code path as the ongoing sync, so they can't drift. Expect it to resolve most of the 108.

---

## 5. UI / UX [UI First-Class]

Current screen: `src/pages/Invoices.jsx` (list + detail modal). No layout restructure.

- **"Mark as Paid" action** stays in the same status menu (`Invoices.jsx:2000-2002`), same label, same place — behavior only changes (local-only). Preserves the existing mental model.
- **Delay notice [LOCKED]:** show a small, quiet line on the Invoices screen — e.g. "Payment statuses sync automatically from QuickBooks — usually within seconds, up to 15 minutes at most." Instant is the norm (webhook); the notice just makes a rare lag read as "syncing," not "broken." Placement TBD (near the list header or status filter).
- **"Synced from QuickBooks" badge [LOCKED: add now].** On invoices the reflection flipped, show a small tag (e.g. a "QB" pill next to the Paid status) so Chris can tell a QB-reflected Paid from a manually-marked (local-only) Paid. Driven by the `qb_reflected_at` column (§8): non-null → show the badge. Follow the C.dark bg + C.teal text pill convention.
- No change to the Stripe-paid or send flows.

---

## 6. `paid_at` source [LOCKED: real date from QuickBooks]

Chris chose the real payment date. QB's Invoice object gives `Balance` but not the payment date directly, so the reader queries the linked QB `Payment` transaction and uses its `TxnDate` as `paid_at`. Fallback to reader-detection time only if no linked payment is found. This keeps aging and "collected this month" numbers accurate.

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

**Add `invoices.qb_reflected_at timestamptz` [LOCKED].** Set by the reflect core (§4.3a) whenever it flips an invoice to Paid; null on manually-marked or Stripe-paid rows. Powers the §5 "Synced from QuickBooks" badge and gives an audit trail of which flips came from QB. Author the migration in **command-suite-db** (single source of truth since 2026-06-29), not in-repo. Also add it to the `invoices` column reference in `CLAUDE.md` when shipped.

---

## 9. Rollout & smoke

1. Ship code deltas (§4.1) + the shared reflect core (§4.3a) + both triggers (§4.3b webhook, §4.3c sweep) to a preview deploy. Deploy `qb-webhook` and `qb-reflect-payments` with `--no-verify-jwt`. Set secret `QB_WEBHOOK_VERIFIER_TOKEN`.
2. **Core smoke (sweep), before scheduling:** invoke the sweep once by hand; verify it flips a *known* QB-paid invoice (cross-check by querying QB directly by DocNumber — ground truth, never infer QB state from SC fields) and does **not** touch a known-unpaid one.
3. **Webhook smoke:** register the URL in the Intuit portal; record a test payment in QB against a linked invoice; confirm the ping arrives, signature verifies, and SC flips within seconds. Also confirm a forged/badly-signed request is rejected.
4. Verify the "Mark as Paid" button no longer creates a QB payment (check QB — no new Payment txn).
5. Verify Stripe path still records a QB payment (regression check on the one legitimate push).
6. Only after smoke passes: schedule the pg_cron sweep (15 min) and run the full backfill.
7. Re-count: QB-linked-unpaid should drop from 108 toward the true still-open set.

---

## 10. Open questions

**Resolved:**
- ~~`paid_at` source~~ → real QB Payment date (§6). [LOCKED]
- ~~Real-time vs. polling~~ → **both**: instant webhook primary + 15-min sweep backup, one shared reflect core (§4.3). Instant is the norm; the sweep guarantees nothing is ever lost. [LOCKED]
- ~~Sweep cadence~~ → 15 min (§4.3c). [LOCKED]

- ~~Hard-reject non-service-role callers of `qb-record-payment`~~ → **yes** (§4.2). [LOCKED]
- ~~"Synced from QuickBooks" badge + `qb_reflected_at` column~~ → **add now** (§5, §8). [LOCKED]

**Nothing open — plan is build-ready.**

---

## 11. Build order

1. Local-only "Mark as Paid" + remove the two SC→QB pushes (§4.1). Smallest, self-contained, immediately correct.
2. Shared reflect core (§4.3a) + 15-min sweep wrapper (§4.3c). Smoke the core via the sweep (§9.2). This alone makes the system correct.
3. Backfill run (§4.4) + pg_cron schedule (§9.6). Backlog cleared even before the webhook lands.
4. Instant webhook (§4.3b): `qb-webhook` fn, verifier-token secret, Intuit portal registration, webhook smoke (§9.3). This is the "amazing UX" layer — real-time on top of an already-correct base.
5. `qb_reflected_at` column (§8, in command-suite-db) + "Synced from QuickBooks" badge (§5) + delay notice (§5). Column should land with step 2 so the reflect core can populate it from the start.
