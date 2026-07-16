# Material Flow — Proposal → Warehouse → Crew

**Status:** ideate output (design doc, pre-plan). Not yet a build plan.
**Origin:** `sales-command` (Screen 1 lives here). Cross-repo: touches Sales, Schedule, Field.
**Mockup:** https://claude.ai/code/artifact/0ba3275e-774d-406d-baf0-82a9bc4093b7 (v6)
**Related:** `~/sch-command/docs/plans/command_suite_shared_data_contract.md`

Confidence tags: **[LOCKED]** decided with Chris · **[DERIVED]** implied by decisions/code · **[DESIGN-OPEN]** not yet decided.

---

## 1. The problem

One job's material data currently gets re-typed at every stage, and the field SOW that's
supposed to carry it is flat + partly broken. The goal: **one job's data, four hand-offs,
nobody re-types** — the salesperson enters materials once; the warehouse stages and delivers
against that; the crew installs against the same data and reports actuals back.

This is not a novel invention — it's an assembly of proven patterns:
Bill of Materials (BOM) → Goods Receipt / 3-way match → Pick list / kitting / JIT delivery →
Work-order traveler → production reporting. **[LOCKED]**

---

## 2. The lifecycle (four hand-offs)

1. **Salesperson** (Sales Command) — builds the proposal, enters materials once. Single source.
2. **Field SOW** — salesperson lays materials into the day-by-day plan → ships to Schedule Command.
3. **Warehouse manager** (Schedule Command) — receives, reconciles, stages, loads the truck.
4. **Crew lead** (Field Command, phone, offline) — installs against the daily work-order, reports actuals.

Priority: **warehouse first** — material must physically reach the job before the crew's screen matters. **[LOCKED]**

---

## 3. Hierarchy

```
Job
└─ Mobilization        (1–3 per job, each with dates; set in bidding info)
   └─ Pull Ticket      (delivery window; auto-cut when the material set changes)
      └─ Day           (belongs to one mobilization; can carry work from 2+ WTCs)
```

- **Mobilization** = an on-site campaign. A job may demobilize and return weeks later. **[LOCKED]**
- **Pull Ticket** = what the truck carries for a window of consecutive same-material days.
  Auto-derived from the field SOW: a new pull ticket is cut every time the day's material set
  changes. This is JIT material control — the crew only ever holds what today needs, so they
  can't burn Thursday's material on Monday. **[LOCKED]**
- **Pull ticket numbering restarts per mobilization**, labeled `Mob X · Pull Ticket N`.
  Global sequential numbering rejected — it's fragile (adding a day shifts all later numbers). **[LOCKED]**
- **A day can span multiple WTCs.** The field SOW is authored per-WTC today; the crew day-view
  must aggregate across WTCs for a calendar day. **[DERIVED]**

---

## 4. The three screens

### Screen 1 — Material coverage check + whole-project sign-off
- **Lives in:** Sales Command, inside the WTC/proposal. Part A (mobilizations) sits in **bidding info**;
  Part B (materials coverage) extends the existing Materials section of `WTCCalculator.jsx`. **[LOCKED]**
- **Accessed by:** salesperson, while building/reviewing a proposal.
- **Does:** auto-computes `coverage_rate × job_size` vs `qty_ordered` → **OK / Verify / Short**,
  flags salesperson under-ordering *before send*. No new data entry — computes over fields already
  on the proposal. Warning is informational, nothing blocked. **[LOCKED]**
- **Whole-project material sign-off** — the total material list is the sheet that gets **printed,
  posted, and signed by Job Lead + Salesperson**. Per-pallet pull tickets do NOT carry signatures. **[LOCKED]**

### Screen 2 — Receive, pick & stage (pull tickets)
- **Lives in:** Schedule Command, on the job detail (a Materials/Staging section). **[DERIVED]**
- **Accessed by:** warehouse manager, before the truck rolls.
- **Does:**
  - **Master pull list · receiving check** — supplier → warehouse, whole job, checked against packing
    slip (the goods-receipt / 3-way-match receiving leg). Check-off only, no data entry. **[LOCKED]**
  - **Stage & deliver · pull tickets** — warehouse → site, grouped by mobilization, pull tickets
    auto-cut by material change. Each has a deliver-by date; future ones read "in warehouse until X"
    (the anti-mix-up control). Shortages block sign-off until material physically arrives. **[LOCKED]**
  - **Team** (1–8) replaces gate codes (they don't use gates). **[LOCKED]**
  - **Vehicles · Power · Equipment** replace generic "tools/return" and are **edited in-place on the
    pull ticket by the warehouse manager** (no separate WH screen for now). **[LOCKED]**

### Screen 3 — Crew daily work-order
- **Lives in:** Field Command (RN/Expo mobile, offline-first via PowerSync). **[LOCKED]**
- **Accessed by:** crew lead on their phone, per job per day.
- **Does:** renders the same data as the day's work-order — tasks with % targets (tagged by WTC,
  incl. multi-WTC days), scope notes (the "how"), and **materials with mix-station metadata**
  (kit, coverage, mils, mix time/speed, cure). End-of-shift **report writes actuals back to
  `daily_production_reports`** — closing the loop so the office sees real % complete + material burn. **[LOCKED]**
- Scroll cue when materials run past the fold. **[LOCKED]**

---

## 5. Data-entry model & option sources  *(the multi-tenant / sellable core)*

Designed so it can be **sold to other companies** — every option list is **per-tenant, configured
in Settings**, never hard-coded. **[LOCKED]**

| Input | Entry | Options come from | Where defined |
|---|---|---|---|
| **Materials** (job) | dropdown | **the proposal only** — warehouse can't invent materials | proposal `materials` (existing Materials Catalog for the price list) |
| **Consumables** (generic shop stock: rags, blades, cardboard, PPE) | **check-off** | a **predetermined master pull list** | Settings (per tenant) — NEW |
| **Vehicles** | dropdown | tenant fleet | Settings (per tenant) — NEW |
| **Power** (generators, etc.) | dropdown | tenant power assets | Settings (per tenant) — NEW |
| **Equipment** (major/main) | dropdown | tenant equipment | Settings (per tenant) — NEW |

Key distinctions **[LOCKED]**:
- **Materials are job-specific** and sourced *only* from what the salesperson put on the proposal —
  enforces single-source-of-truth, no re-entry, no drift.
- **Consumables are generic** and come from a tenant master checklist — warehouse just checks what applies.
- **Vehicles / Power / Equipment** are tenant assets from Settings dropdowns; empty field + dropdown,
  editable in-place on the pull ticket.

New Settings surface needed (per tenant): **Consumables master list, Vehicles, Power, Equipment.** **[DERIVED]**

---

## 6. Data model notes (grounded in current code)

- `proposal_wtc.field_sow` (jsonb) already exists and is per-day:
  `[{ day_label, date, tasks:[{description, %}], crew_count, hours_planned, materials:[] }]`.
  The scaffold is real — this is a level-up, not a greenfield. **[LOCKED]**
- `proposal_wtc.materials` (jsonb) = the proposal material list (product, kit size, coverage rate,
  supplier, qty, tax, freight, markup). Source for the coverage math + the materials dropdown. **[LOCKED]**
- Field schema already has `field_sow`, **`material_status`** (looks reserved for OK/VERIFY/SHORT),
  `crew_count`, `daily_hours`, and a **`daily_production_reports`** table (crew end-of-shift). **[LOCKED]**
- **NEW model work [DESIGN-OPEN]:**
  - Mobilizations: count + per-mob dates. Where stored? (proposal_wtc vs a job-level table — a job
    has one mobilization plan across WTCs, so likely job-level, not per-WTC.) Cross-driver source-of-truth
    per the shared-data contract.
  - Mobilization tag on each field_sow day.
  - Pull tickets: **derived, not stored** (auto-cut from field_sow by material change) — or materialized
    for warehouse check-off state? Decide.
  - Per-day multi-WTC aggregation for the crew view.
  - Tenant option lists (consumables/vehicles/power/equipment).
  - Metrics: sq ft / linear ft per day (crew + hours exist; these don't yet).

---

## 6b. Cross-app data flow — VERIFIED, not theoretical **[LOCKED]**

The core worry ("do the Schedule dropdowns sourced from Sales actually work?") is already answered
in production:
- Sales + Schedule point at the **same Supabase project** (`pbgvgjjuhnpsumnowuym`).
- Schedule Command **already reads Sales-owned tables today**: `work_types`, `team_members`, and
  **`proposal_wtc`** (the table holding `field_sow` + `materials`).
- Both are web apps on the same Postgres via PostgREST — there is **no sync to build** for web↔web;
  they read the same rows. The only sync boundary is **Field Command** (offline via PowerSync), where
  the tables just need to be in the sync rules.

Implication: the material dropdown-from-proposal and the Settings option-lists are **direct shared-table
reads**, the same mechanism already live. The work is the **data contract** (declare source-of-truth +
canonical location per list), not plumbing. Settings lists (consumables/vehicles/power/equipment) are
**sibling tables to the existing `tenant_config` + Materials Catalog** in Sales' Settings — Schedule reads
them exactly as it already reads `work_types`.

## 7. Coverage / shortage math

Two distinct checks at two times **[LOCKED]**:
1. **Plan-time validation** (catches salesperson error) — `need = size ÷ coverage` vs `qty_ordered` →
   OK/Short, on the proposal, before the PO. Pure calc over existing fields.
2. **Receiving-time reconciliation** (catches supplier/shipping error) — ordered vs on-slip vs physical,
   warehouse check-off at the dock.

---

## 8. Build sequence **[LOCKED]**

1. **Screens 1 + 2 together** ("material truth to the dock") — they're one unit; Screen 2 needs Screen 1's
   computed BOM.
2. **Screen 3** (crew work-order) — reads the same data, separable, next.

DB changes (mobilizations, tags, option lists) authored in **`command-suite-db`**, not app repos.

---

## 9. Open questions **[DESIGN-OPEN]**

- Where do mobilization dates live, and can Schedule Command edit them later (dates slip in the field)?
- Pull tickets: derived-on-the-fly vs materialized rows (to hold check-off/received state)?
- Crew progress: tap-to-update live %, or set once at end-of-shift?
- Material burn at end-of-shift: actual quantities (inventory truth, more taps) vs "used as planned / flag if off"?
- Consumables master list granularity + who maintains it (admin vs warehouse).
- Naming: repos/tokens say *Command Suite / Sales / Schedule / Field*; a pasted brand doc says
  *SubConPro / SCP … Command*. Reconcile before customer-facing.

---

## 10. Proven-systems grounding

BOM · Goods Receipt / 3-way match · Pick list · Kitting + Staging + JIT delivery · Work-order traveler ·
Production reporting. Sources: IDCON (kitting/staging), Lean Construction Institute (kitting),
NetSuite (3-way matching), Eease (BOM/kitting shortage).
