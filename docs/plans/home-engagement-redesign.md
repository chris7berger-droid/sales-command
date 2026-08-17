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

**The goal number [LOCKED — split; corrected by part 5 §B / R2 round-3]:** company goal ÷ N = each
rep's personal target.
- Source: `tenant_config.monthly_billing_goal` (Admin/Manager sets it in Settings — already exists).
- **Divisor `N` = count of DISTINCT active reps who carry jobs (appear in `call_log.sales_name`)** —
  the SAME population the numerator (sold $ by `sales_name`) sums over, and the same space `bidDueAlerts`
  scopes by. This guarantees per-rep targets sum to the company goal. **Do NOT query
  `team_members` by role** (that set includes non-selling Admin/Manager — the REG-2 bug). No new table,
  no migration.
- **Arithmetic [LOCKED — R3]:** the `goal ÷ N` tile is assigned to **ALL N** distinct-`sales_name`
  reps, **including $0-sold reps who carry jobs** — otherwise Σ(per-rep targets) < company goal.

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
3. **Business, in the open** (shared: crew runway + goal thermometer) — runway is the **existing weeks
   bar, static** (the slide-up is deferred with the %-runway; see part 5 §A).
4. **Your book** (personal scoreboard: Wants Bid → Has Bid → Sold, tap to drill).
5. **What you owe** (bids due + self-set follow-ups; celebrates when clear).
6. **Where to hunt** (opportunity finder + dormant/quiet lists).

**Build scope reminder (honest — see top scope box + part 5):** **zero migrations, no backend.** But
NOT all "trivial": beyond the read-only column adds (`follow_up`, `viewed_at` via an **embedded
`proposal_recipients` relation** — a shape change, not a flat column — `logged_by`, + a
distinct-`call_log.sales_name` rep count for the goal split), the build also writes **net-new per-rep
scoped selector variants** and **two hand-built SVG charts** (donut + thermometer). The weeks
`RunwayBar` is reused **as-is**.
Next step: **audits complete (R1–R3, converged) → build session** against this doc (buildvsplan +
preview smoke before merge). ERD Loop #45 stays open until the screen is accepted + smoke-verified.

---

## Audit manifest

_Regenerated by `/auditcriteria` 2026-08-15 for **round 3** — a **verify-only** pass. Round 2's
scope-cut (Option A) removed the %-runway from this build, so this round is narrow: confirm amendment
**part 5's** fixes actually took, and that the deferred sections can't be built by mistake. Consumed by
`/runaudit`._

### Bottom line (plain English)
Small, focused double-check — not a broad review. The risky new "% of crew booked" runway was cut to
its own project, so all that's left is confirming the handful of specific fixes we just made to the
personal boxes actually hold up in the code (last round proved a fix can read fine on paper and still be
wrong), and that a builder can't accidentally build the parked runway version. Two reviewers, in and out.

### Round
- Plan type: feature (presentation reskin — **zero migrations**; %-runway deferred to backlog F49).
- **Round 3 EXECUTED + responded** (2026-08-17). 3 caused-by (2H/1M) — **84% drop 19→3, converged.**
  Pattern: amendment-not-integrated (recurring, now narrowed to Box 2). All 3 were integration misses of
  part-5's goal-split fix; **corrected in revision pass 3** (R1: Box 2 body + lines 227/479 now say
  divisor = distinct `call_log.sales_name`; R2: N1 nav-seed rewired via a hoisted `repName` prop from
  `App.jsx`; R3: `goal ÷ N` assigned to ALL N reps incl. $0-sold).
- Findings trend: round 1 (15) → round 2 (19) → round 3 (3) — converging, no plateau.
- **Recommendation (audit + planning agree): NO round 4.** The 3 fixes are doc-integration + one wiring
  cite — **verify at build via `/buildvsplan`** (grep the plan for the killed patterns: "active
  estimators" / `team_members` role query / `teamMember.name` seed). Build-ready after this pass.

### Prior rounds
- Round 1: `67fab47` · 5H/6M/4L · reuse-premise-mismatch
- Round 2: `83b6d45` (audited) → `182e7dc` (response) · 7H/9M/3L · amendment-not-integrated

**Briefing for agents**: do NOT re-audit the **DEFERRED %-runway** (amendment parts 1/2/4-§A + part-3
donut View 2 — all banner-marked; it lives on as backlog F49 with its own future loop). Do NOT re-find
round-1/round-2 findings already addressed. Attack ONLY (a) whether amendment **part 5's** specific
fixes are correct + complete against the cited code, and (b) whether the deferred sections are
unmissably marked so a top-down builder can't ship parked spec.

### Deployment context
- **Live tenants**: 1 — HDSP only. Shared Supabase project `pbgvgjjuhnpsumnowuym`.
- **Prod / staging / dev**: Home is the live-prod landing (salescommand.app); Vercel preview first.
- **Blocking feature flags**: none. **Concurrency**: ≤5 users, single tenant (race findings cap Low).
- **Zero migrations this build** — the one column was deferred with F49. Weeks `RunwayBar` ships
  unchanged (already live + verified). No cross-repo write.

### Time budget + finding cap
- **Time budget**: ~120 min (verify pass only).
- **Finding cap**: 12. Lead with any HIGH (= a fix that didn't take).

### Surface
- Plan doc ~660 lines — carries the deferred %-runway spec as **banner-marked parked history**, NOT
  live scope. Build order of truth (per part 5 §F): part 5 > part 4 > parts 1–3 > original boxes.
- Live [LOCKED] scope for THIS build: the 6 boxes + part-5 corrections. Deferred: parts 1/2/4-§A runway
  + part-3 donut View 2.
- [DESIGN-OPEN]: 1 live — scoreboard stage-label strings for drill-in. (Band-boundary + estimator-role
  items retired with the %-runway defer / resolved by part 5's `sales_name` divisor.)

### Layers touched (this build, post-cut)
- UI / components (reskin; weeks `RunwayBar` relocated **as-is**; hand-rolled SVG donut + thermometer)
- Data layer (per-rep-scoped selector variants; embedded `proposal_recipients`; `logged_by`; goal-split divisor)
- Design system / tokens (concrete scale + surface map — **no new brand colors this build**;
  `C.critical`/`C.orange` are deferred with F49)
- (No migration, no cross-repo, no RLS, no edge fns.)

### New mechanisms introduced (this build)
- Net-new rep-scoped selectors + `call_log_id → sales_name` map (verify REG-1 orphan handling).
- Goal-split divisor = distinct active `sales_name` reps (verify REG-2).
- Embedded `proposal_recipients(sent_at, viewed_at)` relation; `logged_by` add.
- Hand-rolled SVG donut (2 views) + thermometer — geometry specified (part 5 §E).
- Token scale + surface map (part 5 §D).
- Hero image weekly rotation over a bundled set — **[BLOCKED]** gate.
- **NO new column, NO new brand tokens this build** (deferred to F49).

### Cross-system reach
- none this build — the migration was deferred; reads only.

### Irreversibility
- none — zero migrations, no backfill, no public-API change. Fully reversible (branch + preview).

### Known weak points (round-3 = verify each part-5 fix took)
1. **REG-1 orphan Sold.** Verify part 5 §B excludes null-`call_log_id` Sold proposals from every per-rep
   figure (hero/bar/Sold tile) yet keeps them in the company thermometer, and that no per-rep path still
   sums them. `followUp.js:183`.
2. **REG-2 goal-split divisor.** Verify divisor = distinct active reps appearing in `call_log.sales_name`
   (same population as the numerator), NOT `SalesDash.jsx:93`'s `["Sales Rep","Admin","Manager"]`, and
   that per-rep targets sum to the company goal.
3. **F1 single basis.** Verify `proposals.created_at` is the sole "sold this month" basis in hero + bar
   + thermometer, and `footerStats` (WTC `end_date`, a billings metric) is kept distinct, not cross-compared.
4. **N1 nav-seed.** Verify the corrected R2 wiring: a clean `repName` (`teamMember?.name`, NO email
   fallback) is hoisted in `App.jsx` and passed into `Home`; `CallLog` nav-state `sales` seeds from
   `repName`; empty seed if absent. (`teamMember` is NOT in scope in `Home.jsx` — the old
   `teamMember.name` phrasing was unbuildable.)
5. **N2 footer scope.** Verify `footerStats`/thermometer stay company-wide (NOT rep-scoped) and the
   part-4 A1 wording implying a rep variant is corrected.
6. **REG-3 token scale.** Verify part 5 §D gives concrete values (surface map + spacing/radius/font
   scale), not just a restated principle.
7. **REG-4 SVG geometry.** Verify part 5 §E gives real numbers (donut r/stroke/circumference/overflow/
   empty; thermometer) — buildable without a chart lib.
8. **C6 / C7.** Verify best-month badge guard (≥1 non-zero prior + strictly-greater) at Box 1 source, and
   teal-button-black-text is a hard build-checklist line (`CLAUDE.md` rule #2).
9. **Deferred-section markers.** Verify the %-runway (parts 1/2/4-§A) + donut View 2 (part 3) carry
   unmissable DEFERRED/SUPERSEDED banners so a top-down builder can't ship parked spec.

### Open questions
- Count: 1 live — scoreboard stage-label strings for drill-in. (Band-boundary / estimator-role questions
  retired with the %-runway defer.)

### Suggested attack angles (2)
1. **Part-5 fix correctness** — did the round-2 fixes take? Reading: `src/lib/followUp.js` (`:183`
   orphan, snapshot selects, `footerStats:254`), `src/pages/SalesDash.jsx:93` (the wrong set to avoid),
   `src/pages/CallLog.jsx:31` (nav-seed), `src/App.jsx:210` (displayName), `src/lib/tokens.js` (scale).
   Pressure: REG-1, REG-2, F1, N1, N2, C6, C7, K1 — each verified against the cited code; a fix that's
   logically wrong or half-specified is a HIGH (the exact class round 2 caught).
2. **Scope-integrity + build-readiness** — is the deferred %-runway truly out, and the parked spec
   unmissable? Reading: amendment parts 1/2/4-§A + part 3 (banners), part 5 §D/§E (token scale + SVG
   geometry), `src/assets/` (hero [BLOCKED]). Pressure: can a top-down builder accidentally build the
   %-runway or donut View 2? Are the token scale + SVG geometry concrete enough to build from? Is the
   hero-image [BLOCKED] gate real? Anything still mislabeled "reskin/zero-DB"?

### Suggested agent count: 2

Rationale: verify-only pass — one agent on whether part-5's fixes hold against the code (round-2's
failure mode), one on scope-integrity (deferred sections stay out, build-gates concrete). No third
angle because the %-runway — round-2's entire heavy surface — was cut, not audited.

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
personal target** (target = company goal ÷ N distinct `sales_name` reps — the same number the bar uses,
per Box 2 / part 5 §B). If sold
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
  - **Arithmetic [LOCKED — R3]:** `target = goal ÷ N` is assigned to **ALL N** distinct-`sales_name`
    reps, **including reps who carry jobs but have $0 sold this month.** If tiles show only for reps
    with sales (M < N), Σ(targets) = goal·M/N < goal — the sum breaks. Every one of the N gets a tile.

### C. Other live findings folded in (personal boxes + charts + doc hygiene)
- **F1 / one "sold this month" basis [LOCKED]:** the single basis is **`proposals.created_at`**, used
  identically by hero + money bar + thermometer. `footerStats` (`followUp.js:254`) keys on WTC
  `end_date` because it is a **different metric (billings %, not bookings-sold)** — keep them distinct,
  never cross-compare. (Fixes the "two $ figures disagree" risk by naming the basis + separating the
  billings metric.)
- **N1 / A2 nav-seed [LOCKED — corrected R2 round-3]:** the trap is that `Home.jsx:32` only receives
  `{ displayName, displayRole }`, and `displayName` is already the **email fallback**
  (`App.jsx:210`: `teamMember?.name ?? session?.user?.email ?? ""`) — and `teamMember` is NOT a prop of
  Home. So "seed from `teamMember.name`" is unbuildable at the seed site. **Fix: hoist a clean rep-name
  in `App.jsx` — `const repName = teamMember?.name ?? "" ` (NO email fallback) — and pass it as a new
  `repName` prop into `Home` (`App.jsx:233` mount).** Box 4's tap seeds `CallLog` nav-state `sales` from
  `repName`; if `repName` is empty, seed empty (no-op) so it never seeds an email that matches zero
  `salesOptions`.
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

