# Plan — Home Screen → Engagement Redesign

Confidence tags: **[LOCKED]** = Chris-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = waiting on something.

**Type:** feature (presentation redesign)

**Status:** 🟡 IN PLANNING — 6 boxes locked 2026-08-13; **amended 2026-08-15** with the visual
target (approved mockup) + 4 decisions. See the **2026-08-15 amendment** at the bottom — it is the
newest source of truth where it touches Box 3, Box 5, layout, and migrations.

**What this is:** the *reskin* of Home into the shape in `docs/HOME_ENGAGEMENT_VISION.md`. It is NOT
the engine — the engine (snapshot loader, dormant/gone-quiet lists, follow-up + bid-due logic) shipped
per `docs/plans/home-follow-up-screen.md` (FROZEN) and is reused as-is. This doc governs the
presentation of `src/pages/Home.jsx` + `src/components/followup/*` only.

**Scope guardrails (from the ratified vision):** ships the "now" column only. **Zero migrations**
(the %-runway that briefly added one is DEFERRED — see amendment part 5). Honest effort note: this is
a reskin PLUS two genuinely-new pieces the build must not treat as free — **per-rep-scoped selector
variants** (dormant/goneQuiet must be filtered to the logged-in rep; only bid-due alerts were rep-aware
before) and **two hand-built SVG charts** (money donut + goal thermometer, no chart library). No
backend, no new architecture, no migration.

**Pointers:**
- North-star + verbatim intent: `docs/HOME_ENGAGEMENT_VISION.md`
- Engine (frozen, shipped): `docs/plans/home-follow-up-screen.md`
- Current screen: `src/pages/Home.jsx` (143 lines — today the RunwayBar is the top "hero"; this
  redesign moves it down and puts a personal win on top).

---

## Data on hand (confirmed in-snapshot — zero DB) [DERIVED, verified 2026-08-13]

`loadSnapshot()` (`src/lib/followUp.js`) already fetches everything the top boxes need:
- `call_log` carries `sales_name` → **per-estimator scoping** (same match `bidDueAlerts` uses).
- `proposals` fetched **all-history** (`deleted_at is null` only) → this-month sold $ **and**
  best-month comparisons are free. Fields: `status`, `total`, `created_at`, `call_log_id`,
  `customer_id`, `proposal_wtc(end_date)`.
- `outreach_log` (last 180d) → **calls-this-month** per rep, by `outcome` / `created_at`.
- Caveat [DERIVED]: proposals have no `sold_at` — "sold this month" keys on proposal **`created_at`**
  (the single basis locked in part 5 §C; NOT `call_log.updated_at`), not the moment it flipped to Sold.
  Acceptable for v1.

---

## Box 1 — THE YOU BOX (personal win) [LOCKED — Chris, 2026-08-13]

**Role:** top of the screen, #1, never displaced. Big, bold, one line, its own breathing room
(video-game bold). Always true, always positive, personalized to the logged-in estimator, reading
**this month.** The runway may slide *above* it when critical, but this box itself never moves or
gets replaced.

**Two states, auto-picked:**
- **Sold anything this month → results.** Show the money: `"$312K sold this month"`, plus a small
  **"best month yet"** badge when it beats their prior months. Source: this rep's Sold proposals,
  current month.
- **Nothing sold yet → effort.** Show the work: `"18 calls · 5 bids out — you're doing the work,
  it's coming."` Source: this rep's calls logged (outreach_log) + bids currently out (their Has Bid
  count). Never an empty "$0."

**Switch rule [LOCKED — option A]:** this box stays a pure confidence hit. **Any sale this month →
results.** Only a literal $0-sold month shows effort. It never carries pace/"are you behind"
pressure — that lives one box down (the money bar). Rationale (Chris's principle #2): the person
always keeps their anchor; the hero is the confidence hit *before* anything is asked of them.

**Records/best-ever:** ship a basic **"best month this year"** badge in v1 (data is free). Fancier
record types (best-ever, streaks) are deferred spice, not v1.

**Layout intent:** full-width top block, one oversized bold line in the display font, generous
padding, clear separation from the money bar below.

---

## Box 2 — THE MONEY BAR (personal, carries the pressure) [LOCKED — Chris, 2026-08-13]

**Role:** #2, directly under the YOU box. This is where all pace/urgency lives (the YOU box stays a
pure confidence hit). A single progress bar for the logged-in estimator's month.

**What it measures [LOCKED]:** **money SOLD this month** by this rep (their Sold proposals, current
month) — bookings, not billings. Chris's call: use the existing Settings goal number as the target,
but the bar fills on money *sold*, not invoiced.
- Caveat [DERIVED]: proposals have no `sold_at`; "sold this month" keys on proposal `created_at`
  (single basis, part 5 §C). Verify at build; a job sold this month but created last month is the
  edge case.

**The goal number [LOCKED — split]:** company goal ÷ active estimators = each rep's personal target.
- Source: `tenant_config.monthly_billing_goal` (Admin/Manager sets it in Settings — already exists).
- Headcount: count of **active** `team_members` in an estimator/Sales-Rep role (one small read;
  pattern already used in `ImportToLiveWizard.jsx:219`). No new table, no migration.
- [DESIGN-OPEN, minor]: exact role value(s) that count as "estimator" for the split — confirm at
  build against the real `team_members.role` values.

**The pace marker [LOCKED]:** a line showing where they *should* be by today = target × (fraction of
the month elapsed), straight-line. As the month runs out and a gap opens, the marker slides right and
its color warms (calm → hot). Managed monthly — a slow week isn't a visible failure as long as the
month can still average out.

**The gap is always a move, never a scold [LOCKED]:** e.g. *"$30K to go — one good job, or 6 quiet
bids you already have out."* Spoken as opportunity + the next action.

**The donut [LOCKED]:** one circle beside the bar, **tap to switch** between three read-only views —
default **booked vs. left to go**, then **work type**, then **big vs. small jobs**. All derive from
the rep's proposals already in the snapshot.

**Layout intent:** full-width bar under the hero, big and legible; donut to the side; the "move"
sentence in plain language beneath the bar. Video-game bold — one glance tells them where they stand.

---

## Box 3 — THE BUSINESS, IN THE OPEN (shared) [LOCKED — Chris, 2026-08-13]

**Role:** #3, under the money bar. Not personal — everyone sees the same thing. Two elements.

**Crew runway [LOCKED — reuse existing, AS-IS]:** the weeks-of-booked-work bar already built
(`RunwayBar`, reads `tenant_config.schedule_runway_weeks`; Admin/Manager enters, all see). This
redesign **relocates it here unchanged** — it already works and is exactly what the approved mockup
shows. Keep its existing weeks value, its existing color logic, its editor.
- **⚠ DEFERRED to its own loop (amendment part 5, Option A — Chris 2026-08-15):** the %-of-crew-booked
  rewrite, the 5-band color ramp, and the **critical slide-up** are all a *separate future project* —
  NOT this build. For THIS build the runway is the existing weeks bar, in place, no slide-up, no
  rewrite. (The slide-up idea is parked with the %-model.)

**Shared goal thermometer [LOCKED]:** the whole team's progress toward the company goal. One rope,
**no ranking, no leaderboard** (natural competition self-surfaces privately).
- Tracks **the month [LOCKED — A]:** everyone's money **sold this month** vs the **un-split** company
  goal (`tenant_config.monthly_billing_goal`). Same monthly clock as the personal money bar.

**Layout intent:** shared row under the personal money bar — runway on one side, thermometer on the
other (or stacked on narrow screens). Calm and static (the slide-up motion is deferred with the
%-model — see part 5).

---

## Box 4 — YOUR BOOK (scoreboard / the doorway) [LOCKED — Chris, 2026-08-13]

**Role:** #4, under the shared row. Personal — the rep's own pipeline as **money, not a table.** A
calm, dollars-forward strip: three stages side by side, each with a **dollar total + a count.**

**The three stages [LOCKED]:** **Wants Bid → Has Bid → Sold.** Show all three; **all tappable**
(option A). Sold reads as a trophy *and* links to review what closed.

**Tap to drill [DERIVED — wiring confirmed]:** each stage taps straight into that pile. Target
exists with zero new wiring — `CallLog.jsx:29` already reads `navState.stageFilter`, and CallLog has
a `sales` filter, so we navigate with `{ state: { stageFilter: "<stage>", sales: <thisRep> } }` to
open **their own** filtered pile. Verify the exact stage label strings match `call_log.stage`.

**Data:** the rep's own proposals/pipeline already in the snapshot, summed to $ + count per stage
(scoped by `call_log.sales_name`).

**Layout intent:** one calm horizontal strip of three money tiles; big dollar number, small count
beneath, whole tile tappable. Reads "here's where my money's parked," tap to go work it.

---

## Box 5 — WHAT YOU OWE (follow-ups) [LOCKED — Chris, 2026-08-13]

**Role:** #5, under the scoreboard. A short, finite, **checkable** list — only the things the rep
committed to. Clearing it is visible proof of effort.

**What counts as owed [LOCKED — as-is]:** two sources, one combined list, scoped to this rep:
1. **Bids due** — already built (`bidDueAlerts`, Wants Bid with `bid_due <= today`).
2. **Self-set follow-up dates** — the existing **"Follow-Up Date"** field reps set per job
   (`CallLogDetail.jsx:619-620`, `call_log.follow_up`). Newly **surfaced** on Home. Zero DB — the
   column exists; just add `follow_up` to the `loadSnapshot` call_log select and filter
   `follow_up <= today` (same overdue-accumulates rule as bids-due).
   - No auto call-backs — only dates the rep chose themselves.

**Celebrate when clear [LOCKED]:** empty list → a win, not a blank: *"all caught up — go hunt."*

**Layout intent:** compact checkable list of cards, oldest/most-overdue first; each links into the
job. When empty, the whole box becomes the celebration state (hands them off to Box 6).

---

## Box 6 — WHERE TO HUNT (opportunity finder + call lists) [LOCKED — Chris, 2026-08-13]

**Role:** #6, bottom of the screen. Turns the screen from *here's your number* into *here's your
move.* Two parts.

**The opportunity finder ("coach, not scoreboard") [LOCKED — mechanics per vision]:**
- **Serves ONE** automatically — the strongest auto-ranked pick — so even an unmotivated rep is
  handed a move without going looking.
- **Refresh** names its criteria each time and serves the next angle.
- **Non-destructive** — step back / pin, so they can return to the best they've seen. (Session-local
  state, no DB.)
- **Shows its work** — every nudge states its reason ("because you sold them $40K last year and
  nothing this year").
- **Tap → drops into that call, pre-spiced.**

**Angles shipping in v1 [LOCKED — 4, all zero-QB, data available today]:**
1. **#1 Biggest Bid Hanging** — largest quiet bid (sent, stale, not won). From `goneQuiet` + `total`.
2. **#3 Quick Win** — smallest/oldest quiet bid; easy roll-start.
3. **#5 You're Their Guy** — customer this rep has done the most jobs with, gone quiet.
4. **#2 Almost Yes** — a bid they *opened but never signed*. Uses existing view tracking
   (`viewed_at`, seen in `ProposalDetail.jsx:1377`) — add `viewed_at`/`sent_at` to the snapshot
   proposals select (zero DB; columns exist).

**Deferred angles (need data/QB, grow later):** #4 rich cold-customer $ + #6 down-from-last-year
(QuickBooks); #9 play-to-your-strength (needs work_type); #10 neighborhood run (needs customer
city/zip — add columns later); #7 chase-a-whale, #8 new-blood held for the next batch. Reserve:
Follow-Up Due Today, Streak Saver.

**Under the finder [LOCKED — reuse existing]:** the built dormant + gone-quiet call lists, each
**tagged with a dollar number** so a call feels like chasing money.

**Layout intent:** the served card is the hero of this box (big, one clear move, a Refresh control);
the dormant/quiet lists sit calmer beneath it.

---

## Assembled order (top → bottom)

1. **YOU** (personal win) — never displaced.
2. **Money bar** (personal; carries all pace/pressure) + donut.
3. **Business, in the open** (shared: crew runway + goal thermometer) — runway slides up above #2
   only when critical.
4. **Your book** (personal scoreboard: Wants Bid → Has Bid → Sold, tap to drill).
5. **What you owe** (bids due + self-set follow-ups; celebrates when clear).
6. **Where to hunt** (opportunity finder + dormant/quiet lists).

**Build scope reminder:** reskin + read-only selectors + two charts (donut + thermometer). Zero
migrations, zero backend. New reads are all trivial column adds on existing tables
(`follow_up`, `viewed_at`/`sent_at`) + one small active-estimator count from `team_members`.
Next step: **plan is complete → audit (separate terminal) → build session** against this doc
(buildvsplan + preview smoke before merge). ERD Loop #45 stays open until the screen is accepted +
smoke-verified.

---

## Audit manifest

_Regenerated by `/auditcriteria` 2026-08-15 for **round 2** — a **convergence/verification** pass over
the round-1 response (amendment part 4), NOT a fresh broad sweep. Consumed by `/runaudit`._

### Bottom line (plain English)
The plan is in much better shape than round 1 — the fixes shrank it, not grew it. The runway went from
a fiddly "weeks" number to one simple "% of crew booked" on a fixed color scale (that alone erased
several round-1 problems), the un-buildable donut view was cut, and the database change dropped from
two columns to one. So this is a **tighter check, not a bigger one**: three reviewers confirm the two
genuinely-new pieces are right — the rewritten runway gauge and the honest admission that the
"personal" numbers need new filtering code — and that the build-blockers (the hero photos that don't
exist yet) are flagged. If round 2 comes back small, it's build-ready.

### Round
- Plan type: feature (presentation reskin — now **zero migrations** again after the Option-A cut)
- **Round 2 EXECUTED + responded** (2026-08-15). Pattern: amendment-not-integrated — 19 caused-by
  (7H/9M/3L); count GREW 15→19 → **scope-cut fired.** **Chris ratified Option A** (amendment part 5):
  ship the existing weeks runway; **DEFER the %-runway** to its own loop. That dissolved 10 findings
  (B1–B7, C1, C3, C5) + the only migration. Remaining live findings (REG-1/2, F1, N1, N2, C6, C7, K1,
  REG-3/4) are corrected in part 5.
- Plan revision (round-2 response): commit tagged `Plan revision pass 2`.
- **Round 3 = OPTIONAL, verification-only.** Round 2 proved round-1 fixes can be logically wrong, so a
  small round-3 (1–2 agents) confirming part-5's fixes actually took is cheap insurance — OR go to
  build and let `/buildvsplan` + `/code-review` catch fix errors. Chris's call. Do NOT re-audit the
  deferred %-runway.

### Prior rounds
- Round 1: `67fab47` · 0C/5H/6M/4L · pattern: reuse-premise-mismatch

**Briefing for agents**: do NOT re-find round-1 issues — they are addressed in amendment part 4's fix
ledger (A1/A2/C1/D1/E1/E2/F1/K1/G1/H1/I1/J1/L1/L2/L3). Attack ONLY: (a) material NEW to the round-1
response (the runway %-rewrite + its one column + 2 new tokens), and (b) whether each stated fix is
actually **correct and complete against the cited code** — a fix that's wrong or half-specified is fair
game; a fix that's fine is not a finding.

### Deployment context
- **Live tenants**: 1 — HDSP only. Sales + Field share Supabase project `pbgvgjjuhnpsumnowuym`.
- **Prod / staging / dev**: Home is the live-prod post-auth landing (salescommand.app); ships to a
  Vercel preview branch first, never straight to prod.
- **Blocking feature flags**: none.
- **Concurrency profile**: ≤5 users, single tenant. Multi-user race findings cap at Low.
- **Shared-DB note**: the migration adds **one additive, nullable** column
  (`tenant_config.schedule_crew_booked_pct`) on the **shared** project (Field reads it too) — low blast
  radius, authored + pushed via `command-suite-db` (rehearse-before-push applies). The old
  `schedule_runway_weeks int` is retired from the color path but NOT dropped (no destructive change).
- **Design-baseline note**: reskins `src/pages/Home.jsx` **as it exists today**; RunwayBar
  (`src/components/followup/RunwayBar.jsx`) is a **rewrite**. Verify against the real files, not the mockup.

### Time budget + finding cap
- **Time budget**: ~660 min (runway simplified + View 2 deferred trims build; per-rep scoping is now
  acknowledged as net-new code, which adds some back).
- **Finding cap**: 30 findings (nominal — round-2 convergence surface is narrower). Synthesis leads
  with the top ~5; anything beyond → "Quarantined (not actionable this loop)."

### Surface
- Plan doc: `docs/plans/home-engagement-redesign.md` (~620 lines; grew via appended amendments — much
  is superseded history, not live spec).
- Sections: 12 (Data-on-hand + Box 1–6 + Assembled order + amendments 1–4 + this manifest).
- [LOCKED] decisions: ~18 (6 boxes + amendments 1–4, all Chris-ratified).
- [DESIGN-OPEN] items: 3 — estimator role string; scoreboard stage-label strings; runway band-boundary
  ownership (which band owns exactly 30/50/70/90).
- [OPEN] items: 1.
- Plan-to-code ratio: ~620 plan : ~700 est code ≈ 0.9:1 — healthy (not scope-crept), though the doc
  carries superseded amendment history a builder must read *in order* (parts 1–2 runway content is
  overridden by part 4).
- Baseline (§0-equivalent): "Data on hand … verified 2026-08-13" — read-verified, `file:line` evidence;
  its overclaims were corrected by amendment part 4's fix ledger.

### Layers touched
- UI / components (reskin + **RunwayBar rewrite** + hand-rolled SVG donut/thermometer)
- Data layer (new **rep-scoped** selector variants; embedded `proposal_recipients` relation; `logged_by` add)
- State model (crew-booked-% 5-band machine + slide-up/hysteresis; derived per-rep fields)
- Migrations / schema — **one** `tenant_config` column (`schedule_crew_booked_pct`)
- Cross-repo — `command-suite-db` authors + pushes the one-column migration
- Design system / tokens — 2 new tokens (`C.critical`, `C.orange`) + the J1 token scale
- (No RLS change — round-1 CLEAN. No edge fns, no external integrations — QB deferred.)

### New mechanisms introduced
- New column: `tenant_config.schedule_crew_booked_pct` (`int` 0–100, nullable) — **one**, down from two.
- New tokens: `C.critical` `#c0392b`, `C.orange` `#e67e22` (`tokens.js` additions).
- `bandOf(pct)` — fixed 5-band scale (<30 / 30–50 / 50–70 / 70–90 / 90+) + band-1 slide-up + hysteresis.
- **RunwayBar rewrite** (weeks→%; retire `schedule_runway_weeks` from the color path).
- **Net-new rep-scoped selectors** — `dormant`/`goneQuiet`/`footerStats` variants + a
  `call_log_id → sales_name` map (only `bidDueAlerts` was rep-aware before).
- Embedded-array `proposal_recipients(sent_at, viewed_at)` relation in the snapshot (finder #2).
- `logged_by` added to the outreach select (calls-this-month).
- Hero image weekly rotation (`weekOfYear % n`) over a bundled `src/assets/hero/` set — **[BLOCKED]**.
- Hand-rolled SVG donut + thermometer (no chart lib) — geometry spec required.

### Cross-system reach
- `command-suite-db` — one additive-column migration (`schedule_crew_booked_pct`), ledger-coordinated,
  rehearse-before-push. No other write.
- Shared project `pbgvgjjuhnpsumnowuym` — additive nullable column; verify it does not newly expose
  `tenant_config` via anon/PowerSync (round-1 verified it's an explicit-column-list view, not in the
  publication — do not re-chase unless the new column changes that).

### Irreversibility
- One **additive** nullable column (`schedule_crew_booked_pct`) — reversible drop, ledger-coordinated.
  No backfill, no destructive change (old int column left in place), no public-API change. Low.

### Known weak points (round-2 focus — NEW material + fix-correctness only)
1. **Band-boundary ownership.** The 5-band scale on 30/50/70/90 — which band owns each exact boundary?
   `bandOf(pct)` needs explicit `>=`/`<` so 70 isn't both "filling" and "good." Currently [DESIGN-OPEN].
2. **`schedule_crew_booked_pct` null/unset.** A null pct must NOT compute band 1 (false critical) — the
   existing RunwayBar null→"unset" short-circuit must carry into the rewrite. Verify it's specified.
3. **Orphaned `schedule_runway_weeks`.** The old int column + its reads (`runwayColor`/`runwayMessage`/
   editor in `RunwayBar.jsx`) must be fully removed from the color path — no half-wired dead reads.
4. **Slide-up ordering lives in Home, not the child.** RunwayBar can't self-promote above the money
   bar; the plan says lift ordering to `Home.jsx` with hysteresis. Verify the plan says WHERE that state
   lives and that hysteresis (band-1 in, ≥30% out) actually prevents oscillation at the line.
5. **Per-rep scoping is net-new code (was the A1 headline).** Verify the `call_log_id → sales_name` map
   handles G1 orphans (null `call_log_id` → `customer_id` fallback), and that the sold-month basis is
   reconciled across hero/bar/`footerStats` (F1) so two $ figures can't disagree.
6. **`proposal_recipients` must be EMBEDDED, not a flattening join** (A1/L3) — a flatten fans out
   proposal rows and double-counts money sums. Verify the stated relation shape.
7. **Hand-rolled SVG (H1) + token scale (J1).** No chart lib — donut/thermometer geometry
   (radius/stroke/overflow-arc) must be specified; a spacing/radius/font scale must exist or the
   "anchor both edges" / same-weight effort hero drift flat.
8. **Migration hygiene (I1).** One column now, but still needs a `_revert_` twin, a `rehearse.sh`
   call-out, an ordered deploy (migration + ledger → then Home), and the column type pinned (`int`).
9. **Plan-internal consistency.** Amendment part 3 still fully specs the **3-view** donut incl.
   work-type; part 4 defers View 2 to v1.1. A builder reading part 3 first could ship the deferred
   view — verify part 4's supersession is unmissable (or trim part 3).

### Open questions
- Count: 4 (3 DESIGN-OPEN + 1 OPEN). Highest-pressure: (a) runway **band-boundary ownership** at
  30/50/70/90; (b) exact `team_members.role` value(s) counting as "estimator" for the goal split (E1).

### Suggested attack angles (3)
1. **Runway %-rewrite correctness** — the biggest genuinely-new surface. Covers state model + UI + the
   one migration. Reading: `src/components/followup/RunwayBar.jsx` (current weeks impl:16-21),
   `src/lib/tokens.js`, `src/pages/Home.jsx` (where slide-up ordering must live), `src/lib/config.js`
   (`updateTenantConfig`), `command-suite-db` migration flow. Pressure: `bandOf(pct)` boundary ownership
   at 30/50/70/90; null/unset pct → not false-critical; old `schedule_runway_weeks` fully retired (no
   dead reads); slide-up lifted to Home + hysteresis stops oscillation; single additive-column migration
   hygiene (revert twin, rehearse, pinned `int`); the 2 new tokens actually added to `tokens.js`.
2. **Per-rep derivation + data-shape fix correctness** — verify the round-1 fixes are RIGHT (don't
   re-find them). Covers data layer + state model. Reading: `src/lib/followUp.js` (snapshot selects +
   `dormant`/`goneQuiet`/`footerStats`), `src/lib/alerts.jsx:58-60`, `src/App.jsx:210` (displayName),
   `src/pages/CallLog.jsx:29-31` (A2 nav-seed), the `proposal_recipients` relation. Pressure: is the
   `call_log_id → sales_name` map correct incl. G1 orphan fallback? Do the new rep-scoped variants
   actually exist as spec (net-new, not "reuse")? Is `proposal_recipients` embedded (not flatten →
   double-count)? Sold-month basis reconciled across hero/bar/footer (F1)? Does `CallLog:31` seed match
   a real `salesOptions` value (A2)? `logged_by` add + null-name identity risk (K1)?
3. **Build-readiness gates + plan consistency** — the [BLOCKED] items, internal contradictions, scope
   discipline. Covers UI/design-system + cross-cutting. Reading: `docs/home-engagement-mockup-v1.png`,
   `src/lib/tokens.js` (scale), `src/assets/`, amendment parts 2/3/4 (contradictions), `CLAUDE.md`
   style rules. Pressure: hero images a real [BLOCKED] gate (no Unsplash hotlink can ship)? Donut/
   thermometer SVG geometry specified (H1)? Token scale for anchor-both-edges + same-weight effort hero
   (J1)? Does part-4's View 2 defer unmissably supersede part-3's 3-view spec? Best-month badge guard
   (L1)? Anything still mislabeled "reskin/zero-DB" that isn't?

### Suggested agent count: 3

Rationale: down from round-1's 4 because this is a convergence pass — round-1's migration/write-path
angle collapsed (1 column, role-gating verified CLEAN, thresholds now fixed constants) and
translation-fidelity is now well-specified, so 3 targeted angles (new runway rewrite + fix-correctness +
build-gates) cover the live surface without re-finding addressed material; a 4th would spend tokens
re-sweeping what part 4 already closed.

---

## 2026-08-15 amendment — visual target locked + mockup decisions [LOCKED — Chris]

_Appended, not overwritten. Where this touches Box 3 / Box 5 / layout / migrations, THIS is newest._

**Visual target [LOCKED].** The approved mockup (started in Claude Design, finished in ChatGPT) is
now the reference the build matches. Saved in-repo at `docs/home-engagement-mockup-v1.png`; the seed
that produced it is `docs/home-engagement-claude-design-seed.md`.
- **TRANSLATE, do not drop-in.** The mockup's code/colors are off-brand ChatGPT tokens — remap every
  color to `src/lib/tokens.js` (its `#008678` teal → our `#30cfac`, its purple/orange → our `C.purple`
  / `C.amber`) and honor the hard style rules: **no white backgrounds; teal buttons get BLACK text**
  (the mockup's teal "Call Dana Kessler" button uses white — fix on build).

> ⚠ **ENTIRE runway block below (parts 1 & 2 runway + the migration + the Settings threshold inputs)
> is DEFERRED to its own loop — see amendment part 5 (Option A, Chris 2026-08-15). NOT this build.**
> This build ships the existing weeks `RunwayBar` unchanged. Read the rest of part 1/2 runway as the
> parked spec for the future %-runway project.

**Box 3 amendment — crew runway is a 3-state, per-customer indicator [LOCKED].** Supersedes the
single "critical slide-up" note.
- **Three states only:** 🟢 green (calm, in place) · 🟡 amber (warm color, in place — no slide) ·
  🔴 red (warm/tension color **and slides up above the money bar**; the YOU hero never moves).
- **Thresholds are PER-CUSTOMER, set in Settings — not hardcoded.** They vary by trade/company.
- **HDSP defaults:** green **≥3 weeks** · amber **2 to under 3 weeks** · red **under 2 weeks**
  (anchors: 3→green, 2→amber, 1→red).

**Migration correction [LOCKED — amends the "zero migrations" guardrail].** Storing the two
per-customer thresholds adds **two small columns to `tenant_config`** (e.g. `runway_amber_weeks`,
`runway_red_weeks`) → **one small migration in `command-suite-db`**. This is the ONLY migration. The
runway *number* itself (`schedule_runway_weeks`) already exists. All three values (the number + both
thresholds) are entered by **Admin/Manager in Settings**. v1 stays manual entry; Schedule Command
auto-feeding the number is still deferred.

**Box 5 amendment — full-width; no 7th box [LOCKED].** "What You Owe" runs **full-width.** The
mockup's added **"AT A GLANCE"** box is **CUT** — it was space-filler that repeated the hero + money
bar. (It was never one of the locked 6; we simply do not adopt it.)

**Layout principle — applies screen-wide [LOCKED].** The durable fix for our recurring "full-width
row with a hollow middle" problem — so we stop shipping flat *without* adding clutter:
1. **Anchor both edges.** Label/number hard-left, secondary data (amount, due date, chip, donut)
   hard-right — a wide row's open middle then reads as intentional breathing, not an unfinished gap.
2. **Pair, don't pad.** Go 2-up only when there's a *real* companion (money bar + donut). Otherwise
   full-width + lever 1. **Never bolt on a recap module just to fill pixels** (that's what At-a-Glance
   was). A calm, breathing screen *wants* some open center; *unanchored* empty is the only enemy.

**Hero image rotation [LOCKED — easy].** The top-right hero image rotates **deterministically by
week-of-year** (same image for everyone that week, changes on its own, no backend, no randomness — an
array + a date-derived index). Ship a curated set of **~12–20 SELF-HOSTED, licensed images** (bundled
or a Supabase bucket) — **not** the mockup's Unsplash hotlink. Daily variant is trivial if wanted;
weekly is the call. Time-of-day tie-in (sunrise in the AM) is deferred spice.

**Settings scope added [LOCKED].** Two new Settings inputs (Admin/Manager only): **runway amber
threshold** + **runway red threshold**, per-customer, beside the existing runway-weeks number.

**✅ Audit manifest refreshed 2026-08-15** (`55fe8c5`, round 1 revised, 4 agents) — reflects the one
migration, the mockup as visual target, and the Settings threshold inputs.

---

## 2026-08-15 amendment (part 2) — the two undrawn states, now specified [LOCKED — Chris]

_The mockup drew only the good-month hero + the healthy (green) runway. These are the other states,
specified so the build has a complete picture and doesn't improvise them flat. Refines Box 1 + Box 3._

### Box 1 — the $0 "effort" hero state [LOCKED]
The data was already locked in Box 1 (effort = calls logged + bids out); this is the **visual**.
- **Same box, same shape, same spot.** Identical layout to the results hero — full-width top block,
  same oversized display-font line, same breathing room, same rotating image. The box **never changes
  shape between states**, so a slow month never reads as "a different, sadder screen."
- **Hero number = the effort metric, given the same visual weight as the $ number.** Lead with the
  purest effort signal as the big display-font number: **calls logged this month** (e.g. big
  `18 calls`), with a warm teal label (`logged this month`), then a second line carrying the bids:
  *"5 bids out — you're doing the work, it's coming."*
- **Warm palette, not a warning.** Uses the same positive linen/teal treatment as the results state.
  Effort is not a bad state — **no red, no amber, and the string `$0` never renders.**
- **No pace/pressure here** (that lives in the money bar). Pure confidence hit, per the locked
  switch rule: any sale this month → results; only a literal $0-sold month → this effort state.
- **Badge:** none by default. Only show a positive momentum badge if a *real* record exists (e.g. a
  logged-calls streak) — never a placeholder.
- **Empty-everything fallback [LOCKED]:** brand-new rep / $0 sold + 0 calls + 0 bids → a first-move
  line, never blank, never `$0`: *"Fresh month — your first move sets the tone."*

### Box 3 — the amber + red (critical) runway states [LOCKED] — ⚠ DEFERRED (part 5, Option A; parked spec for the future %-runway loop, NOT this build)
Green (healthy) is the mockup's version. The two tension states, and the exact machine:
- **State machine (per-customer thresholds; HDSP amber_weeks=3, red_weeks=2):**
  - `weeks ≥ runway_amber_weeks` → 🟢 **green**, in place.
  - `runway_red_weeks ≤ weeks < runway_amber_weeks` → 🟡 **amber**, in place.
  - `weeks < runway_red_weeks` → 🔴 **red (critical)**, **slides up**.
  - Column semantics [LOCKED, resolves the null-default weak point]: `runway_amber_weeks` = the floor
    at/above which it's green; `runway_red_weeks` = the floor below which it's red. **If either is
    null/unset, fall back to app defaults (amber=3, red=2)** so the indicator always works and Settings
    shows those defaults pre-filled. Never let a null compare produce a false red or a crash.
- **🟡 Amber — "getting thin," a nudge in place (does NOT move):**
  - Bar fill + the big week number turn **amber (`C.amber`)**; the top-right pill flips `healthy` →
    `getting thin`.
  - Copy warms but stays forward/opportunity, never alarm: *"2.5 weeks booked — time to fill the
    calendar."*
- **🔴 Red — "needs work now," slides up, still a nudge not a takeover:**
  - The runway module **slides up into the #2 slot, above the money bar**, pushing the money bar down.
    The **YOU hero (#1) never moves.** Smooth slide transition (not a pop); it slides back to its
    normal slot when weeks recover to ≥ `runway_red_weeks`.
  - It **reorders, it does not cover or shrink** other boxes — no modal, no overlay.
  - Bar fill + number turn **red (`C.red`)**; pill flips to `needs work now`.
  - Copy direct but action-framed, never doom: *"1.5 weeks left — this is the one to chase today,"*
    pointing at the finder / opportunity below.
- **Thermometer is independent.** The company-goal thermometer beside the runway tracks the monthly
  goal and does **not** change color or position with runway state. Only the runway element moves.

---

## 2026-08-15 amendment (part 3) — the money donut, 3 tap-views spec [LOCKED — Chris]

_Box 2 already locked the donut concept + the 3 view names + tap-to-switch. This is the build spec:
derivation per view, cycle behavior, thresholds, empty states, and the one data dependency._

**Placement + interaction.**
- Beside the money bar (Box 2), ring + legend to its right, a tap affordance beneath (mockup's
  `TAP · <view>`).
- **⚠ SUPERSEDED by amendment part 4 §B: View 2 "Work type" is DEFERRED to v1.1.** The donut ships
  **2 views**, cycling: **Booked-vs-left → Big-vs-small → (back to Booked).** (The 3-view text below in
  this part 3 is the parked v1.1 spec — do NOT build the work-type view now.) The label beneath names
  the **current** view + a subtle "tap" hint.
- **Session-local only** — no persistence; resets to the default (Booked-vs-left) on reload.
- **Read-only glance, not a doorway** — the donut never drills in (drill-in lives in the Box 4
  scoreboard). All views scoped to this rep via `sales_name`, off proposals already in the snapshot
  except where a field-add is noted.

**View 1 — Booked vs. left to go (default).** Two slices: money **sold this month** vs **remaining to
personal target** (target = company goal ÷ active estimators — the same number the bar uses). If sold
≥ target, ring is full with a subtle "over" treatment (thin overflow arc / `112%`), **never a broken
>100% ring.** Legend: `Booked $X (n%)` / `Left to go $Y (n%)`.

**View 2 — Work type.** Sold-this-month $ split by work type (concrete prep, coatings, etc.); slices
= each work type's summed $. Legend lists the top ~5 with `$ · %`, tail collapsed into **"Other."**
- **Data dependency [DERIVED — verify/add at build]:** needs `proposal_wtc.work_type_id` +
  `work_types(name)` in the snapshot select. Today `loadSnapshot` pulls `proposal_wtc(end_date)`
  **only**, so this is a **trivial select add** (columns exist, zero-DB) — but it IS a real add the
  build must not miss. This is the one spot the "all views derive from the snapshot as-is" claim in
  Box 2 is not literally true yet.

**View 3 — Big vs. small jobs.** Sold-this-month $ split into **Large vs. Small** by a size line.
- v1 threshold = a **fixed default of $50K** (`Large ≥ $50K` / `Small < $50K`). Legend:
  `Large $X (n%)` / `Small $Y (n%)`.
- Making the threshold a **per-customer Setting is deferred** (NOT v1 — flagged so it doesn't grow
  scope). Ship the fixed $50K line first; tune later only if HDSP asks.

**Empty / edge states [LOCKED].**
- **$0 sold this month** → calm empty ring + *"nothing booked yet"* (matches the effort-hero tone, no
  error). View 1 still shows the full target as "left to go."
- **Single-slice** (all one work type, or all large) → full ring + one legend row. Never a broken chart.

**Color [LOCKED].** `tokens.js` only — teal family for the primary/booked slice, `C.linenDeep` (muted)
for "left / Other," and the accent set (`C.amber`, `C.purple`, `C.tealDark`) for multi-slice views.
No new colors, no white.

---

## 2026-08-15 amendment (part 4) — audit round-1 response + runway %-model pivot [LOCKED — Chris]

_Response to the round-1 audit (rev `26327b8`, pattern: reuse-premise-mismatch — 5H themes / 6M / 4L /
3 clean). Two ratified changes + a fix ledger. **Revise against cited `file:line`, not prose** (audit's
own rule). No build/migration/deploy — commit and send to round 2._

### A. Runway pivots from "weeks" to "% of crew booked" — ⚠ DEFERRED to its own loop (part 5, Option A — Chris 2026-08-15; NOT this build)
Chris's call: the runway is a **rough morale/urgency gauge**, and % of crew booked is the true signal.
A per-week strip needs per-week crew data (deferred to Schedule Command — vision lines 135–140), and
**Chris enters this by hand**, so v1 is **one manually-entered number: `schedule_crew_booked_pct`
(0–100).**
- **This simplifies, per "collapse to the simplest model, findings dissolve":**
  - Migration shrinks from **two per-customer threshold columns → one column** (`schedule_crew_booked_pct`,
    `int` 0–100, nullable). The existing `schedule_runway_weeks int` is **left in place but retired**
    from the color logic (optionally shown as a secondary note).
  - **Moots audit B1 entirely** (the int-vs-fractional-weeks conflict is gone — % is a clean 0–100 int).
  - **Removes the per-customer null-default threshold problem** — the 5 bands are **fixed app
    constants**, not per-customer columns (a normalized % means the same for every trade/company).
  - **Removes the two Settings threshold inputs** (part 1's "Settings scope added"); Settings now gains
    **one** input: the crew-booked %.
- **5-band scale [LOCKED — Chris]:** `<30 crit · 30–50 thin · 50–70 filling · 70–90 good · 90+ ideal`.
- **Color ramp [LOCKED — Chris 2026-08-15; final hue tuning in-browser per UI-first-class]:** a
  warm→cool heat ramp (warmer = worse), all from `tokens.js` + **2 new tokens** (`C.critical`,
  `C.orange`; `tealDeep`/`teal` already exist). **No green** — Chris cut it because green reads
  "you can coast." The top two bands are **deep→bright teal**, reserving the **brightest** teal for the
  peak to match how the app already uses bright teal to highlight performance (so 90% feels like the
  payoff, and 70–90 reads "great, but there's a brighter level above you"):

  | Band | Crew booked | Reads as | Color | Token |
  |---|---|---|---|---|
  | 1 | <30% | **Critical** (slides up) | rust-red | **new** `C.critical` `#c0392b` (distinct from error `C.red #e53935`, per audit C1) |
  | 2 | 30–50% | Thin | orange | **new** `C.orange` `#e67e22` |
  | 3 | 50–70% | Filling | gold | `C.amber` `#f9a825` |
  | 4 | 70–90% | Good, keep climbing | **deep teal** | `C.tealDeep` `#0d5c4d` |
  | 5 | 90%+ | Ideal / peak | **bright teal** | `C.teal` `#30cfac` |

  - **C1 resolved:** the error red `#e53935` is NOT used; band 1 gets its own `C.critical` rust tone,
    and inside a 5-step ramp it reads "worst," not "broken."
  - **Slide-up [LOCKED]:** triggers **only at band 1 (<30%)** — the module slides into slot #2 above the
    money bar (hero #1 never moves); bands 2–5 stay in place. Recovery/hysteresis: slides back only once
    it clears back to band 2 (≥30%), so it can't oscillate at the boundary.
- **RunwayBar is a REWRITE, not reuse [per audit B1]:** `src/components/followup/RunwayBar.jsx`
  currently hardcodes `runwayColor(weeks)` (`weeks===2` equality, `:16-21`) + weeks editor + weeks copy.
  Rewrite: read `schedule_crew_booked_pct`, 5-band `bandOf(pct)` function, % editor input (0–100 guard),
  % headline + message copy. **Reuse the component's good patterns as-is:** null→"unset" short-circuit,
  cleared≠0 distinction, `canManage` gating, inline editor, `updateTenantConfig` row-count verify.

### B. Donut View 2 "by work type" — DEFERRED to v1.1 [LOCKED — Chris ratified]
Ship the donut with **2 views: Booked-vs-left → Big-vs-small (wrapping).** Removes the only
un-derivable view (needs full `proposal_wtc` financials + `calcWtcPrice()`), keeps the reskin scope
honest. **Dissolves audit L2** (View 2 slice palette moot) and drops the `proposal_wtc.work_type_id`
+ `work_types(name)` select-add from scope. Amendment part 3's View 2 spec is **parked for v1.1**.

### C. Audit fix ledger (all CAUSED-BY; re-read each cite before writing build code)
- **A1 — kill the false "reads-what-snapshot-fetches / reuse-as-is" framing.** Per-rep scoping is
  **new code**: only `bidDueAlerts` is rep-aware; `dormant`/`goneQuiet`/`footerStats` are company-wide
  (`alerts.jsx:58-60`). Proposals carry no `sales_name` → build a `call_log_id → sales_name` map from
  `snap.callLog` and filter through it; write explicit rep-scoped variants of those three. Finder #2
  "opened" = `viewed_at` on **`proposal_recipients`, not proposals** — add it as an **embedded array**
  (`proposals!...(sent_at, viewed_at)`), never a flattening join (double-counts $ — audit L3), derive
  `recipients.some(r => r.viewed_at)`.
- **A2 — Box 4 "zero new wiring" is wrong.** `CallLog.jsx:31` inits `filters.sales:""` and never reads
  `navState.sales`; tapping "$312K Sold" opens the **company-wide** Sold list (tile total ≠ list total).
  Fix: seed `sales: navState.sales || ""` in the `useState` initializer, and verify the passed string
  matches a `salesOptions` value or the filter silently matches nothing.
- **C1 — resolved** via the runway ramp above (distinct `C.critical`, error red reserved).
- **D1 — hero images are a `[BLOCKED]` pre-build gate.** `public/` + `src/assets/` hold only
  logos/favicons. Before build: source + license ~12–20 images → **bundled `src/assets/hero/`**
  (preferred over a bucket, which would need a public-read policy) → index `images[weekOfYear %
  images.length]`. No Unsplash hotlink ships.
- **E1 — goal-split populations must match.** Divisor = estimator-only role set — reuse
  `SalesDash.jsx:93`'s exact set; ensure the numerator's `sales_name` space is the same (an unfiltered
  dropdown lets an Admin be a `sales_name`), or per-rep targets won't sum to the company goal.
- **E2 — divide-by-zero guard:** `goal ÷ Math.max(count, 1)` (a role-string typo → 0 → `Infinity`
  breaks the bar + donut View 1).
- **F1 — one "sold this month" basis.** `created_at` false-negatives a job created last month / sold
  this month; `footerStats` keys month on WTC `end_date` (a third basis) → two $ figures can disagree.
  Pick ONE basis and use it in hero + money bar + thermometer consistently.
- **K1 — calls-this-month isn't free:** snapshot select (`followUp.js:107`) omits `logged_by`; add it,
  and note `logged_by` (free-text displayName) can diverge from `sales_name` on a null-name rep.
- **G1 — orphan Sold proposals** (null `call_log_id`) silently drop from every rep's scoreboard/hero;
  apply the shipped selectors' `customer_id` fallback.
- **H1 — no chart lib:** donut + thermometer are hand-rolled SVG. Add an SVG primitive spec
  (radius / stroke / overflow-arc geometry) or explicitly flag "two charts" as beyond pure reskin.
- **I1 — migration hygiene:** ordered deploy checklist (push migration + verify ledger → THEN deploy
  Home), a paired `_revert_` twin file, a `rehearse.sh` call-out, and the column type pinned (`int`).
- **J1 — design-token scale:** add a per-surface white→linen map (which card → `C.linenCard` / `linen`
  / `linenDeep` / `dark`) + a spacing/radius/font-size scale in `tokens.js` to enforce "anchor both
  edges" and the same-weight effort hero, or boxes drift flat.
- **L1 — best-month badge:** require ≥1 **non-zero** prior month and **strictly-greater** (trips on any
  first sale otherwise; ties undefined).
- **L2 — dissolved** (View 2 deferred). **L3 — backlog:** mandate embedded-array form for any future
  `proposal_recipients` join.
- **CLEAN — do NOT re-chase:** role-gating on Settings inputs (real DB policy + `canManage`), anon /
  shared-DB exposure (explicit column list, not in PowerSync publication), pagination (`.range()`).

---

## 2026-08-15 amendment (part 5) — round-2 audit response [LOCKED — Chris]

_Response to round-2 audit (rev `83b6d45`, pattern: amendment-not-integrated — 19 caused-by, scope-cut
fired). **Chris ratified Option A: ship now with the existing weeks runway; defer the %-runway.** This
part integrates inline (marks the superseded runway sections above) rather than append-and-leave —
that append habit was the round-2 pattern. **This is now the newest source of truth.**_

### A. Runway — SHIP THE EXISTING WEEKS BAR AS-IS [LOCKED — Option A]
- Box 3 relocates `src/components/followup/RunwayBar.jsx` **unchanged** — existing `schedule_runway_weeks`
  value, existing color logic, existing editor. No rewrite, no slide-up, no new column, **zero migrations.**
- **DEFERRED to its own future loop** (dissolves round-2 findings B1–B7, C1, C3, C5): the whole
  %-of-crew-booked model — `schedule_crew_booked_pct` column + migration, `bandOf()` 5-band scale, the
  `C.critical`/`C.orange` tokens, slide-up + hysteresis, the % Settings input. Parked as amendment
  parts 1/2/4-§A (now banner-marked DEFERRED). When picked up, it gets its own plan + audit.
- **Result:** back to the original zero-migration scope; the build matches the approved mockup (which
  shows the weeks runway).

### B. Broken round-1 fixes — CORRECT regardless of the runway (personal boxes)
- **REG-1 / orphan Sold proposals [LOCKED — fix].** A Sold proposal with null `call_log_id`
  (`followUp.js:183`) has no key into the `call_log_id → sales_name` map, so `customer_id` fallback
  recovers a *customer*, not a *rep*. **Fix: orphan Sold proposals are unattributable to a rep →
  EXCLUDE them from every per-rep figure (hero, money bar, Sold tile).** They still count in the
  company thermometer/footer (which sums all proposals). Do not pretend a rep owns them.
- **REG-2 / goal-split divisor [LOCKED — fix].** Do NOT reuse `SalesDash.jsx:93`'s set — verified it is
  `["Sales Rep","Admin","Manager"]` (includes non-selling admins → understates targets, the exact bug).
  **Fix: divisor = count of DISTINCT active people who actually carry jobs (appear in
  `call_log.sales_name`)** — by construction the SAME population the numerator sums over, so per-rep
  targets always sum to the company goal. (Sidesteps the role-string question entirely; confirm the
  `sales_name` population at build.)

### C. Other live findings folded in (personal boxes + charts + doc hygiene)
- **F1 / one "sold this month" basis [LOCKED]:** the single basis is **`proposals.created_at`**, used
  identically by hero + money bar + thermometer. `footerStats` (`followUp.js:254`) keys on WTC
  `end_date` because it is a **different metric (billings %, not bookings-sold)** — keep them distinct,
  never cross-compare. (Fixes the "two $ figures disagree" risk by naming the basis + separating the
  billings metric.)
- **N1 / A2 nav-seed [LOCKED]:** seed `CallLog.jsx:31` `filters.sales` from **`teamMember.name`**, not
  the raw `displayName` (which can be an email fallback → matches zero `salesOptions` → tile ≠ list).
  If name is absent, leave the seed empty (no-op) rather than seeding an email.
- **N2 / footer scope [LOCKED — resolve contradiction]:** `footerStats` + the thermometer are
  **company-wide / un-split** (NOT rep-scoped). Only hero, money bar, scoreboard, and finder are
  rep-scoped. Correct the amendment-part-4 A1 wording that implied `footerStats` gets a rep variant —
  it does not (it sums pre-scope and can't be filtered post-hoc).
- **C6 / best-month badge [LOCKED]:** apply the L1 guard at the source (Box 1) — badge requires **≥1
  non-zero prior month** AND **strictly-greater**, so it doesn't trip on a rep's first-ever sale.
- **C7 / teal button text [LOCKED — build-checklist line]:** the mockup's teal "Call Dana Kessler"
  button uses white text; per `CLAUDE.md` style rule #2 **teal buttons get BLACK text (`C.dark`)** —
  a hard build check, not a loose note.
- **K1 / calls-this-month [DERIVED — note]:** add `logged_by` to the outreach select; `logged_by` can
  be a free-text displayName that diverges from `sales_name` on a null-name rep — count by the same
  identity the rest of the rep-scoping uses, not raw `logged_by`.

### D. REG-3 — layout token scale (concrete values, was only a principle) [LOCKED]
Add to `src/lib/tokens.js` so "anchor both edges" + the same-weight effort hero are enforceable, not
aspirational:
- **Surface map:** page bg → `C.linen`; every card/box → `C.linenCard`; inset wells (bar tracks, donut
  hole, input fields) → `C.linenDeep`; dark accents (dollar badges, dark chips) → `C.dark`. **No white
  anywhere.**
- **Spacing scale (px):** `4 · 8 · 12 · 16 · 24 · 32 · 48` (card padding = 24, box gap = 16, section gap
  = 32).
- **Radius scale (px):** `8` (chips/badges) · `12` (cards) · `18` (hero/feature).
- **Font-size scale (px):** hero number 56 · box number/`$` 40 · sub-headline 20 · body 14 · label 11
  (uppercase, `letter-spacing 0.1em`). Hero results-`$` and effort-number use the **same 56** (the
  "same weight" rule). Fonts per `F` (display = Barlow Condensed for numbers, body = Barlow, ui = Inter).

### E. REG-4 — SVG chart geometry (concrete, was absent) [LOCKED]
Both charts are hand-rolled SVG (no chart lib). Numbers the build uses:
- **Donut:** `viewBox 0 0 100 100`, radius `r = 42`, `stroke-width 16`, fill from top (`transform:
  rotate(-90deg)`). Circumference `C = 2πr ≈ 263.9`; each slice = `stroke-dasharray: (pct/100·C) (C)`,
  offsets accumulated. **Overflow (>100%, View 1 over-target):** cap the ring at full + a thin inner
  overflow arc, never a broken >100% ring. **Single slice:** one full ring. **Empty ($0):** muted full
  ring in `C.linenDeep`. Track ring = `C.linenDeep`; slices from the ramp/booked teal.
- **Thermometer:** horizontal rounded bar, height `12`, radius `6`, track `C.linenDeep`, fill width =
  `pct%` in teal, `pct` label right-anchored (the anchor-both-edges rule).

### F. Doc hygiene [LOCKED]
Superseded runway sections above now carry inline `⚠ DEFERRED` / `⚠ SUPERSEDED` banners (Box 3 slide-up,
donut cycle, amendment parts 1/2/4-§A, top scope box). A builder reading top→bottom can no longer ship a
parked spec. **Build order of truth: part 5 > part 4 > parts 1–3 > original boxes.**

