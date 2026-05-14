# Multi-GC Proposal Allocation — Design Plan

_Draft v0.2, re-derived 2026-05-11. Owner: Plan subagent (read-only); main session executes file writes on `feat/multi-gc-allocation`. Section tags: **[LOCKED]** (durable from v98/memory, do not re-derive) · **[DERIVED]** (mechanical from schema/precedent) · **[DESIGN-OPEN]** (needs Chris's input) · **[BLOCKED]** (depends on C1–S1 or H-C2/H-B2/F7)._

---

## §1 Problem statement

**[LOCKED]** Sales reps frequently receive RFPs from multiple General Contractors for the same underlying project (owner + jobsite + scope). Today they rebuild the proposal N times in Sales Command, generating typo drift, divergent pricing, and zero project-level pipeline visibility. The product gap: one project mentally, but N disconnected proposals in the data model.

**[LOCKED]** Multi-GC Proposal Allocation lets reps **build once, allocate to N GCs** by cloning a parent proposal into sister proposals stacked under a single shared `call_log` row. Sisters share content (scope of work, sizes, materials) sourced from the parent; they diverge on commerce (GC customer, RFP#, due date, markup, signed PDF). When a winner is awarded, sisters auto-flip to Lost.

**[LOCKED]** Scope of this plan: schema additions, one clone RPC, two sync RPCs, an award-flow RPC, a 4-screen wizard, and the migration of three customer-jobs surfaces to the new fallback pattern. Not in scope: the underlying RFP intake form, change-orders on sisters, multi-tenant RLS for sister cross-tenant scenarios (F7 handles that orthogonally).

---

## §2 Locked decisions

**[LOCKED]** (durable from v98, do not reopen)

| # | Decision |
|---|----------|
| Q1 | One `call_log` per project. `call_log.job_name` = project title (no new column). Sisters stacked under it. On Mark Awarded → winner → `proposals.status='Sold'` + `call_log.stage='Sold'`; sisters → `proposals.status='Lost'` + `lost_reason` + `lost_at`. Reversible. Never hard-deleted. |
| Q2 | Source-driven sync on content: `proposals.intro`; `proposal_wtc.sales_sow` (text) + `field_sow` / `materials` / `sub_areas` / `travel` (jsonb) + `size` / `unit` / `discount` / `discount_reason`. Per-GC on commerce: customer, contact, RFP#, due date, markup override. Sister overrides via `proposal_wtc.locally_edited_fields text[]`; conflict prompt fires when a source-edit hits an overridden field. |
| Q3 | Resolved by Q1. |
| Q4 | Two entry surfaces, one wizard: ProposalDetail `+ Send to Additional GCs` and CallLogDetail `+ Add Another GC`. |
| Q5 | Forward-only. No retro-link UI. Manual SQL for rare in-flight cases. |
| Sweep-1 | Nullable `proposals.customer_id` FK → `customers`. NULL falls back to `call_log.customer_id`. Client reads `p.customer_id ?? p.call_log?.customer_id` everywhere. |
| Sweep-2 | Nullable `proposals.markup_override_pct numeric`. Per-proposal multiplier on top of per-WTC `markup_pct`. |

---

## §3 Schema additions

**[DERIVED]** Single migration `supabase/migrations/20260513000000_multi_gc_allocation.sql` (slot is open — 0510 is the most recent applied). All columns nullable so the migration is reversible without data loss; F7-clean: every new column on a tenant-scoped table gets implicit `tenant_id` inheritance via parent FK.

**Sweep-1 — `proposals.customer_id`**
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_customer_id ON public.proposals(customer_id);
```
Semantics: NULL = inherit from `call_log.customer_id`. Backfill: none — every existing row reads through fallback. Trigger NOT added (we want NULL-means-inherit to be explicit, not auto-populated).

**Sweep-2 — `proposals.markup_override_pct`**
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS markup_override_pct numeric;
```
Semantics: NULL = no override. Effective per-WTC markup = `(proposal_wtc.markup_pct + COALESCE(p.markup_override_pct, 0))` (additive, not multiplicative — **[DESIGN-OPEN]** confirm with Chris: additive vs. multiplicative). `calc.js` must be updated.

**Sisters lineage — `proposals.cloned_from_proposal_id`**
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS cloned_from_proposal_id text
    REFERENCES public.proposals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_cloned_from ON public.proposals(cloned_from_proposal_id);
```
**[DERIVED]** Type is `text` (proposals.id is text — C4 resolved). Parent row has NULL; each sister points back to its parent. Used by sync RPCs to fan out source edits, and by award flow to find siblings under a `call_log`.

**Award-flow loss tracking — `proposals.lost_reason`, `proposals.lost_at`**
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz;
```
**[DERIVED]** Free-text reason. Set only by `award_proposal()` RPC and the reversal RPC. Index unnecessary (low-cardinality, write-once-mostly).

**Sister overrides — `proposal_wtc.locally_edited_fields text[]`**
```sql
ALTER TABLE public.proposal_wtc
  ADD COLUMN IF NOT EXISTS locally_edited_fields text[] NOT NULL DEFAULT '{}';
```
Stores the list of source-driven field names this WTC has locally overridden (e.g. `{'sales_sow','materials'}`). Sync RPCs read this to skip / prompt-on-conflict. `proposal_wtc` does NOT have its own tenant_id (it inherits from parent proposal); no RLS change needed.

**Audit table — `proposal_clones`**
```sql
CREATE TABLE IF NOT EXISTS public.proposal_clones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_proposal_id text REFERENCES public.proposals(id) ON DELETE SET NULL,
  sister_proposal_id text NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  call_log_id     integer NOT NULL REFERENCES public.call_log(id) ON DELETE CASCADE,
  wtc_count       integer NOT NULL,
  cloned_by       uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  cloned_at       timestamptz NOT NULL DEFAULT now(),
  tenant_id       uuid NOT NULL DEFAULT public.get_user_tenant_id()
                    REFERENCES public.tenant_config(id)
);
```
**[DERIVED]** Mirrors `call_log_merges` audit-row precedent. Full RLS block (SELECT scoped on tenant; INSERT scoped on tenant + `is_admin_or_manager()` — or just tenant, depending on whether wizard can be invoked by sales reps — **[DESIGN-OPEN]**).

**Ratified 2026-05-12:** admin/manager-only for INSERT/UPDATE/DELETE; will relax if F15 sales-rep clone access is enabled. Also: `parent_proposal_id` is nullable (no `NOT NULL`) — the original `NOT NULL REFERENCES … ON DELETE SET NULL` shape was self-contradicting (parent hard-delete would abort the cascade with a NOT NULL violation). Sister-side `sister_proposal_id` stays `NOT NULL` with `ON DELETE CASCADE` since the audit row is meaningless without its sister.

**Open schema question — [DESIGN-OPEN]**
- Do sisters need their own `proposal_number` series, or do they share the parent's number and disambiguate by GC name only? Today `proposal_number` is unique per call_log (no DB constraint, but UI assumes it). The clone RPC has to assign new numbers; suggest `parent_number, parent_number+1, parent_number+2…` continuing from current max on the call_log. Ask Chris.

---

## §3 Schema Amendment — Round 5 Surfaced

_Surfaced and ratified 2026-05-11. The §7 wizard re-spec exposed two columns missing from the locked §3 schema additions, both required to implement the Q2 commerce-is-per-GC list. Land as an amendment block here rather than silently overwriting §3 — preserves the audit trail of what was locked when._

Round 5's Screen 2 spec needs three commerce fields **per sister**: customer (already covered by Sweep-1's `proposals.customer_id`), RFP#, bid due date, billing terms. Of those, `rfp_number` and `bid_due_date` have no host today — they'd otherwise have to be smuggled into `call_log` (wrong scope; call_log is project-level) or dropped entirely (loses commercial fidelity). `billing_terms_override` was also surfaced as a candidate but is **rejected** — `customers.billing_terms` (CLAUDE.md:121, integer default 30) already covers it via Sweep-1's `proposals.customer_id` lookup. No evidence in v98 or any subsequent round that reps need a per-proposal override on top of the per-customer setting.

**Schema additions** (target migration: same `supabase/migrations/<timestamp>_multi_gc_allocation.sql` that holds Sweep-1 + Sweep-2 + UNIQUE + intro flag column + intro trigger):

```sql
-- Round 5 §7 wizard Screen 2 — per-GC commerce fields beyond customer_id.
-- Both nullable, no default. tenant_id inherited via parent proposals row.
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS rfp_number  text,
  ADD COLUMN IF NOT EXISTS bid_due_date date;

COMMENT ON COLUMN public.proposals.rfp_number IS
  'GC-supplied RFP/bid number, per-proposal. Distinct from proposal_number '
  '(internal sequence). Captured by the multi-GC wizard Screen 2 and may also '
  'be set manually on single-GC proposals. Internal-only (not returned to '
  'anon callers via get_public_proposal_view).';

COMMENT ON COLUMN public.proposals.bid_due_date IS
  'Per-proposal bid due date supplied by the GC. Drives reminders + sort '
  'priority on Proposals.jsx. Captured by multi-GC wizard Screen 2; may '
  'also be set manually. Distinct from call_log.bid_due which is the '
  'project-level inquiry date.';
```

**Explicit skip — `billing_terms_override`.** Sweep-1 added `proposals.customer_id`. Each sister proposal's billing terms read through `customers.billing_terms` (per-GC, already exists). A per-proposal override would let one GC's proposal use different terms than the GC's customer record — no evidence reps need this, and the additional column would invite confusion about which value is canonical. **Reject.**

**Display rules.** Both fields are internal-only. `rfp_number` displays on ProposalDetail header + Proposals list view + PDF cover (already a feature on the PDF template — confirm in implementation). `bid_due_date` displays on ProposalDetail header + Proposals list sort. Neither is returned by `get_public_proposal_view` (the customer doesn't need to see their own RFP# echoed back at them on a signing page).

**Backward-compat.** New nullable columns, no DEFAULT. Zero existing-read breaks. Existing single-GC proposals carry NULL on both fields until a rep manually fills them in — acceptable, matches today's behavior where the same data is held informally in `call_log.bid_due` and `call_log.job_name` or not at all.

**Sync semantics.** Both fields are commerce, per-GC (Q2). `clone_proposal_to_gcs` writes them per-sister from the wizard's `p_targets` jsonb (extend §4 RPC body to read `(v_target->>'rfp_number')::text` and `(v_target->>'bid_due_date')::date`). They are NOT in the §5 source-driven sync field list — source edits do not fan into sisters.

---

## §3 Markup Arithmetic — Resolution

_Resolved 2026-05-11 (Round-4 Plan agent). Picks up the Sweep-2 `markup_override_pct` math sub-question. Reads v109-era code on `feat/multi-gc-allocation`. All line citations are against the unmodified working tree._

### 1. Pre-question answers (with evidence)

**Q1. Live `calcWtcPrice` formula. Where does `markup_pct` enter?**

`src/lib/calc.js:60-74`:
```js
export function calcWtcPrice(wtc) {
  const rate   = wtc.prevailing_wage ? (wtc.pw_rate    || 0) : (wtc.burden_rate    || 0);
  const otRate = wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0);
  const labor = calcLabor({
    regular_hours: wtc.regular_hours, ot_hours: wtc.ot_hours,
    markup_pct: wtc.markup_pct,
    burden_rate: rate, ot_burden_rate: otRate, size: wtc.size,
  });
  const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRow(i), 0);
  const trav = calcTravel(wtc.travel);
  return Math.ceil(labor.total + mats + trav - (wtc.discount || 0));
}
```

`proposal_wtc.markup_pct` is consumed in exactly one place: as the `markup_pct` argument to `calcLabor`. Inside `calcLabor` (`calc.js:5-14`):
```js
const subtotal  = regularCost + otCost;                          // labor cost only
const markupAmt = subtotal * ((markup_pct || 0) / 100);
const total     = subtotal + markupAmt;
```

**`proposal_wtc.markup_pct` applies ONLY to labor cost** (regular_hours × burden + ot_hours × ot_burden). Does NOT touch materials or travel. UI confirms: `WTCCalculator.jsx:392` hints `"Markup is applied to total labor cost only — not materials"`.

Important asymmetry: each material line carries its own `item.markup_pct` (per-row markup, applied in `calcMaterialRow`, `calc.js:16-25`). Travel has no markup (`calcTravel`, `calc.js:27-34`, is flat sum of rate × quantity).

Therefore "effective_markup_pct" — if framed as a single number — only operates on the labor leg. A proposal-level multiplier framed as "effective_markup_pct" must EITHER (a) operate only on labor (mirroring `proposal_wtc.markup_pct`), OR (b) be redefined to mean something else.

**Q2. Existing precedents for proposal-level multipliers/discounts?**

- **`proposal_wtc.discount` (per-WTC, flat dollar)** — `CLAUDE.md:131-136` and `calc.js:53,73`. Subtracted AFTER labor markup + materials + travel: `Math.ceil(labor.total + mats + trav - (wtc.discount || 0))`. Per-WTC, dollar amount, requires `discount_reason` to lock (`WTCCalculator.jsx:1786-1790`). Renders on ProposalDetail as Subtotal/Discount/Total ladder (`ProposalDetail.jsx:1054-1078`).
- **No proposal-level discount today.** Discount is per-WTC only.
- **No proposal-level multiplier today.** Nothing in `tenant_config` (CLAUDE.md:172-181), nothing in `proposals` schema (CLAUDE.md:108-111).
- **No bulk-adjust UX.** `WTCCalculator.jsx:1763-1773` syncs `prevailing_wage`/`pw_rate`/`pw_ot_rate` across sibling WTCs but that's column-mirror, not multiplier.

Closest precedent is `proposal_wtc.discount` (per-WTC, flat-dollar, subtracted at end). The new column lives one level up — same flat-numeric, nullable-means-none pattern, different scope.

**Q3. Range of `proposal_wtc.markup_pct` in real prod data?**

No CHECK constraints anywhere in `supabase/migrations/` (grep `CHECK.*markup` / `CHECK.*pct` = zero). UI Field at `WTCCalculator.jsx:396` is `<Field type="number" suffix="%" />` with no min/max. No `default_markup_pct` in `tenant_config`. No `DEFAULT_MARKUP` constant in `src/lib/`.

**Stated assumption:** typical sales-rep entries are 10–30% labor markup. Negative values technically allowed today (no CHECK), but no app-layer evidence this is intentionally exercised. Conservative read: `[0, 100]` with long tail in `[10, 50]`.

**Implication for Option A (additive):** typical 10–30 baseline; a "-5pp" knock-off on a tough GC lands cleanly. A "-15pp" can push effective below zero on low-markup WTCs — reachable edge but only when both inputs are atypical. Clamp at app layer, not error.

### 2. Recommendation — **Option A (additive), with floor-clamp.**

```
effective_markup_pct = Math.max(0, (wtc.markup_pct || 0) + (p.markup_override_pct || 0))
```

**Rationale.** User mental model for sales reps is "percentage points," not "scale factors" — they enter a WTC at 25% markup, then think "this GC is tougher, drop everything by 5 points." Additive maps to that 1:1. Option B (scale-on-existing) and Option C (compound) silently change math at edges in ways reps won't predict. Option D (replace) destroys per-WTC tuning, the entire point of the per-WTC `markup_pct` column. Option E (hybrid floor/cap) adds two semantics to one column — reject.

The precedent from `proposal_wtc.discount` is "absolute, at the end, with a reason." Not perfectly mirroring (per-proposal not per-WTC; operates on markup not price), but additive percentage-points is closest shape that's still "in the rep's units." Floor clamp prevents negative-labor-markup pathology without rejecting input — reps can punch `-20` on a 25-markup WTC and get 5; on a 10-markup WTC they get 0, not -10. Override never silently inflates customer price; worst case pulls a WTC to zero-markup labor.

Column name `markup_override_pct` is mildly misleading under additivity ("override" implies replacement). Sweep-2 naming is locked from v98; document the semantic clearly in code comments + CLAUDE.md so future readers don't infer "replace" from the name.

**Scope clarification:** the override applies ONLY to the labor leg (the `markup_pct` argument of `calcLabor`). It does NOT touch per-material `item.markup_pct` and does NOT add markup to travel. Reason: this matches what `proposal_wtc.markup_pct` does today; expanding the scope of the override would expand the scope of the original column at the same time, which is out of scope for Sweep-2. Doing otherwise would break the PDF aggregation in `ProposalPDFModal.jsx:174-190` (which sums labor through `calcLabor` and materials through `calcMaterialRow` separately).

If reps want a proposal-level "all-up multiplier on price," that's a different feature with a different name. Don't smuggle it in under `markup_override_pct`.

### 3. Concrete artifacts

#### 3a. `calc.js` change — `calcWtcPrice` and friends accept optional `markup_override_pct`

Adding an optional parameter beats a wrapper because every existing call site (`grep calcWtcPrice` returns 14 hits across `ProposalDetail.jsx`, `Invoices.jsx`, `WTCCalculator.jsx`, `lib/invoicePdf.js`, `PublicInvoicePage.jsx`, `ProposalPDFModal.jsx`) needs the override applied — sister proposals must compute totals with override folded in, or `handleLock`'s stored total won't match what the customer sees. A wrapper would be opt-in and silently fail for callers we forget to migrate.

```js
// src/lib/calc.js — proposed body, drop-in

// markup_override_pct is a per-proposal additive shift on the per-WTC
// labor markup_pct, introduced by Multi-GC §3 (Sweep-2). Applies ONLY
// to labor — not to per-material markup, not to travel. Clamped at zero
// floor so a large negative override on a low-markup WTC produces a
// zero-markup labor line (not negative). NULL/undefined behaves as 0.
function effectiveLaborMarkupPct(wtc, markup_override_pct) {
  const base = parseFloat(wtc?.markup_pct) || 0;
  const ovr  = parseFloat(markup_override_pct) || 0;
  return Math.max(0, base + ovr);
}

export function calcLabor({ regular_hours, ot_hours, markup_pct, burden_rate, ot_burden_rate, size }) {
  // unchanged
}

// calcMaterialRow and calcTravel unchanged — override does not touch them.

export function calcWtcBreakdown(wtc, markup_override_pct = 0) {
  const rate   = wtc.prevailing_wage ? (wtc.pw_rate    || 0) : (wtc.burden_rate    || 0);
  const otRate = wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0);
  const labor = calcLabor({
    regular_hours: wtc.regular_hours, ot_hours: wtc.ot_hours,
    markup_pct: effectiveLaborMarkupPct(wtc, markup_override_pct),
    burden_rate: rate, ot_burden_rate: otRate, size: wtc.size,
  });
  // ... rest unchanged ...
}

export function calcWtcPrice(wtc, markup_override_pct = 0) {
  const rate   = wtc.prevailing_wage ? (wtc.pw_rate    || 0) : (wtc.burden_rate    || 0);
  const otRate = wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0);
  const labor = calcLabor({
    regular_hours: wtc.regular_hours, ot_hours: wtc.ot_hours,
    markup_pct: effectiveLaborMarkupPct(wtc, markup_override_pct),
    burden_rate: rate, ot_burden_rate: otRate, size: wtc.size,
  });
  const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRow(i), 0);
  const trav = calcTravel(wtc.travel);
  return Math.ceil(labor.total + mats + trav - (wtc.discount || 0));
}

// Convenience wrapper for "sum all WTCs for a proposal." Reads override
// off the proposal row once and threads it through. Replaces the inline
// reduce pattern in handleLock / handleSave / billing-schedule path.
export function calcProposalTotal(proposal, wtcs) {
  const ovr = parseFloat(proposal?.markup_override_pct) || 0;
  return (wtcs || []).reduce((sum, w) => sum + calcWtcPrice(w, ovr), 0);
}
```

Notes:
- All four exported functions retain current signatures (override defaults to 0). Existing call sites that don't pass an override behave exactly as before — useful for incremental rollout.
- `effectiveLaborMarkupPct` is private. Encodes the policy ("additive, floor-clamped, labor-only") in one place.
- `calcProposalTotal` is the canonical wrapper for "sum WTCs for proposal." Replaces the inline reduce pattern in three places today.

#### 3b. `handleLock` and other surfaces writing `proposals.total`

Per CLAUDE.md Data Integrity Rule #4, `handleLock` must update `proposals.total`. Two implementations:

**`WTCCalculator.jsx:1774-1804`** (calculator's lock toggle) — replace:
```js
const proposalTotal = allWtcs.reduce((sum, w) => sum + calcWtcTotal(w), 0);
```
with:
```js
const { data: prop } = await supabase
  .from("proposals")
  .select("markup_override_pct")
  .eq("id", proposalId)
  .single();
const proposalTotal = calcProposalTotal(prop, allWtcs);
```
Same pattern at `WTCCalculator.jsx:1774-1779` (`handleSave`).

**`ProposalDetail.jsx:218-273`** (WTC-toggle from proposal detail) — at `:247-250`:
```js
const { data: allWtcs } = await supabase.from("proposal_wtc").select("*, work_types(name)").eq("proposal_id", p.id);
const proposalTotal = calcProposalTotal(p, allWtcs);   // p in scope, carries markup_override_pct
await supabase.from("proposals").update({ total: proposalTotal }).eq("id", p.id);
```

`ProposalDetail.jsx:239` (`locked_line_total` snapshot) — must receive override:
```js
const computed = calcWtcPrice(wtc, parseFloat(p.markup_override_pct) || 0);
```

**Critical edge:** `locked_line_total` is the snapshot the public signing page reads via `get_public_proposal_view`. If the snapshot omits the override, customer sees a different per-WTC subtotal than the grand total. Snapshot at lock time = snapshot WITH override folded in. Same fix needed at `WTCCalculator.jsx:1811-1813`.

**Billing-schedule lines** (`ProposalDetail.jsx:262-267`) auto-create from `calcWtcPrice(w)`:
```js
const lines = allWtcs.map((w, i) => ({
  billing_schedule_id: sch.id,
  description: w.work_types?.name || `Work Type ${i + 1}`,
  scheduled_value: calcWtcPrice(w, parseFloat(p.markup_override_pct) || 0),
  ordinal: i,
}));
```

#### 3c. Range / clamp / validation

- **Allowed values:** any numeric. NULL = no override (semantic ≠ 0).
- **Realistic range:** ±50 percentage points.
- **No hard DB cap.** Floor clamp in `effectiveLaborMarkupPct` is load-bearing safety.
- **UI soft-validation:** wizard warns if `|markup_override_pct| > 25`, but allows.
- **No CHECK constraint on the column.** Reasons: (1) no precedent for percentage CHECK in this schema; (2) the `calc.js` floor clamp is the load-bearing safety; (3) a future "all-up price multiplier" feature might reuse the column at a wider range.

#### 3d. Display rules

| Surface | File:line | Show `markup_override_pct`? |
|---|---|---|
| Wizard Screen 3 (Pricing) | new component | YES — primary entry |
| ProposalDetail summary panel | `ProposalDetail.jsx:1021-1081` | YES — row above "Total" when non-NULL, "internal only" badge |
| ProposalDetail WTC list | `ProposalDetail.jsx:711` | YES — effective per-WTC price; tooltip explains override |
| WTCCalculator labor tab | `WTCCalculator.jsx:396` | YES — read-only hint "Effective markup: 20% (25% − 5% override)" when proposal has override |
| ProposalPDFModal aggregation | `ProposalPDFModal.jsx:172-190` | NO direct exposure, but totals reflect it (pass override through `calcLabor`) |
| Customer PDF body | `ProposalPDFModal.jsx:330+` | NO — markup never on customer-facing pricing |
| PublicSigningPage | `PublicSigningPage.jsx:553` | NO — reads `locked_line_total` snapshot only |
| `get_public_proposal_view` RPC | migration `20260505190300_*.sql:17,99,123` | NO — does not return `markup_override_pct` to anon caller (mirrors H6) |
| Invoices / PublicInvoicePage | `Invoices.jsx:171,417,789,1152,1416`; `PublicInvoicePage.jsx:189` | Invoice math reads `calcWtcPrice(wtc)` for SOV lines — pass override. Invoice shows dollar amounts, no markup column. |
| `proposals.total` | written by `handleLock` (§3b) | Stored value already includes override. |

**Key invariant:** `markup_override_pct` is internal-only. Customer never sees the number. Customer sees the effective dollar prices that result. Mirrors how `proposal_wtc.markup_pct` is handled today.

#### 3e. Migration delta

Sweep-2 column DDL from §3 already locked:
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS markup_override_pct numeric;
```

Recommended additions:
```sql
-- (no CHECK constraint — see §3c rationale)
COMMENT ON COLUMN public.proposals.markup_override_pct IS
  'Per-proposal additive shift (in percentage points) on per-WTC '
  'proposal_wtc.markup_pct. Applies to labor markup only, NOT per-material '
  'markup or travel. NULL = no override; 0 = explicit no-op. Effective '
  'labor markup is computed by src/lib/calc.js:effectiveLaborMarkupPct '
  'as max(0, wtc.markup_pct + p.markup_override_pct). Internal-only — '
  'never returned to anon callers (excluded from get_public_proposal_view).';
```

No CHECK. No DEFAULT. No backfill. Reversible by `ALTER TABLE … DROP COLUMN`.

### 4. Wizard Screen 3 UX (plain English)

Screen 3 is "Pricing." For each GC the rep selected in Screen 1, render one row with:

- **GC name** on left.
- **Markup override** numeric input, suffix `pp` (percentage points). Width ~80px. Placeholder: "e.g. -5". Help text: "Adds (or subtracts) this many points from every WTC's labor markup on this GC's proposal. Leave blank for no change."
- **Live preview total** on right: the would-be `proposals.total` if wizard were submitted with current inputs. Computed client-side via `calcProposalTotal({ markup_override_pct: input }, wtcs)`.
- **Per-WTC breakdown disclosure** — one click to expand, shows each WTC's effective price under the current override.

**Default value:** blank (NULL). Rep must type a number to opt in. Reinforces "parent proposal's pricing is default; only change for GCs that need it."

**Unit:** percentage points. Explicitly NOT "%" suffix (which would imply "5% scale-on-existing"). Suffix `pp` is industry-standard for additive percentage-point shifts. If design objects to `pp`, next-best is no suffix plus inline help text "(percentage points)."

**Soft-validation warning** when `|input| > 25`: amber message "Large markup override. Verify with manager." Doesn't block.

**Preview surfaces:** both proposal-level total and on-demand per-WTC breakdown. Reps think in "total price to this GC" first, then drill into per-WTC.

### 5. Backward-compat audit — every read of `proposals.total` or proposal-total compute in `src/`

Grepped `proposals.total`, `p.total`, `\.total` in proposal/wtc/calc contexts:

| File:line | Reads | Action |
|---|---|---|
| `ProposalDetail.jsx:247-250` | Writes `proposals.total` from `calcWtcPrice(w)` reduce | Replace with `calcProposalTotal(p, allWtcs)`. §3b. |
| `ProposalDetail.jsx:239` | `calcWtcPrice(wtc)` for `locked_line_total` snapshot | Pass override. §3b. |
| `ProposalDetail.jsx:265` | `calcWtcPrice(w)` for `billing_schedule_lines.scheduled_value` | Pass override. §3b. |
| `ProposalDetail.jsx:529` | `p.total` for stripe checkout amount | Reads stored value. No change — stored value is post-override. |
| `ProposalDetail.jsx:711` | `calcWtcPrice(wtc)` for WTC card display | Pass `parseFloat(p.markup_override_pct) \|\| 0`. |
| `ProposalDetail.jsx:1030` | `calcWtcBreakdown(w)` for summary panel | Pass override. |
| `ProposalDetail.jsx:1209,1217,1280` | `p.total` for billed-amount math | Reads stored value. No change. |
| `ProposalPDFModal.jsx:174-190` | Aggregates labor/mats/trav for PDF total | Pass `proposal.markup_override_pct` into per-WTC `calcLabor`. Export `effectiveLaborMarkupPct` or replicate inline. |
| `ProposalPDFModal.jsx:355-361` | Per-WTC breakdown for PDF body | Same fix. |
| `WTCCalculator.jsx:1774-1779,1795-1804` | Writes `proposals.total` from `calcWtcTotal` reduce | Replace with `calcProposalTotal`. §3b. |
| `WTCCalculator.jsx:1811-1813` | `calcWtcTotal(me)` for snapshot | Pass override. §3b. |
| `PublicSigningPage.jsx:453` | `proposal.total \|\| 0` for grand total | Stored value. No change. |
| `PublicSigningPage.jsx:553` | `w.locked_line_total ?? 0` for per-WTC display | Snapshot is post-override. No change. |
| `Invoices.jsx:171,417,789,1152,1416` | `calcWtcPrice(wtc)` for SOV / invoice math | Pass override. Need proposal row in scope at each. |
| `Invoices.jsx:193,362` | `selProposal.total` for stripe / remaining math | Stored value. No change. |
| `PublicInvoicePage.jsx:189` | `calcWtcPrice(wtc)` for invoice line display | Pass override. Page already fetches proposal (`:32`); include `markup_override_pct` in select. |
| `lib/invoicePdf.js:244` | `calcWtcPrice(wtc)` for invoice PDF lines | Pass override. Caller threads it in. |
| `SalesDash.jsx:449,462,477` | `pw.proposals?.total` for dashboard rollups | Stored value. No change. |

Total surfaces touched: ~14 call sites across 7 files. Default-zero signature on `calcWtcPrice` means migration is incremental — touch one file at a time, no flag-day.

### 6. Edge cases

1. **`markup_override_pct` NULL vs. 0.** Distinct semantically. NULL = "no override; parent or sister with no per-GC adjustment." 0 = "explicit acknowledgment that this GC has no adjustment." Math identical (`parseFloat(null) || 0 === 0`). Wizard distinguishes: blank input writes NULL; literal `0` writes 0. Useful for "did the rep visit Screen 3" queries. **[DESIGN-OPEN]** whether to surface this distinction in UI — probably not worth it v1.

2. **Source-proposal vs sister inheritance on clone.** Per §4 (`clone_proposal_to_gcs`), RPC writes `(v_target->>'markup_override_pct')::numeric` per-sister from wizard's `p_targets`. Source proposal's own `markup_override_pct` is NOT copied — sisters receive only what wizard configured. Matches Q2 ("commerce is per-GC, not source-synced").

   Corollary 1: Wizard's Pricing screen, when launched from a source with `markup_override_pct` set, does NOT pre-populate sisters with the same value. Default is blank. Flag in wizard help text.

   Corollary 2: `markup_override_pct` is NOT in the §5 source-driven field list. Sync RPCs don't touch it. If source's override changes, sisters' overrides do not change. Confirmed.

3. **WTC with discount AND a proposal-level override.** Order of operations (per `calc.js:73`): `Math.ceil(labor.total + mats + trav - (wtc.discount || 0))`. With override: `labor.total` uses `effective_markup_pct = max(0, wtc.markup_pct + override)`; `mats`, `trav`, `wtc.discount` unchanged; `Math.ceil` after subtracting discount.

   Override and discount commute via discount sitting outside any percentage calculation. No interaction concern.

   **Subtle case:** `markup_pct=10, override=-15, discount=200` → effective markup 0 (clamped), then `0 + mats + trav − 200` could go negative pre-`Math.ceil`. Existing code does not clamp negative WTC totals to zero — pre-existing pathology with steep `discount` alone, not made meaningfully worse. **[OUT OF SCOPE]** for §3. Follow-up "discount sanity" pass if we want to fix.

4. **Locked WTC (`locked_line_total` set) — does override apply to snapshot or get ignored?** Per CLAUDE.md Rule #4, `handleLock` writes `proposals.total`. Snapshot in `proposal_wtc.locked_line_total` captured at lock time, read verbatim by public signing page via `get_public_proposal_view`. Override MUST be folded into snapshot at lock time (per §3b — `calcWtcPrice(wtc, ovr)` for snapshot value).

   **Once locked, snapshot is frozen.** If rep changes `proposals.markup_override_pct` after locking, snapshot does NOT auto-update — by design (audit H6: customer sees the price that was locked). Rep must unlock → change override → re-lock. Same contract as for `markup_pct` today; no new defenses needed.

   **Pre-existing risk (NOT introduced by this resolution):** if rep changes override while proposal is `'Sent'` with all WTCs locked, customer signing page total stays correct (reads snapshot), but internal `proposals.total` may drift unless the override-change flow also re-runs `calcProposalTotal`. **[DESIGN-OPEN — sister-edit pricing UX]** — flag for wizard implementation. Out of scope for §3 itself.

### Critical files for implementation

- `src/lib/calc.js` — `effectiveLaborMarkupPct` private helper + optional `markup_override_pct` param on `calcWtcPrice`/`calcWtcBreakdown` + new `calcProposalTotal` wrapper.
- `src/components/ProposalDetail.jsx` — `handleLock` total recomputation + `locked_line_total` snapshot + billing-schedule lines + WTC card display.
- `src/pages/WTCCalculator.jsx` — `handleSave` total recomputation + `locked_line_total` snapshot.
- `src/components/ProposalPDFModal.jsx` — PDF aggregation passing override through `calcLabor`.
- `src/pages/Invoices.jsx` + `src/pages/PublicInvoicePage.jsx` + `src/lib/invoicePdf.js` — invoice line math.

---

## §4 RPC `clone_proposal_to_gcs`

**[DERIVED + BLOCKED on H-C2]** Function signature, types, and structure are mechanical from the `merge_call_log` precedent, but the per-GC commerce inputs depend on the H-C2 fix shape for `send-proposal` (the wizard will eventually invoke `send-proposal` N times, and we want to commit to a body shape that survives the H-C2 fix).

```sql
CREATE OR REPLACE FUNCTION public.clone_proposal_to_gcs(
  p_source_proposal_id text,
  p_targets            jsonb  -- array of {customer_id, rfp_number, bid_due, markup_override_pct, signer_contact_id, viewer_contact_ids[]}
) RETURNS TABLE (sister_proposal_id text, customer_id uuid, proposal_number int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_source    public.proposals%ROWTYPE;
  v_target    jsonb;
  v_sister_id text;
  v_next_n    int;
  v_performed_by uuid;
BEGIN
  -- Auth + tenant gates
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_source FROM public.proposals
    WHERE id = p_source_proposal_id FOR UPDATE;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SOURCE'; END IF;
  IF v_source.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_DELETED'; END IF;

  SELECT id INTO v_performed_by
    FROM public.team_members WHERE auth_id = auth.uid() LIMIT 1;

  -- Next proposal_number on the shared call_log (active only)
  SELECT COALESCE(MAX(proposal_number), 0) INTO v_next_n
    FROM public.proposals
   WHERE call_log_id = v_source.call_log_id
     AND deleted_at IS NULL;

  FOR v_target IN SELECT * FROM jsonb_array_elements(p_targets)
  LOOP
    v_next_n := v_next_n + 1;
    v_sister_id := gen_random_uuid()::text;  -- proposals.id is text

    -- (a) Insert sister proposals row
    INSERT INTO public.proposals (
      id, call_log_id, status,
      intro,                                -- SOURCE-DRIVEN
      customer_id, markup_override_pct,     -- PER-GC
      proposal_number, cloned_from_proposal_id,
      tenant_id, signing_token, created_at
      -- approved_at, signing_token_expires_at, signing_token_consumed_at: NULL on insert; trigger auto-fills expires_at
    ) VALUES (
      v_sister_id, v_source.call_log_id, 'Draft',
      v_source.intro,
      (v_target->>'customer_id')::uuid, (v_target->>'markup_override_pct')::numeric,
      v_next_n, p_source_proposal_id,
      v_tenant_id, gen_random_uuid(), now()
    );

    -- (b) Clone proposal_wtc rows — C2 FIX: locked=false AND locked_line_total=NULL
    INSERT INTO public.proposal_wtc (
      proposal_id, work_type_id,
      sales_sow, field_sow, materials, sub_areas, travel,
      size, unit, discount, discount_reason,
      regular_hours, ot_hours, markup_pct,
      burden_rate, ot_burden_rate, tax_rate, prevailing_wage,
      start_date, end_date,
      locked, locked_line_total,           -- C2 fix here
      locally_edited_fields                -- empty array
    )
    SELECT
      v_sister_id, work_type_id,
      sales_sow, field_sow, materials, sub_areas, travel,
      size, unit, discount, discount_reason,
      regular_hours, ot_hours, markup_pct,
      burden_rate, ot_burden_rate, tax_rate, prevailing_wage,
      start_date, end_date,
      false, NULL,                         -- C2: H6 invariant preserved
      '{}'::text[]
    FROM public.proposal_wtc
    WHERE proposal_id = p_source_proposal_id;

    -- (c) Insert proposal_recipients from wizard's per-GC contact list
    -- (signer + viewers via customer_contacts ids passed in v_target)
    -- ... INSERT INTO proposal_recipients ...

    -- (d) Audit row
    INSERT INTO public.proposal_clones (
      parent_proposal_id, sister_proposal_id, call_log_id,
      wtc_count, cloned_by, tenant_id
    ) VALUES (
      p_source_proposal_id, v_sister_id, v_source.call_log_id,
      (SELECT count(*) FROM public.proposal_wtc WHERE proposal_id = v_sister_id),
      v_performed_by, v_tenant_id
    );

    sister_proposal_id := v_sister_id;
    customer_id := (v_target->>'customer_id')::uuid;
    proposal_number := v_next_n;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.clone_proposal_to_gcs(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.clone_proposal_to_gcs(text, jsonb) TO authenticated;
```

**[DESIGN-OPEN]** Per-WTC date sync. Sweep noted `start_date`/`end_date` on `proposal_wtc` (CLAUDE.md:142). Are these source-driven or per-GC? They're commercially relevant (each GC wants their own schedule). Suggest: per-GC, not source-driven — but ask Chris.

**[BLOCKED on H-C2]** Wizard ultimately invokes `send-proposal` N times. After H-C2's fix lands, `send-proposal` will accept only `proposalId` and load everything from DB. Design the wizard's invoke loop accordingly: `for each sister: supabase.functions.invoke("send-proposal", { body: { proposalId } })`. If the wizard ships before H-C2, it temporarily reads sister.signing_token + GC contact email + tenant_config and passes them through; the call site becomes a `git mv`-style change once H-C2 ships. Recommend: **block wizard send-on-create until H-C2 ships** so we never push a regression through.

---

## §5 Sync logic (`preview_sync_to_sisters` + `apply_source_edit_to_sisters`)

> **→ Resolved 2026-05-11. The granularity question, RPC bodies, conflict-prompt UX, and downstream implications are nailed down in "§5 Sync Semantics — Resolution" below. The text in this section is the original stub, kept as the trail of how we got there. Final answer: Option A+ (column-level for the 3 jsonb arrays; sub-key level for `travel`).**

**[DESIGN-OPEN — see resolution]** This is the highest-uncertainty section. Two-RPC pattern (preview returns conflicts, apply commits) is the right shape, but the exact column-vs-jsonb-field handling of `field_sow` / `materials` / `sub_areas` / `travel` needs Chris's input.

**Preview RPC** (read-only, returns conflict report):
```sql
CREATE FUNCTION public.preview_sync_to_sisters(
  p_source_proposal_id text,
  p_changed_fields text[]  -- e.g. {'intro','wtc:<wtc_id>:sales_sow','wtc:<wtc_id>:materials'}
) RETURNS jsonb
```
Returns `{ sisters: [{ sister_id, conflicts: [{ field, sister_value, source_value }] }] }`. A "conflict" is when the sister's `proposal_wtc.locally_edited_fields[]` contains the field key the source-edit is touching.

**Apply RPC**:
```sql
CREATE FUNCTION public.apply_source_edit_to_sisters(
  p_source_proposal_id text,
  p_changed_fields  text[],
  p_force_overwrite text[]  -- subset of p_changed_fields to overwrite despite local edits
) RETURNS jsonb
```

**[DESIGN-OPEN] Granularity for jsonb fields.** `materials` is a jsonb array of line items. If the rep edits one line on the source, do we:
- (a) overwrite the whole `materials` jsonb on every sister (simple, but blasts sister-local material additions)
- (b) treat each material row by some stable key (`item.name`? a synthetic id?) and merge row-by-row (complex, prone to identity drift)
- (c) keep it at "this whole jsonb is dirty" granularity in `locally_edited_fields` — i.e. once a sister edits ANY material row, the `'materials'` field is locked from sync.

Recommend (c) for v1 — coarse-grained, easy to reason about, matches mental model "I customized this sister's materials, leave them alone." Same applies to `field_sow`, `sub_areas`, `travel`.

**[DESIGN-OPEN] What triggers `locally_edited_fields` to populate?** Today's UI writes to `proposal_wtc` via WTCCalculator.jsx + ProposalDetail.jsx. Two implementation choices:
1. **DB trigger** — `BEFORE UPDATE OF sales_sow, field_sow, materials, …` on `proposal_wtc` appends the changed column name to `locally_edited_fields` IF the parent proposal's `cloned_from_proposal_id IS NOT NULL`. Pro: invisible to client. Con: requires column-aware logic in PL/pgSQL.
2. **Client-side** — wrap every WTC write in a helper that diffs old→new and writes `locally_edited_fields` alongside. Pro: explicit. Con: every edit site has to know.

Recommend (1) — DB trigger. Less burden on every code path.

---

## §5 Sync Semantics — Resolution

_Resolved 2026-05-11 (round-2 Plan agent). Reads the v109-era code: `src/pages/WTCCalculator.jsx` line citations below are against the WTC save path._

### 1. Pre-question — do the four jsonb columns have stable per-row identifiers?

**Answer: row-id presence is uneven; none of the IDs are durable, globally unique, or DB-enforced.**

Evidence from the WTC save path (`src/pages/WTCCalculator.jsx`) — these IDs are generated client-side and round-trip through Supabase only because the save handler at `WTCCalculator.jsx:1744-1750` writes the full jsonb blob verbatim (`materials: materials`, `field_sow: sow.field_sow`, `sub_areas: sow.sub_areas ?? []`, `travel: travel`) with no shape transformation.

| Column | Shape | Per-row id? | Generator | Stable? |
|---|---|---|---|---|
| `materials` | jsonb array of line-items | `id` field | `WTCCalculator.jsx:413` `addFromDB`: `{ id: Date.now(), product, kit_size, … }`; `:414` `addCustom`: same | **No.** `Date.now()` collides on rapid-fire adds and is not unique across sisters. Not a DB key. |
| `field_sow` | jsonb array of day-entries, each with nested `tasks[]` and nested `materials[]` | `id` on the day; `id` on each task | `:732` `addDay`: `{ id: Date.now(), day_label, tasks: [newTask()], crew_count, hours_planned, materials: [] }`; `:731` `newTask()`: `{ id: Date.now() + Math.random(), description, pct_complete }` | **No.** Day ids collide across sisters (same `Date.now()` epoch when cloned). Task ids use a random fraction to disambiguate but only within one session — not durable across clones. |
| `sub_areas` | jsonb array of `{ id, label, size, unit }` | `id` | `:727` `addSubArea`: `{ id: Date.now(), label: "", size: 0, unit: "SQFT" }` | **No.** Same `Date.now()` story. |
| `travel` | jsonb **object** (not array) — flat keys: `drive_rate`, `drive_miles`, `fly_rate`, `fly_tickets`, `stay_rate`, `stay_nights`, `per_diem_rate`, `per_diem_days`, `per_diem_crew` | N/A — no rows | Set as a flat object in `WTCCalculator.jsx:1520` and read in `calc.js:29` (`(t.drive_rate \|\| 0) * (t.drive_miles \|\| 0)`) | N/A — there are no rows to identify. Subfields are stable named keys. |

Implication: Option B (row-level merge with row-stable identifiers) is **not free**. To make it correct we would need to (a) backfill row ids into existing jsonb arrays via a one-time migration, (b) change every UI insertion site to generate `crypto.randomUUID()` instead of `Date.now()`, and (c) make `clone_proposal_to_gcs` rewrite all child ids in the cloned jsonb (otherwise sisters would share the parent's row ids and a "merge by id" model would treat divergent edits as the "same row"). That's a schema migration in spirit even if no DDL ALTER lands — it's an invariant migration across the jsonb payload.

Travel is the exception: it's not an array, so per-key sync is trivially available without any id question.

### 2. Recommendation — **Option A with one carve-out: travel is keyed by sub-key.**

Call it A+. For the three array-shaped jsonbs (`materials`, `field_sow`, `sub_areas`) — column-level granularity. For `travel` — sub-key granularity (each named travel key is its own entry in `locally_edited_fields[]`).

Rationale: the row identifiers don't exist durably, so Option B for the arrays would build sync correctness on a foundation that has been unstable since the WTC was first written — and the cost to fix that foundation (rewrite every id generator + backfill migration + clone-time id rewrite) is several days of work on a code path that's not the bottleneck. Column-level granularity matches the rep's mental model: "I customized this sister's materials list" is the level reps will think about overrides at. The carve-out for `travel` costs nothing because travel is already keyed.

So `locally_edited_fields[]` entries are exactly one of: `'intro'`, `'sales_sow'`, `'field_sow'`, `'materials'`, `'sub_areas'`, `'size'`, `'unit'`, `'discount'`, `'discount_reason'`, `'travel:drive_rate'`, `'travel:drive_miles'`, `'travel:fly_rate'`, `'travel:fly_tickets'`, `'travel:stay_rate'`, `'travel:stay_nights'`, `'travel:per_diem_rate'`, `'travel:per_diem_days'`, `'travel:per_diem_crew'`.

Note: `intro` lives on `proposals`, not `proposal_wtc`. Tracking it in `proposal_wtc.locally_edited_fields[]` is awkward (which WTC's row holds the flag?). Two options: (a) store `'intro'` only on the lowest-numbered WTC row per proposal, (b) add a sibling column `proposals.locally_edited_fields text[]` for proposal-scope fields. **[DESIGN-OPEN]** — recommend (b) for clarity; flagging rather than picking arbitrarily.

### 3. Row-id strategy / migration

N/A — Option A is chosen. No row-id strategy needed. No additional schema migration beyond `proposal_wtc.locally_edited_fields text[]` already in §3, plus the **[DESIGN-OPEN]** `proposals.locally_edited_fields text[]` for the `intro` carve-out.

### 4. RPC bodies

Both RPCs follow `merge_call_log` conventions: `SECURITY DEFINER`, `SET search_path = public`, `NO_TENANT` guard, `TENANT_MISMATCH` on cross-tenant, `RETURN jsonb`, `REVOKE … FROM public; GRANT EXECUTE … TO authenticated`. No audit-table writes — sync is high-frequency (every parent save), and `merge_call_log` itself only writes audit on a once-per-merge event. Compare-with-precedent decision: skip audit for sync. If demanded later, add `proposal_sync_events` with similar shape to `proposal_clones` (§3). **[DESIGN-OPEN]** — flagging rather than picking.

```sql
-- ----------------------------------------------------------------------------
-- preview_sync_to_sisters(p_source_proposal_id text)
-- ----------------------------------------------------------------------------
-- Read-only. Walks all sisters of p_source_proposal_id and reports, per
-- sister, which source-driven fields differ from source AND are flagged
-- on that sister's proposal_wtc.locally_edited_fields[] (conflicts), vs
-- which differ but are NOT flagged (will be quietly synced by apply).
--
-- Tracked fields:
--   proposals: intro
--   proposal_wtc scalars: sales_sow, size, unit, discount, discount_reason
--   proposal_wtc jsonb columns (column-level): field_sow, materials, sub_areas
--   proposal_wtc jsonb object subkeys (key-level): travel:<key>
--
-- Returns jsonb:
--   { sisters: [
--       { sister_id text,
--         pending: [{ field text, scope text }],     -- will auto-sync
--         conflicts: [{ field text, scope text,
--                       source_value jsonb, sister_value jsonb }]
--       },
--       ...
--     ]
--   }
-- where scope ∈ { 'proposal', 'wtc:<work_type_id>' }.
--
-- "Conflicts" gate on locally_edited_fields[] containing the field name
-- (or 'travel:<key>' for travel sub-keys, or 'intro' on the
-- proposals.locally_edited_fields[] sibling column if §3 adds it).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_sync_to_sisters(p_source_proposal_id text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant_id     uuid;
  v_source        public.proposals%ROWTYPE;
  v_result        jsonb := jsonb_build_object('sisters', '[]'::jsonb);
  v_sister        record;
  v_sister_obj    jsonb;
  v_pending       jsonb;
  v_conflicts     jsonb;
  v_wtc_source    record;
  v_wtc_sister    record;
  v_travel_key    text;
  v_travel_keys   text[] := ARRAY[
    'drive_rate','drive_miles','fly_rate','fly_tickets',
    'stay_rate','stay_nights','per_diem_rate','per_diem_days','per_diem_crew'
  ];
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_source FROM public.proposals
    WHERE id = p_source_proposal_id;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SOURCE'; END IF;
  IF v_source.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_DELETED'; END IF;

  FOR v_sister IN
    SELECT * FROM public.proposals
     WHERE cloned_from_proposal_id = p_source_proposal_id
       AND deleted_at IS NULL
       AND tenant_id = v_tenant_id
       AND status NOT IN ('Lost','Sold')   -- skip awarded/lost sisters
  LOOP
    v_pending   := '[]'::jsonb;
    v_conflicts := '[]'::jsonb;

    -- ---- proposal-scope: intro ----
    IF v_source.intro IS DISTINCT FROM v_sister.intro THEN
      -- DESIGN-OPEN: where does 'intro' live as a locked flag?
      -- Assuming §3 adds proposals.locally_edited_fields text[].
      IF 'intro' = ANY (COALESCE(v_sister.locally_edited_fields, '{}')) THEN
        v_conflicts := v_conflicts || jsonb_build_object(
          'field','intro','scope','proposal',
          'source_value', to_jsonb(v_source.intro),
          'sister_value', to_jsonb(v_sister.intro)
        );
      ELSE
        v_pending := v_pending || jsonb_build_object('field','intro','scope','proposal');
      END IF;
    END IF;

    -- ---- wtc-scope: walk source WTCs, join sister WTCs by work_type_id ----
    -- (Sisters were cloned 1:1 from source so work_type_id is the join key.)
    FOR v_wtc_source IN
      SELECT * FROM public.proposal_wtc WHERE proposal_id = p_source_proposal_id
    LOOP
      SELECT * INTO v_wtc_sister
        FROM public.proposal_wtc
       WHERE proposal_id = v_sister.id
         AND work_type_id = v_wtc_source.work_type_id
       LIMIT 1;

      IF v_wtc_sister.id IS NULL THEN
        CONTINUE;  -- sister missing this WTC (manual deletion); skip
      END IF;

      -- Inline diff for one scalar (size) — repeat block for sales_sow,
      -- unit, discount, discount_reason:
      IF v_wtc_source.size IS DISTINCT FROM v_wtc_sister.size THEN
        IF 'size' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_object(
            'field','size',
            'scope', 'wtc:' || v_wtc_source.work_type_id::text,
            'source_value', to_jsonb(v_wtc_source.size),
            'sister_value', to_jsonb(v_wtc_sister.size)
          );
        ELSE
          v_pending := v_pending || jsonb_build_object(
            'field','size',
            'scope','wtc:' || v_wtc_source.work_type_id::text
          );
        END IF;
      END IF;
      -- ... repeat for unit, discount, discount_reason, sales_sow ...

      -- jsonb columns (column-level granularity)
      IF v_wtc_source.field_sow::jsonb IS DISTINCT FROM v_wtc_sister.field_sow::jsonb THEN
        IF 'field_sow' = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
          v_conflicts := v_conflicts || jsonb_build_object(
            'field','field_sow',
            'scope','wtc:' || v_wtc_source.work_type_id::text,
            'source_value', v_wtc_source.field_sow,
            'sister_value', v_wtc_sister.field_sow
          );
        ELSE
          v_pending := v_pending || jsonb_build_object(
            'field','field_sow',
            'scope','wtc:' || v_wtc_source.work_type_id::text
          );
        END IF;
      END IF;
      -- ... repeat for materials, sub_areas ...

      -- travel (key-level granularity)
      FOREACH v_travel_key IN ARRAY v_travel_keys LOOP
        IF (v_wtc_source.travel -> v_travel_key) IS DISTINCT FROM (v_wtc_sister.travel -> v_travel_key) THEN
          IF ('travel:' || v_travel_key) = ANY (COALESCE(v_wtc_sister.locally_edited_fields, '{}')) THEN
            v_conflicts := v_conflicts || jsonb_build_object(
              'field','travel:' || v_travel_key,
              'scope','wtc:' || v_wtc_source.work_type_id::text,
              'source_value', v_wtc_source.travel -> v_travel_key,
              'sister_value', v_wtc_sister.travel -> v_travel_key
            );
          ELSE
            v_pending := v_pending || jsonb_build_object(
              'field','travel:' || v_travel_key,
              'scope','wtc:' || v_wtc_source.work_type_id::text
            );
          END IF;
        END IF;
      END LOOP;
    END LOOP;

    v_sister_obj := jsonb_build_object(
      'sister_id', v_sister.id,
      'pending',   v_pending,
      'conflicts', v_conflicts
    );
    v_result := jsonb_set(v_result, '{sisters}',
                          (v_result->'sisters') || v_sister_obj);
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_sync_to_sisters(text) FROM public;
GRANT EXECUTE ON FUNCTION public.preview_sync_to_sisters(text) TO authenticated;


-- ----------------------------------------------------------------------------
-- apply_source_edit_to_sisters(p_source_proposal_id text, p_changed_fields text[])
-- ----------------------------------------------------------------------------
-- Writes source values into sisters. For each sister × field pair:
--   - field NOT in sister's locally_edited_fields[]  -> overwrite quietly
--   - field IS in sister's locally_edited_fields[]   -> skipped (returned
--       in 'skipped' so the client can decide whether to re-invoke with
--       p_force_overwrite).
--
-- p_force_overwrite shape: array of '<sister_id>:<field>' strings.
-- Conflict modal emits these from the user's per-row toggle decisions.
--
-- p_changed_fields[] uses the same vocabulary as locally_edited_fields[]:
--   'intro', 'sales_sow', 'size', 'unit', 'discount', 'discount_reason',
--   'field_sow', 'materials', 'sub_areas',
--   'travel:drive_rate' … 'travel:per_diem_crew'
-- For wtc-scoped fields, all WTC rows on the sister with matching
-- work_type_id are updated. (Multi-WTC of the same work_type is not
-- currently a supported shape — confirm with Chris.) **[DESIGN-OPEN]**
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_source_edit_to_sisters(
  p_source_proposal_id text,
  p_changed_fields     text[],
  p_force_overwrite    text[] DEFAULT '{}'::text[]
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_source      public.proposals%ROWTYPE;
  v_sister      record;
  v_field       text;
  v_force_key   text;
  v_should_skip boolean;
  v_synced      jsonb := '[]'::jsonb;
  v_skipped     jsonb := '[]'::jsonb;
  v_wtc_source  record;
  v_locked      boolean;
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_source FROM public.proposals
    WHERE id = p_source_proposal_id FOR UPDATE;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_SOURCE'; END IF;
  IF v_source.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_DELETED'; END IF;

  FOR v_sister IN
    SELECT * FROM public.proposals
     WHERE cloned_from_proposal_id = p_source_proposal_id
       AND deleted_at IS NULL
       AND tenant_id = v_tenant_id
       AND status NOT IN ('Lost','Sold')
     FOR UPDATE
  LOOP
    FOREACH v_field IN ARRAY p_changed_fields LOOP
      v_force_key   := v_sister.id || ':' || v_field;
      v_should_skip := FALSE;

      -- Proposal-scope field
      IF v_field = 'intro' THEN
        IF 'intro' = ANY (COALESCE(v_sister.locally_edited_fields, '{}'))
           AND NOT (v_force_key = ANY (p_force_overwrite)) THEN
          v_should_skip := TRUE;
        END IF;

        IF v_should_skip THEN
          v_skipped := v_skipped || jsonb_build_object(
            'sister_id', v_sister.id, 'field', v_field, 'reason','locked');
        ELSE
          UPDATE public.proposals
             SET intro = v_source.intro
           WHERE id = v_sister.id;
          v_synced := v_synced || jsonb_build_object(
            'sister_id', v_sister.id, 'field', v_field);

          -- If forced over a lock, the override is gone -> remove the flag.
          IF 'intro' = ANY (COALESCE(v_sister.locally_edited_fields, '{}')) THEN
            UPDATE public.proposals
               SET locally_edited_fields = array_remove(locally_edited_fields, 'intro')
             WHERE id = v_sister.id;
          END IF;
        END IF;

      ELSE
        -- WTC-scope field. Walk source WTCs; for each, sync into sister's
        -- matching-work_type_id WTC row.
        FOR v_wtc_source IN
          SELECT * FROM public.proposal_wtc WHERE proposal_id = p_source_proposal_id
        LOOP
          -- Explicit lock-state read into a local (avoids brittle FOUND
          -- semantics across nested loops).
          SELECT v_field = ANY (COALESCE(locally_edited_fields, '{}'))
            INTO v_locked
            FROM public.proposal_wtc
           WHERE proposal_id = v_sister.id
             AND work_type_id = v_wtc_source.work_type_id
           LIMIT 1;

          IF NOT FOUND THEN
            -- Sister is missing this WTC (manually deleted). Surface, skip.
            v_skipped := v_skipped || jsonb_build_object(
              'sister_id', v_sister.id,
              'field', v_field,
              'scope', 'wtc:' || v_wtc_source.work_type_id::text,
              'reason', 'missing_on_sister');
            CONTINUE;
          END IF;

          IF v_locked AND NOT (v_force_key = ANY (p_force_overwrite)) THEN
            v_skipped := v_skipped || jsonb_build_object(
              'sister_id', v_sister.id,
              'field', v_field,
              'scope', 'wtc:' || v_wtc_source.work_type_id::text,
              'reason', 'locked');
            CONTINUE;
          END IF;

          -- Field-specific write.
          IF v_field = 'sales_sow' THEN
            UPDATE public.proposal_wtc SET sales_sow = v_wtc_source.sales_sow
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'size' THEN
            UPDATE public.proposal_wtc SET size = v_wtc_source.size
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'unit' THEN
            UPDATE public.proposal_wtc SET unit = v_wtc_source.unit
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'discount' THEN
            UPDATE public.proposal_wtc SET discount = v_wtc_source.discount
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'discount_reason' THEN
            UPDATE public.proposal_wtc SET discount_reason = v_wtc_source.discount_reason
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'field_sow' THEN
            UPDATE public.proposal_wtc SET field_sow = v_wtc_source.field_sow
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'materials' THEN
            UPDATE public.proposal_wtc SET materials = v_wtc_source.materials
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field = 'sub_areas' THEN
            UPDATE public.proposal_wtc SET sub_areas = v_wtc_source.sub_areas
             WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
          ELSIF v_field LIKE 'travel:%' THEN
            DECLARE
              v_tkey text := substring(v_field FROM 8);
              v_tval jsonb := v_wtc_source.travel -> v_tkey;
            BEGIN
              UPDATE public.proposal_wtc
                 SET travel = jsonb_set(COALESCE(travel, '{}'::jsonb), ARRAY[v_tkey], v_tval, true)
               WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id;
            END;
          ELSE
            RAISE EXCEPTION 'UNKNOWN_FIELD: %', v_field;
          END IF;

          v_synced := v_synced || jsonb_build_object(
            'sister_id', v_sister.id,
            'field', v_field,
            'scope', 'wtc:' || v_wtc_source.work_type_id::text);

          -- Forced over a lock -> clear the flag on that sister-WTC.
          IF v_locked THEN
            UPDATE public.proposal_wtc
               SET locally_edited_fields = array_remove(locally_edited_fields, v_field)
             WHERE proposal_id = v_sister.id
               AND work_type_id = v_wtc_source.work_type_id;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'source_id', p_source_proposal_id,
    'synced',    v_synced,
    'skipped',   v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_source_edit_to_sisters(text, text[], text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_source_edit_to_sisters(text, text[], text[]) TO authenticated;
```

**Sub-points flagged rather than picked:**
- **`'intro'` flag column.** Recommend `proposals.locally_edited_fields text[]` sibling column. **[DESIGN-OPEN]**.
- **Audit-table writes on sync.** Skipped for v1 (high-frequency vs. `merge_call_log`'s once-per-event). **[DESIGN-OPEN]** if a sync audit is later required, mirror `proposal_clones` shape.
- **Duplicate `work_type_id` on one proposal.** Today nothing prevents two `proposal_wtc` rows with the same `work_type_id` on the same proposal. Sync would fan source value into both. **[DESIGN-OPEN]** — needs a uniqueness constraint, or accept current behavior.

### 5. Conflict-prompt UX (plain English)

**When the prompt fires.** Every parent save in WTCCalculator/ProposalDetail that touches one of the source-driven fields, when at least one active sister exists (`EXISTS (SELECT 1 FROM proposals WHERE cloned_from_proposal_id = p.id AND deleted_at IS NULL AND status NOT IN ('Lost','Sold'))`). Trigger: client computes the diff between previous-saved state and new state, calls `preview_sync_to_sisters(parent_id)`, and shows the modal if the response has any sister with a non-empty `conflicts[]`. If all sister responses have empty `conflicts[]`, skip the modal and silently call `apply_source_edit_to_sisters(parent_id, changed_fields)` to push the pending updates.

**What it shows.** A modal titled "Sync to sister proposals." Body has two regions:
1. Top — "Will be synced automatically" — a flat list of sister × field rows from `pending[]` (read-only, just confirms what's about to happen).
2. Bottom — "These fields conflict with sister edits" — a grouped list, one card per sister. Each card shows the sister's GC name (via `customer_id`), and for each conflicting field a row with: field label, a small "their version" preview of `sister_value`, a small "your edit" preview of `source_value`, and a per-row toggle ("Keep sister's version" | "Overwrite with my edit").

**Actions.**
- **Sync** (primary, teal button per CLAUDE.md style rule 2 — teal background, black text): invokes `apply_source_edit_to_sisters(parent_id, changed_fields, force_overwrite)` where `force_overwrite[]` contains `'<sister_id>:<field>'` strings for every toggle the user set to "Overwrite." On return, success toast: "Synced N fields to M sisters. P sister fields kept their local edits." Closes modal.
- **Don't sync** (secondary, ghost button): skips the apply entirely. Parent change persists; sisters stay diverged on every field. Sisters' `locally_edited_fields[]` is unchanged.
- **Cancel parent edit** (tertiary, ghost link): reverts the parent save itself. Useful when the rep realizes "wait, I didn't mean to touch the parent's materials list." Implementation: the parent save must be staged-not-yet-committed when the modal opens, so the cancel path is a no-op on DB. **[DESIGN-OPEN]** — whether to ship Cancel in v1 or pure two-button (Sync / Don't sync). Adds save-staging complexity; recommend defer.

**Effect on `locally_edited_fields[]` after each action.**

| User action | sister field NOT in `locally_edited_fields[]` | sister field IS in `locally_edited_fields[]` and user picked "Keep sister's" | sister field IS in `locally_edited_fields[]` and user picked "Overwrite" |
|---|---|---|---|
| Sync | Field overwritten with source value. `locally_edited_fields[]` unchanged (still empty for this field). | Field NOT overwritten. `locally_edited_fields[]` unchanged (still contains the flag — sister stays diverged). | Field overwritten with source value. **Flag removed from `locally_edited_fields[]`** (sister is now back in sync, future source edits on this field will sync quietly). |
| Don't sync | Field NOT overwritten. **Flag NOT added** (the sister never edited it; it's just temporarily diverged because the user declined the sync). Next time the rep edits this field on the parent, the same pending-list will reappear. | Field NOT overwritten. Flag unchanged. | Same as "Keep sister's" — Overwrite toggle is ignored when the user dismisses the modal. |

The "Don't sync, never-edited field" cell is the trickiest behavior. The honest alternative: "Don't sync" could add the flag for all currently-pending-and-not-yet-locked fields, treating the rep's dismissal as "yes, sister is supposed to diverge here." Reasonable both ways; **[DESIGN-OPEN]** — recommend the not-adding behavior (less surprising — the rep can always edit the sister directly to lock it).

**`locally_edited_fields[]` population on sister-side edits** (separate from the conflict modal). Already locked in §5 stub as DB trigger: a `BEFORE UPDATE` trigger on `proposal_wtc` that, when the proposal has `cloned_from_proposal_id IS NOT NULL`, appends to `locally_edited_fields[]` whichever of `{sales_sow, size, unit, discount, discount_reason, field_sow, materials, sub_areas}` is changing in this UPDATE, plus `'travel:<key>'` for any key in `NEW.travel` that differs from `OLD.travel`. Idempotent via `array_append` + dedupe.

### 6. Downstream implications

**§6 award flow.** Adding A+ has no direct effect on `award_proposal`. Indirect: once a winner is picked, sisters flip to 'Lost' and the sync loops in both RPCs already exclude `status IN ('Lost','Sold')`. Reversal (`reverse_award`) also benefits — sisters flipped back from 'Lost' re-enter the sync pool automatically. **No award-flow changes needed.**

**§7 wizard / detail surfaces.** Three surfaces fire the conflict modal:
1. ProposalDetail toolbar saves that touch `intro` (the intro editor on the proposal-level form). Detection: on save, diff `intro` against pre-edit snapshot; if changed AND parent has active sisters, call preview.
2. WTCCalculator save that touches any source-driven WTC field. Detection: in `handleSave` (`WTCCalculator.jsx:1729`), wrap the existing DB write so that after the parent's `proposal_wtc` update succeeds, if the parent has active sisters AND any of the source-driven fields changed since pre-edit snapshot, call preview. The "since pre-edit snapshot" requires `WTCCalculator` to capture the previous values when loading the row — a small refactor (it already loads them; just hold onto them rather than dropping).
3. Bulk operations that update source-driven fields (today only "Load default SOW" at `WTCCalculator.jsx:1690`). Treat identically.

Wizard itself: doesn't fire the conflict modal — at clone time `locally_edited_fields[]` is empty on every sister, so there's nothing to conflict with.

**§8 edge cases this granularity creates.**

a. **Source-deleted-row vs sister-edited-row.** Parent deletes one material from its `materials` jsonb array. Sister had marked `'materials'` as locally edited. `apply_source_edit_to_sisters` is called with `p_changed_fields=['materials']`. The whole sister materials column is locked → preview returns a conflict → modal shows it. If rep overwrites: the deleted-from-parent row vanishes from sister too. If rep keeps sister: sister retains its full list including any sister-added rows AND the now-deleted parent row. Column-level granularity means this is intuitive — "I customized this sister's materials, including keeping a row the parent deleted."

b. **Sister-deleted-row vs source-edited-row.** Sister had marked `'materials'` (deleting a row counts as an edit; the trigger fires on any change to the column). Parent edits a different row. Same outcome as (a): one conflict on `'materials'` column, rep picks at column level. The deleted-on-sister row stays gone if rep keeps sister; comes back if rep overwrites.

c. **Sister-edited then source-undoes the change.** Sister edits `materials[0].qty` from 5 to 10, locking `'materials'`. Parent later sets the same row's qty back to 5. `preview_sync_to_sisters` compares the full `materials` jsonb (parent's vs sister's) — they're still different (sister still has 10). Conflict fires. Rep is shown source.materials[0].qty=5 and sister.materials[0].qty=10 in the preview and can decide. **Quirk:** at column-level granularity, even if the rep wants to "re-sync the qty," they can't ungate just that row — it's the whole materials column or nothing. This is the explicit tradeoff of A. If this becomes a regular workflow complaint, the Option-B path with row-ids is the upgrade.

d. **Travel sub-key undo same scenario.** Better at travel because it's keyed: sister edited `drive_miles` (locked `'travel:drive_miles'`), parent later changes `drive_rate`. No conflict — `'travel:drive_rate'` isn't in sister's `locally_edited_fields[]`. Parent's drive_rate syncs quietly. Sister keeps its drive_miles. Confirms the carve-out earns its complexity.

e. **Auto-sync removing a previously-locked field via overwrite.** When the rep overwrites a locked field, the flag is removed (§5 table above). Next time the parent edits that same field, the sister will silently sync. If the rep wanted "permanent override," they need to remember to re-edit the sister after the conflict resolution. Acceptable; document in §7 UX copy.

f. **Sister WTC missing because of work_type_id divergence.** Clone copies all WTCs 1:1, but a rep could later delete a WTC from a sister. `apply_source_edit_to_sisters` joins by `work_type_id` — if the sister's WTC is gone, it now returns `reason='missing_on_sister'` in `skipped[]` (improved from the original "silently no-op"). UI can surface this as a third bucket in the conflict modal so the rep knows.

### Critical files this resolution adds/changes

- `supabase/migrations/20260513000000_multi_gc_allocation.sql` — both sync RPC bodies + `BEFORE UPDATE` trigger on `proposal_wtc` for `locally_edited_fields[]` auto-population + optional `proposals.locally_edited_fields text[]` sibling column for `intro` (if DESIGN-OPEN resolves yes).
- `src/pages/WTCCalculator.jsx` (lines 1729-1782 `handleSave` — capture pre-edit snapshot + invoke preview/apply on parent save when sisters exist).
- `src/components/ProposalDetail.jsx` (intro editor save path — same preview/apply pattern).
- `src/components/SyncConflictModal.jsx` (new — renders preview output, collects per-row overwrite toggles, invokes apply with `force_overwrite[]`).

---

## §5 Leftover Cleanup — Resolution

_Resolved 2026-05-11 (Round-3 Plan agent). Picks up the three sub-DESIGN-OPENs flagged in §5 resolution. Does not re-litigate Option A+, the C1 status model, or any other locked item. Does not touch C1 item 5 (pre_lost_status) — deferred to §6._

### (a) Intro flag column

**Restated question.** `intro` is the only proposal-scope source-driven field. Two options were flagged: (a) park `'intro'` on the lowest-numbered WTC's `locally_edited_fields[]` array, or (b) add a sibling column `proposals.locally_edited_fields text[]` to hold proposal-scope flags. Which?

**Recommendation: (b) — add `proposals.locally_edited_fields text[]`.**

Rationale. Option (a) hides a proposal-level fact inside an arbitrary child row, which means every read site that asks "did this sister override its intro?" has to look at the lowest-numbered WTC row's array — a spookily-indirect invariant that rots the first time a rep deletes the lowest-numbered WTC (`ProposalDetail.jsx:213` confirms deletion is one-click). The §5 RPC bodies already assume the sibling column exists (`v_sister.locally_edited_fields` reference + `array_remove(locally_edited_fields, 'intro')` on the `proposals` UPDATE). Picking (b) costs one nullable text[] column and keeps the §5 RPCs as-written; picking (a) would require rewriting both RPCs to JOIN through `proposal_wtc`.

**Schema (adds to `supabase/migrations/20260513000000_multi_gc_allocation.sql`):**
```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS locally_edited_fields text[] NOT NULL DEFAULT '{}';
```

No new RLS — `proposals` already has full RLS scoped on `tenant_id`. No new index — array contains-lookups on a text[] of ≤1 element scale linearly with proposal count.

**DB trigger to populate** (mirrors the planned `proposal_wtc` trigger):
```sql
CREATE OR REPLACE FUNCTION public.proposals_track_local_edits()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NEW.cloned_from_proposal_id IS NULL THEN
    RETURN NEW;  -- parent proposal: no flagging
  END IF;
  IF NEW.intro IS DISTINCT FROM OLD.intro
     AND NOT ('intro' = ANY (COALESCE(NEW.locally_edited_fields, '{}'))) THEN
    NEW.locally_edited_fields := array_append(
      COALESCE(NEW.locally_edited_fields, '{}'), 'intro');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposals_track_local_edits ON public.proposals;
CREATE TRIGGER trg_proposals_track_local_edits
  BEFORE UPDATE OF intro ON public.proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.proposals_track_local_edits();
```

`SECURITY DEFINER` keeps `search_path` pinned (project convention); the trigger doesn't need elevated rights since it only mutates the same NEW row. `BEFORE UPDATE OF intro` is the minimal-scope wake-up.

**Sync-behavior interaction.** Preview returns `intro` as a conflict iff sister's `proposals.locally_edited_fields` contains `'intro'`. Apply with `intro` in `p_force_overwrite` clears the flag. Apply without force respects the flag and reports skipped. All encoded in §5 RPCs as-written.

**UX surfacing.** None in v1. The conflict modal already surfaces the override at edit time. "Which sister overrode their intro without triggering a sync?" is a future §7 ask, not a v1 cleanup.

**Backward-compat audit.** New column with `DEFAULT '{}'` is non-breaking for all existing reads. `proposals` SELECT sites are unaffected (none reference the column today). `ProposalDetail.jsx:88` parent-side intro-save: trigger NO-OPs for parents (`cloned_from_proposal_id IS NULL`). Sister-side intro-save: trigger flags `'intro'` — exactly the §5 semantics. Zero existing sisters in prod, so zero rows affected on initial migration.

**Edge cases.**
1. Sister edits intro then reverts to source's exact text — flag is NOT removed (same coarse semantic as §5's "Sister-edited then source-undoes" quirk, accepted explicitly).
2. Parent hard-delete → sisters' `cloned_from_proposal_id` flips to NULL via `ON DELETE SET NULL`; trigger short-circuits. Orphaned sisters have nothing to sync from anyway.
3. Bulk UPDATE of intro across many rows — `BEFORE UPDATE OF intro` fires per-row; no scaling concern.
4. `clone_proposal_to_gcs` inserts sisters with `intro = v_source.intro` and `locally_edited_fields = '{}'`. Trigger does NOT fire on INSERT — fresh sisters are correctly not flagged.

### (b) Sync audit table

**Restated question.** §5 compared sync to `merge_call_log` (which writes one audit row per merge, low frequency) and noted sync fires on every parent save — high frequency. Should v1 ship a `proposal_sync_events` audit table?

**Recommendation: do not ship in v1. Document the deferred shape so it lands cleanly later.**

Rationale. Every parent edit that touches a source-driven field already updates `proposal_wtc.updated_at` (auto-trigger per CLAUDE.md). Every conflict resolution either updates the sister WTC's `locally_edited_fields` array (audit-able as a column-state diff) or doesn't. The information density of a separate audit table is low for an operational concern reps don't surface today: nobody asks "show me every sync attempt against sister X for the last 90 days." The compelling future use case is forensic — "sister disagrees with parent, when did that happen?" — and that case is already answered by `proposal_wtc.updated_at` + `locally_edited_fields` joined against `proposals.cloned_from_proposal_id`.

Operating cost: at modest scale (1 parent edit/day × 3 sisters × 18 fields = 54 rows/day, ~20k/year per tenant) the table is fine on capacity but poor on signal-to-noise — most rows are empty-conflict previews. Ship the table only when a concrete read site exists.

**Decision: defer.** Add a deferred-spec header comment in the §5 migration and a BACKLOG row.

**If/when shipped later — locked spec** (do not re-debate shape):

```sql
-- ---------------------------------------------------------------------------
-- proposal_sync_events  (FUTURE — not in v1)
-- ---------------------------------------------------------------------------
-- Append-only log of every preview/apply invocation. Written by both
-- preview_sync_to_sisters (kind='preview') and apply_source_edit_to_sisters
-- (kind='apply'). One row per RPC invocation, NOT one row per
-- (sister × field). The detail lives in the jsonb payload.
--
-- Retention: 365 days via separate cron migration. Reader: admin-only
-- forensic view; per-proposal detail surface is NOT planned for v1.

CREATE TABLE IF NOT EXISTS public.proposal_sync_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_proposal_id   text NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  call_log_id          integer NOT NULL REFERENCES public.call_log(id) ON DELETE CASCADE,
  kind                 text NOT NULL,           -- 'preview' | 'apply'
  changed_fields       text[] NOT NULL,
  forced_overwrites    text[] NOT NULL DEFAULT '{}',
  result               jsonb NOT NULL,          -- full RPC return value
  conflict_count       integer NOT NULL DEFAULT 0,
  performed_by         uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  performed_at         timestamptz NOT NULL DEFAULT now(),
  tenant_id            uuid NOT NULL DEFAULT public.get_user_tenant_id()
                              REFERENCES public.tenant_config(id),
  CHECK (kind IN ('preview','apply'))
);

CREATE INDEX IF NOT EXISTS idx_proposal_sync_events_tenant_id   ON public.proposal_sync_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposal_sync_events_source      ON public.proposal_sync_events(source_proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_sync_events_call_log_id ON public.proposal_sync_events(call_log_id);
CREATE INDEX IF NOT EXISTS idx_proposal_sync_events_performed_at ON public.proposal_sync_events(performed_at);

ALTER TABLE public.proposal_sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposal_sync_events_select ON public.proposal_sync_events;
CREATE POLICY proposal_sync_events_select ON public.proposal_sync_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.is_admin_or_manager());

DROP POLICY IF EXISTS proposal_sync_events_insert ON public.proposal_sync_events;
CREATE POLICY proposal_sync_events_insert ON public.proposal_sync_events
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS proposal_sync_events_update ON public.proposal_sync_events;
CREATE POLICY proposal_sync_events_update ON public.proposal_sync_events
  FOR UPDATE TO authenticated
  USING       (tenant_id = public.get_user_tenant_id() AND public.is_admin_or_manager())
  WITH CHECK  (tenant_id = public.get_user_tenant_id() AND public.is_admin_or_manager());

DROP POLICY IF EXISTS proposal_sync_events_delete ON public.proposal_sync_events;
CREATE POLICY proposal_sync_events_delete ON public.proposal_sync_events
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.is_admin_or_manager());

-- No updated_at column: append-only by design.
```

Reasons-for-choices locked:
- **Per-invocation, not per-(sister × field) row.** Writing N×M rows per invocation explodes table size 18× for negligible read benefit. `merge_call_log` precedent stores `proposals_moved` as a jsonb array on one row.
- **Both kinds (preview + apply).** Asymmetric ("only apply") would lose the preview-then-Don't-sync case (rep saw conflicts and bailed) — the second-most-interesting forensic event.
- **`conflict_count` denormalized.** Cheap; lets future read sites filter `WHERE conflict_count > 0` without expanding the result jsonb.
- **365-day retention via separate cron migration.** Mirrors `supabase/migrations/20260420170000_invoices_retention.sql` pattern.
- **No `proposal_clones` consolidation.** Different cardinalities (one-per-clone-event vs one-per-edit) and different read consumers; don't merge.

**Backward-compat audit.** N/A — table doesn't exist in v1.

**Edge cases the deferral creates.**
1. Forensic gap: between v1 ship and audit-table ship, "when did sister X first locally-override `materials`?" answers only with `proposal_wtc.updated_at` + current `locally_edited_fields[]` value — no sequence of flag-add/flag-remove events. Acceptable.
2. Bug-investigation gap: if a sister silently goes out of sync and the rep can't recreate steps, there's no log. Mitigation: client-side console.log of RPC returns (matches today's posture for `merge_call_log` debugging).
3. Future re-clone path would want a `parent_chain text[]` column. Deferral avoids preemptive design.

### (c) Duplicate `work_type_id` on one proposal

**Restated question.** `proposal_wtc` has no UNIQUE on `(proposal_id, work_type_id)`. WTCCalculator's work-type picker lists all work_types unconditionally. The §5 sync RPCs join by `work_type_id` and assume one-to-one. Block, UX-gate, or allow freely?

**Recommendation: block at DB level with a plain UNIQUE constraint + add a WTCCalculator-side UX guard for friendlier errors. Pre-flight verify zero existing duplicates before applying.**

Rationale. The §5 join-by-`work_type_id` is the cleanest possible identity for cross-sister WTC matching (`proposal_wtc.id` is uuid-per-row, distinct on every sister, so identity by `id` would fail; `work_type_id` is the only join key that survives clone). If duplicates are allowed, both sync RPCs must encode a deterministic disambiguation rule (e.g. "fan into the lowest-id sister WTC"), which is silently wrong half the time. The cost of blocking is one constraint; the cost of not blocking is rewriting both sync RPCs to handle a many-to-one shape.

**Pre-flight verification** (add to §11 as V8):
```sql
-- V8: detect existing duplicate (proposal_id, work_type_id) pairs.
-- Must return zero rows before applying the UNIQUE constraint.
SELECT proposal_id, work_type_id, count(*)
  FROM public.proposal_wtc
 GROUP BY proposal_id, work_type_id
HAVING count(*) > 1;
-- If non-empty: triage with sales (collapse to single WTC, or split into
-- separate proposals) BEFORE applying the constraint. The migration must
-- fail loudly on dirty data.
```

If V8 returns rows: ship the UX guard first (so no new duplicates), triage existing duplicates, then ship UNIQUE. If V8 returns zero rows: ship in the single multi-GC migration.

**Schema:**
```sql
ALTER TABLE public.proposal_wtc
  ADD CONSTRAINT proposal_wtc_unique_work_type_per_proposal
  UNIQUE (proposal_id, work_type_id);
```

**UX guard (file changes):**

`src/pages/WTCCalculator.jsx:1646-1665` (`loadWorkTypes` effect) — fetch the set of work_type_ids already on this proposal:
```js
if (proposalId) {
  const { data: existing } = await supabase
    .from("proposal_wtc")
    .select("id, work_type_id")
    .eq("proposal_id", proposalId);
  const usedIds = new Set((existing || [])
    .filter(r => r.id !== wtcId)
    .map(r => r.work_type_id));
  setUsedWorkTypeIds(usedIds);
}
```

`src/pages/WTCCalculator.jsx:316-318` (work-type `<select>`) — disable used options:
```jsx
{workTypes.map(wt => (
  <option key={wt.id} value={wt.id} disabled={usedWorkTypeIds.has(wt.id)}>
    {wt.name}{usedWorkTypeIds.has(wt.id) ? " (already on this proposal)" : ""}
  </option>
))}
```

`src/pages/WTCCalculator.jsx:1729` (`handleSave`) — defensive check before save:
```js
if (usedWorkTypeIds.has(selectedWorkTypeId)) {
  alert("This work type is already on this proposal. Pick a different work type or edit the existing WTC.");
  return;
}
```

Also surface the 23505 error from the DB UNIQUE if a race somehow slips through (the existing insert at line 1760 swallows return — needs a small refactor to surface error to rep).

**Sync semantics interaction.** With UNIQUE in place, the §5 join is unambiguous. Hypothetical "source has one WTC of work_type X, sister has two" → structurally impossible. "Source has two WTCs of work_type X" → also impossible. Collapse/duplicate/error question dissolves. At clone time, source had at most one WTC of any given work_type, so the §4 clone INSERT produces at most one sister WTC per work_type.

**Backward-compat audit.**
- `grep -rn "from(\"proposal_wtc\").insert" src/` → one site at `WTCCalculator.jsx:1760`. No upsert paths.
- `grep -rn "INTO public.proposal_wtc" supabase/` → one site in §4 clone RPC. Clone SELECT-INSERT preserves uniqueness on each sister. F7-clean.
- `WTCCalculator.jsx:1758` UPDATE path — `handleWorkTypeChange` at `:1668-1688` mutates `selectedWorkTypeId`. If a rep switches an existing WTC's work_type to one another sibling already has, UPDATE fails with 23505. UX guard prevents this in dropdown; dev-tools-bypass lands on the friendly check.
- `src/pages/Import/importApi.js:306` writes `job_work_types`, NOT `proposal_wtc`. Unaffected.
- `src/lib/calc.js`, `src/components/ProposalDetail.jsx` reads — all index by `proposal_wtc.id`, no assumption of duplicates. Zero existing read breaks.

**Edge cases.**
1. **Locked-WTC work_type swap blocked** — `proposalSold ? undefined : handleWorkTypeChange` at `WTCCalculator.jsx:1971` already gates this; rare case.
2. **Soft-delete inconsistency** — `proposal_wtc` has no `deleted_at`; if added later, UNIQUE must become partial `WHERE deleted_at IS NULL`. Flag in migration comment.
3. **Pre-existing duplicates block migration** — if V8 returns rows, the whole multi-GC migration fails. Two-stage path: UX guard + triage, then UNIQUE.
4. **Constraint name length** — `proposal_wtc_unique_work_type_per_proposal` is 52 chars (under PostgreSQL's 63-char limit). Fine.
5. **F7 future-tenant story** — UNIQUE applies within a single `proposal_id`, itself tenant-scoped via parent `proposals.tenant_id`. F7-clean.

### Backward-compat summary across (a)(b)(c)

| Change | New schema surface | Existing read sites broken | Existing write sites broken | Mitigation |
|---|---|---|---|---|
| (a) `proposals.locally_edited_fields text[]` | one column + trigger | 0 | 0 (`DEFAULT '{}'`) | none needed |
| (b) sync audit table | none in v1 | 0 | 0 | (deferred) |
| (c) UNIQUE `(proposal_id, work_type_id)` | one constraint | 0 | 1 if V8 returns rows; 0 otherwise | V8 pre-flight + WTCCalculator dropdown guard |

### Scope check

None of (a)/(b)/(c) crossed the "larger than leftover cleanup" line. Total addition to the multi-GC migration is small; the §5 RPCs work unchanged with these resolutions.

### New BACKLOG row from this round

- **F-class: `proposal_sync_events` audit table** (deferred from §5). Locked spec in this section. Ship when a concrete forensic read site exists.

### Reversal — 2026-05-12

**The §5(c) resolution above is overturned.** During Migration 1a prod-apply, build terminal challenged the "duplicates are a bug" premise. Chris confirmed: multi-WTC-same-`work_type_id` on one proposal is the intentional encoding for sub-area splits, time-phasing, and crew assignment. `proposal_wtc.sub_areas (jsonb)` is an orthogonal within-WTC mechanism, not a replacement. V8 evidence (Hyundai Reno 4× Demo + 4× Specialty pattern across three jobs, mostly status=`Sent`) is sub-area-split data, not import duplication.

**Implications:**
- UNIQUE `(proposal_id, work_type_id)` is wrong. Migration 1b (O5) closed Won't-Do.
- UX guard at `WTCCalculator.jsx` (commit `ba747d3`) is wrong. Reverted.
- §5 sync identity assumption (`join by work_type_id` is 1:1) is invalid. Sync RPCs need a new lineage key. Recommended: add `proposal_wtc.cloned_from_wtc_id uuid REFERENCES proposal_wtc(id) ON DELETE SET NULL` in a future migration (mirrors `proposals.cloned_from_proposal_id` pattern); sister WTC ↔ source WTC matches by lineage.
- §10 step 6 (RPCs) blocked on §5 sync-identity re-plan, NOT on UNIQUE. Filed as F16.

Audit ratification miss: the 2026-05-11 Round-5 audit pass ratified the §5(c) resolution without challenging the load-bearing domain-fact premise. Audit owns the miss. See `docs/AUDIT_LOG.md` 2026-05-12 §5(c) reversal notes.

### §5 Amendment 1 — 2026-05-13

_Resolves F16 (T1). Closes the sync-identity gap left open by §5(c) Reversal. Replaces the `work_type_id`-as-join-key assumption that ran through Rounds 2–3 with a `proposal_wtc.cloned_from_wtc_id` self-FK lineage column. Step-6 wiring lives in its companion amendment at §10 step 6 Amendment 3 — 2026-05-13. **Does not edit any prior §5 text, including the Round-2 RPC bodies and the §5(c) Reversal subsection above.** Treat all prior `work_type_id`-keyed JOIN snippets in §5 Sync Semantics — Resolution §4 (the `preview_sync_to_sisters` and `apply_source_edit_to_sisters` bodies) as superseded by this amendment's join rule wherever they read `AND work_type_id = v_wtc_source.work_type_id`. The semantics those snippets encode (locally_edited_fields gating, conflict modal, A+ granularity) are untouched._

#### What §5(c) Reversal didn't address that this amendment now addresses

The Reversal subsection invalidated the old join key and named a replacement shape (`cloned_from_wtc_id uuid REFERENCES proposal_wtc(id) ON DELETE SET NULL`) but did not specify (a) which side owns clone-time population, (b) the exact JOIN semantics for siblings vs source row, (c) what happens for pre-Migration-1b proposals where the column is NULL, (d) the index strategy, (e) multi-generation chain semantics (clone-of-a-clone), (f) how this composes with the already-shipped `proposal_wtc.locally_edited_fields` array. This amendment locks (a)–(d) and (f), and explicitly defers (e). Reading §5 end-to-end after this amendment: §5 Sync Semantics — Resolution defines _what_ syncs and at _what granularity_ (Option A+); §5(c) Reversal records _why_ the old identity rule is wrong; this amendment defines _the new identity rule_ and how clone + sync wire it in.

#### A. Lineage column spec

**[LOCKED]** Column shape, taken from F16 backlog row + §5(c) Reversal recommendation, ratified by Chris on filing:

```
proposal_wtc.cloned_from_wtc_id uuid NULL REFERENCES proposal_wtc(id) ON DELETE SET NULL
```

- **`uuid` type** — mirrors `proposal_wtc.id`'s uuid PK shape (CLAUDE.md verified columns block). Not `text` like proposals.id; proposal_wtc PKs are uuid.
- **`NULL`-able** — required for backward compatibility. Every `proposal_wtc` row that existed before Migration 1b will have NULL. Source proposals (those that have never been cloned _from_) will have NULL on all their WTC rows forever — that's the parent marker. Sisters' WTC rows will have NOT NULL after 1b ships.
- **Self-FK to `proposal_wtc(id)`** — explicit reference, lets PostgREST and any downstream joiner walk lineage without a string-parse. Matches the `proposals.cloned_from_proposal_id text REFERENCES proposals(id)` precedent.
- **`ON DELETE SET NULL`** — chosen over CASCADE and RESTRICT. Rationale: if a source proposal's WTC row is hard-deleted (rare; happens via WTCCalculator delete on an un-locked parent), surviving sister WTCs become orphans-of-sync but remain valid as standalone rows. CASCADE would silently destroy sister data the rep never asked to lose; RESTRICT would block legitimate parent-WTC deletion and force a confusing UX dialog. SET NULL is the same precedent set by `proposals.cloned_from_proposal_id` (V4 inventory line 2014–2018 confirms the proposals-level FK uses SET NULL; we match).

**[DERIVED]** Backfill policy: **no backfill of pre-1b rows.** Justification: there are zero active sisters in prod today (multi-GC clone RPC has not shipped). All existing `proposal_wtc` rows are on parent proposals (`proposals.cloned_from_proposal_id IS NULL`). The correct value for a parent's WTC's `cloned_from_wtc_id` is NULL anyway. The column lands with `DEFAULT NULL` and migration 1b touches no existing rows.

**[DERIVED]** Index strategy: **one btree index on `(cloned_from_wtc_id)`, partial `WHERE cloned_from_wtc_id IS NOT NULL`.** Rationale: the read pattern for sync is "given a source WTC's id, find all child rows with `cloned_from_wtc_id = $1`." That's a single-column equality lookup on a column where the majority of rows are NULL (every parent's WTC, plus every pre-1b row). Partial-NOT-NULL index keeps the index small and the lookup planner-friendly. Mirrors `idx_proposals_cloned_from` shape from Migration 1a line 33–34 (which is NOT partial, but for proposals the NULL-ratio rationale is identical; we can revisit whether 1a's index should also be partial in a separate scope-noted cleanup — not in this amendment).

**[DERIVED]** No new RLS — `proposal_wtc` already has RLS scoped on parent `proposals.tenant_id`. The self-FK target is in the same table, so RLS already covers reads on both sides.

#### B. Sync identity rule

**[LOCKED]** Siblings join on **`child.cloned_from_wtc_id = parent.id`**. "Parent" is the **immediate predecessor** in the clone tree, not the root. Every row's `cloned_from_wtc_id` points to its direct source `proposal_wtc.id` at the moment of clone. The §5 sync RPCs read this column as the canonical join key, replacing every `AND work_type_id = v_wtc_source.work_type_id` predicate in the Round-2 bodies (lines 727–728, 737, 909, 934, 937, 940, 943, 946, 949, 952, 955, 963, 978–979).

**[DESIGN-OPEN]** **Multi-generation chains deferred.** v1 sync assumes exactly two generations: a source proposal and its directly-cloned sisters (one clone event, `clone_proposal_to_gcs`). The plan doc has no flow that produces a clone-of-a-clone today (§4 takes one source + N targets; §6 award flow flips status, doesn't re-clone). If a future feature adds clone-of-a-clone (e.g. "fork this sister into its own multi-GC fan-out"), the sync RPCs need either (i) recursive WITH lineage walks, or (ii) a `parent_chain text[]` column. Either is a non-trivial schema + RPC change. **v1 scope:** sync walks one generation only. If a row has a `cloned_from_wtc_id` whose own `cloned_from_wtc_id` is non-NULL, the inner row is not visible to sync from the outer-most source. Document in the migration comment; surface in BACKLOG if/when needed. **Needs ratification before §10 step 6 build.**

**[DERIVED]** "Sister missing this WTC" semantics survive intact. Round-2's `apply_source_edit_to_sisters` handles the case where the sister manually deleted a cloned WTC by emitting `reason='missing_on_sister'` in the `skipped[]` payload (lines 912–919). Under the new identity rule: the join `WHERE cloned_from_wtc_id = v_wtc_source.id` returns zero rows; the existing CONTINUE branch fires; same surface to the client. No UX change.

**[DERIVED]** "Sister has WTC source never had" semantics. With work_type_id as join key, a sister could add a new WTC of a work_type the source didn't have, and the sync RPC would correctly not touch it (no matching source row). Under the new identity rule: a sister-added WTC row has `cloned_from_wtc_id = NULL` (it wasn't cloned from anything). The sync RPC walks source WTCs and looks for children — sister-added rows are invisible to that walk. Same correct outcome. Confirms the new join is at least as expressive as the old one for the cases that mattered.

#### C. Interaction with `locally_edited_fields` (already shipped in Migration 1a)

**[LOCKED]** `proposal_wtc.locally_edited_fields text[] NOT NULL DEFAULT '{}'` is already live on prod (Migration 1a line 52–53). This amendment does not touch the column shape, the field vocabulary defined in §5 Sync Semantics — Resolution §2 (line 620), or the auto-population trigger planned in §10 step 7.

- **Sync-eligible fields** — same set as Round-2 locked: `intro` (proposals scope), `sales_sow`/`size`/`unit`/`discount`/`discount_reason` (WTC scalars), `field_sow`/`materials`/`sub_areas` (WTC jsonb at column granularity), `travel:<key>` (WTC travel at sub-key granularity). **No change.**
- **Always-local fields** — fields that are explicitly per-GC and never sync: `customer_id`, `markup_override_pct`, `rfp_number`, `bid_due_date` (proposals); `regular_hours`, `ot_hours`, `markup_pct`, `burden_rate`, `ot_burden_rate`, `tax_rate`, `prevailing_wage`, `locked`, `locked_line_total`, `start_date`, `end_date` (proposal_wtc — confirmed by §4 clone INSERT shape, lines 502–515; start_date/end_date flagged DESIGN-OPEN at line 548 but Chris ratified per-GC during Round-3 audit pass per AUDIT_LOG, so assumed [LOCKED] as per-GC unless re-flagged). The new lineage column does not extend or contract this set.
- **Conflict resolution under lineage join** — unchanged from Round-2: a child row's `locally_edited_fields[]` contains a field name → that field is "locally dirty" → parent edits to it return as `conflicts[]` in preview output and `reason='locked'` in apply output unless `p_force_overwrite[]` includes the `<sister_id>:<field>` key. Lineage only changes _which child row pairs with which source row_; it doesn't change _what gets compared_ on a pair.

**[DERIVED]** New edge case the lineage column creates: **child with `cloned_from_wtc_id` pointing at a since-SET-NULL'd target** (i.e. source WTC was hard-deleted post-clone). Under SET NULL the orphan child has `cloned_from_wtc_id = NULL`. The sync RPC walking source WTCs sees no matching child (NULL never equals anything in a JOIN). Orphan is silently invisible to sync — it remains a valid standalone WTC row, no longer "a sister WTC." This is the right outcome: the source row that authorized the sister-link is gone, so sync should not fire. Surface in §8 edge cases (noticed-but-not-touched) — see Stay-Scoped note in final report.

#### D. Migration 1b shape (DDL spec, not the file)

Migration 1b adds two things, in this order, in one file:

1. **Column ADD** on `proposal_wtc`:
   - Adds `cloned_from_wtc_id uuid NULL`.
   - Adds the FK constraint `proposal_wtc_cloned_from_wtc_id_fkey` referencing `proposal_wtc(id) ON DELETE SET NULL`.
   - `ADD COLUMN IF NOT EXISTS` + `ADD CONSTRAINT IF NOT EXISTS` guards per repo convention.
2. **Index CREATE** — partial btree on `(cloned_from_wtc_id)` `WHERE cloned_from_wtc_id IS NOT NULL`. Name: `idx_proposal_wtc_cloned_from_wtc_id`.
3. **Comment block** at the top of the migration explaining: F16 closure, multi-generation deferral, no-backfill rationale, why SET NULL not CASCADE.

**No PostgREST schema reload required for an additive column on an existing RLS-enabled table** — PostgREST picks up new columns on next request schema-cache refresh. The migration is safe to apply during a normal deploy window.

**No data backfill.** Migration is purely DDL.

**No RPC bodies in 1b.** The new RPCs (clone wiring + sync wiring) ship in a separate later migration along with `award_proposal` + `reverse_award` per §10 step 6. Reason: 1b is the schema substrate; step 6 is the functional rollout. Separating them lets us prove 1b's substrate against prod (read paths, trigger semantics) before committing to RPC bodies.

**[DESIGN-OPEN]** **Migration filename timestamp** — left for cross-repo coordination per O7. sales-command and sch-command share Supabase project `pbgvgjjuhnpsumnowuym` and have no timestamp coordination convention. Naming convention so far: `YYYYMMDDHHMMSS_short_name.sql`. Proposed: `20260514HHMMSS_multi_gc_lineage.sql` _after_ confirming no sch-command migration is in flight at the chosen second. **Needs O7 resolution (pre-draft ledger query + pre-push hook) before the file lands.** If O7 hasn't shipped by the time Migration 1b is ready, run a manual `migration list --linked` immediately before assigning the timestamp.

#### E. Confidence tag summary

| Subsection | Tag | Notes |
|---|---|---|
| Column shape (type, nullability, self-FK, ON DELETE SET NULL) | [LOCKED] | Ratified on F16 filing; mirrors `proposals.cloned_from_proposal_id` precedent. |
| Backfill policy (none) | [DERIVED] | Forced by zero-active-sisters fact. |
| Index strategy (partial btree, NOT NULL) | [DERIVED] | Standard pattern for sparsely-populated lineage columns. |
| Sync identity rule (lineage join, immediate-predecessor) | [LOCKED] | Direct corollary of column shape + §5(c) Reversal premise. |
| Multi-generation chain deferral | [DESIGN-OPEN] | Needs Chris ratify before step 6 build. |
| locally_edited_fields field set unchanged | [LOCKED] | Round-2 + Migration 1a. |
| Always-local field set | [LOCKED] except start_date/end_date carry-over | start_date/end_date assumed per-GC per Round-3 AUDIT_LOG; re-confirm in step 6 ratification. |
| Orphan-child-after-SET-NULL semantics | [DERIVED] | Direct consequence of FK behavior + sync RPC structure. |
| Migration 1b DDL shape | [LOCKED] for column + FK + index; [DESIGN-OPEN] for filename timestamp | Filename gated on O7. |

---

## §6 Award flow

**[BLOCKED on C1] + [DERIVED]** Section is structurally clear but the C1 collision determines whether the auto-Sold path can stay or has to be re-routed.

**Happy path (sisters case, C1 resolved):**
```sql
CREATE FUNCTION public.award_proposal(
  p_winner_proposal_id text,
  p_lost_reason        text DEFAULT 'Lost to other GC'
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_winner      public.proposals%ROWTYPE;
  v_call_log_id integer;
  v_sister_ids  text[];
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;

  SELECT * INTO v_winner FROM public.proposals
    WHERE id = p_winner_proposal_id FOR UPDATE;
  IF v_winner.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND_WINNER'; END IF;
  IF v_winner.tenant_id <> v_tenant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;

  v_call_log_id := v_winner.call_log_id;

  -- Winner -> Sold
  UPDATE public.proposals
     SET status = 'Sold', approved_at = now()
   WHERE id = p_winner_proposal_id;

  -- Sisters under same call_log -> Lost
  UPDATE public.proposals
     SET status = 'Lost',
         lost_reason = p_lost_reason,
         lost_at = now()
   WHERE call_log_id = v_call_log_id
     AND id <> p_winner_proposal_id
     AND deleted_at IS NULL
     AND status NOT IN ('Sold','Lost')   -- idempotent
   RETURNING id INTO v_sister_ids;

  -- call_log -> Sold
  UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;

  RETURN jsonb_build_object(
    'winner_id', p_winner_proposal_id,
    'sisters_lost', v_sister_ids,
    'call_log_id', v_call_log_id
  );
END;
$$;
```

**Reversal RPC** — `reverse_award(p_call_log_id)`: flips winner back to 'Sent' (or 'Has Bid' — **[DESIGN-OPEN]**), sisters back to whatever they were before (we need to capture prior_status before the flip — add a column `proposals.pre_lost_status text` or use a JSON snapshot on the audit table — **[DESIGN-OPEN]**), and call_log back to its prior stage.

**QB sync** **[DERIVED]**: only the winner triggers `qb-create-job`. The current ProposalDetail.jsx:601-613 handleInternalApprove flow needs to be replaced — see C1 resolution below.

---

## §7 UI surfaces

> **→ Resolved 2026-05-11. Final-round wizard spec, after-state surfaces, conflict-prompt UX, and sister detail-view treatments are nailed down in "§7 Wizard — Re-spec" below. The text in this section is the original stub, kept as the trail of how we got there.**

**[DESIGN-OPEN — see resolution]**

**Wizard — 4 screens** (per v98 mockup, reproduced from memory; not blocked but needs design pass since mockup HTML was deleted):
1. **Pick GCs** — list of `customers` rows where `customer_type` is some GC tag, OR a free-create path. Multi-select.
2. **Per-GC details** — for each selected GC: contact (signer + viewers from `customer_contacts`), RFP#, bid due date.
3. **Pricing** — per-GC `markup_override_pct` input. Shows preview of total per GC.
4. **Review & Create** — confirm; invokes `clone_proposal_to_gcs(p_source_proposal_id, p_targets)`; on success either (a) stays on shared `call_log` detail to "send later" or (b) immediately fans out `send-proposal` calls. **[DESIGN-OPEN]** which default.

**Entry points** **[LOCKED via Q4]**:
- ProposalDetail toolbar: `+ Send to Additional GCs` (only when `cloned_from_proposal_id IS NULL` and `status ∈ {'Draft','Sent','Has Bid'}` — i.e. this proposal isn't already a sister and isn't archived/lost/sold).
- CallLogDetail toolbar: `+ Add Another GC` (visible when at least one active non-Sold proposal exists on the call_log; opens wizard pre-pointed at the most recent non-Lost proposal as parent).

**ProposalDetail "sister sidebar"** **[DERIVED]**: when `cloned_from_proposal_id IS NOT NULL` OR `EXISTS (SELECT 1 FROM proposals WHERE cloned_from_proposal_id = p.id)`, show a "Sister proposals" panel listing siblings under the same call_log with their GC name + status pill + a `Mark Awarded` action on each.

**CallLogDetail "GCs" panel** **[DERIVED]**: replaces single-proposal display with a list grouped by GC (customer name from `p.customer_id ?? cl.customer_id`).

**Source-edit conflict modal** **[DESIGN-OPEN]**: when an edit on the parent triggers `preview_sync_to_sisters` and conflicts come back, modal lists sisters × conflicting fields, lets user pick "skip" or "force overwrite" per row, then invokes `apply_source_edit_to_sisters` with the chosen `p_force_overwrite` set. Trigger point: every save in WTCCalculator/ProposalDetail when the proposal has sisters.

**Customer-jobs surface fix** **[BLOCKED on S1 resolution]**: see S1 below.

---

## §7 Wizard — Re-spec

_Replaces §7 stub. Locked decisions surfaced: Q1, Q2, Q4, C1 (`'Signed'` status), §3 markup (additive, floor-clamped, labor-only), §5 (Option A+ sync, conflict modal lives outside wizard), §5-cleanup (a) `proposals.locally_edited_fields`, §5-cleanup (c) UNIQUE `(proposal_id, work_type_id)` + dropdown guard. Read-only spec; no files written._

Wizard component: `src/components/MultiGCWizard.jsx` (new). Conflict modal: `src/components/SyncConflictModal.jsx` (new). Both are referenced from the existing entry points and live alongside `NewInquiryWizard.jsx`. Screen order kept as v98: **1 Pick GCs → 2 Per-GC Details → 3 Pricing → 4 Review**. No reordering — every prior-round decision maps onto this order cleanly.

Layout precedent followed from `src/components/NewInquiryWizard.jsx:751-787`:
- Backdrop `rgba(28,24,20,0.65)`, modal body `C.linenCard` background, `borderRadius: 14`, `padding: 32`, `width: 720` (wider than NewInquiry's 620 because Per-GC and Pricing screens need horizontal room for N sister cards side-by-side), `maxHeight: 92vh`, `overflowY: auto`, `boxShadow: 0 24px 64px rgba(0,0,0,0.45)`, `border: 1px solid C.borderStrong`.
- Two `NavCircle` arrows pinned at `left/right: calc(50% - 414px)` (offset for the wider modal). `NavCircle` reused verbatim from NewInquiryWizard.jsx:55-64 (`C.teal` border, `C.dark` fill when secondary / `C.teal` fill with `C.dark` glyph when primary). Final-step right circle shows `✓`.
- Per-screen `StepLabel n / label` from NewInquiryWizard.jsx:30-37, numbered 1–4.
- Footer `{step+1} / 4` from NewInquiryWizard.jsx:779-781.
- Top header strip: `<h2>Send to Additional GCs</h2>` in `F.display` + `C.textHead` + close `✕` at top-right.
- Below the header, a dark sub-strip `background: C.dark`, `border: 1px solid C.tealBorder` reprises NewInquiryWizard.jsx:773-776 pattern but shows the **source proposal label**: small-caps `"Source Proposal"` in `rgba(255,255,255,0.3)` over the source's `display_job_number P{n}` in `C.teal` `F.display`. Replaces the job-number-preview block.

State shape (held in `MultiGCWizard` top-level `useState`):
```
{
  step: 0..3,
  sourceProposalId: text,            // pre-set by entry point
  sourceProposal: {...},             // joined call_log + customer + wtcs
  sourceWtcs: [{...}],               // for live preview math (Screen 3)
  callLogId: integer,                // === sourceProposal.call_log_id
  existingSisterCustomerIds: uuid[], // from initial query, for UNIQUE guard
  targets: [{                        // one entry per sister being created
    customer_id: uuid,               // selected on Screen 1
    customer_name: text,             // denormalized for display
    primary_contact_id: uuid|null,   // 'signer' role
    viewer_contact_ids: uuid[],
    rfp_number: text,
    bid_due_date: date|null,
    billing_terms: integer,          // pulled from customer; editable per-GC
    intro: text,                     // prepopulated from source.intro; editable
    intro_locally_edited: boolean,   // tracks whether rep mutated from source value
    markup_override_pct: numeric|null,
  }],
  saving: boolean,
  error: text|null,
  partialResults: {success: [...], failures: [...]} | null
}
```

The wizard mirrors NewInquiryWizard's `setData` pattern (single state object, `set(k, v)` curry) — same shape, different fields.

---

### Entry Points

#### Entry Point A — ProposalDetail "+ Send to Additional GCs"

**File / insertion site.** `src/components/ProposalDetail.jsx:674-695` (the action toolbar inside the header `<div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>`). The button slots between the existing `Internal Approve` button (`:691`) and the `Generate PDF` button (`:693`). Order in the toolbar after insertion: Delete · Pull Back · Send to Schedule · Create Invoice · Internal Approve · **Send to Additional GCs** · Generate PDF · Send Proposal.

**Button copy + styling.** Reuses `Btn sz="sm" v="secondary"` so the visual weight is below `Send Proposal` (primary) and above the ghost-class buttons. `Btn` `v="secondary"` is `background: transparent`, `color: C.tealDark`, `border: 1.5px solid C.teal` (Btn.jsx:6). Copy: `"+ Send to Additional GCs"`. No inline style override required.

Rationale on variant: a primary teal-button-with-black-text (the literal Style Rule #2 form) is reserved for the wizard's final "Create N sister proposals" CTA on Screen 4 — using it here would over-promote a flow that's secondary to "Send Proposal."

**Pre-conditions for visibility.** Show only when ALL of:
1. `p.cloned_from_proposal_id == null` (this is a source, not a sister — §8.6 / §7 stub Q4 gate).
2. `!p.is_archive_proposal` (archive proposals have no WTCs to clone — §3 already excludes them from calc paths).
3. `p.status` is in `['Draft','Sent','Has Bid','Signed']` — excludes `'Sold'`, `'Lost'`, `'Parked'`. Hide on `'Sold'` because once Mark Awarded has run, sisters under this call_log are already terminal; hide on `'Lost'` because the source itself lost. `'Signed'` allowed because the rep may still need to add a late-arriving GC before they pull the trigger on Mark Awarded.
4. `p.deleted_at == null`.

Disabled (rendered, but `disabled` prop true with tooltip) when WTCs are present but none locked: `wtcs.length > 0 && !wtcs.some(w => w.locked)`. Reason: cloning before lock means sisters inherit `locked=false` WTCs (already guaranteed by C2 / §4 RPC clause), but the live preview total on Screen 3 would be uninformative because the source itself has no committed pricing yet. Tooltip: `"Lock at least one WTC on this proposal before cloning to additional GCs."` **[OPEN — see Open Items below]** — alternative is to allow even with zero locked.

**Wizard opens with.** `sourceProposalId = p.id`, `callLogId = p.call_log_id`, `step = 0`. `sourceProposal` and `sourceWtcs` hydrated by the wizard's own initial effect (single Supabase round-trip mirroring `ProposalDetail.jsx:47-55`'s join shape). `existingSisterCustomerIds` queried once: `SELECT p.customer_id FROM proposals p WHERE p.call_log_id = ? AND p.cloned_from_proposal_id = ? AND p.deleted_at IS NULL` (catches sisters already cloned from this same source, for the §5-cleanup (c) UNIQUE-style guard on Screen 1).

#### Entry Point B — CallLogDetail "+ Add Another GC"

**File / insertion site.** `src/components/CallLogDetail.jsx:414-449` (the action toolbar `<div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>`). Slots immediately after the existing `+ New Proposal` button at `:426-428`. New order: Edit · (Save/Cancel during edit) · **+ New Proposal** · **+ Add Another GC** · + Add CO · + Archive Job Proposal · Delete · Merge Job · Move to Old Jobs.

**Button copy + styling.** Same `Btn sz="sm" v="secondary"` for visual parity with `+ Add CO` immediately following it (`:430` uses `v="secondary"`). Copy: `"+ Add Another GC"`. No inline override.

**Pre-conditions for visibility.** Show only when ALL of:
1. There is at least one non-archive, non-deleted, non-Lost proposal on this call_log AND at least one of those is **not** a sister (i.e. an eligible "source proposal" exists). Implementation: pass `linkedProposals` down from `CallLogDetail` (already loaded — see `:443` `Btn` block that refreshes child counts) and gate on `linkedProposals.some(p => !p.cloned_from_proposal_id && !p.is_archive_proposal && p.deleted_at == null && !['Sold','Lost'].includes(p.status))`.
2. `!job.archived` — old jobs can't get new sisters.
3. `!job.is_change_order` — CO call_logs don't fan out to multi-GC. **[OPEN]** ratify.
4. `job.stage` is NOT `'Sold'` or `'Lost'` (once a winner exists, no more sisters; reversal via `reverse_award` is the door to take if rep needs to reopen).

Disabled with tooltip when the only candidate source proposal has zero locked WTCs (same rationale as Entry Point A).

**Wizard opens with.** Different from Entry Point A: the source isn't pre-selected; the rep has to **pick which existing proposal to clone from** before Screen 1 proper. Two options for how that picker appears:

- (a) **Pre-Screen 0 source picker.** A 5th screen that fires only via Entry Point B. Lists all eligible source proposals on the call_log (typically just one), each rendered with `display_job_number P{n}` badge + `Pill label={p.status}` + GC name + total. Rep taps one; wizard sets `sourceProposalId` and advances to Screen 1.
- (b) **Auto-select most recent eligible.** If exactly one candidate exists, pre-select it and start at Screen 1; if 2+, fall through to (a).

Pick **(b)** — single-GC is overwhelmingly the common case (call_log with one source proposal, rep wants to fan out). Multi-source-on-one-call_log only happens after a prior multi-GC + Mark Awarded reversal cycle, which is rare. (a) is the disambiguation lane when needed. Implementation: wizard opens with `step=0`, computes `candidateSources`, if `candidateSources.length === 1` it `setSourceProposalId(candidateSources[0].id)` and stays at step 0 with the source-picker UI hidden; if 2+, step 0 renders a source-picker variant of Screen 1's top. Header sub-strip ("Source Proposal: 1234 P1") populates once `sourceProposalId` is set.

---

### Screen 1 — Pick GCs

**Goal.** Select N (1+) GC customers to clone this proposal to.

**Layout.** Full-width single column inside the modal body. Vertical stack:

1. `StepLabel n=1 label="Pick GCs"` (NewInquiryWizard `StepLabel` reused).
2. Helper paragraph (`fontSize: 12.5`, `color: C.textMuted`, `fontFamily: F.ui`, `marginBottom: 14`): `"Pick one or more General Contractors to receive a copy of this proposal. Each will get its own customer, contacts, RFP#, and pricing."`.
3. A search input (`<input>` styled with NewInquiryWizard `inputStyle` constant — `C.linenDeep` background, `borderRadius: 8`, `border: 1.5px solid C.borderStrong`, `padding: 10px 14px`, `fontSize: 14`, `WebkitAppearance: "none"`). Placeholder `"Search GC customers…"`. Filters the list below by `customer.name` `includes` (case-insensitive).
4. A scrollable list (`maxHeight: 260`, `overflowY: auto`, `paddingRight: 4`, `display: flex column gap 6`) of GC candidates. Each row mirrors the `workTypes` selection pattern at NewInquiryWizard.jsx:680-691:
   - Row background `C.linen` when unselected, `C.dark` when selected (matches selected-pill rule).
   - Row border `1.5px solid C.border` unselected, `1.5px solid C.teal` selected.
   - Row left side: small checkbox-square (18×18, `border 2px solid C.borderStrong` unselected / `C.teal` filled with `C.dark` `✓` when selected), then customer name in `F.ui` `fontSize: 13` `color: C.textBody` (unselected) / `C.teal` weight 700 (selected).
   - Right side: `customer.customer_type` muted (`fontSize: 11`, `color: C.textFaint` unselected / `rgba(255,255,255,0.35)` selected).
5. Below the list, an "+ Add New GC Customer" row styled as the dashed-border button at NewInquiryWizard.jsx:576-581 (`background: none`, `border: 1.5px dashed C.borderStrong`, `borderRadius: 8`, `padding: 8px 16px`, `F.display`). On click expands an inline mini-form (customer_type=Commercial pre-filled, name input, billing_terms select); on save inserts into `customers` and pushes id into `targets` with `customer_name` denormalized. Mini-form mirrors the customer-creation block of NewInquiryWizard.jsx:448-475.

**Inputs / data.**
- Source data: `customers` table, all rows where `tenant_id` matches (RLS enforced). Surface filtered to `customer_type === 'Commercial'` by default with a small `"Show Residential too"` toggle (`color: C.textFaint`, `fontSize: 11`, plain button) for the edge case. Rationale: today `customer_type` has no GC-specific tag (`Customers.jsx:96-100` shows only Residential/Commercial), and GCs are virtually always Commercial. **[OPEN — see Open Items]** ratify the default.
- Selection writes to `targets[]` keyed by `customer_id`. Selecting a customer pushes `{ customer_id, customer_name, primary_contact_id: null, viewer_contact_ids: [], rfp_number: "", bid_due_date: null, billing_terms: customer.billing_terms || 30, intro: sourceProposal.intro, intro_locally_edited: false, markup_override_pct: null }`. Deselecting pops it.

**State this screen reads / writes.**
- Reads: `customers` (list), `sourceProposal.intro`, `existingSisterCustomerIds`.
- Writes: `targets[]`.

**Validation gates before Next enables.**
- `targets.length >= 1`. Disabled `NavCircle` (right) when zero. Mirrors NewInquiryWizard's `validateStep` "workTypes" case (`NewInquiryWizard.jsx:168`).
- Each `target.customer_id` must NOT appear in `existingSisterCustomerIds` (UNIQUE-style guard at the per-call_log level — "this GC already has a sister on this project"). On attempt to select such a customer, the row renders disabled (`opacity: 0.4`) with a `(already a sister on this project)` suffix in `color: C.textFaint`. Direct port of the §5-cleanup (c) WTCCalculator dropdown pattern, applied to customer-on-call_log.
- The same customer may not be selected twice (the list itself already enforces this — single row per customer).

**Edge cases.**
- **Existing sister under this call_log (forward-only, Q2).** Renders with the disabled `(already a sister on this project)` indicator; rep cannot select. No retro-link path.
- **Source-customer in the GC list.** The source proposal's own customer (`sourceProposal.customer_id ?? sourceProposal.call_log.customer_id`) renders disabled with suffix `(this is the source proposal's GC)`. Prevents diamond inheritance (§8.6) at the customer level.
- **Customer with no contacts.** Permitted at Screen 1; deferred validation to Screen 2 where the rep must either select an existing contact or create one.
- **No GC customers at all in the tenant.** List shows empty state `"No GC customers yet. Use + Add New GC Customer to create one."` — empty state in `C.textFaint`, `F.ui`, `fontSize: 13`, padding `20px 0`, centered.

---

### Screen 2 — Per-GC Details

**Goal.** For each picked GC, capture commerce-side fields (Q2): contacts, RFP#, due date, billing terms, intro override.

**Layout.** Tabbed per-sister UI (one tab per `target`). At the top of the screen body, a horizontal row of pill-tabs — one per target, plus visual counter `"1 of N"` on the right. Tab styling reprises the `STAGES` pill row at NewInquiryWizard.jsx:656-658:
- Unselected tab: `border 1.5px solid C.border`, `background: transparent`, `color: C.textMuted`, padding `7px 14px`, `borderRadius: 20`, `F.display`, uppercase, `letterSpacing: 0.05em`.
- Selected: `border 1.5px solid C.teal`, `background: C.dark`, `color: C.teal`.
- Each tab label is the GC's customer_name truncated to 20 chars. A small red dot suffix appears if the tab has unfilled required fields (computed live).

Per-sister tab body (single card; layout is a single tab "card", not multiple cards stacked):

1. **Customer label header.** Sister customer's full name in `F.display` `fontSize: 18` `color: C.textHead` + below it the `customer_type` muted.
2. **Primary contact picker.** `<select>` of `customer_contacts` for this sister's customer, ordered `is_primary desc, name asc`. Mirrors `ProposalDetail.jsx:64` query pattern. Plus an "+ Add new contact" link that expands a 3-field mini-form (name / email / phone / role-select with options "Project Manager" | "Office Manager" | "Billing Contact"). Same shape as ProposalDetail's `createNewRecipient` flow at `ProposalDetail.jsx:331`. The selected contact is written to `target.primary_contact_id` and becomes the sister's `proposal_recipients` row with `role='signer'` after the §4 clone RPC runs. **[OPEN]** wizard could optionally let the rep pick multiple viewers (`viewer_contact_ids[]`) — defer to v1.1 to keep the screen compact; ship v1 with signer-only.
3. **RFP # input.** `<input>` styled with NewInquiryWizard `inputStyle`. Writes to `target.rfp_number`. **NOTE:** `proposals` schema (CLAUDE.md verified-columns block) has no `rfp_number` column today — this requires schema addition. See Backward-Compat / Migration Notes below; flagged as **[OPEN]** as the §3 schema additions did not include it.
4. **Bid due date input.** `<input type="date">` styled with `inputStyle`. Writes to `target.bid_due_date`. **NOTE:** `proposals` schema has no `bid_due_date` either (only `call_log.bid_due` exists). Same schema-add flag. Per Q2, the GC's bid due date is commerce-side per-sister, so this lives on `proposals`, not `call_log`. **[OPEN]**.
5. **Billing terms input.** `<select>` matching NewInquiryWizard.jsx:525-534 (`Net 5 / 15 / 30 / 45 / 60 / 90 / 120 / Custom`). Default = the sister customer's `customers.billing_terms`. Writes to `target.billing_terms`. **NOTE:** today `billing_terms` lives on `customers` (per CLAUDE.md), not on `proposals`. Per Q2 "per-GC on commerce", the per-sister billing terms either (i) overrides the customer's value (write back to `customers.billing_terms` on commit — rejects multi-tenant story), or (ii) lands on a new `proposals.billing_terms_override` column (cleaner). Recommend (ii). **[OPEN]** — see Open Items.
6. **Sibling intro field (cleanup (a) trigger surface).** A `<textarea>` (matches `ProposalDetail.jsx:968` intro editor) labeled `"Email Introduction"`. Prepopulated from `target.intro` (which was seeded from `sourceProposal.intro` on Screen 1). When rep edits, `target.intro_locally_edited` flips to true (purely a UI hint — the trigger on `proposals.locally_edited_fields` does the database-side work post-commit). Above the textarea, a one-line hint: when `intro_locally_edited === false`, hint reads `"From source proposal. Edit to override for this GC only."` in `color: C.textFaint`. Once edited, hint changes to `"Overridden for this GC. Future source edits will not auto-sync this field."` in `C.amber`. (This pre-stages the conflict-modal vocabulary so reps already know the term when they later edit the source.)

   On anchors (i.e. when the wizard creates a brand-new sister), the intro field semantically equals "today's intro field on the new sister." The trigger from §5-cleanup (a) only fires `BEFORE UPDATE OF intro` and only on rows where `cloned_from_proposal_id IS NOT NULL`. So at INSERT-time (clone RPC), `locally_edited_fields = '{}'` regardless of whether the wizard preset `intro` to source's value or to an edited variant. To keep the UX honest, the clone RPC should accept an optional `target.intro_override text` and write that into the sister's `proposals.intro` instead of `v_source.intro`, AND if `intro_override IS NOT NULL AND intro_override IS DISTINCT FROM v_source.intro`, the RPC should write `locally_edited_fields = ARRAY['intro']` to immediately flag the field as overridden. (Trigger doesn't catch INSERTs by design — §5-cleanup (a) `BEFORE UPDATE OF intro`. So the RPC has to do the work for the cloning case.) **[OPEN]** — adds a small RPC param + 2 lines of body; flagged to ratify.

**Source-side intro on anchors.** The source proposal's own intro is unchanged by this wizard. The "ProposalDetail.jsx:968 intro editor" continues to write `proposals.intro` directly with no special multi-GC treatment, because the trigger only fires on sisters (`cloned_from_proposal_id IS NOT NULL`). Source-side intro editing → fires the §5 source-driven sync → ProposalDetail surfaces the conflict-prompt modal (see "Conflict-Prompt UX" section below).

**Contact selection — existing vs new.** Mirrors ProposalDetail's recipients pattern at `ProposalDetail.jsx:317-370` (the `assignContactAsRecipient` + `createNewRecipient` flow). Picker shows `customer_contacts` rows sorted with primary first, plus inline "+ Add new" expanding a `customer_contacts` insert form. The insert side-effect on `customer_contacts` happens at wizard commit (Screen 4 "Create"), not at Screen 2 — so cancelling the wizard doesn't strand orphan contacts.

**Edge cases.**
- **Customer with no contacts.** The picker renders empty; the "+ Add new contact" inline form auto-expands. Required-field gate on Next: `target.primary_contact_id != null` OR `target` carries an inline-new contact object that hasn't been inserted yet.
- **Sister-customer is same as anchor-customer.** Blocked on Screen 1 (see Edge cases there). Cannot reach Screen 2 in that state.
- **Rep flips back to Screen 1 and deselects a target.** That target's tab and its data are dropped from `targets[]`. If the currently-active tab is deselected, default to first remaining tab.
- **Long N (e.g. 8 GCs).** Tab row wraps to second line (`flexWrap: 'wrap'`); modal width 720 fits ~5 tabs per row of 20-char labels. Acceptable for the realistic ceiling of 6–8 GCs.

**Validation gates before Next enables.**
- Every target has: `primary_contact_id != null`, `rfp_number.trim().length > 0`, `bid_due_date != null`. Intro is optional (NULL is fine; renders as empty contract email body). Billing terms has a default so always passes.
- If any required field is empty, the tab pill shows a red dot suffix.

---

### Screen 3 — Pricing

**Goal.** Set per-sister `markup_override_pct` and confirm computed totals before commit.

**Layout.** Vertical stack:

1. `StepLabel n=3 label="Pricing"`.
2. Helper paragraph: `"Adjust pricing per GC. The override adds (or subtracts) percentage points to every WTC's labor markup on this GC's proposal. Material markup and travel are unaffected. Leave blank for no change from the source."`.
3. Source-total reference strip. A dark sub-strip (`background: C.dark`, `borderRadius: 9`, `padding: "10px 16px"`, `border: 1px solid C.tealBorder`) with `"Source proposal total"` label small-caps `color: rgba(255,255,255,0.3)` over `fmt$(calcProposalTotal(sourceProposal, sourceWtcs))` in `C.teal`, `F.display`, `fontSize: 18`. Always shown — gives reps a baseline to compare each sister's total against.
4. One row per target (one card per sister, stacked vertically). Card style: `background: C.linen`, `border: 1.5px solid C.borderStrong`, `borderRadius: 10`, `padding: 16`, `marginBottom: 10`. Each card has three columns laid out via `display: grid`, `gridTemplateColumns: "1fr 140px 140px"`, `gap: 16`, `alignItems: center`:
   - **Left:** customer_name in `F.display` `fontSize: 15` `color: C.textHead` + small `customer_type` line below.
   - **Center:** numeric input for `target.markup_override_pct`. Width 100% of the column. Suffix `pp` rendered as overlay text (right-padded input + absolute-positioned `pp` glyph), per §3 spec ("explicitly NOT '%' suffix"). Placeholder `"e.g. -5"`. Default value: empty string → writes NULL. Typed `0` writes `0` (per §3 NULL-vs-0 distinction). Numeric input only, but allows `-` prefix; client clamps display preview at zero via `effectiveLaborMarkupPct` math but does NOT clamp the input value itself.
   - **Right:** computed total for this sister, in `F.display` `fontSize: 18` `color: C.teal`, computed via `calcProposalTotal({ markup_override_pct: target.markup_override_pct }, sourceWtcs)`. Recomputes on every keystroke (no debounce needed — math is local, no DB round-trip). Below the total in small text: a delta `vs source: +$1,234` or `−$432` (`color: C.green` for negative-from-source = cheaper-for-customer, `color: C.amber` for positive = more expensive). Helps reps see the impact at a glance.
5. Below the per-sister cards, a per-sister expandable "Show per-WTC breakdown" disclosure on each card (chevron at right corner). On expand, renders each `sourceWtc` as a sub-row: `WTC N — work_type.name`, `fmt$(calcWtcPrice(wtc, target.markup_override_pct || 0))` on right. Tiny per-WTC table (`fontSize: 12`, `F.ui`, padding `4px 0`). Source's per-WTC price shown muted alongside if `target.markup_override_pct` is non-null.
6. Soft-validation warning (per §3): when `|target.markup_override_pct| > 25`, an amber `⚠ Large markup override — verify with manager.` chip renders next to the override input. Does not block Next.

**Live preview formulae** (per §3 spec):
- `effectiveLaborMarkupPct = Math.max(0, (wtc.markup_pct || 0) + (target.markup_override_pct || 0))`
- Per-WTC: `calcWtcPrice(wtc, target.markup_override_pct || 0)` — needs the §3-spec'd updated `calc.js` signature with the optional override param.
- Per-sister total: `calcProposalTotal({markup_override_pct: target.markup_override_pct}, sourceWtcs)`.

**Post-lock drift warning (Round-4 sub-DESIGN-OPEN 3).** Wizard's Screen 3 is BEFORE any sister exists, so locks on sisters don't exist yet — there is no drift to surface at clone-time. The drift problem belongs to the *post-commit* sister-Pricing-edit surface (when a rep later changes `markup_override_pct` on an existing sister whose WTCs have `locked_line_total` snapshots set). That edit surface is **not** the wizard; it's the per-sister "edit override" affordance inside ProposalDetail when viewing a sister.

**Decision: warn, do not re-snapshot.** On the post-commit edit surface (ProposalDetail when viewing a sister, on the override field), if `wtcs.some(w => w.locked_line_total !== null)` AND the rep changes `markup_override_pct`, surface an amber inline warning under the input:

> ⚠ **Locked snapshots exist.** This change updates the proposal's internal total, but the customer-facing per-WTC prices on the signing page were captured at lock time and will not update. To update those, unlock and re-lock each WTC.

Action set: warning only, no CTA, no auto-action. Rep can either accept the drift (acceptable when the change is downward — internal total now reflects new policy, customer still sees the original locked offer) or manually unlock/re-lock. This matches the §3 "snapshot is frozen" contract (per §3.6 case 4). Recommend not adding a "Re-snapshot now?" CTA — that would silently rewrite the customer-facing signing page mid-flight, which is what H6 explicitly forbids. **[OPEN]** if Chris prefers a CTA-driven re-snapshot, the implementation cost is one button + one RPC that calls `handleLock`-equivalent over the locked set; this resolution recommends against.

**Locked-WTC handling on Screen 3.** Not applicable — at clone-time sisters have no locks (C2 / §4 RPC clause: `INSERT ... VALUES (... false, NULL, '{}')`). All `sourceWtcs.locked` values are irrelevant to the live preview because the wizard recomputes prices from inputs, not from snapshots. Source's snapshots remain on the source proposal untouched.

**Edge cases.**
- **Zero-WTC sister.** Wizard refuses to commit (Screen 4 guard) — the §4 RPC clones zero WTCs, leaving a sister proposal with `total = 0` that the rep can't lock or send. Cleaner to block at Screen 1: if `sourceWtcs.length === 0`, the wizard entry button was already disabled (Entry Point A precondition #4 covers "no locked WTCs" but not "zero WTCs"). Add: button hidden when `wtcs.length === 0`.
- **Negative override walked past clamp-zero.** Input accepts `-30`; preview math floor-clamps each WTC's effective markup at 0 via `Math.max(0, ...)`. Total reflects the clamp. No additional UX; the rep sees the clamped total directly. Reasonable; matches §3's stated math.
- **Source's own `markup_override_pct` is set.** Per §3.6 case 2, the clone RPC does NOT copy source's override into sisters — sisters default to NULL. So Screen 3's blank input is the correct default even if the source has a non-null value. The source-total reference strip computes from `sourceProposal.markup_override_pct` (so the comparison is "source as it ships today" vs "sister with rep's input"). Helper text under the source-total strip clarifies: `"Source's own markup override is already applied to the source total above. Sister overrides do not inherit."`.

**Validation gates before Next enables.** None — every target's `markup_override_pct` is allowed to be NULL. Soft warnings only.

---

### Screen 4 — Review

**Goal.** Final confirmation; commit triggers the §4 RPC.

**Layout.** Vertical stack:

1. `StepLabel n=4 label="Review"`.
2. Source proposal summary card (compact; one-line per field). `background: C.linenCard`, `border: 1.5px solid C.borderStrong`, `borderRadius: 10`, `padding: 16`. Header `"Source proposal"` in small-caps `F.display`. Body: 2-column grid showing `Job:`, `Customer:`, `Status:`, `Total:`, `WTC count:`. Total uses `fmt$(calcProposalTotal(sourceProposal, sourceWtcs))`.
3. Sister cards arranged as a horizontal row at `width: 720` modal — `display: grid`, `gridTemplateColumns: repeat(auto-fit, minmax(260px, 1fr))`, `gap: 12`. Each sister card: `background: C.linen`, `border: 1.5px solid C.borderStrong`, `borderRadius: 10`, `padding: 14`. Card body:
   - GC name in `F.display` `fontSize: 15` `color: C.textHead`.
   - Primary contact name + email (single line, `fontSize: 12`, `color: C.textMuted`, `F.ui`).
   - `RFP# 1234`, `Bid due May 15`, `Net 30` — three small chips, `background: C.dark`, `color: C.teal`, `borderRadius: 6`, `padding: "3px 10px"` (dollar-badge style per CLAUDE.md style rule #3, repurposed for metadata badges).
   - Override pp value as a chip: `+0 pp` if NULL or 0, `−5 pp` if negative, `+10 pp` if positive. Same chip styling.
   - Computed total prominent: `fmt$(...)` in `F.display` `fontSize: 20` `color: C.teal`.
   - Intro override indicator: a small line `"intro: overridden from source"` in `C.amber`, `fontSize: 11`, if `target.intro_locally_edited === true`. Otherwise omitted.
4. Final commit CTA. A wide primary button positioned below the cards, full-width inside the modal body. **Per CLAUDE.md Style Rule #2 (teal button = black text)**: this CTA is NOT a `Btn v="primary"` (which renders dark-bg + teal-text — the dollar-badge style). Instead, custom inline styling matching NewInquiryWizard.jsx:418-423's Save Changes button:
   ```
   background: C.teal,
   border: "none",
   borderRadius: 9,
   padding: "13px 28px",
   color: C.dark,            // ← black text on teal
   fontWeight: 800,
   fontSize: 14.5,
   fontFamily: F.display,
   letterSpacing: "0.05em",
   textTransform: "uppercase",
   ```
   Copy: `"Create N Sister Proposals"` where N is `targets.length`. Disabled with `opacity: 0.6, cursor: not-allowed` while `saving === true`; copy changes to `"Creating..."`.

**Server-side action on click.** One `supabase.rpc("clone_proposal_to_gcs", { p_source_proposal_id: sourceProposalId, p_targets: <jsonb> })` call. `p_targets` shape per §4 RPC body — one element per target with `customer_id`, `rfp_number`, `bid_due`, `markup_override_pct`, `signer_contact_id`, `viewer_contact_ids`. Wizard also passes the optional `intro_override` (see Screen 2 hint) per the [OPEN] RPC param flagged above.

The §4 RPC:
1. Validates tenant + source existence.
2. Computes `v_next_n` from `MAX(proposal_number)` on the call_log.
3. Loops over `p_targets`:
   - Inserts a sister `proposals` row with status `'Draft'`, `cloned_from_proposal_id` set, `customer_id` set, `markup_override_pct` set, `intro` set (from `intro_override` if provided else `v_source.intro`), conditionally `locally_edited_fields = ARRAY['intro']` if override differs from source.
   - Inserts cloned `proposal_wtc` rows with `locked=false, locked_line_total=NULL, locally_edited_fields='{}'` (C2 invariant).
   - Inserts `proposal_recipients` row for the signer contact (role='signer').
   - Inserts `proposal_clones` audit row.
4. Returns `(sister_proposal_id, customer_id, proposal_number)` per row.

**Loading state.** While `saving === true`: CTA disabled with `"Creating..."` copy. Backdrop click ignored (no close-on-overlay). NavCircle arrows disabled. A small spinner glyph (or just animated `…`) next to the CTA copy.

**Error state.** RPC throws `NO_TENANT` / `NOT_FOUND_SOURCE` / `TENANT_MISMATCH` / `SOURCE_DELETED`. Render error inline below the CTA in `color: C.red`, `fontSize: 13`, `F.ui`, with the raw error message and a tertiary "Try Again" button (`Btn v="ghost" sz="sm"`). Wizard stays on Screen 4; rep can back up to fix or retry.

**Partial-success state.** The §4 RPC is a single transaction over the FOR loop — under normal Postgres semantics, either all sisters land or none do. So partial success shouldn't be possible at the RPC level. However, *post-clone* actions (sending confirmation emails via send-proposal — blocked on H-C2 per §4 BLOCKED clause) may partially fail. For v1: wizard does NOT auto-invoke `send-proposal` on commit (per §4 "block wizard send-on-create until H-C2 ships"). Sisters land as `'Draft'`; rep navigates manually to send. So partial-success isn't a v1 surface.

---

### After-State (post-commit landing)

**Where the rep lands.** Wizard closes. The host that invoked it:
- **Entry Point A (ProposalDetail).** Wizard's `onSaved` callback navigates the rep to `CallLogDetail` for the shared `call_log_id`, because the multi-GC view is most coherent at the call_log level (where all sisters appear in the "GCs" panel). Implementation: `navigate('/calllog/' + sourceProposal.call_log_id)`. The source ProposalDetail screen is left behind in the back-stack.
- **Entry Point B (CallLogDetail).** Wizard already lives inside CallLogDetail; `onSaved` just calls `onJobRefresh()` (CallLogDetail prop, line 62) to re-fetch linked proposals and closes the modal in place. Rep stays on CallLogDetail with N+1 proposals now showing.

**Visual treatment in Proposals.jsx list view.** Sisters need a visible differentiator without inventing a new badge style. Pick **indent + sister-of-link badge**:

- In `Proposals.jsx:143` column `"Proposal #"`: when `row.cloned_from_proposal_id != null`, prepend a small `↳` glyph (Unicode `↳ U+21B3`) in `color: C.teal`, `marginRight: 6` (matches Sold-family color per C1-Round-2 audit ratification: "Sold-family color with visual differentiator"; teal is the Sold-family proxy in this codebase since Pill uses tealish hues for Sold). Then render the `display_job_number P{n}` badge as usual. To the right of the badge, an additional pill `SISTER` styled as: `background: C.dark`, `color: C.teal`, `border: 1px solid C.teal`, `borderRadius: 10`, `padding: "2px 7px"`, `fontSize: 10`, `fontWeight: 700`, `F.ui`, `letterSpacing: 0.04em` — directly reuses the existing `LINKED` / `QB SKIP` chip style at `Proposals.jsx:151-156` for consistency.
- No grouping in the list (Proposals.jsx is sorted by `created_at desc`; sisters and source happen to be near each other but the list isn't tree-flattened). Grouping would require a structural change to `DataTable` that's out of scope for this wizard.

**Visual treatment in CallLog.jsx list view.** Call_log is one row per project regardless of sister count — no per-sister rows in CallLog.jsx. But the call_log's row should signal "multi-GC project" so reps know to expect sisters when they open it. Add a small pill in the Job # column at `CallLog.jsx:243`: when the row has 2+ active proposals (passed as a denormalized count from the loader, computed as a sub-query or via the existing `linkedProposals` count machinery), render `{count} GCS` pill styled identically to the existing `CO` pill at `CallLog.jsx:244-246` but using `C.teal` foreground (rather than purple): `background: rgba(48,207,172,0.12)`, `color: C.tealDeep`, `padding: 2px 7px`, `borderRadius: 10`, `F.ui`. Click target opens CallLogDetail. **[OPEN]** — implementation requires loader to compute and inject the count; small but real loader change. Flagged as part of Backward-Compat audit below.

**Where the C1 `'Signed'` status pill renders.**
- **Proposals.jsx list `Status` column** (`Proposals.jsx:145-157`): `Pill label={v} cm={PROP_C}` already handles any status value generically, including `'Signed'` once `src/lib/mockData.js` PROP_C entry is added (per C1 §4: `"Signed": { bg:"rgba(67,160,71,0.10)", text:"#1e5e22" }`). No Proposals.jsx code change needed beyond adding the `'Signed'` STATUS_TAB at `:67`.
- **ProposalDetail header pill** (`ProposalDetail.jsx:664`): `<Pill label={p.status} cm={PROP_C} />` likewise renders `'Signed'` automatically via PROP_C.
- **CallLogDetail GCs panel** (a new panel — see "Sister Surfacing" below): each sister row carries its own Pill rendering `'Signed'` when applicable.
- **PublicSigningPage confirmation**: the "Thank you" confirmation gate per C1 §4 accepts `['Sold','Signed'].includes(view.status)`. Unchanged copy.

---

### Conflict-Prompt UX (lives outside wizard)

**Where the prompt renders.** New component `src/components/SyncConflictModal.jsx` (referenced by §5 resolution / Critical Files). Rendered as a modal overlay similar to NewInquiryWizard's backdrop pattern. Invoked from:
1. **ProposalDetail intro save** at the existing `saveIntro` function (`ProposalDetail.jsx:84-90`).
2. **WTCCalculator save flows** at `handleSave` (`WTCCalculator.jsx:1729`) and the `handleLock` toggle (`WTCCalculator.jsx:1774`).

In both call sites, the save proceeds optimistically (the parent's row is written), then the client calls `preview_sync_to_sisters(sourceProposalId)`. If response is empty / all-empty-conflicts, the client silently calls `apply_source_edit_to_sisters` to push the pending updates and shows a brief toast. If any sister has non-empty `conflicts[]`, the modal renders.

**When it fires.** Per §5 resolution: every parent save that touches one of the source-driven fields, ONLY when at least one active sister exists. Detection client-side: load `cloned_from_proposal_id IS NULL AND EXISTS sisters` once on ProposalDetail mount, cache the boolean, fall through to the no-op silent path when false.

**Modal content (layout).**
- Header: `"Sync to sister proposals"` in `F.display` `fontSize: 22` `color: C.textHead`, with close `✕`.
- Sub-header: source proposal label `"Source: 1234 P1 — GC Foo Inc"` in `C.textMuted`, `F.ui`.
- **Top region** — `"Will be synced automatically"`. List of `pending[]` rows (sister x field), each formatted: small `{customer_name}` chip + field label (`materials`, `field_sow`, `travel:drive_rate`, etc.). Read-only; no toggles. Hidden if `pending[].length === 0`.
- **Bottom region** — `"These fields conflict with sister edits"`. One card per sister (`background: C.linen`, `border 1.5px solid C.borderStrong`, `borderRadius: 10`, `padding: 14`). Per-card body:
  - Sister GC name in `F.display` `fontSize: 15`.
  - For each conflicting field, a side-by-side row:
    - Field label on left (`F.ui`, `fontSize: 12.5`, `color: C.textMuted`).
    - Centered: `"Sister's version"` preview block (text up to 200 chars; for jsonb, JSON.stringify with 2-space indent capped at 6 lines + "…"). Block has `background: C.linenDeep`, `borderRadius: 6`, `padding: 8`, `fontFamily: 'JetBrains Mono'` (already loaded via tokens.js GLOBAL_CSS), `fontSize: 11`.
    - Right: `"Your edit"` preview block, same styling.
    - Below the two previews, a two-button toggle (NewInquiryWizard `ChoiceBtn` pattern): `"Keep sister's"` (default selected) | `"Overwrite with my edit"`. Selected styling is identical to ChoiceBtn (`border 2px C.teal`, `background C.dark`, `color C.teal`).
- **Footer actions.**
  - **Primary CTA — Sync.** Teal button with black text (NewInquiryWizard.jsx:418-423 style): `background: C.teal, color: C.dark`. Per CLAUDE.md Style Rule #2. Copy: `"Sync to sisters"`. On click, builds the `p_force_overwrite` array per the user's toggle picks (one `"<sister_id>:<field>"` string per toggle set to "Overwrite") and invokes `apply_source_edit_to_sisters(sourceProposalId, changed_fields, force_overwrite)`. On success, toast `"Synced N fields to M sisters. P fields kept their local edits."` and closes modal.
  - **Secondary — Don't sync.** `Btn v="ghost"`. Copy: `"Don't sync (keep sisters diverged)"`. On click: closes modal without invoking apply. Source stays edited; sisters stay as-is.
  - **Cancel parent edit.** Defer to v1.1 per §5 resolution (`[DESIGN-OPEN]` to add — recommend not shipping in v1). Wizard does not surface Cancel.

**State written on each action — `locally_edited_fields[]` semantics.** Per §5 resolution table:

| Action | Sister field NOT in `locally_edited_fields[]` | Sister field IS in `locally_edited_fields[]` and user picked "Keep sister's" | Sister field IS in `locally_edited_fields[]` and user picked "Overwrite" |
|---|---|---|---|
| **Sync** | Field overwritten with source value. Flag unchanged (still empty). | Field NOT overwritten. Flag unchanged. | Field overwritten. **Flag removed.** |
| **Don't sync** | No write. **Flag NOT added** (deliberate; per §5 recommendation). | No write. Flag unchanged. | No write. Flag unchanged (Overwrite toggle ignored on dismissal). |

The trigger from §5-cleanup (a) for `proposals.intro` and the (pre-existing) `proposal_wtc` trigger handle flag-population on sister-side edits independently of this modal.

---

### Sister Surfacing in Detail Views

#### ProposalDetail.jsx changes when viewing a sister

A sister proposal (`p.cloned_from_proposal_id != null`) needs to surface its lineage and override state. Changes:

1. **Header treatment** at `ProposalDetail.jsx:660-673`. The existing `<h2>Proposal {p.call_log?.display_job_number} P{p.proposal_number}</h2>` is unchanged. Immediately after the existing `LINKED` / `QB SKIP` badge cluster, insert a new pill `SISTER` styled like `LINKED` (`background: C.dark`, `color: C.teal`, `border 1px solid C.teal`, `borderRadius: 10`, `padding: 3px 10px`, `fontSize: 10.5`, `fontWeight: 700`, `F.ui`, `letterSpacing: 0.04em`). Tooltip: `"Cloned from proposal {parent_display_job_number} P{parent_n}"`.

2. **"Source: <anchor>" link.** New line below the header `<h2>`, inside the existing `<div style={{ color: C.textFaint, fontSize: 13, fontFamily: F.ui, marginBottom: 28 }}>` block at `CallLogDetail.jsx:451-457` equivalent (the customer-name display strip). For sisters, append `· Source: <anchor>` where the anchor renders as a clickable underlined teal-dark link (`color: C.tealDark`, `cursor: pointer`, `textDecoration: underline`, matches `:453` pattern). Click navigates to `/proposals/{parent.id}`.

3. **"Sisters: N" count with quick-switch dropdown.** On the source proposal AND on each sister, render a count chip next to the SISTER (or new SOURCE-OF) pill. Click expands a small `dropdown` (absolute-positioned panel, `background: C.dark`, `borderRadius: 10`, `padding: 14px 18px`, `boxShadow: 0 8px 32px rgba(0,0,0,0.4)`, `zIndex: 100`, `minWidth: 240`) listing every sibling (source + sisters), each row: `{display_job_number P{n}}` badge + `{customer_name}` + `<Pill cm={PROP_C}>`. Click navigates to that sibling.

4. **`locally_edited_fields[]` indicators on edited fields.**
   - `intro` field (`ProposalDetail.jsx:953-981`): when the sister has `'intro' = ANY(p.locally_edited_fields)`, append a small amber chip `OVERRIDDEN` next to the "Email Introduction" header, `background: rgba(249,168,37,0.12)`, `color: #7a5000`, `border 1px solid rgba(249,168,37,0.4)`, `borderRadius: 10`, `padding: 2px 7px`, `fontSize: 10`, `F.ui`. Tooltip: `"This field has been edited locally on this sister and will not auto-sync from the source."`
   - WTC fields (within `WTCCalculator.jsx` save form — but the wizard scope here is only the ProposalDetail header). For ProposalDetail's WTC list view (`:708+`), if any of the WTC's tracked source-driven columns is in its `locally_edited_fields[]`, append a small amber chip `OVERRIDES` on the WTC card next to the lock-status indicator at `:731`. Click expands tooltip listing the overridden fields. Implementation: small additive render in the existing WTC card.

5. **Pull Back behavior for `'Signed'` sisters** — covered by C1 §5 backward-compat audit; not new in this spec but referenced for completeness.

#### CallLogDetail.jsx changes

1. **Sister proposals panel (new).** Currently `CallLogDetail.jsx` shows `linkedProposals` via the `Job Totals` section at `:718+` and possibly elsewhere. Add a new top-level `Section` titled `"GCs on this Project"` between Job Info and Job Totals. Body: one row per non-deleted proposal (anchor first, then sisters by `created_at`), each row:
   - `display_job_number P{n}` badge (Btn/badge-style).
   - GC name (`p.customer_id ? customer lookup : p.call_log.customer_name`). Per the Sweep-1 fallback pattern, resolved via `p.customer_id ?? cl.customer_id` (per CLAUDE.md / `customer_jobs` RPC under S1 resolution).
   - `<Pill label={p.status} cm={PROP_C}>` — renders `'Signed'` per C1 once mockData PROP_C has the entry.
   - `fmt$(p.total)` right-aligned.
   - Row-level action: **Mark Awarded** button (`Btn sz="sm" v="ghost"`, `color: C.green`, `borderColor: C.green`) visible only when:
     - `p.status` is in `['Sent','Has Bid','Signed']` (per §6 BLOCKED-on-C1 spec — `'Signed'` is an awarded-candidate state).
     - The call_log has at least 2 active proposals (single-GC doesn't need an award flow — that uses regular Internal Approve / Send Proposal).
   - Clicking Mark Awarded opens an inline confirm `"Award this proposal? Other GCs will be marked Lost."` and on confirm invokes `award_proposal(p.id, lost_reason)` per §6 spec. RPC handles everything else (status flips, QB sync via wrapper per C1 §3e).

2. **Multi-GC count chip on header** at `:411-413` (next to the existing badge cluster). When `linkedProposals.length >= 2 && linkedProposals.some(p => p.cloned_from_proposal_id != null)`, render a `MULTI-GC` chip styled like the existing `ARCHIVE` chip but in teal-family: `background: rgba(48,207,172,0.12)`, `color: C.tealDeep`, `padding: 3px 10px`, `borderRadius: 10`, `fontSize: 10.5`, `fontWeight: 700`, `F.ui`, `border: 1px solid rgba(48,207,172,0.25)`. Tooltip: `"Proposal sent to multiple General Contractors."`.

3. **Mark Awarded UI — the actual button only.** Per the task scope, the RPC (`award_proposal`) and its server-side semantics are owned by §6. Wizard spec only owns the UI surface: button placement, copy, confirm modal, post-action toast `"Awarded. {n} sisters marked Lost."`, refresh.

---

### Backward-Compat / Migration Notes

**Files that gain new code or modified code:**

- `/Users/chrisberger/sales-command/src/components/MultiGCWizard.jsx` — **new file**. 4-screen wizard, ~700–900 lines mirroring NewInquiryWizard structure.
- `/Users/chrisberger/sales-command/src/components/SyncConflictModal.jsx` — **new file**. Conflict prompt UX. Invoked from ProposalDetail and WTCCalculator save paths. ~250–350 lines.
- `/Users/chrisberger/sales-command/src/components/ProposalDetail.jsx` — modifications:
  - `:674-695` action toolbar — insert `+ Send to Additional GCs` button + state to open MultiGCWizard.
  - `:660-673` header pill cluster — insert SISTER pill + count chip + quick-switch dropdown for sisters.
  - `:451-457` equivalent customer-name strip — append `· Source: <anchor>` link on sisters.
  - `:84-90` saveIntro — wrap with preview/apply sync invocation when source has sisters.
  - `:953-981` intro editor — surface OVERRIDDEN amber chip when sister's `locally_edited_fields` contains `'intro'`.
  - `:708+` WTC list cards — surface OVERRIDES chip per WTC when its `locally_edited_fields[]` is non-empty.
  - All the C1 §5 backward-compat tweaks already enumerated under C1 (Pull Back, Send Proposal, Internal Approve, Download Signed PDF gates).
- `/Users/chrisberger/sales-command/src/components/CallLogDetail.jsx` — modifications:
  - `:414-449` action toolbar — insert `+ Add Another GC` button + state to open MultiGCWizard.
  - `:411-413` header chips — add MULTI-GC chip.
  - Insert new "GCs on this Project" Section between Job Info and Job Totals — sister list + Mark Awarded action.
- `/Users/chrisberger/sales-command/src/pages/Proposals.jsx` — modifications:
  - `:67` STATUS_TABS — add `'Signed'` per C1.
  - `:143` Proposal # column — add `↳` indent + `SISTER` chip when `row.cloned_from_proposal_id != null`. SELECT in `:36, :47` augmented to include `cloned_from_proposal_id`.
- `/Users/chrisberger/sales-command/src/pages/CallLog.jsx` — modifications:
  - `:243` Job # column — add `{count} GCS` chip when call_log has 2+ active proposals. Loader at `:82-91` augmented to compute count (sub-SELECT or post-load `Map` build).
- `/Users/chrisberger/sales-command/src/pages/WTCCalculator.jsx` — modifications:
  - `:1729` handleSave — wrap with preview/apply sync invocation when proposal has sisters; pre-edit snapshot capture for diff.
  - `:316-318` work-type dropdown — UX guard per §5-cleanup (c): disable options whose `work_type_id` is already used on the same proposal, append `" (already on this proposal)"` to label.
  - `:1646-1665` loadWorkTypes — fetch `usedWorkTypeIds` from `proposal_wtc` and pass to dropdown.
  - `:1774` handleLock — pass `markup_override_pct` through to snapshot per §3 spec.
- `/Users/chrisberger/sales-command/src/lib/calc.js` — modifications per §3 spec (`effectiveLaborMarkupPct`, optional `markup_override_pct` param on `calcWtcPrice` / `calcWtcBreakdown`, new `calcProposalTotal` wrapper).
- `/Users/chrisberger/sales-command/src/lib/mockData.js` — add `'Signed': { bg:"rgba(67,160,71,0.10)", text:"#1e5e22" }` to PROP_C per C1 §4.
- `/Users/chrisberger/sales-command/supabase/migrations/20260513000000_multi_gc_allocation.sql` — single migration carrying every DDL change (§3 columns + §3 audit table + §4 RPC + §5 RPCs + §5-cleanup (a)/(c) + C1 updated mark_proposal_signed). Already enumerated in the migration block in the plan doc.

**Files that don't need to change but might look like they should:**

- `/Users/chrisberger/sales-command/src/components/NewInquiryWizard.jsx` — orthogonal. Multi-GC fan-out happens AFTER a call_log + parent proposal exist; the inquiry wizard is upstream and untouched. Reused as a styling/state-shape precedent only.
- `/Users/chrisberger/sales-command/src/components/Pill.jsx` — already accepts arbitrary `label` + `cm` map; adding `'Signed'` is a PROP_C edit, not a Pill component edit.
- `/Users/chrisberger/sales-command/src/components/Btn.jsx` — already supports the variants needed; no new variant required.
- `/Users/chrisberger/sales-command/src/components/SearchSelect.jsx` — Screen 1's GC picker uses a simple `<input>` + scrollable list rather than SearchSelect, mirroring NewInquiryWizard's workTypes selector. SearchSelect is fine as-is for other surfaces.
- `/Users/chrisberger/sales-command/src/components/ContactBillingPicker.jsx` — could be reused on Screen 2's contact picker but adds complexity (billing-locking semantics from existing customers); simpler to inline a contact-picker mirroring `ProposalDetail.jsx:317-370`. ContactBillingPicker unchanged.
- `/Users/chrisberger/sales-command/src/components/NewProposalModal.jsx` — single-proposal-from-call_log creation flow. Orthogonal to multi-GC clone.

**Token usage check (CLAUDE.md Style Rules audit):**

- Rule #1 (no white backgrounds): wizard modal body is `C.linenCard`. Per-sister cards are `C.linen` and `C.linenCard`. Conflict modal preview blocks are `C.linenDeep`. Inputs use `inputStyle` constant which is `C.linenDeep`. No white anywhere. ✓
- Rule #2 (teal buttons get black text): the final Create-N CTA on Screen 4 uses inline `background: C.teal, color: C.dark`. NewInquiryWizard's Save Changes button (`:420`) is the precedent. Sync modal's primary action uses the same form. ✓
- Rule #3 (dollar badges): the metadata chips (`RFP# 1234`, `Bid due May 15`, `Net 30`, `+0 pp`) on Screen 4 sister cards use `C.dark` background + `C.teal` text + `borderRadius: 6` + `padding: 3px 10px`. ✓
- Rule #4 (selected tags/pills): Screen 1 GC list rows, Screen 2 tab pills, conflict modal Keep-vs-Overwrite toggle — all use `C.dark` background + `C.teal` border + `C.teal` text when selected. ✓
- Rule #5 (inputs use `C.linenDeep`): all wizard inputs reuse `inputStyle` constant matching NewInquiryWizard.jsx:9-16. ✓
- Rule #6 (import C from tokens.js): wizard `import { C, F } from "../lib/tokens"`. No local C object. ✓

**Schema additions implied by the wizard (flagged):**

- `proposals.rfp_number text` — per-sister, commerce-side per Q2. Not in current §3 list.
- `proposals.bid_due_date date` — per-sister, commerce-side per Q2. Not in current §3 list. (`call_log.bid_due` continues to hold the project-level bid due.)
- `proposals.billing_terms_override integer` — per-sister, commerce-side per Q2. Not in current §3 list. NULL = inherit from `customers.billing_terms`. (Or alternatively, inline `billing_terms` directly on `proposals`; "override" vs "value" semantic is the [OPEN].)
- `proposals.locally_edited_fields text[]` — already in §5-cleanup (a) resolution; spec'd, not new here.

These three new columns need ratification — they're load-bearing for Q2's per-GC commerce surface, and the wizard's Screen 2 requires them to write per-sister values. The §3 schema block as it stands (Sweep-1 / Sweep-2 / cloned_from / lost_reason / lost_at) does not include them. **[OPEN]** — add to §3 in the next pass, OR collapse them (e.g., consolidate RFP# + bid_due_date into a `commerce_overrides jsonb` if Chris prefers fewer columns; mirror is the `markup_override_pct` pattern of one column per commerce field).

---

### Open Items

1. **Q4 entry-point "+ Send to Additional GCs" disabled state on zero locked WTCs.** Spec says disable with tooltip. Alternative: allow even with zero locked, accepting that Screen 3's preview totals will be uninformative (zero, since `calcWtcPrice` of a fresh WTC with no labor/materials yields 0). Recommend the disable; flagged because real-world reps may want to fan out at the very-early "Draft" stage. Ratify.

2. **Q4 entry-point "+ Add Another GC" gating on `job.is_change_order`.** Spec hides the button on CO call_logs. CO call_logs by nature already have one parent; the multi-GC scenario on a CO is conceivable (rare but real — a CO sent to 3 GCs because the GC roster changed mid-project). Recommend allow; current spec recommends hide. Ratify.

3. **Screen 1 default filter `customer_type === 'Commercial'`.** Today there's no GC-specific tag. Filtering to Commercial is a heuristic. Alternative: ship a new `customer_type` value `'General Contractor'` (or a boolean `is_gc` flag), but that's schema work outside this wizard's scope. Recommend the heuristic + the "Show Residential too" toggle for the long-tail case. Ratify (or commit to the schema-add as a §3 extension).

4. **Screen 2 schema additions** for `rfp_number`, `bid_due_date`, `billing_terms_override`. Not in current §3. Without them, Screen 2's inputs are functionally orphaned at commit-time — they'd have to write to call_log (wrong; call_log is project-level) or be dropped (loses fidelity). Recommend add to §3 in the next pass. Three new nullable columns on `proposals`. Ratify.

5. **Screen 2 intro override on the clone RPC.** The §5-cleanup (a) trigger only fires on UPDATE, not INSERT. To mark a wizard-time intro-override correctly, the clone RPC needs an optional `intro_override` param and inline `locally_edited_fields := ARRAY['intro']` logic. Two RPC body lines + one new field in the `p_targets` jsonb shape. Not in the current §4 RPC body. Ratify the addendum.

6. **Screen 2 viewer contacts (`viewer_contact_ids[]`).** Spec ships v1 with signer-only (one contact per sister). ProposalDetail's recipients today support multiple viewers via the role='viewer' rows. Add multi-viewer to Screen 2 v1.1 if reps surface the need. Defer.

7. **Screen 3 post-lock drift — warn vs. re-snapshot.** Recommend warn-only; CTA-driven re-snapshot rewrites customer-facing prices mid-flight. Worth a Chris call if the warn-only friction is felt later. Ratify.

8. **Screen 4 final CTA → auto-send-proposal-on-create.** Per §4 BLOCKED on H-C2, wizard does NOT auto-invoke `send-proposal` in v1. Sisters land as `'Draft'`; rep navigates to each and clicks Send. After H-C2 ships, an extra "Create + Send All" CTA could land on Screen 4. Defer to post-H-C2.

9. **CallLog.jsx multi-GC count chip.** Requires loader change to compute per-call_log proposal count. Small but real change. Ratify.

10. **Sisters' visual differentiator in Proposals.jsx (↳ indent + SISTER chip).** The C1-Round-2 audit ratification mentioned "Sold-family color with visual differentiator." Picked teal as the Sold-family proxy via PROP_C convention. Chris may want a non-teal differentiator (e.g., a faint left-border on the row, or a lighter row background). Ratify the visual.

11. **Open from prior rounds that the wizard surfaces and doesn't re-litigate but should be noted:**
    - §5 audit-table deferral — wizard does NOT log to `proposal_sync_events`. Forensic gap accepted per §5-cleanup (b).
    - `proposals.pre_lost_status` (reversal capture) — wizard does NOT capture; reversal flow owned by §6.
    - `proposals_status_check` CHECK constraint — wizard does NOT add the constraint, keeps the `'Signed'` value as free-text consistent with C1's recommendation to defer.

12. **Re-opening risk: §3 markup math.** Drawing Screen 3 made clear that the "additive, floor-clamped, labor-only" formula is intuitive to render but the unit-suffix `pp` may confuse reps unfamiliar with percentage-point semantics. If usability testing shows the `pp` suffix lands wrong, fallback is suffix-free input + inline help text `"(percentage points)"`. Doesn't change math, only label. Not a re-litigation; flagged for ratification at QA.

13. **Re-opening risk: §5 conflict modal copy.** The "Sister's version" vs "Your edit" framing is honest but may read as adversarial. Alternative: "Local version" vs "Updated source." Not a math change; ratify the wording.

### Critical Files for Implementation

- /Users/chrisberger/sales-command/src/components/MultiGCWizard.jsx
- /Users/chrisberger/sales-command/src/components/SyncConflictModal.jsx
- /Users/chrisberger/sales-command/src/components/ProposalDetail.jsx
- /Users/chrisberger/sales-command/src/components/CallLogDetail.jsx
- /Users/chrisberger/sales-command/supabase/migrations/20260513000000_multi_gc_allocation.sql

---

## Round 5 Ratifications

_Audit terminal ratified 2026-05-11. All 13 sub-DESIGN-OPENs surfaced by the §7 wizard re-spec resolved. Planning phase closes with this round._

| # | Item | Agent rec | Ratification | Notes |
|---|---|---|---|---|
| 1 | `proposals.rfp_number` + `proposals.bid_due_date` + `proposals.billing_terms_override` (Screen 2 commerce fields) | Add all three to §3 | **Partial accept** | `rfp_number` and `bid_due_date` accepted (see "§3 Schema Amendment — Round 5 Surfaced"). `billing_terms_override` **rejected** — `customers.billing_terms` already covers per-GC terms via Sweep-1's `proposals.customer_id`. No evidence reps need a per-proposal override on top of the per-customer setting. |
| 2 | Clone RPC needs inline `locally_edited_fields := ARRAY['intro']` on INSERT (§5-cleanup (a) trigger fires on UPDATE only) | Add as RPC addendum | **Accept** | §4 `clone_proposal_to_gcs` body extends: read optional `intro_override` from `p_targets`, and when present write both the override value AND `locally_edited_fields = ARRAY['intro']` to the sister row on INSERT. Without this the sister's first-edit-after-clone would be miscounted as "originated from source." |
| 3 | Multi-viewer recipients (`viewer_contact_ids[]`) on Screen 2 | Defer to v1.1; v1 signer-only | **Accept** | File F-class BACKLOG row. v1 ships with one signer per sister; multi-viewer is a v1.1 ask if reps surface the need. |
| 4 | Hide "+ Add Another GC" on `call_log.is_change_order = true` | Hide on COs | **Accept** | COs are scope-extensions of an existing project; multi-GC on a CO is conceivable but rare. If reps need it later, file a feature row. |
| 5 | Markup override input suffix: `pp` vs no-suffix-with-help-text | Use `pp` suffix | **Accept** | Industry-standard for additive percentage-point shifts. Fallback to suffix-free + inline help text "(percentage points)" only if QA usability shows confusion. |
| 6 | Conflict modal framing: "Sister's version" / "Your edit" vs "Local version" / "Updated source" | Use "Local version" / "Updated source" | **Accept** | Less adversarial. Math/behavior unchanged; pure copy revision. |
| 7 | "+ Send to Additional GCs" entry button disabled state on zero locked WTCs | Disable with tooltip | **Accept** | Tooltip copy: "Lock at least one WTC before fanning out." Same gate must apply to "+ Add Another GC" on CallLogDetail when its pre-selected source proposal has zero locked WTCs — implementation must confirm both surfaces enforce the gate. |
| 8 | Screen 1 GC picker default filter `customer_type === 'Commercial'` | Heuristic + "Show Residential too" toggle | **Accept** | File F-class BACKLOG row to replace the Commercial-as-proxy heuristic with an explicit GC flag on `customers` (boolean `is_gc` or new `customer_type='General Contractor'` enum value). Heuristic produces false positives over time; the BACKLOG row makes the eventual cleanup visible. |
| 9 | Screen 3 post-lock drift — warn vs re-snapshot | Warn-only | **Accept** | H6 invariant (locked = price snapshot) takes precedence over wizard convenience. Re-snapshotting customer-facing prices mid-flight is the precise hazard `locked_line_total` guards. Existing unlock-then-relock flow already exists; don't duplicate inside wizard. |
| 10 | Screen 4 final CTA — Create-only vs Create-and-Send | Create-only in v1; defer Create-and-Send to post-H-C2 | **Accept** | Fanning out N `send-proposal` calls from one click while H-C2 is open amplifies the body-trust surface. **Implementation note:** §4 RPC H-C2-BLOCKED line and Screen 4 CTA both need to be re-opened together once H-C2 lands; cross-referenced below. |
| 11 | CallLog.jsx multi-GC count chip | Ship the chip | **Accept with note** | Implementation must use a single PostgREST query with a count aggregate (or a denormalized `active_proposal_count` field on `call_log` if simpler), **NOT** an N+1 fetch per call_log row. CallLog paginates at 1000; N+1 would compound. Flagged in §10 step 8. |
| 12 | Sisters' visual differentiator in Proposals.jsx list view | `↳` indent prefix + `SISTER` chip (`C.teal`-on-`C.dark`) | **Accept** | Two reinforcing signals (relationship via indent, category via chip). Source proposal needs no marker — implicitly the un-indented row with sisters attached. If list ordering scatters sisters away from source, consider grouping by `call_log_id` in the implementation pass; flag if needed. |
| 13 | Carry-forwards from prior rounds (sync_events deferral, `pre_lost_status` to §6, `proposals_status_check` skip) | Keep all deferred per prior decisions | **Accept** | No new decisions. Confirms the wizard didn't accidentally re-open prior-round closeouts. |

### Cross-references the closeout adds

- **H-C2 dependency pair:** when H-C2 lands and `send-proposal` is hardened, BOTH (a) the §4 `clone_proposal_to_gcs` BLOCKED-on-H-C2 note + (b) the Screen 4 CTA "Create + Send All" deferral (Round 5 open-item 8 / Ratification #10) need to re-open together. They're a coupled pair.
- **§10 step 8 amendment:** the CallLog.jsx multi-GC count chip implementation must use a single aggregate query, not N+1.

---

## §8 Edge cases

**[DERIVED + BLOCKED]**

1. **First-signer-while-others-pending (C1).** A sister signs before Mark Awarded runs. See C1 resolution below — `mark_proposal_signed` must NOT flip `call_log.stage='Sold'` when sisters exist, AND must NOT trigger qb-create-job from ProposalDetail.handleInternalApprove on a non-awarded sister.

2. **Source proposal deleted while sisters exist.** `cloned_from_proposal_id` has `ON DELETE SET NULL`. Sync RPCs already gate on source existence and just no-op when source is gone. Soft-delete on parent is fine (status flips to deleted, sisters orphaned-but-functional). Hard-delete blocked elsewhere.

3. **Sister status drift via direct status edits in UI.** A sales rep could manually set a sister to 'Sold' without going through `award_proposal`. Defend with a CHECK constraint or trigger: when a proposal's status flips to 'Sold' AND the call_log has other non-Lost sisters, raise a warning / require explicit confirmation. **[DESIGN-OPEN]** — strict enforcement vs. UX-permissive.

4. **Shared `job-attachments` storage paths between sisters.** When sister proposals share a `call_log_id`, they share the storage bucket prefix `{call_log_id}/...`. The H-B2 audit finding (`job-attachments` delete policy lacks tenant scope) is already on the radar; multi-GC adds the sister-shares-attachment dimension. Recommend: leave shared-by-design (one project, one attachment library), document in §9 test plan. **[BLOCKED on H-B2]** for cross-tenant story (F7-future).

5. **Invoices on the call_log.** Today invoices key off `call_log.display_job_number` or `call_log.id::text`. Sisters share the call_log — so invoicing happens only after Mark Awarded, against the winner's `proposal_id`. No change.

6. **Re-cloning a sister.** Wizard refuses if `cloned_from_proposal_id IS NOT NULL` — only parents can spawn sisters. (Prevents diamond inheritance.)

7. **Source-edit during in-flight sister signing.** A customer is reading sister X's signing page. The rep edits the parent. Should sister X's signing page see the new SOW mid-read? Probably yes (Q2 source-driven semantics) — but the customer might be confused. **[DESIGN-OPEN]** — surface a "your proposal has been updated, please refresh" banner via Realtime? Or accept the rarity.

8. **Tenant boundary on `clone_proposal_to_gcs`.** All sisters land on the source's tenant via the RPC's tenant lookup. Cross-tenant clones impossible (RPC raises TENANT_MISMATCH). F7-clean.

9. **proposals.signing_token uniqueness.** The new `uq_proposals_signing_token_active` unique index (migration 0510) means each sister gets `gen_random_uuid()` as its token — already handled in §4 RPC.

10. **Markup additivity vs multiplicativity.** See §3 [DESIGN-OPEN].

11. **`proposal_recipients` per sister.** Each sister needs its own recipients (one signer, viewers). Wizard collects per-GC; RPC inserts. Recipients are NOT source-synced. **[LOCKED via Q2]** (commerce side).

---

## §9 Test plan

**[DERIVED]**

**Unit (psql, fresh scratch DB):**
- T1. Create call_log + parent proposal + 3 WTCs. Lock + send parent. Call `clone_proposal_to_gcs` with 3 targets. Verify: 3 sister proposals inserted with distinct customer_ids, 3×3=9 proposal_wtc rows, all sisters' WTCs have `locked=false AND locked_line_total IS NULL` (C2), all sisters have distinct `signing_token` and matching `cloned_from_proposal_id`.
- T2. Edit parent's `intro` text. Call `preview_sync_to_sisters` → expect 3 sisters with no conflicts. Call `apply_source_edit_to_sisters` → verify 3 sisters now have the new intro.
- T3. Edit sister 2's `proposal_wtc.materials`. Verify `locally_edited_fields` contains `'materials'` (DB trigger fires). Edit parent's materials. `preview_sync_to_sisters` returns sister 2 with a conflict. `apply_source_edit_to_sisters` with empty force_overwrite leaves sister 2 alone, updates sisters 1 + 3.
- T4. Call `award_proposal(sister 1)`. Verify sister 1 → Sold, sisters 2 + 3 → Lost with lost_reason + lost_at, call_log.stage = Sold. Verify QB sync hook fires for sister 1 only.
- T5. Call `mark_proposal_signed(sister 2's token)` (simulating customer signing) BEFORE award. **C1 BLOCKED** — desired behavior pending resolution. Once resolved, T5 verifies the new behavior.
- T6. Tenant isolation: create proposals under tenant A, try to clone as tenant B user → expect TENANT_MISMATCH.
- T7. `customer_jobs` surface (S1 fix verification): customer X with proposal where `proposals.customer_id = X` but `call_log.customer_id = Y` → verify X's detail page shows the proposal.

**Integration (Vercel preview branch):**
- I1. Full wizard happy path from ProposalDetail entry. Mockup-style 4 screens. End state: 3 sisters appear in CallLogDetail's GC panel.
- I2. Wizard entry from CallLogDetail. Same end state.
- I3. Customer signing flow on one sister. C1 behavior verification.
- I4. Mark Awarded flow with reversal.
- I5. Source-edit conflict modal (T3 user-visible).
- I6. PublicSigningPage on each sister renders the sister's own GC customer (verify `get_public_proposal_view` COALESCE update is live).

**Smoke (prod, after merge):**
- S1. Single live test job. Clone to 1 fake-GC. Verify status. Delete after.

---

## §10 Implementation order

**[DERIVED]**

1. **Verifications first.** Run §11 verification queries against prod (read-only). Confirm proposals.status / call_log.stage are text (no ALTER TYPE needed). Confirm proposals.id is text. Captures C3 + C4 resolution evidence in the plan itself.
2. **Migration 1 — schema columns + audit table.** All ALTERs in §3. Apply to staging. Smoke read paths (existing proposals still load). Apply to prod.
3. **Client fallback pattern rollout.** Replace `call_log?.customer_id` with `customer_id ?? call_log?.customer_id` everywhere in src/. Three known sites: ProposalDetail.jsx:62, :282; ProposalPDFModal.jsx:31. Plan agent's prior delivery flagged "Customers.jsx + 4 other files" — re-grep to be sure. Update `get_public_proposal_view` RPC to COALESCE customer chain (§11 v98 finding still valid).

   - **2026-05-13 amendment (Amendment 1) — Section 3 pre-Sweep-1 audit deltas (S1 + S2 + S3 lint).** Pre-build audit (2026-05-13) confirms all 7 V5 sites match the repo line-for-line and the `get_public_proposal_view` RPC still carries the `WHERE c.id = cl.customer_id` predicate at mig `20260510120000:344`. Two structural gaps surfaced that V5's `customer_id`-only frame did not cover, plus one line-cursor lint. **Does not edit V5 or step 3's original sentence** per [Schema Amendment Not Overwrite]; both remain authoritative on the site inventory. This amendment locks the fix shape for the two gaps and instruments the line-cursor drift.

   **A1.1 Class A `customers` join object is also stale — not just `customer_id`.**

   Sites that load the full `customers` join object via `…call_log.customers` (in addition to the bare id):
   - `supabase/functions/send-invoice/index.ts:72` — `invoice.proposals?.call_log?.customers` (billing-email resolution against `billing_email` / `contact_email` / `email`)
   - `supabase/functions/send-pay-app/index.ts:181` — `(invoiceRow as any).proposals?.call_log?.customers` (allowed-recipient set, audit C9 soft allowlist)
   - `src/components/ProposalPDFModal.jsx:32-33` — `proposal.call_log?.customers?.contact_email`, `proposal.call_log?.customer_name` (recipient primary)
   - `src/components/ProposalDetail.jsx:287` — local-state mutation: `setP(prev => ({ ...prev, call_log: { ...prev.call_log, customers: {...} } }))` after `savePrimaryEmail()` writes the customer record

   **Problem.** V5 Sweep-1 reshapes `customer_id` resolution to `proposals.customer_id ?? call_log.customer_id`. When a sister proposal carries its own `proposals.customer_id` distinct from `call_log.customer_id`, fixing the id alone leaves the joined `customers` object pointing at the **parent's** customer record. Every downstream read off that object (`customer.billing_email`, `customer.contact_email`, `customer.email`, `customer_name`) silently uses the wrong customer for the sister — the same delta as the id, but the fix at the id-line does not propagate.

   **[LOCKED] Fix shape — edge functions (`send-invoice`, `send-pay-app`).** Extend the PostgREST select to embed `customers` twice: once via the new `proposals.customer_id` FK (named `proposals_customer_id_fkey`, auto-generated by Migration 1a lines 19–21: `ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL`), and once via the existing `call_log.customers` join. Resolution: `const customer = proposals.customers ?? proposals.call_log?.customers;` mirrors the id-fallback rule exactly. PostgREST returns `null` for an unmatched FK embed, so the `??` short-circuits naturally. One round-trip; no extra fetch.

   **[LOCKED] Fix shape — client components (`ProposalDetail.jsx`, `ProposalPDFModal.jsx`).** Mirror the same embed in the callers that populate `pInit` / `proposal` (the page/list selects in `Proposals.jsx`, `Home.jsx`, etc.). Component-level resolution: `const customer = p.customers ?? p.call_log?.customers`. **`ProposalDetail.jsx:287` state mutation revised** to write the customer record into whichever branch was the source of truth — if `p.customers` is non-NULL, mutate `prev.customers`; else fall back to mutating `prev.call_log.customers`. Inline `??` is fine; a `useResolvedCustomer(p)` hook is **[DESIGN-OPEN]** for build-session stylistic preference (non-load-bearing).

   **[DERIVED] PostgREST schema cache.** Migration 1a was applied 2026-05-12; the schema cache already knows the new column. The `customers!proposals_customer_id_fkey(...)` embed shape is available now. **Build-time verify** with one curl probe before the patch lands: `curl "$URL/rest/v1/proposals?select=id,customers!proposals_customer_id_fkey(id)&limit=1"` (anon key, staging or prod read-only). Expect `{customers: null}` on parent proposals — confirms the embed parses and the FK is reachable.

   **A1.2 Class B `Customers.jsx:519` uses `call_log!inner(customer_id)` — `!inner` filters before `.or()` can reach.**

   Current select shape at `:518-519`:
   ```
   "id, total, status, created_at, proposal_number, call_log_id, call_log!inner(customer_id), proposal_wtc(work_types(name))",
   { filters: [["is", "deleted_at", null], ["eq", "call_log.customer_id", customer.id]], ... }
   ```

   The `call_log!inner` forces a SQL INNER JOIN. Proposals whose `call_log.customer_id` does not equal `customer.id` are filtered OUT before PostgREST resolves any `.or()` predicate on `proposals.customer_id`. The V5 diagnosis ("`.or()` or refactor to a view") is correct in direction; **`.or()` alone is insufficient** at this site.

   **[LOCKED] Fix shape — read-only view.** Add a `proposals_with_effective_customer` view in a follow-on migration:

   ```sql
   CREATE OR REPLACE VIEW public.proposals_with_effective_customer AS
   SELECT
     p.*,
     COALESCE(p.customer_id, cl.customer_id) AS effective_customer_id
   FROM public.proposals p
   LEFT JOIN public.call_log cl ON cl.id = p.call_log_id;
   ```

   Both Customers.jsx call sites (`:258` templates + `:519` detail list) filter against the view via `.eq("effective_customer_id", customer.id)`. The `call_log!inner` scaffold is removed from the select — the view already resolves the join. `proposal_wtc(work_types(name))` embedding survives if PostgREST treats views as embed sources (typical when the view exposes the underlying FK columns; `proposal_wtc.proposal_id` references `proposals.id`, and the view exposes `id` from `p.*`).

   **Migration shape.** Single `CREATE OR REPLACE VIEW`. No data backfill. No dependency on Migration 1b (consumes only Migration 1a's `proposals.customer_id` + the existing `call_log.customer_id`). RLS inherits from base tables — Postgres views run as the querying role; underlying RLS on `proposals` + `call_log` still gates row visibility.

   **[DESIGN-OPEN]** View name (`proposals_with_effective_customer` vs shorter `v_proposals_customer` or similar) — naming-only; ratify at build kickoff.

   **[DERIVED] Fallback if PostgREST view-embedding fails.** Some PostgREST versions require an explicit FK declaration to embed resources through a view. If `proposal_wtc(work_types(name))` embed errors at build-time, fall back to two queries per render: one against the view for matching ids, one against `proposals` (with full embeds) filtered by `IN (ids)`. Same surface, +1 round-trip per Customers detail view render. Non-blocking.

   **A1.3 Lint — V5 line-cursor drift.**

   V5 cites `supabase/functions/qb-create-job/index.ts:146` for the Class C comment; current line is `:160` (≥14 lines of drift since v98 sweep). The site itself is correct (Class C, comment-only, no change needed). **Build instruction:** re-grep every V5-cited line number against current code immediately before authoring the Sweep-1 patch; trust V5's site set, not its line cursors. Mechanical re-grep at build start prevents the patch from landing on stale anchors.

   **A1.4 Confidence-tag summary.**

   | Subsection | Tag | Notes |
   |---|---|---|
   | A1.1 edge-fn embed shape (`customers!proposals_customer_id_fkey`) | [LOCKED] | FK exists in Migration 1a; embed verifiable pre-patch via curl probe. |
   | A1.1 client embed shape (mirror in callers) | [LOCKED] | Same FK; same shape. |
   | A1.1 `ProposalDetail.jsx:287` state-mutation revision | [DERIVED] | Forced by the resolution rule; exact branching left to build. |
   | A1.1 `useResolvedCustomer(p)` hook vs inline `??` | [DESIGN-OPEN] | Stylistic; non-load-bearing. |
   | A1.2 view refactor (`proposals_with_effective_customer`) | [LOCKED] | Forced by `!inner` join structure; `.or()` cannot reach filtered-out rows. |
   | A1.2 view name | [DESIGN-OPEN] | Naming only. |
   | A1.2 PostgREST view-embedding fallback (two-query path) | [DERIVED] | Triggers only if view-embedding fails at build; non-blocking. |
   | A1.3 V5 line-cursor drift | [DERIVED] | Re-grep at build start; site set unchanged. |

   **A1.5 Out of scope (noticed-but-not-touched per stay-scoped rule).**

   - The `customer_name` denormalization on multi-GC `targets[]` (§7 wizard line 1514, 1595) is independent of this amendment. The sister's `customer_name` at clone time is captured in the wizard state and persisted onto the cloned proposal's display path; that is a different code path from the `customers` join object addressed here.
   - `get_public_proposal_view` RPC update (step 3 original sentence): the COALESCE-customer-chain change is unchanged by this amendment; both the bare `customer_id` line and any joined customer fields in the RPC return shape need the same parallel treatment. Build-session: review the RPC return shape (`p.customer_id` derivation + any `customers` columns it pulls) against this amendment before drafting the RPC migration.
   - Any other surface that reads `…call_log.customers` outside the 4 named sites — V5 inventory is for `call_log.customer_id` derivation; the parallel inventory for the `customers` join object was not run. Reasonable assumption: same surface, since `customers` is always joined via `call_log` today and the 4 sites are the same as Class A. But a build-time grep for `call_log?.customers` would close the certainty gap. Recommend running it.

4. **S1 fix** — pick one of (a)/(b)/(c) below, ship before any sister can be created with a divergent customer_id.

   - **2026-05-14 amendment (Amendment 1) — Section 4 pre-build audit deltas (RPC body shape + transitive dependency + pagination + cross-section gaps).** Pre-build audit (2026-05-14) confirms all 3 S1-cited Customers.jsx sites match the repo line-for-line at `:253-263` (PayAppTemplateModal), `:511-515` (jobs fetchAll), `:516-520` (proposals fetchAll). Surfaces: one transitive scope dependency (`:521-525` invoices), one substrate-sharing decision for `customer_proposals` vs step 3's locked `v_proposal_customer_resolved` view, four RPC-body shape questions (role gate, top-of-body guards, defense-in-depth tenant filter, soft-delete column), one pagination concern (`fetchAll` does not paginate `.rpc()`), one adjacent write-side bug (`merge_customers` RPC misses `proposals.customer_id`), and one cross-amendment finding (step 3's A1.1 inventory missed two pay-app modal sites). **Does not edit step 4's original sentence or the S1 section at lines 2726-2763** per [Schema Amendment Not Overwrite]; the option (a/b/c) menu and recommended (b) remain authoritative. This amendment specifies the (b) build shape, defers two findings to separate work (B19 + step 3 §A1.1 Extension same session), and instruments the pagination guard.

   **A2.1 Site cursor verification (no drift at audit time).**

   All three plan-cited Customers.jsx sites match the repo line-for-line as of 2026-05-14:
   - `:253-263` — PayAppTemplateModal useEffect (plan cites `:253-260`; current useEffect body runs through `:263`)
   - `:511-515` — jobs fetchAll (plan cites `:514`, the filter-argument line — exact match)
   - `:516-520` — proposals fetchAll (plan cites `:516-519`, the body — exact match)

   No A1.3-style cursor-drift lint needed today. **Build instruction (mechanical safeguard, mirrors §A1.3):** re-grep these sites immediately before patch authoring in case of drift between this amendment and build start.

   **A2.2 Transitive scope dependency — `Customers.jsx:521-525` invoices fetch.**

   The S1 section enumerates jobs + proposals call sites only. The invoices fetch at `:521-525` is transitively affected by S1 but not named:

   ```js
   // :521-525
   fetchAll("invoices",
     "id, amount, status, sent_at, paid_at, job_id, job_name, invoice_lines(proposal_wtc(work_types(name)))",
     { filters: [["is", "deleted_at", null]], order: ... })
   // :530 — client-side filter
   setInvoices(i.filter(inv => jobIds.has(inv.job_id)));
   ```

   The query has no `customer_id` filter; customer scoping happens at `:530` via intersection with `jobIds` (derived from site #2's call_log fetchAll). For a sister proposal where `proposals.customer_id = X` but `call_log.customer_id ≠ X`, the parent call_log never enters `j` → not in `jobIds` → invoice silently disappears from the customer detail page.

   **[LOCKED] No direct fix required.** When site #2 swaps to `rpc("customer_jobs", …)` per recommendation (b), `jobIds` returns sister-parent call_logs and the invoice intersection auto-heals. **Plan-hygiene addendum:** any future invoice-by-customer surface that bypasses the `jobIds.has(...)` intersection (e.g., a future "all invoices for customer X" tab on Invoices.jsx) must use `customer_jobs(...)` first and intersect, OR get its own RPC. The "4 client-call-site changes" count at S1 line 2756 stays accurate only because invoices is downstream of site #2.

   **A2.3 Substrate sharing — `customer_proposals` SELECTs from `v_proposal_customer_resolved`.**

   Step 3 (Step 3 Ratifications row #2, 2026-05-13) locks the view `v_proposal_customer_resolved` to encode `effective_customer_id = COALESCE(p.customer_id, cl.customer_id)`. Step 4 recommendation (b) ships `customer_proposals(p_customer_id)` which encodes the same rule.

   **[LOCKED] Share substrate.** `customer_proposals` body routes the customer-resolution predicate through the view (not inlined). The COALESCE rule lives in exactly one schema object; if §5 / §7 ever extends the resolution chain, the RPC follows automatically. **Build-order coupling:** step 3's view migration must apply before step 4's RPC migration (already correct in §10 order — step 3 → step 4).

   **View tenant_id availability confirmed.** View body exposes `p.*` (see step 3 Amendment 1 §A1.2, lines 2056-2062) — `proposals.tenant_id` flows through transparently, so the RPC body's `AND tenant_id = v_tenant_id` predicate resolves against the view-flowed column.

   `customer_jobs` does NOT share substrate (it returns `SETOF public.call_log`; the predicate joins through `proposals` directly — see A2.4 body shape).

   **A2.4 RPC body shape — guards, role gate, tenant filter, soft-delete column.**

   Four body-shape questions ratified against existing precedent (`delete_customer` at `20260430120000_customer_delete_merge.sql:106-163`; `archive_filter_options_rpc` at `20260417120000`; `get_user_tenant_id` at `20260509120000`):

   - **[LOCKED] No role gate.** Both `customer_jobs` and `customer_proposals` are read-only surfaces consumed by every authenticated user (incl. Sales). Match `archive_filter_options_rpc` (read-only, tenant-filtered only). Do **NOT** add `IF NOT public.is_admin_or_manager() THEN RAISE 'FORBIDDEN' ...`.
   - **[LOCKED] Top-of-body guards.** Mirror `delete_customer:119-138`: `RAISE 'NO_TENANT'` if `get_user_tenant_id()` is NULL; `RAISE 'TENANT_MISMATCH'` if the passed-in customer's tenant ≠ caller's tenant. Surfaces config errors loudly instead of silent empty results (which would be visually identical to "customer has no jobs").
   - **[LOCKED] Defense-in-depth tenant filter inside the final SELECT.** Even with the customer-tenant check, both RPC bodies add `AND tenant_id = v_tenant_id` predicates inside the work SELECT (on `call_log` for `customer_jobs`; on the view for `customer_proposals`; AND inside the EXISTS sub-SELECT on `proposals` for `customer_jobs`). SECURITY DEFINER bypasses RLS; an explicit predicate is the only protection against tenant leak under data drift (e.g., a sister proposal whose `tenant_id` somehow ≠ parent call_log's `tenant_id`). Belt + suspenders.
   - **[LOCKED] `call_log.deleted_at` does NOT exist.** Verified via migration grep + CLAUDE.md verified-columns block. The current `:511-515` fetchAll has no soft-delete filter on call_log; matches reality. `customer_jobs` body must NOT add such a filter. (`proposals.deleted_at` exists and IS filtered, per the EXISTS sub-SELECT below.)

   `customer_jobs` body shape (locked predicate; full plpgsql framing mirrors `delete_customer`):

   ```sql
   CREATE OR REPLACE FUNCTION public.customer_jobs(p_customer_id uuid)
     RETURNS SETOF public.call_log
     LANGUAGE plpgsql
     STABLE
     SECURITY DEFINER
     SET search_path = public
   AS $$
   DECLARE
     v_tenant_id uuid;
     v_customer  public.customers%ROWTYPE;
   BEGIN
     v_tenant_id := public.get_user_tenant_id();
     IF v_tenant_id IS NULL THEN
       RAISE EXCEPTION 'NO_TENANT';
     END IF;

     SELECT * INTO v_customer
       FROM public.customers
      WHERE id = p_customer_id;
     IF NOT FOUND THEN
       RAISE EXCEPTION 'NOT_FOUND';
     END IF;
     IF v_customer.tenant_id <> v_tenant_id THEN
       RAISE EXCEPTION 'TENANT_MISMATCH';
     END IF;

     RETURN QUERY
       SELECT cl.*
         FROM public.call_log cl
        WHERE cl.tenant_id = v_tenant_id
          AND (
            cl.customer_id = p_customer_id
            OR EXISTS (
              SELECT 1 FROM public.proposals p
               WHERE p.call_log_id = cl.id
                 AND p.tenant_id = v_tenant_id
                 AND COALESCE(p.customer_id, cl.customer_id) = p_customer_id
                 AND p.deleted_at IS NULL
            )
          );
   END;
   $$;

   REVOKE ALL ON FUNCTION public.customer_jobs(uuid) FROM public;
   GRANT EXECUTE ON FUNCTION public.customer_jobs(uuid) TO authenticated;
   ```

   `customer_proposals` body shape (locked predicate; view-backed per A2.3):

   ```sql
   CREATE OR REPLACE FUNCTION public.customer_proposals(p_customer_id uuid)
     RETURNS SETOF public.v_proposal_customer_resolved
     LANGUAGE plpgsql
     STABLE
     SECURITY DEFINER
     SET search_path = public
   AS $$
   DECLARE
     v_tenant_id uuid;
     v_customer  public.customers%ROWTYPE;
   BEGIN
     v_tenant_id := public.get_user_tenant_id();
     IF v_tenant_id IS NULL THEN
       RAISE EXCEPTION 'NO_TENANT';
     END IF;

     SELECT * INTO v_customer
       FROM public.customers
      WHERE id = p_customer_id;
     IF NOT FOUND THEN
       RAISE EXCEPTION 'NOT_FOUND';
     END IF;
     IF v_customer.tenant_id <> v_tenant_id THEN
       RAISE EXCEPTION 'TENANT_MISMATCH';
     END IF;

     RETURN QUERY
       SELECT v.*
         FROM public.v_proposal_customer_resolved v
        WHERE v.effective_customer_id = p_customer_id
          AND v.tenant_id = v_tenant_id
          AND v.deleted_at IS NULL;
   END;
   $$;

   REVOKE ALL ON FUNCTION public.customer_proposals(uuid) FROM public;
   GRANT EXECUTE ON FUNCTION public.customer_proposals(uuid) TO authenticated;
   ```

   **[DERIVED] Return type `SETOF public.v_proposal_customer_resolved`.** Postgres registers views in `pg_type`, so `SETOF <view>` is a valid function return type. PostgREST surfaces view-typed RPC returns the same as table-typed (columns + RLS-bypassed reads). Client receives one extra column per row (`effective_customer_id`) which is harmless; existing Customers.jsx selects only the columns it consumes. **Fallback if PostgREST view-typed return errors at build:** change return type to `SETOF public.proposals` and route the predicate through `WHERE id IN (SELECT id FROM v_proposal_customer_resolved WHERE …)`. Same substrate-sharing intent; one extra sub-SELECT. Non-blocking.

   **A2.5 Pagination — `fetchAll` does not cover `.rpc()` calls.**

   Current `Customers.jsx:511-515` uses `fetchAll("call_log", …)` (helper at `src/lib/supabaseHelpers.js:11-31`) which loops `.range()` to bypass PostgREST's 1000-row cap. Swapping naïvely to `supabase.rpc("customer_jobs", { p_customer_id: X })` **silently drops pagination**: the helper is hardcoded to `supabase.from(table)` and does not branch on `.rpc()`.

   **Empirical (prod count):** Anon-key probe returns `*/0` (RLS hides counts from unauthenticated reads); not directly verifiable without a logged-in session. Reasoned product context: a sub-contractor business is unlikely to have any single GC with >1000 call_logs in the foreseeable future. The cap doesn't realistically bite today.

   **[LOCKED] Build fix — sibling `fetchAllRpc(name, args, opts)` helper in `src/lib/supabaseHelpers.js`.** Mirrors `fetchAll`'s shape exactly; loops `.range()` around `supabase.rpc(name, args)` until a page returns short. Three call sites switch:

   - `Customers.jsx:256-260` (PayAppTemplateModal proposals fetch) → `fetchAllRpc("customer_proposals", { p_customer_id: customerId })`
   - `Customers.jsx:511-515` (jobs fetchAll) → `fetchAllRpc("customer_jobs", { p_customer_id: customer.id })`
   - `Customers.jsx:516-520` (proposals fetchAll) → `fetchAllRpc("customer_proposals", { p_customer_id: customer.id })`

   Site `:521-525` (invoices fetchAll) does NOT change (per A2.2). Centralizing the truncation guard in one helper matches the existing pattern; per-site `.range()` loops would scatter the same logic 3+ times.

   **A2.6 Out of scope (noticed-but-not-touched per stay-scoped rule).**

   - **`merge_customers` RPC misses `proposals.customer_id` re-pointing.** Surfaced during Pass 3 wider-site sweep. Migration `20260430120000_customer_delete_merge.sql:192-330` was authored before Migration 1a added `proposals.customer_id`. The merge body re-points `call_log`, `customer_contacts`, `customer_pay_app_templates`, then `DELETE FROM customers WHERE id = p_dup_id` — which fires `ON DELETE SET NULL` on the new FK, silently nulling any sister proposal's explicit pointer. Functionally OK via COALESCE fallback (sister resolves to survivor via call_log after step 1 of merge), but explicit lineage is lost — audit/history forgets the proposal was ever a sister. **Filed as BACKLOG B19** (separate T2 row + own migration per Step 4 Ratifications row #6). Outside step 4 scope (read-side fix vs write-side gap; cleaner rollback granularity in separate migrations).
   - **`NewPayAppModal.jsx:39` + `PayAppDetailModal.jsx:66` pre-populate customer from `call_log` only.** Same A1.1 class as step 3's amendment (sister proposals load wrong GC's pay-app templates because the modal reads customer via the call_log join, ignoring `proposals.customer_id`). **Filed as §10 Step 3 §A1.1 Extension — 2026-05-14** (separate amendment block following [Schema Amendment Not Overwrite]). Outside step 4 scope (step 3 surface; fix lives in step 3's hook).
   - **PostgREST schema cache reload for new RPCs** — verified at build time via curl probe (parallels Step 3 Amendment 1 §A1.1 schema-cache protocol). Build session runs the one-shot before deploy.
   - **O7 (multi-repo migration timestamp coordination)** — load-bearing again for step 4's RPC migration. Same workaround applies: `supabase migration list --linked` immediately before timestamp assignment. Still T1 in BACKLOG.

5. **C1 fix** — modify `mark_proposal_signed` (5-arg) + replace ProposalDetail.handleInternalApprove path. Migration B-style two-step to stay compat-safe.
6. **RPCs** — `clone_proposal_to_gcs`, `award_proposal`, `preview_sync_to_sisters`, `apply_source_edit_to_sisters`, `reverse_award`. Single migration, all SECURITY DEFINER, all check `NO_TENANT`.
   - **2026-05-12 amendment:** Blocked by O5/Migration 1b — UNIQUE `(proposal_id, work_type_id)` constraint must apply before §4 + §5 RPCs ship. Plan line 1214: both §4 clone and §5 sync RPCs join by `work_type_id`; without UNIQUE they are "silently wrong half the time." V8 pre-flight (2026-05-12) returned 17 dup pairs across 14 proposals; UNIQUE deferred to Migration 1b pending B17 (importer root-cause) + B18 (dup triage).
   - **2026-05-12 (second amendment):** First amendment (blocked-by-O5) is overturned. O5 closed Won't-Do (see §5(c) Reversal). §10 step 6 is now blocked on F16 (§5 sync-identity re-plan via `cloned_from_wtc_id` lineage column), NOT on Migration 1b UNIQUE constraint.
   - **2026-05-13 (third amendment) — F16 closure (Amendment 3):** Step 6 now consumes the lineage column locked in §5 Amendment 1 — 2026-05-13. Build sequence for step 6 is updated below. **Does not edit prior amendments.** Companion to §5 Amendment 1; the two amendments must be ratified together before any RPC code lands.

   **A3.1 Sequencing inside step 6.** Step 6 splits into two sub-steps:
   - **6a. Migration 1b** — ships the `proposal_wtc.cloned_from_wtc_id` column + partial index per §5 Amendment 1 §D. **Must apply to prod before any 6b RPC body is authored.** Filename timestamp [DESIGN-OPEN] per O7 (cross-repo coordination). Rationale for splitting: lets the substrate exist on prod (PostgREST schema cache picks up the new column on next request, sync RPCs can be re-checked against actual schema before commit) without coupling the schema decision to the RPC-body decision.
   - **6b. RPC migration** — `clone_proposal_to_gcs` (revised body per A3.2), `preview_sync_to_sisters` (revised body per A3.3), `apply_source_edit_to_sisters` (revised body per A3.3), `award_proposal`, `reverse_award`. Single migration. All `SECURITY DEFINER`, all check `NO_TENANT`. `award_proposal` and `reverse_award` are **unchanged** by F16 — they touch proposal-level status and don't join WTCs cross-sister (confirmed by §5 Sync Semantics — Resolution §6 line 1029: "No award-flow changes needed").

   **A3.2 Clone RPC body changes (`clone_proposal_to_gcs`).**

   - **Shape change.** The §4 INSERT-SELECT at lines 498–518 (which copies all parent `proposal_wtc` rows into the new sister using a single set-based SELECT) becomes incompatible with the lineage requirement, because it does not capture the source row's `id` per output row. **[LOCKED]** Replacement shape: replace the single INSERT-SELECT with a **row-by-row loop** over `SELECT id, work_type_id, sales_sow, … FROM proposal_wtc WHERE proposal_id = p_source_proposal_id`, where each loop iteration does an INSERT that includes `cloned_from_wtc_id = <source_row.id>` in the column list. Alternative considered and rejected: INSERT-SELECT with the source `id` carried through via `SELECT id AS cloned_from_wtc_id, …` — rejected only on readability grounds; the row-by-row loop matches the existing `FOR v_target IN jsonb_array_elements(p_targets)` style at §4 line 476 and is easier to audit. Decision is non-load-bearing; build can pick either; **[DESIGN-OPEN]** which one Chris prefers — flagging for ratification with §10 step 6 build.
   - **New column in INSERT column list.** Add `cloned_from_wtc_id` between `locally_edited_fields` and the value list. The new VALUES tuple sets `cloned_from_wtc_id := <source_row.id>` (uuid passthrough; no cast).
   - **Empty `locally_edited_fields` invariant preserved.** Sister WTC rows still ship with `locally_edited_fields = '{}'::text[]` (Round-2 locked + Migration 1a default). The lineage column is independent of the override-tracking array.
   - **C2 invariants preserved.** `locked = false`, `locked_line_total = NULL` per the C2 fix at §4 line 515. The lineage column doesn't interact with locking.
   - **Audit-row impact.** `proposal_clones` row (§4 line 525–532) is per-sister-proposal, not per-WTC. **No change.** If a future audit demands per-WTC clone events, it's a new table, not a column on `proposal_clones`. [Out of scope.]
   - **Idempotency of clone.** Clone is not idempotent today (a second invocation creates a second set of sisters with new uuid PKs and new `cloned_from_wtc_id` values pointing at the same source rows). Acceptable: clone is invoked once per multi-GC wizard run; the wizard's "Send to N GCs" button has its own client-side double-invoke guard (§7 wizard scaffold, step 8). The lineage column doesn't change this posture.
   - **What happens if the source row is a sister itself (clone-of-clone) at call time.** Per §5 Amendment 1 §B, v1 defers multi-generation chains. Step-6 build option: either (a) reject the call with `RAISE EXCEPTION 'NESTED_CLONE_NOT_SUPPORTED'` when `v_source.cloned_from_proposal_id IS NOT NULL`, or (b) silently allow and produce a grandchild with `cloned_from_wtc_id` pointing at the sister WTC (semantically valid, but sync RPC won't walk to the grandchild from the original parent). **[DESIGN-OPEN]** Recommend (a) — explicit rejection now, lift the gate when multi-generation lands. **Needs ratification before step 6b build.**

   **A3.3 Sync RPC join-key change (`preview_sync_to_sisters` + `apply_source_edit_to_sisters`).**

   The Round-2 RPC bodies (lines 632–996) read source WTCs in an outer loop and inner-look-up the sister's matching WTC by `work_type_id`. F16 inverts that to lineage. Two read shapes are possible; both produce the same output, both require the same edits, the choice is stylistic:

   - **Outer source / inner lineage lookup** (closest to Round-2 shape). Outer loop is unchanged: `FOR v_wtc_source IN SELECT * FROM proposal_wtc WHERE proposal_id = p_source_proposal_id`. Inner lookup changes from `WHERE proposal_id = v_sister.id AND work_type_id = v_wtc_source.work_type_id` to `WHERE proposal_id = v_sister.id AND cloned_from_wtc_id = v_wtc_source.id`. Every subsequent `UPDATE` predicate in the apply RPC (lines 933, 936, 939, 942, 945, 948, 951, 954, 962–963, 976–979) changes the same way. **[LOCKED]**
   - **Outer lineage walk** (alternate). Walk siblings via `FOR v_child IN SELECT * FROM proposal_wtc c JOIN proposal_wtc p ON c.cloned_from_wtc_id = p.id WHERE p.proposal_id = p_source_proposal_id AND c.proposal_id = v_sister.id`. More set-based; loses the explicit "missing on sister" surface (CONTINUE branch at line 731–733 / 912–919) which provides UX-relevant skipped-rows reporting.

   **Build recommendation:** use the outer-source/inner-lineage shape to preserve the missing-on-sister surface. The line-count delta from Round-2 is small (one predicate change per query). **[DESIGN-OPEN]** for ratify-only — Chris confirms the shape choice during step 6b drafting.

   **Read path (preview).** Unchanged at the level of "compute diff per source row × sister proposal × field, gate conflicts via locally_edited_fields[]." Only the JOIN predicate changes. Output schema (sisters[].pending[], sisters[].conflicts[], scope='wtc:<work_type_id>') is unchanged — `scope` still uses `work_type_id` because that's what surfaces in the UI conflict modal (the rep thinks in work-type names, not in lineage uuids). The conflict modal's field-label rendering doesn't need to know about `cloned_from_wtc_id`. **[LOCKED]**

   **Write path (apply).** Same JOIN predicate change. The `v_locked` lookup at line 905–910 changes its WHERE clause; the UPDATE predicates at lines 933–965 change their WHERE clauses; the flag-removal UPDATE at lines 976–979 changes its WHERE clause. **No new branches.** **[LOCKED]**

   **A3.4 Field-level sync direction & conflict rules.**

   - **Direction: parent → siblings only.** Sync never propagates sibling → parent or sibling → sibling. **[LOCKED]** Already locked by Round-2; F16 doesn't disturb this.
   - **Two siblings independently edit the same field.** Each sibling's WTC row gets its own `locally_edited_fields[]` array; the trigger at §10 step 7 fires per-row. There is no sibling-to-sibling comparison anywhere in the sync path. Each sibling's conflict state is purely its own field-override array versus the parent's current value. **[LOCKED]** by structure; no new rule needed.
   - **Parent edits a field that's locally-dirty on sibling A but clean on sibling B.** Preview returns sibling A in `conflicts[]` and sibling B in `pending[]`. Apply (without force) writes B quietly and skips A with `reason='locked'`. Apply (with force on A) writes both and removes the flag from A's array. **[LOCKED]** — Round-2 §5 Sync Semantics §4 already encodes this exactly; lineage join doesn't change the per-sibling gating.
   - **Parent has no siblings at all.** The outer `FOR v_sister IN SELECT … WHERE cloned_from_proposal_id = p_source_proposal_id …` loop is empty. Both RPCs return `{ sisters: [] }` and `{ synced: [], skipped: [] }` respectively. Client should suppress the conflict modal when preview returns empty `sisters[]` per Round-2 §5 line 1005. **[LOCKED]**
   - **Parent has siblings but no WTC rows have any matching child (all SET NULL or all manually deleted).** Outer loop returns sibling rows; inner WTC walk yields zero matches; sibling appears in output with empty `pending[]` and empty `conflicts[]`. Client should suppress the modal in this case too (treat empty-pending-and-conflicts-across-all-sisters as "nothing to do"). **[DERIVED]** Already implicit in Round-2 §5 line 1005 ("if all sister responses have empty `conflicts[]`, skip the modal and silently call apply"); add a parallel check for empty `pending[]` AND empty `conflicts[]` to skip apply entirely. **[DESIGN-OPEN]** for the implicit-suppress logic — needs a 1-line addition to Round-2's client-side flow doc, flagging for ratification.

   **A3.5 Idempotency & re-entrancy.**

   - **Preview is idempotent.** It only reads. Two consecutive calls with the same `p_source_proposal_id` against an unchanged database return identical output. **[LOCKED]**
   - **Apply is idempotent on no-op fields.** If a field is already in sync (parent value == sister value), the UPDATE writes the same value and `locally_edited_fields[]` is untouched. Second call is a no-op. **[LOCKED]**
   - **Apply is non-idempotent on force-overwrite of a locked field.** First call: writes parent value, removes the flag. Second call with the same `p_force_overwrite[]` argument: writes parent value (no-op write), but `array_remove(locally_edited_fields, v_field)` is also a no-op (flag is gone). End state is the same; second call costs an unnecessary UPDATE per sister WTC but causes no semantic drift. **[DERIVED]** Acceptable; no client-side retry guard needed.
   - **Re-entrancy under concurrent parent saves.** Both RPCs take row-level `FOR UPDATE` on the source proposal (Round-2 line 855) and on every sister proposal (Round-2 line 866). Two concurrent calls to apply serialize at the source row; the second call sees post-first-call WTC state and produces a smaller diff. No deadlock risk because lock order is deterministic (source first, then sisters in PK order via the same `SELECT … FOR UPDATE` set). **[LOCKED]** — Round-2 already locked this.
   - **Re-entrancy: sister edited between preview and apply.** Preview returned sister X with conflict on `materials`. Rep clicks "Sync, overwrite materials on X." Between the preview call and the apply call, a different user edits X's materials (legitimate concurrent edit) — the trigger appends `'materials'` to X's `locally_edited_fields[]` (if not already there; it was already there per preview result) and updates `updated_at`. Apply (with `p_force_overwrite` containing `<X>:materials`) proceeds and overwrites X's now-newer materials with parent's value, removing the flag. **The concurrent edit is silently lost.** This is acceptable for v1 — same posture as any "preview then commit" UX. Document in §7 UX copy: "If another user edits this sister while you're choosing, your overwrite will replace their edit." **[DESIGN-OPEN]** for the UX copy ask; recommend defer to a future round (out of step 6 scope).

   **A3.6 Out of scope for this amendment (noticed-but-not-touched per stay-scoped rule).**

   - `award_proposal` / `reverse_award` bodies — unaffected by F16, ship in step 6b unchanged from §6's locked plan.
   - `proposal_sync_events` audit table — deferred per §5 Leftover Cleanup (b); F16 doesn't change that posture.
   - Multi-generation chain support — deferred per §5 Amendment 1 §B.
   - Sister-added WTC rows (rows with `cloned_from_wtc_id IS NULL` on a sister proposal) visibility to sync — they are invisible to source-walked sync by structure; no surface needed in v1.
   - Edit on `WTCCalculator.jsx` to call apply with new arg shape — already documented in §5 Sync Semantics — Resolution §6 line 1033; lineage column doesn't change the client-side arg shape (still `p_source_proposal_id text, p_changed_fields text[], p_force_overwrite text[]`).
7. **DB trigger** for `locally_edited_fields` auto-population on proposal_wtc UPDATE.
8. **Wizard component** — scaffold under feat/multi-gc-allocation. 4 screens. Local state only at first, then wire to RPCs.
9. **UI surfaces** — sister sidebar in ProposalDetail, GCs panel in CallLogDetail, source-edit conflict modal, entry buttons. **Multi-GC count chip on CallLog.jsx must use a single PostgREST aggregate query (or a denormalized `active_proposal_count` field on call_log), NOT an N+1 fetch per row** — CallLog paginates at 1000 and N+1 would compound. Per Round 5 Ratification #11. Sister differentiator on Proposals.jsx: `↳` indent + `SISTER` chip; consider grouping by `call_log_id` if list ordering scatters sisters from source (per Ratification #12).
10. **Preview deploy.** I1–I6 smoke.
11. **Merge to main → prod smoke S1.** Add BACKLOG row pointing at this doc. Update CLAUDE.md verified-columns block with the new columns.

---

## §11 Verifications

**[DERIVED]**

To run before migration drafting (read-only, against prod):

```sql
-- V1: confirm proposals.status is text, no ENUM constraint
SELECT data_type, udt_name
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='proposals' AND column_name='status';
-- expect: text / text

-- V2: confirm call_log.stage is text
SELECT data_type, udt_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='call_log' AND column_name='stage';
-- expect: text / text

-- V3: confirm proposals.id is text (C4)
SELECT data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='proposals' AND column_name='id';
-- expect: text

-- V4: enumerate all FKs into proposals to catch any cloned_from constraints needed
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE contype='f' AND confrelid = 'public.proposals'::regclass;

-- V5: inventory call sites that filter proposals via call_log.customer_id
-- (run grep, not SQL, but record results in the plan doc)
```

**[LOCKED but updates needed]** From v98:
- `get_public_proposal_view` (now in 20260510120000:344) needs the one-line update: change `WHERE c.id = cl.customer_id` to `WHERE c.id = COALESCE(p.customer_id, cl.customer_id)` after Sweep-1 ships.
- Plan agent's prior delivery verified 6 things as correct (call_log.job_name as project title, content surface column list, is_admin_or_manager + get_user_tenant_id helpers, no source coupling on send-proposal/PDF, audit table pattern, forward-only retro-link decision). Pre-H-C2: `send-proposal` is "no source coupling" only because it trusts the body — the H-C2 fix moves that to DB-load. Re-check this verification after H-C2.

---

## §11 Verification Run — 2026-05-12

**[DERIVED]** Run against prod project `pbgvgjjuhnpsumnowuym` via `supabase db query --linked` (V1–V4) plus `grep src/ supabase/` (V5). All §10 step 1 evidence.

### V1 — proposals.status type
`data_type=text, udt_name=text`. **No ENUM constraint** — `clone_proposal_to_gcs` can write `'Awaiting Award'` and `award_proposal` can write `'Lost (Sister Awarded)'` as plain text. No `ALTER TYPE` needed in Migration 1.

### V2 — call_log.stage type
`data_type=text, udt_name=text`. Stage transitions in §6 (award flow) can write text values directly. No `ALTER TYPE` needed.

### V3 — proposals.id type
`data_type=text`. Confirms C4: `cloned_from` column on proposals must be `text` (not `uuid`) to FK-reference `proposals(id)`. Existing FKs (V4) all use `text` proposal_id columns — pattern is consistent.

### V4 — FKs into proposals.id (6 total, all CASCADE except invoices)
| Constraint | Source column → Target | On Delete |
|---|---|---|
| `billing_schedule_proposal_id_fkey` | `billing_schedule.proposal_id` → `proposals(id)` | CASCADE |
| `customer_pay_app_templates_proposal_id_fkey` | `customer_pay_app_templates.proposal_id` → `proposals(id)` | CASCADE |
| `invoices_proposal_id_fkey` | `invoices.proposal_id` → `proposals(id)` | **(no CASCADE — explicit)** |
| `proposal_recipients_proposal_id_fkey` | `proposal_recipients.proposal_id` → `proposals(id)` | CASCADE |
| `proposal_signatures_proposal_id_fkey` | `proposal_signatures.proposal_id` → `proposals(id)` | CASCADE |
| `proposal_wtc_proposal_id_fkey` | `proposal_wtc.proposal_id` → `proposals(id)` | CASCADE |

No existing `cloned_from`-shaped self-FK; Migration 1's `proposals.cloned_from text REFERENCES proposals(id) ON DELETE SET NULL` (§3) does not collide. Note: §6 `award_proposal` deletes the loser sisters' `proposal_wtc` / `proposal_recipients` / `proposal_signatures` rows automatically via CASCADE — useful for the "Lost (Sister Awarded)" cleanup. **`invoices` deliberately does not cascade** — confirmed intentional (a deleted proposal must not nuke historical invoices). Sister archival must not delete sisters that have invoices; §6 status-only "Lost (Sister Awarded)" already respects this (no DELETE on sister rows, just status update).

### V5 — Inventory of `call_log.customer_id` derivation sites

V5 expands the plan's "Customers.jsx + 4 other files" claim. Two classes:

**Class A — derive single customer from a proposal (needs `COALESCE(proposals.customer_id, call_log.customer_id)` after Sweep-1):**
| Site | Pattern | In plan? |
|---|---|---|
| `src/components/ProposalDetail.jsx:62` | `pInit.call_log?.customer_id` | yes |
| `src/components/ProposalDetail.jsx:282` | `p.call_log?.customer_id` | yes |
| `src/components/ProposalPDFModal.jsx:31` | `proposal.call_log?.customer_id` | yes |
| `supabase/functions/send-pay-app/index.ts:182` | `(invoiceRow as any).proposals?.call_log?.customer_id` | **NEW — add to step 3** |
| `supabase/functions/send-invoice/index.ts:73` | `invoice.proposals?.call_log?.customer_id` | **NEW — add to step 3** |
| `get_public_proposal_view` (mig `20260510120000`:344) | `WHERE c.id = cl.customer_id` | yes (already called out above) |

**Class B — filter proposals BY a known customer (needs OR-fallback, different shape):**
| Site | Pattern | Treatment |
|---|---|---|
| `src/pages/Customers.jsx:258` | `.eq("call_log.customer_id", customerId)` (templates section) | After Sweep-1, must also match `proposals.customer_id` directly — risk: customer detail view misses sister proposals where parent's call_log carries a different customer. PostgREST `.or()` or refactor to a view. |
| `src/pages/Customers.jsx:519` | same shape (customer detail proposals list) | Same. |

**Class C — non-derivation contexts, no change needed:**
- `supabase/migrations/20260502130000_drop_antipattern_anon_policies.sql:65,72` — RLS join predicates, not single-row derivation.
- `supabase/functions/qb-create-job/index.ts:146` — code comment only.

**Step 3 scope expansion:** Sweep-1 must now cover 5 derivation sites (3 client + 2 edge fn) plus the RPC update, AND a separate Class-B treatment for the two Customers.jsx filter sites. The plan's §10 step 3 sentence currently lists "three known sites" — leave the original wording in place (per [Schema Amendment Not Overwrite]); this run-results section is the authoritative inventory going into the migration draft.

### V8 — Pre-flight for UNIQUE `(proposal_id, work_type_id)` on `proposal_wtc`

`SELECT proposal_id, work_type_id, count(*) FROM public.proposal_wtc GROUP BY 1,2 HAVING count(*) > 1` returned **17 dup pairs across 14 proposals (48 rows total)**.

**Pattern — archive-import-driven, not user-entered:**
- Jobs `10033` / `10034` / `10070` (all titled "Hyundai Reno Demo Concrete Seal") — each has 4× `Demo` + 4× `Specialty` rows.
- `029fa0a5` (Gaco/Hyatt) — 3× "Waterproofing - On Concrete".
- `5b3ea87f` (Durastone) — 3× "100% Solids Epoxy".
- Most affected proposals have `status='Sent'`.

**Action — two-stage split per plan §5(c) line 1229:**
- Migration 1a (this commit) ships ALL §3 schema additions + `proposal_clones` audit table + `proposals_track_local_edits` intro trigger. **No UNIQUE.**
- BACKLOG B17 filed — importer root-cause investigation.
- BACKLOG B18 filed — manual dup triage (blocked by B17).
- BACKLOG O5 filed — Migration 1b applying the UNIQUE constraint (blocked by B17 + B18).
- WTCCalculator UX guard shipped in same PR as Migration 1a to stop new dupes accruing during the wait.
- §10 step 6 (RPCs) amendment line added — blocked by O5.

### What this run did NOT verify
- §3 amendment columns (`source_proposal_id`, `locally_edited_fields`, `award_state`, etc.) — no `IF NOT EXISTS` collision check yet; Migration 1 will use `ADD COLUMN IF NOT EXISTS`.
- `proposal_clones` table name collision — `SELECT 1 FROM information_schema.tables WHERE table_name='proposal_clones'` not yet run; Migration 1a uses `CREATE TABLE IF NOT EXISTS`.
- pg_stat_statements traffic on the existing `mark_proposal_signed(text)` 1-arg form (O3 gate, separate timeline 2026-05-13).

---

## §12 Out of scope

**[LOCKED]**

- Multi-tenant cross-tenant sister proposals (F7-blocked).
- Sister-level change orders.
- Retro-linking pre-existing manually-duplicated proposals (Q5).
- GC-side dashboards / customer portals.
- Bid-due reminders for sisters (covered by F11 backlog).
- Per-WTC granular jsonb diff/merge — coarse `locally_edited_fields` only (§5 [DESIGN-OPEN] resolution).
- Bulk-edit "set markup_override_pct on all sisters at once" — handled by editing each individually for v1.
- QB job-per-sister. Only the winner syncs to QB. Lost sisters never touch QB.

---

## Critical-issue resolution proposals

### C1 — `mark_proposal_signed` auto-Sold collision with sisters

**Resolution: reroute, don't accept "first-signer = winner".** First-signer-wins is too coarse: real-world reps need explicit Mark Awarded to pick which GC's signed copy becomes the live contract.

**Specific change to `mark_proposal_signed` (5-arg, migration 20260510120000:439-533):**
Replace lines 525-527:
```sql
IF v_call_log_id IS NOT NULL THEN
  UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;
END IF;
```
with:
```sql
IF v_call_log_id IS NOT NULL THEN
  -- Sister-aware: only flip call_log.stage when this is the only
  -- active non-Lost proposal under the call_log.
  IF EXISTS (
    SELECT 1 FROM public.proposals other
     WHERE other.call_log_id = v_call_log_id
       AND other.id <> v_proposal_id
       AND other.deleted_at IS NULL
       AND other.status NOT IN ('Lost')
  ) THEN
    -- Sisters exist; defer call_log.stage flip to award_proposal()
    NULL;
  ELSE
    UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;
  END IF;
END IF;
```
Wrapper (1-arg) inherits this automatically.

**Specific change to `src/components/ProposalDetail.jsx:598-617` (handleInternalApprove):**
- Detect sister presence via `p.cloned_from_proposal_id` OR a new query `SELECT count(*) FROM proposals WHERE call_log_id = ? AND id != ? AND status NOT IN ('Lost')`.
- If sisters exist: skip the `call_log.stage='Sold'` update AND skip the `qb-create-job` invoke. Both are handled by `award_proposal` later.
- If no sisters: existing behavior unchanged.

**Tradeoff:** Adds one EXISTS check inside a SECURITY DEFINER function and one client-side query. Negligible perf hit. Behavior becomes intuitive: signing a sister still works (signature persists, status flips to Sold on that one proposal), but the project-level (call_log) status doesn't change until Mark Awarded.

**Side note:** The "Sold" status on a sister before award is itself confusing — a customer signed, but we say "Lost" later if another wins. Two cleaner options:
- (a) Keep status='Sold' on signed sister; reverse to 'Lost' in `award_proposal` when sister is non-winner. **Cost:** brief weird state.
- (b) Introduce a new status 'Signed' that's distinct from 'Sold'; only winner flips to 'Sold'. **Cost:** new status value, UI changes.

Recommend (a) — minimal surface change, mental model "Sold means this customer signed; award means we picked this one." **[DESIGN-OPEN]** — Chris's call.

> **→ Superseded 2026-05-11. Round-2 Plan agent resolved this to Option (b) — introduce `'Signed'` status. See "C1 Resolution — Status Model" below for full SQL, ProposalDetail.jsx + PublicSigningPage.jsx changes, customer-facing UX text, and the backward-compat audit. Reasoning: QB sync correctness + cleaner customer-visible semantics outweigh the new-status-value cost. Single-GC backward compat preserved via fast-path branching inside `mark_proposal_signed`.**

---

## C1 Resolution — Status Model

_Resolved 2026-05-11 (Round-2 Plan agent). Supersedes the (a)-recommendation in the C1 stub above. C3 verification folded in._

### 1. Pre-question answers (with evidence)

**1a. Is `proposals.status` an enum or text? Same for `call_log.stage`?**

**Text, both.** Evidence:

- `grep -rn "CREATE TYPE\|TYPE.*AS ENUM" supabase/migrations/ sql/` returns zero rows.
- `grep -rn "CHECK" supabase/migrations/ | grep -iE "status|stage"` returns zero — no CHECK constraints.
- `proposals.status` referenced as plain text in `supabase/migrations/20260510120000_signing_token_expiry_and_consume.sql:498` (`SET status = 'Sold'`) — would fail at apply-time if it were an enum without a `'Sold'` member.
- `call_log.stage` referenced as plain text at line 526 of the same migration (`SET stage = 'Sold'`).
- Client surfaces use the values as free-form strings: `src/lib/mockData.js:1` `STAGES = ["New Inquiry","Wants Bid","Has Bid","Sold","Lost"]`; `src/pages/Proposals.jsx:67` `STATUS_TABS = ["All","Draft","Sent","Sold","Lost"]`; `src/lib/mockData.js:19-28` PROP_C also contains `"New"`, `"In Progress"`, `"Viewed"`, `"Approved Internally"` keys. The UI already paints a wider vocabulary than the canonical CallLog list.

**This resolves C3.** No `ALTER TYPE` is required. Adding `'Signed'` (or any other status value) is a no-op at the schema level — it's just a string the application starts writing. The verification queries in §11 (V1/V2) remain valid as a pre-migration sanity check.

**1b. What does `qb-create-job` create, and is it idempotent?**

Creates **(parent customer, sub-customer job)** in QuickBooks. Evidence in `supabase/functions/qb-create-job/index.ts`:

- Parent: 161-188 — queries QB for `Customer WHERE DisplayName = parentName` (line 79-83 `findCustomer`), creates only if not found.
- Sub-customer (job): 220-263 — same find-then-create, keyed on a derived `subName` ("`{display_job_number} {coPrefix}- {jobName}`" at 213-218).
- After sub-customer is found/created, persists its QB ID onto `call_log.qb_customer_id` (268-272).

**Idempotency: yes, by find-then-create on QB DisplayName.** Re-invoking with the same `callLogId` does not duplicate — the second call hits the `findCustomer` early-return path (199, 265). The downside: it idempotently re-asserts the **shared** sub-customer for the call_log. Under Q1 (one shared `call_log` per project), every sister that signs will idempotently create *the same single QB job* under the shared call_log. There is no per-sister QB job to undo.

**There is no `qb-delete-job` function** — `ls supabase/functions/ | grep -i delete` returns nothing. Option II's "undo path" would either require building one (plus the policy question of whether QB itself permits deletion of customers with linked transactions) or accepting a "ghost sub-customer in QB" left behind on every wrong-sister early sign. Both are costly.

**1c. What does `mark_proposal_signed` currently set `proposals.status` to?**

`'Sold'`. Verified at `supabase/migrations/20260510120000_signing_token_expiry_and_consume.sql:497-499`: `UPDATE public.proposals SET status = 'Sold', approved_at = now(), signing_token_consumed_at = now()`. And `call_log.stage='Sold'` at 526. The plan doc's claim is correct.

### 2. Recommendation: **Option I — introduce `'Signed'` status.**

Rationale weighing the four axes:

- **Customer-visible semantics.** Option II's "Sold-then-Lost" sequence is genuinely confusing — the rep watches a sister flip green, then red. Option I keeps the status surface honest: a signed sister is `'Signed'` (we have a signed contract); a winning sister is `'Sold'`; a non-winning sister is `'Lost'`. The vocabulary already biases toward this — `PROP_C` in `src/lib/mockData.js:19-28` carries `"Approved Internally"` as a distinct value, so adding `'Signed'` continues an existing pattern.

- **QB sync correctness.** Under Q1, sisters share one `call_log`. The QB sub-customer is keyed on `call_log.display_job_number + job_name`, which is the same across sisters. Option II fires `qb-create-job` on the first signer; on subsequent Mark Awarded for a *different* sister, there's nothing to undo at the QB level because the right job is already there. So Option II doesn't actually require `qb-delete-job` — but it does the right thing for the wrong reason, and the brittleness shows up the day anyone adds per-sister QB data (GC-specific addresses, GC-specific PO numbers). Option I keeps the rule clean: QB sync fires exactly once, on the `'Sold'` transition that `award_proposal` performs.

- **Implementation complexity.** Both options touch the same three surfaces. Option I adds one more thing — UI vocabulary for `'Signed'` (one pill color, one filter tab, several constant updates). Option III ("single-GC → Option II, multi-GC → Option I") is the worst of both: it adds branch logic in the RPC, and the "is this proposal a sister" check is racy.

- **Single-GC backward compatibility.** Mitigated by the RPC fast-path: when no sisters exist, `mark_proposal_signed` falls through to `status='Sold' + stage='Sold'` exactly as today. Net effect on single-GC: zero. Net effect on multi-GC: correct semantics.

### 3. Concrete changes

#### 3a. Schema migration delta (resolves C3)

**None required at the type/constraint level** (text column, no CHECK). New status value introduced purely by application writes. Optional belt-and-suspenders CHECK left commented in the migration:

```sql
-- C3 verification (run once, expect text/text):
-- SELECT data_type FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='proposals' AND column_name='status';
-- SELECT data_type FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='call_log'  AND column_name='stage';

-- Optional belt-and-suspenders: encode canonical status vocabulary as
-- a CHECK constraint. Skipping for v1 to avoid breaking latent stale
-- rows from pre-launch test data; revisit after prod inventory.
-- ALTER TABLE public.proposals ADD CONSTRAINT proposals_status_check
--   CHECK (status IN (
--     'Draft','New','In Progress','Sent','Viewed',
--     'Approved Internally','Signed','Sold','Lost','Parked'
--   ));
```

`'Parked'` observed in `ProposalDetail.jsx:541`; `'Approved Internally'` in `Managers.jsx:17-18` and `SalesDash.jsx:436`. Flagging as **[DESIGN-OPEN]** whether to ship the CHECK at all. Recommend leaving commented for v1.

#### 3b. Updated `mark_proposal_signed` body

Mirrors conventions of `supabase/migrations/20260510120000_signing_token_expiry_and_consume.sql:439-533`. Single-GC fast path: when no sisters exist, behavior is byte-for-byte unchanged. When sisters exist, the RPC stops at `'Signed'` and leaves the award + QB sync to the explicit Mark Awarded surface.

Replace lines 439-531 of 20260510120000:

```sql
CREATE OR REPLACE FUNCTION public.mark_proposal_signed(
  p_token        text,
  p_signer_name  text,
  p_signer_email text,
  p_ip_address   text,
  p_pdf_url      text
)
RETURNS TABLE (proposal_id text, call_log_id integer, became_sold boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal_id  text;
  v_call_log_id  integer;
  v_rows         integer;
  v_pdf          text := NULLIF(btrim(p_pdf_url), '');
  v_signer_name  text := NULLIF(btrim(p_signer_name), '');
  v_has_sisters  boolean;
BEGIN
  -- Argument hygiene (unchanged from 20260510120000:457-467)
  IF p_token IS NULL OR p_token = '' THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
  IF v_signer_name IS NOT NULL AND length(v_signer_name) < 3 THEN
    RAISE EXCEPTION 'INVALID_SIGNER_NAME';
  END IF;

  -- Lock + lookup (unchanged from 20260510120000:469-481)
  SELECT p.id, p.call_log_id
    INTO v_proposal_id, v_call_log_id
    FROM public.proposals p
   WHERE p.signing_token IS NOT NULL
     AND p.signing_token::text = p_token
     AND p.signing_token_expires_at IS NOT NULL
     AND p.signing_token_expires_at > now()
   LIMIT 1
   FOR UPDATE;

  IF v_proposal_id IS NULL THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;

  -- PDF URL validation (unchanged from 20260510120000:487-492)
  IF v_pdf IS NOT NULL THEN
    IF v_pdf !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/signed-proposals/signed-proposal-' ||
                 v_proposal_id || '-[0-9]+\.pdf$') THEN
      RAISE EXCEPTION 'INVALID_PDF_URL';
    END IF;
  END IF;

  -- C1: sister-aware terminal status.
  SELECT EXISTS (
    SELECT 1
      FROM public.proposals s
     WHERE s.call_log_id = v_call_log_id
       AND s.id <> v_proposal_id
       AND s.deleted_at IS NULL
       AND s.status NOT IN ('Lost')
  ) INTO v_has_sisters;

  IF v_has_sisters THEN
    -- Multi-GC path: this is a signed sister, not the winner.
    UPDATE public.proposals
       SET status                    = 'Signed',
           approved_at               = now(),
           signing_token_consumed_at = now()
     WHERE id = v_proposal_id
       AND signing_token_consumed_at IS NULL;
  ELSE
    -- Single-GC path: preserve current behavior exactly.
    UPDATE public.proposals
       SET status                    = 'Sold',
           approved_at               = now(),
           signing_token_consumed_at = now()
     WHERE id = v_proposal_id
       AND signing_token_consumed_at IS NULL;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'ALREADY_SIGNED'; END IF;

  -- Signature insert (unchanged from 20260510120000:511-523)
  IF v_signer_name IS NOT NULL THEN
    INSERT INTO public.proposal_signatures (
      proposal_id, signer_name, signer_email,
      ip_address, pdf_url, signed_at
    ) VALUES (
      v_proposal_id,
      v_signer_name,
      NULLIF(btrim(p_signer_email), ''),
      NULLIF(btrim(p_ip_address), ''),
      v_pdf,
      now()
    );
  END IF;

  -- call_log.stage transition: only on single-GC path.
  IF v_call_log_id IS NOT NULL AND NOT v_has_sisters THEN
    UPDATE public.call_log SET stage = 'Sold' WHERE id = v_call_log_id;
  END IF;

  RETURN QUERY SELECT v_proposal_id, v_call_log_id, (NOT v_has_sisters);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_proposal_signed(text, text, text, text, text) TO anon;
```

Notes:
- 1-arg wrapper inherits the new behavior automatically.
- `v_has_sisters` uses `status NOT IN ('Lost')` — `'Approved Internally'`, `'Signed'`, `'Sent'`, `'Draft'`, or any other live sibling counts as "sisters exist."
- Returns `became_sold` so the edge function and client can gate `qb-create-job`.

#### 3c. Updated `ProposalDetail.jsx:598-617` (handleInternalApprove)

```js
async function handleInternalApprove() {
  if (!approveBy.trim()) { alert("Approved By is required."); return; }
  if (!approveReason.trim()) { alert("Reason is required."); return; }

  // C1: sister-aware. Active sisters → 'Signed' (no stage flip, no QB).
  const { data: siblings } = await supabase
    .from("proposals")
    .select("id")
    .eq("call_log_id", p.call_log_id)
    .neq("id", p.id)
    .is("deleted_at", null)
    .not("status", "in", "(Lost)");
  const hasSisters = (siblings?.length || 0) > 0;

  await supabase.from("proposals").update({
    status: hasSisters ? "Signed" : "Sold",
    approved_at: new Date().toISOString(),
    internal_approval: true,
    approved_by: approveBy.trim(),
    approval_reason: approveReason.trim(),
  }).eq("id", p.id);

  if (p.call_log_id && !hasSisters) {
    await supabase.from("call_log").update({ stage: "Sold" }).eq("id", p.call_log_id);
    const isTest = (p.call_log?.job_name || "").toLowerCase().includes("test");
    !isTest && supabase.functions.invoke("qb-create-job", { body: { callLogId: p.call_log_id, proposalId: p.id } })
      .catch(() => {});
  }
  // Refresh (unchanged)
  ...
}
```

The internal-approval surface collapses "customer signed externally" and "internally approved as Signed" into the same `'Signed'` status value. Differentiator stays in `internal_approval bool + approved_by + approval_reason` (existing columns). **[DESIGN-OPEN]** — alternative is two new statuses; recommend collapsing.

#### 3d. Updated `qb-create-job` invocation conditions

Two client invocation sites:

- `ProposalDetail.jsx:611-613` (handleInternalApprove) — gated by `hasSisters` per 3c.
- `PublicSigningPage.jsx:391-397` (customer-side signing path) — must also gate. The customer's browser doesn't have direct visibility into sisters, so use the `became_sold` field surfaced from `mark_proposal_signed`'s extended RETURNS TABLE:

```ts
// supabase/functions/proposal-signed/index.ts ~line 100-104:
const proposalId  = signedRows[0].proposal_id;
const callLogId   = signedRows[0].call_log_id;
const becameSold  = signedRows[0].became_sold;
return jsonResp(200, { success: true, became_sold: becameSold }, corsHeaders);
```

```js
// src/pages/PublicSigningPage.jsx ~line 395:
if (!qbBlocked && proposal.call_log_id && !isTest && responseBody?.became_sold) {
  supabase.functions.invoke("qb-create-job", { body: { callLogId: proposal.call_log_id, proposalId: proposal.id } }).catch(() => {});
}
```

Also covers the fallback path at `PublicSigningPage.jsx:376-389` (direct RPC call when edge fn fails): surface `became_sold` from the fallback path similarly.

`src/components/QBActionModal.jsx:18` is a manual user-initiated "create QB job" — unrelated to signing flow, **no change**.

#### 3e. Mark Awarded flow (`award_proposal`) — interaction with `'Signed'`

The §6 RPC already does the right thing — sister set has `status NOT IN ('Sold','Lost')`, which naturally includes `'Signed'`. **No SQL change needed at §6.**

The client wrapper that invokes `award_proposal` is the new surface that owns QB sync:

```js
async function handleMarkAwarded(winnerProposalId) {
  const { data, error } = await supabase.rpc("award_proposal", {
    p_winner_proposal_id: winnerProposalId,
    p_lost_reason: "Lost to other GC",
  });
  if (error) { alert(error.message); return; }
  const { winner_id, call_log_id } = data;
  const winnerCallLog = /* re-fetch or pass through */;
  const isTest = (winnerCallLog?.job_name || "").toLowerCase().includes("test");
  if (call_log_id && !isTest) {
    supabase.functions.invoke("qb-create-job", { body: { callLogId: call_log_id, proposalId: winner_id } })
      .catch(() => {});
  }
}
```

Interaction edge: if a sister was `'Signed'` (with `approved_at` set) and a different sister is awarded, the signed sister flips to `'Lost'` but retains its `approved_at` and `internal_approval` flag — the signing record is history, not erased. The plan doc's §6 reversal flow needs `pre_lost_status` capture (already flagged **[DESIGN-OPEN]** at §6:777) so reversal restores `'Signed'`.

### 4. Customer-facing UX text for `'Signed'`

- **Proposal-detail Pill (`ProposalDetail.jsx:664`).** Add to `PROP_C` in `src/lib/mockData.js`: `"Signed": { bg:"rgba(67,160,71,0.10)", text:"#1e5e22" }` — same family as 'Sold' but visually distinct (lighter background; same green text).
- **Status filter tab (`Proposals.jsx:67`).** Insert `'Signed'` between `'Sent'` and `'Sold'`: `["All","Draft","Sent","Signed","Sold","Lost"]`.
- **Signing page confirmation (`PublicSigningPage.jsx`).** Accepted-state gate becomes `["Sold","Signed"].includes(view.status)`. Customer copy unchanged ("Thank you, your signature has been recorded").
- **Customer email (`supabase/functions/proposal-signed/index.ts:132`).** Change "status has been updated to **Sold**" → "**Signed**" when `became_sold=false`; keep "Sold" when `became_sold=true`. (This email goes to the internal rep, line 120 `to: repEmail` — not the customer.)
- **CallLogDetail GC panel (§7 surface).** Each sister rendered with GC name + status pill. `'Signed'` renders via PROP_C.

### 5. Backward-compat audit — every read of `proposals.status` and `call_log.stage` in `src/`

**Status filter tabs / constants:**
- `src/pages/Proposals.jsx:67` STATUS_TABS — **add `'Signed'`**.
- `src/pages/Managers.jsx:17` SENT_STATUSES — **add `'Signed'`** (signed sisters count as sent for the month).
- `src/pages/Managers.jsx:18` ACCEPTED_STATUSES — **[DESIGN-OPEN]** recommend NO (`'Signed'` is pre-award; "accepted" should mean "we won").
- `src/pages/SalesDash.jsx:13` SENT_STATUSES — **add `'Signed'`**.
- `src/pages/SalesDash.jsx:154` forecastStatuses — **add `'Signed'`**.
- `src/pages/SalesDash.jsx:436` — **add `'Signed'`**.

**Per-status branching:**
- `src/components/ProposalDetail.jsx:67` `pInit.status === "Sold"` — schedule send. `'Signed'` should NOT trigger. **No change.**
- `src/components/ProposalDetail.jsx:96` auto-refresh while `status === "Sent"` — already stops on non-Sent. **No change.**
- `src/components/ProposalDetail.jsx:429` checklist `"Proposal sent": ["Sent","Sold"]` — **update to `["Sent","Signed","Sold"]`**.
- `src/components/ProposalDetail.jsx:678` Pull Back button visibility `(p.status === "Sent" || p.status === "Sold")` — **add `'Signed'`** (must be able to pull back a signed sister).
- `src/components/ProposalDetail.jsx:694` Send Proposal button — **update to also exclude `'Signed'`**.
- `src/components/ProposalDetail.jsx:1137` Download Signed PDF block `status === "Sold"` — **update to `["Sold","Signed"].includes(p.status)`**.
- `src/pages/PublicSigningPage.jsx:69` accepted-state gate — **update to `["Sold","Signed"].includes(view.status)`**.
- `src/pages/WTCCalculator.jsx:1839` `data?.status === "Sold"` locks calculator — **update to `["Sold","Signed"].includes(data?.status)`**. Once signed, WTCs lock from edits same as Sold.
- `src/pages/Home.jsx:135` `["Sent","Viewed","Approved","Sold","Lost"]` — **add `'Signed'`**.
- `src/pages/Customers.jsx:687` color logic — **[DESIGN-OPEN]** recommend treating `'Signed'` like `'Sold'` for color.
- `src/components/ProposalPDFModal.jsx:277-278` Send button visibility — **update to exclude `'Signed'`**.

**call_log.stage:**
- STAGES vocabulary unchanged (stage stays `'Has Bid'` while sisters sign; flips to `'Sold'` only on award).
- `src/components/ProposalDetail.jsx:609` writes `stage: "Sold"` — handled in 3c by `!hasSisters` gate.
- Other stage writes (`ProposalDetail.jsx:478, :588`, `ProposalPDFModal.jsx:151`) — orthogonal.

**Sibling repos** (sch-command / field-command / AR-Command-Center per CLAUDE_RLS.md:73-83): adding `'Signed'` is non-breaking for those repos as long as they default-render unknown statuses. Worth a sibling-repo audit follow-up, not a blocker.

### 6. Edge cases

**a. Sister signs mid-other-sister-signing (race).** Two customers sign two different sisters within the same second. Each is its own RPC invocation with a different token. `v_has_sisters` query runs at row-lock time but doesn't lock siblings; both queries return true. Both proposals end up `'Signed'`. Correct.

**b. Customer revokes signature.** Current path: Pull Back at `ProposalDetail.jsx:458-475` (deletes `proposal_signatures` rows, sets `status='Draft'`, clears `approved_at`). Under Option I, Pull Back must also accept `'Signed'` status (called out in §5 audit). Same handler logic; no new revoke path needed.

**c. Mark Awarded before any sister signs.** Rep verbally awarded; clicks Mark Awarded without a customer signature. `award_proposal` flips winner to `'Sold'`, others to `'Lost'`. Winner's `approved_at` set to `now()` (per §6:751) without a `proposal_signatures` row. Identical to today's Internal Approve modulo the new branching. **No change needed.**

**d. All sisters signed.** Possible — every GC signs before rep picks. Each ends in `'Signed'`. Rep clicks Mark Awarded → winner `'Sold'`, rest `'Lost'`. **Correcting the plan's prior speculation** at §8.7: "all sisters signed before any award" is not impossible under Q1 — Option I makes this representable cleanly.

**e. Single-GC proposal signs.** `v_has_sisters` returns false; RPC falls into single-GC branch (`status='Sold' + stage='Sold'`). Client also falls into `!hasSisters` branch and fires `qb-create-job`. End-to-end byte-for-byte preservation. ✓

**f. Sister-of-sister attempt.** Already prohibited by §7 `cloned_from_proposal_id IS NULL` gate on `+ Send to Additional GCs`. C1 inherits.

**g. Reversal interplay.** `reverse_award` must capture `pre_lost_status` (already flagged **[DESIGN-OPEN]** at §6:777). A sister that was `'Signed'` before award and got flipped to `'Lost'` returns to `'Signed'` on reverse.

**h. Idempotent re-award.** §6:762 `status NOT IN ('Sold','Lost')` makes re-award no-op. Awarding a *different* sister after a previous award requires `reverse_award` first — pre-existing wizard-UX question, C1 doesn't change it.

**i. Optimistic concurrency on `internal_approval` + customer signing.** Pre-existing race bug (rep's PostgREST update lacks the `signing_token_consumed_at` guard); orthogonal to C1. Worth a BACKLOG row but out of scope.

### DESIGN-OPEN items remaining after this resolution

- Whether to add the `proposals_status_check` CHECK constraint (recommend: skip for v1; revisit after prod inventory).
- Whether to differentiate "customer-Signed" from "internally-approved-while-sisters-exist" via two statuses (recommend: collapse to single `'Signed'`).
- `Customers.jsx:687` color rule for `'Signed'` (recommend: treat as Sold-family color).
- `Managers.jsx:18` ACCEPTED_STATUSES inclusion of `'Signed'` (recommend: NO).
- `proposals.pre_lost_status` snapshot column for reversal (already flagged in §6).

### Critical files for this resolution

- `supabase/migrations/20260513000000_multi_gc_allocation.sql` — `mark_proposal_signed` redefinition + extended RETURNS TABLE.
- `supabase/migrations/20260510120000_signing_token_expiry_and_consume.sql` — superseded by above (no edit, just reference).
- `src/components/ProposalDetail.jsx` — handleInternalApprove rewrite (3c) + ~10 backward-compat tweaks per §5 audit.
- `src/pages/PublicSigningPage.jsx` — `became_sold` gate on qb-create-job invocation + accepted-state gate update.
- `supabase/functions/proposal-signed/index.ts` — surface `became_sold` in response body.
- `src/lib/mockData.js` — add `'Signed'` to PROP_C.
- `src/pages/Proposals.jsx`, `src/pages/Managers.jsx`, `src/pages/SalesDash.jsx`, `src/pages/Home.jsx`, `src/pages/WTCCalculator.jsx`, `src/pages/Customers.jsx`, `src/components/ProposalPDFModal.jsx` — `'Signed'` inclusion per §5 backward-compat audit.

---

### C2 — Clone RPC must not violate H6 locked_line_total invariant

**Resolution: already encoded in §4 RPC.** Specifically the `INSERT INTO public.proposal_wtc … VALUES (… false, NULL, '{}'::text[])` line. Sisters always start `locked=false AND locked_line_total=NULL`. Sales rep must lock + send each sister (mirrors today's flow). No further migration change needed.

**Verification in test plan T1.**

---

### C3 — proposals.status / call_log.stage enum-vs-text

**Resolution: text, not enum. Verified.** Evidence:
- `grep -rn "CREATE TYPE\|TYPE.*AS ENUM" supabase/migrations/ sql/` returns zero results for status/stage.
- Migration 20260510120000:98, :125 etc. use `WHERE p.status = 'Draft'` and `WHERE status = 'Sold'` as plain string literals — would fail at apply-time if the column were an ENUM with different values.
- React UI already uses 'Lost' freely (`src/pages/Proposals.jsx:67 STATUS_TABS`, `src/components/CallLogDetail.jsx:11 STAGES`).

**Action:** Run V1 + V2 in §11 against prod during pre-migration verification to capture evidence in commit notes. No ALTER TYPE needed.

---

### C4 — proposals.id is text, not uuid

**Resolution: type-correct everywhere in this plan.** All clone-related references:
- `proposals.cloned_from_proposal_id` → `text` (§3).
- `proposal_clones.parent_proposal_id` + `.sister_proposal_id` → `text` (§3).
- `clone_proposal_to_gcs(p_source_proposal_id text, ...)` (§4).
- Sister-id generation: `gen_random_uuid()::text` (§4 line `v_sister_id := gen_random_uuid()::text`).

**Verification:** V3 in §11 captures evidence at apply time.

---

### S1 — Customers.jsx invisible-sister regression

**Resolution: choice between (a), (b), (c). Recommendation: (b) RPC.**

Three options:

**(a) Denormalized `call_log.primary_customer_id`.**
Add a column, populate it from `proposals.customer_id` of the FIRST sister (or via trigger keeping it in sync). Customers.jsx swaps `.eq("customer_id", customer.id)` → `.or("customer_id.eq.X,primary_customer_id.eq.X")`.
- **Pro:** No new RPC; PostgREST stays fast; one extra column.
- **Con:** Denorm always rots. Which sister's customer becomes "primary"? Race conditions on clone. If primary is awarded-lost later, do we re-sync?

**(b) RPC `customer_jobs(p_customer_id uuid) RETURNS SETOF public.call_log`.**
SECURITY DEFINER function that returns the union of call_logs where:
- `call_log.customer_id = p_customer_id`, OR
- `EXISTS (SELECT 1 FROM proposals p WHERE p.call_log_id = call_log.id AND COALESCE(p.customer_id, call_log.customer_id) = p_customer_id AND p.deleted_at IS NULL)`

Customers.jsx swaps the direct `.from("call_log").eq("customer_id", X)` for `supabase.rpc("customer_jobs", { p_customer_id: X })`. Same shape change on the proposals query (becomes `customer_proposals(p_customer_id)`).
- **Pro:** Authoritative; no denorm to rot; explicit fallback semantics live in one place; F7-clean (RPC checks tenant); reusable from SalesDash + any future surface that lists "jobs for customer X".
- **Con:** Two new RPCs. Slightly slower than direct query. RLS doesn't need to change (RPC runs SECURITY DEFINER but explicitly filters on tenant via `get_user_tenant_id()` inside).

**(c) PostgREST OR filter.**
Customers.jsx changes:
```js
.from("call_log")
.select("id, …, proposals!inner(customer_id)")
.or(`customer_id.eq.${id},proposals.customer_id.eq.${id}`)
```
- **Pro:** Zero migration. Pure client change.
- **Con:** Fragile — embedded resource filters via `.or` are quirky in PostgREST and you get dupes when a call_log has multiple matching proposals; needs DISTINCT. Same problem repeats in proposals query, invoices query, and any future surface. Spreads multi-GC awareness across all client filter sites.

**Recommendation: (b).** Builds the fallback semantics into one durable place. The S1 surface is already paying for query duplication today (jobs + proposals + invoices separately filtered) — moving to one RPC per concept simplifies. Cost is one migration + 4 client-call-site changes.

**Sites to update under (b):**
- `src/pages/Customers.jsx:514` → `supabase.rpc("customer_jobs", { p_customer_id: customer.id })`
- `src/pages/Customers.jsx:516-519` → `supabase.rpc("customer_proposals", { p_customer_id: customer.id })`
- `src/pages/Customers.jsx:253-260` (PayAppTemplateModal proposal list) → `supabase.rpc("customer_proposals", ...)`
- Any future surface listing "what does this customer own" — same pattern.

---

## Section completeness summary

| Section | Mostly tag | Confidence |
|---|---|---|
| §1 problem | LOCKED | High |
| §2 decisions | LOCKED | High |
| §3 schema | DERIVED + 2 DESIGN-OPEN | High on columns; OPEN on markup arithmetic + proposal_number scheme |
| §4 clone RPC | DERIVED + BLOCKED on H-C2 | High on RPC shape; BLOCKED on send-proposal invoke timing |
| §5 sync RPCs | **mostly DESIGN-OPEN** | Low — needs Chris's input on jsonb granularity + trigger-vs-client population |
| §6 award | BLOCKED on C1 + DERIVED | High once C1 resolved; one DESIGN-OPEN on reversal snapshotting |
| §7 UI | DERIVED + 3 DESIGN-OPEN | Medium — wizard mockup HTML deleted; needs re-walk with Chris |
| §8 edge cases | DERIVED + BLOCKED on H-B2 + 2 DESIGN-OPEN | Medium |
| §9 test plan | DERIVED | High; one BLOCKED case (T5) |
| §10 order | DERIVED | High |
| §11 verifications | DERIVED | High |
| §12 out-of-scope | LOCKED | High |

**Where SendMessage rounds should focus next, in priority order:**
1. **§5 sync logic** — biggest design-open block; without it the wizard can ship but multi-GC editing won't have intended semantics.
2. **C1 resolution sub-question** — "When a sister is signed before award, should its status flip to 'Sold' immediately and then to 'Lost' on award of a different sister, OR should we introduce a 'Signed' status distinct from 'Sold'?"
3. **§3 markup arithmetic** — additive vs multiplicative for `markup_override_pct`.
4. **§7 wizard re-spec** — mockup HTML is gone; rebuild the screen-by-screen spec from product intent.

---

### Critical Files for Implementation

- `/Users/chrisberger/sales-command/supabase/migrations/20260513000000_multi_gc_allocation.sql` (new — schema + RPCs)
- `/Users/chrisberger/sales-command/supabase/migrations/20260510120000_signing_token_expiry_and_consume.sql` (modify `mark_proposal_signed` for C1)
- `/Users/chrisberger/sales-command/src/components/ProposalDetail.jsx` (C1 handleInternalApprove rewrite + customer_id fallback + sister sidebar UI)
- `/Users/chrisberger/sales-command/src/pages/Customers.jsx` (S1 fallback via new RPCs at :253-260, :514, :516-519)
- `/Users/chrisberger/sales-command/src/components/MultiGCWizard.jsx` (new — 4-screen wizard; entry from ProposalDetail + CallLogDetail)

---

## F16 Ratifications — 2026-05-13

_Ratifies the 8 [DESIGN-OPEN] items surfaced by §5 Amendment 1 — 2026-05-13 and §10 step 6 Amendment 3 — 2026-05-13. **Does not edit prior amendment text** per [Schema Amendment Not Overwrite]; the upstream [DESIGN-OPEN] flags remain as the trail of how we got here, with the resolutions below as the authoritative answer. All items flip [DESIGN-OPEN] → [LOCKED] as of this block._

| # | Item | Agent rec | Ratification | Notes |
|---|---|---|---|---|
| 1 | Multi-generation chain support | Defer to v1+ | **Reject (never, not deferred)** | Chains prohibited, not postponed. Enforced by #4. |
| 2 | Migration 1b filename timestamp | Wait on O7 | **Accept (wait on O7)** | Fallback if O7 hasn't shipped at 6a build time: run `supabase migration list --linked` immediately before timestamp assignment; pick strictly greater than any ledger row in either repo. |
| 3 | Clone RPC loop shape | Cosmetic, no strong rec | **Accept INSERT ... SELECT with id carry-through** | Single set-based statement. Per-row side effects (if ever needed) get a later amendment. |
| 4 | Clone-of-clone gate | Explicit RAISE | **Accept hard block** — `RAISE EXCEPTION 'NESTED_CLONE_NOT_SUPPORTED'` when `v_source.cloned_from_proposal_id IS NOT NULL` | Enforces #1. Surfaces to UI as a user-readable error. No silent allow. |
| 5 | Sync RPC outer-shape | Outer-source / inner-lineage | **Accept Option X** | Per-GC customization (extra/modified/deleted WTC per sibling) is first-class. "Missing on sibling" = graceful no-op, not join hole. |
| 6 | Suppress empty-result modal | Accept suppress | **Reject suppress (modal always shows)** | Safety backstop for non-savvy estimators. Silent application erodes trust. Empty-state copy must explicitly confirm success; see #7(c). |
| 7 | UX copy for preview modal | Defer concurrent-edit copy | **Accept five-part lock** — see notes | (a) User-facing term = **"GCs"**. (b) Modal names WTC + field + change, e.g. `"Drywall — Burden Rate (45 → 42)"`. (c) Empty-state copy is explicit confirmation: *"Saved. No GCs needed this update — your other proposals don't carry this WTC, or this field is locally edited everywhere."* (d) Defer concurrent-edit "silently lost" copy to v2 with a plan note. (e) **GC names rendered from `customers.name`** via JOIN on `proposals.customer_id`; sync RPC return shape adds `customer_name` per sibling. Fallback when unassigned: render proposal number. Edge: truncate names at ~30 chars; for 5+ siblings show first 3 + "and N more." |
| 8 | `start_date` / `end_date` per-GC carry-over | Per-GC (not source-driven) per plan §4:548 | **Accept field-level "never sync"** + **carry parent's value at clone time** | Dates are inherently per-GC (different jobsite timelines). Schema-level rule, not row-level via `locally_edited_fields`. AUDIT_LOG had no prior ratification — verified during this round; plan §4:548 was the latest soft call. |

**Step 6b additional spec from this ratification:**
- Sync RPC return shape includes `customer_name` per sibling (one JOIN to `customers` on `proposals.customer_id`).
- Modal copy is the source of truth from #7; build agent must not paraphrase.
- Empty-result modal pops (per #6) with confirmation copy from #7(c).
- `RAISE EXCEPTION 'NESTED_CLONE_NOT_SUPPORTED'` is a hard contract with the UI.
- `start_date` / `end_date` are excluded from sync RPC's field iteration; clone RPC copies them directly.

**Build readiness after this block:**
- Step 6a (Migration 1b — `proposal_wtc.cloned_from_wtc_id` column + index) — unblocked; can ship.
- Step 6b (RPC migration — clone + 2 sync RPCs) — unblocked once 6a applies to prod.

**Items NOT touched by this ratification (flagged for separate work):**
- §11 V9 verification (orphan-child after `ON DELETE SET NULL` on parent WTC) — prior noticed-but-not-touched.
- `idx_proposals_cloned_from` in Migration 1a partiality — prior noticed-but-not-touched.
- §4:548 [DESIGN-OPEN] flag itself: left in place per amendment discipline; #8 above is the authoritative answer.

---

### §10 Step 3 Ratifications — 2026-05-13

_Locks the three [DESIGN-OPEN] items raised by §10 Step 3 Amendment 1 — Section 3 pre-Sweep-1 audit deltas. Audit-pass conversation 2026-05-13 between Chris and Opus 4.7 audit session. Upstream amendment's DESIGN-OPEN flags intentionally left in place per [Schema Amendment Not Overwrite]; this block is the authoritative answer._

| # | Item | Amendment rec | Ratification | Notes |
|---|---|---|---|---|
| 1 | A1.1 — Resolution helper placement | `useResolvedCustomer(p)` hook vs inline `??` (defer) | **Accept hook** — `useResolvedCustomer(p)` in `src/lib/proposalCustomer.js` | One shared template over three+ component sites. Uniformity, not locality, is the goal: if Sweep-2 adds another fallback layer, one file changes. Chris: "safer ... per artifact" — read as one-template-vs-three-copies after rule-location clarified. |
| 2 | A1.2 — View name | `proposals_with_effective_customer` vs shorter (`v_proposals_customer`, etc.) | **Accept `v_proposal_customer_resolved`** | Repo view-naming convention is `v_` prefix (only existing view: `v_orphan_auth_users`). Name describes the **rule** (resolution), not the entity shape — matches what the view does, not what it returns. |
| 3 | A1.1 — Schema-cache curl probe target | Staging vs prod read-only (defer) | **Accept prod read-only** | No staging Supabase project exists for sales-command. Migration 1a was applied direct to prod. Probe is `curl …select=id,customers!proposals_customer_id_fkey(id)&limit=1` — anon key, single-row read, no writes. Same shape as every Vercel-preview page load already does. Zero risk to verify against the actual deploy target. |

**Step 3 build-readiness after this block:**
- A1.1 edge-fn patches (`send-invoice`, `send-pay-app`) — unblocked. Verify prod schema cache one-shot before patch, then apply embed + resolution rule.
- A1.1 client-component patches (`ProposalDetail`, `ProposalPDFModal`, callers in `Proposals.jsx` / `Home.jsx`) — unblocked. Author `src/lib/proposalCustomer.js` first; components consume.
- A1.2 view migration — unblocked. Single `CREATE OR REPLACE VIEW` in a new migration; no dependency on Migration 1b. Both `Customers.jsx:258` and `:519` switch to the view post-apply.
- A1.3 — instruction lives in the amendment; build session re-greps V5 sites at start.

**Items NOT touched by this ratification (flagged for separate work):**
- The `get_public_proposal_view` RPC update (step 3 original sentence, "§11 v98 finding still valid") — still required by step 3 build but not in this audit's scope. Build session reviews RPC return shape against this amendment before authoring the RPC migration.
- A build-time grep for `call_log?.customers` (outside the 4 named A1.1 sites) — recommended in A1.5 to close certainty; deferred to build session.
- §10 step 3 original sentence and §11 V5 inventory: left in place per [Schema Amendment Not Overwrite]. This block + Amendment 1 are the authoritative spec.
