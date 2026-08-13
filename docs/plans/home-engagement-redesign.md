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
