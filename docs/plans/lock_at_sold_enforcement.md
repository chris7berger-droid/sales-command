# Lock-at-Sold Enforcement

**Repo:** sales-command · **Branch:** `feat/lock-at-sold` · **Drafted:** 2026-08-18 (T1 plan terminal)
**Status:** Revision pass 1 (round-1 audit response, scope-cut ratified by Chris) — awaiting round-2 audit → build
**Incident:** Job 10019 (Swire CC Fllet Shop Grind & Seal), 2026-08-18
**Related:** F40 (post-send lock integrity — Schedule round-trip; stays open, NOT pulled in), B32 (draft pay-app snapshot drift; adjacent, untouched — future design note added to its row)
**Scope-cut (ratified 2026-08-18):** §4.3 re-lock reconcile is OUT of this build — deferred to §6 as a future atomic SECURITY DEFINER RPC. 9 of 14 round-1 caused-by findings traced to it; the guards below close the incident without it.

---

## §0 Reproduction (observed 2026-08-18, this session — run-verified)

**Type:** bug plan. All values below were observed live in prod, not assumed.

**Observed pre-fix state on job 10019** (DB queried via Supabase before the same-day
data repair, commit `6db76eb`):
- `proposals.total = 13740` (live WTC math) vs `billing_schedule.contract_sum = 13422`
  — the two customer-facing screens disagreed by $318.
- `billing_schedule_lines` "Grind & Seal" `scheduled_value = 8793`; live
  `calcWtcPrice()` for that WTC = 9111. Delta = exactly the WTC's
  `travel.drive_miles = 318 × drive_rate = 1` — travel added after the schedule was
  built (schedule `created_at = 2026-07-06`, WTC `updated_at = 2026-08-18`).
- `proposals.status = 'Sold'`, `internal_approval = true`, `approved_at = 2026-08-18`,
  and **all 3 `proposal_wtc` rows had `locked = false`** — a Sold proposal with zero
  locked WTCs. This state persists in prod right now (the data repair fixed the
  dollars, not the lock flags) and is re-queryable:
  `SELECT locked FROM proposal_wtc WHERE proposal_id = '1d37df8b-4877-42f1-8a10-cb93f1b37079';` → 3 × false.
- **Prod-wide count of the same state** (queried 2026-08-18): committed proposals
  carrying unlocked WTCs — Sent: 7 WTCs, Signed: 1, Sold: 13 (21 total incl. 10019's 3).
  This is the §4.3 backfill population.

**Gate-variable evidence** (the state each gate reads, read-verified at `6db76eb`):
- `handleInternalApprove` (`ProposalDetail.jsx:790`) — contains **no read of
  `wtc.locked` at all** before writing `status: "Sold"`. The Send gate's check
  (`wtcs.every(w => w.locked)`, `:918`) exists 128 lines away and is not called.
- `toggleWtcLock` (`ProposalDetail.jsx:310`) and `handleLock`
  (`WTCCalculator.jsx:2258`) — **no read of `p.status` or `billing_schedule`** on the
  unlock direction; the only pre-unlock check anywhere is the lock-direction checklist.
- The calculator's Sold/Signed read-only overlay is scoped `tab !== "summary"`
  (`WTCCalculator.jsx:2425`), and the Unlock button lives in the Summary tab
  (`:1526`) — so the guard that exists is skipped for exactly the button that matters.
- The calculator's freeze flag covers only `["Sold","Signed"]` (`:2313`) — a **Sent**
  proposal with unlocked WTCs (the literal pre-incident 10019 state) opens fully
  editable, and no unlock event ever fires on it.
- The signing door: **both** paths — `proposal-signed` edge fn (`index.ts:69`) and the
  PublicSigningPage client fallback that fires when the edge fn errors
  (`PublicSigningPage.jsx:366-383`) — converge on the `mark_proposal_signed`
  SECURITY DEFINER RPC, which flips `status='Sold'` with **no lock check**. An
  edge-fn-only guard would be bypassed by the fallback; only an RPC precondition (a
  migration, out of scope §6) or eliminating the unlocked-Sent population (§4.3
  backfill + §4.2 guards) closes this door.

**Click-path to re-trigger each gap (third-party reproducible in prod today):**
1. Any Draft/Sent proposal with unlocked WTCs → ✓ Internal Approve → fill name +
   reason → proposal becomes Sold, no lock complaint. (This is how 10019 got Sold
   on Aug 18.)
2. Any Sold proposal → EDIT WTC → Summary tab → "🔓 Unlock WTC" → unlocks with no
   warning, despite the Sold read-only banner on every other tab.
3. Any **Sent** proposal whose WTCs are already unlocked → EDIT WTC → every tab
   editable, autosave persists changes — no unlock click needed, so button guards
   alone can't cover it.

## 1. The invariant [LOCKED — Chris, 2026-08-18]

> Once a proposal is committed to a customer (Sent, Signed, or Sold), its WTC pricing is
> frozen. The only door back to editing is Pull Back, which returns the whole proposal to
> Draft. A proposal cannot *become* Sold with unlocked WTCs. When pricing legitimately
> changes before commitment, the billing schedule (SOV) must be told, not left behind.

This rule already exists in Chris's process and in F40's notes ("WTCs lock at approval").
"Told, not left behind" is satisfied in this build by the §4.2 warn naming the schedule's
dollars and pointing at the existing manual edit path — automatic repair is §6 deferred.

## 2. What happened on 10019 (why each gap is real, not theoretical)

1. Jul 6 — WTCs locked. Locking auto-created the billing schedule at **$13,422**
   (`ProposalDetail.jsx:344`, fires when all WTCs locked + customer requires pay app).
2. Someone unlocked a WTC. One silent click — no warning that a billing schedule now
   pointed at the old dollars. Proposal status was "Sent" (sent Jun 5), where the WTC
   editor is fully editable when unlocked (`WTCCalculator.jsx:2313` only makes
   Sold/Signed read-only).
3. 318 drive miles added to Grind & Seal → live price $8,793 → **$9,111**.
4. Aug 18 — **Internal Approve** marked the proposal Sold with zero lock check
   (`ProposalDetail.jsx:790` `handleInternalApprove`). Sold, unlocked, SOV stale.
5. Result: proposal summary $13,740 vs Job Detail/pay-app $13,422 — invisible until
   Chris eyeballed two screens side by side.

## 3. Current-state map (verified by grep, 2026-08-18, tip `6db76eb`; signing row corrected in revision 1)

### Ways a proposal becomes Sold/Signed
| Path | Site | Lock gate today? |
|---|---|---|
| Send Proposal button | `ProposalDetail.jsx:918` | ✅ `wtcs.length > 0 && every(locked)` |
| Send from PDF modal | `ProposalPDFModal.jsx:274-275` | ✅ same gate |
| **Internal Approve** | `ProposalDetail.jsx:790` (`handleInternalApprove`; opened from button `:908` and from PDF modal callback at the `onInternalApprove` prop on the `:833` render line) | ❌ **none — the 10019 gap** |
| **Customer signs** | `mark_proposal_signed` RPC, reached from BOTH `proposal-signed` edge fn (`index.ts:69`) AND the PublicSigningPage client fallback (`:366-383`) | ❌ **none in the RPC** — closed in this build by making unlocked-committed proposals unreachable (§4.2 freeze + §4.3 backfill); RPC precondition deferred to §6 |
| Archive import | `ArchiveProposalModal.jsx:102`, `ImportToLiveWizard.jsx:497`, `importApi.js` | N/A — archive proposals have no WTCs (by design) |

### Ways a WTC unlocks (or edits leak past the lock)
| Path | Site | Guard today? |
|---|---|---|
| Lock toggle on proposal page | `ProposalDetail.jsx:310` (`toggleWtcLock`) | ❌ none — unlocks on any status, no billing-schedule awareness |
| "Unlock WTC" in calculator Summary tab | `WTCCalculator.jsx:2258` (`handleLock`) | ❌ none — **Summary tab is exempt from the read-only overlay** (`:2425` `tab !== "summary"`) |
| Sent-with-unlocked editing (no unlock event) | `WTCCalculator.jsx:2313` freeze covers Sold/Signed only | ❌ Sent proposals fully editable when unlocked |
| Autosave | `WTCCalculator.jsx:1898-1913` + `handleSave:2191` | ❌ gated by `proposalSold` only; persists `locked:` state variable verbatim |
| + Add Work Type on committed proposal | `ProposalDetail.jsx:1034` | ❌ none — a Sold proposal can gain a WTC |
| SOW edits on committed proposal | SowTab gated by `locked` only (`:2450`) | ❌ unlocked-committed → editable |
| Pull Back | `ProposalDetail.jsx:558` | ✅ sanctioned path — blocks on live invoices, resets to Draft, clears locks + `locked_line_total` |

### Billing schedule writers (context only — NONE are edited in this build)
- Auto-create on all-locked: `ProposalDetail.jsx:344-356` (INSERT; unchanged).
- Manual lines + PDF extraction: `BillingScheduleSection.jsx` (`saveDraftAsLine`,
  `saveLineEdit`, `persistContractSum:115`) — **this is the manual reconcile path the
  §4.2 warn text points at** (unchanged).
- DB guards (verified in prod): `trg_billing_schedule_guard_money` (Admin/Manager on
  UPDATE of money cols); `billing_schedule_lines` unguarded. Recorded for the §6
  deferred RPC design; irrelevant to this build since it writes nothing to either table.

## 4. The changes

### 4.1 Internal Approve requires locked WTCs (closes the 10019 gap)

`ProposalDetail.jsx` `handleInternalApprove` (~:790), at the top, after the existing
name/reason validation:

- If `p.is_archive_proposal` → skip the gate entirely (archive proposals have no WTCs;
  their approval semantics are untouched).
- Else require `wtcs.length > 0 && wtcs.every(w => w.locked)`. On failure:
  `alert("Lock all Work Type Calculators before approving. Unlocked: <names>.")` and
  return — same standard as the Send gate, naming the offenders.
- Both approve entries route through this one handler (button `:908` and the PDF
  modal's `onInternalApprove` prop) — verified round 1; no second gate site needed.
- **Sister-cohort note (round-1 ADJ-3, verified against migration `20260519230000`):**
  `clone_proposal_to_gcs` copies sister WTCs with `locked = false` whenever the target
  has a markup override or the parent was partially locked. So the gate WILL routinely
  fire on multi-GC approvals — the approver locks the sister's WTCs first. That is
  expected behavior (locking IS the approval of the price), not a dead-end; §7 smoke
  step 6 asserts this exact flow.
- Rate-card WTCs count in the gate exactly as in the Send gate (no new semantics).

### 4.2 Committed-freeze + unlock guards (closes gaps 2 & 3, C2/C3/A1-3, E)

**One concept, applied consistently: `committed = ["Sent","Signed","Sold"].includes(status)`.**

In `WTCCalculator.jsx`:
- Replace the `proposalSold` boolean with a `committed` flag from the same fetch
  (`:2313`), keeping the raw status string in state for messages. Everything currently
  gated on `proposalSold` gates on `committed` — read-only overlay (`:2425,:2444`),
  per-tab `onChange` handlers (`:2447-2452`), autosave (`:1898`). Result: a Sent
  proposal is frozen **whether or not its WTCs happen to be unlocked** — the
  no-unlock-event leak (§0 click-path 3) closes.
- Overlay copy branches on status: Sold/Signed keep today's text; Sent reads
  "This proposal has been sent — pull it back to Draft to edit pricing."
- `handleSave` (`:2191`) short-circuit: on a committed proposal, return without
  writing (single guard at the top — covers autosave, unmount flush, and every
  manual save path in one place). It must never persist `locked: false` on a
  committed proposal.
- `handleLock` (`:2258`) — guard ordering is the round-1 Critical's sibling: the
  unlock guard runs **first**, before the `handleSave()` flush (`:2264`) and before
  `setLocked` (`:2267`), so a blocked unlock leaves both React state and DB untouched:
  - Re-fetch `status` fresh inside the handler (one query — not the mount snapshot;
    round-1 A1-3).
  - If unlocking and `committed` → block:
    `alert("This proposal is <status>. Pull it back to Draft to edit pricing — unlocking is disabled after it's been sent.")`
  - If unlocking, Draft, and a `billing_schedule` exists (`maybeSingle` on demand) →
    warn, allow:
    `confirm("This job has a billing schedule at $<contract_sum>. If you change pricing, update the schedule to match on the job's Billing Schedule section. Unlock?")`
    (Manual reconcile pointer — the automatic offer is §6 deferred; no promise made.)
  - Lock direction: allowed on any status. On a committed proposal locking is the
    *repair* action (sisters per §4.1, backfill stragglers) — it flushes no pricing
    edits because `handleSave` short-circuits; it writes only `locked` +
    `locked_line_total` + the `proposals.total` sync, same as today.
- The `:2313` fetch keeps the H6 behavior for the signing page untouched.

In `ProposalDetail.jsx`:
- `toggleWtcLock` (`:310`): same guard, same ordering (guard → alert/confirm → write).
  Status is available as `p.status` on the already-loaded proposal — still re-read
  from the fetched row, not a stale closure.
- `+ Add Work Type` (`:1034`): hidden when `committed` — a committed proposal cannot
  gain a WTC (round-1 Group E). (Change orders are their own proposals per existing
  CO model; nothing lost.)
- No `teamMember` threading — that existed only for the cut §4.3.

### 4.3 Ship-time backfill: re-lock the existing unlocked-committed population (C1)

The sign door (§3) stays ungated in this build, so the Sent/Signed rows that could
still walk through it unlocked must be repaired at ship:

- Population (§0): 21 unlocked WTCs on committed proposals (7 Sent / 1 Signed /
  13 Sold, incl. 10019's 3). Re-query at deploy time; the count moves.
- Mechanics: locking is not a bare flag — it must stamp `locked_line_total`
  (`calcWtcPrice` result), which is client-side math the H6 signing-page RPC reads.
  So the backfill is a **Node script reusing `src/lib/calc.js`** (same math as
  `handleLock`), authenticated as Chris's admin user (mint user JWT via GoTrue —
  established backfill pattern), writing `locked = true, locked_line_total = <computed>`
  per WTC and syncing each proposal's `total`.
- Executed at the **deploy gate** (buildvsplan → deploy terminal), NOT by the build
  session. Script lands in `scripts/` on this branch with a dry-run mode (prints
  per-WTC computed totals, writes nothing) — dry-run output is reviewed before the
  live run.
- Post-ship invariant: §4.1 + §4.2 make new unlocked-committed rows unreachable via
  the UI, so the sign door never again sees one. The RPC-level precondition stays in
  §6 with reopen trigger "any post-ship row appears where status ∈ committed and a
  WTC is unlocked" (detectable by re-running the §0 count query).

### 4.4 UI (layout section — per plan standard)

No new screens, no layout changes. Gates surface through the existing alert/confirm
vocabulary (matching every guard in these files). The calculator's read-only overlay
and banner are reused with the new Sent wording; the amber "In Progress" / green
"Locked" card states are untouched. No new colors or components (Style Rules
untouched). `fmt$`, no cents, in the schedule warn.

## 5. Blast radius — the triple-confirm (updated for revision 1)

Every consumer of the touched concepts, traced at `6db76eb`. **"Untouched" means the
build must not edit that site and the audit should flag any diff that does.**

### Sites this build EDITS (complete list)
| Site | Change |
|---|---|
| `ProposalDetail.jsx` `handleInternalApprove` | gate prepended (§4.1) |
| `ProposalDetail.jsx` `toggleWtcLock` | unlock guard prepended (§4.2) |
| `ProposalDetail.jsx` `:1034` + Add Work Type | hidden when committed (§4.2) |
| `WTCCalculator.jsx` `proposalSold` → `committed` (+ status string) | freeze broadened to Sent (§4.2) |
| `WTCCalculator.jsx` `handleSave` | committed short-circuit at top (§4.2) |
| `WTCCalculator.jsx` `handleLock` | guard-first ordering + fresh status fetch (§4.2) |
| `scripts/` backfill script (new file) | §4.3 — deploy-gate execution only |

### Consumers of `proposal_wtc.locked` — verdicts
| Site | Verdict |
|---|---|
| `ProposalDetail.jsx:520,913,918,940-984` (checklist %, clone gate, Send gate, card styling) | Untouched reads |
| `ProposalPDFModal.jsx:274-275` send gate | Untouched |
| `WTCCalculator.jsx` overlay / SOW readOnly / PDF gate `:1541` | Overlay + SOW re-keyed to `committed ∥ locked` (§4.2); PDF gate untouched |
| `Invoices.jsx` "locked" hits (QB/amount locks, `linkedPayApp`) | Different concept — untouched |
| `BillingScheduleSection.jsx:23,68` (SCHEDULE lock — name collision) | Untouched |

### Consumers of `locked_line_total`
| Site | Verdict |
|---|---|
| H6 signing RPC, `PublicSigningPage.jsx`, `PublicInvoicePage.jsx` | Untouched code. §4.2 blocked-unlock keeps snapshots alive on committed proposals (strictly safer); §4.3 backfill POPULATES it for 21 currently-null WTCs — signing pages that today would show a null-total line start showing the computed total (behavior improvement; smoke step 9 eyeballs one) |
| Pull Back clears it (`ProposalDetail.jsx:570`) | Untouched — still the sanctioned clear |

### Sold/Signed writers
| Site | Verdict |
|---|---|
| `handleInternalApprove` | Gated (§4.1) — the ONLY status-writer edited. QB job creation, notify trigger, sister-cohort branch all unchanged after the gate |
| `mark_proposal_signed` RPC + `proposal-signed` edge fn + PublicSigningPage fallback | **Untouched** — no edge fn deploys, no migrations. Door closed by population repair (§4.3) + unreachability (§4.1/4.2); RPC precondition parked §6 |
| Archive/import paths | Untouched — archive exempt from the gate |

### Billing schedule
**This build writes nothing to `billing_schedule` or `billing_schedule_lines`** (the
round-1 reconcile is cut). Auto-create INSERT (`:344`) is preserved verbatim inside
`toggleWtcLock` — the audit verifies the prepended guard cannot reorder or skip it on
the lock direction. Manual editing (`BillingScheduleSection`) untouched and now
load-bearing as the reconcile path named in the §4.2 warn.

### Flows deliberately NOT changed (regression tripwires for round 2)
1. **Pull Back** — byte-identical; referenced by new messages, not edited.
2. **Send Proposal / Send to Customer** — gates already correct; no edits.
3. **Send to Schedule** + everything F40 covers — out of scope, untouched.
4. **Multi-GC clone** — untouched; §4.1 note + smoke step 6 set the sister
   expectation (arrive unlocked → approver locks → approve passes).
5. **Archive proposals** — exempt everywhere.
6. **Edge functions / RPCs / migrations** — zero touched, zero deployed.
7. **`proposals.total` → `trg_sync_job_amount` → Schedule Command `jobs.amount`** —
   the total-sync writes in `handleLock`/`toggleWtcLock` are preserved verbatim;
   audit verifies guard placement cannot skip them on a *successful* lock. (Known
   divergence when a schedule is stale is ADJ-2, filed in BACKLOG — not this build.)
8. **`handleSave`'s sibling-sync + total-sync** — the committed short-circuit returns
   before ALL writes; on non-committed proposals every existing write runs unchanged.

## 6. Out of scope (named, with the user-trigger that would reopen them)
- **Automatic SOV reconcile on re-lock** (round-1 §4.3, cut by ratified scope-cut
  2026-08-18): when built, it is ONE atomic SECURITY DEFINER RPC (command-suite-db
  migration + rehearsal) that classifies the line-mapping up front and moves
  `contract_sum` + lines in a single transaction, gated on **submitted/paid** pay apps
  only (ADJ-1 — drafts must not block it). Reopen trigger: schedule drift recurs
  after §4.1/§4.2 ship.
- **Lock precondition inside `mark_proposal_signed`** (RPC migration): reopen trigger
  — any post-ship row where status ∈ committed and a WTC is unlocked (§0 count query
  returns > 0 on a proposal not in the backfill set).
- **DB-level freeze** (trigger blocking `proposal_wtc` money-column UPDATE when
  locked/committed): reopen when client-side enforcement proves insufficient.
- **F40's three seams** — separate loop, unchanged priority.
- **B32** — unchanged; its row gains the ADJ-1 design note for the future reconcile.
- **Calculator-side schedule auto-create** — asymmetry left as-is.

## 7. Smoke plan (preview deploy, before merge)
1. **10019 regression:** proposal page → Unlock on a WTC → blocked with pull-back
   message (Sold). Calculator Summary tab → Unlock → same block.
2. Any **Sent** proposal → EDIT WTC → every tab read-only with the Sent banner; no
   autosave write lands (confirm `updated_at` unchanged after opening/closing).
3. Draft proposal WITH billing schedule → unlock → confirm names the schedule dollars
   and points at the Billing Schedule section → accept → unlock proceeds. Edit price,
   re-lock → NO automatic schedule change (verify contract_sum untouched) — manual
   edit on the Billing Schedule section still works.
4. Internal Approve with one unlocked WTC → blocked, names the WTC; lock it →
   approve succeeds; QB job + rep notification still fire.
5. Archive proposal → Internal Approve unaffected.
6. **Multi-GC sister:** clone → sister's WTCs arrive unlocked (expected) → approve
   blocked → lock sister WTCs → approve passes as Signed.
7. Committed proposal → + Add Work Type button absent; Draft → present.
8. Send Proposal, Pull Back, Send to Schedule: click through unchanged flows — no
   behavior difference; after Pull Back (→ Draft), editing and unlocking work freely.
9. **Backfill (at deploy gate):** dry-run output reviewed → live run → §0 count query
   returns 0 → open one backfilled Sent proposal's signing link → totals render.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-18 (round 2). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Round 2 on a smaller, safer plan: the risky auto-update of billing-schedule dollars
was cut, so this build now only adds gates and a freeze — it writes nothing to the
schedule at all. Three reviewers: one proving the new gates actually fire on real
paths, one hunting leftover ways a job can go Sold unlocked, one re-checking the
break-nothing promises now that the freeze covers more of the calculator.

### Round
- Plan type: bug
- Current round: 2
- Plan revision under audit: (revision pass 1 commit — see git log)
- Findings trend: round 1 (17: 1C/2H/1M/1L caused-by groups + 3 adjacent) → 2 (?) —
  round-1 pattern was reconcile-over-engineered; the mechanism driving 64% of findings
  is now cut, so round 2 at or above 17 would signal new scope creep, not progress

### Prior rounds
- Round 1: manifest `1f0591e`, plan `b98ba7c` · 1C/2H/1M/1L (5 caused-by groups, 3 adjacent) · pattern: reconcile-over-engineered

**Briefing for agents**: do NOT re-find round-1 findings. Groups A/B/D dissolved with
the §4.3 cut (nothing writes to billing_schedule anymore — confirm that stays true in
the spec, then move on). Group C (invariant leaks) and Group E (structure edits) are
now IN the plan as §4.2/§4.3 — attack the *specs* for them, not their absence. ADJ-1/
ADJ-2 are filed in BACKLOG; ADJ-3 is integrated into §4.1. Attack ONLY material new
to this revision: the `committed` freeze semantics, the guard-first ordering, the
handleSave short-circuit, and the backfill script contract.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked
- **Prod / staging / dev**: prod, daily use (proposal lock/approve/sign)
- **Blocking feature flags**: `customers.requires_pay_app` gates schedule auto-create;
  irrelevant to most of the kept scope (freeze applies to all proposals)
- **Concurrency profile**: ≤5 concurrent users

Cross-tenant findings cap at Med while live_tenants == 1. Multi-user race findings cap
at Low at this concurrency.

### Time budget + finding cap
- **Time budget**: 180 min (kept scope shrank — two files + one script; revised from 240)
- **Finding cap**: 18 findings

### Surface
- Total lines: ~300 incl. manifest
- Sections: 8 (§0–§7)
- [LOCKED] decisions: 2 (§1 invariant; scope-cut ratification in header)
- [DESIGN-OPEN] items: 0
- [OPEN] items: 0
- Plan-to-code ratio: ~300 : ~140 est code lines ≈ 2:1 — acceptable for round 2

### Layers touched
- UI / components (gates, freeze overlay, button visibility)
- State model (committed flag semantics; status × lock interplay)
- Data script (one-shot backfill writing `locked` + `locked_line_total` + `total`)

### New mechanisms introduced
- `committed` flag replacing `proposalSold` (broadened freeze — §4.2)
- Guard-first ordering contract in `handleLock`/`toggleWtcLock` (§4.2)
- `handleSave` committed short-circuit (§4.2)
- Backfill script reusing `src/lib/calc.js` with dry-run mode (§4.3)

### Cross-system reach
- `trg_sync_job_amount`: `proposals.total` writes in the edited handlers AND the
  backfill script propagate to Schedule Command `jobs.amount` — verify preserved
  timing on success paths and sane values from the backfill.
- H6 signing RPC reads `locked_line_total` — backfill populates 21 currently-null
  snapshots; verify the computed values match what `handleLock` would have written.

### Irreversibility
- Backfill flips 21 WTCs to locked and stamps snapshots — reversible in principle
  (flags can be cleared) but it changes what live signing pages display; dry-run
  review is the control. Everything else reversible; zero migrations.

### Known weak points
- `handleSave` short-circuit is load-bearing for the whole freeze: any *legitimate*
  write on committed proposals routed through `handleSave` today would be silently
  dropped — agents enumerate `handleSave` callers and confirm none is a sanctioned
  committed-state write (the §4.2 claim is "there are none"; falsify it).
- Lock-direction-on-committed remains allowed (repair path). Verify the lock flow on a
  committed proposal cannot smuggle pricing edits (it calls `handleSave` first — which
  now short-circuits — confirm `locked_line_total` is then computed from FETCHED rows,
  not from possibly-edited local React state).
- The `committed` fetch (`:2313`) is still a mount-time snapshot for the overlay
  (only `handleLock` re-fetches) — a proposal Sent *while the calculator is open*
  stays editable until remount. Weight per concurrency profile.
- Backfill computes `locked_line_total` OUTSIDE the app (Node + calc.js): exact-pricing
  era flag (`usesExactPricing`) and rate-card exclusions must match `handleLock`'s
  math or the signing page shows different totals than the app would have stamped.
- `+ Add Work Type` hidden on committed — confirm no legitimate flow adds a WTC to a
  Sent proposal today (e.g. pre-send additions after an early send).

### Open questions
- Count: 1
- Highest-pressure: does any current workflow deliberately edit a Sent proposal's SOW
  text (not price) before signing? The committed freeze now blocks SOW edits on Sent —
  if that was a real workflow, it needs Chris's explicit OK (flag to Chris, don't
  assume).

### Suggested attack angles (3 total)
1. **User-path state trace (freeze + gates)** — covers UI + state model. Required
   reading: `WTCCalculator.jsx` (:1890-1915, :2185-2320, :2420-2455),
   `ProposalDetail.jsx` (:310-360, :790-830, :900-920, :1034). Specific pressure:
   for each guard, prove ordering (guard before ANY write incl. the `:2264` flush and
   `setLocked`); enumerate `handleSave` callers vs the short-circuit; trace `committed`
   freshness at every gate firing; verify lock-direction repair writes only
   lock/snapshot/total from fetched rows.
2. **State-model completeness (residual leaks)** — covers the invariant post-revision.
   Required reading: §3 tables, `mark_proposal_signed` call sites (read-only),
   migration `20260519230000` (clone lock semantics). Specific pressure: enumerate
   remaining paths to Sold-with-unlocked (sign door between deploy and backfill,
   backfill misses, imports, direct DB); attack the §4.3 unreachability argument and
   the backfill script contract (era flag, rate cards, dry-run parity).
3. **Regression tripwires** — covers §5 promises. Required reading: §5 edited-sites
   table + tripwire list. Specific pressure: falsify "billing schedule untouched,"
   "auto-create preserved verbatim," "total-sync timing preserved," "Pull Back
   byte-identical"; probe the broadened freeze for collateral damage (Sent SOW-edit
   workflow, PDF generation on Sent, archive panel, F40 seams).

### Suggested agent count: 3

Rationale: kept scope dropped a full layer (no schedule writes) and the round-1
pattern is resolved by cut rather than patch, so 3 focused angles cover the two files
+ script without overlap; not 2 because the freeze semantics are genuinely new surface
this round.
