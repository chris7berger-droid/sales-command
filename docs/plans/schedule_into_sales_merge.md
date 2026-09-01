# Schedule → Sales Merge (Sub Con Command)

**Status:** IDEATE seed — 2026-09-01. Not a plan yet. No code, no migrations.
**Mode:** ideate (opus 4.8 / xhigh) → plan → build. Build is gated until a verified plan exists.
**Repo:** sales-command (host shell). Sibling repo being absorbed: sch-command.

## 0. Why this doc exists

Chris opened the migration of Schedule Command into Sales Command on 2026-09-01. A search of
sales-command, sch-command, and command-suite-db (plans, branches, handoffs) found **no prior
plan doc** for the app merge. The only prior thinking is the strategy note below. This seed
captures that note, the first ground-truth findings, and the open ideate question so a fresh
session resumes exactly here.

## 1. Locked strategy (from the 2026-08-25 one-app decision) [LOCKED]

- The Command Suite is **one product with four sections**, not four sellable apps.
- Umbrella name: **Sub Con Command** — goes on the login, wordmark, domain.
- Sections are named **Sales / Schedule / Field / AR** (drop the "Command" suffix so nothing
  collides with the umbrella).
- **Sales Command is the host shell** (workflow entry point). **Schedule's views become routes
  inside it.**
- **Teal** wins the design-token reconciliation.
- `team_members.apps` shifts from *gating logins* to *showing/hiding nav sections*.
- **Field stays a separate app** — the one real boundary is its offline-first PowerSync mobile
  runtime.
- DB is already shared (`pbgvgjjuhnpsumnowuym`) and all migrations live in command-suite-db, so
  this is a **frontend + routing + auth/nav migration, not a data migration.**

## 2. Ground truth observed 2026-09-01 [DERIVED]

Both apps are React + react-router, single router in `src/App.jsx`.

**Sales routes:** `/`, `/home`, `/calllog`, `/calllog/:id`, `/proposals`, `/proposals/:id`,
`/customers`, `/customers/:id`, `/invoices`, `/invoices/:id`, `/leads`, `/archive`, `/import`,
`/managers`, `/team`, `/settings`, `/suite`, `/login`, `/checkout`, `/features/:slug`,
`/invoice/:token`, `/invoice-paid`, `/sign/:token`, `/qb/callback`, `*`.

**Schedule routes:** `/`, `/home`, `/jobs`, `/jobs/:jobId`, `/calendar`, `/daily`, `/schedule`,
`/schedules`, `/materials`, `/budget`, `/production-rate`, `/billing`, `/billing/forecast`,
`/settings`.

**Collisions / reconciliations needed:**
- `/home` — both own it. Merged app has one Home.
- `/settings` — both own it. Merged app has one Settings (sections inside it).
- `/jobs` + `/jobs/:jobId` (Schedule) vs `/calllog` + `/calllog/:id` (Sales). Per the
  "job detail is home" rule, `call_log` job detail is THE job screen; Schedule's job view has to
  fold into it or namespace under it.
- Everything else in Schedule needs a namespace (`/schedule/*`) or a home in the unified nav.

## 3. Ideate beats

### Beat 1 — Top-level navigation  ← ANSWERED 2026-09-01 (Chris's picture) [LOCKED]
Option A (one unified sidebar, app groups that expand), with Chris's specifics:

- Sidebar header: **SUBCON COMMAND** replaces "Sales Command / Command Suite".
- Menu order: **Home** → **Sales Command ▾** → **Schedule Command ▾** → **Field Command ▾** →
  **AR Command ▾** → **Settings** (global, bottom).
- Each app group expands (accordion) to that app's full existing menu, dropped in as-is for v1
  (Sales: Call Log, Proposals, Campaign Leads, Invoices, Customers, Our Team, History Locker,
  The Directory; Schedule: Calendar, Daily, Materials, Budget, Billing…).
- **Subcon Command Home** = NEW landing screen after login: one dashboard split into four
  quadrants, each a glanceable summary of one app with one-click-in to that app's own Home.
  Sales Home (follow-up/engagement redesign) and Schedule Home keep existing underneath.
- Behavior (Claude's proposal, not yet ratified): active group auto-expands from the URL; one
  group open at a time; `team_members.apps` hides whole groups.
- Seam that survives v1: the job record still lives in two places (Sales Call Log job vs
  Schedule Jobs page). Folding them is a later beat.

**Naming LOCKED 2026-09-01 (supersedes the 2026-08-25 note's "drop Command" / "Sub Con"):**
- Umbrella = **Subcon Command** (one word "Subcon"; short for subcontractor). Wordmark:
  SUBCON white / COMMAND teal, same treatment as today's SALES COMMAND header.
- Menu groups KEEP "Command": **Sales Command / Schedule Command / Field Command / AR Command**.
  "Taking command" is core brand; the family reads as one.
- Rejected: "Sub Command" (reads submarine / sub-menu / software "sub-command"), "Sub Con
  Command" (three words — "con" jumps out, hardest to read).

**Mockup (2026-09-01):** https://claude.ai/code/artifact/9349053f-3378-4089-8582-203fa46d554e
— artboards: Subcon Command Home (Sales group expanded) + Field Command "Today" list. Sample
values throughout. Working files: session scratchpad `subcon-design/` (Main.dc.html,
FieldToday.dc.html, canvas.json). Chris's review: pending.

### Beat 1b — Field Command on the web  ← ANSWERED 2026-09-01 [LOCKED]
Field has NO web side today (phone-only: Home, Job List, Job Detail w/ Tasks / Time Clock /
Report tabs). The Field group in the sidebar is new web screens over tables the phones already
sync — no new tables, no new sync rules:

| Office sees | Table |
|---|---|
| Jobs going today, crew on each | `jobs`, `job_crew` |
| Hours | `time_punches` |
| Work types | `job_wtcs` |
| Daily forms SOD / MOD / EOD filled or not | `daily_log_entries` (type key SOD/MOD/EOD), `daily_production_reports` |
| Load-out / material confirmation | `job_material_checks` |

- **VIEW-ONLY for the office.** Writes (switch crew, change work types, correct a punch) only
  for Manager/Admin, role-gated. This dissolves the office-vs-offline-phone write conflict for
  everyone except managers; manager corrections should be marked *entered by office*.
- **Daily job list = the at-a-glance screen.** One row per job going today: Job · Crew · Hrs ·
  SOD · MOD · EOD · PRT · Load-out. (PRT = end-of-shift Production Report, job lead submits;
  added 2026-09-01.) Late-form coloring reuses the phone's own rule
  (`field-command/src/components/PunchStatusBar.js`) so desk and phone show the same "!":
  SOD late = N min after clock-in w/o SOD (amber); MOD late = N hrs after clock-in w/o MOD
  (amber); EOD / PRT late = clocked out w/o them (red). No punch → no alerts.
- **Alert thresholds are per-customer SETTINGS, not code [LOCKED 2026-09-01].** Phone hardcodes
  15 min / 4 hr today. Merge moves them to `tenant_config` (Admin/Manager edit in Settings):
  `sod_due_minutes`, `mod_due_hours`, `eod_required`, `prt_required`. Phone + web read the
  same row so they keep agreeing. **HDSP values: SOD = 90 min** (crews punch in at the shop
  ~6:30, ~30 min loading + ~30 min driving), MOD = 4 hr, EOD + PRT required. Other customers
  will have their own scenarios — defaults for new tenants TBD in plan.
  - REJECTED 2026-09-01: counting SOD from "arrival on site" instead of clock-in. Drive time
    (the driving → on_site punch) is only tracked on prevailing-wage jobs, so it can't be the
    trigger. SOD always counts from clock-in.
- **Job drill-in:** who's on it, hours, the three forms (status + open them), the load-out form.

### Beats not yet raised (in likely order)
2. Route namespacing + the `/home` and `/settings` and `/jobs`-vs-`/calllog` reconciliations.
3. Sequencing — what ships first (a thin route-graft of whole Schedule pages vs. component-level
   port), and whether sch-command's Vercel deploy stays up during the transition.
4. Auth/nav flip — `team_members.apps` → show/hide sections; single session across surfaces.
5. Design-token reconciliation (teal wins; pay-app screens are the palette gold standard).
6. Shared state/data layer — sch-command's `queries.js` data layer vs sales-command's fetch
   patterns; the 1000-row pagination rule applies across both.
7. Field boundary — what Schedule surfaces Field mobile depends on (PowerSync sync rules,
   `job_crew`) and how they're unaffected.
8. Name/brand rollout — Sub Con Command login/wordmark/domain (schedulecommand.com redirect?).

## 4. Not in scope of this seed
No layout section, no audit manifest, no migrations — those come in the plan pass after ideate
closes.
