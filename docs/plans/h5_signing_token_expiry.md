# H5 — Signing Token Expiry + Single-Use

**Audit source:** Deep audit 2026-04-30
**Backlog ID:** H5 (Security, T2, Blocks F7)
**Status:** In Progress (branch `fix/h5-signing-token-expiry-and-consume`)
**Companion follow-up:** O3 (drop the 1-arg compat wrapper + legacy anon-insert policy after deploy verifies)
**Companion new row:** B13 (same problem class on `invoices.viewing_token`)

---

## Problem

Today every `proposals.signing_token` is a forever-valid customer-facing
URL. A leaked or forwarded link reads pricing + customer detail and lets
someone sign forever. The only mitigation is that the React page's
status-based branching hides the sign form once a proposal is Sold —
nothing at the database level prevents reads, mutations, or re-signs.

## End state

- `proposals.signing_token_expires_at timestamptz`
- `proposals.signing_token_consumed_at timestamptz`
- Schema invariant: any row with a non-null `signing_token` must have a
  non-null `signing_token_expires_at` (CHECK constraint, validated).
- Unique partial index on `signing_token`.
- BEFORE INSERT OR UPDATE trigger auto-fills `expires_at` from
  `tenant_config.proposal_validity_days` (fallback 90) when a token is
  set without an expiry.
- All 5 anon policies that touch `signing_token` enforce strict
  `expires_at IS NOT NULL AND expires_at > now()` (no NULL bypass).
- `get_public_proposal_view(p_token)` — strict on expiry, permissive on
  `consumed_at` (preserves Accepted-screen revisit).
- `mark_recipient_viewed(p_token)` — strict on expiry AND `consumed_at`.
- `mark_proposal_signed` (5-arg) — atomic single-use: SELECT FOR
  UPDATE + `UPDATE … WHERE consumed_at IS NULL` race guard +
  signature insert + `call_log.stage='Sold'` flip — one transaction.
- `mark_proposal_signed` (1-arg) — kept as compatibility wrapper for
  the rollout window (delegates to 5-arg with NULL signer fields).
- `ProposalPDFModal.handleSend` refreshes `signing_token_expires_at`
  BEFORE invoking `send-proposal` so the customer's link can't be DOA;
  status-guarded against re-sending Sold proposals.
- `PublicSigningPage.handleSign` no longer inserts `proposal_signatures`
  directly — signature insert moves into the 5-arg RPC.
- `proposal-signed` edge function extracts client IP from
  `x-forwarded-for` (not from React body); maps `ALREADY_SIGNED → 409`,
  `INVALID_TOKEN → 403`, `INVALID_PDF_URL → 400`.
- Migration ends with `NOTIFY pgrst, 'reload schema'` so the new 5-arg
  RPC overload resolves immediately.

## Deploy ordering (compat-safe, two-step)

**Migration A** — `20260510120000_signing_token_expiry_and_consume.sql`
applies first. Adds columns, backfill, invariant, trigger, policy
updates, 3 new/updated RPCs, AND keeps the 1-arg compat wrapper +
legacy `proposal_signatures_public_insert_token` policy in place (with
expiry predicate added).

**Vercel + edge function deploy** — push the branch, Vercel
auto-deploys. Run `supabase functions deploy proposal-signed
--project-ref pbgvgjjuhnpsumnowuym`. New customer signing pages will
load with the new 5-arg flow; in-flight pages with cached old JS keep
working through the compat wrapper.

**Migration B** — filed as backlog row O3. After Vercel + edge fn are
live for ≥48 hours, run preflight Q-LEGACY-CALLS (Supabase function
log query or `pg_stat_statements`) to confirm the 1-arg wrapper has no
traffic; then apply a small follow-up migration that:

- `DROP FUNCTION public.mark_proposal_signed(text);` (1-arg wrapper)
- `DROP POLICY "proposal_signatures_public_insert_token" ON public.proposal_signatures;`

That closes H5 fully. Until O3 ships, the old anon-insert path is still
live — that's the price of the compat-safe rollout.

## Decisions accepted (from build prompt)

1. **Draft backfill anchor:** `now()` (no customer has the link yet;
   `handleSend` refreshes before email send anyway).
2. **Sold revisit window:** `COALESCE(approved_at, now()) + interval '1 year'`.
3. **Preflight Q-DARK-LIVE handling:** run first; if any non-Sold
   row would go dark, pre-set its `signing_token_expires_at` directly
   (NOT a `sent_at` shim) per Chris's call.
4. **ALREADY_SIGNED UX:** silent — page renders Accepted, no toast/alert.

## Preflight queries (READ-ONLY, run before Migration A applies)

```sql
-- Q-DUP: duplicate tokens. MUST return 0 before unique index applies.
SELECT signing_token, count(*) FROM public.proposals
 WHERE signing_token IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1;

-- Q-COUNT: how many proposals have a signing_token, by status?
SELECT status, count(*) FROM public.proposals
 WHERE signing_token IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;

-- Q-DARK-LIVE: non-Sold rows whose backfilled expiry would already
-- be past on apply (live customer links would go dark immediately).
SELECT p.id, p.customer, p.proposal_number, p.status, p.sent_at, p.created_at,
       COALESCE(p.sent_at, p.created_at, now())
       + (COALESCE(tc.proposal_validity_days, 90) || ' days')::interval AS new_expires_at
  FROM public.proposals p
  JOIN public.tenant_config tc ON tc.id = p.tenant_id
 WHERE p.signing_token IS NOT NULL
   AND p.status NOT IN ('Sold', 'Draft', 'Lost')
   AND COALESCE(p.sent_at, p.created_at, now())
       + (COALESCE(tc.proposal_validity_days, 90) || ' days')::interval < now()
 ORDER BY new_expires_at;

-- Q-SOLD-DARK: Sold rows whose 1-year-from-approved_at revisit window
-- is already past (signed Accepted-screen revisits go dark).
SELECT p.id, p.customer, p.proposal_number, p.approved_at,
       COALESCE(p.approved_at, now()) + interval '1 year' AS new_expires_at
  FROM public.proposals p
 WHERE p.signing_token IS NOT NULL
   AND p.status = 'Sold'
   AND COALESCE(p.approved_at, now()) + interval '1 year' < now()
 ORDER BY new_expires_at;
```

## Post-apply verification (READ-ONLY)

```sql
-- 1. No proposals with token but no expiry.
SELECT count(*) FROM public.proposals
 WHERE signing_token IS NOT NULL AND signing_token_expires_at IS NULL;
-- expect 0

-- 2. No Sold proposals with token but no consumed_at.
SELECT count(*) FROM public.proposals
 WHERE status='Sold' AND signing_token IS NOT NULL
   AND signing_token_consumed_at IS NULL;
-- expect 0

-- 3. CHECK constraint validated.
SELECT conname, convalidated FROM pg_constraint
 WHERE conname = 'proposals_signing_token_requires_expiry';

-- 4. Both mark_proposal_signed forms exist.
SELECT proname, pg_get_function_arguments(oid) FROM pg_proc
 WHERE proname = 'mark_proposal_signed' AND pronamespace = 'public'::regnamespace
 ORDER BY pronargs;

-- 5. NEW 5-arg RPC resolves via PostgREST (post-NOTIFY).
--    From Supabase JS:
--      supabase.rpc("mark_proposal_signed",
--        { p_token: "not-a-real-token", p_signer_name: null,
--          p_signer_email: null, p_ip_address: null, p_pdf_url: null })
--    expect: 400 with INVALID_TOKEN (NOT 404 / PGRST202).

-- 6. Anon policy inventory (signing-token surface).
SELECT tablename, policyname, cmd FROM pg_policies
 WHERE schemaname='public' AND roles::text LIKE '%anon%'
 ORDER BY tablename, policyname;
```

## Smoke / test plan

### Scratch project (apply Migration A on a temp Supabase project)

| #   | Scenario                                       | Expected                                                                       |
|-----|------------------------------------------------|--------------------------------------------------------------------------------|
| S1  | Q-DUP preflight = 0                            | confirmed before apply                                                          |
| S2  | Backfill — Drafts anchored on now()            | direct DB query post-backfill                                                  |
| S3  | Backfill — non-Draft non-Sold anchored on sent_at | direct DB query                                                              |
| S4  | Backfill — Sold approved_at+1y                 | direct DB query; consumed_at = approved_at                                     |
| S5  | Unique partial index blocks dup INSERT         | manual `INSERT` with existing token → unique violation                         |
| S6  | CHECK invariant blocks bypass                  | manual INSERT with NULL expires_at but non-null token (skipping trigger) → fail |
| S7  | Trigger fills on INSERT                        | INSERT with NULL expires_at + non-null token → trigger fills, succeeds          |
| S8  | Trigger fills on UPDATE OF signing_token       | UPDATE rotating token → trigger refills expires_at                              |
| S9  | Expired token, anon SELECT (all 4 policies)    | 0 rows; `get_public_proposal_view` raises INVALID_TOKEN                         |
| S10 | Expired token, both mutation RPCs              | both raise INVALID_TOKEN                                                       |
| S11 | Expired token, legacy anon-insert policy       | INSERT rejected (predicate fails on expiry)                                    |
| S12 | Consumed token, read                           | `get_public_proposal_view` returns JSON with status='Sold'/consumed_at non-null|
| S13 | Consumed token, mark_recipient_viewed          | raises INVALID_TOKEN (no recipient mutation)                                   |
| S14 | Consumed token, 5-arg sign re-attempt          | raises ALREADY_SIGNED; signature count unchanged; row state unchanged          |
| S15 | Consumed token, 1-arg wrapper re-attempt       | wrapper passes NULLs → 5-arg raises ALREADY_SIGNED                             |
| S16 | Fresh sign — 5-arg path                        | one txn: status=Sold, approved_at, consumed_at, signature row, call_log.stage=Sold |
| S17 | Fresh sign — 1-arg compat path                 | wrapper flow: anon-insert sig, then status flip via wrapper; same end state    |
| S18 | Concurrent sign (two tabs)                     | first wins; second raises ALREADY_SIGNED; one signature row only                |
| S19 | p_pdf_url spoofing — wrong proposal_id         | raises INVALID_PDF_URL; no signature row                                       |
| S20 | p_pdf_url spoofing — non-Supabase host         | raises INVALID_PDF_URL                                                          |
| S21 | p_pdf_url null                                  | accepted; signature row pdf_url=null                                            |
| S22 | handleSend on Sold proposal                    | status-guarded UPDATE returns 0 rows; setSendError fires; no Resend invoked    |
| S23 | handleSend success path                        | UPDATE happens BEFORE send-proposal; signing_token_expires_at = now+90d        |
| S24 | handleSend Resend failure                      | proposals row still flagged Sent with refreshed expires_at; rep retries        |
| S25 | NOTIFY pgrst reloads schema                    | new 5-arg RPC resolves via Supabase JS without restart                          |
| S26 | edge fn IP extraction                          | `proposal_signatures.ip_address` matches `x-forwarded-for` leftmost, not body  |

### Prod smoke (after Migration A + Vercel + edge fn deploy)

| #   | Scenario                                       | Method                                                                          |
|-----|------------------------------------------------|---------------------------------------------------------------------------------|
| P0  | Preflight numbers                              | Run Q-DUP, Q-COUNT, Q-DARK-LIVE, Q-SOLD-DARK; decide per-row before apply       |
| P1  | Migration A applies clean                      | `supabase db push --linked`; post-apply checks 1-6 green                        |
| P2  | NEW 5-arg RPC resolves (PostgREST cache)       | Anon Supabase JS: `rpc("mark_proposal_signed", { p_token: "x", p_signer_name: null, ... })` returns 400 INVALID_TOKEN (NOT 404 / PGRST202) |
| P3  | Existing Sold proposal revisit                 | Random Sold prod proposal's `/sign/<token>` in incognito → Accepted screen     |
| P4  | New send + sign on TEST customer               | Customer name "Test ..." (qb-create-job `isTest` skip). Lock WTC → send to chris7berger@gmail.com → DB shows expires_at ~now+90d → sign in incognito → atomic state → revisit URL → Accepted → try re-send → setSendError |
| P5  | Compat wrapper traffic (gap monitoring)        | After 24h + 48h: check Supabase function logs / `pg_stat_statements` for calls to 1-arg mark_proposal_signed. Should drop to zero once Vercel cache rotates. |
| P6  | NO live customer or QB impact                  | All smoke uses test-customer rows; `qb-create-job` `isTest` check skips QB; signer email is Chris's |

## Rollback path

If H5 must be reverted urgently:

- **If Migration B (O3) has NOT applied:** run
  `supabase/rollbacks/20260510120100_revert_signing_token_expiry_and_consume.sql`.
  Restores pre-H5 RPC bodies, policies, and drops the two columns +
  trigger + constraint + unique index.
- **If Migration B HAS applied:** run O3's rollback first (re-creates
  the 1-arg wrapper + legacy anon-insert policy), then this one.
- Frontend rollback: `git revert <H5 squash SHA> && git push`;
  Vercel auto-redeploys. Edge function rollback: redeploy previous
  `proposal-signed` version via Supabase dashboard.

## Files

- `supabase/migrations/20260510120000_signing_token_expiry_and_consume.sql` (new)
- `supabase/rollbacks/20260510120100_revert_signing_token_expiry_and_consume.sql` (new)
- `supabase/functions/proposal-signed/index.ts` (edited)
- `src/pages/PublicSigningPage.jsx` (edited)
- `src/components/ProposalPDFModal.jsx` (edited)
- `docs/BACKLOG.md` (H5 In Progress; B13 + O3 filed)
- `docs/plans/h5_signing_token_expiry.md` (this file)
