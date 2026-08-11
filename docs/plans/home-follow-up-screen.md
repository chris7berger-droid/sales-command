# Plan — Home Screen → Follow-Up Screen

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PLANNED + ROUND-1 AUDIT RESPONSE APPLIED (2026-08-11) — ready for re-audit. Round-1 (4H/9M/12L, pattern: premise-vs-data-reality) folded in; the one decision (A1) ratified by Chris as **drop Zone 1a**.

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

> **Round-1 audit folded in.** Zone 1a (claim) is gone per Amendment A1; the remaining design incorporates findings B1, D1, E1, F1, G1, H1, I1, J1 and the cheap K/ADJ items inline (tagged where they land).

### 2.1 Data layer — `src/lib/followUp.js` [NEW]

One canonical query module (extend-canonical, don't twin). Exports:

- `fetchBidDueAlerts({ displayName, isRep })` → `stage='Wants Bid'` AND `bid_due` not null AND `bid_due <= tod()`. Rep-scoped by `sales_name === displayName` when `isRep`; Admin/Manager see all. **Ordering (J1):** due-today/overdue sort so **today pins above older stale rows** — order by `bid_due desc` within the ≤-today set is wrong; use "most-recently-due first" so a bid due *today* is never buried under a bid that went stale weeks ago. Spell the comparator in the build.
- `fetchAlertCount({ displayName, isRep })` → `bidDueAlerts.length` (drives the banner + footer badge). Single fetch reused by the provider (no separate count query).
- `fetchDormantCustomers()` → **effective customers** whose work is historically sold (**`call_log.stage='Sold'` OR a non-deleted Sold proposal** — D1) with **no `call_log.created_at` within `DORMANT_MONTHS` (=6)**, excluding any customer with an `outreach_log` row in the last `RECONTACT_DAYS` (=14). Returns `{ customerId, name, lastTouch, lastJob, phone }`. Use the effective-customer reconciliation from `CallLog.jsx:100`.
- `fetchGoneQuietBids()` → `stage='Has Bid'`, no Sold proposal on job, stale by **bid inactivity** (not raw `updated_at` — K3), older than `GONE_QUIET_DAYS` (proposal 30, **[DESIGN-OPEN]**). Same recent-outreach exclusion, **keyed on `customer_id`** (see I1).
- `logOutcome({ source, outcome, note, customerId, callLogId, loggedBy })` → inserts one `outreach_log` row; **always writes `customer_id`** even for a gone-quiet bid (I1), so both Zone-3 exclusions key on `customer_id` and a worked bid can't reappear in the dormant list. **Verify the insert returned a row** (RLS silent-no-op rule); caller refetches so the target drops off.

**Cross-cutting (audit):**
- **Error vs empty (ADJ1/H1):** every loader must distinguish a fetch *error* from *no rows* — `fetchAll` returns `[]` on error, which would paint a false "All clear." Each Zone 2/3 fetch is **fail-soft**: `try/catch → console.warn → explicit error/empty state`, never a silent green. This also gives a **degrade path if the preview deploys before the migrations land** (H1): a `relation "outreach_log" does not exist` must NOT crash Home (the post-auth landing) to the ErrorBoundary — Zone 2/3 catch and render empty.
- **Ordering + pagination (K9/K10):** `fetchDormantCustomers`/`fetchGoneQuietBids` MUST pass an explicit `.order()` to `fetchAll` — unordered `.range()` pagination dups/skips past 1000 rows. Exclusion-window comparisons use ISO timestamp math against `outreach_log.created_at`, not `tod()` date-string compares (off at day boundaries).
- All reads via `fetchAll` (pagination-safe). Thresholds are named consts at the top of the file (one place to tune; §4 keeps automation out).

### 2.2 Zone 1 — Alerts (`components/followup/AlertCard.jsx` [NEW] + Home)

- **Bid-due alerts only** (Zone 1a dropped — Amendment A1). One group: **Bid due reached** (from `fetchBidDueAlerts`).
- **Display cap (J1):** **10 total**, single **"+N more ▾"** expander revealing the rest inline. (The sketch's per-group ambiguity is resolved: one list, one cap, one expander — the 155-wall anti-pattern the cap exists to prevent.) **Due-today pins above older stale** rows.
- Card = `AlertCard`: job number + customer + job name + one-line urgency reason (screenshot 2 copy), action **Update** → `navigate('/calllog/'+id)` → opens `CallLogDetail`, where the rep moves stage / pushes `bid_due` / adds a note and saves (`CallLogDetail.jsx:347-367`). Route verified real (audit passed `/calllog/:id`).
- **Loading state (K14):** while the provider fetch is in flight, render a loading placeholder — **do not flash a false green "All clear."** Empty (loaded, zero rows): "All clear — no bids due."
- **Return path (K11):** the Update round-trip should return the rep to Home, not strand them on `/calllog`. Spec `navigate(-1)` or nav state so N alerts ≠ N manual back-navigations.
- **Responsive (K15):** `AlertCard` must lay out at phone width — reps are the daily users.

### 2.3 Zone 2 — Schedule runway (`components/followup/RunwayBar.jsx` [NEW])

- Reads `schedule_runway_weeks` + `schedule_runway_note` via **`useTenantConfig()`** (K6) — not a bare `getTenantConfig()` — so the admin edit re-renders through the provider instead of writing around it.
- Colored bar rule (locked): **weeks ≥ 3 → green · weeks === 2 → yellow · weeks < 2 → red.** Reuse `C.green / C.amber / C.red`. Note beneath; if `schedule_runway_updated_at` present, "updated {fmtD}".
- ⚠️ **Unset state (E1):** day one `schedule_runway_weeks` is **NULL**, and `null < 2 === true` in JS — plus `config.js:28` merges `{...DEFAULTS, ...data}`, so an explicit DB `null` **overrides** any DEFAULT (the planned DEFAULTS entry does nothing). Without a guard the first morning renders **RED with Zone 3 alarmed**. Spec an explicit **`weeks == null` → neutral "Runway not set — [set it]" state, Zone 3 collapsed.** Guard `Number("") → 0` in the editor so a cleared field doesn't save 0-as-red.
- **Admin/Manager:** inline editor → `updateTenantConfig({ schedule_runway_weeks, schedule_runway_note, schedule_runway_updated_at: now })` then provider refresh. **Sales:** read-only (`["Admin","Manager"].includes(displayRole)`). Note: the *client* gate is UI-only — the real write guard is the tenant_config UPDATE policy (see §2.7 / ADJ2).
- **This zone's color is the mode switch:** `runwayColor` (green|yellow|red|**unset**) lifts into Home state, driving Zone 3 expansion. Green/unset = Zone 3 collapsed/muted; yellow/red = expanded. This is the "flip."

### 2.4 Zone 3 — Outbound worklist (`components/followup/OutboundCard.jsx` + `LogOutcomeModal.jsx` [NEW])

- Two sourced lists: **Dormant customers** (`fetchDormantCustomers`) + **Gone-quiet bids** (`fetchGoneQuietBids`).
- **Expansion tied to runway color** (§2.3): green/unset → single collapsed summary line ("N warm leads waiting — expand"); yellow/red → fully expanded, dominates the screen.
- Card = `OutboundCard`: customer name, last touch, last job, phone (`tel:`), **"Log outcome"**.
- **Log outcome** → `LogOutcomeModal`: outcome (`Left message` · `Reached — interested` · `Reached — not now` · `Bad number`) + optional note → `logOutcome(...)`. On success the target drops off (recent-outreach exclusion, keyed on `customer_id` — I1); `logged_by` records who called.
- **Outcome suppression (K4):** a `Bad number` target should not resurface every `RECONTACT_DAYS` forever — suppress terminal outcomes longer (or permanently) vs a soft `Left message`. Spec per-outcome suppression, not a flat 14-day treadmill.
- Empty (loaded): "No outbound targets — pipeline's warm." Error: explicit, not empty (ADJ1).

### 2.5 Cross-screen banner (`components/followup/AlertsBanner.jsx` [NEW] + AppShell) + `AlertsProvider`

- **`AlertsProvider`** (`src/lib/alerts.jsx` [NEW]) mounts beside `TenantConfigProvider` (`App.jsx:213`) — **outside `<BrowserRouter>`, so it uses NO router hooks** (B1). Fetches `fetchBidDueAlerts` once, exposes `{ count, bidDueAlerts, loading, error, refresh }`. Home consumes the list (no second fetch); the banner consumes `count`.
- **Refresh ownership (B1 — the dead-gate fix):** the Update path is `AlertCard → /calllog/:id → CallLogDetail save → CallLog.jsx onSaved (:155)`. Wire **`CallLog.jsx` `onSaved` → `useAlerts().refresh()`** (add `CallLog.jsx` to §3) so a cleared bid actually leaves Zone 1 and the banner. `refresh()` is a plain provider fn (no router dep); it is called from the **component layer**, never from inside `followUp.js`.
- Banner = slim strip (screenshot 3, **but recolored to `C.*` tokens — K12/§ style rule**; the screenshot is the old white banner and violates no-white-bg). Mounts in `AppShell` above children (`App.jsx:330`), shown only when `count > 0 && active !== "home"`. Banner self-exclusion verified sound (no leak to public pages).
- **Layout stability (K13):** banner is **sticky with reserved height**, not an async pop-in that shifts every screen's layout when `count` resolves.

### 2.6 Stats footer strip (Home)

- The big stat cards, pipeline bar, and goal scorecards (`Home.jsx:187-233`) **compress to one slim footer row**: pipeline stage counts + monthly-billings %.
- **All-roles goals line (K2 — Amendment K2):** Sales Dash is Admin/Manager-only (`App.jsx:40`), so the footer must carry the compact goals line (billings % + pipeline) **for every role** — reps keep their number. Full drill-downs stay on Sales Dash.
- **No fetch fan-out (K1):** reuse the provider's data + the existing `sc`/`billing` computation (`Home.jsx:149`/`:137`); do NOT re-issue the heavy legacy `call_log`/`proposals` fetches on top of the provider + Zone 2/3 queries (would fetch `call_log` 4–5× per load). Consolidate.
- **Snapshot coherence (K5):** footer counts derive from the same provider snapshot as Zone 1, so a claim/update refresh updates both together (document as load-time snapshot if a delta is acceptable).

### 2.7 DB changes — authored in `command-suite-db` (named only, not written here)

- **Migration A — runway fields + write guard:** `ALTER TABLE tenant_config ADD COLUMN schedule_runway_weeks int, ADD COLUMN schedule_runway_note text, ADD COLUMN schedule_runway_updated_at timestamptz;` **+ (ADJ2) a role-restricted UPDATE policy** — today any authenticated rep can write `tenant_config` (runway *and* goals) from the console; the client gate is UI-only. Add the policy here (Migration A is the natural home).
- **Migration B — outreach log:** `CREATE TABLE outreach_log (id uuid pk, tenant_id uuid NOT NULL DEFAULT get_user_tenant_id() FK tenant_config, customer_id uuid NULL, call_log_id uuid NULL, source text CHECK (source IN ('dormant','gone_quiet')), outcome text, note text, logged_by text, created_at timestamptz DEFAULT now());`
  - **FK delete behavior (C1 — the breaks-prod finding):** both FKs must be **`ON DELETE SET NULL`** (`customer_id → customers`, `call_log_id → call_log`). Default `NO ACTION` means one logged call makes a customer **undeletable** (the `delete_customer` RPC's HAS_CHILDREN preflight doesn't know the table), **aborts `merge_customers`**, and **blocks `call_log` deletes** (`CallLogDetail.jsx:320`, `ImportToLiveWizard.jsx:395`). **Also add `outreach_log` to the repoint list in `merge_customers`** so merges move its rows. Review both against `delete_customer`/`merge_customers` in `command-suite-db`.
  - **Write-time integrity (I1):** `CHECK (customer_id IS NOT NULL OR call_log_id IS NOT NULL)` — compatible with the SET NULL above (a later delete can null one FK; the check is write-time only).
  - **RLS — enumerate all four, don't hand-wave "4 standard" (G1):** `SELECT`/`INSERT`/`UPDATE`/`DELETE` per the **`invoice_recipients` precedent**. **INSERT and UPDATE must carry an explicit `WITH CHECK (tenant_id = get_user_tenant_id())`** — the column DEFAULT alone does NOT stop an explicit wrong-tenant payload. **Recommend OMITTING UPDATE/DELETE** entirely: corrections should be a new correcting row, not an edit — otherwise a rep can rewrite/delete another rep's logged outcomes, gaming the "who's making calls" visibility the table exists for. (Cross-tenant capped Med at 1 tenant, but the cross-app/shared-DB angle makes the delete-behavior finding the top schema item.)
  - **Indexes (K8):** `(customer_id)`, `(call_log_id)`, and a **`(tenant_id, created_at)` composite** (matches the `customer_contacts`/`invoice_recipients` precedent — a bare `(tenant_id)` index breaks it).
  - **PowerSync (verified clear):** sync rules enumerate tables explicitly, so `outreach_log` is invisible to Field — both migrations are additive-safe cross-app.
- Rehearse before push (shared-DB discipline). Both migrations must land **before** the build's Zone 2/3 wiring works end-to-end; §2.1's fail-soft loaders cover the preview-before-migration window (H1).

---

## §3 Files to touch

**This repo (`sales-command`, branch `feat/home-follow-up-screen`):**
- `src/pages/Home.jsx` — **rewrite**: three zones (bid-due Alerts / RunwayBar / Outbound) + compressed all-roles footer; consume `AlertsProvider` for the Zone 1 list; hold `runwayColor` (incl. `unset`) driving Zone 3 expansion. Remove big stat/goal blocks; no fetch fan-out (K1).
- `src/App.jsx` — mount `AlertsProvider` (beside `TenantConfigProvider`, `:213`, **outside the router**); render `AlertsBanner` in `AppShell` above `{children}` (`:330`), sticky + reserved height.
- `src/pages/CallLog.jsx` — **[EDIT, added per B1]** `onSaved` (`:155`) also calls `useAlerts().refresh()` so a bid-due Update clears the alert + banner. Also spec the return-to-Home path (K11).
- `src/lib/followUp.js` — **[NEW]** `fetchBidDueAlerts` / `fetchAlertCount` / `fetchDormantCustomers` / `fetchGoneQuietBids` / `logOutcome` + named thresholds. (No `claimInquiry` — Zone 1a dropped.) All loaders fail-soft + explicitly ordered.
- `src/lib/alerts.jsx` — **[NEW]** `AlertsProvider` + `useAlerts()` (router-hook-free).
- `src/lib/config.js` — add `schedule_runway_weeks / schedule_runway_note / schedule_runway_updated_at` to `DEFAULTS` (`:3-14`). ⚠️ note E1: a DB `null` overrides DEFAULTS via the `{...DEFAULTS, ...data}` merge — the unset-state guard lives in `RunwayBar`, not here.
- `src/components/followup/AlertCard.jsx` — **[NEW]** (bid-due only; phone-responsive)
- `src/components/followup/RunwayBar.jsx` — **[NEW]** (admin inline editor via `useTenantConfig()`; unset-state guard)
- `src/components/followup/OutboundCard.jsx` — **[NEW]**
- `src/components/followup/LogOutcomeModal.jsx` — **[NEW]**
- `src/components/followup/AlertsBanner.jsx` — **[NEW]**

**`command-suite-db` (named only — separate authoring session, flag Chris before touching):**
- Migration A (tenant_config runway columns **+ role-restricted UPDATE policy**, ADJ2) + Migration B (`outreach_log` table + `ON DELETE SET NULL` FKs + at-least-one-FK CHECK + 4 enumerated RLS policies + composite index). Review against `delete_customer`/`merge_customers` (C1). Rehearse, then push.

**Not touched (deliberate):** `src/components/NewInquiryWizard.jsx` — intake keeps its **mandatory** rep step (Amendment A1); we do NOT make it optional. `SalesDash.jsx` (keeps full stats), `CallLogDetail.jsx` (reused as-is for the Update action), `Team.jsx`.

---

## §4 Out of scope / deferred

- **Runway automation** — computing `schedule_runway_weeks` from Schedule/Field booked-crew data. Manual admin entry for v1; automate once Schedule + Field builds finish. (Locked.)
- **Sold-job neighbors / referrals** (outbound source #3) — fuzzier; deferred. Zone 3 ships with sources #1 (dormant) + #2 (gone-quiet) only. (Locked.)
- **"Who's calling" reporting/analytics** — `outreach_log` captures `logged_by` + outcomes now, but a manager reporting view is a later feature; not built here.
- **Configurable thresholds via Settings UI** — `DORMANT_MONTHS`, `RECONTACT_DAYS`, `GONE_QUIET_DAYS` are named consts in `followUp.js` for v1; no admin UI to tune them yet.
- **follow_up-date alerts** — the current banner also counted `follow_up === tod()`; the v1 Zone 1 scope is bid-due only. Follow-up-date alerts are not carried into v1 (revisit if Chris wants them back).
- **Zone 1a "Needs claiming" / claim workflow** — dropped for v1 (Amendment A1). Intake always assigns a rep, so there is nothing to claim. **Trigger to revisit:** an ownerless lead source (public web lead form, shared `info@` inbox) that creates New Inquiries with `sales_name` null — then a claim queue earns its place and intake would legitimately allow nulls.

---

## §5 Estimate / time budget

Connective piece, moderate size — mostly wiring existing truth into one surface.

| Chunk | Est |
|---|---|
| Migrations A+B in `command-suite-db` (runway + outreach_log w/ SET NULL FKs, RLS, `delete_customer`/`merge_customers` review, rehearse, push) | ~1h |
| `followUp.js` queries (bid-due, dormant w/ effective-customer + Sold-stage, gone-quiet by bid-inactivity, logOutcome) + fail-soft + ordering | ~1.5h |
| `AlertsProvider` (router-free) + banner (sticky) + `CallLog.jsx` refresh wire | ~1h |
| Home rewrite: 3 zones + all-roles footer + runway unset-state | ~2.5h |
| Zone cards + LogOutcomeModal + RunwayBar editor (useTenantConfig) | ~1.5h |
| Smoke on preview (bid-due update clears alert+banner; log outcome shrinks list; runway flip; delete/merge still work) | ~0.5h |

**~8h build**, roughly one focused build session after the migrations land. Zone 1a's removal offsets the extra audit-driven rigor (fail-soft, SET NULL FK review, unset-state) — net ≈ flat. Build in `build` mode (opus 4.8, medium) — migrations are the only hard dependency and gate Zones 2/3.

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

_Generated by `/auditcriteria` on 2026-08-11 (round 2). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Round 1 was heavy and the plan absorbed it — a whole zone got cut and the database change got hardened. This round is a **verification pass, not a fresh hunt**: check that the pass-1 fixes are actually correct, not just written down. The three spots worth a skeptical read are the database delete-behavior fix (does it really keep customers deletable?), the dormant-customer query rewrite (does it actually catch the archive book without dragging in junk?), and the alert-clears-after-update wiring. Three reviewers, tightly aimed at what changed. Expect this to come back much thinner than round 1.

### Round
- Plan type: feature
- Current round: 2
- Plan revision under audit: `4737912` (Plan revision pass 1 — round-1 audit response)
- Findings trend: `round 1 (25 caused-by; 4H/9M/12L) → round 2 (?)` — expect a **drop**, not a plateau: pass-1 removed a whole zone (Zone 1a) rather than adding mechanism. If round 2 comes back ≥ round 1, that's a plateau/scope-creep signal — treat scope-cut as the build-prompt option.

### Prior rounds
- Round 1: `4737912` (response commit) · audited `d58a9c5` · **4H/9M/12L** (25 caused-by after dedup + 4 adjacent) · pattern: **premise-vs-data-reality** (dead claim source, ownerless refresh, missing FK delete behavior).

**Briefing for agents**: do NOT re-find round-1 issues. The `Plan revision pass 1` commit (`4737912`) message is the canonical record of what was addressed (A1–J1 + K1–K15 + ADJ1/ADJ2). Attack ONLY material new to `4737912`: the *fixes themselves* (are they correct / complete?) and any new surface they introduced. Round-1 findings already resolved are out of bounds.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding is F-tier / blocked. Sales + Field share Supabase project `pbgvgjjuhnpsumnowuym`.
- **Prod / staging / dev**: Home is a **live prod** surface (post-auth landing at scmybiz.com). Ships to feature branch → preview deploy first; not live until merged.
- **Blocking feature flags**: none — no flag gates Home.
- **Concurrency profile**: ≤5 (small inbound sales team, single tenant). Multi-user race findings cap at Low.

Cross-tenant findings cap at Med while `live_tenants == 1`. The `outreach_log`/`tenant_config` changes land on the **shared** DB (Field reads it) — a cross-app/breaks-what-works schema finding (like C1 last round) outranks a cross-tenant one.

### Time budget + finding cap
- **Time budget**: 480 min (§5 Estimate: ~8h build)
- **Finding cap**: 48 findings

Cap is loose, but this is a verification round — synthesis should lead with the top ~8 and quarantine the rest. A round-2 report the size of round 1 is itself a red flag.

### Surface
- Total lines: ~398 (pre-manifest-regen)
- Sections: 9 (§0–§5 + Ideation + Amendments, Layout, Audit manifest)
- [LOCKED] decisions: 4 core + 2 amendments (A1 drop-Zone-1a, K2 all-roles footer)
- [DESIGN-OPEN] items: 2 remaining (GONE_QUIET_DAYS staleness threshold; per-outcome suppression window) — RECONTACT baseline + outcome enum now specified
- [OPEN] items: 0
- Plan-to-code ratio: ~398 : ~500 est → under 50:1 (plan grew with audit detail but still ≤ build; not scope-crept)

### What changed in `4737912` (round-2 attack surface)
- **Zone 1a removed** (claim flow, `claimInquiry`, tenant-wide claim query all gone). Verify nothing downstream still references a claim path.
- **C1 fix:** `outreach_log` FKs → `ON DELETE SET NULL`; `outreach_log` added to `merge_customers` repoint list; at-least-one-FK `CHECK`. **Verify against the real `delete_customer`/`merge_customers` in `command-suite-db`** — the plan asserts this resolves undeletable-customer/merge-abort but the RPC bodies weren't shown.
- **D1 fix:** dormant qualifier = `call_log.stage='Sold'` OR non-deleted Sold proposal, via the "effective-customer" pattern (`CallLog.jsx:100`). Verify it captures the archive book **without** false positives (e.g. a still-active customer with an old Sold job).
- **B1 fix:** `AlertsProvider` outside router + `CallLog.jsx onSaved → useAlerts().refresh()`. Verify `onSaved` actually fires on the bid-due Update path and the refresh reaches the provider.
- **E1 fix:** runway `weeks == null` → neutral unset state (guards `null < 2` and the `{...DEFAULTS, ...data}` override). Verify the guard covers `Number("")→0` and the color/mode-flip for `unset`.
- **G1/I1 fix:** RLS enumerated with explicit `WITH CHECK`, UPDATE/DELETE omitted; `logOutcome` always writes `customer_id`. Verify the omit-UPDATE/DELETE choice doesn't break a needed correction path.
- **K3:** gone-quiet staleness moved off raw `updated_at` to "bid inactivity" — but the concrete signal is still **[DESIGN-OPEN]**.

### New mechanisms (unchanged from round 1 except as noted)
- New columns: `tenant_config.schedule_runway_weeks/note/updated_at` + a **role-restricted UPDATE policy** (ADJ2, new this round).
- New table: `outreach_log` — now with `ON DELETE SET NULL` FKs, at-least-one-FK CHECK, composite `(tenant_id, created_at)` index, 4 enumerated policies (UPDATE/DELETE omitted).
- New helpers (`src/lib/followUp.js`): `fetchBidDueAlerts`, `fetchAlertCount`, `fetchDormantCustomers`, `fetchGoneQuietBids`, `logOutcome` — **`claimInquiry` removed.**
- New context `AlertsProvider`/`useAlerts`; new components `AlertCard` (bid-due only), `RunwayBar`, `OutboundCard`, `LogOutcomeModal`, `AlertsBanner`.
- Edit (new this round): `CallLog.jsx onSaved` refresh wire.

### Cross-system reach
- `command-suite-db` — sole authoring site for both migrations; **round 2 must reason against the real `delete_customer`/`merge_customers` bodies** to confirm C1.
- Shared Supabase project `pbgvgjjuhnpsumnowuym` — Field reads it; PowerSync sync rules enumerate tables explicitly (round-1 verified `outreach_log` invisible to Field — additive-safe).

### Irreversibility
- 2 **additive** migrations (columns + table), shared-ledger-coordinated (rehearse-before-push). `ON DELETE SET NULL` is the only behavioral FK choice — reversible but verify it's the intended semantics (a deleted customer's outcome rows survive with null `customer_id`).
- No backfill. No public API change.

### Known weak points (round-2 focus)
- **C1 completeness:** plan claims SET NULL + merge repoint fixes undeletable-customer, but correctness depends on `delete_customer`'s HAS_CHILDREN preflight and `merge_customers`' repoint list in `command-suite-db` — unverified against actual RPC source.
- **D1 false positives:** the OR-qualifier could surface customers who are Sold-historical but currently active in a *different* way the 6-month call_log window misses, or vice-versa. Pressure the effective-customer join.
- **B1 fire path:** does `CallLog.jsx onSaved` (`:155`) actually run when the save happens inside `CallLogDetail` reached via `/calllog/:id`? If onSaved is list-page-only, the refresh still doesn't fire.
- **GONE_QUIET signal still open:** "bid inactivity" is named but not defined; DESIGN-OPEN.
- **omit UPDATE/DELETE on outreach_log:** confirm no legitimate flow needs to edit/delete an outreach row (e.g. a mis-logged outcome) — if it does, the "new correcting row" model must be spelled.

### Open questions
- Count: 2 [DESIGN-OPEN] — GONE_QUIET_DAYS + its concrete "bid inactivity" signal; per-outcome suppression windows (esp. "Bad number").
- Highest-pressure: the gone-quiet staleness signal — governs Zone 3 volume and the usefulness of the runway "flip."

### Suggested attack angles (3 total)
1. **Schema-fix verification (C1/G1/I1/ADJ2)** — covers Migrations + RLS + Cross-repo. Required reading: §2.7, the actual `delete_customer` + `merge_customers` definitions in `command-suite-db`, `CallLogDetail.jsx:320`, `ImportToLiveWizard.jsx:395`, RLS+tenant_id pattern. Specific pressure: does `ON DELETE SET NULL` + merge repoint genuinely keep customers deletable and merges working? Is the at-least-one-FK CHECK compatible with SET NULL over time? Does omitting UPDATE/DELETE strand a correction need? Is the tenant_config UPDATE policy correct?
2. **Query-fix verification (D1/K3/K9/K10)** — covers Data layer + Performance. Required reading: `src/lib/followUp.js` (planned), `CallLog.jsx:92,100` (effective-customer), `ImportToLiveWizard.jsx:497`, `supabaseHelpers.js`. Specific pressure: dormant OR-qualifier correctness (archive Sold-stage capture, no false positives); gone-quiet "bid inactivity" definition gap; explicit ordering on paginated `fetchAll`; ISO-timestamp exclusion-window math.
3. **State & wiring verification (B1/E1/H1/ADJ1)** — covers State model + Provider + Fail-soft. Required reading: `App.jsx:213,215,330`, `CallLog.jsx:155`, `CallLogDetail.jsx:347-367`, `config.js:28`. Specific pressure: does the Update→onSaved→refresh chain actually fire and reach the provider (does the alert clear)? Runway `unset` guard completeness (`null`, `""`, `Number("")→0`, mode-flip). Fail-soft loaders distinguishing error from empty (no false "All clear"). Provider-outside-router constraint honored.

### Suggested agent count: 3

Rationale: the raw formula still yields 5 by layer count, but round 2 is a **verification round against a concentrated delta** — the UI/framework surface (angle 4 last round) settled and isn't re-scanned. Three angles map 1:1 onto the three fix-clusters that carry residual risk (schema, query, wiring); a 4th would re-plow verified ground. If the schema angle finds the RPC bodies contradict the plan, escalate that thread rather than adding agents.

