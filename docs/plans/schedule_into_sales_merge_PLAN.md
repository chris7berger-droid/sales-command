# Schedule → Sales Merge (Subcon Command) — BUILDABLE PLAN

**Status:** PLAN PASS — 2026-09-01. Turns the 8 locked ideate beats into a build spec.
**Input (do not re-litigate):** `docs/plans/schedule_into_sales_merge.md` — ideate complete, all 8
beats ratified. Beats are LOCKED; this plan may only *amend* via an appended block
([[feedback_schema_amendment_not_overwrite]]), never silently contradict them.
**Mode:** ideate ✅ → **plan (this doc)** → build. Build is gated on this plan being verified/audited.
**Model for this pass:** opus 4.8 / xhigh.
**Mockup (Phase 1 build target):** https://claude.ai/code/artifact/9349053f-3378-4089-8582-203fa46d554e

---

> ## ⚠️ AMENDMENT — 2026-09-01 (Chris): ROLLOUT = ONE FLIP AT THE END, not phase-by-phase
> This **amends §0a "How we ship"** (append-only, per [[feedback_schema_amendment_not_overwrite]]).
> The original plan shipped each phase to production as it finished (Beat 3 stand-alone framing).
> **Chris's call: do NOT expose the Subcon Command rebrand to live users incrementally.** Existing
> Sales Command users should not see "Subcon Command" appear, then Schedule show up, then Field, etc.
> — one transition, not a drip.
>
> **New rollout:** build every phase on the merge branch (`feat/schedule-merge-plan`), each still
> passing its own build→buildvsplan→code-review→security-review + preview smoke, but **HOLD THE MERGE
> TO MAIN.** Production stays on classic Sales Command until all phases are done, then flip live once.
> - **Phase 1 (Shell) is BUILT + all four gates GREEN + preview-smoke PASSED (2026-09-01) — but NOT
>   merged.** Do not merge it out of habit; it waits for the whole set.
> - **Branch-drift upkeep:** while Phases 2–5 build, any hotfix shipped to live Sales Command on `main`
>   must be pulled into this branch periodically so it doesn't rot. (Chosen over a feature-flag/off-switch
>   in-code fork — one real tenant (HDSP), stable app, so the side-track branch is lowest-effort.)
> - Everything else in the plan (phase contents, gates, per-phase quality bar) is unchanged.

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

### 0a. How we ship (plain English)

Two numbers that got conflated once, so pinning them here:
- **"8 beats" = the 8 decisions** locked during ideate (naming, who-sees-what, etc.). Done — choices, not builds.
- **"5 phases" = the 5 build steps** (the table above): Shell → Schedule in → Field web → AR in → Name.

**We build and ship one phase at a time — we do NOT wait until all 5 are done.** Each phase is designed
to stand alone and be useful the day it ships. Every phase runs the same finish line:

> build it → `/buildvsplan` (check against this plan) → `/code-review` → `/security-review` →
> preview-deploy smoke → **push + merge** → then start the next phase.

- **Phase 1 (Shell) ships by itself first** — it only rearranges Sales' own menu/routes, so it's the safe
  one and it goes live alone before Schedule ever comes in.
- **The "Step 2 safety sweep" (the merge-collision pre-flight, §2 "Phase 2 merge-collision pre-flight")
  runs at the START of Phase 2, before Schedule's code merges in** — that's the "protect the Sales shop
  from the newcomer" check. It is separate from, and in addition to, the per-phase `/security-review`.
- Nothing about Phases 2–5 needs deciding now; each gets its own short plan pass + audit + the finish
  line above when its turn comes.

---

## 1. PHASE 1 — THE SHELL  (first build target)

Rewrites the navigation model in `src/App.jsx` from a **flat 11-item `NAV` array + flat routes**
into **one grouped sidebar (Subcon Home + 4 Command groups + global Settings) + `/sales/*`-prefixed
routes with redirects from every old flat URL**. No data migration. Schedule/Field/AR groups exist in
the nav data but are gated OFF until their phase lands.

> **⚠️ ROUND 1 AUDIT REVISIONS APPLIED — 2026-09-01 (@8d3cff9).** A 3-agent audit found 5 caused-by
> defects (1 Critical / 2 High / 2 Med) that would break **every Sales user on day one** — all code, not
> data (prod is clean: 4/4 HDSP members have `sales`, `tenant_config.apps=["sales"]`). Fixes tagged
> **[R1-A]…[R1-E]**. **Design call ratified: Option B** — internal Sales links repoint to `/sales/*`
> directly; §1j amended. Verified: `auth.js:40` select omits `apps`; `config.js:3` DEFAULTS omits `apps`;
> 7 `navigate(..,{state})` sites target flat paths.
>
> **⚠️ ROUND 2 AUDIT REVISIONS APPLIED — 2026-09-01 (@f0a8bb7).** Round 2 = **convergence**: all R1 fixes
> held; **0 Critical / 0 High**; 6 caused-by (4 Med / 2 Low), theme "fail-open masks unthreaded inputs."
> Fixes tagged **[R2-1]…[R2-6]**. **Design call (applied, pending Chris's nod): R2-5 = the non-`state`
> `/sales/*` sweep is now MANDATORY** (the consistent finish to Option B — the redirect is for external
> links only; if you'd rather keep it optional to shrink Phase 1, say so and I'll dial it back). Verified:
> `CallLog.jsx:196`
> reads `navState.from === "/home"` (back-nav reader, R2-2); `Leads.jsx:71` → `/home` (R2-5). **Auditor's
> ruling: no Round 3 needed — build Phase 1 after this commit.**

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
  { app: "sales", label: "Sales Command", prefix: "/sales", home: "/sales/home", icon: "🧾", items: [
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
  { app: "schedule", label: "Schedule Command", prefix: "/schedule", home: "/schedule/home", icon: "🗓", items: [/* Phase 2, from §2 table */] },
  { app: "field",    label: "Field Command",    prefix: "/field",    home: "/field/today", icon: "👷", items: [
    { id: "today",     label: "Today",      path: "/field/today",     icon: "📆" },
    { id: "jobs",      label: "Jobs",       path: "/field/jobs",      icon: "🧱" },
    { id: "crews",     label: "Crews",      path: "/field/crews",     icon: "👷" },
    { id: "timeclock", label: "Time Clock", path: "/field/timeclock", icon: "⏱" },
    { id: "dailylogs", label: "Daily Logs", path: "/field/dailylogs", icon: "📓" },
    { id: "loadouts",  label: "Load-Outs",  path: "/field/loadouts",  icon: "📦" }, // opens Schedule's LoadOutModal — same component (Beat 1b)
  ]},
  { app: "ar", label: "AR Command", prefix: "/ar", home: "/ar/home", icon: "💰", items: [/* Phase 4, from §4 table */] },
];

// [R1-D] The single visibility predicate — used by BOTH the sidebar group AND the Subcon Home quadrant
// (one source, no drift). Fail-OPEN to Sales-only when apps are missing (Phase 1 has one real app), so a
// not-yet-loaded/empty apps array never blanks the screen ([R1-A] — the Critical). Item-level roles/flag
// gating is applied SEPARATELY, per item, after the group passes.
export function groupVisible(group, { tenantApps, memberApps }) {
  const tApps = (tenantApps?.length ? tenantApps : ["sales"]);
  const mApps = (memberApps?.length ? memberApps : ["sales"]);
  return AVAILABLE_APPS.includes(group.app) && tApps.includes(group.app) && mApps.includes(group.app);
}
export const itemVisible = (item, role, cfg) =>
  (!item.roles || item.roles.includes(role)) && (!item.flag || cfg[item.flag]);

// Top of the list (above the groups) and bottom (below):
export const SUBCON_HOME = { id: "subcon-home", label: "Home", path: "/", icon: "◈" };
export const SETTINGS     = { id: "settings",   label: "Settings", path: "/settings", icon: "⚙", roles: ["Admin", "Manager"] };
```

**Sidebar order (Beat 1):** `Home` (Subcon landing) → `Sales Command ▾` → `Schedule Command ▾` →
`Field Command ▾` → `AR Command ▾` → `Settings` (bottom). Groups keep the word "Command" (Beat 1
naming lock); umbrella wordmark is one word "SUBCON".

### 1b. Group visibility (the three-layer gate — Beat 4)

A group renders via `groupVisible()` (§1a) — **all three** of: `AVAILABLE_APPS` (phase gate; Phase 1
= only `sales`) ∩ `tenantConfig.apps` (company owns it) ∩ `teamMember.apps` (person assigned it).

**[R1-A] THE CRITICAL — the app doesn't load either input today, so a naïve gate fails CLOSED and
blanks every user's sidebar + Home. Two required fixes + a fail-open default:**
- `getCurrentTeamMember` (`auth.js:40`) selects `id, name, role, email, onboarded` — **add `apps`.**
  Without it `teamMember.apps` is `undefined`.
- `config.js` DEFAULTS (`:3`) has no `apps` key — **add `apps: ["sales"]` to DEFAULTS**, but note
  **[R2-6]** this only helps when the whole row is absent; a present row with `apps IS NULL` still
  clobbers it via `{...DEFAULTS, ...data}`. So DEFAULTS is a nicety, not the guarantee.
- **`groupVisible()` fail-OPEN to `["sales"]` is the actual safety net** — when either apps array is
  empty/missing/null (async-load window, legacy row, or a null column), the user is never shown a blank
  shell. Safe in Phase 1 because Sales is the only mounted app (nothing sensitive is exposed by
  defaulting to it). **Do not remove the fail-open on the assumption DEFAULTS covers it.**

**[R2 adjacent] Zero-visible-groups empty-state.** Fail-open turns *empty/missing* apps into Sales, but
a member with a **non-empty, non-Sales** array (e.g. `["schedule"]`) legitimately sees no groups in
Phase 1 (only Sales is mounted). Render a friendly empty-state on the sidebar + Subcon Home — "No apps
assigned yet — ask your admin" — never a blank shell. (Rare pre-onboarding; still handle it.)

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

Old flat Sales URLs `Navigate replace` to their `/sales/*` home. **[R1-B]** The redirect must carry the
FULL location — path params, **query string, hash, AND React-Router `state`** (the earlier one-liner
dropped `state` and referenced an undefined `search`, which would silently break in-app actions and
fail smoke §1k.2). Correct helper reads `useLocation()`:

```jsx
function LegacyRedirect({ base }) {              // base e.g. "calllog"
  const { id } = useParams();
  const { search, hash, state } = useLocation();
  return <Navigate replace state={state}
    to={`/sales/${base}${id ? "/" + id : ""}${search}${hash}`} />;
}
```

**[R1-B] Option B (ratified): the redirect layer is for EXTERNAL links only** (bookmarks, emailed
customer links). In-app buttons must NOT rely on it — they carry `state` that a redirect hop is fragile
around, and every future internal link would otherwise have to keep pointing at dead paths. So **repoint
the 7 verified internal `navigate(..,{state})` sites to `/sales/*` directly** (this is the §1j amendment):

| File:line | Button | Old target → New |
|---|---|---|
| `pages/Home.jsx:114` | dashboard stage-card (`stageFilter`,`sales`) | `/calllog` → `/sales/calllog` |
| `pages/Home.jsx:56` | follow-up card (`from`) | `/calllog/:id` → `/sales/calllog/:id` |
| `pages/CallLog.jsx:201` | New Proposal from job (`newJob`) | `/proposals` → `/sales/proposals` |
| `components/ProposalDetail.jsx:1094` | + Create Invoice (`newInvoiceProposalId`) | `/invoices` → `/sales/invoices` |
| `pages/Invoices.jsx:3427` | open-send (`openSendForInvoiceId`) | `/invoices/:id` → `/sales/invoices/:id` |
| `components/followup/SalesIntelligence.jsx:62,101` | intel cards (`from`) | `/calllog/:id` → `/sales/calllog/:id` |
| **[R2-2]** `pages/CallLog.jsx:196-197` | Back/onSaved **reader** of `state.from` | `navState.from === "/home" ? "/home" : "/calllog"` → `=== "/sales/home" ? "/sales/home" : "/sales/calllog"` |

**[R2-2] Change the reader in lockstep with the writer.** `CallLog.jsx:196-197` tests
`navState.from === "/home"`; once `Home.jsx:56` writes `from:"/sales/home"`, that `===` flips false and
Back lands on the Call Log *list* instead of Home — on a **daily follow-up flow**. Update both the test
and its targets (and the sibling `navigate("/calllog")`/`"/proposals"`/etc. calls in that block —
covered by the mandatory sweep, R2-5). Also update the `state.from` writer values (`"/calllog"`,
`"/home"`) to `/sales/*` so the Back affordance lands correctly.

**[R2-5] The ~30 non-`state` internal `navigate("/…")` calls are a MANDATORY sweep, not cleanliness.**
They function via the redirect double-hop, but leaving them makes the redirect layer permanently
load-bearing for normal in-app clicks — which contradicts Option B's rationale (the redirect is for
*external* links only). Sweep every internal flat navigation to `/sales/*` in Phase 1 across
Customers / Proposals / Invoices / CallLog / Archive / Leads / AlertsBanner / follow-up (grep the nine
flat literals: `navigate("/calllog` `/proposals` `/invoices` `/customers` `/leads` `/managers` `/team`
`/archive` `/home`). **Includes `Leads.jsx:71`'s `<Navigate to="/home">`** (a triple-hop today). After
the sweep, the only code pointing at flat paths is the `LegacyRedirect` table itself.

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
- Rewrite `sectionFromPath` precisely (**[R2-3]**): `/` → `"subcon-home"`; **if the path starts with a
  `GROUPS[].prefix` → the 2nd segment** (the item id); **else → the 1st segment**. The else-branch is
  required so un-prefixed top-level routes still resolve — `/settings` and `/import` have only one
  segment, and a naïve "always take the 2nd segment" returns `undefined` → blank breadcrumb (`:333`),
  null PageBadge, no active highlight for **every admin visiting Settings**.
- `TOCOverlay.onNavigate(chapterId)` → navigate to the item's full `path`, not `/${chapterId}`.
- Confirm `getPageNumber`/TableOfContents still resolves Sales section ids (they're unchanged ids).

**[R1-E] Consumers of the old flat `NAV` that also break — add to the fix list (not just `sectionFromPath`):**
- **Header breadcrumb** (`App.jsx:333`) does `NAV.find(n => n.id === active)?.label` — goes blank once
  `NAV` is deleted. Replace with a lookup over `GROUPS`/`SETTINGS`/`SUBCON_HOME`, and add a
  `groupFromPath(pathname)` (match against each `GROUPS[].prefix`) to render `‹Group Label› › ‹Item›`.
- **TOC / Directory lookups must consult `SETTINGS` and `SUBCON_HOME`, not only `GROUPS[].items`** —
  Settings lives in the top-level `SETTINGS` const and Home in `SUBCON_HOME`; a GROUPS-only lookup
  resolves them to `navigate("/undefined")` (`TableOfContents.jsx:512`). Build one resolver that unions
  all three sources.

### 1f. Settings, grouped by app (Beat 2 §2)

**One** Settings screen at `/settings`. Add a left-hand section list — **Company · Sales Command ·
Schedule Command · Field Command · AR Command** — clicking a label shows only that app's settings.
Same Admin/Manager role gate as today. **Phase 1 scope:** build the section frame + move today's
Sales/Company settings under **Company** and **Sales Command**; **Schedule / Field / AR** sections
render a "Available when <App> is enabled" placeholder (Field's real content = threshold editors in
Phase 3; Schedule/AR settings land with their moves). Only show a section if its app is in
`tenant_config.apps` (Company always shown). **[R2-4] Run this check through the same empty-array
fail-open** as `groupVisible` (treat null/`[]` `apps` as `["sales"]`) — a raw `cfg.apps.includes(...)`
throws on a null column (Settings crash) or vanishes the Sales section; HDSP is non-null so no live bite,
but keep the fail-open universal.

**[R1-C] `/settings` has NO route-level role gate today** (`App.jsx:258` renders `<Settings/>` for any
authed user — a pre-existing leak: burden rates, billing goals, financials readable by URL). Phase 1's
guard **closes it**: add the `/import`-style role gate (Admin/Manager) on the `/settings` route, and
render the "Not authorized" panel **inside the shell** so the user keeps nav to get back (not a bare
full-page dead-end). **Inner gates must ride along the regroup** — do not lose them: Billing section =
Admin only (`Settings.jsx:812`); catalog edits = `canManage` (`Settings.jsx:783,789`). Enumerate and
re-assert each after moving content under the new section list.

**[R1-D] Keep it one save, sections are a VIEW filter.** Settings today is a single form with one Save
over all of `tenant_config` and does **not** read `apps`. The section list picks *which fields show*, not
separate per-section saves — do not fragment the save (or, if per-section saves are wanted, spec them
explicitly; default = keep the single save). Keep the existing `<Section>` accordions **additive** under
Company / Sales Command ([[feedback_preserve_mental_models]]) — regroup, don't rebuild the form.

### 1g. Route guard (Beat 4 — "hiding a group ≠ security")

A direct URL into a group the member is not entitled to (`tenant_config.apps` ∩ `team_members.apps`),
or into a not-yet-available group (`/schedule/*` in Phase 1), renders a **"Not authorized"** panel —
not a silent redirect, not merely a hidden menu item. Mirror the existing `/import` Admin gate pattern
(`App.jsx:229-233`), but **render the panel INSIDE the shell** (sidebar + header present) so the user
keeps a way back — not the bare full-page version `/import` uses.

**[R1-A] The guard MUST use the same `groupVisible()` fail-open predicate (§1a)** — a naïve guard that
reads raw `teamMember.apps`/`tenant_config.apps` fails closed during the async load and would block
`/sales/*` for entitled users (same Critical as the sidebar). Entitlement check = `groupVisible(group,…)`
for the URL's group; not-yet-available groups (`/schedule/*` in Phase 1) fail because `AVAILABLE_APPS`
excludes them, which is correct.

### 1h. Files touched — Phase 1

| File | Change |
|---|---|
| `src/lib/nav.js` | **new** — `GROUPS` (w/ group `icon`), `AVAILABLE_APPS`, `SUBCON_HOME`, `SETTINGS`, `SUBCON_HEADER`, `groupVisible()`, `itemVisible()` |
| `src/lib/auth.js` | **[R1-A]** add `apps` to `getCurrentTeamMember` `.select()` (`:40`) — else the whole gate has no input |
| `src/lib/config.js` | **[R1-A]** add `apps: ["sales"]` to `DEFAULTS` (`:3`) — helps only when the whole row is absent. **[R2-6] It does NOT cover a present row with `apps IS NULL`**: `{...DEFAULTS,...data}` lets `data.apps=null` clobber the default (same `schedule_runway_*` trap, `config.js:14-17`). **The real safety net is `groupVisible`/§1f fail-open, not DEFAULTS** — do not drop the fail-open thinking this row covers it |
| `src/App.jsx` | flat `NAV` → import `GROUPS`; `/sales/*` routes + `state`-aware `LegacyRedirect`s; new `sectionFromPath` (**[R2-3]** prefix-aware, see §1e) + **`groupFromPath`**; **breadcrumb rewrite (`:333`)**; mount `<SubconHome/>`; group route-guard (uses `groupVisible`, renders inside shell); `/settings` role guard **[R1-C]**; `/schedule|/field|/ar/*` → guard. **[R2-1] `AppShell` currently receives only `displayName/Role/Initials` (`:234-242`) — also pass `teamMember` + `cfg` down to `AppSidebar` AND the route-guard inputs** |
| `src/components/AppSidebar.jsx` | **new** (extract `AppShell`'s sidebar) — accordion groups w/ group icons + collapsed rail, auto-expand from URL, one-open-at-a-time, `groupVisible`+`itemVisible` filter; **carry the `action:"directory"` overlay branch + the drilled props** `onOpenDirectory / open / setOpen / signOut / displayName / displayRole / displayInitials`. **[R2-1] MUST also receive `teamMember` (for `.apps`) + `cfg`** — `groupVisible` needs `memberApps`; without it the member layer silently no-ops (fail-open shows Sales always) and smoke §1k.6 fails |
| `src/pages/SubconHome.jsx` | **new** — quadrant landing (§1j); one quadrant per `groupVisible` app; Phase 1 renders Sales quadrant only |
| `src/components/Logo.jsx` | `AppWordmark` → "SUBCON COMMAND" (in-app sidebar only; login/marketing = Phase 5). **[J4]** decide keep/drop the "Command Suite" subline (`:38`) + the embedded "SC" in `SalesCommandMark` (`:12`) |
| `src/pages/Settings.jsx` | section-list frame (§1f); Sales/Company real, others placeholder; **[R1-C]** re-assert inner gates (Billing=Admin `:812`, catalogs=`canManage` `:783,789`); keep single save |
| `src/components/TableOfContents.jsx` | **[R1-E]** `onNavigate` → full item path via a resolver that unions `GROUPS`+`SETTINGS`+`SUBCON_HOME` (`:512`) |
| ~7 Sales call sites | **[R1-B]** repoint `navigate(..,{state})` to `/sales/*` (table in §1d) — the Option B amendment |
| `src/pages/Team.jsx` | **no change needed** — apps checkboxes already exist (`APP_LABELS` = the 4 apps). **[J3]** note the `tenantApps.length > 1` gate (`:141`) hides the per-member picker while Sales-only — fine; document it |

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
- Touch page component **logic**, `queries`, calc, or any data/write path.
- Change the login screen, `/suite` marketing page, domains, or any hardcoded external URL (all Phase 5).
- Author any migration (Phase 1 is frontend-only; threshold columns are Phase 3).

> **[R1-B] AMENDMENT (Option B ratified 2026-09-01) — the one carve-out to "don't touch Sales screens":**
> Phase 1 **does** edit the navigation *target strings* in ~7 Sales call sites (§1d table) — repointing
> `navigate(..,{state})` from flat paths to `/sales/*`. This is a link-target change only: no component
> logic, no data path, no render change. It's required because the alternative (Option A — a redirect
> that carries `state` for every in-app click forever) makes the redirect layer permanently load-bearing
> for normal navigation. Everything else in this list still holds.

### 1k. Phase 1 verification / smoke (before it's called done)

1. **[R1-A] A normal rep (role "Sales Rep") logs in and the sidebar Sales group AND the Home Sales
   quadrant actually RENDER** — assert the elements are present, not merely that routes resolve (the
   Critical was an *empty* shell). One-click `/` → `/sales/home`.
2. Every old bookmark redirects with **query preserved**: `/proposals/<real id>?x=1` → lands
   `/sales/proposals/<id>?x=1`, detail renders. Repeat calllog/:id, invoices/:id, customers/:id.
3. **[R1-B] In-app actions still fire (not just load):** click a dashboard stage-card → CallLog opens
   *filtered*; "New Proposal from job" → proposal modal *pops with the job*; "+ Create Invoice" → invoice
   *pre-seeded*. (These are the `state`-carrying flows the redirect used to swallow.)
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

### 2b. ▶ PHASE 2 BUILD STATUS — 2026-09-02 (append-only)

**Safety sweep (§2 pre-flight): GREEN.** All 7 collision points re-verified against live code on both
repos — every line number still matched the 2026-09-01 map; nothing drifted. Host side confirmed clean
(no realtime channels, no service worker, single `BrowserRouter`).

**Core move: BUILT on `feat/schedule-merge-plan` — compiles clean, browser-smoked, NOT merged (rollout HOLD).**
- `sch-command/src/{views,components,lib,assets}` + `App.css`/`index.css` → `src/schedule/*`. Dropped
  `main.jsx`, `App.jsx`, `views/Login.jsx`, `lib/supabase.js`, `lib/auth.js` (host owns entry/login/client).
- **`lib/user.jsx` KEPT (plan divergence, deliberate):** it is a pure `teamMember` React context with zero
  supabase/auth coupling — repointing it to `TenantConfigContext` (as Beat 6 listed) would be a category
  error (that context carries tenant config, not the team member). Instead it is fed the **host's**
  `teamMember` (`{id,name,role,email,onboarded,apps}`), which supplies every field its 7 consumers read
  (`.name`, `.role`, `.apps`). Single-client safety goal fully met — no second `createClient` anywhere.
- **Shell reconciliation (was open in §2; Chris ratified 2026-09-02):** Schedule's App-level chrome
  (+Job / Actions menu / StatsBar / 6 modals) moved into a new content-level **`src/schedule/ScheduleLayout.jsx`**
  that renders inside the host content area under the host sidebar. Schedule's own sidebar dropped; host
  nav drives navigation. Providers (`SyncProvider`/`ToastProvider`/`UserProvider`) wrap the subtree there.
- **7 collision fixes applied:** login redirect + own `BrowserRouter` gone with the dropped files;
  `App.jsx:308` full-reload → soft `loadModalData()` refresh; `BillingCard`/`ForecastCard` `SALES_HOST`
  links → internal `/sales/calllog/:id`; 6 realtime channels prefixed `schedule-`; all internal
  `navigate()`/`TAB_REDIRECTS` rebased to `/schedule/*`; supabase imports repointed to host client.
- **CSS fence:** `index.css` + `App.css` (6.6k lines) scoped under `.schedule-root` via a postcss transform
  (`:root`/`body`/`#root`/`*` mapped to the wrapper; `@keyframes` internals left intact; `@media` children
  scoped). Browser-verified: no leak either direction (Sales pages unchanged, Schedule theme intact).
- **Host wiring:** `nav.js` `AVAILABLE_APPS += "schedule"` + `GROUPS[schedule].items` filled from §2a;
  `App.jsx` mounts `<Route path="/schedule/*"><GroupGuard app="schedule"><ScheduleLayout/></GroupGuard>`.
- **Entitlement gate working as designed:** `tenant_config.apps` for HDSP = `["sales"]`, so `groupVisible`
  correctly blocks Schedule (NOT AUTHORIZED) until the go-live flip to `["sales","schedule"]` — that flip
  is the HELD action, not done here. Smoke used a temporary local `groupVisible` bypass (reverted, verified clean).

**Deferred (Phase 2 finish-line remainder — next session):**
1. **Teal reconciliation (Beat 5 polish).** Schedule still renders its Command-Green (`--command-green`/`--neon`
   `#5BBD3F`); the ~20 mechanical green→teal spots + black-text-on-teal are a POLISH pass to do with the
   preview running ([[feedback_design_then_polish]]) — not blind-sed'd here (would create white-on-teal violations).
2. **Settings fold.** `/schedule/settings` is reachable by URL but intentionally NOT in the host nav; folding
   Schedule's `Settings.jsx` (109 lines) into the unified `/settings` (Schedule section, §2a) is its own task.
3. **Post-move pagination sweep** (grep unpaginated fetches 3× incl. `Promise.all`, [[feedback_audit_pagination]]).
4. **Preview smoke → PASS (2026-09-02).** Vercel preview off `feat/schedule-merge-plan`; Schedule lit via a
   TEMPORARY `tenant_config.apps=["sales","schedule"]` flip (reverted after). Chris walked the checklist
   (all 9 nav screens load + styled, breadcrumb/active-state, +Job/Actions toolbar, Refresh + toast,
   Billing→Sales cross-link, Sales untouched) — all items pass. Only the deferred polish remains, then the
   HELD one-flip merge. (Post-smoke simplify: the legacy sync dot + its setSync/SyncProvider/sync.jsx
   plumbing were removed — toasts already cover those events — commit `156dcd1`.)

**Gates run (2026-09-02):**
- **/buildvsplan → PASS** (3 reviewers + live probe). 1 fix applied: `Schedule.jsx:108` TDZ self-reference
  (`changedBy = user?.name || changedBy`) → `|| 'unknown'` (commit `6b22c9d`).
- **/code-review → 3 CAUSED-BY findings, all fixed** (commit `02e10ba`): (1) toasts rendered outside the
  fence — moved `.schedule-root` up to wrap the providers; (2) Refresh no-op'd the 9 non-realtime views —
  now bumps a `key` on `<main>` to remount + refetch the current view (no full-app reload); (3) orphaned
  `syncState` — sync dot restored in the content toolbar.
- **/security-review (limiter-gated) → 0 exploitable-today.** One authenticated client confirmed (zero
  `createClient` in `src/schedule/`, all 12 supabase imports resolve to host); entitlement gate is
  defense-in-depth over unchanged RLS; repoints same-origin + `noopener`; no migration, no new grant,
  no service-role, no token/secret in logs. Multi-tenant isolation stays F7-gated (S4/S5/S10/S13), not re-flagged.

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

### 3c. ▶ PHASE 3 BUILD PLAN — locked 2026-09-02 (append-only, newest truth)

**Scope decided (Chris ratified 2026-09-02):** the 6 web screens **+** the threshold settings.
**Phone update (§3b) is OUT of this phase** — no users on Field Command yet, phones stay safe on
their hardcoded 15min/4hr, so a mobile release buys nothing now. Do §3b only when a crew goes live.
Rationale is moot-by-no-users, not risk: nothing here is load-bearing for anyone today.

**Build order (my call — screens first, DB second, since screens don't depend on the columns):**

1. **Scaffold + flip on.** New `src/field/FieldLayout.jsx` (mirrors `ScheduleLayout` but far simpler —
   view-only, no toolbar-actions/modals). Owns nested `<Routes>` for the 6 screens. `App.jsx`: add one
   `<Route path="/field/*" …><FieldLayout/>` line beside the schedule splat. `nav.js`:
   `AVAILABLE_APPS += "field"` (group + items already defined). Screens authored fresh in HOST design
   tokens (`src/lib/tokens.js`) — **no CSS-fence needed** (unlike Schedule; nothing foreign imported).
2. **Screens.** `Today` built for real per §3 (row-per-job: `Job · Crew · Hrs · SOD · MOD · EOD · PRT ·
   Load-out`; late "!" reuses the phone's rule from `field-command/src/components/PunchStatusBar.js` —
   port the logic to a shared `src/field/lib/lateForm.js`, don't re-derive). Other 5 (`Jobs/Crews/
   TimeClock/DailyLogs/LoadOuts`) = real routes + real reads over the existing tables, PLAIN layout —
   interiors are Chris's later UI sessions. `LoadOuts` opens the SAME `src/schedule/components/
   LoadOutModal.jsx` — extract its job-hydration (currently inline in `StageJobCard.jsx`) into a shared
   `hydrateLoadOutJob(call_log_id)` so both doors call it ([[feedback_extend_canonical_not_twin]]).
   All reads paginated (`fetchAll`, [[feedback_audit_pagination]]); tenant-scoped by RLS.
3. **Thresholds (§3a).** Author the 4-col migration in `command-suite-db`, **rehearse before push**
   (`./scripts/rehearse.sh`). Then a small Field Settings editor (4 numbers) + point Today's late rule
   at `tenant_config` cols with the phone's hardcodes as fallback. HDSP sod=90 set via editor, not baked.
4. **Gates on THIS branch:** buildvsplan → code-review → security-review → preview smoke. HOLD (no merge).

Screen interiors (Jobs drill-in / Crews / Time Clock pixels) are explicitly NOT in this build.

**BUILD STATUS — 2026-09-02 (append-only):** Steps 1+2 BUILT on feat/schedule-merge-plan.
Field mounted at `/field/*` (AVAILABLE_APPS += field), 6 screens live. Today built for real
(per-job SOD/MOD/EOD/PRT + load-out, late "!" ported from PunchStatusBar into
`src/field/lib/lateForm.js`). The 4 "later UI" screens (Jobs/Crews/TimeClock/DailyLogs)
do REAL reads (plain tables) — interiors still deferred. Load-Outs reuses Schedule's
`LoadOutModal` via the CANONICAL `loadJobWithWTCs(job_id)` — the plan's proposed new
`hydrateLoadOutJob(call_log_id)` was NOT needed (that hydrator already exists and is shared
with StageJobCard via `normalizeJob`; intent met, no twin). Data model VERIFIED against prod:
every child table (time_punches/job_crew/daily_log_entries/daily_production_reports/
job_material_checks) anchors `job_id` on **call_log.id** (FK-confirmed), `jobs` links via
`jobs.call_log_id`; `jobs` PK is `job_id` (no `id` column). /buildvsplan run (2 reviewers):
0 Tier-1, 2 Tier-2 (EOD/PRT multi-crew over-flag; Load-Outs null-end drop) — BOTH FIXED
(`0896aa2`), plus active-stage + soft-delete(`deleted='Yes'`) hardening.
Step 3 (§3a migration + Today reads the cols) DONE: threshold migration `20260902120000`
rehearsed + pushed to prod (command-suite-db `ae461f0`; baseline reconciled — the block was the
INTENDED Aug-31 `sent_at` grant, see [[project_sent_at_grant_incident]]); HDSP sod_due_minutes=90
set as data; Today reads the cols via fetchFieldThresholds() with the phone hardcodes as fallback
(verified HDSP=90 drives the SOD flag). Settings EDITOR deferred to the unified Settings session.

**ALL GATES GREEN + SMOKE PASSED — 2026-09-02.** T4 /buildvsplan (2 bugs fixed), T5 /code-review
(0 blockers, file F56), T6 /security-review (0 exploitable-today, file S14) — each in its own cold
terminal. Preview smoke PASSED (lit via a TEMPORARY tenant+member `apps` flip to include "field",
REVERTED after — HDSP baseline back to `["sales"]`). Phase 3 built + HELD (not merged); joins the
one-flip stack with Phases 1–2. §3b PowerSync phone release still deferred until a crew goes live.

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

### 4b. ▶ PHASE 4 BUILD PLAN — locked 2026-09-02 (append-only, newest truth)

> Same move pattern as Phase 2/3, **smaller** and lower-risk. This section is the buildable
> spec; §4/§4a above are the prior sketch. Ideate was NOT re-run — the whole merge was
> ideated (Beats 1–8 closed) and Phase 4 is the mechanical application of that pattern, so
> the plan is obvious ([[feedback_ideate_before_plan]] — "skip only when the plan is already
> obvious"). Build this on THIS branch, then hand each gate to its own cold terminal. DO NOT MERGE.

**Ground-truth pre-flight (verified against live AR + host code, 2026-09-02):**
- **AR uses NO react-router** — nav is `activeTab` state in `pages/Dashboard.jsx`, swapped by
  `components/Topbar.jsx`. There are **no internal URLs to preserve** → routing-wise the lowest-risk phase.
- **AR has no auth, no user/tenant context.** `src/lib/supabase.js` is **DEAD CODE — 0 importers
  (grep-verified)**. AR runs entirely on **localStorage `ar7-*` keys** fed by Excel/CSV upload
  (`ARContext` → `arStore.js`). Its own header says "will migrate to Supabase in Phase 2."
- **Zero new dependencies.** Everything AR imports — `react`, `react-dom`, `xlsx` — is already in host
  `package.json`. Host `xlsx` (sheetjs `0.20.3`) supersedes AR's npm `0.18.5`; AR uses only `XLSX.read`
  + `sheet_to_json`, present in both. `@supabase/supabase-js` is referenced **only** by the dead client
  being deleted. Nothing to add.
- **Near-zero CSS fence** (unlike Schedule's 6.6k-line `App.css`). AR is almost entirely **inline-styled**;
  its only global CSS is `lib/tokens.js` `GLOBAL_CSS`. The host reset covers most of it (`*`/fonts/scrollbar/
  autofill/`body` bg) so AR's `GLOBAL_CSS` injection is **dropped** — with **ONE exception the Round-1 audit
  caught**: the host has **no `body::before`**, so AR's crosshatch linen texture would vanish (every AR
  screen renders flat, violating [[feedback_linen_texture]]). → keep a **minimal scoped rule on a
  `.ar-root` wrapper** for the crosshatch only (Finding B, §4b amendment). Bare-heading font rule NOT
  needed — grep-confirmed AR has zero bare `<h1>–<h4>` (its only `<h2>` carries inline `F.display`;
  Finding E = no-op).

**⚠️ Scope reality check — Phase 4 is a COSMETIC MOUNT, not a data integration.** "AR moves in" =
mount the UI under `/ar/*`, green→teal the accent, gate the group by `apps`. AR data stays
per-browser localStorage + Excel upload. **Wiring AR to live Supabase AR/invoices/aging data is a
separate, larger effort (AR's own backend phase) and is OUT of this merge's scope** unless Chris
pulls it in. Do not let "moves in" imply the data is live. (Once mounted, AR is at least reachable
only behind the host login + `ar` entitlement — but its data is still client-local, un-tenanted.)

**The move:**
1. `AR-Command-Center/src/{components,lib,pages,assets}` → `sales-command/src/ar/*`. **DROP**
   `main.jsx`, `App.jsx`, `lib/supabase.js` (host owns entry + client; the AR client is dead).
2. **New `src/ar/ARLayout.jsx`** (mirror `FieldLayout`/`ScheduleLayout`) — replaces AR's dropped `App.jsx`:
   - wraps `<ARProvider>` (its localStorage-backed context, kept whole) inside a `<div className="ar-root">`;
   - does **NOT** inject the full `GLOBAL_CSS`, BUT **does** attach a minimal scoped `<style>` for the
     crosshatch: `.ar-root::before { <AR's body::before gradient stack, ported verbatim>; position:absolute;
     inset:0; z-index:0; pointer-events:none }` + `.ar-root { position:relative }` (Finding B — Option 1,
     subtree-scoped; **DO NOT edit host `GLOBAL_CSS`**). AR content already sits at `z-index:1` above it
     (`Dashboard.jsx:49`, `Upload.jsx:51`), so it layers correctly.
   - owns a nested `<Routes>` — **hardened defaults (Finding A):**
     `<Route index element={<Navigate to="triage" replace/>}/>` +
     `<Route path=":tab" element={<Dashboard/>}/>` +
     `<Route path="*" element={<Navigate to="triage" replace/>}/>` (mirror `FieldLayout.jsx:18,25`). This
     guarantees bare `/ar` and any stray `/ar/<junk>` land on Triage instead of a blank grey page.
   - keeps AR's Upload gate ABOVE the `<Routes>`: `loadAll()` on mount → `if (!loaded) return null;
     if (!customers.length) return <Upload/>; return <Routes>…`. (Empty localStorage at `/ar/health`
     still shows Upload — the gate precedes routing.)
   - receives host `teamMember` prop for signature uniformity (AR reads none of it today — passed-but-unused, fine).
3. **`pages/Dashboard.jsx`** — **Finding A:** derive tab defensively — `const { tab } = useParams();
   const activeTab = tab ?? "triage";` (`useParams` can be undefined; the old `useState("triage")`
   guaranteed a value — the `??` restores that guarantee so the Export button + Topbar label never no-op).
   Make the Topbar tab clicks AND the `DirectoryOverlay` `onNavigate` call `navigate('/ar/'+id)` instead of
   `setActiveTab`. **Finding C:** the Directory passes chapter ids (`Directory.jsx:258` → `ch.id`), which
   include non-tab values like `"upload"` — guard before navigating: `navigate('/ar/' + (TAB_IDS.includes(id)
   ? id : 'triage'))` (TAB_IDS = the 6 tab ids), so a chapter click never lands on `/ar/upload` (blank +
   unhighlightable sidebar). This puts AR's own tab bar and the host sidebar's `GROUPS[ar].items` on **one
   URL source**, so both highlight in sync (the §4a minimal `/ar/:tab` add, no router rewrite).
4. **Host `src/App.jsx`** — add, mirroring the `/field/*` line:
   `<Route path="/ar/*" element={<GroupGuard app="ar" teamMember={teamMember}><ARLayout teamMember={teamMember}/></GroupGuard>} />`
5. **Host `src/lib/nav.js`** — `AVAILABLE_APPS += "ar"`; fill `GROUPS[ar].items` from the table below;
   **(Finding A — do NOT skip, this is the one-liner that stops a blank page):** in the SAME edit, change
   the group `home` from the placeholder `/ar/home` → **`/ar/triage`**. `/ar/home` has no route/tab; leaving
   it makes the "AR Command" sidebar header click land on a dead grey page. (The ARLayout index redirect in
   step 2 is the backstop, but `home` must still point at a real tab so the header link is correct.)

**`GROUPS[ar].items`** (from §4a; note label ≠ id — "Dashboard"=`aging`, "Chase"=`action`):

| id | label | path |
|---|---|---|
| `triage` | Triage | `/ar/triage` |
| `aging` | Dashboard | `/ar/aging` |
| `action` | Chase | `/ar/action` |
| `health` | Health Check | `/ar/health` |
| `cff` | Cash Flow | `/ar/cff` |
| `invoices` | Invoices | `/ar/invoices` |

**Token reconciliation (Beat 5 green→teal) — DO in build (small + safe here, unlike Schedule's deferred sweep):**
- `src/ar/lib/tokens.js` — **Finding D: exact hexes pinned (no "→ equivalents" guessing → no drift):**
  - `pop`     `#5BBD3F` → **`#30cfac`**
  - `popDim`  `rgba(91,189,63,0.15)` → **`rgba(48,207,172,0.12)`**
  - `popDark` `#3D8A2A` → **`#1a8a72`**
  - `popDeep` `#2D6B1E` → **`#0d5c4d`**
  - `green`   `#43a047` → **leave as-is** (grep-confirmed 0 consumers; recoloring it is dead churn).
- AR uses `C.pop` almost only as **accent text/border on DARK backgrounds** (Topbar brand, active tab
  underline, totals) — teal-on-dark IS the brand rule, no white/black-on-teal risk. **Audit verified clean:**
  zero white-text-on-teal introduced (Topbar active tab = white text + teal underline; HealthCheck bar is
  text-free) — the "pop-as-fill contrast" worry did not materialize, no code-review action needed there.

**Phase 4 does NOT:**
- Wire AR to live Supabase data (AR's backend phase — out of scope).
- Merge — held on THIS branch for the one-flip rollout (stack becomes Phases 1+2+3+4).
- Add any dependency or migration or grant or service-role or token — none needed.
- Touch AR's Directory/PageBadge overlay internals (they stay as-is; only `onNavigate` is repointed to the URL).

**Build sequence:** (1) move files + delete the 3 dropped; (2) write `ARLayout.jsx`, edit `Dashboard.jsx`
for URL-driven tabs; (3) wire `nav.js` + `App.jsx`; (4) green→teal in `ar/lib/tokens.js`; (5) `npm run
build` green; (6) hand off to cold terminals — /buildvsplan → /code-review → /security-review → preview
smoke (temp `tenant_config.apps=["sales","ar"]` + member `apps` flip to light it, **revert after**), all
on THIS branch. DO NOT MERGE.

**Smoke checklist:**
- `/ar` (no tab) renders Triage; each sidebar AR item deep-links its tab; sidebar + Topbar highlight in sync.
- New Report Excel/CSV upload parses → Dashboard populates; grand total shows; Export / "Accountant Review" work.
- Upload screen shows when localStorage is empty.
- No CSS leak either way (host Sales/Schedule/Field pages unchanged; AR linen/crosshatch intact).
- AR group is NOT AUTHORIZED until the entitlement flip; lit via the temp flip for smoke, reverted after.
- Accents are **teal**, not green, in the AR Topbar + tabs.

**For the security-review terminal:** AR adds no grant/migration/service-role/token; deleting the dead
`supabase.js` removes a stray `createClient` (0 importers, build-safe); AR data is client-local (no RLS
surface, no anon exposure). Multi-tenant isolation stays F7-gated — AR's localStorage store is not a
cross-tenant DB surface, so nothing new to flag there.

#### ▶ Round-1 audit amendment — 2026-09-02 (2 agents · 2H/3M/1L · pattern: prose-defaults-not-hardened)

The Round-1 audit found no data/security/scope issues — only that §4b stated safe defaults in prose but
didn't harden them in the spec. All six are folded into the body above (integrated, not bolted on); this
block is the audit trail of what changed:
- **A (High) — routing defaults hardened:** `nav.js` `home → /ar/triage` (step 5) + ARLayout index/`*`
  `<Navigate to="triage">` backstop (step 2) + `Dashboard` `activeTab = useParams().tab ?? "triage"` (step 3).
  Kills the blank-grey-page-on-AR-header-click and the bare-`/ar` Export no-op.
- **B (High) — crosshatch linen preserved:** host has no `body::before`; keep AR's gradient on a scoped
  `.ar-root::before` (step 2 + pre-flight). **Design call ratified: Option 1** (subtree-scoped wrapper,
  mirrors `.schedule-root`) — NOT edited into host `GLOBAL_CSS` (Option 2 rejected: it would repaint behind
  every live Sales page for a cosmetic AR gap, out of Phase-4 scope).
- **C (Med) — `onNavigate` guarded:** map non-tab chapter ids (`"upload"`) → `triage` before navigate (step 3).
- **D (Med) — teal hexes pinned:** exact values in the token step (no "equivalents" drift).
- **E (Med) — no-op, confirmed:** grep found zero bare `<h1>–<h4>` in AR → no `h1–h4` scoped rule needed.
- **F (Low) — accepted/WONTFIX:** ARLayout wraps `<ARProvider>`, so re-entering `/ar/*` from another group
  remounts it → a one-frame `return null` flash while the sidebar already highlights AR. React Router keeps
  ARLayout mounted across tab changes *within* `/ar`, so this only fires on cross-group re-entry — solo user,
  cosmetic. Accept. (If it ever annoys: hoist `ARProvider` above the per-group route.)
- **Adjacent (backlog, NOT this revision):** `ar/lib/exportUtils.js:19,21,114` hardcode `#5BBD3F` in
  generated print HTML — on-screen goes teal but Accountant-Review/Print output stays green. Pre-existing,
  not caused by the CSS drop. Filed as a `docs/BACKLOG.md` row (screen/paper color parity); swap the 3
  literals if/when it matters.

#### ▶ BUILD + GATE STATUS — 2026-09-03 (append-only)

- **BUILT** on `feat/schedule-merge-plan` (commit `830d535`), `npm run build` green, HELD (not merged).
- **All three code gates GREEN:** /buildvsplan 7/7 PASS · /code-review 0 blockers (filed **B74** — junk-tab
  URL + dead `GLOBAL_CSS` export, both HARDENING) · /security-review 0 exploitable-today (filed **S15** —
  print-HTML self-XSS + client-only guard + unencrypted localStorage, all future-backend-gated).
- **Preview smoke DEFERRED (Chris's call, 2026-09-03):** AR is underdeveloped + slated for rework, and the
  mount is cosmetic + entitlement-dark (renders for nobody), so smoking pixels now has no value. Deferred,
  not failed. Re-smoke when AR actually gets built out.
- **⚠️ GO-LIVE ROLLOUT POINTER:** at the final suite one-flip, **hold AR out of the entitlement** — light
  `["sales","schedule","field"]` only, NOT `"ar"` — until AR is actually built out. The code being "moved
  in" does not obligate turning it on. Flip AR on in its own later step once its backend phase lands.

Verified-clean by the audit (no action): react-router 0 imports · dead `supabase.js` delete build-safe ·
no `var(--)` deps · no local `C` object · xlsx `0.18.5→0.20.3` API parity · `GroupGuard app="ar"` +
`teamMember` threading already generic in host · no white-on-teal introduced · autofill/scrollbar host
parity exact. **No re-audit needed** unless Finding B's approach changes (it didn't).

---

## 5. PHASE 5 — THE NAME + ADDRESSES  (final build target)

Last phase (Beat 8, LOCKED — amended below). This phase is a **rename + a cleanup**, NOT an address
move. The product's public home is **`scmybiz.com`** and has been the whole time — it does not change.
Nobody who uses the app logs in anywhere new. No new features, no data changes.

> **THE FRAME (say it plainly):** `scmybiz.com` = the live URL, always has been, stays. `salescommand.app`
> is **leftover cruft** — an old/secondary domain that leaked into some code (mainly *invoice* emails;
> *proposal* emails already use `scmybiz.com`). The "address sweep" is deleting those stale strings and
> pointing them at the address that was already real. It is not a migration and it does not disrupt any user.

> **Plan pass — decisions LOCKED 2026-09-03 (Chris, this session):**
> 1. **Rename scope = everything.** Rename the old *umbrella* name where people see it (marketing pages,
>    email body text) AND in the hidden code comments — stale names confuse later. Careful per-file edits,
>    **never a blind find-and-replace.**
> 2. **KEEP the "Command" suffix on every section** — Sales Command, Schedule Command, Field Command,
>    AR Command — in the sidebar AND on marketing. This **AMENDS Beat 8** (which had said drop the suffix).
>    Rationale: differentiates *Sales inside our software* from generic "sales," and reserves "Command" as
>    a future named protocol/process. See [[project_command_suffix_is_the_brand]]. Only the umbrella spelling
>    changes: **"Sub Con Command" → "Subcon Command"** (one word).
> 3. **Fix email link-targets now, ahead of the merge** (Bucket A) — safe, they only repoint to the address
>    customers already use. The email *sender* address is a rarely-used backup — **left alone** (§5c).
> 4. **Logo:** the "Command Suite" subline is **already gone** (Phase 1 removed it) — leave it gone. Keep the
>    "SC" badge. There is **no product wordmark on the login screen** to change (login shows the tenant's
>    company name), so "login wordmark" is dropped from scope (§5e).

### 5a. Ground truth (verified against code, 2026-09-03)

- **Web-address refs:** `salescommand.app` ×28 · `scmybiz.com` ×8 · `schmybiz.com` ×4 · `schedulecommand.com` ×3 · `sccmybiz.com` ×2 · `subconcommand.com` ×0.
- **Umbrella spelling:** `"Sub Con Command"` appears in `SubConCommandPage.jsx` (`/suite`) — change to `"Subcon Command"`. The `"Sales Command"` ×68 hits are mostly the **kept** section brand or code comments; only the umbrella-name and stale-URL ones change (see §5d).
- **`scmybiz.com` is the unchanged live URL.** `subconcommand.com` + `sccmybiz.com` forward in; old `schmybiz.com` / `schedulecommand.com` / `salescommand.app` forward to it (§5f).
- **Customer token routes (`/sign/:token`, `/invoice/:token`) NEVER change.** Already-sent emails keep working **because `salescommand.app` keeps forwarding to `scmybiz.com`** — that forward is load-bearing (§5f), do not unplug it.

### 5b. The web-address sweep — split into THREE buckets by risk

The refs are not all the same thing. Sorting them is the whole safety of this phase.

**Bucket A — LINK TARGETS (where a button/link points). Repoint to `https://www.scmybiz.com`. Deployable now.**
| File | Line | What it is | Note |
|---|---|---|---|
| `supabase/functions/send-invoice/index.ts` | 12 (`SITE_URL`) | invoice email link `…/invoice/{token}` + Stripe `…/invoice-paid` redirect (`:339,:358`) | customer-facing |
| `supabase/functions/create-billing-session/index.ts` | 13 (`SITE_URL`) | Stripe billing portal success/cancel/return (`:119,:120,:152`) | Chris-facing |
| `supabase/functions/_shared/repNotify.ts` | 20 (`SITE_URL`) | internal rep-notify link → **also fix the stale route** `…/proposals/{id}` → `/sales/proposals/{id}` (`:164`) | internal |
| `supabase/functions/invite-user/index.ts` | 125 (`redirectTo`), 168 (email link) | new-user magic-link landing | **auth-redirect dep — see §5c-ii** |
| `supabase/functions/reset-password/index.ts` | 68 (`redirectUrl`) | password-reset landing | auth-redirect dep; also **simplify the `isSchedule` branch** (`:66-69`) — post-merge there is one app, not a separate Schedule site |
| `src/components/ProposalPDFModal.jsx` | 74 (`signingUrl`) | **display-only** copy-link shown to Chris (`:513`); the *sent* proposal email builds its own `scmybiz.com` link server-side | not the customer's email link, but still correct it |
| `src/pages/SubConCommandPage.jsx` | 12,113,151,193,370,418 | `/suite` marketing "enter app" links | see §5d copy |
> `send-proposal/index.ts:120` already uses `www.scmybiz.com` — leave it. Token routes do not change — only the domain in front of them.

**Bucket B — SENDER "FROM" ADDRESS (`noreply@salescommand.app`). LEAVE ALONE this phase.**
`PayAppDetailModal.jsx:353`, `Invoices.jsx:1012`, `stripe-webhook:47`, `send-pay-app:323`,
`send-invoice:281`, `invite-user:153`, `send-proposal:147`, `reset-password:69`,
`check-orphan-users:47`, plus the `VERIFIED_DOMAINS` allow-lists. Why leave it: see §5c.

**Bucket C — INCOMING ALLOW-LIST (`_shared/cors.ts`, `VERIFIED_DOMAINS`). ADD, never REMOVE.**
`scmybiz.com` is already present (`cors.ts:18-19`). Keep `salescommand.app` in the lists through the
transition so nothing still pointing there breaks. Removing an old address is a *later* cleanup.

### 5c. Two real cautions (both were over/under-stated in the first draft — corrected)

**i. The email "from" address is a minor backup, not a trap.** Real sends go **from the user's own
address** (`chris@hdspnv.com` / John's) — the code sends from the sender's email when its domain is
verified (`hdspnv.com` is). `noreply@salescommand.app` is only the fallback if a sender has no valid
verified email, which for HDSP **basically never fires.** So there is no customer email branded "Sales
Command." We **leave the fallback address alone** — changing it to an unverified domain is the only way
it could quietly break a send, and there's no upside to touching it in a rename. (Its eventual cleanup is
its own tiny step: verify the new domain in Resend first, then flip + test-send.)

**ii. Auth-redirect allow-list (the genuinely invisible one).** The reset-password and invite-user
landing URLs (`reset-password:68`, `invite-user:125`) must be **registered in Supabase Auth's allowed
redirect URLs**, or the reset/invite link silently fails. `scmybiz.com` is almost certainly already
listed (it's the live site) — but the build **must confirm it in the Supabase Auth settings before**
swapping these two, and smoke one reset + one invite on a preview.

### 5d. The name sweep — what changes vs what's kept

**Umbrella name → change:** `"Sub Con Command"` → `"Subcon Command"` (one word) everywhere in
`src/pages/SubConCommandPage.jsx` (nav `:105`, hero `:186`, about `:400`, footer `:441,:445`, tab title
`:58`), plus any `"Sub Con Command"` in `LandingPage.jsx` / `FeatureDetailPage.jsx`.

**Section brand → KEEP "Command"** (per decision #2): "Sales Command / Schedule Command / Field Command /
AR Command" stay as-is — in the sidebar (`nav.js:12,24,35,43` — **no change**) and on marketing. This
reverses the first draft's "change the sidebar label to Sales"; it is now **left as "Sales Command."**

**`/suite` marketing copy (APPROVED by Chris 2026-09-03) — `SubConCommandPage.jsx`:**
- Enter-app buttons: hero `:202` + final `:428` "Launch Sales Command" → **"Launch Subcon Command"**; top-nav pill `:122` + mobile `:159` "Sales Command" → **"Enter App"**.
- Vision section tense (Schedule + Field are real now): `:371` "Schedule Command **will give**" → "**gives**"; `:372` "Field Command **will bring**" → "**brings**"; `:373` AR Command stays future ("will track").
- Status badges (`PRODUCTS` array, top of file): **Schedule Command + Field Command → "live"**; AR Command stays "coming soon". Their live `href` now points into the one app (`scmybiz.com/schedule`, `/field`), not separate sites.
- Final CTA line `:415`: → **"Sales, Schedule, and Field are live today — with AR Command on the way."**
- KEEP: "The Command Suite for SubContractors" tagline (`:173`) and "4 Command Products" stat (`:277`) — they describe the suite, not the product name.

**Hidden code comments → change too** (decision #1): `"Sales Command"` in comments across `src/` +
`supabase/`, careful per-file edits. **Protected — never rename:** the `"sales"` app id + `/sales/*`
routes, token routes, DB column names, `salescommand.app` inside Bucket C allow-lists.

### 5e. Logo / wordmark (J4 → RESOLVED)

- **Subline: already gone, leave gone.** Phase 1 removed the "Command Suite" subline from `Logo.jsx` (see
  the `[J4]` comment, `Logo.jsx:17-20`). Nothing to do.
- **SC badge: keep** (`SalesCommandMark`, `Logo.jsx:3-14`).
- **No login wordmark change:** `Login.jsx` renders the **tenant company name** (`getTenantConfig().company_name`),
  not a product wordmark — there is no "Sales Command" on the login to rename. Dropped from scope.
- In-app sidebar wordmark (`AppWordmark`) already reads "Subcon Command" — correct, no change.

### 5f. Domain forwarding (NOT code — ops checklist, not a build step)

Done in the hosting/DNS dashboards:
- `subconcommand.com` + `sccmybiz.com` → forward to `scmybiz.com`.
- `schmybiz.com` / `schedulecommand.com` / `salescommand.app` → forward to `scmybiz.com`. **Keep
  `salescommand.app` forwarding** so old already-sent invoice links survive (§5a).
- Turn OFF the old standalone Schedule deploy (`sch-command` Vercel) once `/schedule/*` is verified.

### 5g. Layout / UI check ([[feedback_ui_first_class]])

No new screens. Verify in a browser: `/suite` reads "Subcon Command" throughout, sections still read
"X Command", Schedule/Field show "Live", "Launch Subcon Command" button works; sidebar unchanged
("Sales Command" etc.); a test invoice email button lands on `scmybiz.com`. No white backgrounds, teal
buttons black text.

### 5h. Finish line

Bucket A + umbrella-rename + `/suite` copy + comment sweep → `/buildvsplan` → `/code-review` →
`/security-review` → preview smoke (§5g, incl. the §5c-ii reset + invite check) → **this is the last
phase, so its finish also feeds the one-flip go-live** (entitlement flip to light Sales+Schedule+Field,
AR held per §4b). The §5f domain forwards and the §5c-i sender cleanup are **separate ops steps**, not
gated on the merge.

---

## §5 AMENDMENT — Round-1 audit response (2026-09-03)

_Append-only per [[feedback_schema_amendment_not_overwrite]]. Round-1 audit (`a40e710`, 3 agents) returned
11 caused-by (3H/… ) + 2 adjacent, 0 security. Two agents independently hit the deploy-timing hazard —
strongest signal. Chris ratified the calls below. Where this amendment corrects a §5a–§5h claim, **this
block wins**; the original text is kept above for provenance._

### AM-1 · Deploy timing → **OPTION 1: NOTHING deploys ahead of the merge** (RATIFIED)

Reverses §5's "fix email link-targets now" / §5b "deployable now" framing and the earlier in-session
"fix emails now" call. **The whole of Bucket A ships WITH the one-flip merge — nothing early.** Reason
(audit A1/A2, + Chris): the link fixes point at `/sales`, `/schedule`, `/field` routes that **don't exist
in prod until the merge flips**, so an early deploy hands John + customers dead links during the in-between
window. And the stale `salescommand.app` refs **already forward to `scmybiz.com` today** → zero urgency.
This restores the branch's own locked rule ([[project_subcon_merge_rollout]], "ONE flip at the end, not a
drip"). **Dissolves findings A1, A2, D outright** (no ahead-of-merge window = no live 404s, no false "Live"
badges, no `isSchedule`-ordering trap).
- **§5b is superseded:** delete the A/B/C "deployable now vs later" distinction. All URL edits are just
  "part of the merge." Buckets A/B/C still describe *what* each ref is (link-target / sender / allow-list)
  and the **keep-sender-alone** (§5c-i) + **add-never-remove allow-list** (§5b-C) rules still hold — only
  the *timing* split is gone.

### AM-2 · Auth-redirect gate — www vs apex (audit B) — **hard gate, exact host**

§5c-ii understated this. Before swapping `reset-password:68` / `invite-user:125` to `https://www.scmybiz.com`,
the build MUST confirm the **exact** value `https://www.scmybiz.com/**` (note **`www`, not the apex
`scmybiz.com`** — they are different origins to Supabase Auth) is in **Supabase Auth → URL Configuration →
Redirect URLs**. If the allow-list holds only the apex or a non-matching pattern, reset + invite links
**silently misdirect, no error**. The preview smoke of **one real password-reset + one real invite** is a
**hard gate**, not an optional check. (Ships with the merge per AM-1, but the allow-list confirm can be
done any time — it's a dashboard setting, not code.)

### AM-3 · Login screen DOES carry the old product name (audit C1) — **§5e claim was FALSE**

`Login.jsx:127` renders **`Sales <span>Command</span>`** — the dominant heading (size 22 / weight 800),
with the tenant company name as a size-12 subline beneath it. My grep missed it because the words are
**split across JSX nodes** (contiguous "Sales Command" isn't in the file) — see [[reference_jsx_split_brand_grep]].
**§5e's "no product wordmark on login" is retracted.** Build: change `Login.jsx:127` text node
**`Sales ` → `Subcon `** (keep the teal `<span>Command</span>`) → renders "Subcon Command". This is the
product's front door — highest-visibility rename in the phase.

### AM-4 · Rename ground-truth was incomplete (audit C2/C3/G) — second grep pass + classification REQUIRED

§5a/§5d were built from a too-narrow (contiguous-string) search. Before editing, the build runs a **full
umbrella/entity grep** and **classifies every hit** into one of:
- **section-brand → KEEP** ("Sales Command" as the Sales area name — the majority of the 68 hits).
- **umbrella-name → CHANGE** ("Sub Con Command" → "Subcon Command").
- **legal entity → decide + likely KEEP VERBATIM** (`Settings.jsx:647` **"Billed by Sub Con Command LLC"** —
  is that the registered LLC name? If so it stays exactly, spelling included).
- **JSX-split marks** ([[reference_jsx_split_brand_grep]]): `SubConCommandPage.jsx:105` (nav) + **`:441`**
  (footer) render `Sub Con <span>Command</span>` — a literal find/replace **silently skips these two most
  visible marks**. Spell the edit: text node **`Sub Con ` → `Subcon `**, keep the `<span>Command</span>`.

Newly-found hits to add to the §5d list: `Settings.jsx:647` (entity, above), `LandingPage.jsx:363` +
`FeatureDetailPage.jsx:447` ("© **Sales Command**. All rights reserved." — entity/copyright use → three
different post-rename spellings if left unclassified).

### AM-5 · Comment sweep is a no-op — CUT it (audit E)

Chris's decision #1 ("rename hidden code comments too") targeted **stale umbrella refs** in comments. The
audit found there are **none** — the shell's comments already say "Subcon Command", and the "Sales Command"
comment hits are **correct Sales-section references (kept brand)**. So the comment sweep has **zero valid
targets**. **Cut it** — renaming those comments would wrongly rewrite the kept section brand. (This honors
decision #1's intent by finding nothing to do, not by ignoring it.)

### AM-6 · Small fixes folded in (audit F) + adjacent → backlog (ADJ-1/ADJ-2)

- **F (`invite-user:168`):** the visible anchor **text** is a separate `salescommand.app` literal from the
  `href` — fix **both** or the email reads "log in at salescommand.app" while linking to scmybiz.com.
  (Ships with merge per AM-1.)
- **ADJ-1** (backlog, pre-existing): `create-billing-session:119-152` returns to `${SITE_URL}?billing=success`
  / `?page=settings` but **no `src/` handler reads those params** — Stripe return lands on SubconHome, param
  ignored. Add a `?billing=success` toast + real return path. Filed **B75**.
- **ADJ-2** (backlog): `sccmybiz.com` is **hard-routed in code** (`App.jsx:104-116` renders SubConCommandPage
  for that host) — it is **not** a DNS forward. §5f's "sccmybiz.com → forward" contradicts the code; reconcile
  (one-liner: §5f should say the *marketing* hosts are served in-app, only the *old legacy* domains forward).
  Filed **B76**.

### AM-7 · [DESIGN-OPEN] The real homepage (`scmybiz.com/` = `LandingPage`) — rename or keep? (audit G)

The live homepage a prospect hits at `scmybiz.com/` renders **`LandingPage.jsx`**, which is **100%
"Sales Command"** (product landing). The separate `/suite` page (`SubConCommandPage`) is the "Subcon
Command" suite marketing. §5d's "any 'Sub Con Command' in LandingPage" clause is a confirmed **no-op**
(there is none — it's all "Sales Command"). **Decision needed before build:** does the homepage stay a
**Sales Command** product page (Subcon Command lives only at `/suite`), or does the homepage **become
Subcon Command** too? This is a marketing call, not mechanical — **the one open item gating build.**

### §5 revised finish line (supersedes §5h)

Second grep + classification (AM-4) → login + umbrella + `/suite` + entity edits (AM-3/AM-4/AM-6-F), comment
sweep CUT (AM-5), **all held for the one-flip merge** (AM-1) → `/buildvsplan` → `/code-review` →
`/security-review` → preview smoke incl. the **hard** reset + invite gate (AM-2) → merge = go-live. Resolve
AM-7 (homepage) first.

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
   `/suite`, `/login` are neither prefixed nor auth-gated nor redirected. **[J1]** `/checkout` +
   `/features/:slug` are **logged-out-only** routes today (a logged-in user already can't reach them) —
   verify they still resolve in the logged-out tree; don't assert logged-in survival.
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

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-09-03. Consumed by `/runaudit` to size the adversarial audit pass._
_**Scope = Phase 5 only** (§5 / §5a–§5h — "The name + addresses"). The numbered §7 above is the Phase-1
manifest, historical; the Phase-4 manifest it replaced is in git history. This is the current round's manifest._

### Bottom line (plain English)
The final phase: rename the whole product to **Subcon Command** and delete leftover references to an old
web address. **The live address (`scmybiz.com`) does not change and no user has to log in anywhere new.**
It touches no database and no money math. The two things that can actually bite are both about the app's
automatic emails and the marketing page: (1) an address or login-reset link that quietly stops working,
and (2) a careless rename that changes the wrong words. So it's a **3-reviewer check** — one on the
email/link plumbing, one on rename precision, one on the marketing page + logo. Not a deep audit.

### Round
- Plan type: **feature** (rename + cleanup of existing surface; no pre-existing defect)
- Current round: **1** (Phase 5's first audit — the earlier Round-1/Round-2 commits and the Phase-4
  round in this doc's history were **other phases**, out of scope here)
- Plan revision under audit: `3e9c2ea`
- Findings trend: n/a — round 1
- **§0 baseline location**: §5a "Ground truth (verified against code, 2026-09-03)" + §5b/§5c —
  **run/grep-verified**, not asserted: `grep` produced the exact ref counts (`salescommand.app` ×28 etc.);
  the actual `from`-address logic was **read** in `send-invoice`/`send-pay-app`/`send-proposal` (real sends
  go from the user's verified address; `noreply@salescommand.app` is a ~never-fired fallback); `SITE_URL`
  usage traced (Stripe redirects + token links); `Logo.jsx`, `Login.jsx`, `nav.js` read to confirm the
  subline is already gone, the login shows the tenant name, and the sidebar already keeps "X Command".
  Evidence recorded, not assumed. Prereq satisfied.

### Prior rounds
none — this is Phase 5's round 1.

**Briefing for agents**: attack ONLY the Phase-5 material (§5 / §5a–§5h). Phases 1–4 are built, gated,
and out of scope — do not re-audit them. The plan already self-corrected 6 unverified assumptions this
session (see the revision commit); do not re-litigate those corrections, verify they hold against code.

**Plateau signal**: n/a at round 1. If a round 2 is needed and its count is ≥ round 1, treat as scope
creep and present scope-cut as the only build-prompt option.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding F7-blocked.
- **Prod / staging / dev**: Phase 5 code is planned on `feat/schedule-merge-plan`, **HELD, not merged**.
  Prod = classic Sales Command at `scmybiz.com`. **Exception the agents must weigh:** edge functions are
  **NOT branch-gated** — deploying the Bucket-A URL fixes (§5b) hits the **live** shared Supabase project
  immediately, even while the merge is held. That is the plan's one deploy-ahead-of-merge action.
- **Blocking feature flags**: the go-live entitlement flip (`tenant_config.apps`) still gates the merged
  shell; AR stays out of the flip per §4b. Marketing pages (`/suite`, Landing) are public, un-gated.
- **Concurrency profile**: solo (Chris + John). No shared-write race surface introduced.

Agents weight severity against these: no DB/RLS/tenant/money surface, so cross-tenant and money-corruption
findings are inapplicable, not merely "capped." The real severity lives in **silent-failure** paths — an
email/link/auth-redirect that breaks with no visible error — and in **deploy timing** (touching live edge
fns while the merge is held). Theoretical attacks on the held, un-flipped shell are not High.

### Time budget + finding cap
- **Time budget**: 60 min (defaulted — no §7 estimate for Phase 5; a rename + cleanup, comparable to
  Phase 4's cosmetic mount, but with live edge-fn/email/Stripe/auth-redirect surface that raises stakes).
- **Finding cap**: 6 findings. Surface only the top-6 most consequential; remainder → "Quarantined
  findings (not actionable this loop)."

### Surface
- Total lines: 1149 (whole doc); **Phase-5 scope ≈ 118 lines** (§5 / §5a–§5h).
- Sections: §5 + 8 sub-sections (§5a–§5h).
- [LOCKED] decisions: 4 (the decision block at §5 head — rename scope; keep "Command" suffix / amends
  Beat 8; fix link-targets now / leave sender; logo subline gone). Marked in prose, not brackets.
- [DESIGN-OPEN] items: 0 (all three forks resolved with Chris this session).
- [OPEN] items: 0.
- Plan-to-code ratio: ≈ **118 : ~40** (≈ 3:1). Est. code ≈ 40 lines of edits (6 edge-fn URL swaps,
  `SubConCommandPage.jsx` copy, umbrella-name + comment sweep) — no new files. Not scope-crept.

### Layers touched
- Edge functions / API routes (URL/`SITE_URL`/`redirectTo` edits in `send-invoice`, `create-billing-session`,
  `repNotify`, `invite-user`, `reset-password`; `reset-password` `isSchedule` branch simplification)
- UI / components (marketing `SubConCommandPage.jsx` copy + status badges; `ProposalPDFModal.jsx:74` display link)
- External integrations (Stripe redirect targets; Resend sender left alone; **Supabase Auth allowed-redirect list**)

### New mechanisms introduced
- New columns / tables / triggers / RLS policies / cron / webhooks / routes / helpers: **none.** This
  phase edits existing strings + copy and simplifies one branch; it invents no new mechanism.

### Cross-system reach
- **Supabase Auth** (allowed-redirect-URL config — §5c-ii; off-repo setting, silent-fail if unset).
- **Stripe** (checkout/billing redirect targets built from `SITE_URL`).
- **Resend** (email sender domain — deliberately NOT changed this phase).
- **DNS/hosting** (domain forwards — §5f, ops step, not code). No DB, no other repo's schema, no
  service-role / bypass-RLS write path.

### Irreversibility
- Edge-fn redeploys hit live immediately but are **reversible** (redeploy prior). No migration, no
  backfill, no schema/API contract change. Domain forwards (§5f) reversible in the DNS dashboard. The
  one non-obvious durability point: **do not unplug `salescommand.app` forwarding** — old already-sent
  invoice links resolve only through it.

### Known weak points
- **Edge-fn deploy timing (§5b/deployment).** Bucket-A fixes deploy to the LIVE project ahead of the
  held merge. Agents: does any single Bucket-A edit change a *currently-working* live email/Stripe flow
  for the worse, or is each purely a stale→correct address swap?
- **Auth-redirect allow-list (§5c-ii).** Swapping `reset-password:68` / `invite-user:125` redirect
  targets to `scmybiz.com` silently breaks reset/invite if `scmybiz.com` isn't registered in Supabase
  Auth's allowed redirect URLs. Plan says "verify first" — confirm that gate is real, not assumed.
- **Stripe redirect targets.** `send-invoice:339` (`/invoice-paid`) and `create-billing-session:119-152`
  build post-payment redirects from `SITE_URL`. Confirm `scmybiz.com` serves `/invoice-paid` and the
  billing return routes, or a paid customer lands on a dead page.
- **Forward dependency (§5a/§5f).** Old sent `salescommand.app/invoice/{token}` links live only while
  that domain forwards. Any plan step that "cleans up" or removes `salescommand.app` too early kills them.
- **Rename precision (§5d).** 68 `"Sales Command"` hits, but the section brand is KEPT and only the
  umbrella `"Sub Con Command"` changes. A blind edit could (a) wrongly rename the kept section brand,
  (b) touch the protected `"sales"` app id / `/sales/*` route / token routes, or (c) leave the `/suite`
  copy internally inconsistent (tense, status badges, button labels).
- **`reset-password` branch simplification.** Collapsing the `isSchedule` split (`:66-69`) is a small
  logic change, not a string swap — confirm the Sales-only path is correct post-merge and nothing else
  reads the removed Schedule branch.

### Open questions
- Count: 0 — all forks resolved with Chris this session (rename depth, "Command" suffix, email timing, logo).
- Highest-pressure: none open — pressure is on the weak points above, not on unresolved decisions.

### Suggested attack angles (3 total)
1. **Email / link / auth-redirect plumbing (silent-failure hunt)** — covers Edge functions + External
   integrations. Required reading: `supabase/functions/send-invoice/index.ts` (`SITE_URL`, `:339`, `:358`,
   `:281`), `create-billing-session/index.ts` (`:119-152`), `_shared/repNotify.ts` (`:20`, `:164` stale
   route), `invite-user/index.ts` (`:125`, `:168`, `:153`), `reset-password/index.ts` (`:66-69`),
   `send-proposal/index.ts:120`, `_shared/cors.ts`, `src/components/ProposalPDFModal.jsx:74/513`. Specific
   pressure: the §5b A/B/C bucketing — is anything mis-bucketed (a live sender treated as a mere link
   target, or vice-versa)? Does swapping any Bucket-A ref break a currently-working flow? Is the
   auth-allowed-redirect dependency (§5c-ii) real and gated before the swap? Stripe redirect targets
   resolve on `scmybiz.com`? The `isSchedule` simplification safe?
2. **Rename precision — keep vs change (protect the ids/routes)** — covers UI/components + brand rules.
   Required reading: the plan §5d, `src/lib/nav.js` (kept "X Command" labels + protected `sales` id/prefix),
   the `"Sub Con Command"` vs `"Sales Command"` distinction across `src/` + `supabase/`, `src/pages/Settings.jsx`.
   Specific pressure: does the plan's change/keep rule reliably separate the umbrella name (changes) from
   the section brand + `sales` app id + `/sales/*` routes + token routes (protected)? Any hit where a
   careless edit would break routing, an id, or a token link? Comment-sweep scope creep.
3. **Marketing page + logo reality (visual + assumption re-verify)** — covers UI. Required reading:
   `src/pages/SubConCommandPage.jsx` (full — nav, hero, PRODUCTS array, Vision, final CTA, footer),
   `src/pages/LandingPage.jsx`, `src/pages/FeatureDetailPage.jsx`, `src/components/Logo.jsx`,
   `src/pages/Login.jsx`. Specific pressure: verify the plan's corrected claims still hold in code — the
   "Command Suite" subline is genuinely gone from `Logo.jsx`, `Login.jsx` renders the tenant company name
   (no product wordmark), `AppWordmark` already reads "Subcon Command". Is the approved `/suite` copy
   (§5d) internally consistent (Schedule/Field "Live" vs their real state, tense, "Launch Subcon Command"
   buttons, final CTA)? No white background / local `C` object / teal-on-teal contrast introduced.

### Suggested agent count: 3

Rationale: the formula yields 4 (3 layers + cross-system reach), but there are **zero novel mechanisms**
and no DB/RLS/state surface, so the cross-system "+1" is thin — the Stripe/Resend/Auth reach is all
covered inside the email-plumbing angle. Three genuinely distinct pressure points remain (silent-failure
plumbing; rename precision; marketing/logo reality); a 4th agent would overlap. Three is the honest size
for a rename + live-edge-fn cleanup.
