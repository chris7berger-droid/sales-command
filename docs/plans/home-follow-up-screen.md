# Plan — Home Screen → Follow-Up Screen

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** ✅ **FROZEN — READY TO BUILD** (2026-08-11). Three audit rounds complete, monotone convergence (**25 → 17 → 8 findings · Highs 4 → 2 → 0 · regressions 3 → 0**); round 3 found only spec-completion gaps, all folded in pass 3. No round 4 — per the trend + the manifest's own freeze rule, the next verification is the build itself (buildvsplan + preview smoke). Decisions ratified by Chris: A1 = drop Zone 1a · N1/P4 = archive last-touch from `archive_records.record_date` · N5 = gone-quiet = newest proposal `created_at` · P2 = suppression windows 14/30/180d. **Next stop:** migrations in `command-suite-db` (rehearse first), then the build session against this frozen plan.

**Intent:** Convert the Sales Command home screen into a follow-up screen: **Wants Bid due-date alerts**, a manual schedule-runway bar that flips the screen into outbound mode, an outbound worklist (dormant customers + gone-quiet bids) with outcome logging, and a cross-screen "You have N alerts → Take Action" banner. (The old system's *New Inquiry claim alerts* are intentionally NOT carried over — Amendment A1.) Reference screenshots: `docs/plans/assets/` (committed b3c98b9).

---

## Ideation decisions (2026-08-11, all [LOCKED] with Chris)

**Why (the real problem):** Sales reps don't look at the schedule 1–2 weeks ahead. Team is
99.9% inbound-trained; reps fill their day with busy work on big far-out projects while crews
head toward empty days. The screen's job is not just "react to alerts" — it's **"keep the
crews busy two weeks from now"** by converting thin schedule runway into outbound sales
activity.

1. **Follow-up takes over Home** (not an alert layer on top). Sales Dash keeps the stats job.
2. **Three zones, top-to-bottom by urgency:**
   - **Zone 1 — Alerts:** (a) *Needs claiming* = call_log in New Inquiry stage with no sales
     rep assigned; card action **Claim** → assigns you, alert clears. (b) *Bid due reached* =
     Wants Bid with bid_due ≤ today; card action **Update** → opens job to move stage or push
     date w/ note. Visible list capped at top 10 oldest-first with "+N more" expander (old
     system's 155-alert wall trained people to ignore it).
   - **Zone 2 — Schedule runway (MANUAL for v1):** admin-only entry (Chris/Manager; sales
     sees, can't set): "Weeks of booked crew work ahead: [n]" + optional one-line note.
     Rendered as colored runway bar: **≥3 green · 2 yellow · <2 red**, note beneath.
     Automation deferred until Schedule + Field builds finish.
   - **Zone 3 — Outbound worklist:** grows/expands when runway is yellow/red. V1 sources:
     (1) **Dormant customers** — sold work in past, no new inquiry/job in **6 months**
     (hardcoded v1); (2) **Gone-quiet bids** — hit Has Bid, never sold, stale. Each renders
     as a call card: customer, last touch, last job, phone, + "log the outcome" action that
     writes back (list shrinks as worked; Chris can see who's making calls). Deferred:
     sold-job neighbors/referrals (#3, fuzzier).
3. **Banner** "You have N alerts → Take Action" lives on **every other screen** (slim strip
   linking back to Home when N > 0) — Home *is* the alert screen now.
4. **Old Home stats compress to a footer strip** — one slim row (pipeline counts + monthly
   billings %); big cards go, Sales Dash carries full stats.

### Amendments (post round-1 audit, 2026-08-11 — Chris ratified)

> Locked decisions above are preserved verbatim. These amendments supersede where noted.

- **Amendment A1 — Zone 1a "Needs claiming" is DROPPED for v1.** [LOCKED — Chris, 2026-08-11]
  The claim feature assumed unassigned New Inquiries exist. They don't: the New Inquiry
  wizard makes the sales-rep step **mandatory** (`NewInquiryWizard.jsx:236`) and writes the
  raw value (`:378`), so every inquiry is born assigned — `fetchClaimAlerts` would return ~0
  rows forever. Chris's call (verbatim intent): *don't make the rep optional to feed a widget;
  assigning at intake is better hygiene.* **Zone 1 is now bid-due alerts only.** This moots the
  §0.3 "unassigned trap," removes `claimInquiry`, and touches nothing in intake. Revisit only
  if an **ownerless lead source** is added later (web lead form / shared `info@` inbox that
  drops into New Inquiry with no rep) — see §4.
- **Amendment K2 — footer goals line is visible to ALL roles.** [LOCKED — Chris, 2026-08-11]
  Decision #4's "Sales Dash carries full stats" is Admin/Manager-only (`App.jsx:40`), so reps
  would lose their goal number entirely — not "relocated." The footer strip therefore keeps a
  **compact goals line (monthly-billings % + pipeline) rendered for every role**, so reps keep
  their number. Full drill-down stats still live on Sales Dash for Admin/Manager.

---

## §0 Baseline (observed current state) — read-verified 2026-08-11

All evidence below is **read-verified** against the branch `feat/home-follow-up-screen` (worktree `~/sales-command-home-follow-up-screen`). No queries were run against prod; row-shape claims are from the CLAUDE.md verified column reference + code.

### 0.1 Home is the post-auth landing screen (entry-point inventory)

Every authenticated route into Home, per design-baseline discipline (grep across `src/`):

- **Only render site:** `src/App.jsx:238` — `<Route path="/home" element={<Home displayName={displayName} displayRole={displayRole} />} />`. Home receives exactly two props: `displayName`, `displayRole`.
- **Redirects that land on Home:** `App.jsx:237` (`/` → `Navigate to="/home"`) and `App.jsx:252` (`*` catch-all → `/home`). Any unmatched authed path lands here — Home is the true default.
- **Nav item:** `App.jsx:36` (`{ id: "home", label: "Home", icon: "⌂" }`) → sidebar button `navigate("/home")` (`App.jsx:288`).
- **Table of Contents / Directory:** `src/components/TableOfContents.jsx:6-8` references `id: "home"`.
- The `navigate("/")` calls in `FeatureDetailPage.jsx` / `CheckoutPage.jsx` are **marketing/unauthed shell** routes (pre-auth `Routes`, land on `LandingPage`), NOT the authed Home. Not in scope.

**Conclusion:** there is exactly one Home surface and one current design (the stats dashboard in screenshot 1). No hidden/retired second entry point. Safe to redesign in place.

### 0.2 Current Home content (what gets replaced)

`src/pages/Home.jsx` (237 lines) renders, top to bottom:
- Greeting (`:162-173`).
- **Existing alert banner** (`:176-185`) — the seed of Zone 1, but only fires on `bid_due === tod()` **exact today** and `follow_up === tod()`; navigates `/calllog` with `bidDueFilter`. No "claim" concept, no ≤-today, no unassigned detection.
- Stat cards (`:187-193`), Pipeline bar (`:195-214`), Goal scorecards + drilldowns (`:216-233`).
- Data load (`:99-147`): `fetchAll("call_log", …)` **rep-filtered** by `sales_name === displayName` when role ∉ {Admin, Manager} (`:105-109`), plus `proposals` with `call_log` join.
- `bids`/`fups` counts (`:152-153`) use `=== tod()`.
- Role split via `isRep = !["Admin","Manager"].includes(displayRole)` (`:105`) — the reusable gating idiom.

### 0.3 call_log stage + sales-rep assignment — how "unassigned" looks in data

- Stages: `STAGES = ["New Inquiry", "Wants Bid", "Has Bid", "Sold", "Lost"]` (`src/lib/mockData.js:1`).
- Rep assignment lives in **`call_log.sales_name`** (text, matches `team_members.name` — not an FK). Written as `form.sales_name || null` in the detail editor (`CallLogDetail.jsx:359`).
- ⚠️ **CORRECTED (round-1 audit A1):** the New Inquiry wizard makes the sales-rep step **mandatory** — `validateStep` blocks a blank (`NewInquiryWizard.jsx:236`, `case "salesRep": if (!data.salesName) …`) and the insert writes the raw value with no `|| null` (`:378`). So **new inquiries are never born unassigned**; `sales_name IS NULL` effectively does not occur on the intake path. The earlier premise ("unassigned New Inquiries need claiming") was wrong. **Zone 1a is dropped — see Amendment A1.** The rep-filter "trap" (`Home.jsx:108`) is therefore moot; it never needed defending because there is no claim query.
- (Retained for context) Reassignment precedent, if ever needed: `Team.jsx:247-273` selects inactive-rep jobs and `.update({ sales_name: assignTo })` — note it checks `error` only, **no row-count verify**, so it is NOT a safe pattern to mirror for RLS-sensitive writes.

### 0.4 bid_due semantics

- `call_log.bid_due` is a **wall-clock date string** (`src/lib/utils.js:26` comment; date-column-is-wall-clock rule). Compare against `tod()` (= `new Date().toLocaleDateString("en-CA")`, `utils.js:28`), never `toISOString()`.
- Helper `over(d) = d && d < tod()` (`utils.js:30`) and `dayDiff(dateStr, from=tod())` (`utils.js:35`) already exist.
- Current usages: CallLog list flags overdue red via `over()` (`CallLog.jsx:288`); `bidDueFilter` matches exact today (`CallLog.jsx:175`); editable + saved in CallLogDetail (`:617`, `:356`).
- Locked decision needs **"bid_due ≤ today"** → predicate `r.bid_due && r.bid_due <= tod()` (covers overdue + due-today in one).

### 0.5 Where the manual runway number should live

- `tenant_config` is a **single row per tenant**, read via `getTenantConfig()` (`config.js:24`), written via `updateTenantConfig(partial)` (`config.js:41`), defaults in `DEFAULTS` (`config.js:3-14`). Goals already live here (`monthly_billing_goal`, etc., `:10-11`).
- **No runway field exists today.** → new columns on `tenant_config`: `schedule_runway_weeks` (int, nullable), `schedule_runway_note` (text, nullable), `schedule_runway_updated_at` (timestamptz). Added to `DEFAULTS` too. **DDL authored in `command-suite-db`, not here** (this repo owns no migrations since 2026-06-29).
- Admin-only write is naturally gated: `updateTenantConfig` + the `["Admin","Manager"]` role check.

### 0.6 Outbound-query source fields

- **`customers`**: `id, name, phone, email, contact_phone, contact_email, created_at, …` (CLAUDE.md ref; phone rendered `Customers.jsx:566,607`). `call_log.customer_id` FKs `customers.id` (`NewInquiryWizard.jsx:150-154`).
- **Dormant customers** (source #1): customer whose work is **historically sold** AND has **no `call_log` row `created_at` within 6 months** (hardcoded v1). ⚠️ **CORRECTED (round-1 audit D1):** "sold in the past" must NOT key on `proposals.status='Sold'` alone — **archive-imported jobs create `call_log` rows with `stage='Sold'` and NO proposal** (`ImportToLiveWizard.jsx:497`), which is exactly HDSP's historical book and the feature's primary target. Qualifier = **`call_log.stage='Sold'` OR a non-deleted Sold proposal (`deleted_at IS NULL`)**. Use the **effective-customer pattern** (`CallLog.jsx:100`, which already reconciles `call_log.customer_id` vs `proposals.customer_id` now that the latter exists). "Last touch"/"last job" from the most-recent `call_log` for that customer.
- **Gone-quiet bids** (source #2): `call_log.stage='Has Bid'` with **no Sold proposal** on that job, **stale**. ⚠️ **CAVEAT (round-1 audit K3):** `call_log.updated_at` is **any-write** (bumped by the auto-trigger on *any* edit — e.g. a bulk rep reassignment via `Team.jsx:271` would reset the whole tenant's gone-quiet list for 30 days). Prefer a staleness signal that reflects *bid inactivity* — `bid_due` age, or time since the row entered Has Bid — over raw `updated_at`. Threshold **[DESIGN-OPEN]** (proposal: 30 days) — see §2.4.
- Both zones use `fetchAll` (`src/lib/supabaseHelpers.js`) to bypass the 1000-row PostgREST cap.

### 0.7 Outcome write-back has no home yet

- Grep for `outreach | outcome_log | call_outcome | logged_call` in `src/` → **no existing table or writer**. Zone 3's "log the outcome" needs a **new `outreach_log` table** (authored in `command-suite-db`) so the worklist can shrink as calls are made and Chris can see who's calling.

### 0.8 Cross-screen banner mount point

- `AppShell` (`App.jsx:268`) wraps every authed route; children render at `App.jsx:330-331` inside `data-app-content` (`<ErrorBoundary>{children}</ErrorBoundary>`). The slim banner mounts here, **above** children, shown when `count > 0 && active !== "home"` (`active = sectionFromPath(location.pathname)`, `App.jsx:271`). Home *is* the alert screen, so it self-excludes.
- AppShell fetches no data today. The banner's alert count must come from a **shared source** so Home and the banner don't double-fetch or drift — see AlertsProvider in §2.5.
- Provider precedent: `TenantConfigProvider` already wraps the app (`App.jsx:213`). ⚠️ **CONSTRAINT (round-1 audit B1):** `:213` is **outside** `<BrowserRouter>` (`:215`). So `AlertsProvider` (mounted there) and any code it calls **must not use router hooks** (`useNavigate`/`useLocation`) — it's a data-only provider. The banner, which needs `location`, lives inside `AppShell` (inside the router, `:330`) and reads `count` from the provider via context. `refresh()` is likewise plain (no router dependency), invoked by the component layer (see §2.5).
- ⚠️ **CAVEAT (round-1 audit ADJ1):** `fetchAll` (`supabaseHelpers.js`) destructures `{ data }` and returns `[]` on any RLS/filter error — **a failed fetch is indistinguishable from "no rows."** On an alert surface that reads as a false "All clear." Zone 1/2/3 loaders must distinguish *error* from *empty* (surface a load error, don't paint the empty state) — see §2.1.

### 0.9 Reusable pieces already present

- `StatCard.jsx`, `SectionHeader.jsx` (both exist) — reuse for the footer strip.
- Colors `C.green / C.amber / C.red / C.teal` in `tokens.js` — reuse for runway bar + urgency, no new tokens.
- `fmt$`, `fmtD`, `tod`, `over`, `dayDiff`, `inits` in `utils.js`.

---

## §1 Problem / intent [LOCKED — see Ideation decisions above]

The screen's job is **"keep the crews busy two weeks from now."** It decides what's important — alerts to clear, then (when runway is thin) outbound calls to make — so the business runs on the tool's judgment instead of human bias/distraction. Full rationale in *Ideation decisions* above.

---

## §2 Proposed change — file-level design

Three stacked zones on Home, ordered by urgency, plus a cross-screen banner and a compressed stats footer. New query logic centralizes in one module; zone cards/modals live in `components/followup/` per the V52 "pages = list views, details/modals in components/" rule.

> **Round-1 + round-2 audits folded in.** Zone 1a (claim) is gone per Amendment A1. Round-1 (B1, C1, D1, E1, F1, G1, H1, I1, J1 + K/ADJ) and round-2 (RG1–RG3 regressions + N1–N14) are incorporated inline, tagged where they land. Round-2 theme was *fix-pair-interaction* — pass-1 fixes that were individually right but broke in combination (see RG1/RG2/RG3 in §2.7/§2.1).

### 2.1 Data layer — `src/lib/followUp.js` [NEW]

> **Round-2 rewrite (RG3).** The pass-1 "footer reuses the provider's data" was unbuildable — the provider only held rep-scoped Wants-Bid rows, but the footer needs full pipeline counts + billings %. Restructured to a **single shared snapshot**.

followUp.js issues **exactly ONE `call_log` `fetchAll` and ONE `proposals` `fetchAll`** per load and derives every list from that snapshot **in memory** — bid-due alerts, dormant, gone-quiet, AND the footer. This kills the K1 fan-out (honest pre-fix count was ~6 fetches, `call_log` 3×) and gives the footer real data. The provider (§2.5) holds the snapshot; `refresh()` re-pulls both.

**Proposals select shape (P3):** the footer's billings % needs columns no Zone-3 consumer asks for, so the shared `proposals` `fetchAll` must enumerate the **union**: `id, call_log_id, customer_id, status, created_at, total, proposal_wtc(end_date)`, filtered `deleted_at is null`. Unlisted, the footer ships computing **$0**. (`call_log` snapshot select: `id, stage, sales_name, customer_id, bid_due, created_at, updated_at, archive_record_id, display_job_number, customer_name, job_name` + the fields the footer's `sc` counts need.)

Derived selectors (pure, over the snapshot):
- `bidDueAlerts({ displayName, isRep })` → `stage='Wants Bid'`, `bid_due` not null, `bid_due <= tod()`; rep-scoped by `sales_name === displayName` when `isRep`. **Order (RG2): `bid_due DESC, id DESC`** — most-recently-due first, so a bid due *today* sits above older stale ones (`id DESC` breaks ties — N10). Cap 10 + expander at the UI (§2.2).
- `alertCount` → `bidDueAlerts.length` (banner + footer badge).
- `dormantCustomers()` → **effective customers** whose work is historically sold (`call_log.stage='Sold'` OR a non-deleted Sold proposal — D1) with **no real touch within `DORMANT_MONTHS` (=6)**, minus anyone excluded by the recent-outreach rule below.
  - **Last-touch — N1 + N6 + P4 (Chris ratified Option 1, 2026-08-11):** touch date comes from a **touch-map keyed on BOTH `call_log.customer_id` AND each proposal's effective customer** (`CallLog.jsx:100` reconciliation) — so a Sold proposal on *another GC's* job still counts as a touch for that customer (N6, avoids false dormancy). ⚠️ For **archive-lineage** rows (`call_log.archive_record_id` not null), `call_log.created_at` is the **import date, not a real touch** (N1) — the whole historical book would read "touched today" and Zone 3 would ship empty for 6 months. **Corrected source (P4):** `raw_data` has **no sold-date key** anywhere in code; use the **`archive_records.record_date`** column (a real mapped date — `ArchiveImportWizard.jsx:27,124`; queried/displayed at `ArchiveSearchView.jsx:55`), fallback raw `job/Bid Due Date`. This is the **honest third fetch** (`archive_records` by `archive_record_id`) — count it in the snapshot cost, not a free derive. Non-archive rows fall back to `created_at`.
- `goneQuietBids()` → `stage='Has Bid'`, no Sold proposal on the job, stale by **last bid activity older than `GONE_QUIET_DAYS` (=30)**. **Signal — N5 (Chris ratified Option a):** newest **non-deleted proposal `created_at`** on the job, fallback `bid_due`, fallback `call_log.created_at`. No schema change (no `stage_changed_at`). Recent-outreach exclusion keyed on `customer_id` (I1).
- `logOutcome({ source, outcome, note, customerId, callLogId, loggedBy })` → inserts one `outreach_log` row; **always writes `customer_id`** (I1). **App-side integrity (RG1):** enforce "at least one FK present" *in this function*, NOT via a DB CHECK (see §2.7 RG1 — a CHECK beside SET NULL FKs re-breaks delete). **Accepted limit (P6):** because the invariant is app-enforced only, a second writer (another client, or a console `INSERT`) could create an orphan row (both FKs null); acceptable at 1-tenant/≤5-user scale — the app is the sole writer. **Verify the insert returned a row** (RLS silent no-op).

**Cross-cutting:**
- **Recent-outreach exclusion — N8 supersede + N11 + P2:** exclusion is computed from the **latest `outreach_log` row per customer** (supersede: latest outcome wins — a `Reached — interested` un-suppresses an earlier mis-tapped `Bad number`). **Cutoff formula (P2, resolves the last DESIGN-OPEN):** per-outcome suppression windows (Chris ratified 2026-08-11) — `Left message` & `Reached — interested` = **14d**, `Reached — not now` = **30d**, `Bad number` = **180d**, as a named const map. The **server-side fetch window is `gte(created_at, now − MAX(windows))`** (= 180d) so no suppressed row is filtered out before the supersede rule sees it (a narrow 14d window would hide older Bad-number rows and silently un-suppress them — the N8↔N11 trap); a customer is then suppressed **iff `now < latestOutcome.created_at + window(latestOutcome.outcome)`**. All windows finite → a mis-log self-heals, no delete path (N8).
- **Error vs empty — N7 (resolves the H1↔ADJ1 contradiction):** loaders return a **three-state** result — `data` / `empty` / `error` — and never collapse error into empty (`fetchAll` returns `[]` on error → false "All clear"). A real error → non-blocking **"couldn't load — retry"**; a missing relation (Postgres **`42P01`**, preview-before-migration) → muted **"not provisioned yet"** note, not a crash.
- **Pagination + error surfacing — N10/K10 + P5:** `fetchAll` accepts a **single** order column, so "explicit order" still dups on `created_at` ties (likely right after bulk imports) — order by **`id`** (or extend `fetchAll` to compound-order). ⚠️ **P5:** `fetchAll` also **discards the error** (returns `[]`), so the three-state (data/empty/error, N7) is **unimplementable through it as-is** — the build must add an **error-surfacing variant** (same extension pass as the compound-order one), or the loaders call `supabase` directly with their own paging. All reads pagination-safe. Thresholds are named consts at the top of the file.

### 2.2 Zone 1 — Alerts (`components/followup/AlertCard.jsx` [NEW] + Home)

- **Bid-due alerts only** (Zone 1a dropped — Amendment A1). One group: **Bid due reached** (from `fetchBidDueAlerts`).
- **Display cap (J1):** **10 total**, single **"+N more ▾"** expander revealing the rest inline. (One list, one cap, one expander — the 155-wall anti-pattern the cap exists to prevent.) Ordered `bid_due DESC, id DESC` per §2.1 (RG2) — **due-today pins above older stale** rows.
- Card = `AlertCard`: job number + customer + job name + one-line urgency reason (screenshot 2 copy), action **Update** → `navigate('/calllog/'+id)` → opens `CallLogDetail`, where the rep moves stage / pushes `bid_due` / adds a note and saves (`CallLogDetail.jsx:347-367`). Route verified real (audit passed `/calllog/:id`).
- **Loading state (K14):** while the provider fetch is in flight, render a loading placeholder — **do not flash a false green "All clear."** Empty (loaded, zero rows): "All clear — no bids due."
- **Return path (K11):** the Update round-trip should return the rep to Home, not strand them on `/calllog`. Spec `navigate(-1)` or nav state so N alerts ≠ N manual back-navigations.
- **Responsive (K15):** `AlertCard` must lay out at phone width — reps are the daily users.

### 2.3 Zone 2 — Schedule runway (`components/followup/RunwayBar.jsx` [NEW])

- Reads `schedule_runway_weeks` + `schedule_runway_note` via **`useTenantConfig()`** (K6) — not a bare `getTenantConfig()` — so the admin edit re-renders through the provider instead of writing around it.
- Colored bar rule (locked): **weeks ≥ 3 → green · weeks === 2 → yellow · weeks < 2 → red.** Reuse `C.green / C.amber / C.red`. Note beneath; if `schedule_runway_updated_at` present, "updated {fmtD}".
- ⚠️ **Unset state (E1):** day one `schedule_runway_weeks` is **NULL**, and `null < 2 === true` in JS — plus `config.js:28` merges `{...DEFAULTS, ...data}`, so an explicit DB `null` **overrides** any DEFAULT (the planned DEFAULTS entry does nothing). Without a guard the first morning renders **RED with Zone 3 alarmed**. Spec an explicit **`weeks == null` → neutral "Runway not set — [set it]" state, Zone 3 collapsed.**
- **Loading state (N14):** while `useTenantConfig()` is still resolving, render a loading placeholder — **do not flash "Runway not set"** before the value arrives.
- **Admin/Manager:** inline editor → `updateTenantConfig({ schedule_runway_weeks, schedule_runway_note, schedule_runway_updated_at: now })` then provider refresh. **Sales:** read-only (`["Admin","Manager"].includes(displayRole)`).
  - **Clearing the field (N13):** an emptied number input saves **`null`** (back to unset), not `0` — guard `Number("") → 0` explicitly; the editor distinguishes "cleared → null" from "typed 0 → red".
  - Note: the *client* gate is UI-only — the real write guard is the tenant_config UPDATE policy (see §2.7 / N2).
- **This zone's color is the mode switch:** `runwayColor` (green|yellow|red|**unset**) lifts into Home state, driving Zone 3 expansion. Green/unset = Zone 3 collapsed/muted; yellow/red = expanded. This is the "flip."

### 2.4 Zone 3 — Outbound worklist (`components/followup/OutboundCard.jsx` + `LogOutcomeModal.jsx` [NEW])

- Two sourced lists: **Dormant customers** (`fetchDormantCustomers`) + **Gone-quiet bids** (`fetchGoneQuietBids`).
- **Expansion tied to runway color** (§2.3): green/unset → single collapsed summary line ("N warm leads waiting — expand"); yellow/red → fully expanded, dominates the screen.
- Card = `OutboundCard`: customer name, last touch, last job, phone (`tel:`), **"Log outcome"**.
- **Log outcome** → `LogOutcomeModal`: outcome (`Left message` · `Reached — interested` · `Reached — not now` · `Bad number`) + optional note → `logOutcome(...)`. On success the target drops off (recent-outreach exclusion, keyed on `customer_id` — I1); `logged_by` records who called.
- **Outcome suppression + recovery (K4 + N8 + P2):** per-outcome suppression windows (named const, §2.1) — `Left message` / `Reached — interested` **14d** · `Reached — not now` **30d** · `Bad number` **180d** (Chris ratified) — terminal outcomes suppress longer but **never permanently.** Because UPDATE/DELETE are omitted on `outreach_log` (G1), recovery is a **supersede rule**: the **latest** outcome per customer wins, so one mis-tapped `Bad number` is undone by logging a newer outcome. No row is ever the last word by accident (N8).
- **Loading state (N14):** render a loading placeholder while the snapshot resolves — don't flash the empty state.
- Empty (loaded): "No outbound targets — pipeline's warm." **Error (N7):** distinct **"couldn't load — retry"** state (≠ empty); `42P01` → muted "not provisioned yet" during the preview-before-migration window.

### 2.5 Cross-screen banner (`components/followup/AlertsBanner.jsx` [NEW] + AppShell) + `AlertsProvider`

- **`AlertsProvider`** (`src/lib/alerts.jsx` [NEW]) mounts beside `TenantConfigProvider` (`App.jsx:213`) — **outside `<BrowserRouter>`, so it uses NO router hooks** (B1). It **owns the shared snapshot** (§2.1 — one `call_log` + one `proposals` `fetchAll`) and exposes `{ count, bidDueAlerts, dormant, goneQuiet, footerStats, loading, error, refresh }`. Home + footer consume the snapshot (no second fetch); the banner consumes `count`.
- **Refresh coverage (B1 + N4 — the dead-gate fix, widened):** a Wants-Bid alert clears when the job's stage moves — which happens on **more paths than the Update button**. Round-2 (N4) found `refresh()` covered only one of four stage-write paths and missed the most common (sending a bid). Cover all:
  - `CallLog.jsx onSaved (:155)` — the Update path (deep-link `/calllog/:id` and list-selection share this render block; verified).
  - `ProposalPDFModal.jsx:154` (send bid → Has Bid — the *normal* way a rep clears a Wants-Bid alert), `ProposalDetail.jsx:813` (Sold), `:779` (Parked), `:579` (pull-back → *creates* an alert).
  - **Simpler mop-up (N12):** rather than chase every write site, have the provider **`refresh()` on Home mount and on `visibilitychange`** (tab refocus) — this also fixes the **day-rollover** gap (an overnight tab never shows a bid that came due at midnight). Keep the explicit `refresh()` calls for instant feedback; the mount/visibility refetch is the backstop. `refresh()` is a plain provider fn (no router dep), called from the component layer, never inside `followUp.js`.
  - **Accepted, not wired (P7):** the two INSERT-path mutators that can change alert state — `NewInquiryWizard.jsx:378` (new Wants-Bid) and `ImportToLiveWizard.jsx:497` (archive import) — are **not** given explicit `refresh()` calls; they lean on the mount/visibility backstop. Accepted (these aren't the hot per-alert loop) — noted so it's a decision, not an oversight.
  - **Background refetch UX (P8):** show the loading placeholder **only when there is no snapshot yet** (first load). A `refresh()` over an existing snapshot keeps the **last snapshot visible** (no flash-to-empty on tab refocus or after a write).
- Banner = slim strip (screenshot 3, **recolored to `C.*` tokens — K12**; the screenshot is the old white banner and violates no-white-bg). Mounts in `AppShell` above children (`App.jsx:330`), shown only when `count > 0 && active !== "home"`. Self-exclusion verified sound (no leak to public pages).
- **Layout stability (K13):** banner is **sticky with reserved height**, not an async pop-in that shifts every screen's layout when `count` resolves.

### 2.6 Stats footer strip (Home)

- The big stat cards, pipeline bar, and goal scorecards (`Home.jsx:187-233`) **compress to one slim footer row**: pipeline stage counts + monthly-billings %.
- **All-roles goals line (K2 — Amendment K2):** Sales Dash is Admin/Manager-only (`App.jsx:40`), so the footer must carry the compact goals line (billings % + pipeline) **for every role** — reps keep their number. Full drill-downs stay on Sales Dash.
- **Fed from the shared snapshot (RG3/K1):** pipeline counts + billings % compute **in memory** from the provider's single `call_log` + `proposals` snapshot (§2.1) — the same `sc`/`billing` logic (`Home.jsx:149`/`:137`), no extra fetch. Pass-1's "reuse the provider's data" was wrong because the provider then held only rep-scoped bid-due rows (RG3); the snapshot now carries the full data the footer needs.
- **Snapshot coherence (K5):** footer + Zone 1 derive from the same snapshot, so any `refresh()` updates both together.

### 2.7 DB changes — authored in `command-suite-db` (named only, not written here)

- **Migration A — runway fields + write guard:**
  - `ALTER TABLE tenant_config ADD COLUMN schedule_runway_weeks int, ADD COLUMN schedule_runway_note text, ADD COLUMN schedule_runway_updated_at timestamptz;` (additive).
  - **Role-restricted UPDATE — N2 (the ADJ2 fix, corrected):** prod already has a permissive `tenant_config_update FOR UPDATE TO authenticated` policy, and **policies OR together** — so merely *adding* a role-restricted policy restricts nothing (pass-1's spec was a no-op). Must **`DROP POLICY tenant_config_update` and recreate** it with `USING (id = get_user_tenant_id() AND is_admin_or_manager())` **and an explicit matching `WITH CHECK (...)`** (adjacent finding — matches the `billing_schedule_*` precedent; Postgres defaults it but spell it). The helper `is_admin_or_manager()` already exists (`delete_customer:117`) — **no new mechanism**.
  - ⚠️ **NON-ADDITIVE + app fix REQUIRED — N3 + P1 (corrected):** replacing the UPDATE policy alters the **Settings save path the moment it pushes** (migrations land ahead of the app merge). ❗ **The plan's earlier claim that Settings is role-gated was wrong (P1):** the nav item is hidden for non-managers (`App.jsx:45`) but the **route renders for any role** (`App.jsx:251`) and **`handleSave`/the Save button are ungated** (`Settings.jsx:667,700`) — `canManage` exists (`:654`) but doesn't guard the write. So after the policy tightens, a Sales user's save becomes a **silent no-op showing "Saved."** The **app-side gate must ship with (or before) this migration**: gate `handleSave`/Save on `canManage`, and **row-count-verify in `updateTenantConfig`** (`config.js:43` currently checks `error` only — an RLS-blocked update returns no error and no rows). Rehearse; this is the only change that mutates existing prod behavior.
- **Migration B — outreach log:** `CREATE TABLE outreach_log (id uuid pk, tenant_id uuid NOT NULL DEFAULT get_user_tenant_id() FK tenant_config, customer_id uuid NULL, call_log_id uuid NULL, source text CHECK (source IN ('dormant','gone_quiet')), outcome text, note text, logged_by text, created_at timestamptz DEFAULT now());`
  - **FK delete behavior (C1):** both FKs **`ON DELETE SET NULL`** (`customer_id → customers`, `call_log_id → call_log`). Default `NO ACTION` makes a logged customer **undeletable**, **aborts `merge_customers`**, and **blocks `call_log` deletes** (`CallLogDetail.jsx:320`, `ImportToLiveWizard.jsx:395`). (Verified round 2: `delete_customer`'s preflight can't see `outreach_log`, so SET NULL is the correct half.)
  - ⚠️ **NO CHECK constraint — RG1 (the regression that re-broke C1):** a `CHECK (customer_id IS NOT NULL OR call_log_id IS NOT NULL)` **cancels the SET NULL fix.** `ON DELETE SET NULL` executes as an UPDATE on the outreach row, and CHECKs fire on that update: delete the job → row becomes `(customer, NULL)`; later delete the customer → SET NULL tries `(NULL, NULL)` → **check violation (raw `23514`) aborts the customer delete** — the exact undeletable bug returns, now as an unstructured error the UI can't branch on. **Rule: never a plain CHECK beside SET NULL FKs.** Enforce "at least one FK" **app-side in `logOutcome()`** (§2.1) — it always writes `customer_id` anyway — or a `BEFORE INSERT` trigger. **Migration B ships without the CHECK.**
  - **RLS — enumerate all four (G1):** `SELECT`/`INSERT`/`UPDATE`/`DELETE` per the `invoice_recipients` precedent. INSERT/UPDATE carry explicit `WITH CHECK (tenant_id = get_user_tenant_id())` (the DEFAULT alone doesn't stop a wrong-tenant payload). **OMIT UPDATE/DELETE** — corrections are a new superseding row (§2.4 N8), not an edit; this also stops a rep rewriting another's outcomes.
  - **`merge_customers` repoint — C1 + N9:** add `outreach_log` to the repoint list. ⚠️ Postgres has no `ALTER FUNCTION … ADD`, so this is a **full `CREATE OR REPLACE FUNCTION merge_customers`** — base it on the **canonical current body (`20260520100009`)**, not a fresh draft (the B19 rewrite already lost guardrails once by re-authoring from scratch).
  - **Indexes (K8):** `(customer_id)`, `(call_log_id)`, `(tenant_id, created_at)` composite (bare `(tenant_id)` breaks the `customer_contacts`/`invoice_recipients` precedent).
  - **PowerSync (verified clear):** sync rules enumerate tables explicitly — `outreach_log` invisible to Field; **Migration B is additive-safe cross-app** (Migration A's policy swap is the non-additive one — see N3).
- Rehearse before push (shared-DB discipline). Both migrations land **before** the app merges; §2.1's three-state loaders cover the preview-before-migration window (`42P01` → "not provisioned yet", H1/N7).

---

## §3 Files to touch

**This repo (`sales-command`, branch `feat/home-follow-up-screen`):**
- `src/pages/Home.jsx` — **rewrite**: three zones (bid-due Alerts / RunwayBar / Outbound) + compressed all-roles footer; consume `AlertsProvider` for the Zone 1 list; hold `runwayColor` (incl. `unset`) driving Zone 3 expansion. Remove big stat/goal blocks; no fetch fan-out (K1).
- `src/App.jsx` — mount `AlertsProvider` (beside `TenantConfigProvider`, `:213`, **outside the router**); render `AlertsBanner` in `AppShell` above `{children}` (`:330`), sticky + reserved height.
- `src/pages/CallLog.jsx` — **[EDIT, B1]** `onSaved` (`:155`) calls `useAlerts().refresh()`; return-to-Home path (K11).
- `src/components/ProposalPDFModal.jsx` — **[EDIT, N4]** on send-bid stage write (`:154`) call `refresh()`.
- `src/components/ProposalDetail.jsx` — **[EDIT, N4]** on stage writes (`:813` Sold, `:779` Parked, `:579` pull-back) call `refresh()`. (Home-mount + `visibilitychange` refetch in the provider is the backstop that mops most of this up — N12.)
- `src/lib/followUp.js` — **[NEW]** shared-snapshot loader (ONE `call_log` + ONE `proposals` `fetchAll`) + pure selectors `bidDueAlerts` / `dormantCustomers` / `goneQuietBids` / `footerStats` + `logOutcome` (app-side at-least-one-FK check) + named thresholds. Three-state (data/empty/error) loaders, ordered by `id`.
- `src/lib/alerts.jsx` — **[NEW]** `AlertsProvider` + `useAlerts()` (router-hook-free).
- `src/lib/config.js` — add `schedule_runway_weeks / schedule_runway_note / schedule_runway_updated_at` to `DEFAULTS` (`:3-14`). ⚠️ note E1: a DB `null` overrides DEFAULTS via the `{...DEFAULTS, ...data}` merge — the unset-state guard lives in `RunwayBar`, not here. **[EDIT, P1]** `updateTenantConfig` (`:43`) must **row-count-verify** the update (`.select()` + check rows) — it currently checks `error` only, so an RLS-blocked write returns success with 0 rows ("Saved" but nothing saved).
- `src/pages/Settings.jsx` — **[EDIT, P1]** gate `handleSave`/the Save button (`:667,700`) on the existing `canManage` (`:654`) so Sales can't trigger a write the tightened policy will silently reject.
- `src/components/followup/AlertCard.jsx` — **[NEW]** (bid-due only; phone-responsive)
- `src/components/followup/RunwayBar.jsx` — **[NEW]** (admin inline editor via `useTenantConfig()`; unset-state guard)
- `src/components/followup/OutboundCard.jsx` — **[NEW]**
- `src/components/followup/LogOutcomeModal.jsx` — **[NEW]**
- `src/components/followup/AlertsBanner.jsx` — **[NEW]**

**`command-suite-db` (named only — separate authoring session, flag Chris before touching):**
- **Migration A** — tenant_config runway columns (additive) **+ DROP/recreate `tenant_config_update` with `is_admin_or_manager()`** (N2; non-additive, changes prod Settings save — verify writers are Admin/Manager first, N3).
- **Migration B** — `outreach_log` table + `ON DELETE SET NULL` FKs + **NO CHECK** (RG1; at-least-one-FK enforced app-side) + 4 enumerated RLS policies (omit UPDATE/DELETE) + composite index + **`CREATE OR REPLACE merge_customers` from canonical base `20260520100009`** (N9).
- Rehearse both; push.

**Not touched (deliberate):** `src/components/NewInquiryWizard.jsx` — intake keeps its **mandatory** rep step (Amendment A1); we do NOT make it optional. `SalesDash.jsx` (keeps full stats), `CallLogDetail.jsx` (reused as-is for the Update action), `Team.jsx`. **`ImportToLiveWizard.jsx` — not modified**, but its `created_at`-at-import behavior is the reason dormant last-touch reads from archive `raw_data` (N1).

---

## §4 Out of scope / deferred

- **Runway automation** — computing `schedule_runway_weeks` from Schedule/Field booked-crew data. Manual admin entry for v1; automate once Schedule + Field builds finish. (Locked.)
- **Sold-job neighbors / referrals** (outbound source #3) — fuzzier; deferred. Zone 3 ships with sources #1 (dormant) + #2 (gone-quiet) only. (Locked.)
- **"Who's calling" reporting/analytics** — `outreach_log` captures `logged_by` + outcomes now, but a manager reporting view is a later feature; not built here.
- **Configurable thresholds via Settings UI** — `DORMANT_MONTHS` (6), `GONE_QUIET_DAYS` (30), and the per-outcome suppression windows (`Left message`/`Reached — interested` 14d · `Reached — not now` 30d · `Bad number` 180d — Chris ratified 2026-08-11) are named consts in `followUp.js` for v1; no admin UI to tune them yet. *(This resolves the plan's last DESIGN-OPEN.)*
- **follow_up-date alerts** — the current banner also counted `follow_up === tod()`; the v1 Zone 1 scope is bid-due only. Follow-up-date alerts are not carried into v1 (revisit if Chris wants them back).
- **Zone 1a "Needs claiming" / claim workflow** — dropped for v1 (Amendment A1). Intake always assigns a rep, so there is nothing to claim. **Trigger to revisit:** an ownerless lead source (public web lead form, shared `info@` inbox) that creates New Inquiries with `sales_name` null — then a claim queue earns its place and intake would legitimately allow nulls.
- **Never-imported archive records (N1 boundary):** dormant/outbound only surfaces customers who exist as `call_log`/`customers` rows — i.e. archive records **already pulled to Live**. Archive records still sitting in the History Locker (never imported) create no rows and **do not appear** in Zone 3. Importing is the on-ramp; a "call your un-imported book" surface is out of scope for v1.

---

## §5 Estimate / time budget

Connective piece, moderate size — mostly wiring existing truth into one surface.

| Chunk | Est |
|---|---|
| Migrations A+B in `command-suite-db` (runway cols + policy DROP/recreate, outreach_log w/ SET NULL FKs + NO CHECK, RLS, `merge_customers` CREATE OR REPLACE from canonical base, rehearse, push) | ~1.5h |
| `followUp.js` shared-snapshot loader + selectors (bid-due, dormant w/ archive-date touch-map, gone-quiet by proposal date, logOutcome + app-side FK check) + three-state error + ordering | ~2h |
| `AlertsProvider` (router-free, holds snapshot, mount + visibilitychange refetch) + banner (sticky) + refresh wires (CallLog, ProposalPDFModal, ProposalDetail) | ~1.5h |
| Home rewrite: 3 zones + all-roles footer + runway unset/loading states | ~2.5h |
| Zone cards + LogOutcomeModal (supersede) + RunwayBar editor (useTenantConfig, null-on-clear) | ~1.5h |
| Smoke on preview (bid-due update+send clears alert+banner; dormant shows archive book w/ real dates; log outcome shrinks list + supersede recovers; runway flip; delete/merge still work) | ~0.5h |

**~9.5h build**, roughly one full focused build session after the migrations land. Round-2 rigor (shared snapshot, archive-date touch-map, wider refresh coverage, policy DROP/recreate) added ~1.5h over the pass-1 estimate — worth it: RG1/RG3/N1 were all "ships broken" otherwise. Build in `build` mode (opus 4.8, medium) — migrations gate Zones 2/3.

> ERD note: this loop (#45) stays **open** past this plan pass. Point-at = "open Home on preview, see three zones working" — closes at the built, smoke-verified screen, not here.

---

## Layout / UI (UI first-class)

Reference screenshots: `docs/plans/assets/` — (1) current stats Home, (2) old-system 155-alert wall (the anti-pattern to avoid), (3) the green "You have N alerts → Take Action" banner.

**Vertical stack, urgency top-to-bottom** (replaces the current card grid):

```
┌─ GREETING (kept: "Good morning, Chris" + date) ──────────────┐
│                                                              │
│ ── ZONE 1 · ALERTS · BID DUE REACHED (n) ───────────────────│
│   ▸ [AlertCard] 5183 · Reyman · UNR Main Station     [Update]│  ← due-today pinned on top
│   ▸ [AlertCard] 5184 · Clark Const · UNR Gateway     [Update]│
│   + 6 more ▾                                                 │  ← ONE cap (10), ONE expander
│   (Zone 1a "Needs claiming" removed — Amendment A1)          │
│                                                              │
│ ── ZONE 2 · SCHEDULE RUNWAY ────────────────────────────────│
│   Weeks of booked crew work ahead:  ▓▓▓▓▓░░░  2  (yellow)    │
│   "note…"                              [edit ✎ admin only]   │  ← unset → "Runway not set — [set it]"
│                                                              │
│ ── ZONE 3 · OUTBOUND  (expands when runway yellow/red) ──────│
│   DORMANT CUSTOMERS                                          │
│   ▸ [OutboundCard] Acme · last touch Mar 3 · ☎  [Log outcome]│
│   GONE-QUIET BIDS                                            │
│   ▸ [OutboundCard] 6095 · TEST · last touch …   [Log outcome]│
│                                                              │
│ ── FOOTER · slim stats strip · ALL ROLES (pipeline · bill %) │  ← reps keep their number (K2)
└──────────────────────────────────────────────────────────────┘
```

Cross-screen: `AlertsBanner` = slim green strip (screenshot 3) at the top of `data-app-content` on every screen except Home.

**Style rules (repo CLAUDE.md):**
- **No white backgrounds** — cards use `C.linenCard` / `C.linenDeep`; app ground `C.linen`.
- **Teal buttons get black text** (`C.dark` / `#1c1814`) — Claim/Update/Log-outcome primary buttons.
- **Runway bar + urgency dots** reuse `C.green / C.amber / C.red` (no new tokens); teal (`C.teal`) is the accent, always on dark for pills/badges.
- **Dollar badges** (footer): `C.dark` bg + `C.teal` text, `borderRadius: 6`, `padding: "3px 10px"`.
- **Inputs** (runway editor, log-outcome note): `C.linenDeep` bg + `WebkitAppearance: "none"`.
- **Import `C`/`F` from `src/lib/tokens.js`** — never a local `C` object.
- End the build with an in-browser verify on preview against these rules (UI-first-class discipline).

---

## Audit manifest

> ⛔ **PLAN FROZEN after round 3 (2026-08-11) — no round 4.** Round 3 returned 0 High / 0 regressions / 8 spec-completion findings, all folded in pass 3. Trend 25→17→8 converged. This manifest is retained as the round-3 record; do not re-run `/runaudit`. Next verification is the build (`buildvsplan` + preview smoke).

_Generated by `/auditcriteria` on 2026-08-11 (round 3). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Two rounds in, the plan is close. Round 2 found that three of the round-1 fixes broke when combined; pass-2 repaired all three and made two product calls you ratified (archive dates, gone-quiet signal). This is a **near-dry spot-check** — two reviewers confirming the repairs actually hold against the real database functions, plus one new thing worth a glance: the plan now loads your whole call-log and proposal history into memory on every Home visit. Expect this to come back nearly empty; if it doesn't, look for another fix-pair-interaction, not a fresh category.

### Round
- Plan type: feature
- Current round: 3
- Plan revision under audit: `425bf08` (Plan revision pass 2 — round-2 audit response)
- Findings trend: `round 1 (25; 4H/9M/12L) → round 2 (17; 2H/9M/6L, incl 3 regressions) → round 3 (?)` — **−32% R1→R2, no plateau.** Expect a further drop toward dry. A round-3 count near/above round 2 means the regression fixes spawned new interactions — treat as the signal to freeze scope and build, not to keep revising.

### Prior rounds
- Round 1: `4737912` (response) · audited `d58a9c5` · **4H/9M/12L** (25 caused-by + 4 adjacent) · pattern: **premise-vs-data-reality**.
- Round 2: `425bf08` (response) · audited `4737912` (manifest `9ac6e9e`) · **2H/9M/6L** (17 caused-by incl **3 regressions** RG1/RG2/RG3) · pattern: **fix-pair-interaction**.

**Briefing for agents**: do NOT re-find round-1 or round-2 issues. The two `Plan revision pass N` commit messages are the canonical record of what was addressed (R1: A1–J1, K1–K15, ADJ1–2; R2: RG1–RG3, N1–N14). Attack ONLY material new to `425bf08` — the round-2 *fixes themselves* and the one genuinely new mechanism (the shared in-memory snapshot). Anything already resolved is out of bounds.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant blocked. Sales + Field share Supabase project `pbgvgjjuhnpsumnowuym`.
- **Prod / staging / dev**: Home is live-prod (post-auth landing at scmybiz.com); ships to preview first. ⚠️ **Migration A is now non-additive** (N2/N3 — DROP/recreate `tenant_config_update`) and touches the live Settings save path on push, ahead of the app merge — this is the one change agents should weight for prod-blast.
- **Blocking feature flags**: none.
- **Concurrency profile**: ≤5, single tenant. Multi-user race findings cap at Low; cross-tenant cap at Med.

### Time budget + finding cap
- **Time budget**: 570 min (§5 Estimate: ~9.5h build)
- **Finding cap**: 57 findings

Cap is nominal — this is a spot-check. Synthesis should lead with the top ~5; a round-3 report the size of round 2 is itself the red flag.

### Surface
- Total lines: ~413 (pre-manifest-regen)
- Sections: 9 (§0–§5 + Ideation + Amendments, Layout, Audit manifest)
- [LOCKED] decisions: 4 core + 2 amendments (A1, K2) + 2 ratified round-2 calls (N1 archive-date, N5 gone-quiet signal)
- [DESIGN-OPEN] items: 1 residual — concrete per-outcome suppression windows (numbers). GONE_QUIET signal + touch-map now specified.
- [OPEN] items: 0
- Plan-to-code ratio: ~413 : ~560 est → under 50:1.

### What changed in `425bf08` (round-3 attack surface)
- **RG1 fix:** DROPPED the at-least-one-FK CHECK (it fired on the SET NULL UPDATE and re-broke delete); enforcement moved app-side into `logOutcome()`. Verify the app-side check is the *only* integrity guard and that delete/merge now truly pass with SET NULL alone.
- **RG2 fix:** comparator pinned to `bid_due DESC, id DESC`. Trivial — confirm no residual "asc is correct" language survives.
- **RG3 fix (the new mechanism):** followUp.js now loads **ONE `call_log` + ONE `proposals` `fetchAll`** into a shared snapshot feeding bid-due/dormant/gone-quiet/footer. ⚠️ **New surface:** this pulls the *entire* call_log + proposals table into memory on every Home load AND on every `visibilitychange` refetch (N12). Verify memory/latency at realistic HDSP volume, and that `fetchAll` pagination over the full tables is sound.
- **N1 (ratified):** dormant last-touch from archive `raw_data` date for `archive_record_id`-lineage rows. ⚠️ Residual: the plan says "exact field confirmed at build" — verify a **reliable date actually exists** in `raw_data` (only `job/Bid Due Date` is code-confirmed; a sold/job date is assumed).
- **N2/N3 (ratified path):** Migration A DROP/recreate `tenant_config_update` with `is_admin_or_manager()`. Verify **the helper exists** (`delete_customer:117` cited) and no Sales-role Settings save path breaks.
- **N5/N6:** gone-quiet = newest non-deleted proposal `created_at`; dormant touch-map keyed on call_log customer ∪ per-proposal effective customer. Verify both are buildable from the snapshot as written.
- **N8 supersede:** latest outcome per customer wins (recovery without UPDATE/DELETE). ⚠️ Verify the read-side is coherent with the N11 server-side `gte` window — you need the *latest* row to know if it's terminal, but a time-window filter can hide it.
- **N9:** `merge_customers` = full `CREATE OR REPLACE` from canonical base `20260520100009`. Verify that base is the current live definition.
- **N4:** `refresh()` added at `ProposalPDFModal:154`, `ProposalDetail:813/779/579` + provider mount/visibilitychange backstop. Verify those line refs are the actual stage-write sites.

### New mechanisms (delta from round 2)
- **Shared in-memory snapshot** in `AlertsProvider` (one call_log + one proposals fetch) — the one genuinely new mechanism this round; primary round-3 target.
- App-side at-least-one-FK enforcement in `logOutcome()` (replaces the dropped CHECK).
- `merge_customers` `CREATE OR REPLACE`; `tenant_config_update` DROP/recreate.
- Refresh wires at 3 proposal/call-log stage-write sites + mount/visibilitychange.

### Cross-system reach
- `command-suite-db` — the round-3 schema angle **must reason against the real `delete_customer`, `merge_customers`, and `is_admin_or_manager()` bodies** (migration `20260520100009` for the merge base). This is where the residual risk concentrates.
- Shared project `pbgvgjjuhnpsumnowuym` — `outreach_log` invisible to Field (verified R1/R2); Migration A's policy swap is the non-additive piece.

### Irreversibility
- **Migration A is now non-additive** (policy DROP/recreate — changes prod Settings write path on push). Reversible by restoring the old policy, but flag it. Migration B additive (table). No backfill. No public API change.

### Known weak points (round-3 focus)
- **Snapshot cost:** full call_log + proposals into memory on every load + every tab refocus — the one new scale risk. Likely fine at HDSP volume; confirm, don't assume.
- **N1 date availability:** archive `raw_data` may lack a clean sold/job date; if only a bid-due date exists, last-touch is approximate. Confirm against real data or state the fallback explicitly.
- **N8↔N11 interaction:** supersede (latest wins) vs server-side time-window filter — the classic fix-pair-interaction risk this round. Trace it.
- **Migration A ordering:** non-additive policy change lands before the app merge — confirm current Settings writers are Admin/Manager so nothing breaks in the gap.

### Open questions
- Count: 1 [DESIGN-OPEN] — concrete per-outcome suppression window values (`Bad number` vs `Left message` days).
- Highest-pressure: the N8↔N11 supersede/window interaction — it's the shape of the bug that survived round 2.

### Suggested attack angles (2 total)
1. **Schema-fix verification (RG1 / N2 / N9)** — covers Migrations + RLS + Cross-repo. Required reading: §2.7, the real `delete_customer` + `merge_customers` (`20260520100009`) + `is_admin_or_manager` definitions in `command-suite-db`, `CallLogDetail.jsx:320`, `ImportToLiveWizard.jsx:395`. Specific pressure: does delete/merge genuinely pass now that the CHECK is gone and enforcement is app-side? Is the `merge_customers` CREATE OR REPLACE based on the true current body (no lost guardrails)? Does the DROP/recreate policy match `is_admin_or_manager()`'s real signature, and is the pre-merge prod window safe?
2. **Query / wiring / scale verification (RG3 / N1 / N5-N6 / N8 / N4)** — covers Data layer + Provider + Performance. Required reading: `src/lib/followUp.js` (planned), `AlertsProvider` spec (§2.5), `CallLog.jsx:92,100`, `ImportToLiveWizard.jsx:139-167,489-512` (raw_data date fields), `ProposalPDFModal.jsx:154`, `ProposalDetail.jsx:579/779/813`. Specific pressure: shared-snapshot memory/latency + pagination; does a usable date exist in archive `raw_data` (N1); N8-supersede vs N11-window coherence; are the N4 refresh line refs the actual stage-write sites.

### Suggested agent count: 2

Rationale: round-2 predicted a 1–2 agent spot-check on the regression fixes, and the residual risk cleanly splits two ways — schema correctness (verify against real command-suite-db bodies) and query/wiring/scale (the new snapshot + the N8↔N11 interaction). The settled UI/state surface isn't re-scanned. Drop to 1 only if the schema bodies come back clean on a first read; escalate a single thread rather than adding a third agent.

