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

**Scope guardrails (from the ratified vision):** ships the "now" column only — reskin + read-only
selectors + two charts. Originally **zero migrations** — **amended 2026-08-15:** exactly **one small
migration** now in scope (two per-customer runway-threshold columns on `tenant_config`; see the
amendment). Everything else still reads tables the snapshot already fetches; no backend, no new
architecture.

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

_Regenerated by `/auditcriteria` 2026-08-15 after the amendment. Consumed by `/runaudit`.
**Round 1 (revised)** — no `/runaudit` has executed yet; this supersedes the 2026-08-13 draft, which
predated the mockup + migration decisions. (Not "round 2": round numbers track *completed* audits, and
none has completed.)_

### Bottom line (plain English)
Still a Home-screen reskin over a shipped engine — but no longer "zero database." It now carries
**one small DB change** (two per-customer runway-threshold settings) and gets built to match an
**approved mockup that was designed in the wrong colors.** So two real risks join the original: (1)
that tiny change must land in the shared database **in the right order**, and only the **right role**
(Admin/Manager) may set those thresholds; (2) the build must **repaint** the mockup into our real
brand colors, not ship the designer's. The original risk stands: the "personal" numbers are derived
by **matching a rep's name**, which must actually line up. Pointing **4 reviewers** at it — up from 3,
because the migration + settings write-path is genuinely new surface.

### Round
- Plan type: feature (presentation reskin + one small config migration)
- **Round 1 EXECUTED + responded** (2026-08-15). Report pattern: reuse-premise-mismatch — 5H themes /
  6M / 4L / 3 clean. Response = **amendment part 4** (runway %-model pivot + View 2 defer + fix ledger).
- **⚠ This manifest is now stale for round 2** — scope changed materially: migration shrank **2 cols →
  1** (`schedule_crew_booked_pct`), the two Settings threshold inputs became **one**, donut View 2 +
  its `work_type` select-add are **gone**, and the runway is a **rewrite** (not reuse). **Re-run
  `/auditcriteria` before round-2 `/runaudit`.**
- Plan revision (round-1 response): commit noted in `Plan revision pass 1` (see git log).
- Findings trend: round 1 (5H/6M/4L) → round 2 (?). Expect the reuse-premise theme to *shrink* (the
  %-pivot + View 2 defer remove its biggest drivers); watch for new issues in the RunwayBar rewrite.

### Deployment context
- **Live tenants**: 1 — HDSP only. Sales + Field share Supabase project `pbgvgjjuhnpsumnowuym`.
- **Prod / staging / dev**: Home is the live-prod post-auth landing (salescommand.app); ships to a
  Vercel preview branch first, never straight to prod.
- **Blocking feature flags**: none.
- **Concurrency profile**: ≤5 users, single tenant. Multi-user race findings cap at Low.
- **Shared-DB note (NEW):** the migration adds two **additive, nullable** columns to `tenant_config`
  on the **shared** project (Field reads it too) — low blast radius, but it IS a shared-DB schema
  change, authored + pushed via `command-suite-db` (rehearse-before-push applies).
- **Design-baseline note**: reskins `src/pages/Home.jsx` **as it exists today**. Audit verifies entry
  points against the real file, not the vision/mockup.

### Time budget + finding cap
- **Time budget**: ~690 min (round-1 ~600 + ~90 for the migration, two Settings inputs + role-gating,
  3-state runway logic).
- **Finding cap**: 40 findings (nominal — reskin surface). Synthesis leads with the top ~5.

### Surface
- Plan doc: `docs/plans/home-engagement-redesign.md` (~380 lines).
- Sections: 10 (Data-on-hand + Box 1–6 + Assembled order + 2026-08-15 amendment + this manifest).
- [LOCKED] decisions: ~13 (6 boxes + 7 amendment items, all Chris-ratified).
- [DESIGN-OPEN] items: 2 — estimator role string; scoreboard stage-label strings. (The effort-state
  hero + amber/red runway states are now **specified** in amendment part 2 — no longer open.)
- [OPEN] items: 0.
- Baseline (§0-equivalent): "Data on hand … verified 2026-08-13" — read-verified current state with
  `file:line` evidence (`loadSnapshot()` in `followUp.js`). Should be retitled `§0 Baseline` for
  convention; substance is present, so not blocking.

### Layers touched
- UI / components (whole reskin)
- Data layer (snapshot selectors)
- State model (derived per-rep fields; 3-state runway)
- **Migrations / schema (NEW)** — two `tenant_config` columns
- **Cross-repo (NEW)** — `command-suite-db` authors + pushes the migration; shared Supabase gets it
- **Settings write-path / role-gating (NEW)** — Admin/Manager-only threshold inputs
- (No edge fns, no external integrations in v1 — QB deferred.)

### New mechanisms introduced
- New columns: `tenant_config.runway_amber_weeks`, `runway_red_weeks` (int/numeric, nullable).
- New Settings inputs (2) + role-gated write path.
- 3-state runway derivation (threshold compare → green/amber/red + slide-up).
- Hero image weekly rotation (deterministic date-indexed selector over a self-hosted set).
- Snapshot selector adds: `follow_up`, `viewed_at`/`sent_at` (round 1) + **`proposal_wtc.work_type_id`
  + `work_types(name)`** for the donut's work-type view (amendment part 3; columns exist, zero-DB).
- Palette translation (mockup → `tokens.js`) — fidelity risk, not a code mechanism.

### Cross-system reach
- `command-suite-db` — now a **write** (authors + pushes the migration), not just a column-existence
  read. Ledger-coordinated; rehearse-before-push.
- Shared project `pbgvgjjuhnpsumnowuym` — additive schema change (nullable columns); verify it does
  not newly expose `tenant_config` through any anon/PowerSync publication.

### Irreversibility
- One **additive** migration (two nullable `tenant_config` columns) — reversible (drop),
  ledger-coordinated in `command-suite-db`. No backfill, no destructive change, no public-API change.
  Low but non-zero (was "none" in the draft).

### Known weak points
_Round-1 five still stand — agents re-verify: (1) name-match scoping, (2) sold-this-month proxy,
(3) remaining zero-DB column-exists claims, (4) goal-split integrity, (5) finder buildability._
NEW with the amendment:
6. **Apply-before-read ordering.** If the Settings UI / 3-state logic reads the new threshold columns
   before the migration is applied to prod, they read null → runway state misbehaves. Migration must
   land (+ ledger-recorded) before the reading code ships.
7. **Null-threshold default state.** New customer / HDSP-pre-entry has null thresholds. Define the
   runway's default state when unset — don't let a null compare produce a false red or a crash.
8. **Settings write-path role-gating.** Thresholds are money/ops config → **Admin/Manager only**
   (Sales uploads docs, never configures). Verify the two inputs are gated like other money fields.
9. **Palette-translation fidelity.** Build works from an off-brand mockup (ChatGPT teal `#008678`,
   white-text teal button, purple/orange). Risk it ships those colors / white button text, breaking
   brand rules (no white bg; teal buttons = black text). Needs an explicit "translated to `tokens.js`"
   check, not eyeballing.
10. **Now-specified states — verify buildability, not existence.** The $0 effort-state hero and the
   amber/red runway states are now spec'd (amendment part 2). Pressure shifts: is the runway state
   machine correct at the **exact boundaries** (weeks = red_weeks, = amber_weeks), does the null →
   default (amber=3/red=2) fallback hold, and does the red **slide-up reorder** (not overlay) leave
   the YOU hero fixed? Confirm the effort hero never renders `$0` and the empty-everything fallback
   fires.

### Open questions
- Count: 4. Highest-pressure: (a) exact `team_members.role` value(s) counting as "estimator";
  (b) runway default state when thresholds are null.

### Suggested attack angles (4)
1. **Per-rep derivation correctness** — Boxes 1/2/4 + finder. Reading: `src/lib/followUp.js`,
   `src/pages/Home.jsx`, `src/App.jsx:210` (displayName), proposal `created_at` proxy. Pressure: does
   per-rep money-sold-this-month compute right? `sales_name` vs `displayName` same string space?
   Best-month edges (first month, ties, zero history)? Goal split ÷ headcount (divide-by-zero /
   single-user)? Are the 4 finder angles computable, and does #2 need `viewed_at`/`sent_at`?
2. **New migration + Settings write-path + cross-repo ordering** — the amendment's new surface.
   Reading: `command-suite-db` migration flow + ledger + `scripts/`, `Settings.jsx:682` (goals input
   pattern + role-gating), `RunwayBar`, `tenant_config` schema. Pressure: migration additive +
   ledger-coordinated + rehearsed? Apply-before-read ordering enforced? Null-threshold default state
   defined? Two threshold inputs **Admin/Manager-gated** like other money config? 3-state compare
   correct at boundaries (exactly 2 wk = amber, not red)?
3. **"Zero-DB" reuse fidelity + scope discipline** — Boxes 2/3/5 + assembled order. Reading: snapshot
   select in `followUp.js`, `CallLogDetail.jsx:619` (`follow_up`), `ProposalDetail.jsx:1377`
   (`viewed_at`), `team_members` usage (`ImportToLiveWizard.jsx:219`), the `loadSnapshot`
   `proposal_wtc` select. Pressure: are the *remaining* "trivial column adds" truly non-migration
   (columns exist)? **Specifically the donut work-type view (amendment part 3) needs
   `proposal_wtc.work_type_id` + `work_types(name)` added to the select — verify it's a pure select
   add, not a join that changes row shape or a migration.** Do the 2 charts + selectors stay
   client-side — nothing else drags in a second migration or endpoint under "reskin"?
4. **Visual-target translation fidelity + layout** — the mockup-to-code risk. Reading:
   `docs/home-engagement-mockup-v1.png`, `src/lib/tokens.js`, `CLAUDE.md` style rules, current
   `src/pages/Home.jsx`. Pressure: does the plan force a **`tokens.js` remap** (no ChatGPT colors, no
   white bg, teal buttons = black text)? Do the **now-specified states** (effort hero, amber/red
   runway — amendment part 2) hold at the boundary + null-default cases, and does the red slide-up
   reorder leave the hero fixed? Is the **anchor-both-edges / pair-don't-pad** rule concrete enough to
   apply? Hero rotation self-hosted + licensed (not the Unsplash hotlink)?

### Suggested agent count: 4

Rationale: 6 layers + a cross-system write (`command-suite-db`) + ≥3 novel mechanisms formulaically
points at 5, but the two lightest clusters (reuse-fidelity + translation) don't each merit a full
agent — 4 covers derivation, the new migration/write-path, reuse-scope, and mockup-translation
without padding. Up from round-1's 3 because the migration + Settings write-path is new attack surface.

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

### Box 3 — the amber + red (critical) runway states [LOCKED]
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
- Tapping the donut (or its label) **cycles the 3 views in fixed order, wrapping:**
  **Booked-vs-left → Work type → Big-vs-small → (back to Booked).** The label beneath names the
  **current** view + a subtle "tap" hint.
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

### A. Runway pivots from "weeks" to "% of crew booked" [LOCKED — supersedes amendment parts 1 & 2 runway content + part 1 migration]
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
- **Color ramp [PROPOSED — Chris to eyeball, finalize in-browser per UI-first-class]:** a warm→cool
  heat ramp (warmer = worse), all from `tokens.js` + 2 new tokens:

  | Band | Crew booked | Reads as | Proposed color | Token |
  |---|---|---|---|---|
  | 1 | <30% | **Critical** (slides up) | rust-red | **new** `C.critical` `#c0392b` (distinct from error `C.red #e53935`, per audit C1) |
  | 2 | 30–50% | Thin | orange | **new** `C.orange` `#e67e22` |
  | 3 | 50–70% | Filling | gold | `C.amber` `#f9a825` |
  | 4 | 70–90% | Good | green | `C.green` `#43a047` |
  | 5 | 90%+ | Ideal | brand teal | `C.teal` `#30cfac` |

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

