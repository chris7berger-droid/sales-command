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
  qb_payment_id (text), stripe_checkout_id (text), stripe_payment_id (text),
  paid_at (timestamptz), description (text)

invoice_lines: id (int8), invoice_id (text FK invoices), proposal_wtc_id
  (uuid FK proposal_wtc), billing_pct (numeric), amount (numeric),
  created_at (timestamptz)

job_work_types: id, call_log_id, work_type_id

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

- `src/pages/WTCCalculator.jsx` — Work Type Calculator
- `src/pages/CallLog.jsx` — Call Log list + New Inquiry wizard
- `src/pages/Proposals.jsx` — Proposals list + ProposalDetail + ProposalPDFModal
- `src/pages/PublicSigningPage.jsx` — Customer-facing signing page
- `src/pages/Home.jsx` — Dashboard (personal, for sales reps)
- `src/pages/SalesDash.jsx` — Sales Dashboard (admin/manager view, salesperson picker, goal drill-down, Cash Flow Forecast, Analytics)
- `src/pages/Customers.jsx` — Customer list + detail view (jobs/proposals/invoices tabs) + edit modal
- `src/pages/Jobs.jsx` — Jobs page (unused, removed from nav but file exists)
- `src/pages/Login.jsx` — Auth login
- `src/components/CallLogDetail.jsx` — Job detail/edit view
- `src/components/Btn.jsx` — Shared button component
- `src/lib/supabase.js` — Supabase client (uses env vars)
- `src/lib/auth.js` — Auth helpers
- `src/lib/utils.js` — fmt$, fmtD, tod, over, inits
- `src/lib/tokens.js` — Design tokens (C, F, GLOBAL_CSS)
- `src/App.jsx` — Root nav + auth state

## Production

- URL: https://www.scmybiz.com
- Vercel project: sales-command (auto-deploys on push to main)
- Env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
