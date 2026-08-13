# Plan — Home Screen → Engagement Redesign

Confidence tags: **[LOCKED]** = Chris-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = waiting on something.

**Type:** feature (presentation redesign)

**Status:** 🟡 IN PLANNING — building the build spec one box at a time, committed as each locks.

**What this is:** the *reskin* of Home into the shape in `docs/HOME_ENGAGEMENT_VISION.md`. It is NOT
the engine — the engine (snapshot loader, dormant/gone-quiet lists, follow-up + bid-due logic) shipped
per `docs/plans/home-follow-up-screen.md` (FROZEN) and is reused as-is. This doc governs the
presentation of `src/pages/Home.jsx` + `src/components/followup/*` only.

**Scope guardrails (from the ratified vision):** ships the "now" column only — reskin + read-only
selectors + two charts. **Zero new migrations, zero backend, zero new architecture.** Everything reads
tables the snapshot already fetches.

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
- Caveat [DERIVED]: proposals have no `sold_at` — "sold this month" keys on proposal `created_at`
  (or `call_log.updated_at`), not the moment it flipped to Sold. Acceptable for v1; note in build.

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
  (or `call_log.updated_at`). Verify at build; a job sold this month but created last month is the
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

**Crew runway [LOCKED — reuse existing]:** the weeks-of-booked-work bar already built (`RunwayBar`,
reads `tenant_config.schedule_runway_weeks`; Admin/Manager enters, all see). This redesign **relocates
it here** and keeps its behavior:
- Color by threshold (calm when booked out → warning color when thin), as today.
- **Critical slide-up [LOCKED]:** when runway goes critical it slides up **above the money bar** and
  turns its hot/tension color — a nudge, NOT a takeover. The YOU box (#1) never moves.

**Shared goal thermometer [LOCKED]:** the whole team's progress toward the company goal. One rope,
**no ranking, no leaderboard** (natural competition self-surfaces privately).
- Tracks **the month [LOCKED — A]:** everyone's money **sold this month** vs the **un-split** company
  goal (`tenant_config.monthly_billing_goal`). Same monthly clock as the personal money bar.

**Layout intent:** shared row under the personal money bar — runway on one side, thermometer on the
other (or stacked on narrow screens). Calm by default; the runway is the only element that moves
(slides up) and only when critical.

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

_Generated 2026-08-13 (round 1). Consumed by `/runaudit` to size the adversarial audit pass. This
plan has NOT been audited yet — the audit runs in a separate terminal._

### Bottom line (plain English)
A presentation reskin of the Home screen — six stacked boxes over an engine that already ships.
**No migrations, no backend, no new architecture.** The risk is not schema or blast radius; it's
**derivation correctness** hiding under "zero-DB": per-estimator scoping done by name-matching,
"money sold this month" keyed on a proxy date, a goal split by a live headcount, and four
opportunity angles that must actually be computable from the snapshot as written. The audit's job is
to prove those derivations hold and that nothing labeled "trivial column add" secretly needs a
migration.

### Round
- Plan type: feature (presentation reskin)
- Current round: 1 (first audit — no prior rounds)
- Plan revision under audit: `c32a4ab` (Box 6 + assembled order — plan complete)
- Findings trend: n/a (round 1). Establish the baseline; expect a **premise-vs-data-reality**
  pattern (does the snapshot really carry what each box claims).

### Deployment context
- **Live tenants**: 1 — HDSP only. Sales + Field share Supabase project `pbgvgjjuhnpsumnowuym`.
- **Prod / staging / dev**: Home is the live-prod post-auth landing (salescommand.app); ships to a
  Vercel preview branch first, never straight to prod.
- **Blocking feature flags**: none.
- **Concurrency profile**: ≤5 users, single tenant. Multi-user race findings cap at Low.
- **Design-baseline note**: this plan reskins `src/pages/Home.jsx` **as it exists today** (143 lines;
  the RunwayBar is currently the top element). Audit must verify entry points against the real file,
  not the vision doc.

### Time budget + finding cap
- **Time budget**: ~600 min (est. ~10h build — 6 boxes + finder + 2 charts + small derivations).
- **Finding cap**: 35 findings (nominal — reskin surface is narrower than the sibling engine plan).
  Synthesis should lead with the top ~5.

### Surface
- Plan doc: `docs/plans/home-engagement-redesign.md` (~180 lines).
- Sections: 9 (Data-on-hand + Box 1–6 + Assembled order + this manifest).
- [LOCKED] decisions: 6 (one per box, all Chris-ratified 2026-08-13).
- [DERIVED] items to verify: sold-this-month proxy date; drill-in stage labels; team_members estimator
  role value.
- [DESIGN-OPEN] items: 2 minor — exact estimator role string for the goal split; exact stage label
  strings for scoreboard drill-in.
- Companion inputs (not under audit, but the source of truth): `docs/HOME_ENGAGEMENT_VISION.md`
  (ratified vision), `docs/plans/home-follow-up-screen.md` (FROZEN engine plan).

### Known weak points (round-1 focus)
1. **Name-match scoping.** Per-rep everything (hero, money bar, book, finder) filters on
   `call_log.sales_name === displayName`. `displayName` = `teamMember?.name` (`App.jsx:210`).
   Verify these are the *same* string space — a mismatch silently zeroes every personal box.
2. **"Money sold this month" proxy.** Proposals have no `sold_at`; the plan keys on `created_at`
   (or `call_log.updated_at`). Confirm the chosen proxy is defensible and consistent across the
   money bar + thermometer + hero.
3. **"Zero-DB" claim.** Three "trivial column adds" (`follow_up`, `viewed_at`/`sent_at` on
   proposals) and one headcount read (`team_members` active estimators). Verify each column truly
   **exists** (no migration hiding) and the estimator role value is real.
4. **Goal split integrity.** company `monthly_billing_goal` ÷ active estimators — verify divide-by-
   zero / single-user / role-mislabel behavior, and that it's a *billing* goal repurposed as a
   *sold* target per Chris's ratified call (not silently mixing the two).
5. **Finder buildability.** The 4 v1 angles (#1/#3/#5/#2) must be computable from the snapshot;
   **#2 "Almost Yes"** specifically needs `viewed_at`/`sent_at` added to the proposals select.
   Verify each angle's data is present and the auto-rank/serve-one has something to rank.
6. **Scope creep.** Confirm the two charts (donut + thermometer) and read-only selectors stay
   client-side — no new endpoint, job, or table sneaks in under "reskin."

### Cross-system reach
- `command-suite-db` — only to confirm columns exist (`call_log.follow_up`, proposal
  `viewed_at`/`sent_at`, `team_members.role`/`active`). No schema *change* is in scope; a finding
  that one is needed is a scope-breaker worth flagging High.
- Shared project `pbgvgjjuhnpsumnowuym` — reads only; no policy or write-path change.

### Irreversibility
- None. No migrations, no backfill, no public-API change. Fully reversible (branch + preview).

### Open questions
- Exact `team_members.role` value(s) that count as "estimator" for the goal split.
- Exact `call_log.stage` label strings for the scoreboard drill-in nav state.

### Suggested attack angles (3)
1. **Per-rep derivation correctness** — Boxes 1/2/4. Reading: `src/lib/followUp.js`,
   `src/pages/Home.jsx`, `src/App.jsx:210` (displayName), proposal `created_at` proxy. Pressure:
   does per-rep money-sold-this-month compute right? Is `sales_name` vs `displayName` the same space?
   Best-month edge cases (first month, ties, zero history)?
2. **"Zero-DB" + reuse fidelity** — Boxes 2/3/5. Reading: snapshot select in `followUp.js`,
   `CallLogDetail.jsx:619` (`follow_up`), `Settings.jsx:682` (goals), `team_members` usage
   (`ImportToLiveWizard.jsx:219`), `RunwayBar`. Pressure: are all column adds truly non-migration?
   Goal-split headcount source solid? RunwayBar relocate + critical slide-up + company thermometer
   sum buildable as written?
3. **Finder buildability + scope discipline** — Box 6 + overall. Reading: `followUp.js`
   dormant/goneQuiet, `ProposalDetail.jsx:1377` (`viewed_at`), `CallLog.jsx:29` (drill target).
   Pressure: are the 4 angles computable from the snapshot? Does #2 need a column add? Do the 2
   charts / selectors stay client-side, or does anything drag in new architecture? Verify the reskin
   attaches to the *current* Home.jsx entry points.

### Suggested agent count: 3

