# Schedule → Sales Merge (Sub Con Command)

**Status:** IDEATE COMPLETE — 2026-09-01, all 8 beats ratified (see §4). Not a plan yet. No
code, no migrations.
**Mode:** ideate ✅ → **plan (next)** → build. Build is gated until a verified plan exists.
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
- Sales Call Log job and Schedule Jobs page both stay — they are two different records by
  design, not a seam to close (see Beat 2 §3).

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
- **Field Command menu LOCKED 2026-09-01:** Today / Jobs / Crews / Time Clock / Daily Logs /
  Load-Outs.
  - Today = the at-a-glance list above. Jobs = all active field jobs → drill-in. Crews = one row
    per crew member, where he is right now + which job + hrs today/week. Time Clock = timesheet
    by person/day/week (in, out, lunch, PW drive, REG/OT) — feeds payroll + T&M billing.
    Daily Logs = SOD/MOD/EOD write-ups + photos by job/day.
  - **Load-Outs = a SHORTCUT, not a new screen.** Today "load-out" is exactly the crew's
    per-material "loaded in truck" checkboxes (`job_material_checks`, phone Tasks tab); trucks /
    equipment / power are office-assigned in Schedule's Logistics. Schedule already shows these
    confirmations (`sch-command/src/components/LoadOutModal.jsx` off the job card LOAD-OUT
    score). Chris keeps the menu item so office staff don't have to dig through Schedule to
    find it. Build rule: it opens the SAME component Schedule uses — two doors, one room, no
    drifting twin ([[feedback_extend_canonical_not_twin]]).
  - Parked idea (not in scope): a fuller crew "truck is ready" check (materials + assigned
    equipment + power) — that's a change to the phone form, own line later.
  - Mockups of Jobs drill-in / Crews / Time Clock: offered, Chris to pick.

### Beat 2 — Route collisions  ← ANSWERED 2026-09-01 [LOCKED]
1. **Every app gets its own URL prefix:** `/sales/*`, `/schedule/*`, `/field/*`, `/ar/*`;
   `/` = Subcon Home. Old flat Sales URLs (`/proposals/123`, `/calllog/…`) redirect to
   `/sales/…` so bookmarks + emailed links survive. **Public/token routes NEVER move:**
   `/sign/:token`, `/invoice/:token`, `/invoice-paid`, `/qb/callback`, `/login`, `/checkout`,
   `/features/:slug`, `/suite`. Sidebar group auto-expand = first URL segment.
2. **One Settings screen, grouped by app.** Left-hand list of labeled sections: **Company ·
   Sales Command · Schedule Command · Field Command · AR Command**; clicking a label shows only
   that app's settings (Chris: today's Settings is already long and hard to navigate). Field
   section = the alert thresholds (§Beat 1b). Same role gating as today.
3. **Sales job and Schedule job are two DIFFERENT records, by design — never merged.**
   - Sales job (`call_log`) = the customer's job. Permanent, first call → final invoice.
   - Schedule job (`jobs`) = the production run. Exists only once Sales sends it; disposable
     until the crew starts (pull-back deletes it, Sales edits, re-send rebuilds it clean — PB-1
     flow). Once work begins it becomes permanent (existing guard).
   - Chris (2026-09-01): "A job existing in Schedule Command is there for different reasons,
     functionality, and statuses. They're not really the same." Earlier framing ("fold into one
     job record later") is WRONG — deleted from scope.
   - What the merge adds is visibility only: Sales job screen shows whether a production run
     exists + its status (Not sent · Parked · Scheduled · In Progress) with one-click across;
     Schedule job screen links back to the customer's job. Link = the existing send/pull-back
     flow, not a new mechanism.

### Beat 3 — Sequencing  ← RATIFIED 2026-09-01 [LOCKED]
Ground truth: sales-command and sch-command are the SAME stack version-for-version (Vite,
React 19, react-router-dom 7, supabase-js 2). Schedule = 57 files / ~14K lines; Sales = 98
files / ~32K lines; AR-Command-Center = 25 src files. → Schedule's source moves INTO the Sales
repo as-is and mounts under `/schedule/*`. One repo, one Vercel deploy, one login. No iframe,
no two-deploy bridge, no rewrite.

Five phases; each ships alone and is useful alone:
1. **Shell.** New sidebar (Subcon Command header, 4 groups), Subcon Home, URL prefixes +
   redirects, Settings grouped by app, `team_members.apps` flips from login-gate to
   which-groups-show. Schedule group HIDDEN until Phase 2 — no link-outs to the old site.
   Only phase that touches existing Sales users → goes first and alone.
2. **Schedule moves in.** sch-command/src lands in sales-command (proposed `src/schedule/`),
   mounted under `/schedule/*`; teal wins token reconciliation; one session across both.
   `schmybiz.com` forwards to `scmybiz.com/schedule/…`; old Schedule deploy turned off.
3. **Field web screens.** The six locked screens + alert-threshold Settings. Net-new build.
4. **AR moves in.** Same move as Phase 2 for AR-Command-Center (small).
5. **The name.** Subcon Command login, wordmark, domain. Last — until 2–4 land the name would
   be a sign over a half-built store.
Field mobile app (offline/PowerSync) untouched throughout.

### Beat 4 — Who sees what  ← RATIFIED 2026-09-01 [LOCKED]
Ground truth: Schedule gates LOGIN on `teamMember.apps.includes('schedule')`
(`sch-command/src/App.jsx:111`); Sales lets any team member in (Admin-only `/import`).
`pages/Team.jsx` already has per-member Apps checkboxes defaulting from `tenant_config.apps`.
`/suite` → `pages/SubConCommandPage.jsx` is a marketing page still saying "Sub Con Command" /
linking salescommand.app → Phase 5 rename list.

Three layers, all in existing data, one login:
1. **Company** — `tenant_config.apps`: which Commands the company has. Missing → group never
   appears for anyone.
2. **Person** — `team_members.apps`: which of those this person is assigned. Unchecked → group
   absent from sidebar AND quadrant absent from Subcon Home. Same Team page checkboxes, no
   new UI. Flips from login-gate to groups-shown.
3. **Role** — Admin / Manager / other: what you can DO inside a group. Unchanged from today
   (Sales role uploads docs; Admin/Manager configure money; Manager/Admin only writers on
   Field screens).

Guard rule: hiding a group ≠ security. A direct URL into an unassigned group (`/schedule/…`)
renders "Not authorized" — route guard, not just a missing menu item (CLAUDE.md "hiding in UI
is not guarding the save" applied to routes).

### Beat 5 — Design tokens  ← RATIFIED 2026-09-01 [LOCKED]
Ground truth: same palette DNA (linen #b5a896 / card #c8bcaa / deep #a89b88 / dark #1c1814,
Barlow + Barlow Condensed). Different plumbing: Sales = inline styles from `src/lib/tokens.js`;
Schedule = `src/App.css` (6,648 lines) + `index.css` with `:root` CSS variables + class names.
Schedule accent = Command Green `#5BBD3F` (`--command-green`, `--neon`; ~20 uses) while teal
`#30cfac` (`--teal`) already has ~88 uses. Schedule has its own job-status colors (`--pw`
purple, `--blu`, `--orn`, `--ylw`, `--grn`, `--cyan`, `--red`).

1. **Don't restyle Schedule in the merge.** `App.css` comes along as-is, FENCED to the
   `/schedule` subtree (wrapper class / scoped selectors) so class names can't leak either way.
   This is what makes Phase 2 "moves in as-is" true.
2. **Colors defined once.** Schedule's `:root` variables (`--bg`, `--bg-card`, `--bg-deep`,
   `--header-dark`, `--text-*`, `--teal`, fonts) get their VALUES from `tokens.js` at startup.
   One source; no drifting twin ([[feedback_extend_canonical_not_twin]]).
3. **Teal wins.** `--command-green` / `--neon` → `#30cfac`, black text on teal buttons
   (brand rule). ~20 spots, mechanical.
4. **Schedule's status colors stay Schedule's.** They carry meaning (PW purple, stage colors),
   not brand. Untouched.
5. **Full polish to the pay-app standard is a SEPARATE later UI pass**, not this migration
   ([[feedback_sc_pop_color_teal]] — global swap = deferred polish).

### Beat 6 — Data layer / plumbing  ← RATIFIED 2026-09-01 [LOCKED]
Ground truth: both read `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; each has its own
`lib/supabase.js`, `lib/auth.js`, and a logged-in context (Sales: `App.jsx` teamMember state +
`TenantConfigContext.jsx`; Schedule: `lib/user.jsx`). Schedule's data layer =
`lib/queries.js` (1,647 lines, 60 exports); Sales = scattered fetches + `supabaseHelpers.fetchAll()`.
Both handle the 1000-row cap. Schedule uses realtime channels (`views/Jobs.jsx`, `views/Home.jsx`)
+ `lib/sync.jsx`.

1. **One client, one login, one "who am I" — the host's (Sales).** Schedule's `supabase.js`,
   `auth.js`, `user.jsx` deleted; its imports repointed. That is the ONLY edit inside Schedule's
   code in Phase 2.
2. **`queries.js` stays whole.** Not scattered to match Sales. (Sales drifting toward it is a
   later, separate idea.)
3. **Realtime keeps working** (same client/DB). Check: channel names can't collide once both
   subtrees share a page.
4. **Ownership unchanged.** Who writes which table is still the shared-data contract
   (`sch-command/docs/plans/command_suite_shared_data_contract.md`). Merging repos merges
   code, not responsibilities.
5. **Post-Phase-2 audit:** grep the combined app for unpaginated fetches, sweep 3× incl.
   Promise.all-wrapped ([[feedback_audit_pagination]]).

### Beat 7 — Field boundary  ← RATIFIED 2026-09-01 [LOCKED]
Ground truth: Field mobile talks to exactly three things — Supabase directly (PowerSync +
`upload-photo` edge fn), PowerSync cloud, open-meteo. It never calls a Sales/Schedule web URL.
Schedule's reads of Field-written tables (`daily_production_reports` ×4, `daily_log_entries`,
`job_material_checks`, `job_crew`) are plain table reads that move with Schedule's code.
- **Zero phone changes in Phases 1, 2, 4, 5.**
- **Phase 3 exception:** alert thresholds in `tenant_config` → phone must READ them, and
  `tenant_config` is NOT in `powersync-sync-rules.yaml` today (9 tables). Phase 3 = one
  sync-rule addition + one small phone release. Missing setting → phone keeps hardcoded
  15 min / 4 hr; never a crash.

### Beat 8 — Name + addresses  ← RATIFIED 2026-09-01 [LOCKED]
Ground truth: prod = `scmybiz.com` (Vercel `sales-command`) + `schmybiz.com` (Vercel
`sch-command`). ~25 hardcoded URL refs in code: `salescommand.app` ×17, `schedulecommand.com`
×3, `sccmybiz.com` ×1, `schmybiz.com` ×2, `scmybiz.com` ×5 (incl. edge fns / email links).
- **Schedule Command has ONE user — Chris. It has never been live to anyone else.** So no
  forwarding, no pause period, no protections: **Phase 2 turns the `sch-command` Vercel deploy
  OFF once the merged `/schedule/*` is verified.** Old Schedule domains point at the umbrella
  in Phase 5 or are dropped.
- **Phase 5:** pick umbrella domain (check `subconcommand.com`); old domains → umbrella;
  sweep the ~25 hardcoded links (edge fns included); rewrite `/suite`
  (`SubConCommandPage.jsx`, still says "Sub Con Command"); login wordmark. Customer token
  links (`/sign/:token`, `/invoice/:token`) never move, so old emails keep working.

## 4. IDEATE CLOSED 2026-09-01 — next step

All 8 beats ratified by Chris. This doc is the INPUT to the plan pass, not the plan.

**Next:** a **plan** session (opus 4.8 / xhigh) that turns Beats 1–8 into
`docs/plans/schedule_into_sales_merge_PLAN.md` (or grows this file) with, per Phase:
concrete file moves, route table, redirect table, Settings section map, the `tenant_config`
migration for Field thresholds (authored in command-suite-db), a **layout section** per
[[feedback_ui_first_class]], and an `## Audit manifest` for `/runaudit`. Phase 1 (shell) is
the first build target; it must be verified alone before Phase 2 starts.

Mockup to build Phase 1 against: https://claude.ai/code/artifact/9349053f-3378-4089-8582-203fa46d554e
