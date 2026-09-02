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
4. **Remaining gates:** `/buildvsplan` → `/code-review` → `/security-review` → preview smoke (needs a temporary
   schedule entitlement on a test path), then HOLD for the one-flip merge.

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
