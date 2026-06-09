# T1 Security Remediation — Build-vs-Plan Audit Prompt

Run in the audit terminal via `/buildvsplan` (read-only punch-list, inherits /audit hard rules).
Feed the block below as the briefing. This gate clears the diff BEFORE any prod deploy.

---

```
AUDIT — BUILD vs PLAN · T1 Security Remediation (S6/S7/S8) · ERD Loop #33

ROLE: Adversarial plan-vs-build review. Verify the BUILD faithfully implements the PLAN.
You are read-only: NO edits, commits, pushes, deploys, migrations, or secret changes.
Nothing is deployed yet — this gate clears the diff BEFORE any prod operation.

INPUTS
- Plan (the contract):  docs/plans/t1_security_remediation.md  (§0–§8 + [Round-2 amendment])
- Build under review:   branch feat/t1-security-remediation @ b8fc1e9  (code commit; c51b0f3 is just the deploy runbook)
- Diff surface:         git show b8fc1e9 --stat   /   git diff main...b8fc1e9
- Repo discipline:      CLAUDE.md (Data Integrity Rules 6/7, migration push discipline), CLAUDE_RLS.md (6-gate)

MANDATE — for every plan requirement in §S6/§S7/§S8/§6, classify the build as one of:
  MATCH · DEVIATION-OK (justified, no behavior risk) · GAP (plan requires, build missing) · WRONG (implemented incorrectly) · SCOPE-CREEP (build does more than S6/S7/S8)
Only S6, S7, S8 are in scope. ADJ-1/ADJ-2/ADJ-3/ADJ-4 must remain Open/untouched — flag any code touching them.

KNOWN DEVIATIONS — adjudicate these explicitly (the build flagged them; confirm each is correct, not just plausible):
  D1. S7 centralized into a NEW supabase/functions/_shared/cors.ts (buildCorsHeaders) and rewired all 20 fns,
      rather than in-place edits. Plan permitted either (§S7 "[DERIVED] recommend centralize"). Verify the helper's
      exact-host + PREVIEW_ORIGINS + empty-origin logic is correct and that NO fn retains endsWith/startsWith.
  D2. reset-password keeps 4 EXTRA origins (schedulecommand.com, www.schedulecommand.com, schmybiz.com,
      www.schmybiz.com) via extraOrigins. The plan (§S7 line ~198) WRONGLY claimed ALLOWED_ORIGINS was "identical
      across all 20" — it is not; reset-password had 8. Build preserved them to avoid breaking Schedule Command
      password reset. CONFIRM this is correct and that no OTHER fn had a non-standard list that was flattened.
      (extract-sov was multi-line but the standard 4 — verify.)
  D3. The two webhooks' S7 CORS edit and S8 dedupe code live in the SAME committed file, so the webhooks deploy in
      Phase B (after the S8 table), NOT in the S7 batch as plan §S7/§6 step1 envisioned. Confirm this is safe
      (webhook CORS is server-to-server irrelevant) and that the deploy runbook orders it correctly.
  D4. Both migrations (S8 table + S6 cron) land in one `npm run db:push`. Confirm the S6 cron migration is safe to
      land before the GUC/gate because of the missing_ok form + the function staying ungated until Phase C.

HIGH-PRESSURE VERIFICATION (the plan's own "known weak points"):
  S7:
   - buildCorsHeaders: unset PREVIEW_ORIGINS → [] not [""] (.filter(Boolean)); origin==="" never matches; exact compare only.
   - All 20 fns import the helper; zero residual endsWith(".vercel.app")/startsWith("http://localhost"); allowedOrigin/ALLOWED_ORIGINS fully removed.
   - send-proposal:115 benign `.replace('.supabase.co','.vercel.app')` URL derivation UNTOUCHED.
   - Both webhooks keep `stripe-signature` in Allow-Headers (extraAllowHeaders). C17 localhost strip folded in. ADJ-4 (Allow-Methods) NOT added (scope).
  S8:
   - Migration: event_id PK; status text NOT NULL DEFAULT 'claimed'; tenant_id NULLABLE, NO get_user_tenant_id() default (the trap); RLS enabled; authenticated SELECT only (no anon, not the 2026-04-26 USING(true) anti-pattern); no write policies.
   - stripe-webhook: service-role client HOISTED above the event branch; in-branch client removed; CLAIM after signature+parse; markDone() before the SINGLE 2xx (final return, covers handled + unhandled-fallthrough); No invoice_id 400 and invoice-update 500 LEAVE 'claimed'; duplicate(status='done')→200 {duplicate:true} with NO markDone.
   - scc-stripe-webhook: CLAIM after its existing client; markDone() before BOTH 2xx exits (non-subscription return + final return); claim-error / catch LEAVE 'claimed'. No stranded 'claimed' at any 2xx.
   - Rule holds in both: 2xx ⇒ markDone; 4xx/5xx ⇒ leave 'claimed'. The 'claimed'→re-process branch genuinely re-processes (not skip).
   - [Round-2 amendment] honesty: BACKLOG S8 row + plan disclose S8 is at-least-once and does NOT close the double-charge; ADJ-1 deferral intact and NOT silently "fixed."
  S6:
   - config.toml [functions.check-orphan-users] verify_jwt=true; deploy WITHOUT --no-verify-jwt; runbook confirms no wrapper injects it (verified: no package.json/CI deploy script exists).
   - Handler: method!=="POST"→405; length-guard (a.length!==b.length) BEFORE timingSafeEqual (std throws on unequal length); !CRON_SECRET→403; import from deno.land/std@0.168.0/crypto/timing_safe_equal.ts; byte arrays via TextEncoder. CRON_SECRET is the SOLE real gate (verify_jwt admits any authenticated user).
   - Cron migration: guarded unschedule + reschedule; x-cron-secret via current_setting('app.settings.cron_secret', TRUE) (missing_ok, can't abort the cron); does NOT edit the already-applied 20260520095500 file.

BACKLOG: S6/S7/S8 marked Closed (code) on the branch with honest "prod deploy pending" notes; ADJ-1..4 Open. Confirm.

OUTPUT
- Ratification table: # | Item | Plan says | Build does | Verdict | Action.
- Headline verdict: CLEARED-TO-DEPLOY (build matches plan) / CHANGES-REQUIRED (list GAP/WRONG/SCOPE-CREEP).
- Note: Deno type-check was NOT run locally (deno not installed); esbuild parse-check passed on all 22 changed .ts.
  If you can run `deno check`, do so and report. Otherwise flag type-level risks for the deploy smoke.
```
