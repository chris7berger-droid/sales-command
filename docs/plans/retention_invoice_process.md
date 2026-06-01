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
  pays it out."* — purpose-built for this feature.

---

## 2. Design `[DESIGN-OPEN → ratified 2026-06-01]`

### 2.1 Migration

```sql
-- docs: per-invoice retention release link
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS retention_release_of text REFERENCES public.invoices(id);
```

- `retention_release_of` non-null ⟹ this row **is** a retention release invoice,
  and the value is the source invoice id (link back + flag in one column).
- Reuse existing `invoices.retainage_released boolean` as the "this invoice's
  retention has been billed" flag on the **source** invoice. No new flag column.
- Push procedure (per CLAUDE.md): run `scripts/check-migration-safety.sh`, then
  `npm run db:push` (collision check wrapper). Do not bypass the pre-push hook.

### 2.2 UI — `src/pages/Invoices.jsx` (detail screen)

- New **"Bill Retention $X"** button in the detail action bar.
  - **Visible when:** `retention_amount > 0 && !retainage_released && !retention_release_of`.
  - **Default (ratified):** NOT gated on source invoice being Paid first.
- `handleBillRetention(source)`:
  1. Mint next invoice id by reusing the existing sequence logic
     (`Invoices.jsx:240-245`: `parseInt`/`Math.max` over recent ids →
     `String(lastNum + 1).padStart(5, "0")`). Extract/reuse, do not duplicate
     a second id scheme.
  2. INSERT release invoice:
     - `id = nextId`
     - `amount = source.retention_amount`
     - `retention_pct = 0`, `retention_amount = 0`, `discount = 0`
     - `status = "New"`
     - copy `job_id`, `job_name`, `proposal_id`, `call_log_id`, `show_cents`
     - `description = "Retention release for invoice #" + source.id`
     - `retention_release_of = source.id`
  3. UPDATE source: `retainage_released = true`.
  4. **Check both writes' `error` return** (silent-failure class — see B40/F28);
     halt + surface on error, do not proceed half-applied.
  5. `navigate()` to the new release invoice (URL-based routing per app
     convention).
- Once released, the source's button is replaced by a "Retention billed →
  #<release id>" note/link.

### 2.3 Edge fn — `supabase/functions/qb-sync-invoice/index.ts`

- Add `retention_release_of` to the invoice SELECT.
- If `retention_release_of` is set (release invoice):
  - Push a **single positive** line using the existing retention-item lookup
    chain (`findItemExact("1121- Retention %") || "Retention" || "Retainage"`),
    `Amount = +invoice.amount`, `Description = "Retention release"`.
  - **Skip** the normal line-item build **and** the negative-retention block
    (`:236-274`). This is the mirror of the withhold: moves held $ out of Other
    Current Asset back into A/R.
  - If the retention item isn't found, fall back consistently with the existing
    behavior (warn; positive amount lands in default account) — same caveat as
    today's withhold fallback.
- Redeploy with `--no-verify-jwt`.

### 2.4 `send-invoice` — no code change

Release invoice has `retention_amount = 0`, so `netAmount = amount` and the
email breakdown omits the retention row. **Verify only** — confirm no regression.

### 2.5 PublicInvoicePage — no change

Renders a normal invoice for `amount`. No retention math involved.

---

## 3. Build order

1. Migration (`retention_release_of`) → safety check → `npm run db:push`.
2. `Invoices.jsx` button + `handleBillRetention` + released-state note.
3. `qb-sync-invoice` positive-line branch → deploy `--no-verify-jwt`.
4. Verify on Vercel preview (§4).
5. Update `docs/BACKLOG.md` (touches F6 retainage-release; note per-invoice path
   shipped, per-job still open).

---

## 4. Verification (success artifact for ERD #30)

On a **TEST customer**, on the Vercel preview deploy:
1. Create an invoice with retention (e.g. 10% on $48,000 → $4,800 held).
2. Confirm detail shows Gross Billed / Retainage Held / Payment Due (existing).
3. Confirm "Bill Retention $4,800" button appears.
4. Click → a release invoice spawns for $4,800; source flips to "Retention
   billed"; lands on the release invoice.
5. Sync release invoice to QB → confirm a **positive** "1121- Retention %" line
   (held $ moves Other Current Asset → A/R; customer open balance increases by
   the retention).
6. Screenshot + QB confirmation.

---

## 5. Risk notes

- **Money path / QB.** The positive-line branch is the only money-affecting
  change. Verify the sign and the item mapping explicitly in QB before calling
  done.
- **Two-write integrity.** INSERT release + UPDATE source must both succeed or
  neither effectively counts — surface errors (silent-failure class B40/F28).
- **Idempotency.** The button's `!retainage_released && !retention_release_of`
  guard prevents double-billing a single source invoice. Confirm the UI hides
  the button immediately after the source update.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-01. Consumed by `/runaudit` to size the adversarial audit pass._

### Round
- Current round: 1
- Plan revision under audit: uncommitted at manifest time → committed in this same `Add audit manifest (round 1)` commit
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: do NOT re-find issues from prior rounds. (None exist yet — full surface is fair game this round.)

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
- Total lines: 195
- Sections: 7 (§0 Reproduction, §0 Problem, §1 Exists, §2 Design, §3 Build order, §4 Verification, §5 Risk)
- [LOCKED] decisions: 2 (§1 existing-capability table; §1 schema facts)
- [DESIGN-OPEN] items: 1 (§2 Design — ratified 2026-06-01)
- [OPEN] items: 0
- Plan-to-code ratio: 195 : ~90 ≈ 2:1 (healthy; not scope-crept)

### Layers touched
- UI / components (`Invoices.jsx` detail action bar + handler)
- State model (new `retention_release_of` column; reuse `retainage_released` flag)
- Migrations / schema (additive column on shared Supabase project)
- Edge functions / API routes (`qb-sync-invoice` positive-line branch)
- External integrations (QuickBooks invoice line items + Other Current Asset → A/R movement)
- Data layer (invoice INSERT release + UPDATE source)

### New mechanisms introduced
- New column: `invoices.retention_release_of text REFERENCES invoices(id)` (self-referential FK)
- New client handler: `handleBillRetention(source)` (mints id, two writes, navigates)
- New QB sync branch: positive "1121- Retention %" release line (mirror of existing negative withhold)

### Cross-system reach
- QuickBooks (external) — release invoice creates a QB invoice that moves held $ from Other Current Asset into A/R; sign + item-mapping correctness is the money risk
- Shared Supabase project (`pbgvgjjuhnpsumnowuym`, shared with sch-command/field-command) — migration must run through `npm run db:push` collision check (O7)

### Irreversibility
- Migration: additive (`ADD COLUMN IF NOT EXISTS`) — reversible at schema level, but ledger-coordinated across repos (must not collide)
- Release invoices are real rows + real QB invoices (money-bearing, externally visible; voidable but not silently undoable)

### Known weak points
- **QB sign / branch isolation** (§2.3): if the release branch doesn't fully replace normal line-item build, the release invoice could push *both* gross lines *and* a retention line → double-count. Verify the branch is exclusive.
- **Positive DiscountLineDetail fallback** (§2.3): the existing fallback uses `DiscountLineDetail` with a positive amount for the *withhold* case (discount semantics reverse sign). Re-using it for a *release* (positive) line may invert incorrectly — the fallback path for release is unspecified and a likely defect.
- **Two-write integrity** (§2.2 step 4, §5): INSERT release + UPDATE source are two separate writes; partial application (insert succeeds, flag update fails) leaves a release invoice with the source still showing the button. Silent-failure class (B40/F28).
- **Idempotency / double-click** (§5): button visible until `retainage_released` flips; a fast double-click could mint two release invoices. Low (solo) but real.
- **Legacy vs active column confusion** (§1): `invoices` carries both `retention_*` (active) and `retainage_*` (legacy). Reusing legacy `retainage_released` while everything else reads `retention_*` invites a future writer to touch the wrong column.
- **Net-amount assumption for send-invoice** (§2.4): claims "no change" because `retention_amount=0` ⟹ net=amount. If any send-path code branches on `retention_release_of` or pulls gross differently, that assumption breaks — verify, don't assume.

### Open questions
- Count: 0 formal open questions (design ratified 2026-06-01)
- Highest-pressure: none open; pressure should go on the §2.3 QB branch isolation + fallback sign (the unspecified release-fallback behavior is the closest thing to an open question).

### Suggested attack angles (3 total)
1. **QB money-path correctness** — covers Edge functions + External integrations + State model. Required reading: `supabase/functions/qb-sync-invoice/index.ts:236-274`, plan §2.3. Specific pressure: is the release branch mutually exclusive with the normal line build and the negative block? Is the sign correct (positive)? What does the `DiscountLineDetail` fallback do with a positive release amount — does it invert? Does A/R actually increase by exactly the retention?
2. **Two-write integrity + idempotency** — covers UI + Data layer + State model. Required reading: `src/pages/Invoices.jsx:232-296` (id mint + insert), plan §2.2. Specific pressure: both writes' errors checked? Partial-application state? Double-click race before `retainage_released` flips? Button guard `!retainage_released && !retention_release_of` correct and re-evaluated post-write? Id-mint reuse vs a second scheme?
3. **Schema / migration / cross-repo** — covers Migrations/schema. Required reading: plan §2.1, `supabase/migrations/20260416175646:160-176`, `20260420170000`. Specific pressure: self-referential FK on `invoices(id)` correctness; additive-column ledger coordination on the shared project; the legacy-`retainage_*` vs active-`retention_*` confusion and whether reusing `retainage_released` is safe.

### Suggested agent count: 3

Rationale: the formula scores 7 (≈5 layers + cross-system + ≥3 novel mechanisms) → capped, but the code surface is small (~90 lines) on a 60-min/6-finding budget, so 3 well-grouped angles (money-path, write-integrity, schema) cover all six layers without over-staffing — the documented sweet spot.
