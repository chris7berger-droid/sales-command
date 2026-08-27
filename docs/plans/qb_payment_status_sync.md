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

## §0 Baseline (observed current state)

The premise this plan builds on, verified — not assumed.

**Read-verified (code, 2026-08-27):**
- **No QB→SC payment-status path exists.** `qb_payment_id` is only ever *written* by `supabase/functions/qb-record-payment/index.ts` (SC→QB push). Every QB call in the app pushes SC→QB; none reads QB payment state back.
- The suspected "reverse sync" — `src/pages/Invoices.jsx:1759` ("Auto-refresh: poll for payment status updates") — queries **Sales Command's own** `invoices` table (`supabase.from("invoices").select("status, paid_at, …")`), never QuickBooks. It only reacts to a status *something else* already set (the Stripe webhook).
- `qb-record-payment` has exactly three callers: `stripe-webhook/index.ts:173` (legitimate), `Invoices.jsx:1921` (Mark-as-Paid push), `Invoices.jsx:1965` (re-sync push). Confirmed by grep across `*.ts/*.js/*.jsx`.
- SC status is set to `Paid` in only two places: `stripe-webhook/index.ts:134` and the manual `updateStatus()` in `Invoices.jsx:1916`.

**Run-verified (prod DB query, shared project `pbgvgjjuhnpsumnowuym`, 2026-08-27):**
- 108 invoices with `qb_invoice_id` not null, not deleted/voided, status ∉ (Paid,New,Void) — i.e. linked to QB but showing unpaid in SC.
- 3 unlinked invoices showing unpaid; 20 invoices ever marked Paid; 1 tenant.

**Reproduction (trigger + observed state):**
1. In QuickBooks, record a payment (check/ACH) against an invoice that is linked to SC (`qb_invoice_id` set) and currently Sent / Waiting for Payment / Past Due in SC.
2. Observe SC: the invoice status **does not change** — no code path reads the QB balance. It remains unpaid indefinitely.
3. Aggregate manifestation: the 108-vs-20 split above.

**Classification:** treated as a **feature** plan — the fix is entirely net-new surface (two edge functions, a shared reflect core, a new column, a webhook subscription, UI). The "bug" is the *absence* of that surface, evidenced above, not a defect in existing code.

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

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-27. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a money-touching change that adds real new plumbing — two new background services that read QuickBooks, a database column, and a live webhook. It deserves a solid check: four reviewers, each on one risky area (the payment-reading logic, the webhook's security, the database migration, and the removal of the old "push to QuickBooks" buttons). Not a quick glance, but not a sprawling audit either.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: cb12d2f (+ §0 baseline and this manifest)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1.

**Briefing for agents**: this is the first audit. Attack the whole plan. Later rounds will restrict to new material.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding is blocked/F-tier.
- **Prod / staging / dev**: affected surface is LIVE in prod (`Invoices.jsx`, `stripe-webhook`, `qb-record-payment` on scmybiz.com). New edge functions ship to the shared prod project.
- **Blocking feature flags**: `qb_skip_sync` (per-job, gates QB sync), `requires_pay_app` (invoice routing). Neither gates this feature, but the reflect core must honor `qb_skip_sync`.
- **Concurrency profile**: solo / ≤5 concurrent users.

Agents weight severity against these. Cross-tenant findings cap at Med while `live_tenants == 1`. Multi-user race findings cap at Low while solo. Theoretical attacks on state that doesn't exist yet are not High.

### Time budget + finding cap
- **Time budget**: 180 min (3h, Chris-set 2026-08-27)
- **Finding cap**: 18 findings

Synthesis MUST surface only the top-18 most consequential findings. Remainder → "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: 188
- Sections: 12 (§0 + 11 numbered)
- [LOCKED] decisions: 14
- [DESIGN-OPEN] items: 0
- [OPEN] items: 0 (§10 marks plan build-ready)
- Plan-to-code ratio: ~188 plan : ~250–350 est code lines (2 edge fns + shared core + 1 migration + UI) — healthy, plan is not bigger than the fix.

### Layers touched
- UI / components (`Invoices.jsx`: local-only button, badge, delay notice)
- Data layer (invoice queries; QB `Invoice`/`Payment` reads)
- State model (new `qb_reflected_at` column; Paid transition rules)
- Migrations / schema (additive column, in command-suite-db)
- Edge functions / API routes (`qb-webhook` new, `qb-reflect-payments` new, `qb-record-payment` guarded)
- Cross-repo (command-suite-db owns the migration)
- External integrations (QuickBooks webhook receipt + REST reads; Intuit portal registration)
- RLS / auth (service-role write paths; webhook HMAC signature as sole public-endpoint auth)

### New mechanisms introduced
- New column: `invoices.qb_reflected_at` (timestamptz)
- New edge functions: `qb-webhook`, `qb-reflect-payments`
- New shared helper: `reflectInvoicesFromQB(tenantId, ids | "all-unpaid")` — invented by this plan
- New webhook subscription: Intuit Event Notifications (Invoice + Payment) + new secret `QB_WEBHOOK_VERIFIER_TOKEN`
- New cron: 15-min pg_cron sweep (Vault-keyed `net.http_post`)
- New UI: "Synced from QuickBooks" badge + delay notice

### Cross-system reach
- command-suite-db (migration authored + pushed there, single ledger)
- QuickBooks (webhook receipt + REST balance/payment reads)
- Intuit developer portal (external webhook registration — config, not code)
- pg_cron + Vault (service-role bypass write path into `invoices`)
- Stripe path (shares `qb-record-payment`; the one legitimate SC→QB payment write)

### Irreversibility
- Migration: additive column — reversible, ledger-coordinated in command-suite-db.
- Backfill: flips ~108 statuses to Paid; non-destructive (never-un-pay) and audit-tagged via `qb_reflected_at`, so traceable/reversible.
- Intuit portal webhook registration: external config, reversible.
- No breaking public API change.

### Known weak points
- **Balance==0 ≠ paid.** Credit memos / write-offs also zero a QB invoice's Balance with no real Payment → reflect core would flip to Paid and (no linked Payment) fall back to detection-time `paid_at`. Should a written-off invoice read as Paid? (§4.3a/§6/§7 — not addressed.)
- **Multiple / shared payments.** An invoice can have several linked Payments (progress + final); a Payment can link multiple invoices. "The linked Payment TxnDate" (§6) is under-specified for which one.
- **Webhook signature verification** is the *only* auth on a public endpoint (§4.3b). Raw-body vs parsed-body HMAC is a classic silent break — wrong and it either rejects everything or verifies nothing.
- **Service-role guard vs Stripe** (§4.2): the new `if !caller.isServiceRole → 403` must not break the `stripe-webhook → qb-record-payment` internal call. Verify that path actually authenticates as service-role at `stripe-webhook:173`.
- **Removed re-sync push** (§4.1, `Invoices.jsx:1965`): a locally-Paid invoice later synced to QB won't get its payment recorded there; reflect core skips it (already Paid in SC) → QB shows it unpaid indefinitely. Acceptable?
- **Partial payments** left looking unpaid (Sent/Past Due) in SC — v1 UX gap (§7).
- **Backfill of 108 in one run** vs QB rate limits + `IN`-query paging (§4.3a step 3, §4.4).
- **Retention/net-amount**: SC nets retainage; plan asserts QB `Balance==0` is ground truth (§7) — pressure whether QB retention handling can break that.

### Open questions
- Count: 0 (§10 marks the plan build-ready — all prior opens locked).
- Highest-pressure (not a formal open, but un-tracked): the write-off/credit-memo false-Paid edge above. Agents should decide if it needs a guard before build.

### Suggested attack angles (4 total)
1. **Reflect-core correctness & state model** — covers data layer, state model, business logic. Required reading: §4.3a, §6, §7, §3.4, `Invoices.jsx` status logic (`1916`, `1959–1990`), `qb-record-payment` guards. Pressure: Balance==0 false-positives (write-off/credit memo), multiple-payment TxnDate selection, never-un-pay invariant, retention/net mismatch, partial-payment handling, `qb_skip_sync`/archive skips.
2. **Webhook security & delivery** — covers edge functions, auth, external integration, real-time. Required reading: §4.3b, `_shared/tenantAuth.ts`, an existing edge fn for pattern. Pressure: HMAC raw-vs-parsed body, `intuit-signature` verification, realmId→tenant mapping (multi-realm), idempotency/duplicate delivery, Payment→LinkedTxn resolution, 200-fast vs inline work, reliance on sweep for missed pings.
3. **Migration / schema / cross-repo** — covers migrations, cross-repo, state model column. Required reading: §8, §4.4, command-suite-db conventions + CLAUDE.md migration rules. Pressure: additive-column correctness + single-ledger coordination, backfill data mutation on 108 live rows (reversibility, rate limits), CLAUDE.md column-ref update, `qb_reflected_at` population timing (must land with the reflect core).
4. **SC→QB removal, Stripe regression & UI** — covers UI/components, the two removed callers, Stripe coupling. Required reading: §4.1, §4.2, §5, `stripe-webhook:173`, `Invoices.jsx:1921/1965`, `tenantAuth.ts` isServiceRole semantics. Pressure: does the service-role guard break Stripe's internal call?; does removing the pushes strand any real flow (locally-Paid → QB unaware)?; local-only Mark-as-Paid + badge + delay-notice correctness and design-token compliance.

### Suggested agent count: 4

Rationale: 8 layers + non-empty cross-system reach + ≥3 novel mechanisms pushes the raw angle score past 5, but the surface groups cleanly into 4 coherent attack fronts; open questions are 0, so no dedicated uncertainty angle is needed — 4 over 5 avoids a redundant fifth agent, 4 over 3 keeps webhook-security separate from core-correctness (different failure classes).
