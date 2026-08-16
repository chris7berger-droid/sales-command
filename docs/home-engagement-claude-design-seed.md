# Claude Design seed — Home Engagement Redesign

Paste everything under the line into a fresh Claude Design (claude.ai) chat. No
screenshot — we want it to invent the look freely inside our brand guardrails. It
will return a single-screen React artifact you can tune live, then we translate it
back into `Home.jsx` + `components/followup/*` on the build.

Source of truth this mirrors: `docs/plans/home-engagement-redesign.md` +
`docs/HOME_ENGAGEMENT_VISION.md`.

---

Build me a **single dashboard screen** as a self-contained React artifact — the home
screen of a field-services sales app for commercial subcontractors. Estimators land
here every morning. **The whole point is engagement: it must feel like a video game —
obvious, easy, alive.** It should *breathe* — ebb and flow, move, feel dynamic — not
read like a flat report. Use tasteful motion (smooth easing, gentle transitions, a
subtle "breathing" idle, a celebration when a list clears). Never let urgency read as
scolding — tension shows through **movement + color**, never by removing encouragement.

**Design the look yourself — surprise me, push it, make it genuinely beautiful.** You
have full creative freedom on layout, composition, motion, and hierarchy. The ONLY
hard constraint is the brand: use **exactly these design tokens** — do not introduce
other colors:

```
COLORS
linen (page bg)      #b5a896      linenLight  #bfb3a1
linenCard (cards)    #c8bcaa      linenDeep   #a89b88
textHead   #1c1814   textBody #2d2720   textMuted #4a4238   textLight #6b6358
teal (accent)        #30cfac      tealDark #1a8a72   tealDeep #0d5c4d
tealGlow rgba(48,207,172,0.12)    tealBorder rgba(48,207,172,0.3)
dark (badges/btn bg) #1c1814      darkRaised #28231d
red #e53935   green #43a047   amber #f9a825   purple #8e44ad
border rgba(28,24,20,0.14)        borderStrong rgba(28,24,20,0.22)

FONTS  (Google Fonts)
display 'Barlow Condensed'  — big bold headline numbers
body    'Barlow'            — everything else
ui      'Inter'             — small labels/UI

HARD STYLE RULES
- NO white backgrounds anywhere. Cards use linenCard; page uses linen.
- Teal buttons get BLACK text (#1c1814), never white.
- Dollar badges: dark (#1c1814) background + teal (#30cfac) text, radius 6, padding 3px 10px.
- Selected pills: dark background, teal border + teal text.
```

**The screen, top to bottom — it breathes: in to YOU → out to the BUSINESS → back to YOUR MOVES:**

1. **YOU (hero) — always #1, never displaced, no pressure.** One oversized bold line
   in the display font, its own breathing room. Two auto states:
   - Sold this month → **results:** e.g. `"$312K sold this month"` + a small **"best
     month this year"** badge when it beats prior months.
   - $0 sold → **effort:** e.g. `"18 calls · 5 bids out — you're doing the work, it's
     coming."` Never an empty "$0". This box is a pure confidence hit — it carries NO
     pace/"behind" pressure.

2. **YOUR MONEY (money bar) — this is where pace/urgency lives.** A full-width month
   progress bar (fills on money *sold* this month) toward a personal target, with a
   **moving pace marker** ("where you should be by today") whose color warms calm→hot
   and gap grows as the month runs out. The gap is always phrased as a move, never a
   scold: `"$30K to go — one good job, or 6 quiet bids you already have out."` Beside
   it a **clickable donut** that taps between 3 views: booked-vs-left · work type ·
   big-vs-small jobs.

3. **THE BUSINESS, IN THE OPEN (shared — everyone sees the same).** A **crew runway**
   bar (weeks of booked work; calm when full, tension-colored when thin) and a
   **shared goal thermometer** toward the company monthly goal — one rope, **no
   ranking, no leaderboard**. Key motion: when runway goes **critical it slides UP
   above the money bar** and turns its tension color — a nudge, not a takeover; the
   hero (#1) never moves.

4. **YOUR BOOK (scoreboard) — the doorway.** A calm, **dollars-forward** pipeline strip
   of 3 tiles: **Wants Bid → Has Bid → Sold**, each with a big dollar number + small
   count, each **tappable to drill into that pile.**

5. **WHAT YOU OWE.** A finite, checkable list of **bids due + self-set follow-up dates**
   (no auto call-backs), oldest/most-overdue first, each linking into the job. When the
   list is empty, the **whole box becomes a celebration:** `"all caught up — go hunt."`

6. **WHERE TO HUNT (opportunity finder).** Serves **one** opportunity card at a time
   (big, one clear move, a **Refresh** control to cycle) plus dormant / gone-quiet call
   lists — each **tagged with a dollar number** so a call feels like chasing money.

Use realistic placeholder data (dollar amounts, job counts, names). Make it **beautiful
and tight on the first pass** — this is the look we'll ship. Prioritize the feel of #1–#3;
those set the tone for the whole screen.
