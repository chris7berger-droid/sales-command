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
- Current round: **1 (revised 2026-08-15)** — the 2026-08-13 manifest was a draft; **no audit ran.**
- Plan revision under audit: `edb7bce` (2026-08-15 amendment parts 1+2 — visual target, mockup
  decisions, and the two now-specified states).
- Findings trend: n/a (no audit executed). Expect a **premise-vs-data-reality** pattern plus a new
  **cross-repo-ordering / write-path-gating** cluster from the migration.

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
- Snapshot selector adds (from round 1): `follow_up`, `viewed_at`/`sent_at`.
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
   (`viewed_at`), `team_members` usage (`ImportToLiveWizard.jsx:219`). Pressure: are the *remaining*
   "trivial column adds" truly non-migration (columns exist)? Do the 2 charts + selectors stay
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

