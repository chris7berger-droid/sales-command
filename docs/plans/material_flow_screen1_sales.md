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

1. **Rebuild the field-SOW day form** in the WTC SowTab — add a `mobilization_id` (uuid) day tag plus `sq_ft`/`linear_ft` per-day metrics to the `field_sow` day jsonb. The existing send already copies `field_sow` into `job_wtcs`; **at send we additionally stamp the resolved `mobilization_seq`** into that copy (the uuid is Sales-internal; `seq` is the identity Schedule reads — §2).
2. **Add a mobilizations editor** writing `proposals.mobilizations` jsonb (proposal-level), each entry `{id (uuid), seq, label, start_date, end_date}`. The WTC day dropdown self-fetches it by `proposalId`.
3. **Surface it at send** — a `[K1]` pre-send check (every day resolves to a valid mobilization, validated against freshly-fetched DB state) and a read-only review panel on "Send to Schedule". The send stamps `mobilization_seq` into the existing `field_sow` copies and **adds no new write** (D4=b, round-2 scope-cut); Schedule seeds `job_mobilizations` from that stamp when it builds.

A sales-facing coverage badge (OK/VERIFY/SHORT) was considered but **deferred** to a fast-follow (D5) — not in this build.

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

1. **The field-SOW day is under-structured.** It carries no mobilization tag (`mobilization_id`, resolved to `seq` at send) and no per-day `sq_ft`/`linear_ft`. The mob tag is what lets Schedule group work later; without it, the send-time check can't pass.
2. **No mobilizations are authored on the proposal.** `proposals.mobilizations` exists but nothing writes it.

Both are pure Sales-side authoring. The enriched data reaches Schedule through the `job_wtcs.field_sow` handoff that already exists.

---

## §2 Data model — Sales write targets only [LOCKED unless noted]

**Identity model [RESOLVED — round-1 audit ratification, 2026-07-09]:** the day→mobilization binding uses a **two-identity split** (dissolves audit B3/B4):
- **Authoring identity (Sales-internal): `id` (uuid).** Each `proposals.mobilizations[]` entry carries a stable `id` from the same `uid()` UUID generator the day/task factory already uses (`WTCCalculator.jsx:869`). A field-SOW day binds to its mobilization by **`mobilization_id` (uuid)**. This id never changes on delete/reorder, so a broken link is a *detectable orphan*, never a silent mis-bind.
- **Wire identity (handoff to Schedule): `seq` (int 1..N).** The LOCKED plan0 contract is explicit (`20260708120100_*.sql:20-21`): "seq (1..N) is the stable mobilization identity that survives the send snapshot and **keys the field_sow day tag** + pull-ticket numbering." `job_mobilizations.seq` is `int NOT NULL CHECK (seq > 0)`. We do **not** reopen that. Instead, **at send** we resolve each day's `mobilization_id → its current `seq`** (from `proposals.mobilizations`) and stamp `mobilization_seq` into the `field_sow` snapshot copies (`job_wtcs.field_sow` + the legacy flat `jobs.field_sow`). Schedule reads `seq` off `job_wtcs.field_sow` and **builds `job_mobilizations` itself** when it builds (D4=b, §2A). The uuid is Sales-only and is **stripped at send** (§5.3 C1/C3).

| Target | Live shape | Sales action |
|---|---|---|
| `proposal_wtc.field_sow` (jsonb) | existing per-day objects | **Extend** each day with `mobilization_id text(uuid)\|null`, `sq_ft numeric`, `linear_ft numeric` (§3). Additive keys — no DDL. Rides existing `handleSave`. |
| `proposals.mobilizations` (jsonb, nullable) | `20260708120100_*.sql:19` — documented `[{seq,label,start_date,end_date}]`; **jsonb, so additively carries `id` (uuid)** → each entry `{id, seq, label, start_date, end_date}` | **NEW author** via the mobilizations editor (§4). Adding `id` is an additive jsonb key — no DDL, does not touch the locked column. See C2 note below. |
| `jobs` + `job_wtcs` | existing writes in `handleSendToSchedule:600-660` | Both `field_sow` copies (`job_wtcs.field_sow` **and** the legacy flat `jobs.field_sow`) carry the enriched days with the **resolved `mobilization_seq`** stamped in and `mobilization_id` **stripped** (§5.3). No new columns, no new rows. |
| `job_mobilizations` | `20260708120100_*.sql:26-48` — `{job_id int8 FK jobs ON DELETE CASCADE, seq int NOT NULL CHECK(seq>0), label, start_date, end_date}`, `UNIQUE(job_id, seq)` | **NOT written by Sales [D4=b, RATIFIED 2026-07-09 round-2 scope-cut].** Schedule seeds it from the `mobilization_seq` on `job_wtcs.field_sow` when Schedule builds. Sales stops touching every `job_*` table except the pre-existing `job_wtcs` write. |
| `job_material_lines`, `job_material_signoff`, `pull_tickets`, `pull_ticket_lines`, `tenant_*` | plan0 | **OUT OF SCOPE — not written by Sales.** Schedule/Field own these. |

**RLS [DERIVED]:** `proposals.mobilizations` uses existing `proposals` RLS (unchanged — additive jsonb key). **No new job-side write path** — Sales writes only `proposal_wtc` (via `handleSave`), `proposals`, and the pre-existing `jobs`/`job_wtcs` inserts. No `job_mobilizations` write, no new RLS surface, no edge function, no service-role path. (The `job_mobilizations` RLS chain is Schedule's concern when it seeds.)

**C2 — additive `id` key documentation:** the applied plan0 migration comment (`20260708120100_*.sql:19`) documents the shape as `[{seq,label,...}]` and predates this decision. The migration is **applied/merged (forward-only ledger) — do NOT edit it.** The authoritative record that each `proposals.mobilizations` entry additively carries a Sales-only `id` (uuid) lives **here (§2) and in §2A's wire-schema block**; a future documentation-only forward migration in `command-suite-db` may echo it, but Schedule reads the contract from §2A, not the migration comment.

### §2A Cross-driver data contract [D1/D2/D4 — required per Command Suite Shared-Data Contract]

The mobilization data crosses the Sales→Schedule driver boundary, so it declares the four contract fields (`~/sch-command/docs/plans/command_suite_shared_data_contract.md`):

- **Writer (source of truth):** Sales authors `proposals.mobilizations` (bid intent) and is the sole writer of it **[convention, not DB-enforced — C4]**: no DB constraint stops another driver from writing that column; the boundary is an agreed convention Schedule must honor. At send, Sales stamps `mobilization_seq` into the `field_sow` copies but writes **no** `job_mobilizations` row (D4=b). Schedule seeds and then owns `job_mobilizations` when it builds.
- **Canonical location:** **pre-send** the canonical mobilization set is `proposals.mobilizations`. The **handoff carrier** is `mobilization_seq` stamped onto `job_wtcs.field_sow` (each tagged day). **`job_mobilizations` is Schedule's post-send authoritative copy — built by Schedule, not Sales.** Mirrors the existing `field_sow`/`bid_breakdown` author-on-proposal → live-copy-on-job pattern (plan0 migration header, lines 5-6), except the live-copy write moves to the repo that owns the table.
- **Copy vs reference:** **snapshot copy** (not a reference). Sales stamps `mobilization_seq` into `job_wtcs.field_sow` at send; Schedule derives `job_mobilizations` from that stamp. The copies **drift** intentionally once Schedule edits dates in the field — that is the point. Sales never reads `job_mobilizations` back.
- **Sync pipe:** **PostgREST** (both apps are web; no PowerSync on this path — Field's offline boundary is out of scope here).

**`field_sow` day-key schema handed to Schedule** (the wire contract Schedule reads off `job_wtcs.field_sow`): each day object carries at least
`{ id (uuid), day_label, date (ISO|null), mobilization_seq (int 1..N, resolved at send), sq_ft (numeric), linear_ft (numeric), crew_count, hours_planned, tasks[], materials[] }`.
Schedule keys the day→mobilization link on **`mobilization_seq`** (which will match the `job_mobilizations.seq` Schedule seeds). The Sales-only `mobilization_id` (uuid) is **stripped at send [C1/C3 — definitive, not "may or may not"]** — it never reaches any `job_*` copy, so Schedule cannot accidentally depend on it.

**Pull-back staleness [D2 — known limitation]:** `handlePullBack` (`ProposalDetail.jsx:526`) reverts the proposal to Draft but **does not touch `jobs`/`job_wtcs`**, and re-send stays blocked once a `jobs` row exists (`ProposalDetail.jsx:561`). So after pull-back + edit, the job-side snapshot (`job_wtcs.field_sow`) is **stale** relative to the edited proposal, with no re-seed path in this build. This is the **existing** send-once behavior (not introduced here); mobilizations inherit it. Re-sync-after-pullback is explicitly **out of scope** — flag to Schedule that a pulled-back-then-edited proposal's job snapshot will not reflect the edits.

---

## §3 Field-SOW form rebuild spec (the WTC "new look + functionality") [DERIVED]

All in `WTCCalculator.jsx` `SowTab` (858-1111); persisted through existing `handleSave` → `proposal_wtc.field_sow`. No DDL, no new save wiring.

### 3.1 Day-object contract additions (additive jsonb keys) [A1/A2 — hardened]
Extend `addDay` (873) so each new day carries:
- `mobilization_id: string(uuid) | null` — the stable authoring binding (§2 identity model). **Default: `mobilizations[0]?.id ?? null`** (first mobilization if any exist; audit B5 — not `seq:1`). Required before send (§5 `[K1]`).
- `sq_ft: numeric` (default 0).
- `linear_ft: numeric` (default 0).

**`updateDay` (877) — rewrite as an explicit per-key coercion map; kill the `["day_label","date"].includes(key)` include-list [A1].** The include-list is fragile: any key not explicitly exempted silently goes through `parseFloat(val) || 0`, which would corrupt a uuid string to `0`. Replace with a per-key coercion table:

```js
// A2: explicit key→coercion. Unknown keys pass raw (never parseFloat-coerced).
const DAY_COERCE = {
  day_label:       v => v,                 // string, raw
  date:            v => v,                  // ISO string or null (existing S1 guard)
  mobilization_id: v => v || null,          // uuid string; blank/"" → null (declared blank = null)
  sq_ft:           v => parseFloat(v) || 0, // 0-means-blank (declared) — matches crew_count/hours_planned
  linear_ft:       v => parseFloat(v) || 0, // 0-means-blank (declared)
  crew_count:      v => parseFloat(v) || 0, // unchanged behavior
  hours_planned:   v => parseFloat(v) || 0, // unchanged behavior
};
const updateDay = (id, key, val) => onChange({ ...data, field_sow: (data.field_sow || []).map(e =>
  e.id === id ? { ...e, [key]: (DAY_COERCE[key] || (v => v))(val) } : e) });
```

**Coercion declarations [A2]:** `sq_ft`/`linear_ft` use **0-means-blank** (empty input stores `0`, consistent with the existing `crew_count`/`hours_planned` metric siblings — not `null`). `mobilization_id` stores **`null` when blank** (never `0`, never `""`) so `[K1]` (§5.1) can test presence cleanly. This is the whole reason the include-list must die: under it, a blank `mobilization_id` would become `0` and defeat the `[K1]` null-check.

### 3.2 UI additions to each day card (the "new look") [DESIGN-OPEN — D2 layout]

**Wiring correction [B1]:** `WTCCalculator` is a **full-screen swap**, not a child of `ProposalDetail`'s live render tree — `ProposalDetail.jsx:755` does `if (showWTC) return <WTCCalculator proposalId={p.id} ... />`, replacing the detail view entirely. So mobilizations **cannot** be live-prop-drilled from the ProposalDetail editor's state.

**The self-fetch is NEW code [R1] — spec it concretely (it does not exist today).** `WTCCalculator` has `proposalId` (line 1646) and fetches proposal rows elsewhere, but there is **no** mobilizations fetch/state yet. Add, in `WTCCalculator` (NOT `SowTab` — `SowTab` receives the value as a prop):
- **New state:** `const [mobilizations, setMobilizations] = useState([]);`
- **New effect — placed AFTER all `useState`/`useMemo` declarations it references [useEffect-TDZ rule].** A `useEffect` whose dependency array names a `const` declared *below* it TDZ-throws at register time even when the build passes. So this effect must sit **after** the `proposalId`-derived state block, not wherever it reads best:
```js
useEffect(() => {
  if (!proposalId) return;
  let alive = true;
  supabase.from("proposals").select("mobilizations").eq("id", proposalId).single()
    .then(({ data }) => { if (alive) setMobilizations(data?.mobilizations || []); });
  return () => { alive = false; };
}, [proposalId]);
```
- Pass `mobilizations` into `SowTab` as a prop; `SowTab`'s signature (`858`) gains `mobilizations`.
- Re-opening the WTC after editing mobilizations on ProposalDetail re-mounts `WTCCalculator`, so the effect re-runs and reads the latest (no manual refresh needed).

Within each day block (1000-1102), add:
- A **Mobilization selector** dropdown sourced from the `mobilizations` prop. Option value = `mob.id` (uuid); label = `Mob {seq} — {label}`. Required styling mirrors the start/end-date required treatment (`BiddingTab` 373-388). If `mobilizations` is empty, the dropdown shows a disabled "No mobilizations — add them on the proposal first" hint (the day cannot be validly tagged, and `[K1]` will block send).
- **Sq Ft** and **Linear Ft** numeric inputs alongside `crew_count` / `hours_planned` (reuse existing day-metric input styling).
- Keep the existing per-day `FieldSowMaterialPicker` (1095) unchanged.

**"+ Add day" gating [D2 — avoid a wrong default while the fetch is in flight]:** `addDay` defaults a new day's `mobilization_id` to `mobilizations[0]?.id` (§3.1). If mobilizations haven't loaded yet, that would default to `null` (or, worse, a stale first entry). So either (a) **disable "+ Add day" until `mobilizations` has resolved** (the effect has run — track a `mobsLoaded` flag, since `[]` is ambiguous between "loading" and "none"), or (b) on resolve, **re-default** any day still holding the placeholder. Prefer (a): a brief disabled "+ Add day" with a "loading mobilizations…" hint is simpler than reconciling after the fact.

*(Exact visual layout — metric-row ordering, mob as header chip vs inline field — is a build-time design choice; the mockup v6 in `material_flow.md:5` is the north star. Confirm against it, don't invent.)*

### 3.3 What does NOT change [LOCKED]
Sales SOW textarea, tasks-with-%, `crew_count`, `hours_planned`, sub_areas, Job Metrics — all retained. This is a level-up, not a greenfield.

---

## §4 Mobilizations editor spec [DERIVED]

`proposals.mobilizations` is proposal-level (plan0 §2), so the editor is proposal-scoped.

**[RESOLVED — D1 = (a), ratified 2026-07-09]:** A proposal-level editor on `ProposalDetail.jsx` (already owns proposal-scoped writes), writing `proposals.mobilizations`. The WTC page self-fetches it for the day dropdown (§3.2 — full-screen swap, not prop-drilled). (Rejected: inside `BiddingTab` — riskier, that tab only writes `proposal_wtc` and adding a proposal write breaks its single responsibility + the sibling-sync at `WTCCalculator.jsx:1991-2001`.)

Editor allows an **unlimited number of mobilizations (1…N) — no cap** [LOCKED, ratified 2026-07-09]. Verified against the live schema: `job_mobilizations` has only `CHECK (seq > 0)` (`20260708120100_*.sql:44-48`) and `proposals.mobilizations` is uncapped jsonb — the plan0 "1-3" was example wording, not a constraint.

**Row shape [two-identity, §2]:** each entry is `{ id: uuid, seq: int, label, start_date, end_date }`.

**Identity assignment [B2/B6 — monotonic, no reuse]:**
- **`id` (uuid):** assigned once at row creation via `uid()` (`WTCCalculator.jsx:869`); **immutable and never reused.** This is what days bind to.
- **`seq` (int):** assigned **monotonically** as `max(existing seq) + 1` (NOT `length + 1` — deleting then adding must not reuse a retired seq, which would silently mislabel the day on the wire and, downstream, the `job_mobilizations` row Schedule seeds from it). `seq` is display/wire ordering; it may show gaps after deletes, which is fine (Schedule keys on the value, not contiguity). Because days now bind by `id`, `seq` renumbering is **no longer required** and must not be attempted (audit B3 — the old "seq immutable, renumber orphans" hazard is dissolved: reorder/relabel freely; only `id` matters to the day binding).
- **Duplicate guard [B4]:** the editor must reject/prevent two entries with the same `id` or the same `seq` before write (defensive — `max+1` assignment already prevents seq collision; assert it).

**Delete → detectable orphan + in-use scan [B3/B1]:** deleting a mobilization that days still reference does **not** silently corrupt anything (days hold a `mobilization_id` that simply no longer resolves = detectable orphan, caught by `[K1]` at send). But to avoid a surprise-at-send, the editor runs an **"in use" scan before delete**: query the proposal's `proposal_wtc.field_sow` (all WTCs for this `proposal_id`) and count days whose `mobilization_id === thisMob.id`. If > 0, warn: *"Mobilization {seq} — {label} is tagged on N field-SOW day(s). Deleting it will leave those days without a mobilization and block Send to Schedule until you re-tag them. Delete anyway?"* This is a UI guard (advisory), not a DB constraint; the authoritative gate is `[K1]`.

Write: `supabase.from("proposals").update({ mobilizations: [...] }).eq("id", p.id)` — existing `proposals` RLS.

---

## §5 Send-to-schedule surfacing spec [DERIVED]

Extend `handleSendToSchedule` (557-718). Keep all existing writes as-is.

### 5.1 `[K1]` pre-send validation (required) [LOCKED; E1-hardened]
Before the `jobs` insert (before line 624), validate: every `field_sow` day across every WTC has a `mobilization_id` that resolves to an entry in `proposals.mobilizations`. If any day is missing/unknown → **abort with a WTC/day-specific message, write nothing.**

**Freshness discipline [E1] — `[K1]` must validate persisted DB state, not on-screen state:**
1. **Flush any pending autosave first.** The SowTab autosaves debounced (`WTCCalculator.jsx:1697-1700`); an in-flight edit may not be in `proposal_wtc` yet. But note: **the send runs from `ProposalDetail`, a different screen from the WTC** — by the time the user is on the send flow the WTC is unmounted and its autosave has fired. The real requirement is therefore that `handleSendToSchedule` validates against **freshly-fetched DB state**, two fetches:
   - `proposal_wtc.field_sow` — **already** re-fetched fresh at `ProposalDetail.jsx:569` (the existing `select("*, work_types(...)")`); the day tags come from there. **`field_sow` is on `proposal_wtc`, `mobilizations` is on `proposals` — different tables, so this is not a matter of "extending :569."**
   - `proposals.mobilizations` — a **separate, NEW fetch** at send time: `const { data: freshProp } = await supabase.from("proposals").select("mobilizations").eq("id", p.id).single();` → `const freshMobilizations = freshProp?.mobilizations || [];`. Do **not** reuse any `p.mobilizations` held in `ProposalDetail` state from an earlier render (it may be stale relative to a just-saved edit).
2. Build the resolution map from the **freshly-fetched** `proposals.mobilizations`: `mobilization_id → seq`.
3. For every day in every freshly-fetched WTC `field_sow`: assert `day.mobilization_id != null` **and** the map has it. Collect all failures (don't stop at first).
4. On any failure → abort, write nothing, show a **WTC/day-specific** message.

**Message wording [E1]:** the abort message must name the **persisted** location to fix, and must **not** imply it checked what's currently on screen. E.g.:
> *"Can't send yet — these field-SOW days have no mobilization assigned (based on the last saved version): WTC 2 'Day 3', WTC 2 'Day 5'. Open the WTC → Scope of Work, assign a mobilization to each day, and save before sending."*

(Avoid "the day you're looking at" / "the current day" phrasing — the send screen isn't showing the SowTab.)

### 5.2 Read-only pre-send review panel (the point-at proof) [DESIGN-OPEN — D3 depth]
Add a lightweight inline panel/modal in `ProposalDetail.jsx` (reuse existing `Btn`/styling — NOT the abandoned wizard) that shows, read-only, before commit:
- Mobilizations (from the freshly-fetched `proposals.mobilizations`) with dates.
- Per-WTC field-SOW day count, each day's mobilization (by resolved `seq`/`label`), `sq_ft`/`linear_ft`.
- The `[K1]` block state (with a link back to the SowTab to fix).

**NULL-date rendering [F1]:** mobilization `start_date`/`end_date` are nullable (dates TBD at bid time). The panel must render a null/empty date as **"TBD"** (or "—"), **never** raw (`null`, empty string) and **never** passed through a date formatter that would emit `"Invalid Date"`. Guard: `date ? fmtD(date) : "TBD"`. Same treatment for any per-day `date`. This mirrors the existing `dates_tbd` handling (`WTCCalculator.jsx:392`).

### 5.3 The enriched handoff — stamp `mobilization_seq`, no new write [D4=b RATIFIED 2026-07-09; C1/C3/D1]

**Scope-cut ratified (round 2):** Sales writes **no** `job_mobilizations` row. The send's only change is to **stamp the resolved `mobilization_seq` into the two existing `field_sow` copies and strip the Sales-only `mobilization_id`.** This removes the ordered write, the cascade-backed rollback, and the `jobs`-DELETE-RLS-policy dependency entirely — the send keeps its **existing** write shape and its **existing** rollback (`661-686`), untouched.

**Precondition:** `[K1]` (§5.1) has already run on the freshly-fetched data and built `mobById = Map(mobilization_id → seq)` from the send-time `proposals.mobilizations` fetch. Every tagged day is guaranteed to resolve.

**One shared transform** — apply to every day of **both** copies so they never diverge on this key (**C1** — the flat `jobs.field_sow` at `:577`/`:604` is a legacy mirror but must carry the same stamp, or a future reader of it sees no mobilization; **C3** — `mobilization_id` is stripped, not left dangling):
```js
// Strip the Sales-only uuid; stamp the wire seq. mobById from [K1].
const stampDay = d => {
  const { mobilization_id, ...rest } = d;                 // C3: strip uuid
  return { ...rest, mobilization_seq:
    mobilization_id != null ? (mobById.get(mobilization_id) ?? null) : null };
};
```

**Apply at two existing sites — value-only edits, no other fields touched (D1):**

1. **Flat `jobs.field_sow`** — the merge at `ProposalDetail.jsx:577` becomes
   `const fieldSow = wtcList.flatMap(w => (w.field_sow || []).map(stampDay));`
   Everything else in the `jobs` insert row (`600-622`) is **unchanged**.

2. **Per-WTC `job_wtcs.field_sow`** — inside the existing `jobWtcRows` map (`640-655`), change **only** the `field_sow:` value; the other 8 fields (`job_id, proposal_wtc_id, work_type_id, work_type_name, position, material_status, start_date, end_date, bid_breakdown`) stay exactly as they are (**D1** — edit the value, not the row shape):
```js
field_sow: (wtc.dates_tbd
    ? (wtc.field_sow || []).map(d => ({ ...d, date: null }))
    : (wtc.field_sow || [])
  ).map(stampDay),           // <-- only this line is new; rest of the row unchanged
```

**No change to any write count, order, or rollback.** `jobs` insert (`624`), `job_wtcs` upsert + its rollback (`658-686`), legacy `materials` (`688-705`), and `call_log` "Parked" (`710`) are all as they are today. `newJobId` still passes as a number (**C1** — don't stringify) but there is no new FK write relying on it.

### 5.4 Failure discipline [DERIVED]
- **Unchanged from today.** The only pre-existing hard-fail is the `job_wtcs` upsert failure, which already rolls back the `jobs` row with RLS-no-op verification (`661-686`) and returns before "Parked". This plan adds **no** new write and therefore **no** new failure branch.
- Because Sales no longer writes `job_mobilizations`, the round-1 "does a `jobs` DELETE policy exist in prod" question (B1) is **moot** — this plan introduces no new reliance on the cascade rollback. (The existing `job_wtcs` rollback already depended on the `jobs` delete; that is pre-existing behavior, unchanged and out of scope.)
- Legacy `materials` write stays as-is (warning-only).

---

## §6 Plan-time coverage badge (sales-facing) — [DEFERRED — D5 = defer, ratified 2026-07-09]

**Not in this build.** Deferred to a fast-follow: it's not part of the point-at proof and is the only item that hits the free-text `coverage_rate` snag. Spec retained below for the follow-up. Purely a sales convenience — lets the salesperson eyeball "did I order enough?" Blocks nothing, writes nothing.

Extend `MaterialsTab` (or Summary) to compute per material row: `need = size ÷ coverage_per_unit` vs `qty` (ordered) → `OK` / `VERIFY` / `SHORT` badge. Uses existing fields (`sow.size`, tab-3 `qty`, `coverage_rate`).

**Snag:** `coverage_rate` is free text. To divide, either parse a leading number (`parseFloat`, unparseable → `VERIFY`) or add a numeric `coverage_qty` field. Recommendation if included: parse for v1, `VERIFY` when unparseable.

**Decision:** include the badge in this plan, or defer it? It's genuinely sales-useful and self-contained, but it's the least essential item and the only one touching the free-text-coverage snag. Recommendation: **defer** unless you want it now — it's not part of the point-at proof and can be a fast follow.

---

## §7 Build sequence with per-step acceptance checks [DERIVED]

No DDL. Each step independently verifiable; ends at the point-at proof.

**Step 1 — Mobilizations editor (§4).** Per D1; two-identity rows `{id,seq,label,start_date,end_date}`, monotonic `seq = max+1`, duplicate guard, delete-time in-use scan. *Accept:* create 2 mobs; reload; `proposals.mobilizations` persists `[{id:<uuid>,seq:1,...},{id:<uuid>,seq:2,...}]`; delete mob #1, add another → new mob is `seq:3` (no seq reuse); deleting a mob referenced by a day warns; RLS allows the write.

**Step 2 — Field-SOW day rebuild (§3).** Extend `addDay` (default `mobilization_id = mobilizations[0]?.id`), rewrite `updateDay` as the explicit coercion map (no include-list), add the mob dropdown (self-fetched by `proposalId`) + `sq_ft`/`linear_ft`. *Accept (point-at proof #1):* WTC → Scope of Work → each day shows a Mobilization selector populated from Step 1, Sq Ft, Linear Ft; saving round-trips `mobilization_id`/`sq_ft`/`linear_ft` into `proposal_wtc.field_sow`; a blank mob stores `null` (not `0`); typing in Sq Ft never corrupts `mobilization_id`.

**Step 3 — `[K1]` send validation (§5.1).** Re-fetch `proposal_wtc.field_sow` + `proposals.mobilizations` fresh at send; resolve `mobilization_id → seq`. *Accept:* a proposal whose day has `mobilization_id = null` (or an id not in the freshly-fetched mobs) is blocked with a WTC/day-specific message referencing the **saved** state, and writes nothing.

**Step 4 — Send-flow review panel (§5.2) + `mobilization_seq` stamp (§5.3).** Panel renders mobs (NULL dates → "TBD") + per-day resolved seq/metrics; the send applies the `stampDay` transform to **both** `field_sow` copies (flat `jobs.field_sow` + per-WTC `job_wtcs.field_sow`). **No new write, no ordered rollback — the existing send shape is unchanged (D4=b).** *Accept (point-at proof #2):* clicking "Send to Schedule" shows the mob + per-day fields (TBD dates render, not "Invalid Date"); after commit, every tagged day in `job_wtcs.field_sow` **and** `jobs.field_sow` carries a resolved `mobilization_seq` and **no** `mobilization_id`; `job_mobilizations` is **not** written by Sales (empty until Schedule builds).

**Step 5 — Cross-driver contract check (§2A) [D1/D2/D4].** *Accept:* confirm the `field_sow` day-key schema handed to Schedule matches §2A (carries `mobilization_seq`, `mobilization_id` stripped); confirm the contract records that **Schedule** owns the `job_mobilizations` seed (Sales writes none); confirm the C4 "Sales sole writer" convention tag and the C2 additive-`id` documentation note are present; document the pull-back staleness limitation (no re-seed path this build).

*(Coverage badge — DEFERRED per D5, not built in this pass. See §6 for the retained spec when it becomes a fast-follow.)*

**Verification discipline:** run the app and drive the real flow (author mobs → author field SOW with mob tags + metrics → send → confirm `job_wtcs.field_sow` carries the keys), not just typecheck. "Fail safe, not fail silent" on every send branch.

---

## §8 Risks [DERIVED]

1. **~~Mobilization `seq` immutability~~ — DISSOLVED by the two-identity model (§2, round-1 audit).** Days bind by `mobilization_id` (uuid, immutable, never reused), so reorder/relabel/delete cannot silently mis-bind a day. A deleted mob leaves a **detectable orphan** (`mobilization_id` that no longer resolves), caught by `[K1]`, not a wrong-mob mismatch. Residual: `seq` must be assigned `max+1` (never `length+1`) so a delete-then-add cannot reuse a retired `seq` on the wire (§4 B6).
2. **Resolution-map correctness (NEW)** — the send resolves `mobilization_id → seq` from the **freshly-fetched** `proposals.mobilizations`. If it validated against stale in-memory state, a day could resolve to the wrong/absent seq. Mitigation: `[K1]` and the map are both built from the send-time re-fetch (§5.1 E1), never from `ProposalDetail` render state.
3. **Re-send blocked once a job exists** (`ProposalDetail.jsx:561`) — a partial send failure can't be fixed by re-clicking. Mitigation: `[K1]` runs before any write; under D4=b the send adds **no** new write, so the only hard-fail is the **existing** `job_wtcs` rollback (`661-686`), unchanged. Nothing new to half-write.
4. **~~Cascade rollback / `jobs` DELETE RLS policy (B1)~~ — MOOT under D4=b.** The scope-cut removed the `job_mobilizations` seed, so no new write relies on the cascade rollback. The round-1 "does a `jobs` DELETE policy exist in prod?" question does not gate this plan (the pre-existing `job_wtcs` rollback already depended on it — unchanged, out of scope).
5. **Pull-back staleness** — after `handlePullBack` + edit, the job-side snapshot (`job_wtcs.field_sow`) does not reflect the edits and there is no re-sync path (re-send blocked). Inherited send-once behavior, documented in §2A (D2); out of scope to fix here.
6. **Legacy `materials` write** stays untouched, unchanged in position — don't accidentally remove or reorder it (§5.3 C4).
7. **Both `field_sow` copies must carry the stamp (C1)** — the flat `jobs.field_sow` is a legacy mirror but must get the same `stampDay` transform as `job_wtcs.field_sow`, or a reader of the flat copy sees days with no mobilization. Apply the shared transform at both sites (§5.3).
8. **Scope creep back toward the warehouse** — resist re-adding `job_material_lines`/sign-off/settings/`job_mobilizations`; those are the Schedule build. This boundary is the whole point of the tight scope.

---

## §9 Decisions

- **D-IDENTITY (§2): RESOLVED = two-identity split** [round-1 audit ratification, Chris, 2026-07-09] — day→mob binds by stable `mobilization_id` (uuid) for authoring; `seq` (int 1..N) stays the wire identity, resolved at send. Dissolves audit B3/B4. Chose over pure-positional-seq (which keeps the fragile identity-by-position the audit flagged). Honors the LOCKED plan0 contract (`seq` keys the wire); no DDL (additive jsonb `id`).
- **D1 (§4): RESOLVED = (a)** — mobilizations editor on `ProposalDetail`. Unlimited mob count (1…N, no cap).
- **D4 (§5.3): RESOLVED = (b)** [round-2 scope-cut, Chris, 2026-07-09] — **Sales does NOT seed `job_mobilizations`.** Sales writes `proposals.mobilizations` + stamps `mobilization_seq` into both `field_sow` copies; **Schedule** seeds `job_mobilizations` from that stamp when it builds. Reverses the round-1 D4=(a). Rationale: the seed carried the entire round-2 finding-mass (ordered write, cascade rollback, unverified `jobs` DELETE RLS policy) for a row Schedule can trivially rebuild from the wire `seq`. Cutting it takes Sales out of every `job_*` table except the pre-existing `job_wtcs` write and dissolves that finding class.
- **D2 (§3.2): OPEN (build-time)** — day-card layout confirmed against mockup v6 during the build, not a blocking decision. (Separately: the "+ Add day" fetch-gating in §3.2 is a spec item, not open.)
- **D3 (§5.2): OPEN (default)** — pre-send review panel = lightweight inline panel (recommended default; confirm at build).
- **D5 (§6): RESOLVED = defer** — coverage badge is a fast-follow, not in this build.

**Round-1 audit responded 2026-07-09** (12 findings: 1C/7H/4M): identity model ratified + §2/§2A/§3/§4/§5/§7/§8 hardened.
**Round-2 audit responded 2026-07-09** (13 findings, 0C/2H/8M/3L; plateau → single-option scope-cut): D4 cut to (b), removing §5.3 Write-2 + ordered rollback + the B1 `jobs`-DELETE dependency; D4-independent items fixed — R1 (real self-fetch useState/useEffect + TDZ), R-E1 (separate `proposals.mobilizations` send fetch), C1/C3 (stamp both `field_sow` copies, strip `mobilization_id`), C2 (additive-`id` doc note, no migration edit), D1 (value-only `field_sow` edit), D2 (gate "+ Add day"), C4 (convention-not-DB-enforced tag). Adjacent findings (N4/N5/N6) → BACKLOG, not this loop. Plan re-submitted for round 3 (expected near-clean).

---

## §10 Reconciliation verdict on `send_to_schedule_wizard.md`

Superseded/historical. Wizard + edge function + RPC never built; live path is the direct `handleSendToSchedule`. Durable outcome (`job_wtcs`) is in production and this plan builds on it. Not resurrected here.

---

## Critical Files for Implementation
- `/Users/chrisberger/sales-command/src/pages/WTCCalculator.jsx` — field-SOW SowTab (858), day factory (873), MaterialsTab (428), handleSave (1956).
- `/Users/chrisberger/sales-command/src/components/ProposalDetail.jsx` — handleSendToSchedule (557), handlePullBack (526), send button (822).
- `/Users/chrisberger/sales-command/src/lib/calc.js` — calcMaterialRow (69); home for any coverage helper (if D5).
- `/Users/chrisberger/command-suite-db/supabase/migrations/20260708120100_*.sql` — `proposals.mobilizations` + `job_mobilizations` live shape (read-only contract).

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-07-09. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a medium-sized, no-database-change build that touches the money-adjacent "Send to Schedule" step and hands data to the Schedule app. Nothing here is destructive or hard to undo — but the whole plan rests on one assumption: that the new day fields "ride through automatically" into Schedule via the send code that already exists. That assumption, the mobilization tagging, and the one new write at send are the three things worth a careful look. Three focused reviewers, one aimed squarely at that ride-through claim.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: 3cda016 (latest commit on `feat/material-flow`; plan file last touched at 2636dd4)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: do NOT re-find issues from prior rounds. Each round's revision-pass commit message is the canonical record of what was addressed. Attack ONLY material new to the plan revision under audit. (No prior rounds this pass — attack the whole plan.)

**Plateau signal**: plateau forms when round-N count is steady or higher than round-(N-1), not just at round 3+. The plateau is usually scope creep — each revision answers prior findings by ADDING mechanism, which adds surface, which produces new findings. `/runaudit` MUST present scope-cut as the only build-prompt option when plateau is detected. Hedged "do D or do A and also 13 items" prompts make the loop worse, not better. (N/A round 1.)

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding is blocked/F-tier.
- **Prod / staging / dev**: the affected surfaces (WTC SowTab field-SOW, ProposalDetail "Send to Schedule") are LIVE in prod for the one tenant. The new jsonb keys + mobilizations editor are net-new UI on top of that live path.
- **Blocking feature flags**: none — no flag gates the field-SOW form or the send button.
- **Concurrency profile**: solo / ≤5 — a single sales team authors proposals; no concurrent-editor contention on a proposal in normal use.

Agents weight severity against these values. Cross-tenant findings cap at Med while `live_tenants == 1`. Multi-user race findings (e.g. two people editing mobilizations while a third sends) cap at Low while solo. Theoretical attacks against state that doesn't exist yet (warehouse/crew tables Sales never writes) are not in scope and are not High.

### Time budget + finding cap
- **Time budget**: 120 min (ERD Loop #41; ratified with Chris 2026-07-09 — not documented in §7)
- **Finding cap**: 12 findings

Synthesis MUST surface only the top-12 most consequential findings. Remainder go to "Quarantined findings (not actionable this loop)." Cap forces prioritization; without it, the audit defaults to dumping.

### Surface
- Total lines: 214
- Sections: 11 (§0–§10)
- [LOCKED] decisions: 8 (scope boundary; §0.5 wizard-not-built; §1; §2; §3.3; §4 unlimited-mob-count; §5.1 K1; §5.3 handoff) + 2 RESOLVED (D1, D4)
- [DESIGN-OPEN] items: 2 (D2 day-card layout §3.2; D3 review-panel depth §5.2 — both build-time, non-blocking)
- [OPEN] items: 2 (D2, D3 in §9 — both build-time)
- Plan-to-code ratio: ~214 : ~325 est code lines ≈ 0.66:1 (well under 50:1 — plan is right-sized, not scope-crept)

### Layers touched
- UI / components — mobilizations editor (ProposalDetail), mob selector + Sq Ft/Linear Ft inputs (WTCCalculator SowTab), pre-send review panel
- State model — additive jsonb keys `mobilization_seq`/`sq_ft`/`linear_ft` on `field_sow` day; `proposals.mobilizations` authoring
- Data layer — writes to `proposal_wtc.field_sow` (existing handleSave), `proposals.mobilizations` (new), `job_mobilizations` seed at send (new); the flat `field_sow` merge across WTCs at send (ProposalDetail:577)
- RLS / multi-tenancy — `job_mobilizations` insert scopes through `jobs.call_log_id → call_log.tenant_id`
- Cross-repo — Schedule (separate build) reads `job_wtcs.field_sow` + `job_mobilizations` from the shared DB `pbgvgjjuhnpsumnowuym`; the jsonb key shape is an implicit cross-repo contract

### New mechanisms introduced
- New jsonb keys: `mobilization_seq int|null`, `sq_ft numeric`, `linear_ft numeric` on each `field_sow` day (via `addDay`/`updateDay` in WTCCalculator.jsx:873/877)
- New authored jsonb: `proposals.mobilizations` `[{seq,label,start_date,end_date}]` — column live but currently unwritten anywhere in Sales (grep `mobiliz` → 0 hits)
- New UI: mobilizations editor on ProposalDetail; mob-selector dropdown + metric inputs in SowTab; read-only pre-send review panel
- New validation gate: `[K1]` pre-send check — every `field_sow` day across every WTC must carry a `mobilization_seq` that exists in `proposals.mobilizations`, else abort-and-write-nothing
- New write path: idempotent `job_mobilizations` upsert seed at send (`onConflict: "job_id,seq"`) inside `handleSendToSchedule`
- New prop threading: `mobilizations` passed proposal → SowTab

### Cross-system reach
- **command-suite-db (shared DB)**: consumes the LOCKED plan0 schema (`proposals.mobilizations`, `job_mobilizations`) — read-only contract; Sales writes but does not alter it.
- **Schedule Command (future build, same DB)**: reads the enriched `job_wtcs.field_sow` day keys and the seeded `job_mobilizations` rows. The jsonb key names are the seam — no declared/typed contract enforces them.
- **Service-role / bypass paths**: none — all writes go through the authenticated client under existing `proposals`/`jobs`/`job_wtcs` RLS; no edge function, no service-role write.

### Irreversibility
- Migrations: none (no DDL — schema is live from plan0; additive jsonb keys only).
- Backfills: none.
- Public API changes: none.
- Cross-repo schema contract: the `field_sow` day-key shape + `job_mobilizations` seed become a shape Schedule will read — soft-irreversible in the sense that renaming keys later breaks a downstream consumer, but reversible in-repo. All writes are idempotent or additive.

### Known weak points
- **The load-bearing "rides through automatically" premise (§0.2, §5.3).** The entire "zero new write" claim depends on `handleSendToSchedule` copying `field_sow` verbatim — the flat merge across WTCs at ProposalDetail:577 and the per-WTC `job_wtcs` upsert at 640. If either path reshapes, whitelists, or drops unknown day keys, the new fields never reach Schedule. This premise is read-verified, not run-verified — no send was actually executed and inspected. Highest-pressure item.
- **Orphaned `mobilization_seq` on mob deletion (§8.1 covers renumber, not delete).** The plan guards `seq` immutability against *renumbering* but the editor allows an uncapped 1..N list; deleting a mobilization that days already reference leaves day tags pointing at a `seq` that no longer exists in `proposals.mobilizations`. `[K1]` would then block send with no obvious fix path. Deletion guard is unspecified.
- **`[K1]` cross-source consistency.** Day tags live in `proposal_wtc.field_sow`; the mobilization list lives in `proposals.mobilizations`. `[K1]` validates one against the other at send time, but nothing keeps them consistent between authoring and send. The check is correct only if it re-reads both live at send (plan says data is "already loaded client-side" — confirm it's fresh, not stale from an earlier fetch).
- **`job_mobilizations` seed rollback envelope (§5.4).** §5.4 claims the seed sits "under the same rollback rigor" as the existing `job_wtcs`→`jobs` rollback (661-686), but that rollback only fires on `job_wtcs` failure. If the mob seed fails *after* `jobs` + `job_wtcs` succeed, does the plan roll those back, or leave a job with no mobilizations? "Fail safe, not fail silent" (repo rule) needs an explicit branch here.
- **Re-send permanently blocked once a job exists (§8.2).** `ProposalDetail:561` blocks re-send once a `jobs` row exists for the proposal. If a send half-completes in a way `[K1]` didn't prevent, there is no re-send recovery. Mitigation leans entirely on `[K1]` running before any write — verify nothing writes before `[K1]`.
- **Default-seq logic (§3.1).** "If exactly one mobilization exists, default day to seq:1" — but the day is authored in the WTC, which reads mobilizations via prop. If the editor created zero mobs, the dropdown is empty and `[K1]` blocks; if it created one, the default fires. Confirm the default doesn't silently apply a stale seq when the single mob's `seq` isn't literally 1 (seq is auto-assigned 1..N but immutable — a deleted-then-recreated mob could be seq:2 as the only survivor).
- **`job_id` int4 vs plan0 int8 FK (§8.3).** Live `jobs.job_id` is int4; plan0 FKs are int8. The plan says the FK works and inserts pass a number — verify the `job_mobilizations` seed passes `job_id` as the number the FK expects, not a string.

### Open questions
- Count: 2 (§9 — both build-time, non-blocking: D2 day-card layout vs mockup v6; D3 review-panel depth)
- Highest-pressure: neither is a blocker. Do NOT spend audit budget pressuring UI-layout choices (D2/D3) — they're design calls confirmed at build against `material_flow.md:5` mockup v6, not spec gaps.

### Suggested attack angles (3 total)
1. **Send-flow user-path state trace (MANDATORY)** — covers state model + data layer + the `[K1]` gate. Required reading: `ProposalDetail.jsx:557-718` (handleSendToSchedule — esp. the flat `field_sow` merge at 577 and `job_wtcs` upsert at 640-660), `WTCCalculator.jsx:873-877` (addDay/updateDay), `WTCCalculator.jsx:1956-1975` (handleSave). Specific pressure: trace one enriched day (with `mobilization_seq`/`sq_ft`/`linear_ft`) from authoring → save → send → `job_wtcs.field_sow`. Does the flat merge at 577 preserve unknown keys or reshape them? Does anything between authoring and send drop the keys? Prove the "rides through with zero new write code" premise true or false — it is the plan's load-bearing claim and is only read-verified. Also verify `[K1]` reads BOTH sources fresh at send and that nothing writes before it fires.
2. **Mobilization identity & authoring business logic** — covers state model + the editor's write contract. Required reading: §4, §3.1, `proposals.mobilizations` shape in `command-suite-db/.../20260708120100_*.sql`. Specific pressure: the seq lifecycle. Renumber is guarded; deletion is NOT — what happens to day tags when a referenced mob is deleted from the uncapped 1..N list? Does the default-seq:1 logic misfire when the sole surviving mob has seq≠1? Is `seq` truly immutable once referenced, and where is that enforced (UI only, or is there a guard)? Can `[K1]` ever be un-satisfiable by normal editing (author days → tag them → delete the mob), stranding the proposal un-sendable?
3. **Send-write discipline + RLS + cross-repo contract** — covers RLS + cross-repo + the new `job_mobilizations` write path. Required reading: §5.3/§5.4/§2, `ProposalDetail.jsx:640-704` (job_wtcs upsert + rollback 661-686), plan0 `job_mobilizations` RLS (`20260708120100:282-294`). Specific pressure: the D4 seed. Is the idempotent upsert (`onConflict: "job_id,seq"`) actually inside the rollback envelope, or can it leave a job with no mobs on partial failure? Does tenant scoping hold "by construction" as claimed (verify the insert path carries `call_log.tenant_id` correctly)? Is `job_id` passed as int (int4 live vs int8 FK)? And the cross-repo seam: the `field_sow` day-key names + `job_mobilizations` shape are an implicit contract Schedule reads — is there any declared source-of-truth/canonical-location note per the Command Suite shared-data-contract rule, or is Schedule left to reverse-engineer the key names?

### Suggested agent count: 3

Rationale: the raw formula scores 7 (5 layers + cross-system + ≥3 novel mechanisms), capped at 5 — but two formula-driven angles (UI/UX layout, cost/perf) have no real attack surface here (D2/D3 are deferred build-time design; no perf-sensitive new path), and the 1-tenant/solo deployment context collapses cross-tenant and concurrency findings into severity caps rather than dedicated agents. Three aimed agents cover all five material layers with no makework; a 4th would produce noise, not signal.
