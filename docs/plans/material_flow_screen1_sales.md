# Material Flow — Screen 1 (Sales side) Build Plan

**Status:** BUILD PLAN (verified). Consumes the LOCKED plan0 schema contract.
**Repo/branch:** `sales-command` @ `feat/material-flow` (verified current branch).
**Consumes (locked, do not reopen):** `command-suite-db@origin/main` migrations `20260708120000..120400` (applied to live `pbgvgjjuhnpsumnowuym`, merged 2026-07-08) + `command-suite-db/docs/plans/plan0_material_flow_foundation.md`.
**Design input:** `sales-command/docs/plans/material_flow.md` (ideate).
**Scope:** Sales Screen 1 ONLY — the field-SOW form in the WTC, plan-time coverage check, mobilizations authoring, and the send-to-schedule seeding write path. Schedule (Screen 2) and Field (Screen 3) are separate plans and are READ-context here.

Confidence tags: **[LOCKED]** decided/durable · **[DERIVED]** mechanical from schema/code · **[DESIGN-OPEN]** needs a user decision · **[BLOCKED]** cannot proceed until resolved.

---

## Brief summary (≤300 words)

The Sales app already authors a per-WTC field SOW (`proposal_wtc.field_sow` jsonb, day-by-day tasks + per-day materials) in `WTCCalculator.jsx`'s "Scope of Work" tab, and already ships it to Schedule on the "Send to Schedule" click in `ProposalDetail.jsx:557` (`handleSendToSchedule`), which writes one `jobs` card + per-WTC `job_wtcs` rows + legacy flat `materials` rows. **Plan0 built 9 new tables the current send path does not touch yet.** This plan wires Sales Screen 1 into that new schema.

Four pieces of Sales work: **(1) Rebuild the field-SOW form** in the WTC SowTab — add the required `mobilization_seq` day tag plus `sq_ft`/`linear_ft` per-day metrics to the `field_sow` day jsonb (additive keys, no DDL). **(2) Add mobilizations authoring** (Part A) writing `proposals.mobilizations` jsonb (proposal-level, not per-WTC). **(3) Add a plan-time coverage check** (OK/VERIFY/SHORT) over existing material fields — informational, blocks nothing. **(4) Extend `handleSendToSchedule`** to seed `job_mobilizations`, `job_material_lines` (aggregated BOM + `coverage_status`), and optionally a draft `job_material_signoff`, with the plan0 `[K1]` send-time validation (fail send if any day lacks a valid `mobilization_seq`).

**One hard blocker must be resolved first (§3):** plan0's seed keys `job_material_lines.material_key` on `wtc_material_id` = "the materials_catalog row id," but the live code (`WTCCalculator.jsx:482`) assigns each tab-3 material row `id: Date.now()` — a per-WTC local id, NOT the catalog id, and NOT stable across WTCs. Plan0's cross-WTC merge-by-product is therefore not achievable with today's data. This plan proposes a fix (persist the catalog id) and flags the seed-key decision to the user.

Point-at proof: a new field-SOW form visible in the WTC, and mobilization/coverage fields visible on the send-to-schedule flow.

---

## §0 Current-state grounding (read-verified 2026-07-09 on `feat/material-flow`)

This is a feature build on a live surface; §0 documents what exists TODAY.

### 0.1 The field-SOW form lives in the WTC — `WTCCalculator.jsx` [DERIVED]
- Tabs defined at `src/pages/WTCCalculator.jsx:26-31`: `bidding` / `labor` / `materials` / `sow` / `travel` / `discount` / `summary`. The field SOW is the **"4 · Scope of Work"** tab (`sow`).
- `SowTab` (`WTCCalculator.jsx:858-1111`) renders two zones: the customer-facing **Sales SOW** textarea (`sales_sow`, line 980) and the crew-facing **Field SOW** day-list (lines 985-1102).
- Field-SOW **day shape** authored at `addDay` (`WTCCalculator.jsx:873`):
  `{ id: uid(), day_label, date: null, tasks: [{id, description, pct_complete}], crew_count, hours_planned, materials: [] }`. `uid()` is a real UUID (line 869).
- Per-day materials are added via `FieldSowMaterialPicker` (`WTCCalculator.jsx:707-856`, used at line 1095). Each selected day-material entry (`addMaterial`, line 735):
  `{ wtc_material_id: String(m.id), name, kit_size, qty_planned:0, mils:0, coverage_rate, mix_time:0, mix_speed:"", cure_time:"" }`.
- **No `sq_ft` / `linear_ft` / `mobilization_seq` on the day today.** The only per-day metrics are `crew_count` and `hours_planned` (confirms `material_flow.md` §6). Job Metrics (size/unit/sub_areas) are WTC-level, authored in the same SowTab (lines 910-957).
- Persistence: `handleSave` (`WTCCalculator.jsx:1956`) writes the whole WTC to `proposal_wtc` (payload at 1959-1984, `field_sow: sow.field_sow` at line 1975; `materials: materials` at 1971). Autosave on change (debounced, `useEffect` 1697-1700).

### 0.2 The tab-3 Materials model — `MaterialsTab` (`WTCCalculator.jsx:428-655`) [LOCKED — this is the blocker's root]
- A material row is created by `addFromDB` (line 482) or `addCustom` (line 483):
  `{ id: Date.now(), product, kit_size, price_per_unit, coverage_rate, supplier, qty:0, tax, freight:0, markup_pct:0, from_catalog }`.
- **The row `id` is `Date.now()` — the `materials_catalog.id` is NOT stored on the row.** `loadCatalog` (line 436) selects catalog `id`, but `addFromDB(m)` copies only `m.name/kit_size/price/coverage/supplier`, discarding `m.id`.
- `coverage_rate` is **free text** (e.g. "e.g. 200 sqft/gal", "100%"), not numeric. `calcMaterialRow` (`src/lib/calc.js:69-78`) never uses coverage — it computes dollars from `price_per_unit × qty` + tax + freight + markup. **No coverage/shortage math exists anywhere today.**
- `qty` (WTC-level ordered quantity) lives on the tab-3 row; `qty_planned` (per-day) lives on the field_sow day-material. These are two different quantities.

### 0.3 The send-to-schedule flow — `ProposalDetail.jsx` [DERIVED]
- Trigger: a single **"Send to Schedule"** button (`ProposalDetail.jsx:822-824`), guarded by `sentToSchedule` (set from a `jobs` row existing with `source_proposal_id`, line 95). No wizard, no intermediate screen.
- `handleSendToSchedule` (`ProposalDetail.jsx:557-718`) does, in one click:
  1. Idempotency guard: bail if a `jobs` row exists for `source_proposal_id` (561-562); also `23505` guard (626).
  2. Loads all `proposal_wtc` (569); merges `field_sow` **flat across all WTCs** via `flatMap` (577).
  3. Inserts one `jobs` card row (600-624) with flat `field_sow`, `sow`, dates, `size`, `size_unit`, `source_proposal_id`.
  4. Upserts per-WTC `job_wtcs` rows (640-660): `{job_id, proposal_wtc_id, work_type_id, work_type_name, position, field_sow, material_status:"not_ordered", start_date, end_date, bid_breakdown}`; on `onConflict: "proposal_wtc_id", ignoreDuplicates`. Failure rolls back the `jobs` row (669-686).
  5. Inserts legacy flat `materials` rows (688-704): `{job_id, ordinal, name, status:"Not Ordered", notes}` — a display-only table, NOT `job_material_lines`.
  6. Sets `call_log.stage = "Parked"` (710).
- **`handleSendToSchedule` writes ZERO plan0 tables.** No `job_mobilizations`, `job_material_lines`, `pull_tickets`, or `job_material_signoff`; no `proposals.mobilizations` read.
- `handlePullBack` (`ProposalDetail.jsx:526-555`) reverts the proposal to Draft, clears signatures, unlocks WTCs, sets call to "Wants Bid". It does **not** touch `jobs` — confirms plan0 §3's `[D1/G2]` correction. Re-send stays blocked once a job exists.

### 0.4 Mobilizations — do not exist anywhere in Sales [DERIVED]
- `grep -rin 'mobiliz' src/` → **zero hits.** No UI, no read of `proposals.mobilizations`. Fully net-new.

### 0.5 Settings surface — `Settings.jsx` [DERIVED]
- Collapsible `<Section>` blocks (`Settings.jsx:22`); `MaterialsCatalogSection` (line 229) is the exact CRUD pattern the four new `tenant_*` lists would clone. Sections mounted at `Settings.jsx:677-799`. No `tenant_consumables/vehicles/power/equipment` UI exists.

### 0.6 Prior plan reconciliation — `send_to_schedule_wizard.md` was NOT built as specced [LOCKED]
- That plan (`docs/plans/send_to_schedule_wizard.md`) specced a 5-step **wizard** + an edge function `send-to-schedule/index.ts` + an RPC `send_to_schedule(...)`. **None exist:** `src/components/SendToScheduleWizard.jsx` absent; no `send-to-schedule` edge function. The live path is the direct client-side `handleSendToSchedule`.
- What DID land from that plan's intent: the per-WTC `job_wtcs` model (the "SOW vertical §S3" rows at `ProposalDetail.jsx:635-660`) and the `material_status` enum on `job_wtcs`. So the multi-WTC join question (wizard §3) is effectively resolved by `job_wtcs`, and this plan does not reopen it.
- **Reconciliation verdict:** treat `send_to_schedule_wizard.md` as historical/superseded. This plan extends the existing `handleSendToSchedule`; it does NOT resurrect the wizard/edge-function/RPC. If the user wants the wizard UX, that is a separate decision (see §14).

---

## §1 Problem statement [LOCKED]

The field SOW must get "a new look and functionality from the sales side... structured right in the WTC so the data shows up right when the job goes to the schedule." Concretely, three gaps:

1. **The field-SOW day is under-structured for the material flow.** It carries no mobilization tag (plan0's stable `mobilization_seq` key that pull-ticket numbering and multi-WTC day aggregation depend on) and no per-day `sq_ft`/`linear_ft` metrics. Without the mob tag, the send-time `[K1]` validation cannot pass and Schedule cannot group/number pull tickets.
2. **No mobilizations are authored on the proposal.** `proposals.mobilizations` exists (nullable jsonb) but nothing writes it.
3. **The send path ignores the new schema.** `handleSendToSchedule` seeds neither `job_mobilizations` nor `job_material_lines` (the warehouse's BOM + coverage verdict), so the entire Screen 2/3 chain has no data to read.

Underneath all three sits a **data-identity blocker** (§3) that must be resolved before the BOM can be seeded correctly.

---

## §2 Data model — keyed to the live plan0 schema (write targets) [LOCKED unless noted]

Exact live columns (read from the applied migrations). Sales Screen 1 writes/reads:

| Target | Live shape (migration) | Sales Screen 1 action |
|---|---|---|
| `proposals.mobilizations` (jsonb, nullable) | `20260708120100:240` — `[{seq,label,start_date,end_date}]`, `seq` 1..N stable identity | **NEW author** (§5). Sales is source-of-truth (plan0 §6). |
| `proposal_wtc.field_sow` (jsonb) | existing; per-day objects | **Extend** each day with `mobilization_seq int` (required), `sq_ft numeric`, `linear_ft numeric` (§4). Additive jsonb keys — **no DDL**. |
| `job_mobilizations` | `20260708120100:244` — `id, job_id int8, seq int (>0), label, start_date, end_date`; `unique(job_id,seq)` | **NEW seed at send** from `proposals.mobilizations` (§7). |
| `job_material_lines` | `20260708120200:371` — `id, job_id int8, material_key text NOT NULL, name NOT NULL, kit_size, coverage, supplier, qty_needed, qty_ordered, qty_received, coverage_status ('OK'/'VERIFY'/'SHORT'), received_*`; `unique(job_id, material_key)`; qty `>=0` | **NEW seed at send** (aggregated BOM + coverage_status). Depends on §3. |
| `job_material_signoff` | `20260708120400:804` — `id, job_id int8, bom_snapshot jsonb default '[]', job_lead_name, salesperson_name, *_signed_at, status ('draft'/'signed')`; `unique(job_id)` | **NEW optional draft row at send** (§8). |
| `pull_tickets` / `pull_ticket_lines` | `20260708120300` | **NOT written by Sales.** Warehouse-owned (Screen 2). Read-context only. |
| `tenant_consumables/vehicles/power/equipment` | `20260708120000` — tenant-scoped, soft-delete-only | **Authored in Sales Settings** but consumed by Screen 2 — scope decision (§9). |

**RLS reality for the write path [DERIVED]:** all five job-anchored tables scope through `jobs.call_log_id → call_log.tenant_id = get_user_tenant_id()` (no local `tenant_id`; e.g. `20260708120100:282-294`). `pull_tickets`/`pull_ticket_lines` add a dual-key `WITH CHECK` (`20260708120300:638-656`). Sales writes these tables as an `authenticated` user whose tenant owns the parent `jobs`/`call_log` — the existing `handleSendToSchedule` already inserts `jobs` and `job_wtcs` under that same identity, so the seeding inserts satisfy RLS by construction. No service-role/edge-function is required. `proposals.mobilizations` is gated by the existing `proposals` RLS (already written by `handleSave`-adjacent proposal updates).

---

## §3 [BLOCKED] The material-key identity problem — resolve before seeding `job_material_lines`

**The mismatch (verified):** plan0 §3A `[A1/I1]` asserts `material_key = wtc_material_id = the materials_catalog row id`, citing `WTCCalculator.jsx:735`. But:
- The tab-3 material row's `id` is `Date.now()` (`WTCCalculator.jsx:482-483`), **not** the catalog id — the catalog id (`m.id`, selected at line 436) is discarded on add.
- `FieldSowMaterialPicker.addMaterial` sets `wtc_material_id: String(m.id)` = that `Date.now()` id (`WTCCalculator.jsx:730,737`).

Consequences for plan0's seed rule ("same `wtc_material_id` across two WTCs MERGES to one line"):
- **Cross-WTC merge fails:** the same catalog product added in WTC-A and WTC-B gets two different `Date.now()` ids → two `job_material_lines` rows instead of one. The warehouse-receives-by-product model breaks.
- **`Date.now()` collision risk:** two rows added in the same millisecond share an id (the SowTab already documents this exact hazard for day ids at `WTCCalculator.jsx:867`). Low probability, non-zero.
- **`qty_ordered` source ambiguity:** plan0's seed reads `qty_ordered` "from the proposal." The ordered qty is the **tab-3 `qty`** (`MaterialsTab`), but the field_sow day carries `qty_planned`. The seed must aggregate tab-3 `qty` per product (billing/order truth), while coverage's `qty_needed` = `size ÷ coverage`.

**Recommended fix [DERIVED → needs user ratify]:** give each tab-3 material a **stable catalog-linked key**:
1. In `addFromDB` (`WTCCalculator.jsx:482`), persist `catalog_id: m.id` on the row (additive jsonb field on `proposal_wtc.materials` — no DDL). For `addCustom` rows (no catalog origin), keep the row `id` (a UUID going forward, see below) as the key.
2. Change tab-3 row id generation from `Date.now()` to `uid()` (the UUID helper already at `WTCCalculator.jsx:869`) to remove the collision hazard. **Back-compat:** existing proposals have numeric `Date.now()` ids and `wtc_material_id` references to them — do NOT rewrite historical ids; new rows get UUIDs; the picker already stringifies both (`String(m.id)`), so mixed old/new coexist.
3. Define `material_key` for the seed as: `catalog_id` when present, else the (now-UUID) row id. **Merge across WTCs happens on `catalog_id`;** custom (non-catalog) materials stay per-WTC lines by design (a custom material in two WTCs is genuinely two authorings — acceptable, documented).

**[DESIGN-OPEN — Q-KEY for the user]:** Confirm the merge policy: *(a)* merge catalog materials across WTCs by `catalog_id`, keep custom materials per-WTC (recommended, matches "warehouse receives by product"); or *(b)* never merge — one `job_material_lines` row per (WTC, material), keying `material_key = "{wtc_id}:{row_id}"`. Option (b) is simpler and avoids the fix in §3.1-3.3 but diverges from plan0's stated merge intent and gives the warehouse duplicate product lines. Recommendation: (a).

---

## §4 Field-SOW form rebuild spec (the WTC "new look + functionality") [DERIVED]

All changes are in `WTCCalculator.jsx` `SowTab` (858-1111) and its day helpers; persisted through the existing `handleSave` → `proposal_wtc.field_sow` path (no DDL, no new save wiring).

### 4.1 Day-object contract additions (additive jsonb keys) [LOCKED per plan0 §4]
Extend the `addDay` factory (`WTCCalculator.jsx:873`) so each day also carries:
- `mobilization_seq: int | null` — **required before send** (validated at §7 `[K1]`). Default `null` on create; if exactly one mobilization exists, default to `seq:1`.
- `sq_ft: numeric` (default 0) — per-day area metric.
- `linear_ft: numeric` (default 0) — per-day linear metric.

`updateDay` (`WTCCalculator.jsx:877`) already coerces non-`day_label`/`date` keys via `parseFloat` — `sq_ft`/`linear_ft` fall through correctly; `mobilization_seq` must be added to the string-exempt branch OR stored as an int (add it to the non-parseFloat set, since it's an enum-like id, and cast with `parseInt`).

### 4.2 UI additions to each day card (the "new look") [DESIGN-OPEN — layout]
Within each day block (`WTCCalculator.jsx:1000-1102`), add:
- A **Mobilization selector** (dropdown) sourced from `proposals.mobilizations` (passed into `SowTab` as a new `mobilizations` prop, read at the WTC top-level component). Label per entry: `Mob {seq} — {label}`. Required-field styling mirrors the existing start/end date required treatment (`BiddingTab` lines 373-388).
- **Sq Ft** and **Linear Ft** numeric inputs alongside the existing `crew_count` / `hours_planned` inputs (reuse the existing day-metric input styling in the 1000-1094 block).
- Keep the existing per-day `FieldSowMaterialPicker` (1095) — unchanged except it benefits from the §3 catalog-id fix.

*(Exact visual layout of the rebuilt day card — e.g. metric row ordering, whether mob is a header chip vs inline field — is a design choice for the build; the mockup v6 referenced in `material_flow.md:5` is the north star. Flagged so the builder confirms against the mockup, not invents.)*

### 4.3 Cross-WTC consistency guard [DERIVED]
Because `mobilization_seq` lives per-day and mobilizations are proposal-level, a day can only reference a `seq` that exists in `proposals.mobilizations`. The mob dropdown is populated from that list, so the UI cannot author an unknown seq. The send-time `[K1]` check (§7) is the backstop for legacy/edited data.

### 4.4 What does NOT change [LOCKED]
- The Sales SOW textarea (`sales_sow`), tasks-with-%, `crew_count`, `hours_planned`, sub_areas, Job Metrics — all retained. This is a level-up of the existing form, not a greenfield (plan0/ideate both stress this).

---

## §5 Mobilizations authoring (Part A) spec [DERIVED]

`material_flow.md` §4 places mobilizations "in bidding info," but plan0 §2 locks them **proposal-level** (`proposals.mobilizations`), and the WTC BiddingTab is **per-WTC**. Reconciliation:

**[DESIGN-OPEN — Q-MOB placement]:** Where does the mobilization editor live?
- *(a, recommended)* A proposal-level editor on `ProposalDetail.jsx` (which already owns proposal-scoped writes), writing `proposals.mobilizations`. The WTC SowTab reads it (via prop) for the day dropdown. This matches the "one mob plan across a proposal's WTCs" lock and avoids N per-WTC copies.
- *(b)* Render it inside `BiddingTab` but have it write the **proposal** (not the WTC). Riskier — BiddingTab currently only writes `proposal_wtc`; adding a proposal-level write there breaks the tab's single-responsibility and the sibling-sync logic at `WTCCalculator.jsx:1991-2001`.

Recommendation: (a). Editor allows 1-3 rows (plan0 §2A), each `{seq, label, start_date, end_date}`; `seq` auto-assigned 1..N and immutable once days reference it (renumbering would orphan `mobilization_seq` day tags). Dates nullable (TBD supported — mirrors `dates_tbd` at `WTCCalculator.jsx:392`).

Write path: `supabase.from("proposals").update({ mobilizations: [...] }).eq("id", p.id)` — gated by existing `proposals` RLS.

---

## §6 Plan-time coverage check (OK / VERIFY / SHORT) spec [DERIVED]

Informational only; blocks nothing (`material_flow.md` §4). Two homes:

### 6.1 Live badge in the WTC materials section [DERIVED]
Extend `MaterialsTab` (or the Summary) to compute, per material row: `need = size ÷ coverage_per_unit` vs `qty` (ordered). Verdict → `OK` (qty ≥ need), `SHORT` (qty < need by > threshold), `VERIFY` (middle band). Show a small badge. Uses existing fields only (`sow.size`, tab-3 `qty`, `coverage_rate`).

**[BLOCKED — coverage is free text]:** `coverage_rate` is a free-text string (`WTCCalculator.jsx:482`, e.g. "200 sqft/gal"). The division needs a numeric coverage-per-unit. Options for the user (Q-COV):
- *(a)* Parse a leading number out of `coverage_rate` (regex `parseFloat`), treat unparseable as `VERIFY` (can't compute → ask a human). Cheapest, no schema change.
- *(b)* Add a structured numeric `coverage_qty` field to the tab-3 material row (jsonb, no DDL) authored alongside the text. Cleanest math, small UI add.

Recommendation: (a) for v1 with a clear "couldn't compute coverage" VERIFY state, upgrade to (b) if the number is unreliable. Either way, the `size` used is the WTC-level `sow.size` (per-day `sq_ft` is for distribution, not the coverage denominator, unless the user wants per-day coverage — Q-COV2, default: WTC-level).

### 6.2 Persisted `coverage_status` at send [LOCKED per plan0 §3A]
At send, compute the same verdict per aggregated `job_material_lines` row and write `coverage_status`. Per-job badge = worst status across lines (`SHORT > VERIFY > OK`), derived on read (plan0 §3A `[E1]`), no rollup column.

---

## §7 Send-to-schedule surfacing + seeding write path spec [DERIVED]

Extend `handleSendToSchedule` (`ProposalDetail.jsx:557-718`). Keep the existing `jobs` + `job_wtcs` + legacy `materials` writes; **add** the plan0 seeding after the `job_wtcs` upsert succeeds (after line 686, before/around the legacy materials block).

### 7.1 Surface the right fields on the send flow (the point-at proof) [DESIGN-OPEN — UI depth]
The current send is a single button with no review screen. To "surface the right field-SOW fields on the send-to-schedule flow," add a **pre-send confirmation panel** (not a full wizard) that shows, read-only:
- Mobilizations (from `proposals.mobilizations`) with dates.
- Per-WTC field-SOW day count, each day's `mobilization_seq`, `sq_ft`/`linear_ft`.
- The computed coverage summary (worst-status badge + short lines).
- A hard block if `[K1]` validation fails (§7.3), with a link back to the WTC SowTab to fix.

Recommendation: a lightweight inline panel/modal in `ProposalDetail.jsx`, reusing existing `Btn`/styling — NOT the abandoned 5-step wizard. (Q-SEND: confirm inline-panel vs full-wizard; recommend inline panel.)

### 7.2 Seeding order (all under the same authenticated tenant identity) [DERIVED]
After `jobs` insert (has `newJobId`) and `job_wtcs` upsert succeed:
1. **`job_mobilizations`** — for each `proposals.mobilizations[]`, upsert `{job_id:newJobId, seq, label, start_date, end_date}` with `onConflict: "job_id,seq", ignoreDuplicates` (idempotent on re-run; matches the `unique(job_id,seq)` index). Capture the returned `id` per `seq` (needed by Screen 2's pull tickets, but Sales only needs the mob rows to exist).
2. **`job_material_lines`** — aggregate across all WTCs/days per §3 `material_key`:
   - `qty_ordered` = sum of tab-3 `qty` per `material_key`.
   - `qty_needed` = `size ÷ coverage` per §6 (aggregated).
   - `coverage_status` = §6.2 verdict.
   - `name/kit_size/coverage/supplier` = snapshot from the proposal material.
   - Write `INSERT ... ON CONFLICT (job_id, material_key) DO UPDATE SET qty_needed=EXCLUDED.qty_needed, qty_ordered=EXCLUDED.qty_ordered` (plan0 §3A: replace with aggregate, never increment — idempotent).
3. **`job_material_signoff`** (optional, Q-SIGNOFF) — insert a `{job_id, bom_snapshot: <aggregated lines>, salesperson_name, status:'draft'}` row (`unique(job_id)`, so upsert). This pre-creates the whole-project sign-off sheet. **Scope call:** signoff is arguably a Screen 2 warehouse artifact; seeding a draft here is cheap and gives Sales the printable sheet. Recommend: seed a draft row.

### 7.3 `[K1]` send-time validation (required, plan0 §8) [LOCKED]
Before any seeding insert, validate: every `field_sow` day across every WTC has a `mobilization_seq` that exists in `proposals.mobilizations`. If any day is missing/unknown → **abort the send** with a clear message naming the WTC/day, and do NOT insert `jobs` (move this check to the very top of `handleSendToSchedule`, before the `jobs` insert at line 624, so nothing is half-written). This is enforceable pre-insert because all `field_sow` and `mobilizations` are already loaded client-side.

### 7.4 Failure/rollback discipline [DERIVED per existing pattern]
Follow the existing rollback rigor (`ProposalDetail.jsx:661-686`): a failed seeding insert after `jobs`/`job_wtcs` exist must either be idempotently retryable (the `ON CONFLICT` upserts are) or roll back the `jobs` row. Because re-send is blocked once `jobs` exists (line 561), prefer making all seeding writes idempotent upserts so a partial failure can be re-run manually. **Do NOT** mark the proposal "sent" if a seeding write hard-fails — mirror the CLAUDE.md "fail safe, not fail silent" rule. (Note the current legacy-materials write only `alert`s a warning at line 704 — the new BOM seed must be stricter since Screen 2 depends on it.)

### 7.5 Legacy `materials` table — keep or retire? [DESIGN-OPEN — Q-LEGACY]
`handleSendToSchedule` currently writes flat `materials` rows (688-704) that Schedule's old Materials view reads. `job_material_lines` is the new BOM. Until Screen 2 migrates off the legacy `materials` table, **keep both writes** (dual-write) to avoid breaking the current Schedule UI. Retiring the legacy write is a Screen 2 coordination item, not Sales Screen 1. Recommend: dual-write for now, flag for Screen 2.

---

## §8 Whole-project material sign-off — scope note [DERIVED]

`job_material_signoff` is the printed/posted/signed total-material sheet (Job Lead + Salesperson). Sales' Screen 1 role is limited to: seeding the draft `bom_snapshot` at send (§7.2.3) and optionally rendering a printable BOM sheet from the proposal. The actual signing UI (capturing `salesperson_signed_at`, `job_lead_signed_at`, flipping `status→'signed'`) is arguably Screen 2 (warehouse/job-detail) territory. **Recommend: Sales seeds the draft only; signing UI deferred to Screen 2** (Q-SIGNOFF confirms).

---

## §9 Settings option lists — scope note [DESIGN-OPEN — Q-SETTINGS]

The four `tenant_*` lists are authored in Sales Settings (they clone `MaterialsCatalogSection`, `Settings.jsx:229`) but are **read only by Screen 2 (pull tickets)** — nothing in Sales Screen 1 consumes them. Two options:
- *(a)* Build the four Settings CRUD sections now (they live in the Sales repo regardless), so tenant admins can pre-populate before Screen 2 ships. Low effort (clone one existing section ×4).
- *(b)* Defer to the Screen 2 build, since Screen 1 has no reader.

Recommend: (a) if cheap and the user wants warehouse-ready data; otherwise (b). This is the one genuinely-optional Screen-1 item.

---

## §10 Resolution of `material_flow.md` §9 [DESIGN-OPEN] questions

Plan0 already resolved the schema forks; here is where each §9 item stands for the **Sales** build:

1. **Where mobilization dates live / can Schedule edit later** → **RESOLVED [LOCKED].** `proposals.mobilizations` (Sales authors) → `job_mobilizations` (Schedule edits). Sales writes the former (§5) and seeds the latter (§7). Schedule-edit is a Screen 2 capability.
2. **Pull tickets derived vs materialized** → **RESOLVED [LOCKED].** Stored rows, warehouse-owned. **Sales writes none of it** — out of Screen 1 scope. No action here beyond ensuring `job_material_lines` + `job_mobilizations` are seeded so Screen 2 can draw the first draft.
3. **Crew progress live-% vs end-of-shift** → **Screen 3 behavior, not Sales.** No Screen 1 action.
4. **Material burn actuals granularity** → **Screen 3, deferred** (plan0 §6b, needs `daily_production_reports` live-shape verification). No Screen 1 action.
5. **Consumables list granularity + maintainer** → tied to §9/Q-SETTINGS above. If we build the Settings section, the maintainer is tenant admin (same RLS as `materials_catalog`); role-gating deferred to the role model (plan0 posture). **[DESIGN-OPEN]** only if we build §9(a).
6. **Naming (Command Suite vs SubConPro)** → customer-facing branding, **not schema, not Screen 1.** No action; flag remains open at the suite level.

**Net new [DESIGN-OPEN] items this plan raises (need user answers):** Q-KEY (§3), Q-MOB (§5), Q-COV/Q-COV2 (§6.1), Q-SEND (§7.1), Q-SIGNOFF (§7.2.3/§8), Q-LEGACY (§7.5), Q-SETTINGS (§9). See §13.

---

## §11 Build sequence with per-step acceptance checks [DERIVED]

Ordered so each step is independently verifiable; ends in the point-at proof. No DDL in this repo (all schema is live from plan0; the only "schema" is additive jsonb keys).

**Pre-work (blocker gate).** Resolve Q-KEY (§3), Q-MOB, Q-COV, Q-SEND with the user before coding the seed. *Accept:* user has answered Q-KEY, Q-MOB at minimum (they change data shape).

**Step 1 — Material identity fix (§3).** Persist `catalog_id` in `addFromDB`; switch new tab-3 row ids to `uid()`; keep back-compat with numeric ids. *Accept:* adding a catalog material twice across two WTCs yields the same `catalog_id`; existing proposals still load and save without id rewrites; `FieldSowMaterialPicker` still adds/removes correctly.

**Step 2 — Mobilizations authoring (§5).** Add the proposal-level mobilization editor (per Q-MOB) writing `proposals.mobilizations`. *Accept:* create 2 mobilizations on a proposal; reload; `proposals.mobilizations` persists `[{seq:1,...},{seq:2,...}]`; RLS allows the write.

**Step 3 — Field-SOW day rebuild (§4).** Extend `addDay`/`updateDay`; add the mob dropdown + `sq_ft`/`linear_ft` inputs to each day. *Accept (point-at proof #1):* open a WTC → Scope of Work tab → each day shows a Mobilization selector (populated from Step 2), Sq Ft, and Linear Ft; saving round-trips `mobilization_seq`/`sq_ft`/`linear_ft` into `proposal_wtc.field_sow`; the form has the new look/functionality.

**Step 4 — Plan-time coverage badge (§6.1).** Compute + show OK/VERIFY/SHORT in the WTC. *Accept:* a WTC where ordered qty < need shows SHORT; unparseable coverage shows VERIFY; nothing is blocked.

**Step 5 — `[K1]` send validation (§7.3).** Add the pre-insert day-tag validation to `handleSendToSchedule`. *Accept:* sending a proposal whose day lacks `mobilization_seq` is blocked with a WTC/day-specific message and writes nothing.

**Step 6 — Seed `job_mobilizations` + `job_material_lines` (+ draft signoff) (§7.2).** Add the idempotent upserts after `job_wtcs`. *Accept:* after send, `job_mobilizations` has one row per proposal mob; `job_material_lines` has one row per merged `material_key` with correct `qty_ordered`/`qty_needed`/`coverage_status`; re-running (manually, on a partial) does not double quantities; a `job_material_signoff` draft exists (if Q-SIGNOFF=yes).

**Step 7 — Send-flow surfacing panel (§7.1).** Add the read-only pre-send review panel showing mobilizations + per-day mob/metrics + coverage summary. *Accept (point-at proof #2):* clicking "Send to Schedule" shows the field-SOW/mobilization/coverage fields on the send flow before commit.

**Step 8 (optional) — Settings lists (§9).** Clone `MaterialsCatalogSection` ×4 if Q-SETTINGS=yes. *Accept:* tenant admin can CRUD consumables/vehicles/power/equipment; soft-delete-only guard respected (deletes should use `active=false`, not hard delete — the DB trigger will reject direct hard deletes).

**Verification discipline:** run the app and drive the real flow (create proposal → author mobs → author field SOW with mob tags → coverage badge → send → inspect the three tables via the read path), not just typecheck. Follow CLAUDE.md "fail safe, not fail silent" for every money/BOM-writing branch.

---

## §12 Risks & hidden blockers [DERIVED]

1. **[BLOCKED] Material-key identity (§3)** — the single highest risk; plan0's seed contract rests on a false premise about the live data. Must be resolved (Q-KEY) or the BOM seed will produce duplicate/split lines. This is the same "spec-vs-live-schema drift" class the plan0 audit flagged as its top round-2 weak point.
2. **[BLOCKED] Free-text coverage (§6.1)** — no numeric coverage exists; the OK/VERIFY/SHORT math needs a parse or a new field (Q-COV).
3. **Re-send is blocked once a job exists** (`ProposalDetail.jsx:561`) — so a partial seeding failure cannot be fixed by re-clicking Send. Mitigation: make all seeding writes idempotent upserts (§7.4) so a manual re-run is safe; do not mark sent on hard failure. A true "re-sync after pull-back" path remains an out-of-scope open question (plan0 §8).
4. **`job_id` type** — live `jobs.job_id` is int4 but plan0 FKs are int8 (handoff "DECISIONS"). The Postgres int8→int4 FK works; Sales inserts pass `newJobId` (a number) straight through — no client-side concern, but do not assume string ids.
5. **Legacy `materials` dual-write (§7.5)** — forgetting to keep the legacy write could break the current Schedule Materials view before Screen 2 migrates.
6. **Mobilization `seq` immutability** — renumbering mobs after days reference them orphans `mobilization_seq` tags. The editor must treat `seq` as immutable once referenced (§5).
7. **Multi-tenant RLS is untested at runtime** (handoff "VERIFICATION": single live tenant, no second-tenant test). Sales writes are same-tenant by construction, so low risk now, but the plan should not rely on cross-tenant behavior.
8. **PowerSync / Field** — out of scope for Sales, but note: Field reads these tables offline only after `field-command` adds sync rules (plan0 §5 `[E1]`). Sales seeding is a prerequisite, not sufficient, for Field to see the data.

---

## §13 Open questions for the user (must answer before/early in build)

- **Q-KEY (§3, blocking):** Merge catalog materials across WTCs by `catalog_id` (recommended) vs one line per (WTC, material)?
- **Q-MOB (§5):** Mobilization editor at proposal level on `ProposalDetail` (recommended) vs inside `BiddingTab`?
- **Q-COV / Q-COV2 (§6.1):** Parse coverage from free text (recommended v1) vs add a numeric `coverage_qty` field? Coverage denominator = WTC-level `size` (recommended) vs per-day `sq_ft`?
- **Q-SEND (§7.1):** Inline pre-send review panel (recommended) vs full multi-step wizard?
- **Q-SIGNOFF (§7.2.3 / §8):** Seed a draft `job_material_signoff` at send (recommended) — and is the signing UI Sales' job or Screen 2's (recommend Screen 2)?
- **Q-LEGACY (§7.5):** Confirm dual-write to legacy `materials` + new `job_material_lines` until Screen 2 migrates (recommended).
- **Q-SETTINGS (§9):** Build the four `tenant_*` Settings CRUD sections now vs defer to Screen 2?

---

## §14 Reconciliation verdict on `send_to_schedule_wizard.md`

That plan is **superseded/historical.** Its edge-function + RPC + 5-step wizard were never built; the live path is the direct `handleSendToSchedule`. Its durable outcome — the per-WTC `job_wtcs` model — is already in production and this plan builds on it. This plan deliberately does NOT resurrect the wizard architecture; if the user wants the wizard UX, that is a separate scope decision (Q-SEND leans to a lightweight inline panel instead).

---

## Critical Files for Implementation
- `/Users/chrisberger/sales-command/src/pages/WTCCalculator.jsx` — field-SOW SowTab (858), MaterialsTab (428), day factory (873), material picker (707), handleSave (1956).
- `/Users/chrisberger/sales-command/src/components/ProposalDetail.jsx` — handleSendToSchedule (557), handlePullBack (526), send button (822).
- `/Users/chrisberger/sales-command/src/lib/calc.js` — calcMaterialRow (69); home for any coverage math helper.
- `/Users/chrisberger/sales-command/src/pages/Settings.jsx` — MaterialsCatalogSection (229) pattern for the four `tenant_*` lists (§9).
- `/Users/chrisberger/command-suite-db/supabase/migrations/20260708120100..120400_*.sql` — the LOCKED live schema (read-only contract; exact columns for the seed write path).
