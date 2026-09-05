# Schedule Command Re-skin — Ideate Summary (vision, locked)

- **Repo:** sales-command (Schedule Command is a driver here, under `src/schedule/`)
- **Branch:** `feat/schedule-reskin`
- **Date:** 2026-09-04
- **Status:** IDEATE COMPLETE — ready for a PLAN session. No code written, no plan steps yet.
- **Origin:** Ideate conversation with Chris off two inspiration mockups (Home + Jobs, dark; Finance/Billing, linen). Mockups are DIRECTION, not literal — "vibe, adapt."

## Confidence legend
- **[LOCKED]** — Chris ratified this in ideate. Do not renegotiate.
- **[DERIVED]** — established by reading the current code this session.
- **[DESIGN-OPEN]** — deliberately left for the plan session to resolve.

---

## The vision (what we're building)

### Screen skeleton [LOCKED]
- **Old Home → becomes the new Jobs screen.** Same guts, repainted. This is HOW we keep every function — we relabel + repaint the screen that already has the working rows, we do not rebuild Jobs from scratch.
- **New Home** = built fresh as a pure high-level dashboard ("how are operations doing"). No working rows.
- **Old Jobs screen → retired.**
- **Finance / Billing** = new money screen (see below).
- **Everything else stays:** Crew Schedule, Calendar, Daily, Materials, Production Rate.

### Hard rule [LOCKED]
**Nothing gets dropped in the repaint.** The mockups are the *look*, not the *feature list*. Every function in the current rows/cards carries over.

### Theme [LOCKED — Option A]
- Keep the **linen page + creamy cards + dark sidebar + near-black "hero" cards + teal (#30cfac) pop** the app already uses.
- The all-dark Home/Jobs mockups = read as "make the hero cards pop," NOT "paint the whole page black."
- This is already the current theme (`src/schedule/index.css`: `--bg:#e7decb`, `--bg-card:#f3ede0`, near-black `--panel-dark:#111110`, teal accent). The Finance/Billing mockup already matches today's look. Stays on-brand + consistent with Sales/AR (linen is a core brand element).

### Nav / menu [LOCKED]
- Current routes (`src/schedule/ScheduleLayout.jsx`): home, jobs, jobs/:jobId, schedule (crew), billing, billing/forecast, materials, calendar, daily, schedules, production-rate, budget, settings, import.
- **Rename "Billing" → "Finance / Billing"**, and it becomes the one money screen.
- **Fold the separate Forecast and Budget screens INTO Finance/Billing** — three money screens become one.
- Mockup's "Logistics" = the existing **Materials/warehouse** screen; "Production Rate" already exists. Nothing new to add there.

---

## Finance / Billing screen — contents

### A. The worklist [LOCKED]
Replaces today's 4-card drill-in picker with **ONE list view.**
- **The 4 old card titles become row STATUSES:** Ready to Bill / Partially Billed / Billed Complete / Pay Apps. No cards, no drilling — one list, each row wears its status.
- **Filter bar** on the list (same shared FilterBar pattern used on the Sales side; **Status** is the only new filter to add):
  - Status · Work type · Date · Customer · Job # · Salesperson
- **Keep on the list:** Total to Bill (as a header number), Go Backs (as a flag/filter).
- **Keep per job (must survive the repaint):** status + billing badge (Deposit Due / Needs Final Bill / Partially Billed / Needs Review / Fully Billed) + "held — do not invoice"; Contract / Billed / Remaining; expand → invoices sent (X of Y) + which ones with amounts; editable billing notes; mark as Go Back; click through to open the job in Sales Command to invoice.

[DERIVED] Current implementation lives in:
- `src/schedule/views/Billing.jsx` (worklist shell)
- `src/schedule/components/BillingPicker.jsx` (the 4-card picker → to be replaced by the list)
- `src/schedule/components/BillingCard.jsx` (per-job billing card → its content becomes a list row + expand)
- `src/schedule/lib/billingForecast.js` — `BILLING_CARDS` (the 4 stages), `billingCardKey()`, `billingBadge()`, `buildBillingSurface()`, `authoritativeTotal()`, `billedTotal()`.

[DERIVED] Architecture truth to hold onto: this whole area is a **worklist / visibility layer.** It READS Sales invoices/proposals (via shared `call_log`) and shows what's owed; it only WRITES back `billing_worklist` flags + notes. Actual invoicing still happens in Sales Command. Finance/Billing does not create invoices.

### B. The dashboard cards
Traffic-lighted by "can we power it today?"

**🟢 Powerable now [DERIVED]:**
- Billing totals — this week / month / quarter / year (from sent invoices; `sent_at` + `amount`).
- Contract / Billed / Remaining, and Total to Bill (already computed in `billingForecast.js`).
- Cash-flow forecast — "when money lands" — already built (`computeForecast`, `expectedPayDate`).
- **Forecast chart** (Billed vs Scheduled-to-Bill vs Contract-Remaining) — powerable via the forecast formula below.

**Forecast formula [LOCKED]:** projected bill/cash date = **the job's end date + that customer's payment terms.**
- Regular jobs → end date (`jobs.scheduled_end`/`end_date`) + customer terms (`customers.billing_terms`, default 30).
- Pay-app jobs → their own billing schedule (already dated).
- Both pieces already on file; a terms-based helper (`expectedPayDate`) already exists to build on.

**🔴 Real build, NOT a repaint — the margin cards [LOCKED model]:**
- Cards: Margin Overview (avg margin, total margin, total billed, vs last month) + Highest / Lowest Margin Jobs.
- **Margin model:** `live margin = contract (incl. change orders) − actual cost (crew hours + materials logged)`.
  - Starting margin comes from the **proposal** (its markup over allocated hours/materials).
  - **Contract goes UP** via change orders (written on the Sales side).
  - **Cost goes UP** when crew log more hours/material than the proposal budgeted (overage) → margin down.
- [DERIVED] Nothing computes margin today. Raw ingredients exist but the calc doesn't:
  - Planned side: proposal WTCs (`proposal_wtc`: markup_pct, burden_rate, regular/ot hours, materials) → Sales `calc.js`.
  - Actual side: **Field Command** `daily_production_reports` (hours_regular, hours_ot, materials_used) + **Schedule** `job_material_lines` / warehouse-adds; Schedule already has a partial cost engine (`computeMobCosts` → material$ + labor$ per mobilization, but on PLANNED qty, not actuals-used).
- **Data-quality caveat [LOCKED]:** margin is only as truthful as crew logging. If crew don't log hours/materials in Field, cost is understated and margin reads too rosy. Margin leans on Field adoption — flag before it becomes a headline number.

---

## Build chunks & sequence [LOCKED intent]

1. **The repaint (chunk 1, plan first).** Paint + move, low risk, ships visible value alone:
   - New Home dashboard
   - Jobs = old Home repainted (keep every row function)
   - Retire old Jobs
   - Finance/Billing worklist: 4 cards → one filtered list; fold in Forecast + Budget; rename nav
   - The 🟢 dashboard cards (billing totals, Contract/Billed/Remaining, cash-flow + forecast chart)
2. **The margin build (chunk 2, its own later plan).** New math: planned margin from proposal + actual cost from crew-logged hours/materials → live margin → Margin Overview + Highest/Lowest Margin jobs. The repaint does NOT wait on this; margin cards slot in when ready.

---

## Open items for the PLAN session [DESIGN-OPEN]
- **First plan step:** inventory exactly what today's Home rows do (`src/schedule/views/Home.jsx` → `JobsToPrepare` + `HomeCapacityStrip`, `HomePanels`) so "keep every function" on the Jobs repaint is a real, itemized checklist — same as we did for the billing worklist above.
- Exact layout of the new Home dashboard (which cards, which of the mockup's Home tiles map to real data).
- Where the retired old-Jobs screen's unique bits (if any) need to land before deletion.
- Margin engine (chunk 2) gets its own plan doc.

## Explicitly NOT done
- No code changes. No plan steps. No branches beyond this doc branch. This file is the ideate artifact / file-as-memory handoff into planning.
