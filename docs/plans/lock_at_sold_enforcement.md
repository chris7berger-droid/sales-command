# Lock-at-Sold Enforcement

**Repo:** sales-command · **Branch:** `feat/lock-at-sold` · **Drafted:** 2026-08-18 (T1 plan terminal)
**Status:** Plan draft — awaiting audit (manifest at end) → build
**Incident:** Job 10019 (Swire CC Fllet Shop Grind & Seal), 2026-08-18
**Related:** F40 (post-send lock integrity — Schedule round-trip; stays open, NOT pulled in), B32 (draft pay-app snapshot drift after SOV edit; adjacent, untouched)

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

**Click-path to re-trigger each gap (third-party reproducible in prod today):**
1. Any Draft/Sent proposal with unlocked WTCs → ✓ Internal Approve → fill name +
   reason → proposal becomes Sold, no lock complaint. (This is how 10019 got Sold
   on Aug 18.)
2. Any Sold proposal → EDIT WTC → Summary tab → "🔓 Unlock WTC" → unlocks with no
   warning, despite the Sold read-only banner on every other tab.
3. Any proposal with a billing schedule → unlock any WTC from the proposal page's
   Lock toggle → no mention that a schedule exists → edit price → re-lock → schedule
   silently keeps the old dollars (this exact sequence produced the $318 drift).

## 1. The invariant [LOCKED — Chris, 2026-08-18]

> Once a proposal is committed to a customer (Sent, Signed, or Sold), its WTC pricing is
> frozen. The only door back to editing is Pull Back, which returns the whole proposal to
> Draft. A proposal cannot *become* Sold with unlocked WTCs. When pricing legitimately
> changes before commitment, the billing schedule (SOV) must be told, not left behind.

This rule already exists in Chris's process and in F40's notes ("WTCs lock at approval").
The code enforces it in exactly one place (the Send Proposal button) and nowhere else.

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

## 3. Current-state map (verified by grep, 2026-08-18, tip `6db76eb`)

### Ways a proposal becomes Sold/Signed
| Path | Site | Lock gate today? |
|---|---|---|
| Send Proposal button | `ProposalDetail.jsx:918` | ✅ `wtcs.length > 0 && every(locked)` |
| Send from PDF modal | `ProposalPDFModal.jsx:274-275` | ✅ same gate |
| **Internal Approve** | `ProposalDetail.jsx:790` (`handleInternalApprove`; opened from button `:908` and from PDF modal callback `:833`) | ❌ **none — the 10019 gap** |
| Customer signs | `proposal-signed` edge fn (via PublicSigningPage) | Indirect — requires Sent, which required locks *at send time* |
| Archive import | `ArchiveProposalModal.jsx:102`, `ImportToLiveWizard.jsx:497`, `importApi.js` | N/A — archive proposals have no WTCs (by design) |

### Ways a WTC unlocks
| Path | Site | Guard today? |
|---|---|---|
| Lock toggle on proposal page | `ProposalDetail.jsx:310` (`toggleWtcLock`) | ❌ none — unlocks on any status, no billing-schedule awareness |
| "Unlock WTC" in calculator Summary tab | `WTCCalculator.jsx:2258` (`handleLock`) | ❌ none — **Summary tab is exempt from the Sold/Signed read-only overlay** (`:2425` `tab !== "summary"`), so this works even on a Sold proposal |
| Pull Back | `ProposalDetail.jsx:558` | ✅ sanctioned path — blocks on live invoices, resets to Draft, clears locks + `locked_line_total` |

### What lock actually protects today
- WTC editor pricing tabs: read-only via overlay when `locked` (`WTCCalculator.jsx:2425,2444`) — but the overlay's Summary-tab exemption leaves the Unlock button live.
- Send gates (above). SOW text (`readOnly`). PDF generation (`:1541` requires locked).
- `locked_line_total` snapshot for the public signing page RPC (audit H6).

### Billing schedule creation/update writers
- Auto-create on all-locked: `ProposalDetail.jsx:344-356` (INSERT — not blocked by the money-guard trigger, which is UPDATE-only).
- Manual lines + PDF extraction: `BillingScheduleSection.jsx` (`saveDraftAsLine`, `saveLineEdit`, import flow — all recompute `contract_sum` via `persistContractSum:115`).
- **DB guard (verified in prod):** `trg_billing_schedule_guard_money` — UPDATE of `contract_sum` / `retainage_pct` / `status` on `billing_schedule` requires Admin/Manager (`is_admin_or_manager()`). `billing_schedule_lines` has **no** money guard (only `updated_at`). This asymmetry drives the role-gating in §4.3.

## 4. The changes

### 4.1 Internal Approve requires locked WTCs (closes the 10019 gap)

`ProposalDetail.jsx` `handleInternalApprove` (~:790), at the top, after the existing
name/reason validation:

- If `p.is_archive_proposal` → skip the gate entirely (archive proposals have no WTCs;
  their whole approval semantics are different and untouched).
- Else require `wtcs.length > 0 && wtcs.every(w => w.locked)`. On failure:
  `alert("Lock all Work Type Calculators before approving. Unlocked: <names>.")` and
  return — same standard as the Send gate, naming the offenders.
- Gate applies identically to sister-cohort approvals (the branch that sets "Signed").
  Sisters are clones with their own WTCs; if a clone arrives unlocked, the approver
  locks it first — that IS the invariant, not an exception. (Audit should verify the
  multi-GC clone flow copies WTCs in a lockable state — see manifest Q3.)
- Rate-card WTCs count in the gate exactly as they already do in the Send gate
  (`every(w => w.locked)` — no new semantics).

### 4.2 Unlock guards (both sites, same rule)

Rule, applied in `toggleWtcLock` (`ProposalDetail.jsx:310`) and `handleLock`
(`WTCCalculator.jsx:2258`) **only on the unlock direction** (`newLocked === false`):

- Proposal status in `["Sent","Signed","Sold"]` → **block**:
  `alert("This proposal is <status>. Pull it back to Draft to edit pricing — unlocking is disabled after it's been sent.")`
  No write happens. (Pull Back already exists at `ProposalDetail.jsx:558` and remains
  the ONLY door — this is the invariant F40 assumes, so this change sets F40 up.)
- Status Draft (or anything else) **and** a `billing_schedule` row exists for this
  proposal → **warn, allow**:
  `confirm("This job has a billing schedule at $<contract_sum>. If you change pricing, re-locking will offer to update it. Unlock?")`
  Cancel → no write.
- Status Draft, no schedule → unchanged (free unlock, as today).
- `WTCCalculator` needs the proposal status + schedule lookup at unlock time: it already
  fetches the proposal (`:2313` sets `proposalSold`); extend that fetch to keep `status`
  in state and query `billing_schedule` by `proposal_id` on demand in `handleLock`
  (one `maybeSingle()` — not on mount, only when unlocking).
- Lock direction is untouched except §4.3.

### 4.3 Re-lock reconciles the billing schedule

In `toggleWtcLock` and `handleLock`, **lock direction**, after the existing
`proposals.total` sync, when **all** WTCs on the proposal are now locked:

- If no `billing_schedule` exists → existing auto-create behavior unchanged
  (`ProposalDetail.jsx:344`; the calculator path today creates nothing — leave that
  asymmetry alone, it's out of scope).
- If a schedule exists and `|proposalTotal - contract_sum| < $1` → nothing.
- If it differs and **any pay app exists** (`billing_schedule_pay_apps` count > 0) →
  warn only: `alert("Heads up: the billing schedule is $<X> but the proposal now totals $<Y>. Pay apps have already been created, so the schedule was NOT changed. Reconcile it manually on the job's Billing Schedule.")`
  Dollars under billed work never move silently.
- If it differs and **no pay apps** → offer:
  `confirm("The billing schedule shows $<X>; the proposal now totals $<Y>. Update the schedule to match?")`
  - **Role check first:** offer only when `["Admin","Manager"].includes(teamMember?.role)`
    — the DB trigger blocks `contract_sum` UPDATE for anyone else, and
    `billing_schedule_lines` has no guard, so a Sales-role attempt would half-apply
    (lines updated, sum rejected → internal drift, worse than none). Sales role gets the
    warn-only alert with "ask an Admin/Manager to update it."
  - **Write order:** update `billing_schedule.contract_sum` FIRST; only if that
    succeeds, update the lines. If the sum update errors, alert and stop — schedule
    left fully consistent at old values.
  - **Line update strategy — WTC-shaped schedules only:** update each line's
    `scheduled_value` only when lines map 1:1 to non-rate-card WTCs by description
    (same seeding rule as auto-create, F44: rate cards carry no SOV line). If the
    schedule does NOT map (GC-supplied format, e.g. Plenium's 7-line breakdown, or
    manually added/renamed/CO lines) → update `contract_sum` only? **No** — that would
    desync sum from lines. For non-mapping schedules: warn-only alert
    ("schedule uses a custom line format — update it manually"), no writes. Sum and
    lines move together or not at all.
- `WTCCalculator.handleLock` needs `teamMember` — it doesn't receive it today. Pass it
  down from the existing render site (`ProposalDetail.jsx:833` renders `<WTCCalculator …>`;
  `ProposalDetail` already receives `teamMember` at `:54`). Prop add only, no context change.

### 4.4 UI (layout section — per plan standard)

No new screens, no layout changes. All three changes surface through the app's existing
alert/confirm vocabulary (matching every guard in these files — QB void, pull-back,
delete cascade all speak through `alert`/`confirm` today):

- Gate failures: `alert()` naming the unlocked WTCs / the blocking status.
- Unlock-with-schedule + reconcile offer: `confirm()` with both dollar figures spelled
  out (`fmt$`, no cents per rule).
- No visual changes to the WTC cards, Lock buttons, Summary tab, or billing schedule
  section. The amber "In Progress" / green "Locked" states stay exactly as they render
  now (Style Rules untouched — no new colors, no new components).

## 5. Blast radius — the triple-confirm

Every consumer of the touched concepts, traced at `6db76eb`. **"Untouched" means the
build must not edit that site and the audit should flag any diff that does.**

### Consumers of `proposal_wtc.locked`
| Site | Uses it for | Verdict |
|---|---|---|
| `ProposalDetail.jsx:520,913,918,940-984` | checklist %, clone gate, Send gate, card styling | Untouched — reads only; §4.1 adds a *new* read in approve |
| `ProposalPDFModal.jsx:274-275` | send gate in PDF modal | Untouched |
| `WTCCalculator.jsx` (overlay `:2425,2444`, SOW readOnly, PDF gate `:1541`, save payload `:2218`) | edit gating + persistence | Only `handleLock:2258` changes (§4.2/4.3). Save payload still writes `locked: locked` unchanged |
| `Invoices.jsx` "locked" hits | ALL are QB-invoice/amount locks or `linkedPayApp` — different concept, zero overlap | Untouched |
| `BillingScheduleSection.jsx:23,68` | SCHEDULE lock (invoice-count + `status==="locked"`) — name collision, unrelated mechanism | Untouched |

### Consumers of `locked_line_total`
| Site | Verdict |
|---|---|
| Public signing page RPC (H6), `PublicSigningPage.jsx`, `PublicInvoicePage.jsx` | Untouched — §4.2 *prevents* silent clearing on committed proposals (blocked unlock = snapshot survives), strictly safer for the signing page |
| Pull Back clears it (`ProposalDetail.jsx:570`) | Untouched — still the sanctioned clear |

### Sold/Signed writers
| Site | Verdict |
|---|---|
| `handleInternalApprove` | Gated (§4.1) — the ONLY status-writer edited. The write itself, QB job creation, notify trigger (`trg_notify_proposal_approved`), sister-cohort branch: all unchanged, just preceded by the gate |
| `proposal-signed` edge fn | Untouched — no edge fn deploys in this loop |
| Archive/import paths (`ArchiveProposalModal`, `ImportToLiveWizard`, `importApi`, `MergeJobModal`) | Untouched — archive explicitly exempted from the gate |

### Billing schedule writers
| Site | Verdict |
|---|---|
| Auto-create on all-locked (`ProposalDetail.jsx:344`) | Untouched (INSERT path). §4.3 adds the *update* branch beside it |
| `BillingScheduleSection.jsx` manual lines / PDF import / `persistContractSum` | Untouched — manual editing stays fully available, incl. GC-format schedules |
| `NewPayAppModal`, `PayAppDetailModal`, `Invoices.jsx` pay-app paths | Untouched — read `scheduled_value` snapshots as today; §4.3 refuses to touch any schedule with existing pay apps, so B32's snapshot semantics never worsen |
| DB triggers / RLS / migrations | **Zero schema changes.** The existing money-guard trigger is *respected* (role gate), not modified |

### Flows deliberately NOT changed (regression tripwires for the audit)
1. **Pull Back** — byte-identical. It's referenced by new messages, not edited.
2. **Send Proposal / Send to Customer** — gates already correct; no edits.
3. **Send to Schedule** (`openSendReview`/`commitSendToSchedule`) and everything F40
   covers (job guard, re-send, orphaned `job_wtcs`) — out of scope, untouched.
4. **Multi-GC clone** (`+ Send to Additional GCs`) — untouched; audit Q3 verifies the
   gate composes with cloned-WTC lock state rather than dead-ending sister approval.
5. **Archive proposals** — exempt everywhere.
6. **Edge functions** — none touched, none deployed.
7. **Autosave** (`WTCCalculator.jsx:1898-1913`) — untouched; it's already gated by
   `proposalSold` and pricing tabs stay overlay-gated by `locked`.

## 6. Out of scope (named, with the user-trigger that would reopen them)
- **DB-level freeze** (trigger blocking `proposal_wtc` money-column UPDATE when
  `locked`) — the real belt-and-suspenders; needs a `command-suite-db` migration +
  rehearsal. Reopen when client-side enforcement proves insufficient (i.e. drift
  recurs despite this loop).
- **F40's three seams** — separate loop, unchanged priority.
- **B32** (draft pay-app snapshot sync) — unchanged.
- **Calculator-side schedule auto-create** — today only the ProposalDetail lock path
  auto-creates; leaving that asymmetry.

## 7. Smoke plan (preview deploy, before merge)
1. **10019 regression:** proposal page → try Unlock on a WTC → blocked with pull-back
   message (status Sold).
2. Draft proposal w/ schedule: unlock → warn-confirm fires → edit travel → re-lock all
   → reconcile offer shows both totals → accept → Job Detail Contract matches proposal
   summary; SOV lines updated.
3. Same, as a **Sales-role** login → no offer, warn-only text.
4. Schedule with a pay app: re-lock after edit → warn-only, schedule dollars unchanged.
5. GC-format schedule (line count ≠ WTC count): re-lock after edit → "custom line
   format" warn, zero writes (verify `updated_at` on lines unchanged).
6. Internal Approve with one unlocked WTC → blocked, names the WTC; lock it → approve
   succeeds; QB job + rep notification still fire.
7. Archive proposal → Internal Approve unaffected.
8. Send Proposal, Pull Back, Multi-GC clone: click through unchanged flows — no
   behavior difference.
