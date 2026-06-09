# T1 Security Remediation — Deploy Runbook (PENDING)

**Branch:** `feat/t1-security-remediation` @ `b8fc1e9` (code commit) — NOT pushed to origin.
**Gate:** Nothing below runs until `/buildvsplan` clears the diff. Then this is mechanical.
**Project ref:** `pbgvgjjuhnpsumnowuym` (SHARED with sch-command / field-command).
**ERD Loop #33** stays OPEN until all phases are prod-verified.

Current prod state: UNCHANGED. No function deployed, no migration pushed, no secret set,
not merged to main. The vulnerabilities (S6/S7/S8) are still live until this runbook is executed.

---

## Pre-flight (once, before Phase A)

1. **S7 sign-off (OPEN #1):** confirm no Vercel preview is mid-test that needs edge-function
   CORS. After this ships, only origins in the allowlist (4 Sales Command hosts + reset-password's
   4 Command-Suite hosts) or pinned in `PREVIEW_ORIGINS` can call the functions from a browser.
   - If a preview IS needed: `supabase secrets set PREVIEW_ORIGINS="https://<exact-preview-host>" --project-ref pbgvgjjuhnpsumnowuym`
     (full `https://` origin, no trailing slash, comma-separated for multiple). Clear it after the window.
2. Merge `feat/t1-security-remediation` to main (or deploy from the branch checkout) per your push policy.

---

## Phase A — S7 CORS (18 non-webhook functions; edge-only, no DB)

All with `--no-verify-jwt` (these do their own auth / are public; project convention).
The 2 webhooks are intentionally NOT here — their files now also carry S8 code, so they
deploy in Phase B (after the table exists). Webhook CORS is irrelevant anyway (server-to-server).

**A1. Canary (one fn, smoke before batch):**
```
supabase functions deploy send-invoice --no-verify-jwt --project-ref pbgvgjjuhnpsumnowuym
```
Smoke A1:
- From an allowed prod origin (logged in on https://www.scmybiz.com): send an invoice → succeeds,
  `Access-Control-Allow-Origin` echoes the prod origin.
- **Browser, not curl:** on a non-allowlisted page (devtools on any site you don't own), run
  `fetch("<send-invoice-url>", {method:"POST"})` → browser blocks with CORS error; response header
  is `Access-Control-Allow-Origin: https://salescommand.app` (the fallback), NOT the caller origin.

**A2. Batch the remaining 17** (only after A1 smoke is clean):
```
for fn in qb-auth qb-record-payment qb-search-customers invite-user send-pay-app \
          deactivate-user send-proposal qb-sync-invoice qb-void-invoice qb-link-customer \
          qb-create-job reset-password deactivate-payment-link proposal-signed delete-user \
          extract-sov create-billing-session; do
  supabase functions deploy "$fn" --no-verify-jwt --project-ref pbgvgjjuhnpsumnowuym
done
```
Smoke A2: log in on www.scmybiz.com → send invoice, sync QB, send pay-app all still work
(full money-path regression). Confirm reset-password still works from BOTH a Sales Command
origin and a Schedule Command origin (it keeps schedulecommand.com / schmybiz.com).

---

## Phase B — S8 (migration first, then webhook code)

**B1. Push migrations** (this pushes BOTH pending migrations — see note):
```
npm run db:push      # runs check-migration-safety.sh + check-migration-collision.mjs, then supabase db push
```
- Pending migrations:
  - `20260609120000_s8_processed_stripe_events.sql`  (S8 table)
  - `20260609120100_s6_orphan_cron_secret_header.sql` (S6 cron reschedule)
- If the collision check flags either timestamp (a sibling repo pushed a later one), rename to the
  next free timestamp and re-run.
- **Why it's safe to land the S6 cron migration here, before the S6 secret/gate:** it uses
  `current_setting('app.settings.cron_secret', TRUE)` (missing_ok) so it can't crash the cron, and
  `check-orphan-users` is still UNGATED until Phase C — so the cron sending a NULL `x-cron-secret`
  just returns 200. No outage. The only hard requirement (gate deploys LAST, after the GUC is set)
  is preserved by Phase C.
- Verify: `processed_stripe_events` exists with PK on `event_id` and `status` default `'claimed'`.

**B2. Deploy the two webhooks** (now the table exists — ships CORS + S8 dedupe together):
```
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref pbgvgjjuhnpsumnowuym
supabase functions deploy scc-stripe-webhook --no-verify-jwt --project-ref pbgvgjjuhnpsumnowuym
```

**B3. Smoke S8** (use a TEST event / TEST recipient):
- First delivery of `checkout.session.completed` → processes; row ends `status='done'`.
- Replay the SAME `event.id` → 200 `{duplicate:true}`, NO second invoice update / qb-record-payment / receipt.
- Crash-safety: manually `INSERT` a `status='claimed'` row for a test event id, deliver that event →
  it DOES process (proves a stuck claim never blocks a real payment).
- scc: replay `customer.subscription.deleted` → does NOT re-null an active sub. Deliver an unhandled
  type and the non-subscription checkout → each ends `status='done'` (no stranded `'claimed'`).
- Stripe (server-to-server, no Origin) still delivers — CORS change does not affect signature verify.

---

## Phase C — S6 (GUC provision → gate deploy LAST → smoke)

**C1. Generate the secret:**
```
openssl rand -hex 32        # → use as <SECRET> in C2 and C3 (must be identical)
```
**C2. Set the FUNCTION env secret:**
```
supabase secrets set CRON_SECRET=<SECRET> --project-ref pbgvgjjuhnpsumnowuym
```
**C3. Set the DB GUC** (same value; via Supabase SQL editor / psql as a superuser):
```
ALTER DATABASE postgres SET app.settings.cron_secret = '<SECRET>';
```
**C4. Smoke the GUC (gate before C5):**
```
SELECT current_setting('app.settings.cron_secret', TRUE);   -- MUST return <SECRET>, not NULL
```
If NULL → stop; C5 would 403 every cron run (silent alarm outage).

**C5. Deploy the gated function — WITHOUT `--no-verify-jwt`** (the one exception; config.toml
`verify_jwt=true` must stand). Verified there is no deploy wrapper that injects the flag.
```
supabase functions deploy check-orphan-users --project-ref pbgvgjjuhnpsumnowuym
```
**C6. Smoke S6:**
- `curl -X POST <check-orphan-users-url>` (no auth) → **401** (proves verify_jwt took; if 2xx/403, the
  flag did not take — stop and fix).
- service-role Bearer, no `x-cron-secret` → **403** (handler gate).
- service-role Bearer + correct `x-cron-secret` → **200** `{orphan_count:N}`. Point Resend `to:` at a
  test address, or run when orphan_count is known 0, to avoid spamming the inbox.
- Cron end-to-end: query `cron.job_run_details` for the next/last run (or invoke the cron body
  manually) → 200.

---

## Pending checklist (nothing below is done)

**Migrations (unpushed):**
- [ ] `20260609120000_s8_processed_stripe_events.sql`
- [ ] `20260609120100_s6_orphan_cron_secret_header.sql`

**Secrets (not set):**
- [ ] `CRON_SECRET` — function env (`supabase secrets set`)
- [ ] `app.settings.cron_secret` — DB GUC (`ALTER DATABASE`), SAME value as CRON_SECRET
- [ ] `PREVIEW_ORIGINS` — OPTIONAL, only to pin a preview host during a testing window

**Function deploys (none deployed) — 21 functions:**
- [ ] 18 non-webhook CORS fns, `--no-verify-jwt` (Phase A): send-invoice (canary) + qb-auth,
      qb-record-payment, qb-search-customers, invite-user, send-pay-app, deactivate-user,
      send-proposal, qb-sync-invoice, qb-void-invoice, qb-link-customer, qb-create-job,
      reset-password, deactivate-payment-link, proposal-signed, delete-user, extract-sov,
      create-billing-session
- [ ] stripe-webhook, scc-stripe-webhook, `--no-verify-jwt` (Phase B, AFTER B1 migration)
- [ ] check-orphan-users, **WITHOUT** `--no-verify-jwt` (Phase C, AFTER C4 GUC smoke)

**Hard orderings:** B1 (S8 table) before B2 (webhook code). C2+C3+C4 (secret in both stores, GUC
smoked) before C5 (gate). Gate deploys LAST overall.

**Carry-forward (next loop, NOT this one):** ADJ-1 — make `qb-record-payment` idempotent. S8 ships an
at-least-once guarantee (no silent lost payment) but a concurrent/retry race can still double-charge
until ADJ-1 lands. Make ADJ-1 the very next loop.
