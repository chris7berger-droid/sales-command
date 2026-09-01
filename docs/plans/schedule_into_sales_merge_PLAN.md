# Schedule → Sales Merge (Subcon Command) — BUILDABLE PLAN

**Status:** PLAN PASS — 2026-09-01. Turns the 8 locked ideate beats into a build spec.
**Input (do not re-litigate):** `docs/plans/schedule_into_sales_merge.md` — ideate complete, all 8
beats ratified. Beats are LOCKED; this plan may only *amend* via an appended block
([[feedback_schema_amendment_not_overwrite]]), never silently contradict them.
**Mode:** ideate ✅ → **plan (this doc)** → build. Build is gated on this plan being verified/audited.
**Model for this pass:** opus 4.8 / xhigh.
**Mockup (Phase 1 build target):** https://claude.ai/code/artifact/9349053f-3378-4089-8582-203fa46d554e

---

## 0. Scope & phase map

Five phases, each ships and is useful alone (Beat 3). **Phase 1 (the shell) is the only build
target of the next build session** — it must be built, verified, and live *alone* before Phase 2.

| # | Phase | Touches existing users? | Net-new? | Depends on |
|---|---|---|---|---|
| 1 | **Shell** — grouped sidebar, Subcon Home, `/sales/*` prefix + redirects, Settings-by-app, apps→group-visibility, route guard | **YES (only phase that does)** | Sidebar, Home landing | — |
| 2 | **Schedule moves in** — sch-command/src → `src/schedule/`, mounted `/schedule/*`, CSS fenced, one client/login | No (Schedule has 1 user: Chris) | No (as-is move) | 1 |
| 3 | **Field web** — 6 screens over existing tables + threshold Settings + `tenant_config` migration + PowerSync add | No | **YES (build)** | 1 |
| 4 | **AR moves in** — AR-Command-Center/src → `src/ar/`, mounted `/ar/*` | No | No (as-is move) | 1 |
| 5 | **The name** — login wordmark, `/suite` rewrite, hardcoded-URL sweep, domain forwards | Cosmetic | No | 2,3,4 |

Field **mobile** (offline/PowerSync) is untouched in every phase except a one-line sync-rule add in Phase 3.

This plan specs **Phase 1 in full build depth**. Phases 2–5 are specified to the level that locks
their approach + the concrete tables/migrations knowable now; each gets a `/buildvsplan` pass of its
own before it builds. Field screen *interiors* (Jobs drill-in, Crews, Time Clock layouts) are
deliberately left to Chris's later UI sessions (his call, per the seed) — Phase 3 here specs the
data + the Today list + the threshold plumbing, not the pixel layout of every drill-in.

---

## 1. PHASE 1 — THE SHELL  (first build target)

Rewrites the navigation model in `src/App.jsx` from a **flat 11-item `NAV` array + flat routes**
into **one grouped sidebar (Subcon Home + 4 Command groups + global Settings) + `/sales/*`-prefixed
routes with redirects from every old flat URL**. No page component's internals change. No data
migration. Schedule/Field/AR groups exist in the nav data but are gated OFF until their phase lands.

### 1a. The nav model (replaces the flat `NAV` at `src/App.jsx:36-48`)

Introduce a grouped structure (proposed `src/lib/nav.js` so Sidebar, header breadcrumb, route guard,
and Subcon Home all read one source — no drifting twin, [[feedback_extend_canonical_not_twin]]):

```js
// src/lib/nav.js
export const SUBCON_HEADER = "SUBCON COMMAND";           // sidebar wordmark: SUBCON white / COMMAND teal

// Which app groups are actually mounted THIS phase. Grow by one line per phase.
// Phase 1 → ["sales"]; Phase 2 → +"schedule"; Phase 3 → +"field"; Phase 4 → +"ar".
export const AVAILABLE_APPS = ["sales"];

export const GROUPS = [
  { app: "sales", label: "Sales Command", prefix: "/sales", home: "/sales/home", items: [
    { id: "home",      label: "Home",           path: "/sales/home",      icon: "⌂"  },
    { id: "calllog",   label: "Call Log",       path: "/sales/calllog",   icon: "📋" },
    { id: "proposals", label: "Proposals",      path: "/sales/proposals", icon: "📄" },
    { id: "leads",     label: "Campaign Leads", path: "/sales/leads",     icon: "🎯", flag: "leads_enabled" },
    { id: "invoices",  label: "Invoices",       path: "/sales/invoices",  icon: "💵" },
    { id: "managers",  label: "Managers",       path: "/sales/managers",  icon: "🏆", roles: ["Manager"] },
    { id: "customers", label: "Customers",      path: "/sales/customers", icon: "🏢" },
    { id: "team",      label: "Our Team",       path: "/sales/team",      icon: "👥" },
    { id: "archive",   label: "History Locker", path: "/sales/archive",   icon: "🗄" },
    { id: "directory", label: "The Directory",  icon: "📖", action: "directory" }, // overlay, not a route
  ]},
  { app: "schedule", label: "Schedule Command", prefix: "/schedule", home: "/schedule/home", items: [/* Phase 2, from §2 table */] },
  { app: "field",    label: "Field Command",    prefix: "/field",    home: "/field/today", items: [
    { id: "today",     label: "Today",      path: "/field/today",     icon: "📆" },
    { id: "jobs",      label: "Jobs",       path: "/field/jobs",      icon: "🧱" },
    { id: "crews",     label: "Crews",      path: "/field/crews",     icon: "👷" },
    { id: "timeclock", label: "Time Clock", path: "/field/timeclock", icon: "⏱" },
    { id: "dailylogs", label: "Daily Logs", path: "/field/dailylogs", icon: "📓" },
    { id: "loadouts",  label: "Load-Outs",  path: "/field/loadouts",  icon: "📦" }, // opens Schedule's LoadOutModal — same component (Beat 1b)
  ]},
  { app: "ar", label: "AR Command", prefix: "/ar", home: "/ar/home", items: [/* Phase 4, from §4 table */] },
];

// Top of the list (above the groups) and bottom (below):
export const SUBCON_HOME = { id: "subcon-home", label: "Home", path: "/", icon: "◈" };
export const SETTINGS     = { id: "settings",   label: "Settings", path: "/settings", icon: "⚙", roles: ["Admin", "Manager"] };
```

**Sidebar order (Beat 1):** `Home` (Subcon landing) → `Sales Command ▾` → `Schedule Command ▾` →
`Field Command ▾` → `AR Command ▾` → `Settings` (bottom). Groups keep the word "Command" (Beat 1
naming lock); umbrella wordmark is one word "SUBCON".

### 1b. Group visibility (the three-layer gate — Beat 4)

A group renders **iff all three**:
1. `AVAILABLE_APPS.includes(app)` — phase gate (Phase 1: only `sales`), and
2. `tenantConfig.apps?.includes(app)` — company owns it, and
3. `teamMember.apps?.includes(app)` — this person is assigned it.

Same predicate hides its **quadrant** on Subcon Home. Individual items keep today's per-item
`roles`/`flag` gating (`Managers` → Manager only; `Campaign Leads` → `leads_enabled`; `Settings` →
Admin/Manager). **This is the semantics flip:** `team_members.apps` moves from *gating login*
(Schedule's old `App.jsx:111`) to *showing/hiding groups*. Any authenticated member reaches the app;
what they see is scoped. (Note: Sales never gated login, so no existing Sales user loses access.)

### 1c. Route table — Phase 1

`/` becomes **Subcon Home** (new). Every Sales page moves under `/sales/*`. Public/token routes and
top-level Admin/import routes **do not move**.

| New route | Element | Notes |
|---|---|---|
| `/` | `<SubconHome/>` (**new**) | landing after login; renders one quadrant per visible app (Phase 1 = Sales only) |
| `/sales/home` | `<Home/>` | was `/home` |
| `/sales/calllog`, `/sales/calllog/:id` | `<CallLog/>` | was `/calllog(/:id)` |
| `/sales/leads` | `<Leads/>` | was `/leads` |
| `/sales/proposals`, `/sales/proposals/:id` | `<Proposals/>` | was `/proposals(/:id)` |
| `/sales/invoices`, `/sales/invoices/:id` | `<Invoices/>` | was `/invoices(/:id)` |
| `/sales/customers`, `/sales/customers/:id` | `<Customers/>` | was `/customers(/:id)` |
| `/sales/managers` | `<Managers/>` (Manager) | was `/managers` |
| `/sales/team` | `<Team/>` | was `/team` |
| `/sales/archive` | `<Archive/>` | was `/archive` |
| `/settings` | `<Settings/>` (Admin/Manager) | **stays global/top-level** — one Settings, grouped inside (§1f) |
| `/import` | `<Import/>` (Admin) | **stays top-level** — special-cased Admin tool, not in a group |
| `/schedule/*`, `/field/*`, `/ar/*` | route guard → "Not authorized" until their phase | structure present, screens absent in Phase 1 |
| `*` (any unknown, authed) | `<Navigate to="/" replace/>` | was `→ /home`; now → Subcon Home |

### 1d. Redirect table — old bookmarks/emailed links survive (Beat 2)

Old flat Sales URLs `Navigate replace` to their `/sales/*` home. **Path params and query strings must
be preserved** (a `LegacyRedirect` helper: `const {id}=useParams(); return <Navigate to={\`/sales/${base}${id?'/'+id:''}${search}\`} replace/>`).

| Old | → New |
|---|---|
| `/home` | `/sales/home` |
| `/calllog`, `/calllog/:id` | `/sales/calllog(/:id)` |
| `/leads` | `/sales/leads` |
| `/proposals`, `/proposals/:id` | `/sales/proposals(/:id)` |
| `/invoices`, `/invoices/:id` | `/sales/invoices(/:id)` |
| `/customers`, `/customers/:id` | `/sales/customers(/:id)` |
| `/managers` | `/sales/managers` |
| `/team` | `/sales/team` |
| `/archive` | `/sales/archive` |

**DO NOT MOVE / DO NOT REDIRECT (verbatim from Beat 2 — customer & auth surface):**
`/sign/:token` · `/invoice/:token` · `/invoice-paid` · `/qb/callback` · `/login` · `/checkout` ·
`/features/:slug` · `/suite` · `/terms` (sccmybiz static) · `/settings` · `/import`.
These stay exactly where they are so emailed customer links, payment returns, QB OAuth callback,
and the marketing/login surface keep working. `/settings` intentionally stays un-prefixed (global).

### 1e. `sectionFromPath` / PageBadge / TOC — the prefix gotcha ⚠️

`sectionFromPath` (`App.jsx:271`) returns the **first** URL segment for active-state, the page badge,
and TOC chapter mapping. Under `/sales/calllog` the first segment is now `"sales"` — this **breaks**
active highlighting, `getPageNumber`, and `TOCOverlay`'s `onNavigate` (which builds `/${chapterId}`).
Phase 1 must:
- Rewrite `sectionFromPath` to strip a known group prefix (`/sales|/schedule|/field|/ar`) and return
  the **second** segment (the item id), falling back to `"subcon-home"` for `/`.
- `TOCOverlay.onNavigate(chapterId)` → navigate to the item's full `path` (look it up in `GROUPS`),
  not `/${chapterId}`.
- Confirm `getPageNumber`/TableOfContents still resolves Sales section ids (they're unchanged ids).

### 1f. Settings, grouped by app (Beat 2 §2)

**One** Settings screen at `/settings`. Add a left-hand section list — **Company · Sales Command ·
Schedule Command · Field Command · AR Command** — clicking a label shows only that app's settings.
Same Admin/Manager role gate as today. **Phase 1 scope:** build the section frame + move today's
Sales/Company settings under **Company** and **Sales Command**; **Schedule / Field / AR** sections
render a "Available when <App> is enabled" placeholder (Field's real content = threshold editors in
Phase 3; Schedule/AR settings land with their moves). Only show a section if its app is in
`tenant_config.apps` (Company always shown).

### 1g. Route guard (Beat 4 — "hiding a group ≠ security")

A direct URL into a group the member is not entitled to (`tenant_config.apps` ∩ `team_members.apps`),
or into a not-yet-available group (`/schedule/*` in Phase 1), renders a **"Not authorized"** panel —
not a silent redirect, not merely a hidden menu item. Mirror the existing `/import` Admin gate pattern
(`App.jsx:229-233`). This is CLAUDE.md's "hiding in the UI is not guarding the save," applied to routes.

### 1h. Files touched — Phase 1

| File | Change |
|---|---|
| `src/lib/nav.js` | **new** — `GROUPS`, `AVAILABLE_APPS`, `SUBCON_HOME`, `SETTINGS`, `SUBCON_HEADER` |
| `src/App.jsx` | flat `NAV` → import `GROUPS`; add `/sales/*` routes + `LegacyRedirect`s; new `sectionFromPath`; mount `<SubconHome/>`; group route-guard; `/schedule|/field|/ar/*` → guard |
| `src/components/AppSidebar.jsx` | **new** (extract `AppShell`'s sidebar) — accordion groups, auto-expand from URL, one-open-at-a-time, visibility predicate (§1b) |
| `src/pages/SubconHome.jsx` | **new** — quadrant landing (§1j); Phase 1 renders Sales quadrant only |
| `src/components/Logo.jsx` | `AppWordmark` → "SUBCON COMMAND" (in-app sidebar only; login/marketing wordmark = Phase 5) |
| `src/pages/Settings.jsx` | section-list frame (§1f); Sales/Company real, others placeholder |
| `src/components/TableOfContents.jsx` | `onNavigate` → full item path (§1e) |
| `src/pages/Team.jsx` | **no change needed** — apps checkboxes already exist (`APP_LABELS` = the 4 apps); confirm copy reads "which groups show," not "login" |

### 1i. LAYOUT — Phase 1 (mockup is the target — [[feedback_ui_first_class]])

Build to the mockup (artboards: *Subcon Command Home* with Sales group expanded, and *Field Today*).
- **Sidebar** — keep today's dark rail (`C.dark`), widths **228 open / 56 collapsed**, existing collapse
  toggle + user footer. Header wordmark → **SUBCON** (white) **COMMAND** (`C.teal`), reuse `SalesCommandMark`.
- **Group header row** — uppercase Barlow Condensed label + chevron (`▾`/`▸`); active group expanded,
  teal left-border + `C.tealGlow` on the active *item* (reuse the existing item button style at
  `App.jsx:297-303`). One group open at a time; collapsed rail shows group icons only.
- **Subcon Home** — grid of app quadrant cards on `C.linen`; each card `C.linenCard`, a glanceable
  summary + a dark dollar/stat badge (`C.dark` bg / `C.teal` text, brand rule) + one-click into that
  app's own Home. Phase 1: **only the Sales quadrant renders** (only available app) — no fake
  "coming soon" tiles (the 4-up look in the mockup is the Phase-4 end state; note this to Chris).
- **Header breadcrumb** — `‹Active Group Label› › ‹Item Label›` (e.g. "Sales Command › Call Log");
  on `/` show "Subcon Command Home". Style unchanged from `App.jsx:329-334`.
- **Colors/typography** — unchanged tokens; **no white** anywhere; teal buttons get black text.

### 1j. Phase 1 does NOT

- Move any Schedule/Field/AR *screen* in (structure only; groups gated off).
- Touch page component internals, `queries`, calc, or any data/write path.
- Change the login screen, `/suite` marketing page, domains, or any hardcoded URL (all Phase 5).
- Author any migration (Phase 1 is frontend-only; threshold columns are Phase 3).

### 1k. Phase 1 verification / smoke (before it's called done)

1. Logged-in Sales user lands on `/` = Subcon Home (Sales quadrant), one-click into `/sales/home`.
2. Every old bookmark redirects: hit `/proposals/<real id>?x=1` → lands `/sales/proposals/<id>?x=1`,
   detail renders. Repeat for calllog/:id, invoices/:id, customers/:id (params + query preserved).
3. Active highlight + page badge + Directory/TOC all resolve correctly under `/sales/*`.
4. Public/token routes still open **logged out**: `/sign/<token>`, `/invoice/<token>`, `/invoice-paid`,
   `/suite`, `/login`, `/qb/callback` — none redirected, none behind auth.
5. Direct `/schedule/home` → "Not authorized" (not a crash, not a redirect to Sales).
6. A member with `apps` lacking `sales` (test row) → Sales group hidden AND `/sales/*` guarded.
7. Settings opens, sections switch, Admin/Manager gate intact, non-Admin can't reach it.
8. `/import` still Admin-gated at top level.
9. Preview deploy (Vercel, feature branch) — smoke there before merge ([[feedback_preview_deploys]]).

---

## 2. PHASE 2 — SCHEDULE MOVES IN

**Approach (Beats 3/5/6, locked):** `sch-command/src` lands in `sales-command` at **`src/schedule/`**
as-is, mounted under `/schedule/*`; one Vercel deploy, one login, no iframe/bridge. Same stack
version-for-version, so it compiles as-is.

- **File move:** `sch-command/src/*` → `sales-command/src/schedule/*`; add its route subtree to the
  `/schedule/*` guard slot from Phase 1; add `AVAILABLE_APPS += "schedule"`; fill `GROUPS[schedule].items`
  from the §2 route/menu table (below, from repo map).
- **Only edit inside Schedule's code:** delete `schedule/lib/supabase.js`, `schedule/lib/auth.js`,
  `schedule/lib/user.jsx`; repoint their imports to the host's `src/lib/supabase.js` / `auth.js` /
  `TenantConfigContext` (Beat 6). `queries.js` stays whole (Beat 6 §2).
- **CSS fencing (Beat 5):** Schedule's `App.css` (6,648 lines) comes as-is, **scoped to a
  `.schedule-root` wrapper** on the `/schedule` subtree so class names can't leak either way; its
  `:root` vars get VALUES from `tokens.js` at startup (one source); `--command-green`/`--neon` →
  `#30cfac` (teal wins, ~20 mechanical spots, black text on teal); Schedule status colors kept.
- **Realtime:** same client/DB → keeps working; **check channel-name collisions** once both subtrees
  share a page (see repo map's channel list) — namespace any bare names.
- **Turn Schedule's own deploy OFF** once `/schedule/*` verified (Beat 8 — Schedule has one user, Chris).
- **Post-move audit:** grep combined app for unpaginated fetches, sweep 3× incl. Promise.all
  ([[feedback_audit_pagination]]).

### 2a. Schedule route/menu table

Ground truth (repo map): Schedule = single `<Routes>` in `sch-command/src/App.jsx:387-402`, nav =
`NAV_ITEMS` (App.jsx:27-38). **No redirects needed** — Schedule has one user (Chris) and its deploy is
turned off (Beat 8), so old `schmybiz.com` URLs need no forwarding. New mounts only:

| Nav label (order) | Old sch path | → New | Component |
|---|---|---|---|
| Home | `/`, `/home` | `/schedule/home` | `views/Home.jsx` |
| Jobs | `/jobs`, `/jobs/:jobId` | `/schedule/jobs(/:jobId)` | `Jobs.jsx`, `JobDetail.jsx` |
| Crew Schedule | `/schedule` | `/schedule/schedule` | `Schedule.jsx` |
| Calendar | `/calendar` | `/schedule/calendar` | `Calendar.jsx` |
| Daily | `/daily` | `/schedule/daily` | `Daily.jsx` |
| Logistics | `/materials` | `/schedule/materials` | `Materials.jsx` |
| Billing | `/billing`, `/billing/forecast` | `/schedule/billing(/forecast)` | `Billing.jsx`, `Forecast.jsx` |
| Production Rate | `/production-rate` | `/schedule/production-rate` | `ProductionRate.jsx` |
| Schedules | `/schedules` | `/schedule/schedules` | `Schedules.jsx` |
| _(no nav)_ | `/budget` | `/schedule/budget` | `Budget.jsx` |
| Settings | `/settings` | → unified `/settings` (Schedule section) | `Settings.jsx` |

> Fill `GROUPS[schedule].items` from the label→path column above (drop Settings — it's the global item).
> Watch the label/path mismatches: "Crew Schedule"→`schedule`, "Logistics"→`materials`. Note the
> literal `/schedule/schedule` for Crew Schedule (harmless, but flag it in review).

**Phase 2 merge-collision pre-flight (read-only spillover look, 2026-09-01).** Both apps checked for
"assumes it owns the whole page." Verdict: they fit; the interference surfaces are few, known, fixable.
The items below are the Phase 2 safety gate — verify each is handled before the fence is called done:

- **URL/tab-ownership booby-traps (NEW — most important).** Schedule assumes it owns the browser tab:
  - `sch-command/src/views/Login.jsx:67` → `window.location.href = '/'` (kicks the user out of `/schedule`
    to the umbrella root). Once login is the host's, this dies with Schedule's deleted auth — but verify.
  - `sch-command/src/App.jsx:308` → `window.location.reload()` (reloads the WHOLE merged app). Re-scope
    or drop.
  - `sch-command/src/main.jsx:11` mounts its **own top-level `<BrowserRouter>`** — must be removed; the
    host owns the single router. Schedule's routes become plain `<Route>`s under the host's `/schedule/*`.
- **Cross-app jump links become internal.** `BillingCard.jsx:6` and `ForecastCard.jsx:10` hardcode
  `SALES_HOST = 'https://salescommand.app'` and `window.open(\`${SALES_HOST}/calllog/:id\`)`. After merge
  these are same-app links — repoint to `/sales/calllog/:id` (and they feed the Phase 5 URL sweep).
- **Shared login token — do NOT create a second client.** Both apps use supabase-js against the same
  project, so both would persist to the same `sb-pbgvgjjuhnpsumnowuym-auth-token` localStorage key. Beat 6
  already deletes Schedule's client/auth/context and repoints to the host's — this look confirms *why*:
  two default clients would fight over one login key. No second client, ever.
- **Host side is clean.** Sales opens **no realtime channels** and runs **no service worker / global
  background helper**, so the only host globals to respect are its `GLOBAL_CSS` reset + `body` background
  (which the fence keeps out of Schedule) and its `sc_*` / supabase storage keys (no overlap with
  Schedule's — Schedule writes none of its own).

**Phase 2 gotchas the repo map found:**
- **CSS fence is bigger than "wrap App.css."** Schedule's tokens + global element selectors live in
  `sch-command/src/index.css` (`:root`, plus `*`, `body`, `#root{min-height:100vh;display:flex…}`,
  scrollbar, input/autofill) — these **will leak** if merged raw. Fence = scope everything to a
  `.schedule-root` wrapper (root class today is `app-frame`), and there is a **second** override block
  `.home-screen` (re-declares `--bg`, `--bg-card`, `--teal`, adds `--sig-*`) that must ride along.
  Map `:root` var VALUES from `tokens.js`; teal wins `--command-green`/`--neon` (`#5BBD3F`→`#30cfac`).
- **Realtime channel collisions (confirmed).** Names are unprefixed generics: `jobs-changes`,
  `assignments-changes`, `job-material-lines-changes` (`views/Jobs.jsx:325-331`), `home-jobs`,
  `home-assignments`, `home-materials` (`views/Home.jsx:103-105`). Once both subtrees share one client
  on one page, **prefix all six `schedule-`** to avoid cross-talk.
- **Undefined CSS vars** referenced in Schedule inline styles (`--card`, `--text` in App.jsx) resolve to
  nothing today — leave as-is (not the merge's job), but don't "helpfully" define them.

---

## 3. PHASE 3 — FIELD WEB (net-new build)

Six web screens over tables the phones already sync (Beat 1b) — **no new tables**. VIEW-ONLY for the
office; Manager/Admin the only writers (mark corrections "entered by office"). Menu (locked):
**Today / Jobs / Crews / Time Clock / Daily Logs / Load-Outs**.

- **Today** = the at-a-glance list: one row per job going today — `Job · Crew · Hrs · SOD · MOD · EOD ·
  PRT · Load-out`. Late-form coloring **reuses the phone's rule** (`field-command/src/components/
  PunchStatusBar.js`) so desk + phone show the same "!". Source tables: `jobs`, `job_crew`,
  `time_punches`, `job_wtcs`, `daily_log_entries` (SOD/MOD/EOD), `daily_production_reports` (PRT),
  `job_material_checks` (load-out).
- **Load-Outs = a shortcut, not a twin** — opens the **same** `LoadOutModal` component (two doors, one
  room, [[feedback_extend_canonical_not_twin]]). **Requires Phase 2 first** (the component moves in with
  Schedule). Coupling the repo map found: `LoadOutModal({ job, onClose })` reads `job.call_log_id`,
  `job._wtcs` (work-type-configs w/ `field_sow` materials), `job.job_num`, `job.job_name`, via
  `loadMaterialChecksForJob(call_log_id)` from `queries.js`; today it's opened **only** from
  `StageJobCard.jsx`'s LOAD-OUT tile. So Field's shortcut must hand it a properly-shaped `job` (fetch the
  Schedule job + `_wtcs` the same way StageJobCard does) — the Field Today/Jobs row already has the
  `call_log_id`. Build task: extract that job-hydration so both doors call it (no drifting fetch).
- **Screen interiors** (Jobs drill-in / Crews / Time Clock layouts) — Chris designs in later UI
  sessions; this plan locks the data + Today list, not their pixels.

### 3a. `tenant_config` threshold migration (authored in `command-suite-db`)

Confirmed: columns **do not exist yet**; newest migration `20260831120000`. Author + **rehearse
before push** (`~/command-suite-db && ./scripts/rehearse.sh <file>` — shared-DB rule) as:

```sql
-- command-suite-db/supabase/migrations/<ts>_tenant_config_field_thresholds.sql
alter table public.tenant_config
  add column if not exists sod_due_minutes int     not null default 15,   -- phone's current hardcode
  add column if not exists mod_due_hours   numeric not null default 4,    -- phone's current hardcode
  add column if not exists eod_required    boolean not null default true,
  add column if not exists prt_required    boolean not null default true;
```

- Defaults = the phone's existing hardcoded values → **zero behavior change** until Settings is edited.
- **HDSP → `sod_due_minutes = 90`** (crews punch in at the shop; ~30 loading + ~30 driving). Set via
  the Field Settings editor (§1f/Phase 3), not baked into the migration.
- No anon grant (internal thresholds, never customer-facing). Authenticated read is enough for web.

### 3b. PowerSync sync-rule add (the one phone change — Beat 7) ⚠️ security note

Phones must READ the thresholds, but `tenant_config` is **not** in `powersync-sync-rules.yaml` today.
**Do not sync the whole `tenant_config` row to phones** — it carries `stripe_*`, subscription, and
billing-goal fields. Instead sync **only the threshold columns** (a dedicated `field_thresholds`
view, or a column-restricted sync rule). Missing setting → phone keeps hardcoded 15 min / 4 hr (never
a crash). = one sync-rule addition + one small phone release; Phases 1/2/4/5 need zero phone changes.

---

## 4. PHASE 4 — AR MOVES IN

Same move pattern as Phase 2, smaller. `AR-Command-Center/src` → `sales-command/src/ar/`, mounted
`/ar/*`; repoint to host client/login; `AVAILABLE_APPS += "ar"`; fill `GROUPS[ar].items`.

### 4a. AR route/menu table + a scope reality check ⚠️

Ground truth (repo map): **AR-Command-Center uses no react-router** — nav is `activeTab` state in
`pages/Dashboard.jsx`, swapped by a horizontal `Topbar.jsx` tab bar. There are **no internal URLs to
preserve**, so the move is low-risk routing-wise. Tab map (label ≠ id):

| Topbar label (order) | tab id | Component |
|---|---|---|
| Triage | `triage` (default) | `pages/TriageTab.jsx` |
| Dashboard | `aging` | `Scorecards.jsx` + `AgingTable.jsx` (inline in Dashboard) |
| Chase | `action` | `pages/ActionPlanTab.jsx` |
| Health Check | `health` | `pages/HealthCheckTab.jsx` |
| Cash Flow | `cff` | `pages/CFFTab.jsx` |
| Invoices | `invoices` | `pages/InvoicesTab.jsx` |

**Mount:** `/ar` → `<Dashboard/>` (single route). To make the sidebar group's items deep-link to tabs
(so `GROUPS[ar].items` behave like every other group), the minimal add is `/ar/:tab` reading the param
into `activeTab` (no full router rewrite). Recommend that over 6 stateful hacks.

**Scope reality check — Phase 4 is a COSMETIC mount, not a data integration.** AR today has **no auth,
no user/tenant context, and its Supabase client is dead code** — it runs on **localStorage** (`ar7-`
keys) fed by Excel/CSV upload; its own header says "will migrate to Supabase in Phase 2." So "AR moves
in" = mount the UI under `/ar/*`, reconcile tokens (green `#5BBD3F`→teal like Schedule), and gate the
group by `apps`. **Wiring AR to real Supabase AR data (invoices/aging) is a separate, larger effort**
(AR's own backend phase) and is explicitly OUT of this merge's scope unless Chris pulls it in. Flag at
Phase 4 planning; don't let "moves in" imply the data is live.

---

## 5. PHASE 5 — THE NAME + ADDRESSES

Last (Beat 8). Umbrella **stays at `scmybiz.com`** (no domain move). `subconcommand.com` +
`sccmybiz.com` forward to it; old `schmybiz.com` / `schedulecommand.com` / `salescommand.app` → umbrella.
- Login wordmark → Subcon Command; rewrite `/suite` (`SubConCommandPage.jsx`, still says "Sub Con Command").
- Sweep the ~25 hardcoded URL refs (edge fns + email links included): `salescommand.app` ×17,
  `schedulecommand.com` ×3, `schmybiz.com` ×2, `scmybiz.com` ×5, `sccmybiz.com` ×1.
- Customer token links (`/sign/:token`, `/invoice/:token`) **never move** → old emails keep working.

---

## 6. Access model (cross-phase, Beat 4)

Three layers, all in existing data, one login: **Company** (`tenant_config.apps`) → **Person**
(`team_members.apps`, the Team-page checkboxes that already exist) → **Role** (Admin/Manager/other =
what you can DO inside a group; unchanged). Guard rule (§1g) applies to every group's routes.

---

## 7. Audit manifest

> For `/runaudit`. Adversarial, read-only. Scope = **Phase 1** (the only near-term build). Sized ~3 agents.

**§0 Reproduction:** run the app on the feature branch, log in, exercise the routes below before auditing.

1. **Route guard is real, not cosmetic.** Direct-navigate `/schedule/home` and a Sales URL for a member
   whose `apps` lacks `sales` — must render "Not authorized," never the page, never a silent redirect.
2. **No dead bookmarks.** Every old flat URL in the §1d table redirects to `/sales/*`; **path params AND
   query strings preserved** through the redirect; detail pages render post-redirect.
3. **Public/token surface untouched.** `/sign/:token`, `/invoice/:token`, `/invoice-paid`, `/qb/callback`,
   `/suite`, `/login`, `/checkout`, `/features/:slug` are neither prefixed nor auth-gated nor redirected.
4. **Visibility = the 3-way intersection** (`AVAILABLE_APPS` ∩ `tenant_config.apps` ∩ `team_members.apps`),
   and it governs BOTH the sidebar group AND the Subcon Home quadrant. A missing layer hides both.
5. **`sectionFromPath` prefix fix** — active highlight, PageBadge, and TOC navigation all resolve under
   `/sales/*` (the second-segment bug, §1e); TOC `onNavigate` goes to full paths.
6. **Settings** — role gate (Admin/Manager) survives the regroup; non-entitled app sections don't leak
   real controls; `/settings` stays global (un-prefixed).
7. **Auth/boot stages** — logged-out, onboarding (`WelcomeScreen`), and TOKEN_REFRESHED/recovery paths
   still work with the new route tree; boot loader still gates correctly.
8. **Brand rules** — no white backgrounds introduced; teal buttons black text; no local `C` objects.
9. **`/import`** Admin gate intact at top level.

---

## 8. Build sequence for the next session

`/decide` → build (opus 4.8 / medium — build needs a verified plan; this is it once audited) →
Phase 1 only → `/buildvsplan` → `/code-review` → `/security-review` → Vercel preview smoke (§1k) →
merge. **Only then** Phase 2. Pre-Phase-2: confirm `sch-command` main is clean and nothing is trapped
on its branches (it moves wholesale).
