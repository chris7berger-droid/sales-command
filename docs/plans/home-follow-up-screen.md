# Plan — Home Screen → Follow-Up Screen

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** IDEATED (2026-08-11) — structure locked with Chris, ready for plan pass.

**Intent:** Convert the Sales Command home screen into a follow-up screen, integrating the old system's follow-up/alert features (New Inquiry claim alerts, Wants Bid due-date alerts, "You have N alerts → Take Action" banner). Reference screenshots: `docs/plans/assets/` (committed b3c98b9).

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
- Rep assignment lives in **`call_log.sales_name`** (text, matches `team_members.name` — not an FK). Written as `form.sales_name || null` (`CallLogDetail.jsx:359`); the New Inquiry wizard sets `sales_name: data.salesName` which can be blank → **null** (`NewInquiryWizard.jsx:378`).
- **"Unassigned" = `sales_name IS NULL` (or empty string).** Reassignment precedent: `Team.jsx:247-273` selects inactive-rep jobs and `.update({ sales_name: assignTo })`.
- ⚠️ **CRITICAL CONSTRAINT:** Home's current rep filter (`Home.jsx:108`) keeps only `sales_name === displayName`. Unassigned New Inquiries (`sales_name` null) would therefore be **invisible to a rep** under the existing query. Zone 1's "needs claiming" list MUST be a **separate, tenant-wide (un-rep-filtered) query**, or it shows nothing for the people who most need to claim.

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
- **Dormant customers** (source #1): customer with ≥1 historical **Sold** proposal AND **no `call_log` row `created_at` within 6 months** (hardcoded v1). Join path: `proposals.status='Sold'` → `proposals.call_log_id` → `call_log.customer_id` → `customers`. "Last touch"/"last job" from most-recent `call_log` for that customer.
- **Gone-quiet bids** (source #2): `call_log.stage='Has Bid'` with **no Sold proposal** on that job, **stale** by `call_log.updated_at` (auto-trigger timestamptz). Staleness threshold is **[DESIGN-OPEN]** (proposal: 30 days) — see §2.
- Both zones use `fetchAll` (`src/lib/supabaseHelpers.js`) to bypass the 1000-row PostgREST cap.

### 0.7 Outcome write-back has no home yet

- Grep for `outreach | outcome_log | call_outcome | logged_call` in `src/` → **no existing table or writer**. Zone 3's "log the outcome" needs a **new `outreach_log` table** (authored in `command-suite-db`) so the worklist can shrink as calls are made and Chris can see who's calling.

### 0.8 Cross-screen banner mount point

- `AppShell` (`App.jsx:268`) wraps every authed route; children render at `App.jsx:330-331` inside `data-app-content` (`<ErrorBoundary>{children}</ErrorBoundary>`). The slim banner mounts here, **above** children, shown when `count > 0 && active !== "home"` (`active = sectionFromPath(location.pathname)`, `App.jsx:271`). Home *is* the alert screen, so it self-excludes.
- AppShell fetches no data today. The banner's alert count must come from a **shared source** so Home and the banner don't double-fetch or drift — see AlertsProvider in §2.4.
- Provider precedent: `TenantConfigProvider` already wraps the app (`App.jsx:213`).

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

### 2.1 Data layer — `src/lib/followUp.js` [NEW]

One canonical query module (extend-canonical, don't twin). Exports:

- `fetchClaimAlerts()` → New Inquiry, `sales_name` null/empty, **tenant-wide** (never rep-filtered — see §0.3). `select id, display_job_number, customer_name, job_name, jobsite_address, created_at`, order `created_at asc` (oldest first). Returns all; caller caps display.
- `fetchBidDueAlerts({ displayName, isRep })` → `stage='Wants Bid'` AND `bid_due <= tod()` AND `bid_due not null`. Rep-scoped by `sales_name === displayName` when `isRep` (these are *your* bids to defend); Admin/Manager see all. Order `bid_due asc`.
- `fetchAlertCount({ displayName, isRep })` → `claimAlerts.length + bidDueAlerts.length` (drives the banner + footer badge). Single fetch reused by the provider.
- `fetchDormantCustomers()` → customers with a historical Sold proposal and no `call_log.created_at` within 6 months (`DORMANT_MONTHS = 6`, hardcoded const). Returns `{ customer, lastTouch, lastJob, phone }`, excluding any customer with an `outreach_log` row in the last `RECONTACT_DAYS` (proposal: 14).
- `fetchGoneQuietBids()` → `stage='Has Bid'`, no Sold proposal on job, `updated_at` older than `GONE_QUIET_DAYS` (proposal: 30, **[DESIGN-OPEN]**). Same recent-outreach exclusion.
- `logOutcome({ source, outcome, note, customerId, callLogId, loggedBy })` → inserts `outreach_log` row; **verify insert succeeded** (RLS silent-no-op rule), then caller refetches so the worked target drops off.
- `claimInquiry({ id, displayName })` → `update call_log set sales_name = displayName where id`; **verify the update returned the row** (RLS can silently no-op), refresh on success. Mirrors `Team.jsx:273`.

All reads via `fetchAll` (pagination-safe). Thresholds are named consts at the top of the file (one place to tune; §4 keeps automation out).

### 2.2 Zone 1 — Alerts (`components/followup/AlertCard.jsx` [NEW] + Home)

- Two labeled groups: **Needs claiming** (from `fetchClaimAlerts`) and **Bid due reached** (from `fetchBidDueAlerts`), oldest-first.
- **Display cap:** top 10 per the locked decision (the old system's 155-wall trained people to ignore it) with a **"+N more"** expander that reveals the rest inline. Screenshot 2 is the anti-pattern reference.
- Card = `AlertCard`: job number + customer + job name + a one-line urgency reason (matching screenshot 2 copy), plus the action:
  - **Claim** (needs-claiming) → `claimInquiry()` → row animates out, count decrements. No navigation.
  - **Update** (bid-due) → `navigate('/calllog/'+id)` → opens `CallLogDetail`, where the rep already can move stage / push `bid_due` / add a note and save (`CallLogDetail.jsx:347-367`). No new edit surface needed — reuse the job-detail home.
- Empty state: "All clear — nothing to claim, no bids due." (green check, not a blank).

### 2.3 Zone 2 — Schedule runway (`components/followup/RunwayBar.jsx` [NEW])

- Reads `schedule_runway_weeks` + `schedule_runway_note` from `getTenantConfig()`.
- Colored bar rule (locked): **weeks ≥ 3 → green · weeks === 2 → yellow · weeks < 2 → red.** Reuse `C.green / C.amber / C.red`. Note rendered beneath; if `schedule_runway_updated_at` present, show "updated {fmtD}".
- **Admin/Manager:** inline editor — number input + one-line note → `updateTenantConfig({ schedule_runway_weeks, schedule_runway_note, schedule_runway_updated_at: now })`. **Sales:** read-only (gated by `["Admin","Manager"].includes(displayRole)`).
- **This zone's color is the mode switch:** `runwayColor` (green|yellow|red) is lifted into Home state and passed to Zone 3 to control expansion (§2.4). Green = Zone 3 collapsed/muted; yellow/red = Zone 3 expanded and emphasized. This is the "flip" Chris is fired up about.

### 2.4 Zone 3 — Outbound worklist (`components/followup/OutboundCard.jsx` + `LogOutcomeModal.jsx` [NEW])

- Two sourced lists: **Dormant customers** (`fetchDormantCustomers`) and **Gone-quiet bids** (`fetchGoneQuietBids`).
- **Expansion tied to runway color** (§2.3): green → render as a single collapsed summary line ("N warm leads waiting — expand"); yellow/red → fully expanded, this zone visually dominates the screen.
- Card = `OutboundCard`: customer name, last touch date, last job, phone (tap-to-call `tel:`), and a **"Log outcome"** action.
- **Log outcome** → `LogOutcomeModal`: pick an outcome (`Left message` · `Reached — interested` · `Reached — not now` · `Bad number`) + optional note → `logOutcome(...)`. On success the target drops off the list (recent-outreach exclusion) so the worklist shrinks as it's worked; `logged_by` records who called.
- Empty state when nothing dormant/quiet: "No outbound targets — pipeline's warm."

### 2.5 Cross-screen banner (`components/followup/AlertsBanner.jsx` [NEW] + AppShell)

- Slim green strip mirroring screenshot 3: **"You have N alerts → Take Action"**, links to `/home`.
- Mounts in `AppShell` above children (`App.jsx:330`), shown only when `count > 0 && active !== "home"`.
- Count from an **`AlertsProvider`** (`src/lib/alerts.jsx` [NEW]) mounted beside `TenantConfigProvider` (`App.jsx:213`): fetches `fetchAlertCount` once, exposes `{ count, claimAlerts, bidDueAlerts, refresh }`. Home consumes the full lists (no second fetch); the banner consumes `count`; `claimInquiry`/`CallLogDetail` save call `refresh()`. Single source, no drift.

### 2.6 Stats footer strip (Home)

- The big stat cards, pipeline bar, and goal scorecards (`Home.jsx:187-233`) **compress to one slim footer row**: pipeline stage counts + monthly-billings % (reuse `StatCard`/`SectionHeader`, keep the existing `sc`/`billing` computation from `:149`/`:137`). Full stats remain on **Sales Dash** — nothing lost, just relocated per locked decision #4.

### 2.7 DB changes — authored in `command-suite-db` (named only, not written here)

- **Migration A — runway fields:** `ALTER TABLE tenant_config ADD COLUMN schedule_runway_weeks int, ADD COLUMN schedule_runway_note text, ADD COLUMN schedule_runway_updated_at timestamptz;`
- **Migration B — outreach log:** `CREATE TABLE outreach_log (id uuid pk, tenant_id uuid NOT NULL DEFAULT get_user_tenant_id() FK tenant_config, customer_id uuid NULL FK customers, call_log_id uuid NULL FK call_log, source text CHECK (source IN ('dormant','gone_quiet')), outcome text, note text, logged_by text, created_at timestamptz DEFAULT now());` with the **4 standard RLS policies + tenant_id default + indexes** on `(customer_id)`, `(call_log_id)`, `(created_at)` per the RLS+tenant_id pattern. Rehearse before push (shared-DB discipline). Both migrations must land **before** the build's Zone 2/3 wiring works end-to-end.

---

## §3 Files to touch

**This repo (`sales-command`, branch `feat/home-follow-up-screen`):**
- `src/pages/Home.jsx` — **rewrite**: three zones (Alerts / RunwayBar / Outbound) + compressed footer; consume `AlertsProvider` for Zone 1 lists; hold `runwayColor` state driving Zone 3 expansion. Remove big stat/goal blocks.
- `src/App.jsx` — mount `AlertsProvider` (beside `TenantConfigProvider`, `:213`); render `AlertsBanner` in `AppShell` above `{children}` (`:330`).
- `src/lib/followUp.js` — **[NEW]** all zone queries + `claimInquiry`/`logOutcome` + named thresholds.
- `src/lib/alerts.jsx` — **[NEW]** `AlertsProvider` + `useAlerts()` hook.
- `src/lib/config.js` — add `schedule_runway_weeks / schedule_runway_note / schedule_runway_updated_at` to `DEFAULTS` (`:3-14`).
- `src/components/followup/AlertCard.jsx` — **[NEW]**
- `src/components/followup/RunwayBar.jsx` — **[NEW]** (includes admin inline editor)
- `src/components/followup/OutboundCard.jsx` — **[NEW]**
- `src/components/followup/LogOutcomeModal.jsx` — **[NEW]**
- `src/components/followup/AlertsBanner.jsx` — **[NEW]**

**`command-suite-db` (named only — separate authoring session, flag Chris before touching):**
- Migration A (tenant_config runway columns) + Migration B (`outreach_log` table + RLS). Rehearse, then push.

**Not touched:** `SalesDash.jsx` (keeps full stats), `CallLogDetail.jsx` (reused as-is for the Update action), `Team.jsx`.

---

## §4 Out of scope / deferred

- **Runway automation** — computing `schedule_runway_weeks` from Schedule/Field booked-crew data. Manual admin entry for v1; automate once Schedule + Field builds finish. (Locked.)
- **Sold-job neighbors / referrals** (outbound source #3) — fuzzier; deferred. Zone 3 ships with sources #1 (dormant) + #2 (gone-quiet) only. (Locked.)
- **"Who's calling" reporting/analytics** — `outreach_log` captures `logged_by` + outcomes now, but a manager reporting view is a later feature; not built here.
- **Configurable thresholds via Settings UI** — `DORMANT_MONTHS`, `RECONTACT_DAYS`, `GONE_QUIET_DAYS` are named consts in `followUp.js` for v1; no admin UI to tune them yet.
- **follow_up-date alerts** — the current banner also counted `follow_up === tod()`; the locked Zone 1 scope is claim + bid-due only. Follow-up-date alerts are not carried into v1 (revisit if Chris wants them back).

---

## §5 Estimate / time budget

Connective piece, moderate size — mostly wiring existing truth into one surface.

| Chunk | Est |
|---|---|
| Migrations A+B in `command-suite-db` (author, rehearse, push) | ~0.5h |
| `followUp.js` queries + claim/logOutcome + thresholds | ~1.5h |
| `AlertsProvider` + banner in AppShell | ~1h |
| Home rewrite: 3 zones + footer strip | ~2.5h |
| Zone cards + LogOutcomeModal + RunwayBar editor | ~1.5h |
| Smoke on preview (three zones working, claim/log write-backs verified) | ~0.5h |

**~7–8h build**, i.e. roughly one focused build session after the migrations land. Build in `build` mode (opus 4.8, medium) — migrations are the only hard dependency and gate Zones 2/3.

> ERD note: this loop (#45) stays **open** past this plan pass. Point-at = "open Home on preview, see three zones working" — closes at the built, smoke-verified screen, not here.

---

## Layout / UI (UI first-class)

Reference screenshots: `docs/plans/assets/` — (1) current stats Home, (2) old-system 155-alert wall (the anti-pattern to avoid), (3) the green "You have N alerts → Take Action" banner.

**Vertical stack, urgency top-to-bottom** (replaces the current card grid):

```
┌─ GREETING (kept: "Good morning, Chris" + date) ──────────────┐
│                                                              │
│ ── ZONE 1 · ALERTS ─────────────────────────────────────────│
│   NEEDS CLAIMING (n)                                         │
│   ▸ [AlertCard] 7082 · CSI Construction · Les Schwab   [Claim]│
│   BID DUE REACHED (n)                                        │
│   ▸ [AlertCard] 5183 · Reyman · UNR Main Station     [Update]│
│   + 6 more ▾                                                 │
│                                                              │
│ ── ZONE 2 · SCHEDULE RUNWAY ────────────────────────────────│
│   Weeks of booked crew work ahead:  ▓▓▓▓▓░░░  2  (yellow)    │
│   "note…"                              [edit ✎ admin only]   │
│                                                              │
│ ── ZONE 3 · OUTBOUND  (expands when runway yellow/red) ──────│
│   DORMANT CUSTOMERS                                          │
│   ▸ [OutboundCard] Acme · last touch Mar 3 · ☎  [Log outcome]│
│   GONE-QUIET BIDS                                            │
│   ▸ [OutboundCard] 6095 · TEST · last touch …   [Log outcome]│
│                                                              │
│ ── FOOTER · slim stats strip (pipeline counts · billings %) ─│
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

_Generated by `/auditcriteria` on 2026-08-11. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a real feature — Home gets rebuilt into three working zones, and it adds one new table plus a couple of columns on the shared database. The single riskiest spot is the "needs claiming" list: the way Home filters today would actually hide unassigned inquiries from the reps who need to claim them, so the plan routes around it — and that routing is the thing an audit should hammer. Four reviewers: one on the queries, one on the database change, one on the save-and-refresh logic, one on the screen itself.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: `e4ad6d4` (+ uncommitted plan-pass expansion, committed alongside this manifest)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: attack the plan revision under audit. There are no prior rounds to avoid re-finding.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding is F-tier / blocked. Sales + Field share Supabase project `pbgvgjjuhnpsumnowuym`.
- **Prod / staging / dev**: Home is a **live prod** surface (post-auth landing at scmybiz.com). This rebuild ships to the feature branch → preview deploy first; not live until merged.
- **Blocking feature flags**: none — no flag gates Home.
- **Concurrency profile**: ≤5 (small inbound sales team, single tenant). Multi-user race findings cap at Low.

Agents weight severity against these. Cross-tenant findings cap at Med while `live_tenants == 1`. `outreach_log` and the new `tenant_config` columns land on the **shared** DB — a cross-app schema finding (Field also reads the project) is legitimately higher than a cross-tenant one.

### Time budget + finding cap
- **Time budget**: 450 min (§5 Estimate: ~7–8h build)
- **Finding cap**: 45 findings

Cap is loose because the surface is a genuine multi-zone feature; synthesis should still lead with the top ~10 most consequential and quarantine the rest.

### Surface
- Total lines: ~276 (pre-manifest)
- Sections: 9 (§0–§5 + Ideation, Layout, Audit manifest)
- [LOCKED] decisions: 4 core (follow-up-takes-Home · three-zone order · manual-runway-v1 · banner-on-every-other-screen) + sub-locks in §4
- [DESIGN-OPEN] items: 3 (GONE_QUIET_DAYS staleness threshold; recontact window; outcome-option set)
- [OPEN] items: 0
- Plan-to-code ratio: ~276 : ~500 est → well under 50:1 (plan is smaller than the build; not scope-crept)

### Layers touched
- UI / components (Home rewrite + 5 new followup components + AppShell banner)
- Data layer (new `followUp.js` query module)
- State model (runway columns, `outreach_log` source enum, provider-held alert state)
- RLS / auth / multi-tenancy (`outreach_log` policies + tenant_id default; admin-gated runway write)
- Migrations / schema (2 additive migrations, shared ledger)
- Cross-repo (authored in `command-suite-db`, lands on shared DB)
- Performance / pagination (dormant + gone-quiet join queries over call_log × proposals × customers via `fetchAll`)

### New mechanisms introduced
- New columns: `tenant_config.schedule_runway_weeks` (int), `schedule_runway_note` (text), `schedule_runway_updated_at` (timestamptz)
- New table: `outreach_log` (id, tenant_id, customer_id?, call_log_id?, source, outcome, note, logged_by, created_at)
- New helpers (`src/lib/followUp.js`): `fetchClaimAlerts`, `fetchBidDueAlerts`, `fetchAlertCount`, `fetchDormantCustomers`, `fetchGoneQuietBids`, `logOutcome`, `claimInquiry` + named threshold consts
- New context: `AlertsProvider` / `useAlerts` (`src/lib/alerts.jsx`)
- New components: `AlertCard`, `RunwayBar`, `OutboundCard`, `LogOutcomeModal`, `AlertsBanner`
- New RLS policies: 4 standard on `outreach_log`

### Cross-system reach
- `command-suite-db` — sole authoring site for both migrations (this repo owns no migrations since 2026-06-29)
- Shared Supabase project `pbgvgjjuhnpsumnowuym` — Field Command reads the same DB; new columns/table are visible cross-app
- No edge functions, no external services (QB/Stripe/email untouched)

### Irreversibility
- 2 **additive** migrations (columns + table) — non-destructive, but **shared-ledger-coordinated** (rehearse-before-push discipline applies)
- No data backfill
- No public API change

### Known weak points
- **§0.3 — the unassigned trap:** Home's existing rep filter (`Home.jsx:108`) keeps only `sales_name === displayName`; unassigned New Inquiries are `sales_name IS NULL` and would be invisible to reps. The plan mandates a tenant-wide claim query — verify no code path silently re-applies the rep filter to Zone 1.
- **Dormant query correctness (§2.1):** "sold in the past AND no call_log in 6 months" is a negative join across 3 tables; easy to get the anti-join wrong (customers with zero call_log rows, or a Sold proposal on a *different* customer). Pressure the join shape + `fetchAll` pagination interacting with the anti-join.
- **Write-path silent no-op:** both `claimInquiry` and `logOutcome` must verify the write returned a row (RLS silent-no-op rule); a claim that no-ops leaves the alert stuck and the count wrong.
- **Provider drift:** `AlertsProvider` is the single source for count (banner) and lists (Home). If Home refetches independently or `refresh()` isn't called after claim/update, banner and screen disagree.
- **outreach_log RLS + tenant_id:** must follow the RLS+tenant_id pattern exactly (default `get_user_tenant_id()`, 4 policies); a missing INSERT policy makes `logOutcome` silently no-op (storage-remove-style trap).
- **GONE_QUIET_DAYS undefined (§2.4):** staleness threshold is DESIGN-OPEN; an unset/loose value floods Zone 3 or starves it.

### Open questions
- Count: 3 (all [DESIGN-OPEN], §2.1/§2.4) — GONE_QUIET_DAYS staleness threshold, RECONTACT_DAYS re-contact window, the outcome-option enum set.
- Highest-pressure: GONE_QUIET_DAYS — it directly governs Zone 3 volume and thus whether the "flip" feels useful or noisy.

### Suggested attack angles (4 total)
1. **Query correctness & data-layer** — covers Data layer + Performance + State model. Required reading: `src/lib/followUp.js` (planned), `src/pages/Home.jsx:99-153`, `src/lib/supabaseHelpers.js`, `src/lib/utils.js`. Specific pressure: the unassigned tenant-wide claim query (§0.3 trap); `bid_due <= tod()` wall-clock comparison; dormant anti-join correctness across call_log × proposals × customers; gone-quiet staleness; recent-outreach exclusion; `fetchAll` pagination vs anti-joins.
2. **Schema / migration / cross-repo** — covers Migrations + RLS + Cross-repo. Required reading: §2.7, CLAUDE.md schema block, RLS+tenant_id pattern. Specific pressure: `outreach_log` RLS completeness (esp. INSERT policy → silent no-op), tenant_id default, FK nullability (customer_id/call_log_id both nullable — is that intended?), shared-ledger coordination, additive-migration safety on the shared DB Field also reads.
3. **State model & write-path integrity** — covers State model + Auth-gating + Data integrity. Required reading: `Team.jsx:247-273` (claim precedent), `config.js:41`, `CallLogDetail.jsx:347-367`. Specific pressure: `claimInquiry`/`logOutcome` write-verify (RLS no-op), `AlertsProvider` single-source coherence + `refresh()` call sites, admin-only runway gate, runway-color → Zone 3 mode-flip logic.
4. **UI / interaction & framework fit** — covers UI + Framework fit. Required reading: `App.jsx:212-260,330`, screenshots in `docs/plans/assets/`, repo CLAUDE.md style rules. Specific pressure: banner mount + `active !== "home"` self-exclude, top-10 cap + "+N more" expander (the 155-wall anti-pattern), footer compression without losing Sales Dash stats, no-white-bg / teal-black-text / import-from-tokens compliance.

### Suggested agent count: 4

Rationale: the formula yields 5 (7 layers + cross-system + novel mechanisms), but pure cost/perf and standalone UI don't each warrant a dedicated agent here — grouping the 7 layers into the 4 angles above covers the surface without a redundant fifth; if the audit wants a 5th, split cost/perf off angle 1.

