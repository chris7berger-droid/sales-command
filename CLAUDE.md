# Sales Command — Session Rules

These rules MUST be followed every session. They exist because past sessions
broke things by guessing column names, using wrong calculation methods, or
drifting on styling. Read them before writing any code.

---

## Session Start

**Before doing anything else in a Sales Command session, read `docs/BACKLOG.md`.**
That file is the single source of truth for outstanding work — security findings,
bugs, features, cleanup. Do not propose work, recommend priorities, or claim
something is "still open" or "already done" without checking it first.

When you finish, defer, or discover an item, **update `docs/BACKLOG.md` in the
same session.** Stale memory has caused duplicate work and surprises — the file
is the cure.

After reading `docs/BACKLOG.md`, **read the most recent `docs/handoffs/SC_Handoff_v*.txt`** for the prior session's context (decisions made, items deferred, next-session pointers). The handoff is reference, not dictation — use it to orient, then defer to the current state of the code and BACKLOG.

When wrapping up a session, **write a new `docs/handoffs/SC_Handoff_v<N+1>.txt`** following the structure of recent handoffs (Session Summary → Changes Shipped → Decisions → New/Closed Backlog Items → Verification → Not Touched → Next Session Pointers → Files To Know → Git State).

---

## Backlog hygiene

Before starting any task, read `docs/BACKLOG.md` and check whether the work touches an open row. Before committing, if the change closes or alters a backlog item, update that row in the same commit (mark Closed with the commit SHA, or revise scope/status).

---

## Commit message convention for backlog items

When a commit closes or touches a backlog row, reference its ID in the subject line:
- `Closes B8: fix line-item tax rounding in pay app totals`
- `Touches F7: scaffold tenant table (does not close)`

Use `Closes <ID>` only when the row is being marked Closed in the same commit. Use `Touches <ID>` for partial progress.

---

## Backlog report format

When asked for a "backlog report" (or similar), render `docs/BACKLOG.md` as:

1. **Key/legend** at top — tier definitions + score format.
2. **Grouped by Tier** (T0 → T4), Open and In Progress only; skip Completed Log unless asked.
3. **Each row a bullet**: `**ID** [scores] — one-sentence description (Blocks/Blocked by, if any).`
4. **Inline scores only for T1 and T2.** T3 and T4 get a single pass-through line listing IDs (scores omitted to keep the report scannable).
5. **End** with one-line totals: "Open: X, In Progress: Y."

### Scoring vocabulary

For **bugs and security findings** — render as `[Sev N · Like N · Eff X]`:

- **Severity (1–10)** — if this bites, how bad?
  - 1–2 cosmetic · 3–4 minor UX irritation, internal-only · 5–6 customer-visible UX bug · 7–8 revenue-affecting (failed invoice, broken QB sync, missed billing) · 9 data loss / leaked credentials · 10 cross-tenant data exposure or full prod down.
- **Likelihood (1–10)** — how likely to bite this quarter, given current state?
  - 1–2 latent / multi-step preconditions · 3–4 rare edge case with workaround · 5–6 occasional / intermittent · 7–8 frequent in normal use · 9–10 every time / blocking.
- **Effort** — 1h · half-day · day · multi-day · sprint.

For **features and refactor** — render as `[Lev N · Eff X]`:

- **Leverage (1–10)** — strategic value of shipping.
  - 1–2 pure cleanup, no downstream effect · 3–4 unblocks one feature/use case · 5–6 improves a regularly-used flow · 7–8 unblocks revenue or major feature · 9–10 unlocks growth / new product.
- **Effort** — same scale as above.

**Composites (optional, only when asked)**: Risk = Severity × Likelihood (bug ranking). ROI = Leverage / Effort (feature ranking). Tier (T0–T4) is the final human-judged call — informed by, but not mechanically derived from, the scores.

---

## Style Rules

1. **No white backgrounds** in the internal app. Use `C.linen`, `C.linenCard`,
   `C.linenDeep`, or `C.linenLight`. White is only allowed in PDF content and
   print stylesheets.
2. **Teal buttons get black text** (`C.dark` / `#1c1814`), never white.
3. **Dollar badges on cards**: `C.dark` background with `C.teal` text,
   `borderRadius: 6`, `padding: "3px 10px"`. Not full-card dark backgrounds.
4. **Selected tags/pills**: `C.dark` background, `C.teal` border and text.
5. **Inputs**: use `C.linenDeep` background + `WebkitAppearance: "none"`.
   Never white. Global CSS in `tokens.js` handles autofill override.
6. **Import colors from `src/lib/tokens.js`**. Never define a local `C` object
   in a component. `Login.jsx` extends `_C` with aliases — that's the only
   exception.

## Data Integrity Rules

1. **`fmt$` must use `maximumFractionDigits: 0`**. Never show sub-cent decimals.
2. **Proposal summary total** must be computed from live WTC data using
   `calcWtcPrice()`, not from `proposals.total` (which can be stale).
3. **WTC material calculations** must use `calcMaterialRow()` everywhere —
   including in `handleSave()`. This function correctly uses `item.tax`
   (not `item.tax_rate`), includes freight, and applies markup.
4. **`handleLock()` must update `proposals.total`** in addition to toggling
   the locked flag.
5. When fetching `proposal_wtc` for display, always join `work_types(name)`
   and include financial fields: `regular_hours, ot_hours, burden_rate,
   ot_burden_rate, markup_pct, materials, travel, discount, size`.

## Supabase Column Reference (verified — do not guess)

```
team_members: id, name (NOT full_name), email, phone, role, auth_id, active

proposals: id, total (NOT total_price), approved_at (NOT accepted_at),
  status, created_at, updated_at (timestamptz, auto-trigger),
  deleted_at (timestamptz, NULL = active), customer, intro_completed,
  attachments_added, recipients_assigned, wtc_verified, call_log_id,
  proposal_number, signing_token, tenant_id (uuid FK tenant_config)

call_log: id, display_job_number, stage, bid_due, follow_up, created_at
  (NOT date), updated_at (timestamptz, auto-trigger),
  jobsite_address, customer_name, sales_name, job_number,
  job_name, is_change_order (NOT job_type), parent_job_id, co_number,
  co_standalone, jobsite_city, jobsite_state, jobsite_zip,
  billing_address, billing_city, billing_state, billing_zip,
  billing_address_same, customer_id, tenant_id (uuid FK tenant_config)

customers: id, name, customer_type, first_name, last_name, phone, email,
  contact_phone, contact_email, billing_same, billing_name, billing_phone,
  billing_email, billing_terms (integer, default 30), business_address,
  business_city, business_state, business_zip, updated_at (timestamptz,
  auto-trigger), tenant_id (uuid FK tenant_config)

customer_contacts: id (uuid), customer_id (uuid FK customers, ON DELETE CASCADE),
  name (text), phone (text), email (text), role (text — "Project Manager",
  "Office Manager", or "Billing Contact"), is_primary (bool, default false),
  created_at (timestamptz)

proposal_wtc: id, proposal_id, work_type_id (INTEGER 1-40), burden_rate,
  ot_burden_rate, tax_rate, prevailing_wage, regular_hours, ot_hours,
  markup_pct, materials (jsonb), size, unit, sales_sow, field_sow (jsonb),
  sub_areas (jsonb), travel (jsonb), discount, discount_reason, locked,
  created_at, updated_at (timestamptz, auto-trigger),
  start_date (date), end_date (date)

work_types: id, name, cost_code
proposal_signatures: id, proposal_id, signer_name, signer_email, signed_at,
  ip_address, pdf_url
invoices: id (text), job_id, job_name, status, amount, discount, sent_at,
  due_date, proposal_id (text FK proposals), qb_invoice_id (text),
  qb_payment_id (text), stripe_checkout_id (text), stripe_checkout_url (text),
  stripe_payment_id (text), paid_at (timestamptz), description (text),
  viewing_token (uuid, default gen_random_uuid()),
  updated_at (timestamptz, auto-trigger),
  deleted_at (timestamptz, NULL = active),
  tenant_id (uuid FK tenant_config)

invoice_lines: id (int8), invoice_id (text FK invoices), proposal_wtc_id
  (uuid FK proposal_wtc), billing_pct (numeric), amount (numeric),
  created_at (timestamptz)

job_work_types: id, call_log_id, work_type_id

proposal_recipients: id (uuid), proposal_id (text FK proposals ON DELETE CASCADE),
  contact_name (text), contact_email (text), phone (text),
  role (text — 'signer' | 'viewer'), sent_at (timestamptz),
  viewed_at (timestamptz), created_at (timestamptz),
  customer_contact_id (uuid FK customer_contacts ON DELETE SET NULL)
  — Recipients section on ProposalDetail renders this table, NOT
  customer_contacts. Delete here removes recipient only. "Save to
  Customer" button on orphan rows (null customer_contact_id) backfills
  into customer_contacts. Only one row per proposal can have
  role='signer' (enforced in UI, not DB).

proposals: ... intro (text) — introduction text shown above SOW

customers: ... qb_customer_id (text) — QB parent customer ID
call_log: ... qb_customer_id (text) — QB sub-customer (job) ID

tenant_config: id (uuid), company_name, tagline, logo_url, license_number,
  phone, email, website, address, city, state, zip,
  default_burden_rate (numeric), default_ot_burden_rate (numeric),
  default_tax_rate (numeric), default_billing_terms (int, default 30),
  proposal_validity_days (int, default 90), default_proposal_intro (text),
  default_invoice_description (text), monthly_billing_goal (numeric),
  yearly_billing_goal (numeric), conversion_rate_goal (numeric),
  proposals_sent_goal (int), apps (text[]),
  stripe_customer_id (text), stripe_subscription_id (text),
  subscription_status (text), subscription_started_at (timestamptz)

qb_connection: id (uuid), realm_id (text), access_token (text),
  refresh_token (text), token_expires_at (timestamptz),
  created_at (timestamptz), updated_at (timestamptz)
```

## Supabase RLS

- `call_log` and `job_work_types` have DELETE policies for authenticated users.
- When deleting parent rows, always delete FK children first (e.g.,
  `job_work_types` before `call_log`).
- After any delete, verify it succeeded — RLS can silently no-op.

## Supabase Storage

- Bucket `job-attachments`: sanitize filenames before upload
  (`file.name.replace(/[^a-zA-Z0-9._-]/g, "_")`). Spaces cause 400 errors.
- Bucket `signed-proposals`: public, files named
  `signed-proposal-{proposal_id}-{timestamp}.pdf`.

## File Upload / Filename Rules

Always sanitize filenames before uploading to any Supabase storage bucket.
This applies to both the CallLog wizard upload and CallLogDetail upload.

## Workflow Rules

1. Always grep before edits
2. One step at a time
3. Never give half-baked solutions mid-figuring-it-out
4. Git commit after every completed task
5. Ask for screenshot before assuming error cause
6. `git push` + handoff doc at session end

## Key File Locations

### Pages (list views only — detail/modals extracted to components)
- `src/pages/WTCCalculator.jsx` — Work Type Calculator
- `src/pages/CallLog.jsx` — Call Log list page (176 lines)
- `src/pages/Proposals.jsx` — Proposals list page (181 lines)
- `src/pages/PublicSigningPage.jsx` — Customer-facing signing page
- `src/pages/Home.jsx` — Dashboard (personal, for sales reps)
- `src/pages/SalesDash.jsx` — Sales Dashboard (admin/manager view)
- `src/pages/Customers.jsx` — Customer list + detail view + edit modal
- `src/pages/Invoices.jsx` — Invoices list + detail + new invoice modal
- `src/pages/Login.jsx` — Auth login

### Extracted Components (v52 refactor)
- `src/components/NewInquiryWizard.jsx` — Full New Inquiry wizard (from CallLog)
- `src/components/ProposalDetail.jsx` — Proposal detail view (from Proposals)
- `src/components/ProposalPDFModal.jsx` — PDF preview + send flow (from Proposals)
- `src/components/NewProposalModal.jsx` — Job selection for new proposals (from Proposals)

### Shared Components
- `src/components/CallLogDetail.jsx` — Job detail/edit view
- `src/components/FilterBar.jsx` — Shared filter bar (Sales Rep, Date Range, Work Type, Customer, Job #)
- `src/components/DataTable.jsx` — Reusable table component
- `src/components/Btn.jsx` — Shared button component
- `src/components/Pill.jsx` — Status pill/badge
- `src/components/SearchSelect.jsx` — Searchable dropdown

### Libraries
- `src/lib/supabase.js` — Supabase client (uses env vars)
- `src/lib/supabaseHelpers.js` — fetchAll() for paginated queries (bypasses 1000-row limit)
- `src/lib/auth.js` — Auth helpers
- `src/lib/utils.js` — fmt$, fmtD, tod, over, inits
- `src/lib/tokens.js` — Design tokens (C, F, GLOBAL_CSS)
- `src/lib/calc.js` — WTC calculations (calcLabor, calcMaterialRow, calcTravel, calcWtcPrice)
- `src/lib/config.js` — Tenant config (getTenantConfig, DEFAULTS)
- `src/App.jsx` — Root nav + auth state

## Production

- URL: https://www.scmybiz.com
- Vercel project: sales-command (auto-deploys on push to main)
- Env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

---

## Security Rules

1. **Row Level Security (RLS) policies** — before writing or editing ANY SQL
   that touches RLS, policies, anon access, public pages, or token-gated
   reads, read `CLAUDE_RLS.md` in the repo root. It contains the rules for
   correct policy patterns, the 2026-04-26 incident anti-pattern, and the
   6-gate deploy requirements. The anti-pattern in `CLAUDE_RLS.md` is the
   most common RLS mistake — do not write policies that match it.
