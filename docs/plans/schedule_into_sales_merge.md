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

## 3. Open ideate beats [DESIGN-OPEN]

### Beat 1 — What does the merged top-level navigation feel like?  ← ASKED, NOT ANSWERED
Two real forks:

- **A — One unified sidebar; sections are groups.** No mode switch. Sales group (Proposals,
  Customers, Invoices…) + Schedule group (Calendar, Daily, Materials, Budget…), collapsible.
  Job detail is one screen showing sales + schedule facts. Harder build; this is the reason for
  the one-app pivot (dissolve the seam).
- **B — Section switcher; each section keeps its own nav.** Closer to today, easier port, keeps
  the seam. Re-creates four apps behind one login.
- Possible middle: unified nav, but a job's schedule views still live under the job.

Claude's lean: A. **Chris's answer: pending.**

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
