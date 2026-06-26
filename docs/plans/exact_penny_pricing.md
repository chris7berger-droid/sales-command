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

A proposal prices to the **exact penny** iff its **pricing era** `>= 2026-06-26T12:00:00-05:00` (noon Central). The pricing era is `pricing_anchor_at ?? created_at` — normally `created_at`, but a multi-GC clone inherits the **source's** era via `pricing_anchor_at` (§3.5.1). Otherwise it rounds up (`Math.ceil`), exactly as today.

- **[LOCKED] Trigger is `created_at`, an immutable field** — NOT `status`/`sent_at`. Mutable triggers break consistency: the app freezes price at Lock (status `Draft`) but recomputes the invoice live later (status `Sent`), so a status-based rule would freeze exact and bill ceil — re-creating the exact bug. `created_at` never changes, so preview, freeze, invoice, PDF, and snapshot always agree.
- **[LOCKED] Round-to-cent = `Math.round(raw * 100) / 100`** (matches existing invoice rounding; kills float dust).
- **[LOCKED] Safe default = ceil.** Calc functions default to `Math.ceil` when the proposal/`created_at` is missing or unparseable, so any unwired call site keeps today's behavior — no path silently produces a wrong number.
- **[LOCKED] Forward-only.** This does NOT retroactively fix pre-cutoff proposals (incl. the one that prompted this work). Those are handled manually (override the invoice amount) or by recreating as a new proposal.
- **[LOCKED] Old unsent drafts (the 11) stay ceil.** To make one exact, recreate it. Accepted given only 11 exist.
- **[LOCKED — AMENDED post-R2 (ratified 2026-06-26): one additive migration allowed.]** Was "no DB changes / migrations / edge functions." Ratified exception: a single **nullable** column `proposals.pricing_anchor_at` + a one-line `clone_proposal_to_gcs` RPC change, to fix the multi-GC clone freeze≠bill **durably** (§3.5.1). Still: no edge-function changes, no destructive / heavy-backfill migration.

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
  - Read the **pricing era** = `proposal?.pricing_anchor_at ?? proposal?.created_at` (optional chaining). [B2] `pricing_anchor_at` is normally null (→ `created_at`); a multi-GC clone carries the source's era here (§3.5.1).
  - Return `true` only if the era parses and `>= cutoff`; `false` otherwise (missing/unparseable → legacy ceil).
  - **Shape guard + LOUD dev-warn [B3 → item-1 hardened, the convergence lever]:** `usesExactPricing` must `console.warn` (dev-mode) on **both** silent paths so any miss screams during the §6 smoke test:
    - **(a) wrong object** — handed a `proposal_id`-bearing object (a WTC `w` passed instead of the proposal): warn and return `false`; never read a WTC's own `created_at`.
    - **(b) thin proposal missing `created_at`** — detected via a signal the thin invoice embeds actually carry: **`has call_log_id && !proposal_id`** (NOT just `status`/`total`, which thin embeds may omit): warn.
    Goal: a missed SELECT or wrong-object pass is loud in dev, never a silent prod ceil.
- Add `roundPrice(raw, exact)` → `exact ? Math.round(raw * 100) / 100 : Math.ceil(raw)`.
- **Append `exact` LAST positionally [B1]** — never insert before existing args:
  - `calcWtcPrice(wtc, markupOverride, exact = false)`
  - `calcProposalTotal(wtcs, markupOverride, exact = false)`
  - `calcWtcBreakdown(wtc, exact = false)`
  - Route each function's final math through `roundPrice`.

### 3.2 Wire call sites [LOCKED intent, DERIVED scope]
At each of the ~15 sites (§0), compute `usesExactPricing(proposal)` from the already-loaded **proposal object — never the WTC `w`** — and pass it as the trailing `exact` arg. [A1, A2]

**`created_at` (and the new `pricing_anchor_at`) are not currently SELECTed — both must be added** to these explicit selects/embeds, or the rule silently no-ops to ceil: [A1, A2, A3, B2, C3]
- `Invoices.jsx:67` — new-invoice proposal fetch
- `Invoices.jsx` InvoiceDetail `proposals(...)` embeds at `:607, :1281, :1470, :2316, :2434, :2465`
- `PublicInvoicePage.jsx:40` — anon embed
- `WTCCalculator.jsx:2045` — parent proposal load

**[A1, Block 2] EVERY proposal fetch must SELECT BOTH `created_at` AND `pricing_anchor_at`.** Dropping `pricing_anchor_at` means a sister cloned from a pre-cutoff source (anchor = pre-cutoff, `created_at` = post-cutoff) reads `created_at` → computes **EXACT** when it must be **CEIL** → **under-bills the clone.** The dev-warn is **blind** to a missing nullable column, so this is contract, not optional.

**[A3, Block 4 — convergence lever] Define ONE shared select fragment and splice it into every proposal fetch so the column set cannot drift:**
```js
const PROPOSAL_ERA = "created_at, pricing_anchor_at";
```
Use `PROPOSAL_ERA` in each `from("proposals").select(...)` / `proposals(...)` embed. No future fetch can add `created_at` but forget `pricing_anchor_at`.

**Three sites need MORE than a SELECT [item 2, A1/A2/REG-D1] — the hardened warn exposes wrong-object / missing-`created_at`, but NOT a missing `pricing_anchor_at`:**
- `Invoices.jsx:2480` — the deep-link "Create invoice" proposal fetch: add **both `created_at` and `pricing_anchor_at`**.
- `WTCCalculator` — a SELECT alone does NOT close it (nothing currently stores or forwards the era cols, and the write handlers have no proposal row in scope). Thread **both `created_at` and `pricing_anchor_at`** from the `:2045` jobInfo fetch into component **state**, then into the `proposals.total` write scope (`handleSave`, `:1988/:2014`) AND the `proposalData` preview object (`:2065`).
- **PayApp PDF proposal source** — replace the `Invoices.jsx:2363` synthetic stub (`{ call_log_id: ... }`) and the BillingSchedule prop with a **real proposal object carrying both `created_at` and `pricing_anchor_at`**. Needed **even with §3.6 cents-display deferred**, so the stored invoice line/amount is exact.

Files: `ProposalDetail.jsx`, `Invoices.jsx`, `invoicePdf.js`, `PublicInvoicePage.jsx`, `MultiGCWizard.jsx`, `WTCCalculator.jsx` (alias path).

### 3.2.1 Line-sum reconciliation [D-sum · CORRECTED post-R3 REG-B1]
`getLineAmount = calcWtcPrice(wtc) * (pct/100)` — the per-line **× pct** multiply is not rounded consistently, so summed lines can drift from the header by a cent. **Fix: cent-round each line with `Math.round(x*100)/100` for BOTH eras — NOT `roundPrice` (which ceils when `exact=false` and would over-bill committed legacy partial invoices, violating §2 forward-only). Then set `invoice.amount = sum of the cent-rounded lines` — never `round(rawSum)`.**
- **The ceil-vs-exact choice lives ONLY inside `calcWtcPrice(wtc, override, exact)` on the per-WTC base — never on the `× pct` line.**
- **[A2, Block 3] Thread the ARG, not just the SELECT:** at `:197`, `getLineAmount` must pass `calcWtcPrice(wtc, undefined, usesExactPricing(proposal))`. Adding the SELECT is necessary but NOT sufficient — without the `exact` arg the post-cutoff WTC base still ceils.
- Sites: `Invoices.jsx:197` (`getLineAmount`), `:200`/`:264` (`invoiceTotal` sum), `:294` (per-line store).
- `calc.js` threading alone does NOT fix the sum — it lives in invoice assembly.
- Ensure the **QB push uses the reconciled header** so QB lines == QB header (no 1¢ split between detail and total).

### 3.3 `WTCCalculator.jsx` inline ceils [LOCKED]
Replace the 5 inline `Math.ceil` (1126, 1180, 1375, 1560, 2085) with the same rule so the live preview matches what gets locked and billed.

### 3.4 Freeze path — no extra work [DERIVED]
Lock & Approve already computes via `calcWtcPrice`/`calcWtcTotal`, so wiring §3.2 makes new proposals freeze the exact snapshot automatically.

### 3.5 Signing page — no change [DERIVED]
Reads the frozen snapshot only. New proposals show exact via §3.4; old signed proposals are untouched.

### 3.5.1 Multi-GC clone path [E1 — LOCKED · option (b) via `pricing_anchor_at`, ratified 2026-06-26]
**Problem (verified in `supabase/migrations/20260519230000_sister_wtc_auto_lock.sql`):** `clone_proposal_to_gcs` inserts the sister with `created_at = now()` and copies the source's `total` / `locked_line_total` via SQL (no `roundPrice`); the sister also carries `cloned_from_proposal_id`. So a sister cloned from a **pre-cutoff** job gets a fresh post-cutoff `created_at` → live invoice recompute = **exact** while the inherited frozen snapshot = **ceil** → **freeze ≠ bill** on a live path. (MultiGC is live in prod — one sister out today.)

**Ratified fix — option (b) via a dedicated era column** (chosen for integrity/durability over overloading `created_at`):
- Add nullable `proposals.pricing_anchor_at timestamptz`. Normal proposals leave it null.
- `usesExactPricing` keys off `pricing_anchor_at ?? created_at` (§3.1).
- **`clone_proposal_to_gcs` [Block 6 / C2]:** add `pricing_anchor_at` to **both** the INSERT column list **and** the VALUES list, set to `COALESCE(v_source.pricing_anchor_at, v_source.created_at)`. (First arm is forward-defensive — the RPC currently rejects nested clones, so `v_source.pricing_anchor_at` is null today [ADJ-M4].) It's `CREATE OR REPLACE`, so **after deploy, smoke-verify a freshly-cloned sister row actually carries `pricing_anchor_at`.**
- **Backfill existing sister(s) [Block 5 / C1]** with set-based SQL (not a one-row hand-edit):
  ```sql
  UPDATE public.proposals s
     SET pricing_anchor_at = src.created_at
    FROM public.proposals src
   WHERE s.cloned_from_proposal_id = src.id
     AND s.pricing_anchor_at IS NULL;
  ```
  (`src` is always an original — nested clones are rejected. Confirm no sister has a **hard-deleted** source before relying on the join.)
- **Migration discipline:** timestamp **after `20260625140000`**; run `scripts/check-migration-safety.sh`; push via `npm run db:push` (shared backend).
- **Rollback order [ADJ-M5]:** additive/reversible, but order-dependent — revert the app/SELECTs FIRST, then drop the column. Dropping the column while the app still selects it 400s every proposal fetch.
- `created_at` stays truthful (real clone time); the pricing era is explicit and self-documenting.
- **Rejected:** overloading `created_at` (makes the column lie about creation time → rots reporting/sorting) and JS-lineage joins at every price site (re-creates the coverage burden the audit hammered).

### 3.5.2 Multi-GC scope this round [A3 — LOCKED · IN SCOPE, ratified 2026-06-26]
**Correction:** an earlier draft called MultiGC "not live" — that was from stale memory, not code. **MultiGC is live in prod** (`clone_proposal_to_gcs` deployed; `MultiGCWizard` rendered at `ProposalDetail.jsx:1374`; one sister out). So the clone path is **in scope this round** — exact pricing would otherwise mis-bill clones (§3.5.1).
- Wire MultiGCWizard's 5 calc sites (`220, 526, 584, 585, 630`) to pass the proposal + `exact`.
- D2 preview: the wizard previews **target** proposals that don't exist until confirm; preview pricing should use the **source** `sp` era via the same `pricing_anchor_at ?? created_at` rule (a confirmed sister carries the right `pricing_anchor_at`). The §3.1 warn will catch any WTC-shaped object passed by mistake.

### 3.6 Invoice PDF — proposal param retained; cents DISPLAY deferred [RE-SCOPED post-R2]
- **RETAINED this round [D1]:** the PDF path must receive a **real proposal** (not the `Invoices.jsx:2363` stub) so the **stored** invoice line/amount is exact — see §3.2 "PayApp PDF proposal source." This is about the *amount*, needed even though cents-display is deferred.
- **DEFERRED → §5 [C1 reversed post-R2]:** rendering cents on the PDF moves to a separate loop. Round-2 finding: the HTML/web invoice already shows cents; only the jsPDF attachment lags.

---

## §4 Files to touch
- `src/lib/calc.js` — core rule + helpers (era = `pricing_anchor_at ?? created_at`)
- **Migration (additive) + RPC [§3.5.1]:** `proposals.pricing_anchor_at timestamptz NULL`; `clone_proposal_to_gcs` adds `pricing_anchor_at` to its INSERT columns + VALUES (`COALESCE(v_source.pricing_anchor_at, v_source.created_at)`); set-based backfill of existing sisters. Timestamp **after `20260625140000`**; `scripts/check-migration-safety.sh`; `npm run db:push`; post-deploy smoke-verify a fresh clone carries the column.
- `src/components/ProposalDetail.jsx` — 5 call sites
- `src/pages/Invoices.jsx` — 7 calc call sites + line-sum reconciliation (`:197/:200/:264/:294`, §3.2.1) + `:2480` deep-link select + `:2363` stub→real proposal
- `src/lib/invoicePdf.js` — calc call site + new `proposal` param (cents-DISPLAY deferred → §5) [D1]
- `src/components/PayAppDetailModal.jsx` — `:343` caller passes `proposal` into `generateInvoicePdf` [D1]
- `src/pages/PublicInvoicePage.jsx` — add **both `created_at` and `pricing_anchor_at`** to the **anon embed at `:40`** (direct PostgREST embed — NOT an RPC, no migration) [A1, A3]
- `src/components/MultiGCWizard.jsx` — 5 calc call sites (in scope; pass real proposal + `exact`) [§3.5.2]
- `src/pages/WTCCalculator.jsx` — 3 alias sites + 5 inline ceils + parent-proposal `created_at` in scope

---

## §5 Out of scope / deferred
- Retroactively converting pre-cutoff proposals (manual override / recreate instead).
- Changing **internal list/summary** displays to show cents (still uses `fmt$`).
- **Pay-app PDF cents (deferred follow-up loop) [C1, reversed post-R2]:** make the pay-app PDF honor the existing `invoice.show_cents` toggle (`fmt$c`), and fix the **retention omission in `netTotal`** (`invoicePdf.js:306`). Separate loop — not this build. (The PDF still receives a real proposal so the stored *amount* is exact — §3.6.)
- Any change to QB invoice push, Stripe, or retention math.

---

## §6 Estimate / time budget
- **Est. code:** ~110–140 lines net (**Sales Command only**) — calc core ~30 (era + hardened both-path dev-warn), ~10 SELECT/embed + state-threading edits (+ `pricing_anchor_at` alongside `created_at`), line-sum reconciliation, ~15 call-site rewires, 5 inline-ceil swaps, `invoicePdf` `proposal` param, **MultiGC 5 sites**, **1 additive migration + 1-line clone RPC + 1-row backfill** (§3.5.1). PDF cents-display deferred (§5).
- **Time budget:** **~180 min** (added MultiGC wiring + the `pricing_anchor_at` migration/RPC). Cross-repo (E1) still excluded. *Pending ERD lock confirmation.*
- Smoke tests: old sent proposal unchanged (ceil); old draft now exact; new proposal exact end-to-end (preview → lock → snapshot → invoice → PDF agree); pull-back-then-resend stays ceil.
- **[A3, Block 4 — the ONLY detector for the missing-`pricing_anchor_at` class; the dev-warn is blind to it]** Clone a **PRE-cutoff** proposal **AFTER** the cutoff, then assert the sister bills **CEIL** end-to-end (preview → freeze → invoice).

---

## §7 Risks / open questions for audit
- **R1 [RESOLVED → §3.2/§3.6]** `created_at` must be in scope at every call site; round-1 named the exact missing SELECTs/embeds (now listed in §3.2). `PublicInvoicePage` is a direct **anon embed** (`:40`), not an RPC — 1-line fix, no migration. The dev-mode `console.warn` (B3) makes any remaining gap fail loudly in dev. Watch pattern: **created_at-scope-silent-noop**.
- **R2 [RE-SCOPED → §5]** Invoice **PDF cents display** is deferred to a separate loop (round-2 reversal: web/HTML already shows cents; only the jsPDF attachment lags + a retention bug at `invoicePdf.js:306`). The PDF still receives a real proposal so the stored **amount** is exact (§3.2/§3.6).
- **R3 [RESOLVED → §3.5.1/§3.5.2, IN SCOPE]** MultiGC is live; clone freeze≠bill fixed via `pricing_anchor_at` (clone inherits source era). Still verify the MultiGC allocation **sum-to-total invariant** holds under exact pricing.
- **R6 [D-sum, in scope §3.2.1]** Per-line `× pct` rounding must reconcile: round each line first, sum the rounded lines for `invoice.amount` (not `round(rawSum)`), and QB header == QB lines. Prevents a 1¢ detail/total split.
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

## Audit Amendments (post-R2)

Round-2 `/runaudit` (against `f827b3c`): **11 findings** (9 in-cap / 2 regressions) · **0C/4H/5M (+2 regression)** · pattern: **warn-net-holes (PLATEAU — no ≥30% drop vs round 1)**. The headline is the plateau: the loop converges not by hunting more screens but by **hardening the dev-warn** (§3.1) so the §6 smoke test surfaces any remaining coverage miss mechanically. Round 3 verifies the loud warn + a clean smoke pass, NOT more site-hunting.

**Ratified this revision:**
- **§3.6 PDF-cents DEFERRED** to a separate loop (honor existing `invoice.show_cents`/`fmt$c` + fix retention omission `invoicePdf.js:306`) → §5. The PDF still receives a real proposal so the stored *amount* is exact.

**In-cap findings folded in (build targets):**
- **Item 1** — hardened both-path dev-warn (wrong-object `proposal_id`; thin proposal `call_log_id && !proposal_id`) → §3.1
- **Item 2 / REG-D1** — coverage a SELECT alone misses: `Invoices.jsx:2480`, WTCCalculator state-threading (`:2045`→`:1988/:2014/:2065`), PayApp PDF stub→real proposal (`:2363`) → §3.2
- **Item 3 / D-sum** — line-sum reconciliation (round lines first, sum rounded; QB header==lines) → §3.2.1, §7 R6

**RATIFIED 2026-06-26 (were design-open; corrected after MultiGC confirmed LIVE in prod via code, not memory):**
- **Item 4 / E1 (clone path)** → §3.5.1 — **LOCKED option (b) via a dedicated `pricing_anchor_at` column** (chosen for integrity/durability over overloading `created_at`). Clone inherits source era; `created_at` stays truthful.
- **Item 5 / A3 (MultiGC scope)** → §3.5.2 — **LOCKED IN SCOPE** (not deferred). The earlier "not live" was stale memory; MultiGC is live, so the clone path is fixed this round.
- **Scope note:** lifts §2's no-migration lock for one additive column + a one-line clone RPC change (ratified).

**Adjacent / framing (not build targets):** F1 (PDF-cents rationale was inverted — HTML already does cents, jsPDF is the laggard; corrected in §3.6/§5), F2 (ProposalDetail is safe only via `select('*')` — don't route a thin proposal into it later), F3 (sec: no new RLS/tenant/storage holes; `send-invoice` distrusts the client amount, reads the DB row).

> **Manifest note:** the manifest below is the **round-3** manifest (regenerated `2026-06-26` against `76756bd`). Adds the schema/migration layer (`pricing_anchor_at` + clone RPC + 1-row backfill), MultiGC back in scope, PDF-cents deferred. Round 3 is convergence verification + new-migration-surface.

---

## Audit Amendments (post-R3) — CONVERGED · final pre-build

Round-3 `/runaudit` (against `76756bd`): **6 in-cap (+4 adjacent)** · **0C/2H/4M (+1 regression)** · pattern: **era-edge-fix-wording**. **CONVERGED** — R2 9 in-cap → R3 6 (~33% drop; ~44% by root-cause group). 0 Critical; the structural questions (MultiGC allocation, QB totals, clone freeze≠bill) closed clean. The two Highs were one-line edge fixes — one over-billed legacy (REG-B1), one under-billed clones (A1). **This is the final revision — BUILD after this, no round 4.**

**Fixes folded in (build targets):**
- **Block 1 / REG-B1** — line rounding uses `Math.round(x*100)/100` for BOTH eras, NOT `roundPrice` (ceil would over-bill legacy partials) → §3.2.1
- **Block 2 / A1** — every proposal fetch SELECTs BOTH `created_at` AND `pricing_anchor_at` (warn is blind to a missing nullable col) → §3.2, §4
- **Block 3 / A2** — thread the `exact` ARG into `calcWtcPrice(wtc, undefined, exact)` at `:197` (SELECT alone insufficient) → §3.2.1
- **Block 4 / A3 (convergence lever)** — one shared `PROPOSAL_ERA` select fragment so columns can't drift + a clone-PRE-cutoff-bills-CEIL smoke test → §3.2, §6
- **Block 5 / C1** — set-based backfill SQL (not a one-row edit) → §3.5.1
- **Block 6 / C2** — clone RPC: `pricing_anchor_at` in INSERT cols + VALUES; timestamp after `20260625140000`; post-deploy smoke-verify → §3.5.1, §4

**Adjacent — filed to `docs/BACKLOG.md` (pre-existing, NOT this loop's build target):**
- **ADJ-D3** — multi-invoice cumulative 1¢ drift across partial invoices vs `proposals.total` (pre-exists under ceil; exact marginally more frequent; D-sum only reconciles within one invoice).
- **ADJ-D4** — override-sister mispricing: clone copies `v_source.total` ignoring `markup_override_pct`, and invoice sites call `calcWtcPrice(wtc)` with no override → an override sister bills at source markup (pre-existing; exact widens the visible gap).
- **ADJ-M4** (COALESCE first-arm unreachable today) and **ADJ-M5** (rollback order) — folded as doc notes into §3.5.1.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-26 (round 3). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Round 3 is the convergence check — but the plan just **grew again** to fix round 2's findings: it added a database column and pulled the multi-GC path back in. That's the exact pattern we said to watch for. Three reviewers: one stress-tests the **new database column + the clone fix** (does a cloned job inherit the right pricing era, is the migration safe on the shared database, did the one existing clone get backfilled correctly), one verifies the **safety warning actually converges** and probes a sharp new hole — the new column must be loaded on every screen the date is, or clones silently misprice, and the warning *can't* catch that because the column is normally empty — and one checks the **multi-GC math adds up** and invoice lines reconcile to the total. The call for this round: if it comes back heavy, **cut the database/multi-GC piece out into its own loop and ship the simpler core first** — do not expand a fourth time.

### Round
- Plan type: feature
- Current round: 3
- Plan revision under audit: `76756bd`
- Findings trend: round 1 (9 in-cap / 14 total · 2C/4H/3M) → round 2 (9 in-cap / 11 · 0C/4H/5M +2 regression · **PLATEAU**) → round 3 (?). The pass-2 revision answered findings by **adding surface** (additive migration + clone RPC + MultiGC wiring). **Round ≥3 + plateau-prone:** if round 3 does NOT drop ≥30% (i.e. **≤6 in-cap, ideally ≤3**), `/runaudit` MUST trigger the scope-cut — defer the `pricing_anchor_at` migration + MultiGC clone mechanism to its own loop and ship core `created_at` exact-pricing first. Do **not** expand again.

### Prior rounds
- Round 1: `0613c3a` · 2C/4H/3M (9 in-cap / 14 total) · pattern: **created_at-scope-silent-noop**
- Round 2: `f827b3c` · 0C/4H/5M (9 in-cap / 11 total, +2 regression) · pattern: **warn-net-holes (PLATEAU — no ≥30% drop)**

**Briefing for agents**: round 3 is **CONVERGENCE VERIFICATION**, not a fresh hunt. Do NOT re-find round 1/2 issues. Round-2 build targets are folded into §3.1 (hardened both-path warn), §3.2/§3.2.1 (coverage + line-sum), §3.5.1 (`pricing_anchor_at` clone fix), §3.5.2 (MultiGC in scope). Your job: (a) **regression-verify** the hardened warn actually catches BOTH silent paths AND the clone fix actually closes freeze≠bill; (b) attack ONLY material new to `76756bd` — the `pricing_anchor_at` migration/RPC/backfill, the **doubled SELECT-coverage surface** (both `created_at` AND `pricing_anchor_at` now required), and the newly-in-scope MultiGC wiring. Use `git diff f827b3c..76756bd -- docs/plans/exact_penny_pricing.md`.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked
- **Prod / staging / dev**: live in **prod** for the paying tenant; **MultiGC is live** (`clone_proposal_to_gcs` deployed, one sister out in prod)
- **Blocking feature flags**: none gate pricing rounding
- **Concurrency profile**: ≤5 (small team) — race-window findings weight Low
- **Shared backend**: the migration lands on the **shared Supabase project** (`pbgvgjjuhnpsumnowuym`, shared with `field-command`) → ledger / timestamp-collision discipline applies (CLAUDE.md: `scripts/check-migration-safety.sh`, `npm run db:push`)

Cross-tenant findings cap at Med (live_tenants == 1). Multi-user race findings cap at Low (solo/≤5).

### Time budget + finding cap
- **Time budget**: ~180 min (from §6; added MultiGC + migration; pending ERD lock)
- **Finding cap**: 18 (formula ceiling) — but this is a **convergence round**: SUCCESS is a sharp DROP, not filling the cap. **≤3 in-cap = converged; >6 in-cap = plateau persists → scope-cut.** Do NOT dump toward 18. Remainder → Quarantined.

### Surface
- Total lines: ~205 (plan body §0–§7 + 2 Audit-Amendment sections, excluding this manifest)
- Sections: 11 (§0–§7 + Audit Amendments post-R1 + post-R2)
- [LOCKED] decisions: ~20 (now incl. §3.5.1 `pricing_anchor_at`, §3.5.2 MultiGC in-scope)
- [DESIGN-OPEN] items: 0
- [OPEN] items: 0
- Plan-to-code ratio: ~205 : ~110-140 ≈ 1.6:1 (well under 50:1)

### Layers touched
- UI / components (`ProposalDetail`, `WTCCalculator`, `Invoices`, `PublicInvoicePage`, `MultiGCWizard` [now in scope], `invoicePdf`, `PayAppDetailModal`)
- Data layer (`calc.js` era logic; SELECTs now need BOTH `created_at` AND `pricing_anchor_at`)
- State model / business logic (rounding decision + clone era lineage)
- **Schema / migration (NEW this round)** — `proposals.pricing_anchor_at` column + `clone_proposal_to_gcs` RPC change + 1-row backfill
- *(Cross-repo: still OUT — E1 deferred, §7 R5.)*

### New mechanisms introduced (new in `76756bd`)
- **`proposals.pricing_anchor_at timestamptz NULL`** — new nullable column (the pricing-era anchor)
- **`clone_proposal_to_gcs` RPC change** — sets sister `pricing_anchor_at = COALESCE(v_source.pricing_anchor_at, v_source.created_at)` + 1-row backfill
- **Era logic** `pricing_anchor_at ?? created_at` in `usesExactPricing` (§3.1)
- **Hardened both-path dev-warn** — (a) wrong-object `proposal_id`, (b) thin proposal `call_log_id && !proposal_id` (§3.1)
- **Line-sum reconciliation** — round lines first, header = sum of rounded lines (§3.2.1)
- **MultiGC 5-site calc wiring** — newly in scope (§3.5.2)

### Cross-system reach
- **No cross-repo READ this build** (E1 still out). BUT the migration lands on the **shared Supabase backend** (`field-command` shares the ref) → timestamp-collision / ledger coordination required before push.
- **Service-role / bypass write path**: `clone_proposal_to_gcs` is a DB RPC (verify SECURITY DEFINER) — a write path that bypasses client RLS; its `pricing_anchor_at` write must be correct because nothing client-side guards it.

### Irreversibility
**No longer "none."** One **additive nullable** column `proposals.pricing_anchor_at` + a one-line `clone_proposal_to_gcs` change + a **1-row** backfill. Reversible (drop column) and non-destructive, but on the **shared backend** → coordinate the ledger, run `scripts/check-migration-safety.sh`, push via `npm run db:push` (CLAUDE.md migration discipline).

### Known weak points
- **Doubled coverage surface (NEW, sharp — highest pressure)** — `usesExactPricing` now reads `pricing_anchor_at ?? created_at`. EVERY SELECT that adds `created_at` must ALSO add `pricing_anchor_at`. A SELECT with `created_at` but NOT `pricing_anchor_at` → for a cloned sister it reads `undefined ?? created_at(post-cutoff)` = **exact when it should be ceil** → re-creates freeze≠bill, the exact bug the column was added to fix. **And the hardened warn CANNOT catch this:** `pricing_anchor_at` is normally null, so "absent from SELECT" is indistinguishable from "present and null." The convergence lever (the warn) has a blind spot for the new column.
- **Clone RPC correctness** — `COALESCE` chaining for clone-of-clone; the 1-row backfill; does the sister's frozen `locked_line_total` snapshot AGREE with its `pricing_anchor_at` era (era says ceil — is the inherited snapshot actually ceil, so freeze==bill)?
- **Migration on shared backend** — timestamp collision across repos; ledger; `check-migration-safety.sh`; is the column added with the right default/null and any needed grant for anon/PostgREST exposure on the public invoice embed.
- **Warn convergence (B1/B2 regression)** — verify the hardened both-path warn fires on wrong-object (`proposal_id`) AND thin-proposal (`call_log_id && !proposal_id`) as written; a typo in the predicate re-opens the silent path.
- **MultiGC sum-to-total (R3 — unverified across 3 rounds)** — allocation invariant under exact pricing still not confirmed.
- **Line-sum reconciliation (D-sum)** — round-then-sum in invoice assembly; QB header == QB lines (no 1¢ detail/total split).

### Open questions
- Count: 0 DESIGN-OPEN (all ratified).
- Highest-pressure: does the new `pricing_anchor_at` column **re-open the silent-coverage hole** the warn was meant to close — because the warn is blind to a missing nullable column?

### Suggested attack angles (3 total)
1. **Migration + clone-RPC + `pricing_anchor_at` integrity (NEW schema layer; regression-verify E1)** — covers schema/migration + the bypass write path. Required reading: the new migration adding `proposals.pricing_anchor_at`, `supabase/migrations/20260519230000_sister_wtc_auto_lock.sql` (`clone_proposal_to_gcs`), `CLAUDE.md` migration discipline, `scripts/check-migration-safety.sh`. Pressure: `COALESCE` chaining for clone-of-clone; the 1-row backfill correctness; timestamp collision on the shared backend; is the RPC SECURITY DEFINER (bypass) and is its anchor write correct; does the sister's frozen `locked_line_total` agree with its `pricing_anchor_at` era (clone freeze==bill); is the column exposed where the anon public-invoice embed needs it; is the change truly reversible.
2. **Doubled SELECT-coverage + warn convergence (the sharp new risk + B1/B2 regression)** — covers data layer + business logic. Required reading: every proposal SELECT/embed in §3.2 + grep ALL `from("proposals")` / `proposals(...)` feeding a calc site, `calc.js` `usesExactPricing`. Pressure: is `pricing_anchor_at` added to EVERY SELECT that adds `created_at` (esp. invoice / PDF / MultiGC sites)? A SELECT with `created_at` but not `pricing_anchor_at` silently misprices clones AND the warn can't see it (null is normal) — is there ANY guard? Does the hardened both-path warn actually fire on wrong-object and thin-proposal? Confirm B1/B2 closed and the coverage list is exhaustive (no new `from("proposals")` missed).
3. **MultiGC wiring + sum-to-total (R3) + line-sum reconciliation (D-sum)** — covers UI/components + calc/business logic. Required reading: `src/components/MultiGCWizard.jsx` (`220,526,584,585,630`), `src/lib/calc.js` (`roundPrice` level), `src/pages/Invoices.jsx` (`:197/:200/:264/:294`). Pressure: does MultiGC allocation sum-to-total hold under exact (R3, unverified 3 rounds)? Do the 5 MultiGC sites pass the real proposal (with BOTH era columns) not `w`? Does the line-sum reconciliation (round lines first, header = sum of rounded) actually prevent the 1¢ drift, and is the QB push header == lines?

### Suggested agent count: 3

Rationale: a genuinely NEW schema/migration layer (`pricing_anchor_at` + clone RPC; irreversibility no longer none) earns a dedicated agent; the doubled-coverage + warn-convergence is the core verification; MultiGC + line-sum is the calc surface. 3 holds — not 2 (the migration is too distinct from coverage to merge) and not 4 (no cross-repo READ, 0 open questions). **Plateau guard:** round 3 is plateau-prone — if findings don't drop ≥30% (>6 in-cap), `/runaudit` MUST present the scope-cut (defer `pricing_anchor_at` migration + MultiGC to their own loop) as the ONLY build option, not another expansion.
