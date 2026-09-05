# Shop Work / overhead record type — plan (own loop)

**Split out of the add-job dedup work on 2026-09-05** after the round-1 audit
showed the overhead record type carries ~half the risk (two-insert atomicity,
Field-crew visibility, billing leakage) for a fix whose core job was just "stop
new unlinked jobs." Chris ratified the split. The dedup guardrail ships first as
workstream A (`docs/plans/add_job_dedup_ideate_prompt.md`); this is its own loop.

**Status: DESIGN — not yet built, not yet audited.** Before build this doc needs
its own `## §0 Baseline` (verified current state) and an `/auditcriteria` →
`/runaudit` pass. The round-1 findings below (C, D, E, F) are carried forward as
mandatory design inputs so nothing rides along unowned (carry-across-boundaries
discipline).

## Locked design (from the ideate — unchanged by the split)

Shop work / training / no-customer work is a **first-class overhead record type**,
not an exception to the "every schedule job has a Sales record" rule. See the
parent doc's "Shop work / no-customer overhead — [LOCKED 2026-09-05]" section:

- A **"Shop Work"** button creates a real `call_log` record flagged **no customer
  · overhead**, born on the Sales side, also openable from the schedule "+ Job"
  modal. Button note: *"This work has no customer. It's overhead to the business."*
- **No visible job number** — hidden backend identifier only.
- Typed **overhead** → stays out of customer billing and job-cost.
- The import tool's "internal bucket" (old BuilderTrend 1111 rows) becomes Shop
  Work overhead records instead of raw null-`call_log_id` rows.

## Scope of this loop

1. **Schema — `call_log.is_overhead`** (authored in `command-suite-db`).
2. **`createShopWorkRecord()`** — shared helper; both entry points call it.
3. **Import → overhead** — `importData.js` internal bucket creates overhead
   records.
4. **Field / PowerSync** — overhead must not render as a customer-less crew card.
5. **Billing exclusion** — overhead never enters billing / forecast / pay-app.

## Round-1 audit findings carried in (MUST address here)

**F (schema, corrects a false claim in the parent plan).**
- `call_log` **IS anon-readable** under token SELECT policies
  (`prod_public_schema.sql:5654/5660`) and `PublicInvoicePage.jsx:43` anon-selects
  it (verified 2026-09-05). The parent plan's "authenticated-only, no public page
  selects it" was **wrong**. `is_overhead` inherits that exposure — acceptable
  (non-sensitive boolean, exploit capped Med) **only** because `is_overhead` is
  NOT added to `PublicInvoicePage`'s explicit select list. Do not add it there.
- Author the **paired rollback** in `command-suite-db`
  (`supabase/rollbacks/<ts>_revert_call_log_is_overhead.sql`) — the repo pairs
  every migration with a revert (20 exist); the parent plan authored none.
- Confirm `call_log.tenant_id DEFAULT get_user_tenant_id()` before relying on
  "never send tenant_id" in `createShopWorkRecord`.
- Rehearse from a prod-shaped throwaway before push (MIG-1 discipline):
  `cd ~/command-suite-db && ./scripts/rehearse.sh <migration>`.

**D (atomicity).**
- `createShopWorkRecord` inserts `call_log` then `jobs` client-side with no
  transaction → a failure on the 2nd insert strands an overhead `call_log` with no
  job = a NEW orphan class (the exact defect being killed). Mirror
  `rollbackNewJobRow` (`ProposalDetail.jsx:794`): delete-and-verify the first
  insert on failure (RLS delete can silently no-op — verify).
- Import is worse: `applyImport` is best-effort-sequential
  (`importData.js:111`) — a mid-loop failure half-migrates. **Batch all overhead
  `call_log` inserts first, then the `jobs` rows**, and handle partial failure.

**E (Field / PowerSync).**
- Overhead syncs to the offline crew app as a customer-less job: Field reads
  `call_log WHERE stage IN (...)` (`HomeScreen.js:60`) and renders `job_name` with
  no customer guard; the sync rule (`powersync-sync-rules.yaml:12`) + unconditional
  `SELECT * FROM jobs` pull it in. Shop-work **stage/status is unspecified →
  defaults `'Parked'` → lands in the sync filter.**
- Decide shop-work stage/status explicitly; edit `powersync-sync-rules.yaml` and
  the Field query/UI so overhead is either excluded from crew views or rendered
  with an explicit "overhead / no customer" treatment (no blank-customer card).
  **Sync-rule files were not in the parent plan's touch list — add them.**

**C (billing leakage).**
- The 90-day forecast is **invoice-driven, not job-driven**
  (`billingForecast.js:378`) and never selects `is_overhead`; the Invoices
  new-invoice picker (`Invoices.jsx:108`) can pick a Sold overhead proposal.
- `CALL_LOG_SELECT` / `INVOICE_SEL` don't fetch `is_overhead`, so **no reader can
  filter it yet** — add `is_overhead` to those selects, then exclude overhead from
  `billingForecast`, the invoice picker, and any pay-app surface.

## Adjacent (from round-1 J-list, relevant here)

- **J3** — `createShopWorkRecord` must write a `job_changes` audit row (queries.js
  convention).
- **J4** — spec the hidden identifier: generator (`crypto.randomUUID`, cf.
  queries.js:1058) + what `job_num` / `display_job_number` render as.
- **J5** — both doors (Sales + schedule) MUST call the shared
  `createShopWorkRecord()`; never re-implement inline (the drift this whole
  project exists to kill).
- **J6** — post-push: confirm `is_overhead` reaches the Field schema / PowerSync
  column allow-list (sync rules live in the PowerSync dashboard, out of the DB
  ledger).
- **J8** — Field `HomeScreen`/`JobListScreen` render `job_name` unconditionally;
  harden for customer-less rows.

## Next step

Write `## §0 Baseline` (verified current state of the 5 scope areas), then
`/auditcriteria` → `/runaudit` this doc before build.
