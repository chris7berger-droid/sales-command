# Plan — Exact-penny pricing for post-cutoff proposals

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

---

## §0 Baseline (observed current state) [read-verified]

Verified by reading `src/lib/calc.js` in full and grepping the call graph on `feat/exact-penny-pricing` (branched from `main` @ `7581a99`). **Read-verified, not run-verified** — no app click-through or prod DB query was performed.

- **WTC prices round UP to the whole dollar.** `calc.js:53` (`calcWtcBreakdown`) and `calc.js:76` (`calcWtcPrice`) both do `Math.ceil(labor.total + mats + trav - discount)`. Observed in app: a WTC summary showing **Subtotal $37,154.09 → Proposal Price $37,155.00**.
- **The invoice inherits the rounded-up number by recomputing live.** `Invoices.jsx` calls `calcWtcPrice(w)` directly (107, 197, 448, 871, 1565, 2075). It does **not** read a frozen snapshot. This is the mechanism by which customers get billed a rounded-up figure they didn't agree to.
- **`WTCCalculator.jsx` has its own inline `Math.ceil`**, bypassing `calc.js`, at lines **1126, 1180, 1375, 1560, 2085** (the live preview "Proposal Price" the user sees while building a WTC).
- **A freeze step exists at Lock & Approve.** `ProposalDetail.jsx:311,317` writes per-WTC `locked_line_total` and `proposals.total`, computed via `calcWtcPrice`/`calcWtcTotal` (306, 316). `WTCCalculator.jsx:1987,2013,2028` does the same. Pull-back clears them (`ProposalDetail.jsx:537`) and resets `status → "Draft"`, `sent_at → null` (540).
- **The public signing page is already insulated.** `PublicSigningPage.jsx:447,547` renders the frozen `proposal.total` + `locked_line_total` snapshot via RPC, NOT live calc. Already-signed proposals are unaffected by any `calc.js` change.
- **No server-side total computation.** `grep` of `supabase/functions` for total/ceil logic returned nothing. All pricing is client-side.
- **Proposal status values:** sent states = `Sent`, `Signed`, `Sold`; unsent = `Draft`, `Parked`, `Not Ordered`.
- **~15 calc call sites across 7 files:** `ProposalDetail.jsx` (306, 316, 332, 829, 1207), `Invoices.jsx` (107, 115, 197, 448, 871, 1565, 2075), `invoicePdf.js` (259), `PublicInvoicePage.jsx` (214), `MultiGCWizard.jsx` (220, 526, 584, 585, 630), `WTCCalculator.jsx` (1987, 2013, 2023 via alias `calcWtcTotal`).
- **Current drafts:** 11 unsent drafts exist (user-reported).

---

## §1 Problem / intent [LOCKED]

Customers increasingly (≈2–3×/week, no customer-type pattern) pay the **exact** contract amount — the un-rounded line-item total — while Sales Command billed the **rounded-up** figure. The round-up is an artifact of `Math.ceil` (up to $0.99/WTC line), not a contractual amount. We want new work to bill to the exact penny while leaving everything already committed untouched.

**Confirmed root fact [LOCKED]:** the exact amount customers pay equals our *pre-ceil* line total (`labor.total + mats + trav - discount`). So removing the round-up from the billed path makes our number match theirs with no other change.

---

## §2 The rule [LOCKED]

A proposal prices to the **exact penny** iff `proposals.created_at >= 2026-06-26T12:00:00-05:00` (noon Central). Otherwise it rounds up (`Math.ceil`), exactly as today.

- **[LOCKED] Trigger is `created_at`, an immutable field** — NOT `status`/`sent_at`. Mutable triggers break consistency: the app freezes price at Lock (status `Draft`) but recomputes the invoice live later (status `Sent`), so a status-based rule would freeze exact and bill ceil — re-creating the exact bug. `created_at` never changes, so preview, freeze, invoice, PDF, and snapshot always agree.
- **[LOCKED] Round-to-cent = `Math.round(raw * 100) / 100`** (matches existing invoice rounding; kills float dust).
- **[LOCKED] Safe default = ceil.** Calc functions default to `Math.ceil` when the proposal/`created_at` is missing or unparseable, so any unwired call site keeps today's behavior — no path silently produces a wrong number.
- **[LOCKED] Forward-only.** This does NOT retroactively fix pre-cutoff proposals (incl. the one that prompted this work). Those are handled manually (override the invoice amount) or by recreating as a new proposal.
- **[LOCKED] Old unsent drafts (the 11) stay ceil.** To make one exact, recreate it. Accepted given only 11 exist.
- **[LOCKED] No DB changes, no migrations, no edge functions.**

Behavior table:

| Proposal | Rounds |
|---|---|
| Created before noon Central 2026-06-26 (sent or draft) | **Up** (unchanged) |
| Created at/after cutoff | **Exact** (always, even after sending) |

Pull-back/resend keeps the original process automatically — `created_at` is never reset by pull-back.

---

## §3 Proposed change

### 3.1 Core — `src/lib/calc.js` [LOCKED]
- Add constant `EXACT_PRICING_CUTOFF = Date.parse("2026-06-26T12:00:00-05:00")`.
- Add `export function usesExactPricing(proposal)`:
  - Read `proposal?.created_at` with **optional chaining**. [B2]
  - Return `true` only if `created_at` parses and `>= cutoff`; `false` otherwise (missing/unparseable → legacy ceil).
  - **Shape guard [B3, big-call Option 2]:** if handed a **WTC-shaped** object (has `proposal_id`), ignore it and return `false` — never read a WTC's own `created_at`. If handed a **proposal-shaped** object (has `status`/`total`) that lacks `created_at`, emit a **dev-mode `console.warn`** so a missing SELECT fails loudly in dev instead of silently rounding up in prod.
- Add `roundPrice(raw, exact)` → `exact ? Math.round(raw * 100) / 100 : Math.ceil(raw)`.
- **Append `exact` LAST positionally [B1]** — never insert before existing args:
  - `calcWtcPrice(wtc, markupOverride, exact = false)`
  - `calcProposalTotal(wtcs, markupOverride, exact = false)`
  - `calcWtcBreakdown(wtc, exact = false)`
  - Route each function's final math through `roundPrice`.

### 3.2 Wire call sites [LOCKED intent, DERIVED scope]
At each of the ~15 sites (§0), compute `usesExactPricing(proposal)` from the already-loaded **proposal object — never the WTC `w`** — and pass it as the trailing `exact` arg. [A1, A2]

**`created_at` is not currently SELECTed — it must be added** to these explicit selects/embeds, or the rule silently no-ops to ceil: [A1, A2, A3, B2, C3]
- `Invoices.jsx:67` — new-invoice proposal fetch
- `Invoices.jsx` InvoiceDetail `proposals(...)` embeds at `:607, :1281, :1470, :2316, :2434, :2465`
- `PublicInvoicePage.jsx:40` — anon embed
- `WTCCalculator.jsx:2045` — parent proposal load

Files: `ProposalDetail.jsx`, `Invoices.jsx`, `invoicePdf.js`, `PublicInvoicePage.jsx`, `MultiGCWizard.jsx`, `WTCCalculator.jsx` (alias path).

### 3.3 `WTCCalculator.jsx` inline ceils [LOCKED]
Replace the 5 inline `Math.ceil` (1126, 1180, 1375, 1560, 2085) with the same rule so the live preview matches what gets locked and billed.

### 3.4 Freeze path — no extra work [DERIVED]
Lock & Approve already computes via `calcWtcPrice`/`calcWtcTotal`, so wiring §3.2 makes new proposals freeze the exact snapshot automatically.

### 3.5 Signing page — no change [DERIVED]
Reads the frozen snapshot only. New proposals show exact via §3.4; old signed proposals are untouched.

### 3.6 Invoice PDF — pass proposal + render exact cents [LOCKED]
- `generateInvoicePdf` gains a new **`proposal` param** so it can compute `usesExactPricing` and pass `exact` into `calcWtcPrice` (`invoicePdf.js:259`). Update the caller at `PayAppDetailModal.jsx:343` to pass the proposal. [D1]
- **The PDF must render cents** via a cents-aware formatter — NOT `fmt$` (`maximumFractionDigits: 0`). [C1] The customer is charged exact cents via Stripe + the email pay link, so the **document must equal the charge**. Whole-dollar PDF display while charging exact cents is a correctness defect, not deferred polish.

---

## §4 Files to touch
- `src/lib/calc.js` — core rule + helpers
- `src/components/ProposalDetail.jsx` — 5 call sites
- `src/pages/Invoices.jsx` — 7 call sites
- `src/lib/invoicePdf.js` — calc call site + new `proposal` param + cents-aware formatter [C1, D1]
- `src/components/PayAppDetailModal.jsx` — `:343` caller passes `proposal` into `generateInvoicePdf` [D1]
- `src/pages/PublicInvoicePage.jsx` — add `created_at` to the **anon embed at `:40`** (direct PostgREST embed — NOT an RPC, no migration) [A3]
- `src/components/MultiGCWizard.jsx` — 5 call sites
- `src/pages/WTCCalculator.jsx` — 3 alias sites + 5 inline ceils + parent-proposal `created_at` in scope

---

## §5 Out of scope / deferred
- Retroactively converting pre-cutoff proposals (manual override / recreate instead).
- Changing **internal list/summary** displays to show cents (still uses `fmt$`). The **invoice PDF** cents fix is now IN scope (§3.6, C1) — only non-billing display surfaces stay deferred.
- Any change to QB invoice push, Stripe, or retention math.

---

## §6 Estimate / time budget
- **Est. code:** ~90–120 lines net — calc core ~30 (incl. shape guards + dev warn), ~9 SELECT/embed edits (add `created_at`), ~15 call-site rewires (pass proposal, not `w`), 5 inline-ceil swaps, `invoicePdf` `proposal` param + cents formatter (~15), `PayAppDetailModal` caller. **Plus a cross-repo edit** in `sch-command` (§7 R5).
- **Time budget:** **~150 min** (was 90; SELECT wiring + PDF cents + cross-repo raised it). *Pending ERD lock confirmation.*
- Smoke tests: old sent proposal unchanged (ceil); old draft now exact; new proposal exact end-to-end (preview → lock → snapshot → invoice → PDF agree); pull-back-then-resend stays ceil.

---

## §7 Risks / open questions for audit
- **R1 [RESOLVED → §3.2/§3.6]** `created_at` must be in scope at every call site; round-1 named the exact missing SELECTs/embeds (now listed in §3.2). `PublicInvoicePage` is a direct **anon embed** (`:40`), not an RPC — 1-line fix, no migration. The dev-mode `console.warn` (B3) makes any remaining gap fail loudly in dev. Watch pattern: **created_at-scope-silent-noop**.
- **R2 [RESOLVED → §3.6]** Invoice **PDF** cents is now a build target (C1, charge==document). Remaining `fmt$` whole-dollar display on internal list/summary surfaces stays deferred — cosmetic, not a charge mismatch.
- **R3 [DERIVED]** `MultiGCWizard` allocates across GCs by per-WTC price; verify exact vs ceil doesn't break a sum-to-total invariant there.
- **R4 [LOCKED, accepted]** Transient quirk: an old proposal pulled back shows exact while edited, then snaps back to ceil on resend. Not customer-facing. Accepted.
- **R5 [E1, cross-repo]** Exact-penny `proposals.total` / `invoices.amount` can make `fullyBilled` / `remaining` checks miss by a cent in **`sch-command` `billingForecast.js`** — the real cross-repo consumer (NOT `BillingScheduleSection.jsx`, which is same-repo Sales Command). Add a **cent tolerance** to those comparisons. Cross-repo task; coordinate per the shared-data contract. *(Exact path `src/lib/billingForecast.js` is [DERIVED] — handoff text was partially garbled; confirm at build.)*

---

## Audit Amendments (post-R1)

Round-1 `/runaudit` (against commit `0613c3a`): **14 findings** (9 in-cap / 3 over-cap / 2 adjacent) · **2C/4H/3M (+2 adj)** · pattern: **created_at-scope-silent-noop**. The two CRITICALs: the feature as planned would **silently bill ceil on the primary invoice path** because `created_at` was never SELECTed and `usesExactPricing` had no shape guard / dev warning. Folded into §3.1, §3.2, §3.6, §4, §6, §7 above.

**In-cap findings folded in (this revision's build targets):**
- **B1** — `exact` param appended last positionally → §3.1
- **B2** — optional-chain `created_at` + SELECT it everywhere → §3.1, §3.2
- **B3** — shape guard (ignore WTC objects) + dev `console.warn` → §3.1
- **A1/A2/A3** — real wiring; add `created_at` to named SELECTs/embeds; `PublicInvoicePage` is an anon embed (1-line `:40`), not an RPC → §3.2, §4
- **C1** — invoice PDF renders exact cents (charge==document) → §3.6, §5
- **D1** — `generateInvoicePdf` gains `proposal` param; caller `PayAppDetailModal.jsx:343` → §3.6, §4
- **E1** — cross-repo cent tolerance in `sch-command` `billingForecast.js` → §7 R5
- **Manifest cross-repo file corrected** (item 8): real consumer is `billingForecast.js`, not `BillingScheduleSection.jsx` → manifest below

**Deferred — fast-follow / backlog (NOT this revision's build target):**
- **C2, C3 (over-cap remainder), D2** — over-cap findings; track for a follow-up pass.
- **ADJ-1** — adjacent finding; file to `docs/BACKLOG.md`, out of this surface.
- _(Full text of deferred findings lives in the round-1 audit output in the audit terminal.)_

> **Manifest note:** the section below is the **round-1** manifest. Re-run `/auditcriteria` to regenerate it for the round-2 pass (surface grew: PDF cents, cross-repo, SELECT wiring).

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-26 (round 1). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Small but money-touching pricing change with surprisingly wide reach — the round-up lives in 7 spots and the new exact number flows into invoices and the Schedule Command billing schedule. Three reviewers: one on whether the exact-vs-round-up decision actually reaches every screen, one on whether each screen has the proposal's date it needs (or silently falls back to rounding and hides the feature), and one on downstream fallout (does it shift billing-schedule totals, and do the cents even show up on the invoice/PDF). Focused check, not a deep audit.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: round 1 — initial draft (this commit)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: attack only material in this draft. No prior rounds to dedupe against.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked
- **Prod / staging / dev**: live in **prod** for the paying tenant (proposals + invoices are in daily use)
- **Blocking feature flags**: none gate pricing rounding (`requires_pay_app` affects invoice *routing*, not rounding)
- **Concurrency profile**: ≤5 (small team) — race-window findings weight Low

Cross-tenant findings cap at Med (live_tenants == 1). Multi-user race findings cap at Low (solo/≤5).

### Time budget + finding cap
- **Time budget**: 90 min (from §6; pending ERD lock)
- **Finding cap**: 9 findings (remainder → Quarantined)

### Surface
- Total lines: 106
- Sections: 8 (§0–§7)
- [LOCKED] decisions: ~12
- [DESIGN-OPEN] items: 1 (R2 — display/`fmt$`)
- [OPEN] items: 0 (R1/R3 are verify-items; R4 accepted)
- Plan-to-code ratio: 106 : ~50 ≈ 2:1 (well under 50:1)

### Layers touched
- UI / components (`ProposalDetail`, `WTCCalculator`, `Invoices`, `PublicInvoicePage`, `MultiGCWizard`, `invoicePdf`)
- Data layer (`calc.js` pricing, invoice live-recompute)
- State model / business logic (the derived-price rounding decision + lifecycle consistency)
- Cross-repo (`proposals.total` + `invoices.amount` consumed by `sch-command` `billingForecast.js`)

### New mechanisms introduced
- New helper functions: `usesExactPricing(proposal)`, `roundPrice(raw, exact)` (2)
- New columns / tables / triggers / RLS / routes / jobs: none

### Cross-system reach
- Schedule Command (sibling repo `sch-command`, shared Supabase): **`billingForecast.js`** reads `proposals.total` + `invoices.amount`. The rounding change shifts those by up to $0.99/line and can flip `fullyBilled` / `remaining` by a cent → needs a cent tolerance there (§7 R5). [R1 audit E1]
- **Correction (round-1 finding):** `scheduled_value` / `BillingScheduleSection.jsx` is a **same-repo (Sales Command)** file, NOT the cross-repo consumer the original manifest named.
- Service-role / bypass write paths: none

### Irreversibility
none — all changes reversible (no migration, backfill, or public API change)

### Known weak points
- **created_at scope (R1)** — the rule no-ops to ceil wherever `proposals.created_at` isn't in scope. Highest risk: `invoicePdf.js`, `PublicInvoicePage` public RPC payload, `WTCCalculator` parent proposal. A miss is silent (correct-looking, feature absent).
- **Cross-repo drift** — shifting `proposals.total`/`invoices.amount` perturbs `sch-command` `billingForecast.js` (`fullyBilled`/`remaining`); addressed by the cent tolerance in §7 R5.
- **Display (R2)** — `fmt$` uses `maximumFractionDigits: 0`; exact cents may be computed correctly but rounded away visually on invoice/PDF.
- **MultiGC invariant (R3)** — allocation sums per-WTC price; exact vs ceil could break a sum-to-total expectation.
- **Lifecycle consistency** — plan claims freeze(lock)==invoice(recompute) because `created_at` is immutable; worth an adversarial trace to confirm no surface uses status/`sent_at` as a proxy.

### Open questions
- Count: 1 true DESIGN-OPEN (R2 display). R1/R3 are verify-items; R4 accepted.
- Highest-pressure: R1 — the line between "feature works" and "silently does nothing" on a given surface.

### Suggested attack angles (3 total)
1. **Pricing-logic correctness & ceil-site coverage** — covers UI/components + data layer + business logic. Required reading: `src/lib/calc.js`, `Invoices.jsx`, `ProposalDetail.jsx`, `WTCCalculator.jsx`, `invoicePdf.js`. Pressure: is the full ceil inventory covered (`calc.js:53,76` + `WTCCalculator` 1126/1180/1375/1560/2085)? Does the lock-freeze snapshot agree with the live-invoice recompute for a post-cutoff proposal across its whole lifecycle (the status-mutation trap the plan claims to avoid)? Does the `exact=false` default truly preserve today's behavior at every unwired site?
2. **`created_at` availability / loader correctness** — covers data layer. Required reading: the proposal fetch at each call site + the public proposal/invoice RPCs. Pressure: is `proposals.created_at` actually present at every site — especially `invoicePdf.js`, the `PublicInvoicePage` RPC payload, and `WTCCalculator`'s parent proposal? Each absence is a silent ceil-fallback that hides the feature in prod.
3. **Cross-repo + display blast radius** — covers cross-repo + UI/UX. Required reading: `BillingScheduleSection.jsx`, `fmt$` in `src/lib/utils.js`, the PDF/invoice render path. Pressure: does shifting `scheduled_value`/`proposals.total` by up to $0.99/line break any sum, forecast, or reconciliation in Schedule Command's billing schedule? Will the exact cents actually display on invoice + PDF, or get rounded away by `fmt$`?

### Suggested agent count: 3

Rationale: 3 distinct layers + non-empty cross-system reach (Schedule Command) drive angles to 3; the 2 novel functions and single open question don't justify a 4th. Two would force dropping the cross-repo blast-radius angle, which is the least-obvious risk here.
