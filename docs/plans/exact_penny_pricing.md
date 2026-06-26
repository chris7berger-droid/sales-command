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
- **Est. code:** ~80–110 lines net (**Sales Command only**) — calc core ~30 (incl. shape guards + dev warn), ~9 SELECT/embed edits (add `created_at`), ~15 call-site rewires (pass proposal, not `w`), 5 inline-ceil swaps, `invoicePdf` `proposal` param + cents formatter (~15), `PayAppDetailModal` caller.
- **Time budget:** **~140 min** (was 90; SELECT wiring + PDF cents raised it). Cross-repo work is **not** in this budget — §7 R5 is a separate sch-command task. *Pending ERD lock confirmation.*
- Smoke tests: old sent proposal unchanged (ceil); old draft now exact; new proposal exact end-to-end (preview → lock → snapshot → invoice → PDF agree); pull-back-then-resend stays ceil.

---

## §7 Risks / open questions for audit
- **R1 [RESOLVED → §3.2/§3.6]** `created_at` must be in scope at every call site; round-1 named the exact missing SELECTs/embeds (now listed in §3.2). `PublicInvoicePage` is a direct **anon embed** (`:40`), not an RPC — 1-line fix, no migration. The dev-mode `console.warn` (B3) makes any remaining gap fail loudly in dev. Watch pattern: **created_at-scope-silent-noop**.
- **R2 [RESOLVED → §3.6]** Invoice **PDF** cents is now a build target (C1, charge==document). Remaining `fmt$` whole-dollar display on internal list/summary surfaces stays deferred — cosmetic, not a charge mismatch.
- **R3 [DERIVED]** `MultiGCWizard` allocates across GCs by per-WTC price; verify exact vs ceil doesn't break a sum-to-total invariant there.
- **R4 [LOCKED, accepted]** Transient quirk: an old proposal pulled back shows exact while edited, then snaps back to ceil on resend. Not customer-facing. Accepted.
- **R5 [E1 — ADJACENT, out of this build]** Our change writes exact-penny `proposals.total` / `invoices.amount`. Schedule Command **reads** those and runs its *own* `fullyBilled` / `remaining` math that may assume whole dollars, so pennies *could* throw it off by a cent. This is a robustness gap **inside `sch-command`**, not a calculation we export — and it is **UNVERIFIED** (we have not opened the file). **Not a build target here.** Action: verify whether `sch-command` `billingForecast.js` (path [DERIVED], confirm) actually mishandles penny amounts; if real, file a **separate sch-command task** to add a cent tolerance. Sales Command's change does not depend on it.

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
- **Manifest cross-repo claim corrected** (item 8): `BillingScheduleSection.jsx` is same-repo; any true cross-repo consumer is adjacent + unverified → manifest below

**Deferred — fast-follow / backlog (NOT this revision's build target):**
- **E1 (adjacent, cross-repo)** — verify whether `sch-command` mishandles penny amounts; if real, separate sch-command task with a cent tolerance (§7 R5). Unverified; no SC dependency.
- **C2, C3 (over-cap remainder), D2** — over-cap findings; track for a follow-up pass.
- **ADJ-1** — adjacent finding; file to `docs/BACKLOG.md`, out of this surface.
- _(Full text of deferred findings lives in the round-1 audit output in the audit terminal.)_

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-26 (round 2). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Round 2 of the exact-penny change. The plan already absorbed round 1's two serious problems (the screens that silently kept rounding up), so this pass is mostly **make-sure-the-fix-took** plus checking the **new PDF work** that got added in response. Three reviewers: one confirms the missing-date problem is actually closed everywhere (no screen left behind, and the new safety warning really fires), one attacks the brand-new "print the cents on the invoice PDF" change for the usual blast radius (does it break the other places that build a PDF, does the formatter it relies on even exist, does the printed total match what Stripe charges), and one checks the multi-GC split still adds up. Note: the cross-repo Schedule Command piece was deliberately pulled out of this build, so it is **not** reviewed here. Focused regression pass, not a fresh deep dive.

### Round
- Plan type: feature
- Current round: 2
- Plan revision under audit: `f827b3c`
- Findings trend: round 1 (14 total / 9 in-cap · 2C/4H/3M) → round 2 (?). **Watch for plateau** — the revision answered findings by *adding* surface (PDF cents §3.6, +9 SELECT/embed edits, est code 50→80-110 lines). If round-2 in-cap count is steady or higher than round 1's 9, treat as scope creep.

### Prior rounds
- Round 1: `0613c3a` · 2C/4H/3M (9 in-cap / 14 total) · pattern: **created_at-scope-silent-noop**

**Briefing for agents**: do NOT re-find round-1 issues. The round-1 build targets (B1/B2/B3, A1/A2/A3, C1, D1) are folded into §3.1, §3.2, §3.6, §4. Your job is (a) **regression-verify** those fixes actually closed the bug in the revised plan, and (b) attack ONLY material new to `f827b3c` — chiefly the §3.6 PDF-cents surface, the §3.1 shape-guard/dev-warn mechanism, and the named-SELECT coverage list. Use `git diff 0613c3a..f827b3c -- docs/plans/exact_penny_pricing.md` to see exactly what changed.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked
- **Prod / staging / dev**: live in **prod** for the paying tenant (proposals + invoices are in daily use)
- **Blocking feature flags**: none gate pricing rounding (`requires_pay_app` affects invoice *routing*, not rounding)
- **Concurrency profile**: ≤5 (small team) — race-window findings weight Low

Cross-tenant findings cap at Med (live_tenants == 1). Multi-user race findings cap at Low (solo/≤5).

### Time budget + finding cap
- **Time budget**: ~140 min (from §6; pending ERD lock)
- **Finding cap**: 14 findings — but this is a regression+new-surface round, not a fresh audit; the cap is a ceiling, NOT a target. A clean round 2 should surface **far fewer**. Remainder → Quarantined.

### Surface
- Total lines: ~150 (plan body §0–§7 + Audit Amendments, excluding this manifest)
- Sections: 9 (§0–§7 + Audit Amendments)
- [LOCKED] decisions: ~15 (round-1 fixes B1/B2/B3, §3.6 PDF now LOCKED)
- [DESIGN-OPEN] items: 0 (R2 resolved → §3.6; R3 verify-item; R4 accepted; R5 adjacent/out)
- [OPEN] items: 0
- Plan-to-code ratio: ~150 : ~80-110 ≈ 1.5:1 (well under 50:1)

### Layers touched
- UI / components (`ProposalDetail`, `WTCCalculator`, `Invoices`, `PublicInvoicePage`, `MultiGCWizard`, `invoicePdf`, `PayAppDetailModal`)
- Data layer (`calc.js` pricing + helper shape-guard; the +9 `created_at` SELECT/embed edits)
- State model / business logic (rounding decision + lifecycle consistency)
- *(Cross-repo: explicitly OUT this round — E1 deferred to a separate `sch-command` task, §7 R5. Not an attack angle here.)*

### New mechanisms introduced (new in `f827b3c`)
- `usesExactPricing` **shape guard** (ignore WTC-shaped objects via `proposal_id`; **dev-mode `console.warn`** when a proposal-shaped object lacks `created_at`) — §3.1
- `generateInvoicePdf` **signature change** (new `proposal` param) + caller update `PayAppDetailModal.jsx:343` — §3.6
- **Cents-aware PDF formatter** replacing `fmt$` on the invoice PDF (§3.6) — *plan does not name the formatter; verify it exists in `utils.js` or is being invented*
- (Carried from round 1: `usesExactPricing`, `roundPrice`, `exact` appended-last param)

### Cross-system reach
- **none in this build.** `sch-command` `billingForecast.js` reads `proposals.total`/`invoices.amount` but the penny-tolerance fix (E1) is deferred to a separate, unverified sch-command task (§7 R5). No calculation crosses repos. Agents should NOT spend budget in `sch-command`.
- Service-role / bypass write paths: none

### Irreversibility
none — all changes reversible (no migration, backfill, or public API change)

### Known weak points
- **created_at SELECT coverage completeness (R1 regression)** — round 1 named the missing SELECTs/embeds (`Invoices.jsx:67`, InvoiceDetail embeds, `PublicInvoicePage.jsx:40`, `WTCCalculator.jsx:2045`). Verify the list is **exhaustive** — any OTHER proposal fetch feeding a calc site that round 1 missed is still a silent ceil. The two round-1 CRITICALs lived here.
- **Shape-guard soundness** — `usesExactPricing` now classifies objects: `proposal_id` → ignore (WTC); `status`/`total` → proposal. Verify thin embeds (e.g. `PublicInvoicePage:40` selects only `total`, not `status`) are still classified as proposals and that the dev-warn actually fires on the silent path. A misclassification re-opens the silent-ceil bug.
- **PDF signature blast radius (new §3.6)** — adding a required `proposal` param to `generateInvoicePdf`: are there callers OTHER than `PayAppDetailModal.jsx:343`? Each un-updated caller → silent ceil or crash.
- **Cents-aware formatter existence** — §3.6 assumes a non-`fmt$` cents formatter; confirm it exists (or the plan is inventing an API). CLAUDE.md mandates `fmt$` use `maximumFractionDigits:0`, so a cents formatter is a deliberate exception that must be real.
- **charge == document** — §3.6 asserts the PDF must equal the Stripe charge. Trace the actual charged number (`send-invoice` `Math.round(net*100)`) vs the new PDF number; confirm they truly equal under exact pricing, including partial-pct invoices.
- **roundPrice level + MultiGC (R3, still unverified)** — is `Math.round(raw*100)/100` applied per-WTC vs proposal-total? Summed per-WTC exact values vs a separately-rounded total = penny-drift / double-round risk. MultiGC allocation sum-to-total invariant under exact is unverified.

### Open questions
- Count: 0 true DESIGN-OPEN (R2 resolved; R3 verify-item; R4 accepted; R5 adjacent/out).
- Highest-pressure: did the round-1 fix actually close the silent-ceil on EVERY proposal fetch, and does the new PDF surface introduce a fresh silent-ceil via an un-updated `generateInvoicePdf` caller?

### Suggested attack angles (3 total)
1. **created_at coverage + shape-guard regression** — covers data layer + business logic. **REGRESSION-heavy.** Required reading: every proposal fetch feeding a calc site — `Invoices.jsx` (`:67` + InvoiceDetail embeds `:607,1281,1470,2316,2434,2465`), `PublicInvoicePage.jsx:40`, `WTCCalculator.jsx:2045`, `ProposalDetail.jsx` (`select('*')`), `MultiGCWizard.jsx` (source `sp`), and `calc.js` `usesExactPricing`. Pressure: Is the named SELECT/embed list **complete** — grep for every `from("proposals")` / `proposals(...)` embed feeding `calcWtcPrice`; is any still missing `created_at`? Does the shape guard correctly classify thin embeds (only `total` selected) and WTC objects (`proposal_id`)? Does the dev-warn fire on the silent path? Confirm A1/A2/B2/B3 are genuinely closed, not just described.
2. **Invoice PDF cents + `generateInvoicePdf` signature blast radius** — covers UI/components + render path. **NEW surface.** Required reading: `src/lib/invoicePdf.js` (signature + every caller — grep `generateInvoicePdf`), `src/components/PayAppDetailModal.jsx:343`, `src/lib/utils.js` (does a cents-aware formatter exist?), `supabase/functions/send-invoice/index.ts` (the charged number). Pressure: Do un-updated callers of `generateInvoicePdf` silently ceil or crash? Does the cents formatter exist or is the plan inventing it? Does the PDF total reconcile with summed exact line cents (alignment + arithmetic)? Trace charge==document end-to-end. Confirm C1/D1 closed.
3. **calc.js threading + MultiGC sum-to-total (R3)** — covers data layer + business logic. Required reading: `src/lib/calc.js` (`roundPrice` application level, `exact` threading), `src/components/MultiGCWizard.jsx` (`220,526,584,585,630` allocation), `Invoices.jsx` (`:197,264` partial-pct). Pressure: Is `roundPrice` applied per-WTC or at the total, and does summing per-WTC exact values match a separately-rounded proposal total (double-round / penny drift)? Does the MultiGC allocation still sum to the contract total under exact (R3 unverified)? Does `exact`-appended-last (B1) thread without positional collision at every signature? Smoke the ADJ-1 case (100%/single-WTC post-cutoff: sum-of-lines == stored `invoice.amount`).

### Suggested agent count: 3

Rationale: cross-repo angle dropped out (E1 deferred), but it's replaced — not subtracted — by the new §3.6 PDF-cents/signature surface plus the need for a dedicated regression-verification agent on the round-1 CRITICALs. 3 layers + ≥3 new mechanisms (shape guard, dev-warn, signature change, cents formatter) hold it at 3, not 2 (regression deserves its own agent) and not 4 (no cross-system reach, 0 open questions). If round 2 surfaces a plateau (in-cap ≥ round 1's 9), `/runaudit` should present deferring §3.6 PDF-cents to its own loop as the scope-cut.
