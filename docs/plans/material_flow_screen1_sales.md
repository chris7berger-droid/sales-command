# Material Flow — Screen 1 (Sales side) Build Plan — TIGHT SCOPE

**Status:** BUILD PLAN (verified). Consumes the LOCKED plan0 schema contract.
**Repo/branch:** `sales-command` @ `feat/material-flow` (verified current branch).
**Consumes (locked, do not reopen):** `command-suite-db@origin/main` migrations `20260708120000..120400` (applied to live `pbgvgjjuhnpsumnowuym`, merged 2026-07-08) + `command-suite-db/docs/plans/plan0_material_flow_foundation.md`.
**Design input:** `sales-command/docs/plans/material_flow.md` (ideate).

**Scope boundary [LOCKED by Chris, 2026-07-09]:** Three repo builds stack on the shared plan0 DB — **Sales**, **Schedule**, **Field** — each plan/build stays in its own environment. This plan is **Sales-facing only**: the field-SOW form in the WTC, the mobilizations editor, an optional plan-time coverage badge, and the send-to-schedule surfacing. Sales keeps the proposal→job handoff it already owns (`jobs` + `job_wtcs`) and **does NOT write any warehouse/crew table** — `job_material_lines`, `job_material_signoff`, `pull_tickets`, `pull_ticket_lines`, and the four `tenant_*` lists are Schedule/Field's to write when they build. The shared DB is the seam; each repo agrees on what lands in it, nobody reaches into another's tables.

Confidence tags: **[LOCKED]** decided/durable · **[DERIVED]** mechanical from schema/code · **[DESIGN-OPEN]** needs a user decision.

---

## Brief summary (≤300 words)

The Sales app already authors a per-WTC field SOW (`proposal_wtc.field_sow` jsonb, day-by-day tasks + per-day materials) in `WTCCalculator.jsx`'s "Scope of Work" tab, and already ships it to Schedule on the "Send to Schedule" click in `ProposalDetail.jsx:557` (`handleSendToSchedule`), which writes one `jobs` card + per-WTC `job_wtcs` rows (with `field_sow`).

Three pieces of Sales work, all no-DDL (schema is live from plan0; additive jsonb keys only):

1. **Rebuild the field-SOW day form** in the WTC SowTab — add a `mobilization_seq` day tag plus `sq_ft`/`linear_ft` per-day metrics to the `field_sow` day jsonb. Because the existing send already copies `field_sow` into `job_wtcs`, these new fields **flow to Schedule automatically** through the write path that already exists — no new job-table write.
2. **Add a mobilizations editor** writing `proposals.mobilizations` jsonb (proposal-level). The day dropdown reads from it.
3. **Surface it at send** — add a `[K1]` pre-send check (every day has a valid `mobilization_seq`) and a read-only review panel on the "Send to Schedule" flow showing mobilizations + per-day mob/metrics. Optionally seed `job_mobilizations` at send (see D4).

Plus an **optional, sales-facing coverage badge** (OK/VERIFY/SHORT) in the WTC so the salesperson can eyeball whether enough material was ordered.

**Explicitly out of scope (deferred to the Schedule/Field builds):** the warehouse BOM (`job_material_lines`), the material sign-off sheet, pull tickets, and the tenant settings lists. Going tight also removes the material-key identity blocker entirely — that fix existed only to merge materials for the warehouse BOM, which this plan no longer writes.

Point-at proof: a new field-SOW form visible in the WTC, and mobilization/day fields visible on the send-to-schedule flow.

---

## §0 Current-state grounding (read-verified 2026-07-09 on `feat/material-flow`)

### 0.1 The field-SOW form lives in the WTC — `WTCCalculator.jsx` [DERIVED]
- Tabs at `src/pages/WTCCalculator.jsx:26-31`. The field SOW is the **"4 · Scope of Work"** tab (`sow`).
- `SowTab` (`WTCCalculator.jsx:858-1111`): customer-facing **Sales SOW** textarea (`sales_sow`, line 980) + crew-facing **Field SOW** day-list (985-1102).
- Field-SOW **day shape** at `addDay` (`WTCCalculator.jsx:873`):
  `{ id: uid(), day_label, date: null, tasks: [{id, description, pct_complete}], crew_count, hours_planned, materials: [] }`. `uid()` is a real UUID (line 869).
- Per-day materials via `FieldSowMaterialPicker` (707-856, used at 1095).
- **No `sq_ft` / `linear_ft` / `mobilization_seq` on the day today.** Only per-day metrics are `crew_count` and `hours_planned`. Job Metrics (size/unit/sub_areas) are WTC-level (910-957).
- Persistence: `handleSave` (`WTCCalculator.jsx:1956`) writes the WTC to `proposal_wtc` (`field_sow: sow.field_sow` at 1975). Debounced autosave (1697-1700).

### 0.2 The send-to-schedule flow — `ProposalDetail.jsx` [DERIVED]
- Single **"Send to Schedule"** button (`ProposalDetail.jsx:822-824`), guarded by `sentToSchedule` (a `jobs` row existing for `source_proposal_id`, line 95). No wizard.
- `handleSendToSchedule` (`ProposalDetail.jsx:557-718`), one click:
  1. Idempotency guard (561-562, `23505` at 626).
  2. Loads all `proposal_wtc` (569); merges `field_sow` flat across WTCs (577).
  3. Inserts one `jobs` card (600-624) with flat `field_sow`, `sow`, dates, `size`, `source_proposal_id`.
  4. Upserts per-WTC `job_wtcs` rows (640-660): `{job_id, proposal_wtc_id, work_type_id, work_type_name, position, field_sow, material_status, start_date, end_date, bid_breakdown}`; failure rolls back the `jobs` row (669-686).
  5. Inserts legacy flat `materials` rows (688-704) — a display-only table.
  6. Sets `call_log.stage = "Parked"` (710).
- **Key fact for this plan:** the enriched `field_sow` (new day keys) rides through steps 3-4 with **zero new write code** — Schedule receives it via `job_wtcs.field_sow`, which is already written.
- `handlePullBack` (526-555) reverts to Draft; does not touch `jobs`; re-send stays blocked once a job exists.

### 0.3 Mobilizations — do not exist anywhere in Sales [DERIVED]
- `grep -rin 'mobiliz' src/` → **zero hits.** Fully net-new UI; `proposals.mobilizations` column is live but unwritten.

### 0.4 Materials model — `MaterialsTab` (`WTCCalculator.jsx:428-655`) [DERIVED]
- Row via `addFromDB` (482) / `addCustom` (483): `{ id: Date.now(), product, kit_size, price_per_unit, coverage_rate, supplier, qty, tax, freight, markup_pct, from_catalog }`.
- `coverage_rate` is **free text** (e.g. "200 sqft/gal"). `calcMaterialRow` (`src/lib/calc.js:69-78`) never uses coverage. **No coverage/shortage math exists today.**
- *(Note: under tight scope we do NOT need the `Date.now()`→catalog-id fix — that was only for the warehouse BOM merge, now out of scope.)*

### 0.5 Prior plan reconciliation — `send_to_schedule_wizard.md` NOT built [LOCKED]
- That plan's 5-step wizard + edge function + RPC were never built; the live path is the direct client-side `handleSendToSchedule`. Its durable outcome — the per-WTC `job_wtcs` model — is in production and this plan builds on it. This plan does NOT resurrect the wizard.

---

## §1 Problem statement [LOCKED]

The field SOW must get "a new look and functionality from the sales side... structured right in the WTC so the data shows up right when the job goes to the schedule." Two sales-side gaps:

1. **The field-SOW day is under-structured.** It carries no mobilization tag (`mobilization_seq`) and no per-day `sq_ft`/`linear_ft`. The mob tag is what lets Schedule group work later; without it, the send-time check can't pass.
2. **No mobilizations are authored on the proposal.** `proposals.mobilizations` exists but nothing writes it.

Both are pure Sales-side authoring. The enriched data reaches Schedule through the `job_wtcs.field_sow` handoff that already exists.

---

## §2 Data model — Sales write targets only [LOCKED unless noted]

| Target | Live shape | Sales action |
|---|---|---|
| `proposal_wtc.field_sow` (jsonb) | existing per-day objects | **Extend** each day with `mobilization_seq int`, `sq_ft numeric`, `linear_ft numeric` (§3). Additive keys — no DDL. Rides existing `handleSave` + the existing send → `job_wtcs.field_sow`. |
| `proposals.mobilizations` (jsonb, nullable) | `20260708120100:240` — `[{seq,label,start_date,end_date}]` | **NEW author** via the mobilizations editor (§4). |
| `jobs` + `job_wtcs` | existing writes in `handleSendToSchedule` | **Unchanged** — they already carry `field_sow`. Optionally also seed `job_mobilizations` (D4). |
| `job_material_lines`, `job_material_signoff`, `pull_tickets`, `pull_ticket_lines`, `tenant_*` | plan0 | **OUT OF SCOPE — not written by Sales.** Schedule/Field own these. |

**RLS [DERIVED]:** `proposals.mobilizations` uses existing `proposals` RLS. If D4 seeds `job_mobilizations`, it scopes through `jobs.call_log_id → call_log.tenant_id` (`20260708120100:282-294`) — satisfied by construction, same identity that already inserts `jobs`/`job_wtcs`. No edge function needed.

---

## §3 Field-SOW form rebuild spec (the WTC "new look + functionality") [DERIVED]

All in `WTCCalculator.jsx` `SowTab` (858-1111); persisted through existing `handleSave` → `proposal_wtc.field_sow`. No DDL, no new save wiring.

### 3.1 Day-object contract additions (additive jsonb keys)
Extend `addDay` (873) so each day carries:
- `mobilization_seq: int | null` — required before send (§5 `[K1]`). Default `null`; if exactly one mobilization exists, default to `seq:1`.
- `sq_ft: numeric` (default 0).
- `linear_ft: numeric` (default 0).

`updateDay` (877) coerces numeric keys via `parseFloat` (`sq_ft`/`linear_ft` fall through). `mobilization_seq` is an enum-like id — add it to the string-exempt branch and cast with `parseInt`.

### 3.2 UI additions to each day card (the "new look") [DESIGN-OPEN — D2 layout]
Within each day block (1000-1102), add:
- A **Mobilization selector** dropdown sourced from `proposals.mobilizations` (passed into `SowTab` as a new `mobilizations` prop). Label: `Mob {seq} — {label}`. Required styling mirrors the start/end-date required treatment (`BiddingTab` 373-388).
- **Sq Ft** and **Linear Ft** numeric inputs alongside `crew_count` / `hours_planned` (reuse existing day-metric input styling).
- Keep the existing per-day `FieldSowMaterialPicker` (1095) unchanged.

*(Exact visual layout — metric-row ordering, mob as header chip vs inline field — is a build-time design choice; the mockup v6 in `material_flow.md:5` is the north star. Confirm against it, don't invent.)*

### 3.3 What does NOT change [LOCKED]
Sales SOW textarea, tasks-with-%, `crew_count`, `hours_planned`, sub_areas, Job Metrics — all retained. This is a level-up, not a greenfield.

---

## §4 Mobilizations editor spec [DERIVED]

`proposals.mobilizations` is proposal-level (plan0 §2), so the editor is proposal-scoped.

**[DESIGN-OPEN — D1 placement]:** Where does the editor live?
- *(a, recommended)* A proposal-level editor on `ProposalDetail.jsx` (already owns proposal-scoped writes), writing `proposals.mobilizations`. The WTC SowTab reads it via prop for the day dropdown.
- *(b)* Inside `BiddingTab`, but writing the **proposal** — riskier: BiddingTab only writes `proposal_wtc` today; adding a proposal write breaks its single responsibility and the sibling-sync at `WTCCalculator.jsx:1991-2001`.

Recommendation: (a). Editor allows 1-3 rows, each `{seq, label, start_date, end_date}`; `seq` auto-assigned 1..N and **immutable once days reference it** (renumbering orphans day tags). Dates nullable (mirrors `dates_tbd` at `WTCCalculator.jsx:392`).

Write: `supabase.from("proposals").update({ mobilizations: [...] }).eq("id", p.id)` — existing `proposals` RLS.

---

## §5 Send-to-schedule surfacing spec [DERIVED]

Extend `handleSendToSchedule` (557-718). Keep all existing writes as-is.

### 5.1 `[K1]` pre-send validation (required) [LOCKED]
Before the `jobs` insert (before line 624), validate: every `field_sow` day across every WTC has a `mobilization_seq` that exists in `proposals.mobilizations`. If any day is missing/unknown → **abort with a WTC/day-specific message, write nothing.** All data is already loaded client-side, so this is a pure pre-insert check.

### 5.2 Read-only pre-send review panel (the point-at proof) [DESIGN-OPEN — D3 depth]
Add a lightweight inline panel/modal in `ProposalDetail.jsx` (reuse existing `Btn`/styling — NOT the abandoned wizard) that shows, read-only, before commit:
- Mobilizations (from `proposals.mobilizations`) with dates.
- Per-WTC field-SOW day count, each day's `mobilization_seq`, `sq_ft`/`linear_ft`.
- The `[K1]` block state (with a link back to the SowTab to fix).

### 5.3 The enriched `field_sow` handoff — no new write [LOCKED]
Steps 3-4 of `handleSendToSchedule` already copy `field_sow` into `jobs` and `job_wtcs`. The new day keys ride through automatically. **This is how the data "shows up right in Schedule" with zero warehouse-table writes.**

**[DESIGN-OPEN — D4 mobilizations handoff]:** Should the send also seed `job_mobilizations` from `proposals.mobilizations`?
- *(a)* Yes — add an idempotent upsert `{job_id, seq, label, start_date, end_date}` (`onConflict: "job_id,seq"`). Parallels the existing `job_wtcs` write; keeps the proposal→job translation (which sales already owns) complete, so Schedule reads `job_mobilizations` directly.
- *(b)* No — sales writes only `proposals.mobilizations`; Schedule copies proposal→`job_mobilizations` when it builds. Keeps sales strictly off the `job_*` mob table, but the day tags reference a `seq` that only lives in `proposals` until Schedule translates it.
- Recommendation: **(a)** — it's the same border the send button already sits on (it already writes `jobs`/`job_wtcs`), it's a tiny idempotent write, and it completes the handoff so Schedule has nothing to reconstruct. This is the one place "tight" still touches a `job_*` table, by the same logic that keeps the existing `job_wtcs` write in sales.

### 5.4 Failure discipline [DERIVED]
If D4=(a): the mob seed is an idempotent upsert placed alongside the `job_wtcs` write, under the same rollback rigor (661-686). Do not mark the proposal sent if a required write hard-fails ("fail safe, not fail silent"). Legacy `materials` write (688-704) stays as-is (unrelated to this plan).

---

## §6 Optional plan-time coverage badge (sales-facing) [DESIGN-OPEN — D5 include/defer]

Purely a sales convenience — lets the salesperson eyeball "did I order enough?" Blocks nothing, writes nothing.

Extend `MaterialsTab` (or Summary) to compute per material row: `need = size ÷ coverage_per_unit` vs `qty` (ordered) → `OK` / `VERIFY` / `SHORT` badge. Uses existing fields (`sow.size`, tab-3 `qty`, `coverage_rate`).

**Snag:** `coverage_rate` is free text. To divide, either parse a leading number (`parseFloat`, unparseable → `VERIFY`) or add a numeric `coverage_qty` field. Recommendation if included: parse for v1, `VERIFY` when unparseable.

**Decision:** include the badge in this plan, or defer it? It's genuinely sales-useful and self-contained, but it's the least essential item and the only one touching the free-text-coverage snag. Recommendation: **defer** unless you want it now — it's not part of the point-at proof and can be a fast follow.

---

## §7 Build sequence with per-step acceptance checks [DERIVED]

No DDL. Each step independently verifiable; ends at the point-at proof.

**Step 1 — Mobilizations editor (§4).** Per D1. *Accept:* create 2 mobilizations on a proposal; reload; `proposals.mobilizations` persists `[{seq:1,...},{seq:2,...}]`; RLS allows the write.

**Step 2 — Field-SOW day rebuild (§3).** Extend `addDay`/`updateDay`; add mob dropdown + `sq_ft`/`linear_ft` to each day. *Accept (point-at proof #1):* WTC → Scope of Work → each day shows a Mobilization selector (populated from Step 1), Sq Ft, Linear Ft; saving round-trips the new keys into `proposal_wtc.field_sow`.

**Step 3 — `[K1]` send validation (§5.1).** *Accept:* sending a proposal whose day lacks `mobilization_seq` is blocked with a WTC/day-specific message and writes nothing.

**Step 4 — Send-flow review panel (§5.2)** + optional `job_mobilizations` seed (§5.3, if D4=a). *Accept (point-at proof #2):* clicking "Send to Schedule" shows the mobilization + per-day fields before commit; after commit, `job_wtcs.field_sow` carries the new keys (and `job_mobilizations` has one row per mob if D4=a).

**Step 5 (optional) — Coverage badge (§6, if D5=include).** *Accept:* a WTC where ordered qty < need shows SHORT; unparseable coverage shows VERIFY; nothing blocked.

**Verification discipline:** run the app and drive the real flow (author mobs → author field SOW with mob tags + metrics → send → confirm `job_wtcs.field_sow` carries the keys), not just typecheck. "Fail safe, not fail silent" on every send branch.

---

## §8 Risks [DERIVED]

1. **Mobilization `seq` immutability** — renumbering mobs after days reference them orphans `mobilization_seq` tags. The editor must treat `seq` as immutable once referenced (§4).
2. **Re-send blocked once a job exists** (`ProposalDetail.jsx:561`) — a partial send failure can't be fixed by re-clicking. Mitigation: `[K1]` runs before any write (nothing half-written on validation fail); if D4=(a), the mob seed is idempotent.
3. **`job_id` type** — live `jobs.job_id` is int4, plan0 FKs int8; the FK works, inserts pass a number through. No client concern, but don't assume string ids.
4. **Legacy `materials` write** stays untouched — don't accidentally remove it.
5. **Scope creep back toward the warehouse** — resist re-adding `job_material_lines`/sign-off/settings; those are the Schedule build. This boundary is the whole point of the tight scope.

---

## §9 Open decisions for the user

- **D1 (§4):** Mobilizations editor on `ProposalDetail` (recommended) vs inside `BiddingTab`.
- **D2 (§3.2):** Day-card layout — confirm against mockup v6 at build time (not a blocking decision, a build-time confirm).
- **D3 (§5.2):** Pre-send review panel depth — lightweight inline panel (recommended).
- **D4 (§5.3):** Seed `job_mobilizations` at send (recommended) vs write only `proposals.mobilizations` and let Schedule translate.
- **D5 (§6):** Include the sales-facing coverage badge now (recommended: defer) vs fast-follow.

---

## §10 Reconciliation verdict on `send_to_schedule_wizard.md`

Superseded/historical. Wizard + edge function + RPC never built; live path is the direct `handleSendToSchedule`. Durable outcome (`job_wtcs`) is in production and this plan builds on it. Not resurrected here.

---

## Critical Files for Implementation
- `/Users/chrisberger/sales-command/src/pages/WTCCalculator.jsx` — field-SOW SowTab (858), day factory (873), MaterialsTab (428), handleSave (1956).
- `/Users/chrisberger/sales-command/src/components/ProposalDetail.jsx` — handleSendToSchedule (557), handlePullBack (526), send button (822).
- `/Users/chrisberger/sales-command/src/lib/calc.js` — calcMaterialRow (69); home for any coverage helper (if D5).
- `/Users/chrisberger/command-suite-db/supabase/migrations/20260708120100_*.sql` — `proposals.mobilizations` + `job_mobilizations` live shape (read-only contract).
