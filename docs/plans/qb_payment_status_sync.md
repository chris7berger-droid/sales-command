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
2. **"Mark as Paid" becomes local-only, and is gated to invoices QB won't reflect.** It sets SC `status = Paid` + `paid_at` and nothing else — no `qb-record-payment` call. Gate = **`!inv.qb_invoice_id || job.qb_skip_sync`** (audit R2 D1): a QB-linked invoice on a `qb_skip_sync` job (archive / pay-app-only — the exact case this clause names) is *never* reflected by the core, so without the `qb_skip_sync` half it would have **no path to Paid at all**. The gate must mirror the reflect-core skip set exactly, not approximate it. On invoices QB *does* own, the action is **hidden** [Chris's call, 2026-08-27] — implemented by filtering the actions array (§5), not CSS-hiding a still-callable item.
3. **`qb-record-payment` stays, but Stripe becomes its only caller.** Remove the two `Invoices.jsx` callers.
4. **Precedence guardrail:** the reader only ever flips **unpaid → Paid**, never Paid → unpaid. Enforced *structurally* as an atomic `UPDATE … WHERE id = $1 AND status <> 'Paid'`, not just by a read-then-write check. A local manual Paid is never stomped; a QB payment is never lost.
5. **[LOCKED: A1, ratified 2026-08-27] "Paid" requires a real QB Payment, not just a zero balance.** The reflect core flips to Paid only when the QB invoice has `Balance == 0` **and** a linked QB `Payment` transaction. A zero balance with no linked Payment (write-off, credit memo, bad-debt) is **not** flipped — it's left for a human. `paid_at` always comes from a real Payment; there is **no** detection-time fallback. Rationale: QB is the source of truth for *real payments*, not for *zero balances*; a write-off must never read as "collected."

---

## 4. Code deltas

### 4.1 Remove the backwards SC→QB payment pushes
- `src/pages/Invoices.jsx:1921` — drop the `qb-record-payment` invoke inside `updateStatus()` for the "Mark as Paid" action. Keep the local `status`/`paid_at` write.
- `src/pages/Invoices.jsx:1965` — drop the "if Paid, also record payment" push inside `handleQBSync()`. `handleQBSync` should sync the *invoice* only; payment reflection is the reader's job.
- `src/pages/Invoices.jsx:1983-1984` — in the **same edit**, remove the `paidNote` success toast (`" Payment also recorded."`). Once the push is gone that string lies (audit trailing-low). The sync-success toast should no longer claim a payment was recorded.
- Verify no other caller of `qb-record-payment` remains except `supabase/functions/stripe-webhook/index.ts:173`.
- **H2 [decided]:** "Sync to QuickBooks" (`handleQBSync`) on a **locally-Paid** invoice must **warn/block**, not silently push an unpaid invoice to QB that SC already thinks is paid. Surface a small confirm ("This invoice is marked Paid locally but has no QuickBooks payment — sync the invoice anyway?"). Keeps the two systems from quietly diverging.

### 4.2 `qb-record-payment` — scope to Stripe only [DERIVED]
- Function body unchanged except the guard below. It already tenant-binds and allows service-role internal calls (`_shared/tenantAuth.ts`). Once the two frontend callers are gone, Stripe is the sole caller.
- **Hard-reject non-service-role callers [LOCKED: yes].** Add an early guard: if `caller.isServiceRole` is false, return 403. Stripe calls in as service-role (verified: `stripe-webhook:173` → `_shared/tenantAuth.ts` service-role internal path — cleared blocker, the guard does **not** break Stripe); any app-side/user-JWT call is now impossible, so a stray or reintroduced frontend push can never double-record a payment in QB. Permanent belt over the "remove the two callers" suspenders. Mark the branch with a comment as an **intentional tripwire** (it's unreachable in normal flow and can't be smoke-tested — §9.4 — so a future reader won't mistake it for dead code and delete it).

**Design: one reflect core, two triggers.** Instant webhook is the everyday path; the 15-min sweep is the backup that can't lose anything. Both call the same core so they never drift.

### 4.3a Shared reflect core [DERIVED]
**Module boundary (audit D1):** the reflect core is an **imported `_shared/*.ts` module** — e.g. `supabase/functions/_shared/reflectPayments.ts` exporting `reflectInvoicesFromQB(sb, tenantId, qbInvoiceIds | "all-unpaid")`. It is **NOT** its own edge function / `--no-verify-jwt` route. If it were a public endpoint it would be an unauthenticated invoice-flipper callable with `(tenantId, ids)`. Both triggers (§4.3b webhook, §4.3c sweep) import and call it *after* their own auth gate passes; the core never faces the internet.

**Guard placement — ALL row-eligibility guards live in the core (audit R2 A1/A2, the load-bearing fix of round 2).** Every eligibility rule — `voided_at IS NULL`, `deleted_at IS NULL`, `tenant_id` scope, `qb_skip_sync`, and the A1 require-Payment rule — is enforced **inside `reflectInvoicesFromQB`, on both the candidate resolve and the final write**, never in a trigger's own query. The round-1 design left `voided_at/deleted_at` only in the sweep's step-2 SQL; the webhook passes ids straight to the core and would bypass it → a voided SC invoice (its QB invoice still live) could be resurrected to Paid by a later QB zero+Payment. Consolidating here makes that whole bug class ("webhook skips a sweep-only guard") impossible.

Per invocation:
1. Load `qb_connection` for the tenant → fresh access token (reuse the existing `getQBToken` pattern from `qb-record-payment` / `qb-sync-invoice`).
2. Resolve the candidate set — apply the SC-side eligibility filter **on both paths** (the specific `qb_invoice_id`s handed in by the webhook, OR all invoices for the sweep/backfill): `status <> 'Paid'` AND `status <> 'New'` AND `qb_invoice_id is not null` AND `deleted_at is null` AND `voided_at is null` AND `tenant_id = $tenantId`. The webhook does not skip this — its ids are filtered through the same query. *(Dropped the phantom `'Void'` literal — no invoice ever holds that status; void = `voided_at is not null`, already excluded. Audit adjacent.)* **Tenant scope (audit A2):** `AND tenant_id = $tenantId` matters because QB ids are realm-local — once a 2nd tenant onboards, a realm-A webhook must not flip tenant-B's same-numbered invoice.
3. Query QB in batches: `SELECT Id, Balance, LinkedTxn, DocNumber FROM Invoice WHERE Id IN ('...')` (QB `IN` + `MAXRESULTS 1000` paging). Targeted, never a full-table scan.
4. **`qb_skip_sync` filter (audit G1):** `qb_skip_sync` lives on **`call_log`, not `invoices`** — it cannot be in the step-2 SQL. Apply it as a **post-QB-read per-invoice join filter** (`invoice → proposal → call_log.qb_skip_sync`, and archive-unlinked), batched, mirroring `qb-record-payment:117` / `:123`. Skip those invoices.
5. **Flip rule (audit A1 — the core contract):** flip an invoice to Paid **only when** the QB invoice has `Balance == 0` **AND** at least one linked QB `Payment`. Parse `Balance` from its string form defensively. A zero balance with **no** linked Payment (write-off / credit memo / bad-debt) is **skipped, not flipped** (§3.5).
6. **`paid_at` (audit C1/C2):** QB SQL cannot filter `LinkedTxn.TxnId`, so read the invoice's `LinkedTxn`, fetch those `Payment` objects, and take `MAX(TxnDate)` across them (an invoice may have progress + final payments; a Payment may link several invoices). `Payment.TxnDate` is **date-only** — store it as **local noon** (`` `${txnDate}T12:00:00` ``), never a bare date cast into `timestamptz` (that lands on UTC-midnight → renders as the *prior* day in Pacific → month-boundary misstatement).
7. **Write:** atomic, guards repeated on the write so nothing slips between resolve and update (audit R2 A1/A2): `UPDATE invoices SET status='Paid', paid_at=<above>, qb_reflected_at=now() WHERE id=$1 AND status <> 'Paid' AND voided_at IS NULL AND deleted_at IS NULL AND tenant_id = $tenantId`. Never-un-pay is structural (§3.4); the voided/deleted/tenant predicates make resurrection and cross-tenant flips impossible even if a stale id reaches this line. Setting `qb_reflected_at` here powers the §5 badge — so the column MUST exist before this runs (see §11 step 1).

### 4.3b Instant webhook `qb-webhook` — PRIMARY, v1 [DERIVED]
New public edge function (deployed `--no-verify-jwt`) that receives Intuit **Event Notifications**.
1. **Register** the webhook URL in the Intuit developer portal; subscribe to **Invoice** (fires when balance changes on payment) and **Payment** entities.
2. **Verify** every request — mirror `stripe-webhook` exactly (audit D2/D3):
   - `const body = await req.text()` **before any parse** (HMAC is over the raw body).
   - HMAC-SHA256 the raw body with `QB_WEBHOOK_VERIFIER_TOKEN`; the `intuit-signature` header is **base64** (Stripe's is hex — don't copy the encoding blindly). **Base64-DECODE the header to raw bytes before `crypto.subtle.verify`** (audit R2 B2) — it needs bytes, not the base64 string; a builder mirroring Stripe's hex-decode would reject every ping.
   - Compare with `crypto.subtle.verify` / a constant-time check, **never `==`**.
   - **Fail closed:** if `QB_WEBHOOK_VERIFIER_TOKEN` is unset → `500`, reject all (mirror `stripe-webhook:67-70`). Never treat "no secret" as "signature valid."
   - This HMAC gate runs **before any DB read** — it is the sole auth on the public endpoint.
   - **CORS (audit R2 adjacent):** `qb-webhook` is a server-to-server endpoint — it must **NOT** inherit the `PREVIEW_ORIGINS` / exact-host CORS gating other edge fns use; Intuit is not a browser origin.
3. **Pre-200, do realm→tenant mapping ONLY.** Payload gives `realmId` + changed entity IDs (not full data). Map `realmId → tenant` via `qb_connection.realm_id`. **`realm_id` has no uniqueness constraint (audit E1):** handle 0 / 1 / many explicitly — `>1` rows → reject + log (ambiguous, don't guess a tenant); no match → drop with `200` (not our realm). **Do not resolve invoice ids here** — that needs a QB read.
4. **Ack fast, ALL QB work async (audit J1 + R2 B1):** return `200` immediately, then inside `EdgeRuntime.waitUntil(...)` do everything that touches QB — including resolving a Payment event's `LinkedTxn` → invoice ids (that's a QB read; leaving it pre-200 re-opens the ~3s Intuit-timeout/retry-storm J1 was meant to kill). Hand the core `(entityType, entityId, realmId)` and let it resolve ids after the ack. The 15-min sweep is the safety net if the async work fails.
5. Inside `waitUntil`, call the shared core `reflectInvoicesFromQB(sb, tenantId, {entityType, entityId})` (§4.3a) — it resolves ids, then applies every eligibility guard.
- **Idempotent, no dedup ledger needed (audit R2 adjacent):** re-delivered or duplicate pings just re-confirm Paid — the never-un-pay `UPDATE … WHERE status <> 'Paid'` makes repeats harmless, so no delivery-dedup table is required. A signature-bypass still can't forge Paid, because the core re-queries live QB `Balance` + Payment before flipping.

### 4.3c 15-min sweep `qb-reflect-payments` — BACKUP, v1 [DERIVED]
Thin scheduled edge function (deployed `--no-verify-jwt`) that imports the §4.3a core and calls `reflectInvoicesFromQB(sb, tenant, "all-unpaid")` for each tenant with a QB connection.

**Cron wiring — MIRROR migration `20260805223000` exactly (audit B1).** The original plan invented a service-role Vault secret / `app.settings.service_role_key` GUC that **does not exist and cannot be set on this managed project** (documented platform block; the sweep would never authenticate). The working, in-prod precedent is `follow-up-reminders-daily`:
- `pg_cron` → `net.http_post` with a **literal function URL** (`https://pbgvgjjuhnpsumnowuym.supabase.co/functions/v1/qb-reflect-payments`) — the URL isn't a secret.
- Header `x-cron-secret` = `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')` — the Vault secret that already exists (provisioned by `20260609120100`).
- Guard the schedule in `DO $$ … IF to_regclass('cron.job') IS NULL THEN RAISE NOTICE … RETURN; …` so it stays rehearsable; unschedule-if-exists before re-scheduling.
- The **`qb-reflect-payments` function verifies `x-cron-secret`** against its `CRON_SECRET` env as its gate (there is no service-role bearer). **`CRON_SECRET` is a project-global Supabase secret that already exists and already gates `follow-up-reminders` + `check-orphan-users` (audit R2 C1) — the new function INHERITS it. Do NOT `supabase secrets set CRON_SECRET`, or you silently 403 both existing jobs.** It already matches Vault `cron_secret`.
- **Every 15 min [LOCKED]:** cron `*/15 * * * *`. Negligible cost (~96 runs/day, a few hundred QB reads/day vs a ~500-req/min limit). Self-healing: a failed run or a webhook ping that never arrived is swept up next pass — nothing is ever silently lost. This is why the webhook can be "fire-and-forget" without risk.

### 4.4 Backfill = one sweep run [LOCKED principle]
No separate throwaway script. The one-time backlog cleanup is the §4.3c sweep run once across all linked unpaid invoices — same code path as the ongoing sync, so they can't drift. Expect it to resolve **the truly-paid subset of** the 108 (not all 108 — write-offs/credit-memo'd invoices are correctly left unflipped per A1).
- **Throttle (audit trailing-low):** the backfill fetches ~90+ invoices and then their linked Payments — serialize/throttle the QB reads against Intuit's ~500-req/min limit rather than firing them all at once.
- **Reversibility (corrected):** `qb_reflected_at` marks *which* rows the reflect core flipped, but it can't distinguish a correct flip from a wrong one — so "reversible" means *re-query QB per tagged row*, not a blind revert. (Corrects the round-1 manifest's overstatement.)

---

## 5. UI / UX [UI First-Class]

Current screen: `src/pages/Invoices.jsx` (list + detail modal). No layout restructure.

- **"Mark as Paid" action** — shown only when **`!inv.qb_invoice_id || job.qb_skip_sync`** (mirrors the reflect-core skip set; audit R2 D1). When QB owns the invoice, the action is **hidden** [Chris's call] by **filtering it out of the actions array at `Invoices.jsx:2005`** — not CSS-hiding a still-callable menu item (audit R2 D2). Same label/place for the invoices it does apply to; preserves the mental model.
- **Delay notice [LOCKED]:** show a small, quiet line on the Invoices screen — e.g. "Payment statuses sync automatically from QuickBooks — usually within seconds, up to 15 minutes at most." Instant is the norm (webhook); the notice just makes a rare lag read as "syncing," not "broken." Placement TBD (near the list header or status filter).
- **"Synced from QuickBooks" badge [LOCKED: add now].** On invoices the reflection flipped, show a small tag (e.g. a "QB" pill next to the Paid status) so Chris can tell a QB-reflected Paid from a manually-marked (local-only) Paid. Driven by the `qb_reflected_at` column (§8): non-null → show the badge. Follow the pill convention — **`C.dark` bg with `C.teal` text AND an explicit `border: C.teal`** (CLAUDE.md style rule 4; without the explicit border it falls back to `C.dark` → invisible border. Audit adjacent).
- No change to the Stripe-paid or send flows.

---

## 6. `paid_at` source [LOCKED: real QB Payment date; no fallback]

`paid_at` = `MAX(TxnDate)` across the invoice's linked QB `Payment` transactions, stored as **local noon** (§4.3a step 6). There is **no detection-time fallback**: under A1 (§3.5) an invoice with no linked Payment is never flipped, so there is never a Paid invoice without a real payment date. This keeps aging and "collected this month" honest — no fabricated dates, no write-offs counted as collected. (Resolves round-1 audit C1 + C2.)

---

## 7. Edge cases & guardrails

- **Never un-pay:** structural — atomic `UPDATE … WHERE status <> 'Paid'` (§3.4, §4.3a step 7).
- **Zero balance ≠ paid (A1):** write-offs / credit memos zero the balance with no Payment → **not** flipped (§3.5). This is the load-bearing guard.
- **Partial payments:** QB `Balance > 0 but < total` = partially paid. SC has no "partially paid" status. v1: only flip on `Balance == 0`; leave partials as-is. (Future: a partial indicator.)
- **Overpaid (`Balance < 0`):** a credit/overpayment leaves a negative balance; the `Balance == 0` rule never flips it. Documented v1 non-flip (audit R2 adjacent) — rare, left for a human, no silent misbehavior.
- **Stripe coupling:** keep `qb-record-payment` on the Stripe path. If a Stripe-paid invoice were Paid in SC but not recorded in QB, the reader would see `Balance > 0` — but §3.4 forbids un-paying, so it still wouldn't corrupt SC. The coupling keeps QB *complete*, not just safe.
- **Retention:** SC invoices net retainage; QB invoice totals may differ. Irrelevant to the reader — `Balance == 0` **plus a linked Payment** in QB is still ground truth for "fully paid." (Pressured in round 1, found sound.)
- **Token refresh / rate limits:** reuse existing `getQBToken`; batch the `IN` query; throttle the backfill (§4.4).
- **Voided / deleted:** excluded by the step-2 SC-side filter.
- **`qb_skip_sync` / archive-unlinked:** on `call_log`, not `invoices` — applied as a post-read join filter (§4.3a step 4), not in the candidate SQL.

---

## 8. Schema

**Add `invoices.qb_reflected_at timestamptz` [LOCKED].** Set by the reflect core (§4.3a step 7) whenever it flips an invoice to Paid; null on manually-marked or Stripe-paid rows. Powers the §5 "Synced from QuickBooks" badge + audit trail. Author in **command-suite-db** (single source of truth since 2026-06-29).

Ships **first** (build step 1) — the reflect core writes this column, and the backfill runs before the UI step, so if the column isn't there yet the reflect `UPDATE` throws `42703` for all 108 rows, or they flip untagged and the badge never shows for the backlog (audit F1). Migration requirements:
- **Timestamp** pinned `> 20260826120000` (after the latest ledger entry; audit adjacent).
- **Rehearse** it: `cd ~/command-suite-db && ./scripts/rehearse.sh <migration>` (global shared-DB rule). The additive column changes the grant count, so **bump `EXPECT_COLUMN_GRANTS` in `rehearse.sh:100` from 9004 → 9015 (+11, not +12 — `invoices` has its anon `SELECT` revoked, so the new column adds 11 grants, audit R2 precision) in the same PR** or rehearsal hard-fails. Pin the exact number; confirm by rehearsal, don't assume.
- Confirm `qb_reflected_at` is **NOT** added to `anon_hardened_allowlist.txt` — it's an internal-only badge field, never anon-exposed.
- Add the new column to the `invoices` column reference in `CLAUDE.md` in the same PR (currently unlisted; audit adjacent).

---

## 9. Rollout & smoke

1. Migration first (§8) — `qb_reflected_at`: rehearse (`EXPECT_COLUMN_GRANTS` 9004→9015) → **`db push` the column to the shared prod DB** → *then* the functions can deploy. "Rehearse" ≠ "push" (audit R2 precision): the column must actually be live in prod before any function writes it.
2. Ship code deltas (§4.1) + the shared reflect core (§4.3a) + both triggers (§4.3b webhook, §4.3c sweep) to a preview deploy. Deploy `qb-webhook` and `qb-reflect-payments` with `--no-verify-jwt`. Set **only** the new secret `QB_WEBHOOK_VERIFIER_TOKEN`. **Do NOT set `CRON_SECRET`** — it's project-global and already gates two live jobs; the new fn inherits it (audit R2 C1).
3. **Core smoke (sweep), before scheduling:** invoke the sweep once by hand; verify it flips a *known* QB-paid invoice (cross-check by querying QB directly by DocNumber — ground truth, never infer QB state from SC fields), does **not** touch a known-unpaid one, and **does not flip a zero-balance-but-written-off invoice** (the A1 guard — create/borrow one credit-memo'd invoice and confirm it stays unpaid).
4. **Webhook smoke:** register the URL in the Intuit portal; record a test payment in QB against a linked invoice; confirm the ping arrives, signature verifies (base64), and SC flips within seconds. Confirm a forged/badly-signed request is rejected, and that an unset verifier token fails closed.
5. Verify the "Mark as Paid" button no longer creates a QB payment (check QB — no new Payment txn); confirm it's gated off QB-linked invoices (H1).
6. Verify Stripe path still records a QB payment (regression on the one legitimate push). *Note: the §4.2 `!isServiceRole → 403` branch is unreachable in normal flow and can't be smoke-tested — it's an intentional tripwire, commented as such (audit adjacent).*
7. Only after smoke passes: schedule the pg_cron sweep (15 min) and run the throttled backfill (§4.4).
8. Re-count: QB-linked-unpaid should drop from 108 toward the true still-open set (write-offs correctly remain unflipped).

---

## 10. Open questions

**Resolved:**
- ~~`paid_at` source~~ → real QB Payment date (§6). [LOCKED]
- ~~Real-time vs. polling~~ → **both**: instant webhook primary + 15-min sweep backup, one shared reflect core (§4.3). Instant is the norm; the sweep guarantees nothing is ever lost. [LOCKED]
- ~~Sweep cadence~~ → 15 min (§4.3c). [LOCKED]

- ~~Hard-reject non-service-role callers of `qb-record-payment`~~ → **yes** (§4.2). [LOCKED]
- ~~"Synced from QuickBooks" badge + `qb_reflected_at` column~~ → **add now** (§5, §8). [LOCKED]
- ~~**A1** — does "Paid" mean zero balance, or a real payment?~~ → **real linked QB Payment required** (§3.5, §4.3a, §6). Ratified 2026-08-27. [LOCKED]
- ~~**H2** — Mark-Paid-then-Sync behavior~~ → **warn/block** Sync-to-QB on a locally-Paid invoice (§4.1). [LOCKED]
- ~~**D2 (R2)** — QB-linked "Mark as Paid": hide or warn?~~ → **hide** (filter actions array, §5). Ratified 2026-08-27. [LOCKED]

**Nothing open — plan is build-ready (rounds 1 + 2 folded in; converged, no round 3).**

---

## 11. Build order

1. **Migration first** — `qb_reflected_at` in command-suite-db (§8): rehearse (`EXPECT_COLUMN_GRANTS` 9004→9015) + `CLAUDE.md` column-ref updated in the same PR (audit F1), then **`db push` to prod** (rehearse ≠ push). Must be live before the reflect core so the flip write and backfill don't `42703`/flip-untagged.
2. Local-only "Mark as Paid" gated to `!qb_invoice_id || job.qb_skip_sync` (filter the actions array, §5) + remove the two SC→QB pushes + the lying toast (§4.1). Smallest, self-contained, immediately correct.
3. Shared reflect core `_shared/reflectPayments.ts` (§4.3a) — ALL eligibility guards live here (voided/deleted/tenant/skip-sync/require-Payment) + 15-min sweep fn with the mirrored cron wiring (§4.3c; inherits `CRON_SECRET`, doesn't set it). Smoke via the sweep incl. the write-off case (§9.3). This alone makes the system correct and honest.
4. Throttled backfill run (§4.4) + pg_cron schedule (§9.7). Backlog cleared (truly-paid subset) even before the webhook lands.
5. Instant webhook (§4.3b): `qb-webhook` fn (HMAC/base64/fail-closed, realm 0/1/many, async ack), verifier-token secret, Intuit portal registration, webhook smoke (§9.4). The "amazing UX" layer — real-time on top of an already-correct base.
6. "Synced from QuickBooks" badge (§5, explicit teal border) + delay notice (§5).

---

## Round 1 audit response (2026-08-27)

14 caused-by (2H/9M/3L) + 5 adjacent. Two suspected blockers cleared by the audit (Stripe service-role guard safe; `qb_connection.tenant_id`/`realm_id` reverse lookup workable — CLAUDE.md schema was stale). All folded into the plan below (adjacent items folded in-flow rather than deferred, per fix-when-found — they touch this same surface).

| # | Sev | Finding | Resolution |
|---|---|---|---|
| A1 | H | Balance==0 flips Paid with no real payment; fabricated `paid_at` | §3.5/§4.3a step 5 — **require a linked Payment**; no fallback (Chris ratified) |
| B1 | H | Cron wiring fabricated (no service-role Vault secret / GUC) | §4.3c — **mirror `20260805223000`**: literal URL + `x-cron-secret` from Vault `cron_secret` + `--no-verify-jwt` + `to_regclass` guard |
| C1 | M | `paid_at` unbuildable; QB SQL can't filter `LinkedTxn.TxnId` | §4.3a step 6 — read `Invoice.LinkedTxn` → fetch Payments → `MAX(TxnDate)` |
| C2 | M | date-only `TxnDate` into `timestamptz` → prior-day in Pacific | §4.3a step 6 — store **local noon** |
| D1 | M | reflect core as public route = unauth invoice-flipper | §4.3a — **imported `_shared/*.ts` module**, never a route |
| D2 | M | HMAC under-specified | §4.3b — `req.text()` pre-parse; **base64** sig; `crypto.subtle.verify` |
| D3 | M | missing verifier token posture | §4.3b — **fail closed** (mirror `stripe-webhook:67-70`) |
| E1 | M | `realm_id` not unique; `.maybeSingle()` throws | §4.3b — handle **0/1/many** explicitly |
| F1 | M | column ordered after its writer | §8/§11 — **migration is build step 1** |
| G1 | M | `qb_skip_sync` on `call_log`, not `invoices` | §4.3a step 4 — **post-read join filter** |
| H1 | M | local Mark-as-Paid ungated on QB invoices | §3.2/§5 — gate to `!qb_invoice_id` |
| H2 | M | Mark-Paid-then-Sync strands payment (unresolved) | §4.1 — **warn/block** Sync-to-QB on locally-Paid (Chris decided) |
| J1 | L-M | inline QB call risks Intuit ~3s timeout | §4.3b — ack 200, work in `EdgeRuntime.waitUntil` |
| I1 | M(proc) | rehearsal missing; `EXPECT_COLUMN_GRANTS` pin | §8 — rehearse + bump grants same PR; not in anon allowlist |
| Lows | L | lying toast · non-atomic flip · open cron trigger · unthrottled backfill | folded: §4.1 toast removal · §4.3a atomic UPDATE · §4.3c `x-cron-secret` · §4.4 throttle |
| Adj×5 | — | phantom Void · migration ts+doc-ref · reversibility wording · badge border · 403 tripwire comment | folded into §4.3a / §8 / §4.4-manifest / §5 / §4.2 |

**For Round 2 (targeted):** verify the A1 guard (no-Payment → no flip), the B1 cron mirror, and the D1 module boundary actually took. Do not re-find round-1 items.

---

## Round 2 audit response (2026-08-27)

**0 regressions — all round-1 fixes verified as taken** (A1 airtight, B1 verbatim, C1/C2, D1, D2/D3/E1, F1/G1/H1/H2/toast/badge/atomic/phantom-Void). Trend 14→11 findings, 2H→0H. 7 new caused-by (4M/3L) + 4 precision, all one theme: **guard placement** — the webhook bypassed sweep-only filters. Converged; audit recommends no round 3.

| # | Sev | Finding | Resolution |
|---|---|---|---|
| A1 | M | webhook can resurrect voided/deleted invoice to Paid (exclusion was sweep-only) | §4.3a — **all guards in the core**, on resolve + write (`voided_at/deleted_at IS NULL`) |
| A2 | L | core lookup not tenant-scoped (2nd-tenant realm cross-flip) | §4.3a step 2/7 — `AND tenant_id = $tenantId` |
| B1 | M | async-ack incomplete — `LinkedTxn` QB read still pre-200 | §4.3b step 3/4 — pre-200 = realm→tenant only; id resolution inside `waitUntil` |
| C1 | M | `CRON_SECRET` re-set would 403 two live jobs | §4.3c/§9.2/§11 — **inherit, never set**; only `QB_WEBHOOK_VERIFIER_TOKEN` is new |
| D1 | M | QB-linked + skip-sync invoice has no path to Paid | §3.2/§5 — gate = `!qb_invoice_id \|\| job.qb_skip_sync` (mirror skip set) |
| B2 | L-M | header base64 not decoded to bytes before verify | §4.3b step 2 — base64-**decode** before `crypto.subtle.verify` |
| D2 | L-M | "hide or warn" written 3 ways | §3.2/§5/§11 — **hide** (Chris); filter actions array at `2005`, not CSS |
| Adj×4 | — | grant +11→9015 · rehearse≠push · overpaid(<0) v1 gap · no-CORS/no-dedup notes | folded: §8 · §9.1/§11 · §7 · §4.3b |

**If a round 3 is ever run (not recommended):** confirm only that the guard consolidation (A1/A2) and the async-id-resolution (B1) landed. Otherwise: build.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-27. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a money-touching change that adds real new plumbing — two new background services that read QuickBooks, a database column, and a live webhook. It deserves a solid check: four reviewers, each on one risky area (the payment-reading logic, the webhook's security, the database migration, and the removal of the old "push to QuickBooks" buttons). Not a quick glance, but not a sprawling audit either.

### Round
- Plan type: feature
- Current round: 2 — **CONVERGED, folded, build-ready** (no round 3 recommended)
- Latest plan revision: pass 2 (this commit)
- Findings trend: round 1 (14, 2H) → round 2 (11, 0H) — both HIGHs closed & verified; converging, no plateau

### Prior rounds
- Round 1: `dde8441` · 14 caused-by (2H/9M/3L) + 5 adj · pattern: balance≠paid + wiring-drift → folded in `702baca` (revision pass 1)
- Round 2: `702baca` · 7 new caused-by (4M/3L) + 4 adj · pattern: core-guard-consolidation → folded this commit (revision pass 2)

**Briefing (if a round 3 is ever run — not recommended):** attack ONLY the guard-consolidation (R2 A1/A2) and async-id-resolution (R2 B1); do not re-find rounds 1–2.

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
- Backfill: flips the truly-paid subset of ~108 to Paid; non-destructive (never-un-pay) and audit-tagged via `qb_reflected_at`. Traceable, but "reversible" = re-query QB per tagged row (the tag marks *which* rows were flipped, not *whether* a flip was correct — round-1 correction).
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
