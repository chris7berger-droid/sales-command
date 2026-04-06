# Sales Command — Session Rules

These rules MUST be followed every session. They exist because past sessions
broke things by guessing column names, using wrong calculation methods, or
drifting on styling. Read them before writing any code.

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
  status, created_at, customer, intro_completed, attachments_added,
  recipients_assigned, wtc_verified, call_log_id, proposal_number,
  signing_token

call_log: id, display_job_number, stage, bid_due, follow_up, created_at
  (NOT date), jobsite_address, customer_name, sales_name, job_number,
  job_name, is_change_order (NOT job_type), parent_job_id, co_number,
  co_standalone, jobsite_city, jobsite_state, jobsite_zip,
  billing_address, billing_city, billing_state, billing_zip,
  billing_address_same, customer_id

customers: id, name, customer_type, first_name, last_name, phone, email,
  contact_phone, contact_email, billing_same, billing_name, billing_phone,
  billing_email, billing_terms (integer, default 30), business_address,
  business_city, business_state, business_zip

customer_contacts: id (uuid), customer_id (uuid FK customers, ON DELETE CASCADE),
  name (text), phone (text), email (text), role (text — "Project Manager",
  "Office Manager", or "Billing Contact"), is_primary (bool, default false),
  created_at (timestamptz)

proposal_wtc: id, proposal_id, work_type_id (INTEGER 1-40), burden_rate,
  ot_burden_rate, tax_rate, prevailing_wage, regular_hours, ot_hours,
  markup_pct, materials (jsonb), size, unit, sales_sow, field_sow (jsonb),
  sub_areas (jsonb), travel (jsonb), discount, discount_reason, locked,
  created_at, start_date (date), end_date (date)

work_types: id, name, cost_code
proposal_signatures: id, proposal_id, signer_name, signer_email, signed_at,
  ip_address, pdf_url
invoices: id (text), job_id, job_name, status, amount, discount, sent_at,
  due_date, proposal_id (int8 FK proposals), qb_invoice_id (text),
  qb_payment_id (text), stripe_checkout_id (text), stripe_checkout_url (text),
  stripe_payment_id (text), paid_at (timestamptz), description (text),
  viewing_token (uuid, default gen_random_uuid())

invoice_lines: id (int8), invoice_id (text FK invoices), proposal_wtc_id
  (uuid FK proposal_wtc), billing_pct (numeric), amount (numeric),
  created_at (timestamptz)

job_work_types: id, call_log_id, work_type_id

proposal_recipients: id (uuid), proposal_id (text FK proposals ON DELETE CASCADE),
  contact_name (text), contact_email (text),
  role (text — 'signer' | 'viewer'), sent_at (timestamptz),
  viewed_at (timestamptz), created_at (timestamptz)

proposals: ... intro (text) — introduction text shown above SOW

customers: ... qb_customer_id (text) — QB parent customer ID
call_log: ... qb_customer_id (text) — QB sub-customer (job) ID

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
