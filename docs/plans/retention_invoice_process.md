# Retention Invoice Process — Per-Invoice Release

**Repo:** sales-command
**Branch:** `feat/retention-invoice-process`
**ERD loop:** #30 — retention-invoice-process (locked 2026-06-01 10:49, fear: TIME, success: retention shown in invoice detail + "Bill Retention" button sends a retention invoice and handles QB)
**Mode:** plan → build in one loop
**Date:** 2026-06-01

---

## §0 Reproduction (current-state observation)

This is a **feature** (net-new capability), not a bug fix — so the "pre-fix
state" is the *observed absence* of the release path, verified against the code
on `feat/retention-invoice-process` (off `main` @ pulled HEAD) on 2026-06-01.
All evidence below is third-party reproducible via grep.

**Click-path (manual):** open any invoice carrying retention on the detail
screen → the action bar has Sync to QuickBooks / Send / Edit / etc., but **no
"Bill Retention" control**. Held retention has no UI path to ever be billed.

**Evidence (reproducible):**
1. No release control or release-link exists:
   `grep -rn "Bill Retention\|Release Retention\|retention_release\|retainage_released" src/ supabase/functions/`
   → **0 matches** in app/edge code.
2. `retainage_released` is a never-written stub:
   `grep -rn "retainage_released" src/ supabase/ | grep -iE "update|set|insert|true"`
   → only hit is the migration **comment** (`20260416175646:166`); no code path
   sets it. Column is default `false` for every invoice row.
3. The link column doesn't exist yet:
   `grep -rln "retention_release_of" supabase/migrations/` → **0 matches**.
4. QB sync handles retention **negative-only** today:
   `qb-sync-invoice/index.ts:254,259` → `Amount: -retentionAmt`,
   `UnitPrice: -retentionAmt`. There is no positive/release branch — so even if
   a release invoice were created manually, QB would mis-handle it.

**Conclusion:** the withhold path is complete; the release path is entirely
absent at UI, state-flag, link-column, and QB layers. This plan adds exactly
those four.

---

## 0. Problem & scope

Today the app handles the **withhold** side of retention end-to-end; it has no
**release** side. There is no way to bill the previously-held retention back to
the customer.

**This loop ships the per-invoice release path only.** A "Bill Retention" button
on an invoice's detail screen spawns a new retention release invoice for the
amount held on that invoice, marks the source released, and syncs to QB so the
held dollars move out of Other Current Asset and back into A/R.

**Explicitly OUT of scope** (guards against the locked TIME fear of a week-long
balloon):
- Per-job / cumulative release across multiple invoices or pay-apps.
- Retention reminders / scheduled emails (backlog F5).
- Multi-tenant QB retention-item auto-onboarding (backlog F7).
- Pay-app release flow / `release_waiver_url`.

---

## 1. What already exists (verified, do not rebuild) `[LOCKED]`

| Capability | Status | Location |
|---|---|---|
| Invoice retention % input (new + edit) | shipped | `src/pages/Invoices.jsx:508-513`, `:1217-1218` |
| Invoice detail shows "Less Retention (X%)" line | shipped | `src/pages/Invoices.jsx:856-863` |
| Invoice detail stat cards (Gross Billed / Retainage Held / Payment Due) | shipped | `src/pages/Invoices.jsx:1520-1526` |
| Retention list view + totals | shipped | `src/pages/Invoices.jsx:1762, 1840-1841, 1919` |
| QB sync: retention as **negative** "1121- Retention %" line (routes held $ to Other Current Asset; A/R shows net) | shipped | `supabase/functions/qb-sync-invoice/index.ts:236-274` |
| `send-invoice` computes net = amount − discount − retention; email breakdown row | shipped | `supabase/functions/send-invoice/index.ts:70-84, 212-225` |

So the success criterion "retention shown in invoice detail screen" is **already
met** for invoices that carry retention. The new work is the release button +
release invoice + QB positive line.

### Schema facts (verified against migrations) `[LOCKED]`

On `public.invoices`:
- **Active (used by all code):** `retention_pct numeric`, `retention_amount numeric`
  — added in `20260420170000_invoices_retention.sql`.
- **Legacy stubs (default 0/false, never written by current code):**
  `retainage_pct`, `retainage_amount`, `retainage_released boolean` — added in
  `20260416175646_billing_schedule_and_archive_links.sql:168-175`. The
  `retainage_released` comment reads: *"flips true when a final/release invoice
  pays it out."*

> **Round-1 audit amendment (2026-06-01):** the original plan reused the legacy
> `retainage_released` as the release flag. The audit flagged the legacy-vs-active
> naming hazard (everything else reads `retention_*`). **Decision: do NOT reuse
> the legacy stub** — add a new `retention_released boolean` on the active
> `retention_*` convention (see §2.1). The legacy `retainage_released` stays an
> untouched stub.

---

## 2. Design `[DESIGN-OPEN → ratified 2026-06-01; revised round-1 + round-2 (scope-cut) 2026-06-01]`

### 2.1 Migration

```sql
-- Per-invoice retention release: link + active-convention flag.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS retention_release_of text
    REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS retention_released boolean DEFAULT false;
```

- `retention_release_of` non-null ⟹ this row **is** a retention release invoice,
  and the value is the source invoice id (link back + flag in one column).
  - **`ON UPDATE CASCADE` / `ON DELETE RESTRICT`** (round-2 audit): kept for
    **consistency with the sibling invoice FKs** (`invoice_lines.invoice_id`,
    `billing_schedule_pay_apps.invoice_id`), which declare the same clauses. The
    round-2 audit confirmed **no app code path updates `invoices.id` or
    hard-deletes invoice rows** — so both clauses are harmless no-ops here, **not
    load-bearing** integrity guards. They cost nothing and match house style; do
    not reason about them as if they enforce anything at runtime.
- `retention_released boolean` (round-1 audit #7) is the new release flag on the
  **source** invoice, on the active `retention_*` convention. The legacy
  `retainage_released` is left untouched — do NOT write it.
- Push procedure (per CLAUDE.md): run `scripts/check-migration-safety.sh`, then
  `npm run db:push` (collision check wrapper). Do not bypass the pre-push hook.

### 2.2 UI — `src/pages/Invoices.jsx` (detail screen)

- New **"Bill Retention $X"** button in the detail action bar.
  - **Visible when:** `retention_amount > 0 && !retention_released && !retention_release_of`.
  - **`disabled={billing}`** (round-1 audit #4): a `billing` in-flight state flag
    (mirrors the existing send-button busy pattern at `Invoices.jsx:1611`) is the
    real double-submit guard — set true on click, false on completion/error.
  - **Default (ratified):** NOT gated on source invoice being Paid first.
- `handleBillRetention(source)` — **order matters; wrap in `try/finally` so
  `setBilling(false)` always runs (round-2 audit):**
  1. `setBilling(true)` (outside the `try`, or first line of it).
  2. Mint next invoice id by reusing the existing sequence logic
     (`Invoices.jsx:240-245`: `parseInt`/`Math.max` over recent ids →
     `String(lastNum + 1).padStart(5, "0")`). Extract/reuse, do not duplicate
     a second id scheme.
  3. **UPDATE source FIRST**, conditionally, and verify rows-affected:
     `update({ retention_released: true }).eq("id", source.id).eq("retention_released", false).select()`.
     - **Check `error` AND that the returned array length ≥ 1.** RLS can silently
       no-op an UPDATE (returns no error, 0 rows) — a bare `.error` check is not
       enough (silent-failure class B40/F28; storage-remove-silent-noop lesson).
     - 0 rows affected ⟹ already released or RLS-blocked → abort + surface (the
       `finally` resets `billing`). The `.eq("retention_released", false)`
       predicate makes this the DB-level idempotency stop.
  4. **INSERT release invoice** (only after the source flip is confirmed):
     - `id = nextId`
     - `tenant_id = source.tenant_id` **(round-2 audit — required; do not omit)**
     - `amount = source.retention_amount`
     - `retention_pct = 0`, `retention_amount = 0`, `discount = 0`
     - `status = "New"`
     - copy `job_id`, `job_name`, `proposal_id`, `call_log_id`, `show_cents`
     - `description = "Retention release for invoice #" + source.id`
     - `retention_release_of = source.id`
     - **On INSERT error: revert the source flip** (`update({ retention_released: false }).eq("id", source.id).select()`).
       **Check the revert's rows-affected too (round-2 audit):** if the revert
       itself fails or affects 0 rows, raise a **loud, persistent** error that
       names the source invoice id and gives manual-recovery text (e.g. "Release
       invoice failed AND could not un-mark source #<id> — set
       `retention_released=false` on #<id> manually before retrying"). Do not
       swallow this — it is the only signal a source is stranded.
  5. After a confirmed success, refresh via the navigation path — **no optimistic
     `setInv`** (round-2 audit: it's dead code; the `key`-based remount on
     navigation refetches anyway). `onNavigateInvoice(nextId)` should also call
     `load()` so the source list/detail reflects the flipped `retention_released`.
- Once released, the source's button is replaced by a "Retention billed →
  #<release id>" note/link.

**Void / pull-back interaction (round-2 audit — scope-cut).** The existing void
/ pull-back flow spawns a **replacement invoice** (`handleVoidConfirm`,
`Invoices.jsx:1348`) that copies the source's fields. It currently copies
`retention_pct`/`retention_amount` but **not** the release flag — so voiding a
released source would produce a replacement with `retention_released=false`, and
the "Bill Retention" button would **reappear → double-bill**. **Fix = one line:**
copy `retention_released: inv.retention_released` into the replacement insert.
**Only `handleVoidConfirm` (`:1348`) spawns a replacement and needs this copy —
`handlePullBack` (`:1274`) updates the row in place (no new row), so it needs
nothing (round-3 audit confirmed).** That fully closes the double-bill risk for
this loop.

> **Full block/cascade void UX deferred to backlog item F34** (orphaned-release
> handling, paid-vs-unpaid branch, operator messaging). Not needed to ship the
> per-invoice release safely — the one-line flag copy above is sufficient.

### 2.3 Edge fn — `supabase/functions/qb-sync-invoice/index.ts`

> **QB sign is settled (round-1 audit):** the positive-line mirror is confirmed
> accounting-correct — a positive "1121- Retention %" line moves the held $ out
> of Other Current Asset back into A/R. Do **not** redesign the sign. The fixes
> below are about *line assembly precision*, not the accounting.

- Add `retention_release_of` to the invoice SELECT.
- **Gate the ENTIRE `qbLines` assembly on `retention_release_of` (round-1 audit
  #1).** Wrap the whole block at `:197-274` (normal-lines `:197-223`, discount
  `:225-234`, negative-retention `:236-274`) in an `if (retention_release_of) { … } else { … existing … }`.
  - **Why the whole block, not just `:236-274`:** a release row has **no
    `invoice_lines`**, so it falls into the `:211-223` "no lines → single total
    line" branch and pushes a `+amount` line on the **Services** item. If only
    the `:236-274` retention block were gated, the release invoice would still
    emit that Services line — wrong account (revenue, not retention asset) and,
    combined with any added release line, a **duplicate `+R`**. The gate must
    replace the entire assembly.
  - **Release branch produces exactly one line:** a positive
    `SalesItemLineDetail` on the retention item
    (`findItemExact("1121- Retention %") || "Retention" || "Retainage"`),
    `Amount = +invoice.amount`, `UnitPrice = +invoice.amount`, `Qty = 1`,
    `Description = "Retention release"`. No discount line, no normal lines, no
    negative block.
- **Release fallback when the retention item is NOT found (round-1 audit #2):**
  use a **positive `SalesItemLineDetail` on a safe default service item**, OR
  **hard-fail** with a `configure-item` error telling the operator to set up the
  retention item. **Never use `DiscountLineDetail` on the release path** — a
  discount line inverts the sign and would *reduce* A/R instead of increasing it
  (the existing `:264-272` discount fallback is correct only for the *withhold*
  case, which is the opposite sign). Recommended: hard-fail with a clear error,
  since silently parking a release in a default account misstates the books.
- Redeploy with `--no-verify-jwt`.

### 2.4 `send-invoice` — no code change

Release invoice has `retention_amount = 0`, so `netAmount = amount` and the
email breakdown omits the retention row. **Verify only** — confirm no regression.

### 2.5 PublicInvoicePage — no change

Renders a normal invoice for `amount`. No retention math involved.

---

## 3. Build order

1. Migration (`retention_release_of` FK + `retention_released` flag) → safety
   check → `npm run db:push`.
2. `Invoices.jsx` button + `handleBillRetention` (try/finally, conditional
   UPDATE→INSERT→checked-revert, `tenant_id`) + released-state note.
3. **Copy `retention_released` onto the void replacement insert**
   (`handleVoidConfirm`, `Invoices.jsx:1348`) — one line, prevents button
   reappearing → double-bill. (`handlePullBack` `:1274` updates in place — no
   change needed.)
4. `qb-sync-invoice` full-assembly gate + positive release line → deploy
   `--no-verify-jwt`.
5. Verify on Vercel preview (§4).
6. Update `docs/BACKLOG.md`: touches F6 (retainage-release; per-invoice path
   shipped, per-job still open) **and file new row F34** (full block/cascade void
   UX for orphaned releases — deferred per round-2 scope-cut).

---

## 4. Verification (success artifact for ERD #30)

On a **TEST customer**, on the Vercel preview deploy:
1. Create an invoice with retention (e.g. 10% on $48,000 → $4,800 held).
2. Confirm detail shows Gross Billed / Retainage Held / Payment Due (existing).
3. Confirm "Bill Retention $4,800" button appears.
4. Click → a release invoice spawns for $4,800; source flips to "Retention
   billed"; lands on the release invoice.
5. Sync release invoice to QB → confirm a **positive** "1121- Retention %" line.
6. **Primary success artifact (round-1 audit #8):** pull the QB **balance sheet**
   before and after the sync — post-sync it must show **Other Current Asset
   (Retention) decreased by R** and **A/R increased by R**. That ledger movement,
   not just the line item, is the proof the accounting is correct.
7. Screenshot of the invoice detail (button → released state) + the QB balance
   sheet delta.

---

## 5. Risk notes

- **Money path / QB.** The positive-line branch is the only money-affecting
  change. Verify the sign and the item mapping explicitly in QB before calling
  done.
- **Two-write integrity.** UPDATE source (verified rows-affected) THEN INSERT
  release; on INSERT failure, revert the source flip (§2.2). RLS can silent-no-op
  an UPDATE, so check rows-affected, not just `.error` (B40/F28).
- **Idempotency.** Double-billing is prevented by (a) the `disabled={billing}`
  in-flight flag during the async write and (b) the conditional UPDATE
  (`.eq("retention_released", false)`) which affects 0 rows on a second attempt.
  The button-visibility predicate is a UI convenience, **not** the safety
  guarantee — do not rely on it to prevent double-billing.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-01 (round 2 refresh). Consumed by `/runaudit` to size the adversarial audit pass._

### Round
- Current round: 2
- Plan revision under audit: `10c62d1` (Plan revision pass 1 — round-1 audit response)
- Findings trend: round 1 (6: 0C/3H/3M/0L) → round 2 (?). **Watch for plateau** — see below.

### Prior rounds
- Round 1: `10c62d1` · 0C/3H/3M/0L · pattern: `qb-line-precision`

**Briefing for agents**: do NOT re-find round-1 issues. Round 1 already addressed, in `10c62d1`: (1) gate the entire `qbLines` assembly on `retention_release_of`; (2) release fallback = positive item or hard-fail, never DiscountLineDetail; (3) UPDATE-source-first with rows-affected check; (4) `billing` in-flight flag + disabled button; (5) FK `ON UPDATE CASCADE` / `ON DELETE RESTRICT`; (6) void/soft-delete cascade rule; (7) new `retention_released` column (not legacy reuse); (8) balance-sheet success artifact. **The QB positive-line sign is SETTLED — confirmed accounting-correct in round 1. Do NOT re-litigate the sign.** Attack ONLY material new to `10c62d1`.

**⚠ Plateau signal — read before sizing.** The round-1 revision grew the plan 195 → 337 lines (+73%) by ADDING mechanism (void/cascade rule, conditional-update + revert-on-failure path, FK cascade semantics, hard-fail fallback). This is the classic scope-creep-via-revision pattern. **If round 2 surfaces ≥ round-1's 6 findings, treat it as plateau: `/runaudit` MUST present scope-cut (ship the minimal per-invoice release, defer the void/cascade edge handling to a follow-up) as the build-prompt option — NOT another "add more mechanism" round.** A 60-min loop cannot absorb a third mechanism-growth pass.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked on F7
- **Prod / staging / dev**: affected surface (invoices detail + qb-sync-invoice) is **live in prod** for HDSP; build + verify happen on a Vercel preview off `feat/retention-invoice-process`
- **Blocking feature flags**: none gate retention; `requires_pay_app` only routes pay-app vs regular invoice (retention exists on both paths)
- **Concurrency profile**: solo / ≤5 (single small team on HDSP)

Agents weight severity against these: cross-tenant findings cap at Med while `live_tenants == 1`; multi-user race findings cap at Low while ≤5 concurrent. Theoretical attacks on state that doesn't exist yet are not High.

### Time budget + finding cap
- **Time budget**: 60 min (ERD loop #30 lock: "1hr")
- **Finding cap**: 6 findings

Synthesis MUST surface only the top-6 most consequential findings. Remainder → "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: 337 (was 195 at round 1; +73%)
- Sections: 7 (§0 Reproduction, §0 Problem, §1 Exists, §2 Design, §3 Build order, §4 Verification, §5 Risk)
- [LOCKED] decisions: 2 (§1 existing-capability table; §1 schema facts)
- [DESIGN-OPEN] items: 1 (§2 Design — ratified 2026-06-01, revised round-1)
- [OPEN] items: 0
- Plan-to-code ratio: 337 : ~120 ≈ 2.8:1 (healthy; growth is spec detail, not bloat — but see plateau signal)

### Layers touched
- UI / components (`Invoices.jsx` detail action bar + handler + `billing` flag + void/soft-delete path)
- State model (new `retention_release_of` FK + new `retention_released` flag)
- Migrations / schema (two additive columns on shared Supabase project; FK cascade rules)
- Edge functions / API routes (`qb-sync-invoice` full-assembly gate + release branch + hard-fail fallback)
- External integrations (QuickBooks line items; OCA → A/R movement; balance-sheet verification)
- Data layer (conditional UPDATE-then-INSERT with revert-on-failure)

### New mechanisms introduced (in `10c62d1`, vs round 1)
- New column: `invoices.retention_released boolean` (active-convention release flag; replaces planned legacy reuse)
- FK cascade semantics: `retention_release_of ... ON UPDATE CASCADE ON DELETE RESTRICT` on a renumbering **text** PK
- Conditional write path: `UPDATE ... .eq("retention_released", false).select()` rows-affected check + **revert-on-INSERT-failure**
- Void/soft-delete cascade rule: block-or-cascade an unpaid release when its source is voided (paid release = independent)
- QB release fallback: hard-fail with `configure-item` error when retention item not found

### Cross-system reach
- QuickBooks (external) — release invoice moves held $ from OCA into A/R; round 2 focus = line-assembly gate exclusivity + fallback, NOT the (settled) sign
- Shared Supabase project (`pbgvgjjuhnpsumnowuym`, shared with sch-command/field-command) — migration must run through `npm run db:push` collision check (O7)

### Irreversibility
- Migration: additive (`ADD COLUMN IF NOT EXISTS` ×2) — reversible at schema level, but ledger-coordinated across repos (must not collide)
- Release invoices are real rows + real QB invoices (money-bearing, externally visible; voidable but not silently undoable)
- `ON DELETE RESTRICT` now hard-blocks source deletion while a release links to it — a behavior change to the existing invoice-delete path

### Known weak points (round-2 — new material only)
- **Revert-on-failure can itself fail** (§2.2 step 4): if the INSERT fails and the compensating `retention_released=false` revert ALSO fails (network/RLS), the source is stranded as released-with-no-release-invoice. No third-level guard specified.
- **FK cascade on renumbering text PK** (§2.1): `ON UPDATE CASCADE` assumes id renumber-to-DocNumber happens via a single-row UPDATE of `invoices.id`. If renumbering is implemented as delete+reinsert (not UPDATE), CASCADE never fires and the link dangles. Verify the actual renumber mechanism.
- **`ON DELETE RESTRICT` vs existing delete path** (§2.1/§2.2): existing invoice soft-delete/void code may attempt hard deletes that now throw an FK violation it doesn't catch — could surface as an opaque 500 on an unrelated delete flow.
- **Void rule is prose, not spec** (§2.2): "block OR cascade-void" leaves the choice unmade; the paid-vs-unpaid branch and where it's enforced (UI vs edge fn vs trigger) are unspecified — an implementer could pick differently than intended.
- **Optimistic `setInv` vs navigate race** (§2.2 step 5): optimistic state update immediately followed by `navigate()` to the new invoice — confirm the optimistic write doesn't apply to the wrong record after navigation remounts the detail view (stale-state class; cf. `key={sel.id}` remount lesson from B34).

### Open questions
- Count: 0 formal open questions (design ratified; round-1 items resolved in `10c62d1`)
- Highest-pressure: the void-rule "block OR cascade" choice (§2.2) is effectively an unresolved decision — agents should pressure whether leaving it open is shippable in a 60-min loop or should be scope-cut.

### Suggested attack angles (2 total)
1. **Write-path & void/cascade integrity** — covers UI + Data layer + State model. Required reading: plan §2.2 + §5, `src/pages/Invoices.jsx:232-296` (id mint + insert), existing invoice void/delete handlers (`handlePullBack`, `handleVoidConfirm`). Specific pressure: revert-on-failure double-fault; optimistic-`setInv`-then-`navigate` stale state; the unspecified block-vs-cascade void rule and its paid/unpaid branch; whether the conditional UPDATE truly closes the double-click window.
2. **Schema / FK-cascade / migration** — covers Migrations/schema + the QB gate's dependence on the new column. Required reading: plan §2.1 + §2.3, `supabase/migrations/20260420170000`, the invoice-renumber-to-DocNumber code path, `qb-sync-invoice/index.ts:197-274`. Specific pressure: does `ON UPDATE CASCADE` actually fire given how ids renumber (UPDATE vs delete+reinsert)? Does `ON DELETE RESTRICT` break the existing delete path? Is the `:197-274` full-assembly gate genuinely exclusive (no fall-through to the Services no-lines branch)?

### Suggested agent count: 2

Rationale: down from 3 — the QB sign is settled and round-1 closed the original money-path and idempotency findings, so round 2's genuinely-new surface concentrates in two clusters (write/void integrity, and FK-cascade/migration). A third agent would re-tread settled ground and push toward the plateau this manifest is warning against.
