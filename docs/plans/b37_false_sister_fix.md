# B37 — Fix false-sister detection blocking sequential proposals from going Sold

_Drafted 2026-05-22. Branch: `feat/b37-false-sister-fix`._

## 1. Bug recap

`handleInternalApprove` in `src/components/ProposalDetail.jsx:623-654` decides
between status `'Signed'` (deferred-award sister) and `'Sold'` (terminal) by
counting any other non-Lost, non-deleted proposal under the same `call_log_id`.
That predicate matches **sequential proposals** (P1, P2, P3 on the same job at
different times) as well as **Multi-GC sisters** (proposals cloned together via
the wizard, sharing `cloned_from_proposal_id`).

Reproducer hit 2026-05-22: on job 10116, P1 was already `Sold`. Chris created P2,
internal-approved it → P2 landed at `'Signed'` because P1 was found as a "sister."
`NewInvoiceModal` (`src/pages/Invoices.jsx:69`) filters `.eq("status","Sold")`,
so P2 has no invoice path.

Same root cause also lives in the canonical customer-signing RPC
`mark_proposal_signed` shipped in migration
`20260514000000_c1_mark_proposal_signed_sister_aware.sql` — currently only
reproducible through the public signing flow but the bug is identical.

## 2. Correct predicate

The canonical Multi-GC sister relationship is **`proposals.cloned_from_proposal_id`**
(lineage column added by migration `20260513000000_multi_gc_allocation.sql:23`).
The sync RPC `apply_source_edit_to_sisters` already uses the correct predicate
at `supabase/migrations/20260519230000_sister_wtc_auto_lock.sql:201-207`.

For B37 the question is "**is the proposal we're approving part of a sister
cohort?**" A proposal is part of a sister cohort iff at least one of these is true:

- **(A)** It is itself a sister: `p.cloned_from_proposal_id IS NOT NULL`
- **(B)** It is itself a parent with at least one live sister:
  `EXISTS (SELECT 1 FROM proposals WHERE cloned_from_proposal_id = p.id AND deleted_at IS NULL)`

Sequential P1/P2 proposals satisfy neither (both have `cloned_from_proposal_id IS NULL`
and no children), so they correctly route through the single-GC `Sold` path.

**Canonical client JS (two cheap queries, OR semantics in app code):**

```js
const isSister = !!p.cloned_from_proposal_id;            // case (A)
let hasChildSisters = false;                              // case (B)
if (!isSister && p.id) {
  const { count } = await supabase.from("proposals")
    .select("id", { count: "exact", head: true })
    .eq("cloned_from_proposal_id", p.id)
    .is("deleted_at", null);
  hasChildSisters = (count || 0) > 0;
}
const inSisterCohort = isSister || hasChildSisters;
```

**Canonical SQL fragment** (used in the new migration for `mark_proposal_signed`):

```sql
-- "is proposal X part of a real sister cohort?"
SELECT EXISTS (
  SELECT 1 FROM public.proposals s
   WHERE s.deleted_at IS NULL
     AND s.status NOT IN ('Lost')
     AND s.id <> v_proposal_id
     AND (
       -- X is a parent; sisters are its children
       s.cloned_from_proposal_id = v_proposal_id
       OR
       -- X is a sister; cohort members share parent
       (v_cloned_from IS NOT NULL AND s.cloned_from_proposal_id = v_cloned_from)
       OR
       -- X is a sister; the parent itself counts as a cohort member
       (v_cloned_from IS NOT NULL AND s.id = v_cloned_from)
     )
) INTO v_has_sisters;
```

## 3. Site list

| File:line | Current predicate | Corrected predicate | Type |
|---|---|---|---|
| `src/components/ProposalDetail.jsx:627-634` (handleInternalApprove) | broad `call_log_id` scan returning any siblings | `inSisterCohort` derived from `p.cloned_from_proposal_id` + count of children where `cloned_from_proposal_id = p.id` | Primary B37 |
| `src/components/ProposalDetail.jsx:643-647` (QB job creation gate) | Branches on `!hasSisters` (same broken flag) | Drop to `!inSisterCohort` | Secondary at same site |
| `supabase/migrations/20260514000000_c1_mark_proposal_signed_sister_aware.sql:74-81, 118-120` (`mark_proposal_signed.v_has_sisters`) | Same broad `call_log_id` predicate | New migration replaces the SELECT EXISTS block with the lineage version | Customer-signing equivalent |

**Not changed** (verified):

- `supabase/migrations/20260518180000_multi_gc_rpcs.sql:548-551` (`award_proposal`)
  — same hazard but no UI wires it yet (`grep award_proposal src/` returns zero).
  File as **B37-followup** in BACKLOG; fix when Mark Awarded UI lands.
- `src/components/MultiGCWizard.jsx:87-92` — already uses `cloned_from_proposal_id`.
- `src/components/SyncConflictModal.jsx` — RPCs use lineage predicate.
- `src/components/ProposalDetail.jsx:470` (delete + renumber) — counts ALL live
  proposals on the call_log by design; correct as-is.
- `src/components/ProposalDetail.jsx:657-659` (WTC sync conflict check) — already
  uses `cloned_from_proposal_id`.
- `src/components/ProposalDetail.jsx:734-735` ("Send to Additional GCs" gate) —
  hides button when `p.cloned_from_proposal_id` is set; matches
  `NESTED_CLONE_NOT_SUPPORTED` guard.

## 4. Backfill plan

**Investigation query** (run first; do NOT update yet):

```sql
SELECT p.id, p.proposal_number, p.call_log_id, p.status, p.approved_at,
       p.cloned_from_proposal_id,
       (SELECT count(*) FROM public.proposals c
         WHERE c.cloned_from_proposal_id = p.id AND c.deleted_at IS NULL) AS child_count,
       cl.display_job_number, cl.stage AS call_log_stage
  FROM public.proposals p
  LEFT JOIN public.call_log cl ON cl.id = p.call_log_id
 WHERE p.status = 'Signed'
   AND p.deleted_at IS NULL
   AND p.cloned_from_proposal_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.proposals c
      WHERE c.cloned_from_proposal_id = p.id AND c.deleted_at IS NULL
   )
 ORDER BY p.call_log_id, p.proposal_number;
```

Expected row count: **1** (the just-repro'd P2 on job 10116). Confirm before
running the fix. Larger row counts mean more sequential proposals slipped
through the same path — review each.

**Fix SQL** (single transaction):

```sql
BEGIN;

CREATE TEMP TABLE b37_backfill AS
  SELECT p.id AS proposal_id, p.call_log_id, p.status AS old_status,
         p.approved_at, cl.stage AS old_call_log_stage
    FROM public.proposals p
    JOIN public.call_log cl ON cl.id = p.call_log_id
   WHERE p.status = 'Signed'
     AND p.deleted_at IS NULL
     AND p.cloned_from_proposal_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.proposals c
        WHERE c.cloned_from_proposal_id = p.id AND c.deleted_at IS NULL
     );

SELECT count(*) FROM b37_backfill;  -- confirm matches investigation query

UPDATE public.proposals
   SET status = 'Sold'
 WHERE id IN (SELECT proposal_id FROM b37_backfill);

UPDATE public.call_log cl
   SET stage = 'Sold'
 WHERE cl.id IN (SELECT call_log_id FROM b37_backfill WHERE call_log_id IS NOT NULL)
   AND cl.stage <> 'Sold';

COMMIT;
```

**Safety properties:**
- `cloned_from_proposal_id IS NULL` excludes any sister.
- `NOT EXISTS (... c WHERE c.cloned_from_proposal_id = p.id ...)` excludes any
  parent with live children.
- Both together guarantee we only touch proposals with zero lineage either
  direction — the set the new predicate would classify as "not a sister."

**Manual QB reconciliation note.** Cross-check after backfill:
```sql
SELECT b.call_log_id FROM b37_backfill b
  JOIN public.call_log cl ON cl.id = b.call_log_id
 WHERE cl.qb_customer_id IS NULL;
```
Rows here indicate jobs where qb-create-job didn't fire at internal-approve time
(blocked by the false-sister branch). Manual review needed.

## 5. Edge case verifications

1. **Single-GC proposal on a job with prior Lost proposals.** No `Voided` status
   exists on proposals (`voided_at` column is `invoices`-only). Lost-only
   sequential cases already fall through the current code (`.not("status","in","(Lost)")`
   excludes Lost). New predicate inherits same behavior.

2. **Sister AND sequential non-sister rows on the same call_log.** Possible:
   rep creates P1, then runs Multi-GC wizard to clone P1 into P1a/P1b/P1c. New
   predicate handles all four correctly via lineage check.

3. **QB job creation gating (`ProposalDetail.jsx:643-647`).** Today: `if
   (p.call_log_id && !hasSisters)` runs `call_log.stage='Sold'` + `qb-create-job`.
   Corrected predicate makes `!inSisterCohort` evaluate to:
   - Sequential P2 on job 10116: `true` → QB fires (qb-create-job idempotent on DisplayName).
   - True sister proposal: `false` → QB skipped (Mark Awarded handles later).
   - Single-GC solo proposal: `true` → QB fires (unchanged from today).
   No regression in QB semantics.

4. **C1 migration update — applying the same fix to `mark_proposal_signed`.**
   In scope. New migration (next free timestamp via `npm run db:push`'s collision
   check) replaces the `v_has_sisters` SELECT EXISTS in
   `20260514000000:74-81` with the lineage version. Function signature unchanged
   (3-col return, `became_sold boolean` preserved).

## 6. Smoke matrix

| # | Setup | Action | Expected |
|---|---|---|---|
| 1 | TEST job, P1=`Sold`, then create P2 (no lineage) | Internal-approve P2 | P2 → `status='Sold'`, `call_log.stage='Sold'`, QB invoke skipped (job_name contains "test"), `+ Create Invoice` button visible |
| 2 | Solo single-GC proposal on a fresh job | Internal-approve | Status → `'Sold'`, `call_log.stage='Sold'`. Identical to pre-fix. |
| 3 | TEST job, P1 fanned out via Multi-GC wizard into 3 sisters | Internal-approve P1a | P1a → `status='Signed'`, `call_log.stage` unchanged, `qb-create-job` not invoked. Sister branch still works post-fix. |
| 4 | Post-backfill: P2 on job 10116 should be `Sold`. Click `+ Create Invoice` from P2 detail. | — | Invoice modal opens, P2 in proposal picker. |

## 7. Time estimate

| Step | Estimate |
|---|---|
| Update `ProposalDetail.jsx:623-648` (handleInternalApprove + QB gate) | 10 min |
| Author B37 migration (`mark_proposal_signed` lineage rewrite) | 15 min |
| Run investigation + backfill SQL in prod | 10 min |
| Smoke matrix #1 + #4 on Vercel preview | 10 min |
| Smoke matrix #2 + #3 on Vercel preview | 10 min |
| Commit, push, merge, deploy | 5 min |
| **Total** | **~60 min** — one ERD loop. |

## 8. Risk assessment

- **Any code path intentionally treating sequential proposals as sisters?**
  Audit: **no.** Only sister-aware paths are (a) `clone_proposal_to_gcs` /
  `apply_source_edit_to_sisters` / `preview_sync_to_sisters` (already lineage,
  unchanged), (b) `mark_proposal_signed` (this fix), (c) `handleInternalApprove`
  (this fix), (d) `award_proposal` (out of scope — no UI yet).
- **Change orders.** Live on `call_log` (`is_change_order` / `co_number`), not
  proposals. CO proposals have separate `call_log_id`. No interaction.
- **Multi-GC §10 step 9 (Mark Awarded UI) — does this fix block it?** No. The
  fix narrows internal-approve + customer-sign to the same predicate the rest of
  Multi-GC code already uses — it converges, not diverges.
- **PostgREST schema cache.** Migration body change without signature change is
  safe; include `NOTIFY pgrst, 'reload schema'` belt-and-suspenders.

## 9. Critical files for implementation

- `src/components/ProposalDetail.jsx` — `handleInternalApprove` (623-654), QB gate (643-647)
- `supabase/migrations/20260514000000_c1_mark_proposal_signed_sister_aware.sql` — reference
- `supabase/migrations/20260519230000_sister_wtc_auto_lock.sql` — canonical lineage predicate (201-207)
- `supabase/migrations/<new>_b37_mark_signed_lineage.sql` — new migration
- `docs/BACKLOG.md` — add B37 row + B37-followup row (award_proposal deferred to §10 step 9)
