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
