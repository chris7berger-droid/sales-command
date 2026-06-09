# T1 Security Remediation Plan — S6 / S7 / S8

**Date:** 2026-06-08
**Branch:** `plan/t1-security-remediation`
**ERD loop:** Loop #33 — working-security-issues
**Author:** Planning agent (Opus 4.7, 1M context)

## Scope statement

This plan covers **exactly three** T1 security criticals and **nothing else**:

- **S6** — `check-orphan-users` is unauthenticated + service-role + Resend send loop (audit finding **C2**, escalated to CRITICAL 2026-06-01).
- **S7** — `origin.endsWith(".vercel.app")` substring CORS allowance reflects attacker-controlled origins across the money/admin edge functions (audit **C1/A1**). Defense-in-depth ACAO hardening — **not** a keystone (round-1 correction: CORS gates no execution here; see §S7). Folds in the `http://localhost` CORS strip (audit **C17**) in the same pass.
- **S8** — `stripe-webhook` and `scc-stripe-webhook` lack `event.id` idempotency → replayable double-billing / subscription clobber (audit **C5/C6**).

Everything else in the 2026-06-01 audit (B-series RLS, C3/C4/C9-C20 except C17, D-series client gates, E/F-series) is **out of scope**. See §8. This is a PLAN ONLY — no code, migrations, or edge-function edits are made on this branch.

---

## §0 Reproduction / confirmation of current state

All three findings were re-verified against code **pulled fresh 2026-06-08**. Line numbers below are what I observed today, not what the 2026-06-01 audit claimed.

### S6 — `check-orphan-users` [VERIFIED — still vulnerable: YES]

File `supabase/functions/check-orphan-users/index.ts`, current code:

```ts
8:  serve(async (_req) => {
9:    try {
10:      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
11:
12:      const { data, error } = await supabase
13:        .rpc("get_orphan_auth_user_count");
...
23:      if (count > 0 && RESEND_API_KEY) {
24:        await fetch("https://api.resend.com/emails", { ... });
```

- No method check, no auth check, no `Origin`/CORS check, no rate limit. `_req` is ignored entirely.
- `supabase/config.toml` (full file is 16 lines) has **no `[functions.check-orphan-users]` block** — confirmed. Only `[functions.qb-auth]` (`verify_jwt = false`) and `[functions.send-proposal]` (`verify_jwt = true`) exist. With no entry, the function falls to the platform default.
- **Nuance vs audit:** the audit calls this "a permanent service-role RPC oracle." Verified that `get_orphan_auth_user_count()` (`supabase/migrations/20260520095500_s2_orphan_user_alarm.sql:7-20`) is `SECURITY DEFINER` with `EXECUTE` **revoked** from `anon`/`authenticated` and **granted only to `service_role`**. So an external caller cannot call the RPC directly — but the function invokes it with the service-role client internally, so every unauthenticated HTTP hit still: (a) executes the RPC under service role, (b) returns the orphan count to the caller (the "oracle" — a low-value integer), and (c) fires a Resend email + burns a function invocation when count > 0. The **DoS / Resend-quota-exhaustion / invocation-billing** abuse is real and is the primary risk. The "service-role oracle" framing overstates the data leak (one integer) but the availability/spend abuse stands.

### S7 — `.vercel.app` substring CORS [VERIFIED — still vulnerable: YES; list CORRECTED vs audit]

The CORS check is **inlined per-function** (no shared helper — `_shared/` contains only `tenantAuth.ts`, confirmed). Canonical shape:

```ts
const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];
const origin = req.headers.get("origin") || "";
const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app");
const allowedOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];
```

**Authoritative current list of functions using `origin.endsWith(".vercel.app")` in a CORS check (verified 2026-06-08 via `grep -rn "vercel.app" supabase/functions/`):**

| # | Function | CORS line | Also has `http://localhost` |
|---|----------|-----------|------------------------------|
| 1 | `qb-auth` | :17 | no |
| 2 | `qb-record-payment` | :76 | yes (`http://localhost:`) |
| 3 | `stripe-webhook` | :58 | no |
| 4 | `qb-search-customers` | :79 | yes (`http://localhost:`) |
| 5 | `invite-user` | :13 | no |
| 6 | `send-pay-app` | :69 | yes (`http://localhost` — no trailing colon) |
| 7 | `deactivate-user` | :12 | no |
| 8 | `scc-stripe-webhook` | :47 | no |
| 9 | `send-proposal` | :22 | no |
| 10 | `qb-sync-invoice` | :90 | yes (`http://localhost:`) |
| 11 | `qb-void-invoice` | :56 | yes (`http://localhost:`) |
| 12 | `send-invoice` | :15 | no |
| 13 | `qb-link-customer` | :79 | yes (`http://localhost:`) |
| 14 | `qb-create-job` | :124 | yes (`http://localhost:`) |
| 15 | `reset-password` | :22 | no |
| 16 | `deactivate-payment-link` | :13 | no |
| 17 | `proposal-signed` | :34 | no |
| 18 | `delete-user` | :12 | no |
| 19 | `extract-sov` | :80 | no |
| 20 | `create-billing-session` | :24 | no |

**S7 authoritative file count: 20 distinct functions** (rows 1–20 above; each is a distinct `supabase/functions/<name>/index.ts`). The audit's "~20 / all 20" is correct. The `grep` returns 21 lines total only because `send-proposal/index.ts` matches twice — once at the CORS check (:22) and once at a benign URL derivation (:122, see below).

**Important non-CORS match to NOT touch:** `send-proposal/index.ts:122` contains `SUPABASE_URL.replace('.supabase.co', '.vercel.app')` — this is a benign signing-URL derivation, **not** a CORS check. Do not alter it.

**`http://localhost` strip (audit C17): 7 functions verified** via `grep -rn "http://localhost" supabase/functions/`:
`qb-record-payment:76`, `qb-search-customers:79`, `send-pay-app:69`, `qb-link-customer:79`, `qb-void-invoice:56`, `qb-sync-invoice:90`, `qb-create-job:124`. Note `send-pay-app` uses `startsWith("http://localhost")` (no trailing colon); the other six use `"http://localhost:"`. All 7 are a subset of the 20.

### S8 — Stripe webhook idempotency [VERIFIED — still vulnerable: YES, both]

`supabase/functions/stripe-webhook/index.ts:86-87`:
```ts
const event = JSON.parse(body);
console.log("stripe-webhook event:", event.type, event.id);
if (event.type === "checkout.session.completed") { ... }
```
Signature IS verified (`verifyStripeSignature`, :80-84) before parsing — good. But `event.id` is only **logged**, never persisted/checked. A replayed (signature-valid) `checkout.session.completed` re-runs the invoice→Paid update + downstream `qb-record-payment` + receipt emails.

`supabase/functions/scc-stripe-webhook/index.ts:75-76`: same shape — `event.id` logged at :76, then `checkout.session.completed` / `customer.subscription.updated` / `customer.subscription.deleted` handlers run unconditionally. A replayed `customer.subscription.deleted` re-nulls `stripe_subscription_id` / re-flips `subscription_status`.

No `processed_stripe_events` table exists (no migration creates one — confirmed against `supabase/migrations/`).

**Verdict for all three: still vulnerable, matches audit intent, line numbers confirmed (S7 list corrected to an explicit 20-function table + the 7-function localhost subset).**

---

## §S6 plan — Gate `check-orphan-users`

**Goal:** make the function callable ONLY by the scheduled service-role invoker, with defense-in-depth at both the platform layer and the handler.

### Resolving the `verify_jwt` vs `--no-verify-jwt` tension [VERIFIED — this is the crux]

Project convention (memory: "Edge fns deploy with `--no-verify-jwt`") exists because most functions do their own auth via `_shared/tenantAuth.ts` and forward the caller JWT. **But `check-orphan-users` is different: it is a CRON target, not a user-facing function.** There is no user JWT to forward. Two layers, and they must not contradict:

1. **Platform layer — `supabase/config.toml`:** add
   ```toml
   [functions.check-orphan-users]
   enabled = true
   verify_jwt = true
   ```
   This makes the platform reject any request without a valid JWT (or the service-role key as Bearer). A pg_cron / scheduled job invokes with the service-role key in the `Authorization: Bearer` header, which satisfies `verify_jwt = true`. **Therefore deploy this function WITHOUT `--no-verify-jwt`** (i.e. let config.toml's `verify_jwt = true` stand). This is the one function where the project's default `--no-verify-jwt` deploy convention is deliberately overridden. **[DERIVED]** — the convention override is sound but must be explicitly called out in the deploy command (see below) so the build terminal does not blindly apply `--no-verify-jwt`.

2. **Handler layer — timing-safe `CRON_SECRET` header [LOCKED — the sole real gate]:** `verify_jwt = true` admits **any** valid JWT — i.e. every authenticated tenant user, not just the cron. The platform gate alone is therefore NOT sufficient to distinguish the scheduled invoker from a logged-in user. **`CRON_SECRET` is the SOLE real gate.** Add a shared-secret check at the very top of the handler:
   ```ts
   import { timingSafeEqual } from "https://deno.land/std@0.168.0/crypto/timing_safe_equal.ts";

   const CRON_SECRET = Deno.env.get("CRON_SECRET");
   const enc = new TextEncoder();
   serve(async (req) => {
     if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
     const a = enc.encode(req.headers.get("x-cron-secret") || "");
     const b = enc.encode(CRON_SECRET || "");
     // explicit length guard FIRST — timingSafeEqual requires equal-length views (throws otherwise)
     if (!CRON_SECRET || a.length !== b.length || !timingSafeEqual(a, b)) {
       return new Response("Forbidden", { status: 403 });
     }
     ... existing body ...
   });
   ```
   - **Timing-safe compare [LOCKED]:** use `timingSafeEqual` from `https://deno.land/std@0.168.0/crypto/timing_safe_equal.ts` over **`TextEncoder`-encoded byte arrays** — NOT `===` and NOT "Web Crypto `crypto.subtle`". The std helper **requires equal-length views and throws on a length mismatch**, so guard length explicitly first (`a.length !== b.length → 403`) and only call `timingSafeEqual` on equal-length arrays. The length check leaks only the length of a wrong guess, not its bytes — acceptable. Pin `@0.168.0` to match the repo's other std imports.

### Secret provisioning

```bash
# generate a strong secret (build terminal):
openssl rand -hex 32
# set it as a function secret:
supabase secrets set CRON_SECRET=<generated> --project-ref pbgvgjjuhnpsumnowuym
```
`CRON_SECRET` is then available via `Deno.env.get("CRON_SECRET")` in the function.

### Scheduled invoker passes the secret [LOCKED — invoker identified in-repo]

The invoker **is** in-repo (round-0 "[OPEN] not visible" was wrong — deleted): `supabase/migrations/20260520095500_s2_orphan_user_alarm.sql:27-40` schedules a daily `pg_cron` job (`'check-orphan-users-daily'`, `0 6 * * *`) that calls `net.http_post` to `/functions/v1/check-orphan-users` with `Authorization: Bearer <current_setting('app.settings.service_role_key')>` and **no `x-cron-secret`**.

**The build adds the `x-cron-secret` header to that `net.http_post` call, reading the secret from a Postgres GUC the same way the Bearer reads the service-role key:**

```sql
-- in the rescheduled cron body:
headers := jsonb_build_object(
  'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
  'Content-Type',  'application/json',
  'x-cron-secret', current_setting('app.settings.cron_secret', TRUE)   -- NEW — missing_ok=TRUE
),
```

- **Use the two-arg `current_setting(..., TRUE)` (missing_ok) form [round-2 correction — HIGH].** The one-arg `current_setting('app.settings.cron_secret')` **raises** if the GUC is unset, and because it executes inside the cron job body that error aborts the **entire** `net.http_post` statement → the daily alarm silently stops firing (a real outage, not a 403). The two-arg form returns NULL instead of raising. NULL still means the function will 403 the call (no valid secret), so the missing_ok form must be paired with **provisioning the GUC out-of-band FIRST** (see §6 step 3) — the form prevents the cron from *crashing*; the provisioning is what makes the secret *present*.
- The cron job is already applied to prod, so editing the old migration file does nothing. The build needs a **new migration** that `cron.unschedule('check-orphan-users-daily')` then re-`cron.schedule(...)` with the added header (or `cron.alter_job`). [DERIVED — unschedule+reschedule vs `alter_job` is a build-time pick.]
- **One secret, two stores:** the same value must live in BOTH (a) the function env — `supabase secrets set CRON_SECRET=<v>` (read via `Deno.env.get`), AND (b) the DB GUC `app.settings.cron_secret` — set via `ALTER DATABASE postgres SET app.settings.cron_secret = '<v>'` (or Vault), the same provisioning slot as `app.settings.service_role_key`. A mismatch = 403 = silent alarm outage.

### Deploy + smoke

```bash
# deploy WITHOUT --no-verify-jwt so config.toml verify_jwt=true is honored:
supabase functions deploy check-orphan-users --project-ref pbgvgjjuhnpsumnowuym
# (intentionally NOT --no-verify-jwt — see tension resolution above)
```
**Before deploying, verify no deploy wrapper injects `--no-verify-jwt`.** Check `package.json` scripts, any `scripts/deploy*.sh`, and CI for a blanket `functions deploy ... --no-verify-jwt` that would silently override `config.toml`. If one exists, this function must be exempted. Smoke #1 (the 401) is the proof the platform gate actually took.

**Lockstep order** (§6 step 3, reschedule-before-gate): provision the secret in both stores + smoke the GUC → **push the cron-reschedule migration** (cron now carries `x-cron-secret`; the still-ungated function ignores it) → **deploy the gated function** → smoke. Doing it in this order means the cron already sends the header before the function starts checking it, so there is **no window** where the live cron is 403'd.

Smoke:
1. **Negative — PROVES `verify_jwt` took:** `curl -X POST <fn-url>` with no auth header → expect **401** (platform JWT gate). If this returns 2xx/403, `verify_jwt` did NOT take (a wrapper injected `--no-verify-jwt`) — stop and fix before proceeding.
2. **Negative:** call with service-role Bearer but no `x-cron-secret` → expect **403** — confirms the handler gate (the SOLE real gate).
3. **Positive:** call with service-role Bearer + correct `x-cron-secret` → expect 200 `{ orphan_count: N }` and (if N>0) exactly one Resend email to the TEST recipient. **Temporarily point `to:` at a test address, or run when orphan_count is known 0, to avoid spamming Chris's inbox.** [Edge Fn Post-Deploy Smoke memory: verify side effects, not just exit 0.]
4. **Cron end-to-end:** after both the GUC and the reschedule migration land, confirm the `pg_cron` job still 200s — query `cron.job_run_details` for the next run, or invoke the cron body manually.

---

## §S7 plan — Exact-host CORS allowlist (defense-in-depth ACAO hardening)

### Threat-model reframe [LOCKED — round-1 correction]

Round-0 framed S7 as a "keystone" that de-fangs C10/C12/role-gate findings. **That is wrong and is removed.** CORS does **not** gate execution here: no function rejects a request based on `Origin` (the value is only echoed into `Access-Control-Allow-Origin`), none of the 20 set `Access-Control-Allow-Credentials: true`, and all auth is **header-based** (Bearer JWT / Stripe signature / `x-cron-secret`), not cookie/ambient. A browser's CORS block stops the *attacker's JS from reading the response*, but the request still executes server-side, and a cross-origin `fetch` without credentials never carries the victim's JWT to begin with. So fixing the substring match closes **none** of the auth findings; it is **defense-in-depth ACAO hardening** — stop reflecting an attacker-controlled origin, shrink the response-leak-to-attacker-page surface, remove the misleading "we trust `*.vercel.app`" signal. Real value, modest severity. **Nuance:** `reset-password` is the one function where the caller's `Origin` *does* steer behavior — it chooses the password-reset email's redirect host + branding — but even there `Origin` only *steers* output, it never *rejects* a request; that is an Origin-trust issue (C12 / **ADJ-2**), not a CORS execution gate, and S7 does not touch it. The de-fang claims are deleted (see §8 + BACKLOG ADJ-2/ADJ-3).

### Design: where the allowlist lives, and how previews get tested

The hole is `|| origin.endsWith(".vercel.app")`. The fix replaces it with an **exact-host allowlist**; preview/Vercel deploys are tested **without** any origin-substring trust.

**Allowlist source [DERIVED]:** keep the existing `ALLOWED_ORIGINS` constant as the canonical production allowlist (already identical across all 20 functions: `salescommand.app`, `www.salescommand.app`, `scmybiz.com`, `www.scmybiz.com`). For preview testing, add **specific, pinned** Vercel preview hostnames to an env-driven extension rather than a substring match:
- Read an optional `PREVIEW_ORIGINS` function secret (comma-separated exact hosts) and union it into the allowlist. Empty/unset in prod. This lets Chris pin a known preview URL for a testing window, then clear it — **no open `*.vercel.app` wildcard ever ships.**
- The new check becomes:
  ```ts
  const previewOrigins = (Deno.env.get("PREVIEW_ORIGINS") || "")
    .split(",").map(s => s.trim()).filter(Boolean);    // empty/unset → [] (NOT [""])
  const allowlist = [...ALLOWED_ORIGINS, ...previewOrigins];
  const isAllowed = origin !== "" && allowlist.includes(origin);   // empty Origin never matches
  ```
  **Two parsing traps to avoid:** (1) `"".split(",")` returns `[""]`, so without `.filter(Boolean)` an unset `PREVIEW_ORIGINS` injects an empty string into the allowlist; (2) a request with **no** `Origin` header (`origin === ""`) must short-circuit to disallowed, else a stray empty entry would treat origin-less requests as allowed. Both closed above.
- **`PREVIEW_ORIGINS` entries must be full origins (`https://host`), not bare hosts.** `allowlist.includes(origin)` compares against the browser's `Origin` header, which is always `scheme://host[:port]` with **no trailing slash**. A bare `my-preview.vercel.app`, a trailing slash `https://my-preview.vercel.app/`, or an `http://` typo will **silently never match** (no error — the preview just stays blocked). Document the exact-origin format where the secret is set.

**Server-side token alternative (preferred long-term, [OPEN]):** preview environments could authenticate with a server-side token rather than origin matching at all. That is a larger change; for THIS remediation the pinned-`PREVIEW_ORIGINS` approach is the minimal correct fix. **[OPEN]** — Chris to confirm he's OK losing ad-hoc `*.vercel.app` preview CORS and pinning hosts via `PREVIEW_ORIGINS` when needed.

### Centralize vs edit-each [DERIVED → recommend centralize]

There is **no** shared CORS helper today; the block is copy-pasted in all 20 functions with minor drift (different `Access-Control-Allow-Headers` for the two webhooks; different localhost variants). **Recommendation: create `supabase/functions/_shared/cors.ts`** exporting a single `resolveCors(req)` (or `corsHeaders(req)`) helper that:
- computes `isAllowed` from the exact allowlist (+ optional `PREVIEW_ORIGINS`),
- returns `{ allowedOrigin, corsHeaders }`,
- accepts a per-function `extraAllowHeaders` arg so the two webhooks can add `stripe-signature`.

Then edit each of the 20 functions to import and call it, deleting the inline `ALLOWED_ORIGINS` + `isAllowed` + `endsWith(".vercel.app")` + any `startsWith("http://localhost...")`. This both fixes S7 and folds in C17 (localhost strip) in one mechanical pass, and prevents future drift.

**Trade-off:** centralizing touches all 20 functions' imports AND adds a new `_shared` file → all 20 must be redeployed. Editing-in-place also touches all 20. Centralizing is the same blast radius with less long-term drift, so it wins. **[DERIVED]** — if the build terminal judges the import churn too risky to land atomically, the fallback is an in-place edit of each function (drop the `endsWith`/`startsWith` clauses, keep `ALLOWED_ORIGINS`). Either way the **behavioral** change is identical: exact-match only.

### `http://localhost` strip (C17)

Remove `|| origin.startsWith("http://localhost...")` from the 7 functions listed in §0. Under the centralized helper this disappears automatically (helper does exact-match only). If local dev needs localhost CORS, gate it behind a `DEV`/`PREVIEW_ORIGINS` entry (e.g. add `http://localhost:5173` to `PREVIEW_ORIGINS` locally), never hardcoded in prod.

### Authoritative file list to change (20)

`qb-auth`, `qb-record-payment`, `stripe-webhook`, `qb-search-customers`, `invite-user`, `send-pay-app`, `deactivate-user`, `scc-stripe-webhook`, `send-proposal`, `qb-sync-invoice`, `qb-void-invoice`, `send-invoice`, `qb-link-customer`, `qb-create-job`, `reset-password`, `deactivate-payment-link`, `proposal-signed`, `delete-user`, `extract-sov`, `create-billing-session`.
Plus, if centralizing: new file `supabase/functions/_shared/cors.ts`.

### Ordering / blast-radius [LOCKED — corrected]

S7 is **not** a keystone and gates no other finding's execution (see Threat-model reframe). It is independent ACAO hardening. It does **not** make C10, C12, or any role-gate finding unreachable — those are reachable today by direct server-to-server calls regardless of CORS, and remain fully open (C12 → ADJ-2). Sequencing S7 first is still convenient (self-contained, edge-function-only, no DB) but carries **no** risk-reduction-for-other-findings rationale. See §6.

### Rollout / rollback

- **Rollout:** deploy all 20 functions in one batch (`--no-verify-jwt` per project convention for these — they do their own auth/are webhooks). The two stripe webhooks receive **only** the CORS edit in this batch — their S8 dedupe code ships in a **separate, later** deploy gated on the S8 migration (see §6). The two webhooks must KEEP `stripe-signature` in their allow-headers (pass `extraAllowHeaders`).
- **Rollback:** if a legitimate production origin breaks (e.g. a real Vercel preview Chris was actively using), re-add that exact host to `ALLOWED_ORIGINS` or `PREVIEW_ORIGINS` — do NOT re-introduce the substring. Keep the prior function versions noted so a redeploy of the old bundle is possible if a helper bug surfaces.

### Per-function smoke

1. From an allowed prod origin (`https://www.scmybiz.com`): exercise one representative call per function class (a `send-*`, a `qb-*`, a webhook OPTIONS preflight) → expect `Access-Control-Allow-Origin` echoes the prod origin and the call succeeds.
2. **Disallowed origin — must use a real browser, not curl.** `curl` ignores `Access-Control-Allow-Origin` (CORS is browser-enforced), so a curl that "succeeds" proves nothing. From a page on a non-allowlisted host (open devtools on any `https://*.vercel.app` you don't own, or a scratch `https://example.com` tab) run `fetch("<fn-url>", { method: "POST" })` and confirm the **browser blocks** it with a CORS error and the response header is `Access-Control-Allow-Origin: https://salescommand.app` (the `ALLOWED_ORIGINS[0]` fallback, NOT the caller origin). Header inspection via curl is fine to confirm the *fallback echo*; it's the *enforcement* that needs a browser.
3. **Webhooks:** confirm Stripe can still deliver. Stripe does NOT send an `Origin` header (server-to-server), so CORS never blocks it — verify a test event still 200s. The CORS change must not affect signature verification.
4. Confirm the live app (logged in on `www.scmybiz.com`) can still send invoices, sync QB, etc. — full money-path regression.

---

## §S8 plan — `processed_stripe_events` idempotency

### Table DDL [LOCKED — two-phase status]

A bare insert-claim is NOT enough: if the webhook crashes *after* claiming the PK but *before* finishing the side effects, a naive "row exists → skip" would turn Stripe's retry into a no-op and the payment would be **silently lost**. The table therefore carries a **`status`** column and the handler uses a **two-phase `claimed → done`** protocol (below). `tenant_id` is **nullable, no default, left NULL** — the `event_id` PK is the sole dedupe mechanism; the RLS SELECT policy below is **decorative** (service role, the only reader/writer here, bypasses RLS).

```sql
CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  event_id   text PRIMARY KEY,        -- Stripe event.id — dedupe key; wins the concurrency race
  event_type text,
  source     text NOT NULL,           -- 'stripe-webhook' | 'scc-stripe-webhook'
  status     text NOT NULL DEFAULT 'claimed',   -- 'claimed' (in-flight) | 'done' (fully processed)
  tenant_id  uuid REFERENCES public.tenant_config(id),  -- nullable, left NULL; PK is the dedupe mechanism
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;

-- DECORATIVE: service role (the only writer/reader here) bypasses RLS. Kept for convention only.
DROP POLICY IF EXISTS processed_stripe_events_select ON public.processed_stripe_events;
CREATE POLICY processed_stripe_events_select ON public.processed_stripe_events
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());
-- No authenticated INSERT/UPDATE/DELETE policies: only the webhooks (service role) write here.
```

`updated_at` is included because the row IS mutated once (`claimed` → `done`); the handler sets it explicitly on the status update, so no `set_updated_at` trigger is strictly required (add the standard trigger only if a sibling-table convention demands it). **[DERIVED]**

### Migration filename — collision check required [OPEN on exact timestamp only]

Latest migration in `supabase/migrations/` is **`20260601120000_invoices_retention_release.sql`** (verified). The next free timestamp is chosen at build time, AFTER the collision check, because project `pbgvgjjuhnpsumnowuym` is **shared** with sch-command/field-command and a sibling repo may have pushed a later timestamp.

- **Do NOT invent a real timestamp here.** Working name only: `<next-free>_s8_processed_stripe_events.sql` — resolve via `npm run db:push`'s collision check (`scripts/check-migration-collision.mjs`) + `scripts/check-migration-safety.sh` per CLAUDE.md "Pushing Migrations".
- Run `scripts/check-migration-safety.sh` **before** `supabase db push` (pre-push hook enforces it).
- New table with RLS → honor the CLAUDE_RLS.md 6-gate deploy pattern. The policy is a plain `tenant_id = get_user_tenant_id()` authenticated SELECT — it does NOT match the 2026-04-26 anon `USING(true)` anti-pattern (no anon role touched), so it is conformant. **[VERIFIED against CLAUDE_RLS.md anti-pattern.]**

### Handler logic — two-phase claim → done [LOCKED]

Identical shape in both webhooks:

1. **Verify Stripe signature first** (already present — keep it first; an unsigned event must never touch the table).
2. **CLAIM** — at the very top of business processing, BEFORE any side effect, `INSERT ... status='claimed'`:
   - **PK conflict (`23505`)** → a row already exists for this `event.id`. **Read its `status`:**
     - `status = 'done'` → genuine duplicate of a fully-processed event → **return 200 `{ duplicate: true }`, do nothing.**
     - `status = 'claimed'` → a prior delivery claimed but did **not** finish (crash, timeout, or a still-in-flight concurrent delivery). **Do NOT short-circuit — re-process.** Stripe's at-least-once retry is doing its job. This is the crash-safe path: a stuck `claimed` row never permanently blocks a payment.
   - **No conflict** → we own the claim → proceed.
3. **PROCESS** — run the existing business logic (invoice → Paid, `qb-record-payment`, receipts / subscription updates).
4. **DONE** — mark `status='done'` immediately before **every 2xx return** — the success path AND any **no-op exit** (an unhandled event type, or a handled branch that does nothing, e.g. scc's non-subscription checkout). This is what stops no-op deliveries from stranding as permanent `'claimed'` rows.
5. **Leave `'claimed'` on every error (non-2xx) return.** A 4xx/5xx means the event was NOT fully handled and you WANT Stripe to retry — the `'claimed'` row is exactly what permits the retry to re-process. **Rule: 2xx ⇒ set `done`; 4xx/5xx ⇒ leave `claimed`.**

```ts
// after signature verification; `supabase` = service-role client hoisted to top of handler:
const claim = await supabase
  .from("processed_stripe_events")
  .insert({ event_id: event.id, event_type: event.type, source: "stripe-webhook" /* or scc- */, status: "claimed" });

if (claim.error) {
  if (claim.error.code === "23505") {
    const { data: existing } = await supabase
      .from("processed_stripe_events")
      .select("status").eq("event_id", event.id).single();
    if (existing?.status === "done") {
      return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
    }
    // 'claimed' (or unreadable): a prior attempt didn't finish → fall through and RE-PROCESS.
    console.log("Re-processing previously-claimed Stripe event:", event.id);
  } else {
    console.error("Claim insert failed:", claim.error.message);
    return new Response("Claim error", { status: 500 });   // Stripe retries
  }
}

// helper called before EVERY 2xx return (success AND no-op exits):
const markDone = () => supabase
  .from("processed_stripe_events")
  .update({ status: "done", updated_at: new Date().toISOString() })
  .eq("event_id", event.id);

// ... existing business logic ...
await markDone();
return new Response(JSON.stringify({ received: true }), { status: 200 });
// NOTE: also `await markDone()` before any *no-op* 2xx return (unhandled type;
// scc non-subscription checkout at :85). Do NOT markDone before a 4xx/5xx — leave
// 'claimed' so Stripe retries. (markDone before a 2xx, never before an error.)
```

Per-webhook placement (verified against current code 2026-06-09):
- **`stripe-webhook`** — the `supabase` client is created *inside* the `checkout.session.completed` branch (`:104`), and that branch has its own early returns (`:101` → `400` no `invoice_id`; `:119` → `500` invoice-update failed). **Hoist a top-level service-role client** (above the `:89` branch) so the CLAIM runs before any branch. Then `markDone()` before the success 200; if a delivered event matches no branch (falls through to the final 200), `markDone()` before that too. Leave `'claimed'` on the `:101`/`:119` error returns so Stripe retries.
- **`scc-stripe-webhook` [round-2 correction]** — the client is already at `:78`; CLAIM right after it. There is **no** generic unhandled-type early return: the `:85` return is the **non-subscription-mode** case *inside* the `checkout.session.completed` branch (`session.mode !== "subscription"`), and the handler is a series of independent `if (event.type === …)` blocks. So CLAIM at top, then `markDone()` before the `:85` non-subscription 200, before the final fall-through 200 (covers unhandled types), and after each handled subscription branch. Every 2xx exit calls `markDone()`; nothing strands as a permanent `'claimed'` row. (The prior round-2 text "CLAIM at :77 before the early return for unhandled types" was wrong — there is no such return; corrected here.)
- **General rule (both):** `markDone()` before every 2xx; never before a 4xx/5xx.
- The `claimed → re-process` branch is **fail-safe, not fail-silent** — it matches CLAUDE.md Data Integrity Rule 6 (a crash mid-process must not silently drop a payment).
- `tenant_id` stays **NULL** — do not attempt to populate it; the PK is the dedupe mechanism.

> **[Round-2 amendment — S8 narrows but does NOT close the money-double]**
> The `claimed → re-process` branch is **not free**: by design it **actively re-runs** the (non-idempotent) `qb-record-payment` + invoice-Paid + receipt side effects whenever a `'claimed'` row is seen. Two windows produce this:
> - **(a) Concurrent duplicate delivery** — two deliveries of the same `event.id` race; delivery 2 gets the `23505`, reads `status='claimed'` (delivery 1 not yet `done`), and re-processes **in parallel** → double `qb-record-payment`.
> - **(b) DONE-update failure after successful side effects** — the side effects commit but the `markDone()` UPDATE fails (DB hiccup); the row stays `'claimed'`, and Stripe's next retry re-processes → double `qb-record-payment`.
>
> So S8 converts a **silent lost payment** (the old insert-first-skip design) into an **at-least-once** guarantee: it **narrows** the double-billing window but does **NOT** close it. The money-double is neutralized **only by ADJ-1** (make `qb-record-payment` idempotent — guard on existing `qb_payment_id` / dedupe by Stripe payment id). ADJ-1 is filed and is **next loop**, not this one. **Do not read S8 as closing double-billing.**

### Smoke

1. Apply migration (`npm run db:push`); confirm `processed_stripe_events` exists with PK on `event_id` and a `status` column defaulting `'claimed'`.
2. Deploy both webhooks **in a separate batch from S7, gated on the migration having landed** (see §6). `--no-verify-jwt`; keep the `stripe-signature` allow-header from the S7 change.
3. **First delivery:** `stripe trigger checkout.session.completed` (or replay a real event id) → processes normally; row appears and ends at `status='done'`.
4. **Replay the SAME event id** → expect 200 `{ duplicate: true }`, NO second invoice update, NO second `qb-record-payment`, NO second receipt. Side-effect tables unchanged (`paid_at` not rewritten, `qb_payment_id` not duplicated).
5. **Crash-safety check:** manually INSERT a row with `status='claimed'` for a test event id, then deliver that event → confirm it **does** process (not skipped), proving a stuck claim never blocks a real payment.
6. **`scc-stripe-webhook`:** replay `customer.subscription.deleted` → confirm a replay does NOT re-null an active subscription. Also deliver an **unhandled event type** and the **non-subscription checkout** (`:85`) path → confirm each ends at `status='done'` (no stranded `'claimed'` row).
7. **Double-billing window (disclosure check, not a fix):** confirm — via two near-simultaneous deliveries of one `event.id` — that the plan's claim about window (a) holds (both can re-process). This is expected and out of scope (ADJ-1); the smoke documents it, it does not assert it's closed.

---

## §6 Sequencing

Recommended build order, with rationale:

1. **S7 first.** Self-contained (edge-function-only, no DB), so a CORS regression is isolated before money paths are touched. **No** "de-fangs other findings" rationale — that claim was wrong (§S7 reframe); S7 is sequenced first only for blast-radius isolation. The two stripe webhooks get their **CORS edit only** in this batch.
2. **S8 second, in TWO ordered steps (resolves the round-0 §6 contradiction):**
   - **2a. Migration first** — push `processed_stripe_events` (`npm run db:push` + safety/collision check), confirm it landed in prod. Nothing references the table yet, so it ships safely alone.
   - **2b. Webhook dedupe code second, as a SEPARATE deploy** — only after 2a, deploy the two webhooks' claim→done logic. This is **distinct** from the S7 CORS batch in step 1; do NOT fold the dedupe code into the S7 webhook deploy, because it would 500 on every event until the table exists. (Round-0 said both "ride the same deploy window" *and* "migration before code" — contradictory. Resolved: CORS-only in step 1's batch; dedupe in its own post-migration deploy.)
3. **S6 independent.** Different function, no shared files; ships any time. **Internal lockstep — strictly ordered. RESCHEDULE-BEFORE-GATE is deliberate (round-2 self-review): it leaves no window where the live cron is rejected.**
   1. **Provision both secret stores OUT-OF-BAND FIRST, then smoke the GUC.** `supabase secrets set CRON_SECRET=<v>` (function env) AND `ALTER DATABASE postgres SET app.settings.cron_secret='<v>'` (DB GUC). **Gate:** `SELECT current_setting('app.settings.cron_secret', TRUE)` must return `<v>` (not NULL) before proceeding. Skipping this ships a NULL/empty `x-cron-secret` header → the function 403s every run → silent alarm outage.
   2. **Push the cron-reschedule migration** (adds `x-cron-secret` via the `current_setting(..., TRUE)` missing_ok form so a GUC gap can never abort the whole cron statement). The function is **still ungated** here, so it simply ignores the new header and keeps returning 200 — no missed run.
   3. **Deploy the gated function** (`verify_jwt=true` + handler `CRON_SECRET` check). The cron already carries the matching header, so gating closes the vulnerability with **no 403 window**.
   4. **Smoke** 401 / 403 / 200 + cron end-to-end run.

   *Why not gate-then-reschedule?* If the function is gated before the cron carries the header, the old cron (Bearer only) is rejected until the reschedule lands — a 6am-UTC run in that gap is silently missed. Reschedule-first has no such window and adds no exposure (the function stays exactly as vulnerable as today until step 3, then closes cleanly). The invoker is known (§S6), so S6 is **no longer blocked on an [OPEN]**.

**Shares a deploy:** nothing across findings — S7's webhook batch is CORS-only; S8's dedupe is its own deploy. **Hard orderings:** S8 migration (2a) before S8 code (2b); **S6 GUC-provisioned-and-smoked (3.1) before the cron-reschedule (3.2) before the function gate (3.3).**

---

## §7 Risk / what could go wrong

- **S6 — breaking the legitimate orphan alarm.** If the function gate (`verify_jwt=true` + `CRON_SECRET`) lands before the cron-reschedule migration adds `x-cron-secret`, the daily alarm 403s silently. Mitigation: the lockstep order in §6 step 3 (secret in both stores → gated function → cron-reschedule → smoke); smoke #4 asserts the cron still 200s. The invoker is known (`...s2_orphan_user_alarm.sql:27-40`), so this is sequencing discipline, not an open question.
- **S6 — CRON_SECRET rotation / two-store drift.** The secret lives in two places (function env `CRON_SECRET` + DB GUC `app.settings.cron_secret`); rotating requires updating both in lockstep — a mismatch = 403 = silent alarm outage. Document both locations and a rotation runbook.
- **S7 — locking out a legitimately-needed preview deploy.** Chris may be actively testing on a `*.vercel.app` preview; exact-match will block it. Mitigation: the `PREVIEW_ORIGINS` env escape hatch (pin the exact host during a testing window, clear after). Confirm no preview is mid-test before deploy (build [OPEN] #2).
- **S7 — webhook CORS regression.** If the centralized helper accidentally drops `stripe-signature` from the two webhooks' allow-headers, OR if the OPTIONS path changes, Stripe delivery could be affected. (Low risk — Stripe is server-to-server with no Origin — but verify the OPTIONS/headers explicitly in smoke.)
- **S7 — centralization import churn.** A bad import in `_shared/cors.ts` breaks all 20 functions at once. Mitigation: deploy a single function first as a canary, smoke it, then batch the rest; keep prior versions for rollback.
- **S8 — webhook table contention / write failure.** If the claim insert errors for a non-conflict reason and we return 500, Stripe retries — acceptable; a persistent DB outage would stall webhook processing, but the PK insert is cheap (single indexed row). Negligible at this volume.
- **S8 — re-process re-runs non-idempotent side effects (NOT fully closed; neutralized only by ADJ-1).** The two-phase protocol trades the old **silent-lost-payment** for an **at-least-once** guarantee, which means the `claimed → re-process` branch **actively re-runs** `qb-record-payment` in two windows: **(a) concurrent duplicate delivery** — a second delivery sees `status='claimed'` (first not yet `done`) and re-processes in parallel → double QB Payment; **(b) DONE-update failure after successful side effects** — `markDone()` fails post-commit, the row stays `claimed`, and the next Stripe retry re-processes → double QB Payment. Both are **expected** and are neutralized **only by ADJ-1** (idempotent `qb-record-payment`), NOT by S8. S8's win is eliminating the silent loss; it does not eliminate the double. Disclosed in the §S8 amendment; do not over-read S8 as closing double-billing.
- **S8 — tenant_id NULL trap (LOCKED resolved).** The repo-standard `NOT NULL DEFAULT get_user_tenant_id()` would make every service-role insert fail (NULL in service-role context). Locked resolution: `tenant_id` nullable, no default, left NULL; PK `event_id` is the dedupe mechanism. If the build copies the pay_apps default verbatim, **every webhook insert fails** and idempotency never engages — call this out loudly.
- **S8 — migration timestamp collision** on the shared project. Mitigated by the mandatory collision check; do not hardcode.

---

## §8 Dependencies / adjacent findings (out of scope — NOT planned here)

- **C10 / C12 — NOT made unreachable by S7 (round-0 overclaim removed).** S7 is ACAO hardening only and gates no execution (§S7 reframe). C10 (`send-invoice` raw provider error leak) and C12 (`reset-password` Origin-controlled branding/redirect) remain fully reachable via direct server-to-server calls and are **fully open**. C12 is filed as **ADJ-2**. Out of scope here.
- **S8 does NOT close the full replay surface — by design it *actively re-runs* the double (see §S8 amendment).** The two-phase dedupe stops the webhook from silently *skipping*, but it *re-runs* the non-idempotent `qb-record-payment` on the concurrent-duplicate (window a) and DONE-update-failure (window b) paths, plus the UI-triggered paths `Invoices.jsx:1124`/`:1160`. S8 **narrows** the double-billing window; it does not eliminate double-payment at the `qb-record-payment` layer. Closure is **ADJ-1** (idempotent `qb-record-payment` — guard on existing `qb_payment_id`), filed, **next loop**. Out of scope here.
- **`check-orphan-users` has no CORS check at all** (it's a cron target, not browser-called) — not a defect to fix, but noted so a future reader doesn't "add CORS for consistency." Filed as **ADJ-3** for tracking.
- **C3** (`qb-auth verify_jwt=false`) sits in the same `config.toml` S6 edits and the same CORS list S7 edits, but flipping it to `true` is a separate finding with its own break-risk (qb-auth OAuth callback may legitimately need `verify_jwt=false`). **Do not flip it in this pass.**
- **C4/C11/C13/C14/C16/C19/C20** (missing role gates / body-trust on money/admin functions): S7 does **not** affect these (CORS gates no execution — §S7 reframe); they remain fully exploitable by any authenticated tenant member via direct calls. Out of scope.
- **B-series** anon RLS `deleted_at` / unscoped-RPC findings, **D-series** client gates, **E/F-series**: untouched.
- **C18** (missing `Access-Control-Allow-Methods`): adjacent to the S7 CORS rewrite and trivially foldable into the `_shared/cors.ts` helper, but it is a separate (Low) finding and out of this scope. If the build adds the helper anyway, adding `Access-Control-Allow-Methods: "POST, OPTIONS"` there is a zero-cost opportunistic win — flag to Chris, do not assume. Filed as **ADJ-4**.

---

## Audit manifest

_Updated on 2026-06-09 for round 3 (**OPTIONAL** — see convergence note). Consumed by `/runaudit` to size the adversarial audit pass._

### Round
- Current round: **3 (optional)** — round 2 converged (9 findings, 0 Critical, mostly disclosure/wording). The one real correctness bug (S6 cron `current_setting` raising-form) is fixed and a §6 cron-ordering self-review was done in pass 2. Per the round-2 reviewer, a full round-3 audit is optional; self-review is likely sufficient before build.
- Plan revision under audit: `1ea2ab3` (Plan revision pass 2 — round-2 audit response)
- Findings trend: round 1 (0C/3H/6M/2L ≈ 11) → round 2 (0C, 9, mostly disclosure) → round 3 (?). **Converging** (11 → 9, severity falling to 0 Critical) — NOT a plateau.

### Prior rounds
- Round 1: responded in `05af696` · 0C/3H/6M/2L ≈ 11 · pattern: **mechanism-overclaim** (S7 "keystone"/de-fang false; S8 insert-first had a crash→lost-payment window; S6 false "[OPEN] invoker"). Counts reconstructed from directives.
- Round 2: responded in `1ea2ab3` · 0C, ~9 findings, mostly **disclosure/wording** · pattern: **disclosure-convergence** (S8 [amendment] that it narrows-not-closes the money-double + defers to ADJ-1; the one real bug was the S6 cron raising-form foot-gun; rest was scc-placement / length-guard / S7 wording).

**Briefing for agents (round 3, if run)**: do NOT re-find round-1 or round-2 issues — they are in the `05af696` and `1ea2ab3` commit messages and are resolved. Attack ONLY what changed in `1ea2ab3`:
- the S8 **exit-completeness** rule (`markDone()` before *every* 2xx, leave `'claimed'` on errors) and the corrected scc placement (no `:77` early-return; `:85` is the non-subscription case inside the checkout branch),
- the S8 **[Round-2 amendment]** disclosure — does it honestly bound the double-billing to windows (a) concurrent-duplicate and (b) DONE-update-failure, and correctly defer closure to ADJ-1, without over- or under-claiming?
- the S6 cron **`current_setting(..., TRUE)` missing_ok** form + the **reschedule-before-gate** ordering — does it truly eliminate the 403/missed-alarm window with no added exposure?
- the S6 **length-guard-then-`timingSafeEqual`** change,
- the S7 reset-password Origin nuance + the PREVIEW_ORIGINS full-`https://`-origin note.

**Plateau signal**: round 2 (9) < round 1 (11) with severity falling to 0 Critical / mostly disclosure ⇒ **converging, not plateauing**. If round 3 surfaces only wording nits → build. If it surfaces a NEW Critical/High → that's a regression to investigate, not convergence.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked on F7.
- **Prod / staging / dev**: **Prod.** All 20 S7 functions, both S8 webhooks, and `check-orphan-users` are live for the paying tenant — active money paths (Stripe webhook → invoice Paid → `qb-record-payment`, QB sync, invoice/pay-app send).
- **Blocking feature flags**: none — the affected surface is unconditionally live.
- **Concurrency profile**: solo / ≤5 (single contractor office; one or few admins).

**Severity-weighting note for agents:** S6 (unauth DoS / Resend-quota / invocation-billing) is internet-reachable regardless of tenancy, and S8 (replay double-billing / subscription clobber) is a real single-tenant money bug — do NOT down-weight either as "theoretical multi-tenant." S7 is now framed as ACAO hardening (modest severity), not a CSRF keystone — weight S7 findings as defense-in-depth, not auth-bypass.

### Time budget + finding cap
- **Time budget**: 2 days (ERD Loop #33 lock); build estimate ≈ 1.5 days.
- **Finding cap**: **12** (≈4 per agent across 3 agents). Round 2 should surface fewer than round 1 if the revision converged.

Note: the literal `max(3, ceil(min/10))` formula yields ~90+ on a 2-day budget (tuned for sub-hour loops); cap held at the practical 3-agent ceiling (12). Remainder → "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: ~383 (pre-manifest).
- Sections: 8 content (`Scope`, `§0`, `§S6`, `§S7`, `§S8`, `§6`, `§7`, `§8`) + this manifest.
- Confidence scheme: `[VERIFIED]` / `[DERIVED]` / `[OPEN]` (no `[LOCKED]`/`[DESIGN-OPEN]`). Round-2 additions are tagged `[LOCKED]` where the round-1 audit forced a decision (S6 sole-gate, S6 invoker, S7 reframe, S8 two-phase). Treat `[LOCKED]`/`[VERIFIED]` as the contract; `[DERIVED]` as the pressure surface.
- [OPEN] items: **4 inline → 2 true sign-offs + 2 build-time picks** (down from 5; S6-invoker and S8-tenant_id resolved). See list below.
- Plan-to-code ratio: ~383 : ~175 est code ≈ **2.2 : 1** (S8 grew slightly with the status column + re-process branch; still well under 50:1).

### Layers touched
- Edge functions / API routes (all three; 20+2 functions + config.toml)
- Migrations / schema (S8 `processed_stripe_events`; S6 cron-reschedule migration)
- RLS / auth / multi-tenancy (S8 decorative RLS; S6 `verify_jwt` + `CRON_SECRET` gate)
- External integrations (Stripe webhooks, Resend email, QuickBooks downstream)
- Cost (S6 — Resend quota / invocation billing / DoS)
- Cross-repo (shared Supabase project `pbgvgjjuhnpsumnowuym` — migration ledger; **two** new migrations now: S8 table + S6 cron-reschedule)

### New mechanisms introduced
- New table: `processed_stripe_events` (`event_id text PK`, **`status text` claimed|done**, `tenant_id` nullable/NULL) — S8
- New protocol: **two-phase `claimed → done`** with re-process-on-stuck-claim — S8 (the round-2 re-lock; the highest-novelty new surface)
- New RLS policy: `processed_stripe_events_select` (decorative — service role bypasses) — S8
- New migration: **cron unschedule+reschedule** of `check-orphan-users-daily` adding `x-cron-secret` header from `app.settings.cron_secret` GUC — S6
- New helper (invented): `supabase/functions/_shared/cors.ts` → `resolveCors`/`corsHeaders` — S7
- New handler gate: timing-safe `CRON_SECRET` check (`deno std@0.168.0`, byte arrays) — S6
- New `config.toml` block: `[functions.check-orphan-users] verify_jwt = true` — S6
- New secrets / env: `CRON_SECRET` (function env **+** `app.settings.cron_secret` GUC — one value, two stores), `PREVIEW_ORIGINS` — S6/S7

### Cross-system reach
- Shared Supabase project — **two** migration-ledger entries this round (S8 table + S6 cron-reschedule); collision check applies to both.
- Stripe (replayed webhook delivery), Resend (S6 email), QuickBooks (`qb-record-payment` downstream — see ADJ-1).
- Service-role / bypass-RLS write paths: both webhooks INSERT/UPDATE `processed_stripe_events` under service role; `check-orphan-users` runs the RPC + cron under service role.

### Irreversibility
- S8 migration: additive (`CREATE TABLE IF NOT EXISTS`) — reversible (drop); ledger-coordinated: yes.
- S6 cron-reschedule migration: **mutates a live pg_cron job** — reversible by re-scheduling the prior body, but it changes a running prod job; the old job must be `cron.unschedule`d cleanly (no orphan duplicate schedule). Ledger-coordinated: yes.
- S7 CORS change: reversible via `PREVIEW_ORIGINS`. No data backfills, no destructive migrations.

### Known weak points
- **S8 two-phase correctness (NEW — highest-pressure):** the re-process-on-`claimed` branch must genuinely re-run (not skip), AND the downstream side effects it re-runs are NOT idempotent (ADJ-1). So the crash-safe design trades a silent-lost-payment for a possible double-`qb-record-payment` on the re-process. Verify the plan acknowledges this honestly and does not claim S8 makes replay fully safe.
- **S8 `qb-record-payment` residual (ADJ-1):** confirm the plan does NOT overclaim S8 closes double-billing; the UI paths `Invoices.jsx:1124`/`:1160` + the webhook call remain non-idempotent. This is the most likely place for a round-2 overclaim to hide.
- **S6 two-store secret drift:** `CRON_SECRET` (function env) and `app.settings.cron_secret` (DB GUC) must hold the same value; the plan's lockstep order must prevent a window where the gate is live but the cron lacks the header (403 silent alarm outage).
- **S6 cron-reschedule mechanics:** unschedule+reschedule vs `alter_job` is [DERIVED] — verify the chosen path can't leave a duplicate/orphaned schedule, and that editing the already-applied migration file is correctly rejected in favor of a NEW migration.
- **S7 PREVIEW_ORIGINS / empty-origin parse:** verify `.filter(Boolean)` + `origin !== ""` actually close both traps and that no function still carries the `endsWith`/`startsWith` clauses.
- **S7 centralization blast radius:** a bad `_shared/cors.ts` import breaks all 20 at once; canary mitigation noted but unproven.

### Open questions
- Count: **2 true sign-offs + 2 build-time picks** (see list). 
- Highest-pressure: (1) S7 **centralize `_shared/cors.ts` vs in-place** — atomic-deploy risk across 20 functions; (2) the **build-time migration timestamps** for two new migrations on the shared ledger.

### Suggested attack angles (3 total) — round 3 (optional), attack the pass-2 changes
1. **S7 ACAO reframe + parse correctness** — Required reading: `supabase/functions/send-invoice/index.ts`, the 20 CORS blocks, §S7 (reframe + reset-password Origin nuance + PREVIEW_ORIGINS snippet/full-origin note + smoke #2), `send-proposal:122`. Pressure: is the "CORS gates no execution" reframe actually correct for **all 20** (no function rejects on Origin; none set `Allow-Credentials: true`)? Is the reset-password "steers-but-never-rejects" nuance right? Does the `PREVIEW_ORIGINS` parse + empty-origin guard + full-origin requirement close all traps? Is the browser-not-curl smoke right? Is the 20-list still complete and `send-proposal:122` excluded?
2. **S8 two-phase claim→done + exit-completeness** — Required reading: `stripe-webhook/index.ts` (client-hoist at :104; early returns :101/:119), `scc-stripe-webhook/index.ts` (client :78; `:85` non-subscription return *inside* the checkout branch; no generic unhandled-type return), §S8 DDL + handler + [Round-2 amendment], `CLAUDE_RLS.md`, ADJ-1. Pressure: does `markDone()`-before-every-2xx actually prevent stranded `'claimed'` rows at ALL exits (success, no-op, unhandled type)? Does leaving `'claimed'` on 4xx/5xx correctly drive retries? Does the amendment honestly bound the double to windows (a)/(b) and defer closure to ADJ-1 without hiding it? Is `tenant_id` NULL / decorative-RLS safe? Is the separate-post-migration-deploy sequencing sound?
3. **S6 gate + cron-reschedule + scope** — Required reading: `check-orphan-users/index.ts`, `config.toml`, `...s2_orphan_user_alarm.sql:27-40`, §S6/§6/§7. Pressure: is `CRON_SECRET`-as-sole-gate correct (does `verify_jwt=true` really admit all authenticated)? Is the `deno std@0.168.0` byte-array timing-safe compare correct? Is the cron unschedule+reschedule + two-store GUC safe and lockstep-ordered? Does smoke #1 (401) actually prove `verify_jwt` took? Scope-boundary adherence (no creep beyond S6/S7/S8; ADJ items correctly filed not fixed).

### Suggested agent count: **3**

Rationale: unchanged — three file-disjoint findings, one coherent angle each. If round 3 is run, each angle attacks only the *pass-2* change (S8 exit-completeness + amendment honesty, S6 cron missing_ok + reschedule-before-gate, S7 wording nuances), not the whole plan. Given convergence (9 → mostly disclosure), **1 agent doing a focused disclosure/correctness pass may suffice** instead of 3 — or skip to build per the round-2 reviewer. Escalate only if a new High appears.

### [OPEN] decisions blocking the build
1. **S7 — sign-off on dropping ad-hoc `*.vercel.app` preview CORS** for pinned `PREVIEW_ORIGINS`; confirm no preview is mid-test. *(sign-off)*
2. **S7 — centralize into `_shared/cors.ts` vs in-place edit** (plan recommends centralize; build may choose in-place if atomic-deploy risk is judged too high). *(sign-off)*
3. **S8 — exact migration timestamp** via collision check (latest is `20260601120000`); plus cron unschedule+reschedule vs `alter_job` for S6. *(build-time picks)*
4. **S6 — confirm no deploy wrapper injects `--no-verify-jwt`** (must be checked before deploy; smoke #1's 401 is the proof). *(build-time verification)*

_Resolved since round 1 (no longer blocking): S6 invoker mechanism (known — `...s2_orphan_user_alarm.sql:27-40`); S8 `tenant_id` deviation (LOCKED nullable/NULL); S6 timing-safe import (LOCKED `deno std@0.168.0`)._
