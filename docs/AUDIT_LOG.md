# Audit Log

Append one row per artifact reviewed by the audit terminal. Build terminal commits this file on its next pass.

| Date | Artifact | Findings | Severity mix | Outcome | Pattern tag |
|------|----------|----------|--------------|---------|-------------|
| 2026-05-09 | PR #19 (54a1409 + f02c77d → squashed as e662d24 on main) | 5 | 2 Med, 3 Low | changed | defense-in-depth-gaps |
| 2026-05-10 | PR #19 smoke plan | 2 | 1 Med, 1 Low | deferred | protocol-theater |
| 2026-05-10 | PR #20 (3417ca0 → squashed as a73ce87 on main) — H5 signing-token expiry + single-use | 0 | clean | changed | clean |
| 2026-05-11 | Jobs IA + Send-to-Schedule wizard planning doc (rev 1) — `~/sch-command/docs/planning/JOBS_IA_REFACTOR.md` | 14 | 3 Hi, 6 Med, 5 Lo | changed | doc-consistency |
| 2026-05-11 | Jobs IA + Send-to-Schedule wizard planning doc (rev 2) | 7 | 4 Med, 3 Lo | changed | doc-consistency |
| 2026-05-11 | Jobs IA + Send-to-Schedule wizard planning doc (rev 3) | 2 | 2 Lo | changed | doc-consistency |
| 2026-05-11 | Jobs IA + Send-to-Schedule wizard planning doc (rev 4, final) | 0 | clean | shipped as-is | clean |
| 2026-05-12 | +Add CO wizard + CO archive-parent WTC hint (cherry-picked 26de654..8128108 onto main) | 4 | 1 High (TDZ runtime), 2 Med (non-PW gap, jobsite/burden inheritance gaps), 1 Low (PW=true unrelated mystery) | changed | accepted-pending-changes |
| 2026-05-12 | feat/multi-gc-1a (84edc1b + 6b381cd + eadd93b + 44f7c59; ba747d3 reverted post-apply) — Multi-GC Migration 1a schema (UX guard reverted post-§5(c) reversal; migration itself unaffected and live in prod) | 2 | 1 Med, 1 Low | applied | doc-consistency |
| 2026-05-12 | §5(c) resolution reversal — multi-WTC-same-work_type is intentional (sub-areas), not a bug. Closed B17/B18/O5; filed F16; reverted ba747d3 | 0 (audit-correction) | clean | changed | audit-miss |
| 2026-06-01 | feat/retention-invoice-process @ e831912 · retention_invoice_process.md (Loop #30 per-invoice retention release; 3-round audit, R1 6→R2 plateau→R3 1) | 1 (doc nit; cut verified) | 1 Low | converged — build-ready | converged |

## 2026-05-12 — +Add CO wizard + archive-parent WTC hint notes

Shipped 7 commits cherry-picked from `fix/co-wizard-prefill-and-jobnum` onto main (26de654..8128108):

1. `26de654` — +Add CO wizard reuses parent.job_number; skips redundant customerType/customerSelect steps; null parent.customer_id blocked at parentJob/coTreatment validateStep.
2. `195e4a2` — TDZ fix: useEffect that referenced `data` placed BEFORE `const [data, setData] = useState(...)` blew up `/calllog/:id` with "Cannot access 'x' before initialization" on preview deploy. Build passed because TDZ is a runtime check. Memory: [[feedback_useeffect_tdz]].
3. `3dcd464` — pre-fill jobsite_address fields from parent (customer.business_address ≠ call_log.jobsite_address — separate sources).
4. `9fe6d83` — CO inheritance: PW from parent's first PW-on sibling, burden_rate matched by work_type_id (most-recent non-deleted parent proposal).
5. `9963e66` — Initial archive-parent rate hint (used `!wtcId` gate — flashed away on autosave).
6. `846d97a` — Hint persists via `parentIsArchive && rateVal === 0`; **PW inheritance removed** (couldn't help archive case since archive proposals have no `proposal_wtc` rows; PW=true on fresh archive-parent CO WTCs is a separate mystery deferred to its own session); Option A zero-out of `burden_rate` + `ot_burden_rate` on archive parent so the rate field actually reads empty (tenant default 56.50 was silently blocking `rateVal === 0`).
7. `8128108` — Required text + hint moved OUT of `Field` to below the grid (kept grid `alignItems: end` from displacing PW Rate's input). OT field gets red border via inline style.

Audit findings during build:
- **H — TDZ runtime error.** First fix shipped to preview, broke `/calllog/:id`. Caught from screenshot. Fixed in 195e4a2. Build did NOT catch.
- **M — non-PW gap.** Audit terminal flagged that tenant defaults seed `bidding.burden_rate=56.50` synchronously, so `rateVal === 0` never fires for non-PW archive parents. Ratified Option A (zero out in parent-load effect). Shipped in 846d97a.
- **M — jobsite + burden_rate inheritance gaps.** Surfaced in test cycle (Chris caught both directly). Fixed in 3dcd464 and 9fe6d83.
- **L — PW=true on fresh WTC of archive-parent CO.** Reproducible per Chris's screenshot but NOT caused by the shipped code (archive proposals have no `proposal_wtc` rows → my PW autoset can't trigger; verified by removing PW autoset entirely — issue still expected to surface). Likely DB default or unrelated code path. Deferred to separate investigation session.

Deploy: cherry-pick chain pushed to `origin/main` at 8128108, Vercel auto-deploy to scmybiz.com. No migrations, no edge functions, no RLS — client-only.

Verification: Chris verified preview build (`6e5266e`) on real archive-parent CO before ratifying ship. Production smoke pending after Vercel build.

Memory deltas: created [[feedback_useeffect_tdz]] (build-passing ≠ runtime-safe for useEffect dep arrays that reference later-declared `const`/`let`).

## 2026-05-10 — PR #20 (H5) notes

Audit terminal greenlit PR #20 after two scratch verifications: the original SQL smoke (16/16 PASS on scratch `lvbdsfyppaogaezvqmrg`, deleted post-test) and the rollback round-trip (R1–R9 PASS on scratch `nqanzszlbbjkercgwrtl`, deleted post-test). Two audit notes carried into deploy:

- **L1.** `mark_proposal_signed` 5-arg builds its `p_pdf_url` allow-list regex by string-concatenating `v_proposal_id` into the pattern. Low risk because every existing and trigger-generated proposal id is a UUID (no regex metacharacters). Optional follow-up: switch to a literal substring check after the regex prefix matches. Not a deploy blocker.
- **L2.** `ProposalPDFModal.handleSend` now writes `proposals.status='Sent'` + refreshes `signing_token_expires_at` BEFORE invoking `send-proposal`. If Resend fails after the UPDATE, the proposal is flagged Sent with a refreshed expiry but no email was delivered — the rep retries. Accepted trade-off in exchange for the invariant "the link the customer holds is never expired-before-receipt."

Deploy outcome (2026-05-11 02:09 UTC):
- Migration A applied clean (`Finished supabase db push`).
- Q-POST-APPLY 1–6 green on prod (6/6). Backfill sanity: 0 unbacked-token rows, 0 Sold-unconsumed rows.
- `proposal-signed` deployed.
- PostgREST cache reloaded (5-arg RPC resolves to HTTP 400 INVALID_TOKEN, not PGRST202).
- Prod smoke P3 + P4 PASS on TEST customer "10085 - TEST" (proposal id `6e6b120b-e960-4791-b87e-2e4f3a7a8349`):
  - P3 — existing Sold proposal revisit renders Accepted ✓
  - P4 send → `signing_token_expires_at = 2026-08-09 02:09:51` (89d 23h 58m out) ✓
  - P4 sign → atomic state: `status=Sold`, `approved_at`, `signing_token_consumed_at`, `proposal_signatures.signed_at` all identical `02:13:02.712165+00`; `call_log.stage=Sold`; `ip_address=76.235.216.194` (real client IP captured server-side via `x-forwarded-for`, NOT from React body); `pdf_url` non-null + passed Supabase regex ✓
  - P4 revisit → Accepted screen rendered fresh from `get_public_proposal_view` (permissive on `consumed_at`) ✓
  - P4 stale-tab — edge fn returned HTTP 409 `{"error":"ALREADY_SIGNED"}` for the consumed token re-attempt. UI's `fnError.context?.json?.()` parse path (QBLinkModal pattern at `src/components/QBLinkModal.jsx:29`) routes that to silent `setSigned(true)` + `qbBlocked=true` (prevents qb-create-job double-fire). HTTP contract verified directly via curl; UI handling follows from existing tested parse pattern.

O3 timer: started 2026-05-11 02:09 UTC. Earliest Migration B start: 2026-05-13 02:10 UTC. Before applying Migration B, query `pg_stat_statements` (or Supabase function/RPC logs) for traffic to the 1-arg `mark_proposal_signed` form since 2026-05-11; require zero hits before drop.

## 2026-05-10 — PR #19 smoke plan notes

Step 3a executed; Steps 3b and 3c not executed.

Step 3a — `qb-search-customers` invoked from the live app via the
Link-to-Existing flow on a real job (CallLogDetail → Connect to
QuickBooks → Link to Existing → search "kal"). Returned a populated
result list (KalB Industries Of Nevada parent + multiple
sub-customers). The modal was cancelled without selecting a result.

What 3a proves:
- The deployed `qb-search-customers` function loads.
- `authenticateCaller` wiring (introduced PR #19) accepts a real user
  session and rejects nothing it shouldn't.
- `getQBToken(sb, tenantId)` resolves for the current tenant.
- Token-refresh persistence does not false-fail (the request would
  have errored if the refresh write missed its row).

What 3a does NOT prove:
- 3a is deploy-health, not security validation.
- 3a may have refreshed QB tokens in `qb_connection` (side effect of
  `getQBToken` when the access token is near expiry) — this is an
  expected and intended side effect, not a violation of "read-only".
- 3a does not prove cross-tenant isolation. A second tenant would be
  required to confirm `qb_connection.tenant_id` scoping actually
  rejects another tenant's caller. With the app at single tenant,
  this remains untested.
- 3a does not prove RLS behavior across tenants for any of the
  PR #19 surface (`qb-create-job`, `qb-link-customer`,
  `send-pay-app`).
- 3a does not exercise the full C9 fix (recipient allowlist,
  attachment-URL allowlist, server-derived sender, DB-only PDF
  URLs, payApp ↔ invoice tenant assertions, payApp.invoice_id ===
  invoiceId).

Steps 3b and 3c — not executed. Both require a safe internal test
fixture (test customer + test pay-app + test invoice with a non-real
recipient destination). No such fixture exists at single tenant.
Re-run when a fixture is available, or when the second tenant onboards
under F7 and naturally creates one.

Hard limits respected this session:
- No live customer emails sent.
- No mutations to real billing, pay-app, invoice, customer, or
  call_log rows.
- No QB link/create against live data (no `qb-create-job`,
  no `qb-link-customer` mutating writes).
- No product code changes.
- No deploys.

Pattern tag rationale (`protocol-theater`): the original v104 smoke
plan named three steps. Two of the three are unrunnable at single
tenant without building scaffolding the audit would also need to
validate. Booking the deferral keeps the gap visible instead of
implying "smoke = security verified."

## 2026-05-12 — §5(c) resolution reversal notes

Audit ratified the §5(c) "block duplicates" resolution during the 2026-05-11 Round 5 ratification pass. The resolution treated multi-WTC-same-`work_type_id` on one proposal as an import bug requiring a UNIQUE constraint + WTCCalculator UX guard. During Migration 1a prod-apply, build terminal challenged the premise: `proposal_wtc.sub_areas (jsonb)` exists in the schema, and the V8 evidence pattern (consistent 4× Demo + 4× Specialty across three Hyundai Reno jobs, mostly `status=Sent`) is shaped like intentional sub-area splits, not import duplication. Chris confirmed the domain assertion: multi-WTC-same-work_type is intentional behavior, used for sub-area splits / time-phasing / crew assignment.

**Audit failure mode:** ratified the planning resolution without challenging the domain-fact premise ("duplicates are a bug") independently. The plan agent's reasoning chain was internally consistent given the premise — but the premise was wrong. **Lesson for future audit ratification passes:** explicitly challenge load-bearing domain-fact premises ("is X actually a bug or is it an intentional feature?"), not just verify the reasoning chain. New `audit-miss` pattern tag introduced for this and similar future cases.

**What stays in prod:** Migration `20260513000000_multi_gc_allocation` (purely additive — 8 columns on proposals, 1 on proposal_wtc, proposal_clones audit table, intro trigger). All unaffected by the §5(c) error.

**What was reverted from feat/multi-gc-1a:** WTCCalculator UX guard (`ba747d3`). Never reached `scmybiz.com`; only existed on the Vercel preview of `feat/multi-gc-1a`.

**What's closed:** B17 (importer-creating-dups → Not-a-Bug), B18 (triage 17 dup pairs → Not-Applicable), O5 (Migration 1b UNIQUE → Won't-Do). All moved to BACKLOG Completed Log.

**What's filed new:** F16 (T1) — re-plan §5 sync identity using `cloned_from_wtc_id` lineage column on `proposal_wtc`. Blocks all of §10 step 6 (RPCs).

**What's deferred:** FF merge of `feat/multi-gc-1a` → `feat/multi-gc-allocation`. Wait until F16 lands and feat-base state is stable. Migration is already in prod, so no urgency.

**Cleanup committed in `44f7c59`.**

## 2026-05-12 — Migration 1a prod-apply notes

Migration `20260513000000_multi_gc_allocation` applied to prod (`pbgvgjjuhnpsumnowuym`) via `supabase db push --linked`. Sole migration applied. PostgREST schema reloaded via `NOTIFY pgrst, 'reload schema'`.

**Pre-apply blocker resolution:** Prod ledger contained two `has_statements=false` rows from sch-command Jobs IA planning (`20260512120000_jobs_material_status_additive`, `20260512120100_job_wtcs_create`) that blocked `db push` on local↔remote symmetry. Audit updated its prior "don't touch sch-command rows" directive after re-evaluating: both rows had no DDL attached, no local files in either repo AT THAT TIME, the reservation purpose was moot post-rename. Reverted via `supabase migration repair --status reverted 20260512120000 20260512120100`. Resolves O8 in the bookkeeping sense.

**Cross-repo collision discovered post-revert:** During cleanup, fetched sch-command/main showed commit `2a286e9` (Jobs IA refactor + job_wtcs) with actual migration files at those two timestamps now on origin, AND `public.job_wtcs` LIVE on prod with full schema. Ledger contained zero trace of how the DDL was applied. Inferred sequence: sch-command applied DDL via Supabase dashboard SQL editor or direct `db query`, bypassing `db push`. Our revert removed only the placeholder bookkeeping, not the schema. Breadcrumb dropped in sch-command's latest handoff advising ledger reconciliation before their next `db push`. Filed as second audit miss: cross-repo directives must re-verify remote state immediately before execution.

**Post-apply smokes:** Smoke 1 (read path on scmybiz.com) — DEFERRED to next session per session-close. Smoke 2 (UX guard) — moot, guard reverted in `44f7c59` before smoke run. Smoke 3 (trigger NO-OP on real parent intro edit + DB query for `locally_edited_fields = {}`) — DEFERRED to next session. Migration is additive + IF NOT EXISTS-guarded + scratch-validated; smokes are due-diligence rather than risk-mitigating, low-priority deferral.

Scratch project (`ibalavttrqjyijrnkwmd`, sc-scratch-multi-gc-1a) deleted post-validation per H5/S1 cleanup pattern.
