# Lock-at-Sold Enforcement

**Repo:** sales-command · **Branch:** `feat/lock-at-sold` · **Drafted:** 2026-08-18 (T1 plan terminal)
**Status:** Revision pass 2 (round-2 audit response) — awaiting round-3 confirm pass → build
**Incident:** Job 10019 (Swire CC Fllet Shop Grind & Seal), 2026-08-18
**Related:** F40 (post-send lock integrity; stays open, NOT pulled in), B32 (draft pay-app snapshot drift; ADJ-1 design note on its row), B70 (jobs.amount vs contract_sum divergence, ADJ-2)
**Scope-cut (ratified 2026-08-18):** §4.3 re-lock reconcile is OUT — deferred to §6 as a future atomic SECURITY DEFINER RPC.
**Round-2 ratifications (Chris, 2026-08-18):** (1) backfill PRESERVES `proposals.total` on Sold/Signed rows — recompute only Sent; (2) **SOW carve-out** — Field SOW definitely, Sales SOW too, stay editable on committed proposals; pricing freeze does not cover SOW text.

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

**Amendment 1 (round-2 audit, Chris-ratified 2026-08-18) — scope of "pricing":**
SOW text is NOT part of the freeze. Field SOW is routinely edited after a proposal is
sent (crew planning is operational, not contractual), and Sales SOW may get wording/
room edits before signing. The freeze covers dollar-bearing fields (labor, materials,
travel, discount, rates, size/unit); `sales_sow`, `field_sow`, and `sub_areas` remain
editable on committed proposals via a SOW-only save path (§4.2).

**Amendment 2 (round-2 finding E) — known bypass, honestly stated:** the invariant is
enforced client-side only in this build. The `apply_source_edit_to_sisters`
SECURITY DEFINER RPC (migration `20260519230000:236-300`) UPDATEs pricing fields on
Sent/Signed sisters and overwrites their `locked_line_total` — a non-UI write the
client freeze cannot see. It never unlocks (the sign door stays closed) but can
reintroduce 10019-class drift on a committed sister. This is the concrete case the
deferred §6 DB-level freeze must cover; "frozen" in this build means "frozen against
every UI path."

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

## 3. Current-state map (verified by grep, 2026-08-18, tip `6db76eb`; signing row corrected rev 1, sister-sync row added rev 2)

### Ways a proposal becomes Sold/Signed
| Path | Site | Lock gate today? |
|---|---|---|
| Send Proposal button | `ProposalDetail.jsx:918` | ✅ `wtcs.length > 0 && every(locked)` |
| Send from PDF modal | `ProposalPDFModal.jsx:274-275` | ✅ same gate |
| **Internal Approve** | `ProposalDetail.jsx:790` (`handleInternalApprove`; opened from button `:908` and from PDF modal's `onInternalApprove` prop on the `:833` render line) | ❌ **none — the 10019 gap** |
| **Customer signs** | `mark_proposal_signed` RPC, reached from BOTH `proposal-signed` edge fn (`index.ts:69`) AND the PublicSigningPage client fallback (`:366-383`) | ❌ **none in the RPC** — closed in this build by making unlocked-committed proposals unreachable (§4.2 freeze + §4.3 backfill, sequenced backfill-first); RPC precondition deferred to §6 |
| Archive import | `ArchiveProposalModal.jsx:102`, `ImportToLiveWizard.jsx:497`, `importApi.js` | N/A — archive proposals have no WTCs (by design) |

### Ways a WTC unlocks (or edits leak past the lock)
| Path | Site | Guard today? |
|---|---|---|
| Lock toggle on proposal page | `ProposalDetail.jsx:310` (`toggleWtcLock`) | ❌ none — unlocks on any status, no billing-schedule awareness |
| "Unlock WTC" in calculator Summary tab | `WTCCalculator.jsx:2258` (`handleLock`) | ❌ none — **Summary tab is exempt from the read-only overlay** (`:2425` `tab !== "summary"`) |
| Sent-with-unlocked editing (no unlock event) | `WTCCalculator.jsx:2313` freeze covers Sold/Signed only | ❌ Sent proposals fully editable when unlocked |
| Autosave | `WTCCalculator.jsx:1898-1913` + `handleSave:2191` | ❌ gated by `proposalSold` only; persists `locked:` state variable verbatim |
| + Add Work Type on committed proposal | `ProposalDetail.jsx:1034` | ❌ none — a Sold proposal can gain a WTC |
| Sister-sync RPC `apply_source_edit_to_sisters` | migration `20260519230000:236-300`, SECURITY DEFINER | ❌ UPDATEs pricing + `locked_line_total` on Sent/Signed sisters — bypasses ANY client freeze (§1 Amendment 2; §6) |
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
- **Sister-cohort note (ADJ-3, verified against migration `20260519230000`):**
  `clone_proposal_to_gcs` copies sister WTCs with `locked = false` whenever the target
  has a markup override or the parent was partially locked. The gate WILL routinely
  fire on multi-GC approvals — the approver locks the sister's WTCs first. Expected
  behavior, not a dead-end; §7 smoke step 6 asserts this flow.
- Rate-card WTCs count in the gate exactly as in the Send gate (no new semantics).

### 4.2 Committed-freeze + unlock guards (C2/C3/A1-3, E, D, F + SOW carve-out)

**One concept: `isCommitted = ["Sent","Signed","Sold"].includes(status)`.**
(Named `isCommitted`, NOT `committed` — a block-scoped `const committed` already
exists at `WTCCalculator.jsx:1239` and must not be shadowed. Round-2 F.)

In `WTCCalculator.jsx`:
- Replace the `proposalSold` boolean with `isCommitted` from the same fetch (`:2313`),
  keeping the raw status string in state for messages. Gate on it: read-only overlay,
  per-tab `onChange` handlers for the PRICING tabs (bidding, labor, materials, travel,
  discount — `:2447-2452` except `:2450`), autosave (`:1898`). Result: a Sent proposal's
  pricing is frozen whether or not its WTCs are unlocked (§0 click-path 3 closes).
- **Overlay scope (round-2 F, honest mechanics):** the SOW tab (`:2450`) has NO
  `proposalSold` token today — its freeze was only ever the overlay div (`:2444`) +
  the save path. With the SOW carve-out the overlay now applies when
  `isCommitted && !["summary","sow"].includes(tab)`. Do NOT add an `isCommitted` gate
  to SowTab's `onChange` — SOW stays interactive. (Known pre-existing limit: the
  overlay intercepts pointer, not keyboard focus — unchanged in this build, noted.)
- **SOW carve-out (Chris-ratified):** on a committed proposal, the SOW tab is editable
  **even when the WTC is locked** (today's `locked → readOnly` Textarea behavior
  applies only when NOT committed — on Draft, unlock first as usual, since unlock is
  free there). Saving SOW on a committed proposal goes through a new
  **`saveSowOnly()`** partial update writing ONLY `sales_sow`, `field_sow`,
  `sub_areas` — never the full `handleSave` payload, so pricing cannot ride along.
  `size`/`unit` stay frozen (price-adjacent; a room change that alters size is a
  pricing change → Pull Back). The SowTab "Save" button routes to `saveSowOnly` when
  `isCommitted`, to `handleSave` otherwise.
- `handleSave` (`:2191`) short-circuit: on a committed proposal, return without
  writing — covers autosave, unmount flush, and every manual full-save path. It must
  never persist `locked: false` on a committed proposal. (`saveSowOnly` is the ONLY
  committed-state write, and it touches no pricing or lock columns.)
  **Known accepted limit:** the short-circuit reads the mount-time `isCommitted` —
  a proposal committed *while the calculator is open* stays editable until remount.
  Accepted at ≤5-user concurrency; do not claim the short-circuit covers this.
- `handleLock` (`:2258`) — guard-first ordering, and **direction-scoped (round-2 D,
  pinned as code, not prose):** the early-return condition is exactly
  `if (!newLocked && <blocked>) return;` — **never a bare `if (isCommitted)`** — so
  the LOCK direction always proceeds (it is the repair path for sisters and backfill
  stragglers, and it must still fire the `proposals.total` sync). Ordering: guard runs
  before the `handleSave()` flush (`:2264`) and before `setLocked` (`:2267`); a
  blocked unlock leaves React state and DB untouched.
  - Re-fetch `status` fresh inside the handler (one query — not the mount snapshot).
  - Unlocking + committed → block:
    `alert("This proposal is <status>. Pull it back to Draft to edit pricing — unlocking is disabled after it's been sent.")`
  - Unlocking + Draft + `billing_schedule` exists (`maybeSingle` on demand) → warn,
    allow: `confirm("This job has a billing schedule at $<contract_sum>. If you change pricing, update the schedule to match on the job's Billing Schedule section. Unlock?")`
  - Lock direction on a committed proposal: flushes nothing (`handleSave`
    short-circuits); computes `locked_line_total` from the freshly FETCHED row (as
    today, `:2285` reads `allWtcs` from the DB query, not local edit state) and runs
    the `proposals.total` sync as today.

In `ProposalDetail.jsx`:
- `toggleWtcLock` (`:310`): same direction-scoped guard, same ordering
  (`!newLocked && …` — the lock direction must still reach the auto-create at `:345`
  and the total sync).
- `+ Add Work Type` (`:1034`): hidden when committed — a committed proposal cannot
  gain a WTC. (Change orders are their own proposals; nothing lost.)
- No `teamMember` threading (only the cut reconcile needed it).

### 4.3 Ship-time backfill: re-lock the existing unlocked-committed population (C1)

The sign door (§3) stays ungated in this build, so the Sent/Signed rows that could
still walk through it unlocked must be repaired — **before the code ships**:

- **Sequence (round-2 A):** the backfill runs BEFORE the UI deploy goes live. The
  deploy gate is: §0 count query returns 0 → then promote the build. The 8
  Sent/Signed rows hold live signing tokens; running the script after deploy leaves a
  window where a customer signature recreates the incident state. Backfill first,
  always.
- Population (§0): 21 unlocked WTCs on committed proposals (7 Sent / 1 Signed /
  13 Sold). Re-query at run time; the count moves.
- **Selection (bf-1):** per-WTC WHERE — `proposal_wtc.locked = false` joined to
  proposals with `status IN ('Sent','Signed','Sold') AND deleted_at IS NULL` — so
  partially-locked proposals get only their unlocked rows touched. Archive proposals
  have zero WTCs and fall out naturally; the script asserts it selected zero
  `is_archive_proposal` rows anyway.
- **Math parity (round-2 B):** the script reuses `src/lib/calc.js` and must byte-match
  what `handleLock`/`toggleWtcLock` would write:
  - SELECT includes the proposal's pricing-era columns (`created_at`,
    `pricing_anchor_at`) and calls `usesExactPricing(proposal)` per row — omitting
    them silently defaults the era and mis-rounds penny-window proposals by up to
    $1/line on a signed contract's public page.
  - `markup_override_pct` is passed as `undefined` — exactly as both lock paths do —
    never the sister's proposal-level override.
  - Dry-run prints, per proposal: the resolved era flag and per-WTC computed
    `locked_line_total`.
- **Writes (Chris-ratified X + full disclosure):** per selected WTC:
  `locked = true`, `locked_line_total = <computed>`. Per proposal: `proposals.total`
  is **recomputed ONLY for Sent rows** (matching what a lock in the app would do);
  **Sold and Signed rows keep their existing `total` untouched** — a signed
  contract's number is immutable, and skipping the write avoids mass-firing
  `trg_sync_job_amount` → Schedule Command `jobs.amount` across 13 sold jobs.
  The trigger therefore fires only for the ≤7 Sent proposals.
- **Run protocol (bf-2):** dry-run → human review → live run back-to-back; the live
  run asserts each target WTC's `updated_at` is unchanged since the dry-run snapshot
  (catches an edit landing between runs — the trigger side effects are never
  exercised in dry-run, so parity depends on nothing moving).
- Executed at the **deploy gate** (buildvsplan → deploy terminal), NOT by the build
  session. Script lands in `scripts/` on this branch, authenticated as Chris's admin
  user (mint user JWT via GoTrue — established backfill pattern).
- Post-ship invariant: §4.1 + §4.2 make new unlocked-committed rows unreachable via
  the UI (sister-sync RPC excepted — §1 Amendment 2). The RPC-level sign-door
  precondition stays in §6 with reopen trigger "§0 count query > 0 post-ship."

### 4.4 UI (layout section — per plan standard)

No new screens, no layout changes. Gates surface through the existing alert/confirm
vocabulary. The calculator's read-only overlay and banner are reused with the new
Sent wording ("This proposal has been sent — pull it back to Draft to edit pricing;
scope of work stays editable on the SOW tab."); the SOW tab shows a thin notice line
when committed: "Pricing is locked — SOW edits save without touching price." Amber
"In Progress" / green "Locked" card states untouched. No new colors or components.
`fmt$`, no cents, in the schedule warn.

## 5. Blast radius — the triple-confirm (updated rev 2)

### Sites this build EDITS (complete list)
| Site | Change |
|---|---|
| `ProposalDetail.jsx` `handleInternalApprove` | gate prepended (§4.1) |
| `ProposalDetail.jsx` `toggleWtcLock` | direction-scoped unlock guard prepended (§4.2) |
| `ProposalDetail.jsx` `:1034` + Add Work Type | hidden when committed (§4.2) |
| `WTCCalculator.jsx` `proposalSold` → `isCommitted` (+ status string) | freeze broadened to Sent; SOW tab exempted (§4.2) |
| `WTCCalculator.jsx` `handleSave` | committed short-circuit at top (§4.2) |
| `WTCCalculator.jsx` NEW `saveSowOnly` | SOW-only partial update on committed (§4.2) |
| `WTCCalculator.jsx` `handleLock` | guard-first, direction-scoped, fresh status fetch (§4.2) |
| `scripts/` backfill script (new file) | §4.3 — deploy-gate execution only |

### Backfill writes (full disclosure — round-2 C)
`proposal_wtc.locked`, `proposal_wtc.locked_line_total` (21 rows);
`proposals.total` on Sent rows only (≤7) → `trg_sync_job_amount` fires for those only.
Sold/Signed totals untouched. Nothing else written.

### Consumers of `proposal_wtc.locked` — verdicts
| Site | Verdict |
|---|---|
| `ProposalDetail.jsx:520,913,918,940-984` (checklist %, clone gate, Send gate, card styling) | Untouched reads |
| `ProposalPDFModal.jsx:274-275` send gate | Untouched |
| `WTCCalculator.jsx` overlay / PDF gate `:1541` | Overlay re-keyed to `isCommitted` w/ SOW exemption (§4.2); PDF gate untouched |
| SowTab `locked → readOnly` Textarea | Behavior change BY DESIGN on committed proposals only (carve-out); Draft behavior unchanged |
| `Invoices.jsx` "locked" hits (QB/amount locks) | Different concept — untouched |
| `BillingScheduleSection.jsx:23,68` (SCHEDULE lock — name collision) | Untouched |

### Consumers of `locked_line_total`
| Site | Verdict |
|---|---|
| H6 signing RPC, `PublicSigningPage.jsx`, `PublicInvoicePage.jsx` | Untouched code. §4.3 backfill POPULATES 21 currently-null snapshots with era-correct math (round-2 B); signing pages that today show a null-total line start showing the computed total; smoke step 9 eyeballs one |
| Pull Back clears it (`ProposalDetail.jsx:570`) | Untouched — still the sanctioned clear |
| Sister-sync RPC overwrites it | Pre-existing bypass, NOT changed by this build — §1 Amendment 2, §6 |

### Sold/Signed writers
| Site | Verdict |
|---|---|
| `handleInternalApprove` | Gated (§4.1) — the ONLY status-writer edited. QB job creation, notify trigger, sister branch unchanged after the gate |
| `mark_proposal_signed` RPC + edge fn + fallback | Untouched — door closed by backfill-first sequencing (§4.3) + unreachability (§4.1/4.2); RPC precondition parked §6 |
| Archive/import paths | Untouched — archive exempt |

### Billing schedule
**This build writes nothing to `billing_schedule` or `billing_schedule_lines`.**
Auto-create INSERT (`:344`) preserved verbatim inside `toggleWtcLock` — reachable
because the guard is direction-scoped (`!newLocked && …`, §4.2/round-2 D); the audit
verifies that exact condition. Manual editing (`BillingScheduleSection`) untouched
and load-bearing as the named reconcile path.

### Flows deliberately NOT changed (regression tripwires for round 3)
1. **Pull Back** — byte-identical; referenced by new messages, not edited.
2. **Send Proposal / Send to Customer** — gates already correct; no edits.
3. **Send to Schedule** + everything F40 covers — untouched. (Note: Field SOW edits
   on committed proposals via `saveSowOnly` flow to Field through the existing
   manual Send-to-Schedule path — no new sync obligation created here.)
4. **Multi-GC clone + sister-sync RPC** — untouched; sisters arrive unlocked
   (§4.1 note); the RPC's freeze bypass is documented (§1 Amendment 2), not fixed.
5. **Archive proposals** — exempt everywhere.
6. **Edge functions / RPCs / migrations** — zero touched, zero deployed.
7. **`proposals.total` → `trg_sync_job_amount` → Schedule Command `jobs.amount`** —
   handler total-sync writes preserved verbatim on the lock direction; backfill fires
   it for Sent rows only.
8. **`handleSave`'s sibling-sync + total-sync** — the committed short-circuit returns
   before ALL writes; on non-committed proposals every existing write runs unchanged.
   `saveSowOnly` performs none of these syncs (SOW columns don't affect price).

## 6. Out of scope (named, with the user-trigger that would reopen them)
- **Automatic SOV reconcile on re-lock** (round-1 cut): when built, ONE atomic
  SECURITY DEFINER RPC (command-suite-db migration + rehearsal), mapping classified
  up front, `contract_sum` + lines in a single transaction, gated on
  **submitted/paid** pay apps only (ADJ-1 on B32). Reopen trigger: schedule drift
  recurs after this build ships.
- **Lock precondition inside `mark_proposal_signed`** (RPC migration): reopen trigger
  — §0 count query > 0 on any proposal outside the backfill set, post-ship.
- **DB-level freeze** (trigger blocking `proposal_wtc` money-column UPDATE when
  locked/committed): the sister-sync RPC bypass (§1 Amendment 2, round-2 ADJ-E) is
  the concrete case it must cover — the trigger must either gate that RPC's writes or
  the RPC must be amended with it. Reopen when client-side enforcement proves
  insufficient OR when sister drift is observed.
- **F40's three seams** — separate loop, unchanged priority.
- **B32 / B70** — unchanged; future reconcile design notes live on their rows.
- **Calculator-side schedule auto-create** — asymmetry left as-is.
- **Overlay keyboard-focus gap** — pre-existing; fold into any future freeze hardening.

## 7. Smoke plan (preview deploy, before merge; backfill smoke at deploy gate)
1. **10019 regression:** proposal page → Unlock on a WTC → blocked with pull-back
   message (Sold). Calculator Summary tab → Unlock → same block.
2. Any **Sent** proposal → EDIT WTC → pricing tabs read-only with the Sent banner;
   no autosave write lands (confirm `updated_at` unchanged after open/close).
3. **SOW carve-out:** same Sent proposal → SOW tab editable → edit Field SOW → save →
   reload: SOW persisted, `updated_at` moved, but pricing fields + `locked` +
   `proposals.total` byte-identical. Repeat with Sales SOW wording change.
4. Draft proposal WITH billing schedule → unlock → confirm names the schedule dollars
   and points at the Billing Schedule section → accept → unlock proceeds; re-lock →
   NO automatic schedule change; manual schedule edit still works.
5. Internal Approve with one unlocked WTC → blocked, names the WTC; lock it →
   approve succeeds; QB job + rep notification still fire.
6. **Multi-GC sister:** clone → sister's WTCs arrive unlocked (expected) → approve
   blocked → lock sister WTCs (verify auto-create/total-sync still fire on this
   lock — the direction-scoped guard) → approve passes as Signed.
7. Committed proposal → + Add Work Type absent; Draft → present. Archive proposal →
   Internal Approve unaffected.
8. Send Proposal, Pull Back, Send to Schedule: unchanged flows — no behavior
   difference; after Pull Back (→ Draft), editing and unlocking work freely.
9. **Backfill (deploy gate, BEFORE promoting the UI build):** dry-run prints per-row
   era flag + computed totals → review → live run (asserts `updated_at` parity and
   zero archive rows) → §0 count query returns 0 → open one backfilled Sent
   proposal's signing link → totals render, Sold/Signed `proposals.total` unchanged →
   THEN promote the deploy.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-18 (round 3). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Confirm pass on a converging plan. Round 2's findings were all spec-tightenings on the
cleanup script and two code details — all now pinned in the plan — plus one new piece:
Chris ratified keeping scope-of-work text editable on sent jobs, which adds one small
new save path. Two reviewers: one verifies the round-2 fixes landed exactly as
specified, one attacks the only genuinely new mechanism (the SOW-only save).

### Round
- Plan type: bug
- Current round: 3
- Plan revision under audit: (revision pass 2 commit — see git log)
- Findings trend: round 1 (17: 1C/2H/1M/1L) → round 2 (12: 0C/2H/2M/2L) → 3 (?) —
  declining, near-converged. Round-2 pattern (backfill-contract) resolved by pinning
  the contract in §4.3. A round-3 count above ~6 signals the SOW carve-out introduced
  real new surface; at or below, ship it.

### Prior rounds
- Round 1: manifest `1f0591e`, plan `b98ba7c` · 1C/2H/1M/1L (+3 adjacent) · pattern: reconcile-over-engineered → resolved by ratified scope-cut
- Round 2: manifest/plan `2e9e98d` · 0C/2H/2M/2L (+1 adjacent, 2 assertions) · pattern: backfill-contract → resolved by §4.3 contract pinning (sequence-first, era parity, preserve-signed-totals, bf-1/bf-2 assertions) + §4.2 direction-scoping (D) + honest SOW mechanics (F) + §1 Amendment 2 (ADJ-E)

**Briefing for agents**: do NOT re-find round-1/round-2 findings — each is integrated
at the cited section. Attack ONLY: (a) whether the round-2 integrations are internally
consistent as now written, and (b) the NEW SOW carve-out (`saveSowOnly`, overlay SOW
exemption, locked-Textarea override on committed) — the one mechanism no prior round
saw. The sister-sync bypass is documented-accepted (§1 Amendment 2), not a finding.

### Deployment context
- **Live tenants**: 1 — HDSP only
- **Prod / staging / dev**: prod, daily use
- **Blocking feature flags**: none relevant to kept scope
- **Concurrency profile**: ≤5 concurrent users
Severity caps as prior rounds (cross-tenant ≤ Med, races ≤ Low).

### Time budget + finding cap
- **Time budget**: 90 min (confirm pass on integrated revisions + one new mechanism)
- **Finding cap**: 9 findings

### Surface
- Total lines: ~340 incl. manifest
- Sections: 8 (§0–§7)
- [LOCKED] decisions: 2 + 2 amendments (§1 + header ratifications)
- [DESIGN-OPEN] / [OPEN] items: 0
- Plan-to-code ratio: ~340 : ~170 est code lines ≈ 2:1

### Layers touched
- UI / components (gates, freeze overlay w/ SOW exemption, SOW notice line)
- State model (isCommitted semantics; SOW-vs-pricing field partition)
- Data script (backfill: locked + locked_line_total + Sent-only total)

### New mechanisms introduced (this revision)
- `saveSowOnly()` partial update (sales_sow / field_sow / sub_areas only) — NEW, unaudited
- Overlay SOW-tab exemption + locked-Textarea override on committed — NEW, unaudited
- Backfill contract additions (sequence-first gate, era columns, Sent-only total, bf-1/bf-2 assertions) — round-2 findings, now spec

### Cross-system reach
- `trg_sync_job_amount`: backfill fires it for ≤7 Sent rows only; handler paths preserved
- H6 signing RPC ← backfill-populated snapshots (era parity pinned §4.3)
- Field Command reads `field_sow` downstream via manual Send-to-Schedule — `saveSowOnly`
  edits flow through the existing path; verify no staleness assumption breaks (F40 territory — flag, don't expand)

### Irreversibility
- Backfill as before (dry-run + preserve-signed-totals shrinks it). Everything else reversible; zero migrations.

### Known weak points
- `saveSowOnly` is the sole committed-state write path: verify it cannot be reached
  with a payload containing pricing keys (spec says column-list literal, not object
  spread from state), and that the SowTab save-button routing (`isCommitted` ternary)
  can't send a committed SOW edit through full `handleSave` (which would silently drop
  it — user thinks saved, nothing written).
- SOW carve-out × locked semantics: on committed proposals the `locked → readOnly`
  Textarea override inverts today's rule ("Locked — change order required to edit").
  Verify no other consumer of that readOnly assumption (PDF regeneration? signed-PDF
  SOW snapshot?) treats locked SOW as immutable-after-signature — a signed PDF already
  rendered is a snapshot, but confirm nothing re-renders contract SOW from live rows.
- The §4.3 "backfill BEFORE deploy" gate is procedural (deploy-terminal discipline),
  not mechanical — confirm the §7 step-9 ordering is stated everywhere the deploy is
  described (it is the only enforcement).
- Direction-scoped guard condition (`!newLocked && …`) is now pinned, but appears in
  two files — verify the plan text keeps both sites' conditions identical.

### Open questions
- Count: 0 (both round-2 questions ratified by Chris: preserve-signed-totals; SOW
  carve-out covering field_sow + sales_sow + sub_areas, size/unit frozen)

### Suggested attack angles (2 total)
1. **Round-2 integration verify** — covers §4.2/§4.3 as revised. Required reading:
   §4.2, §4.3, §5, round-2 findings A–F as summarized in Prior rounds. Specific
   pressure: confirm each round-2 finding's fix is internally consistent where it now
   lives (sequence gate reachable, era columns sufficient for `usesExactPricing`,
   Sent-only total write matches the §5 disclosure, direction-scoped condition
   identical at both guard sites, `isCommitted` rename complete incl. `:1239`
   collision avoidance).
2. **SOW carve-out attack** — covers the NEW mechanism. Required reading: §4.2
   carve-out spec, `WTCCalculator.jsx` SowTab (:989-1130, :2450), `handleSave`
   payload (:2191-2226), sister-sync migration SOW handling. Specific pressure:
   payload isolation (no pricing keys reachable), save-button routing, autosave
   interaction with SOW edits on committed (short-circuit must NOT eat a SOW edit —
   trace where SOW autosave lands), locked-Textarea override blast radius, whether
   any surface re-renders contract SOW from live rows post-signature.

### Suggested agent count: 2

Rationale: declining trend with both round-2 Highs resolved by spec-pinning; the only
unaudited surface is the SOW carve-out, which merits its own dedicated attacker but
not a wider panel — 3 would re-plow confirmed ground.
