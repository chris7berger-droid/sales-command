# Handoff — 2026-05-05

## Current Branch
`feature/pay-app-workflow-fixes` — created but no commits yet. All discovery work should stay here until tested on Vercel preview deploy.

## What Shipped to Main Today
1. **Billing schedule moved from ProposalDetail to InvoiceDetail** — proposals stay clean, billing management lives on invoices now
2. **Pay app flow from "+ New Invoice"** — detects billing schedule on proposal, routes to NewPayAppModal instead of regular invoice wizard. "Pay App" badge on proposal picker.
3. **Delete pay app** — red button on draft pay apps with warning that linked invoice will also be deleted
4. **Editable SOV line percentages** — "This App %" column is an input when pay app is draft, read-only when sent/paid. Save Changes button persists to pay_app_lines, pay_apps totals, and linked invoice amount.
5. **Customer `requires_pay_app` flag** — boolean on customers table, toggle in New Inquiry wizard (step 5) and Customer edit modal. Pre-fills from existing customer. Shows "Pay App Required" badge on customer detail.
6. **Auto-create billing schedule on proposal lock** — when all WTCs are locked and customer has `requires_pay_app=true`, auto-creates billing_schedule + lines from WTCs.
7. **View Contract link on PayAppDetailModal** — fetches contract_pdf_urls from billing_schedule, shows teal link(s) in header.
8. **Invoice ID generator fix** — uses median-based clustering to ignore manually-renumbered outliers (90360/90361). Next invoice will be 10024.
9. **Login email remembered** — stores last email in localStorage, prefills on next visit.
10. **Send-invoice edge function fix** — resolves billing email from customer_contacts (Billing Contact role) first, matching frontend resolution order. Already deployed to prod.
11. **Invoice PDF sender fix** — uses logged-in teamMember email/phone instead of sales rep lookup.
12. **Pay app template PDF fetch fix** — uses supabase.storage.download() with auth instead of public URL fetch that was returning HTML.

## Migration Applied
- `20260505120000_customers_requires_pay_app.sql` — adds `requires_pay_app boolean NOT NULL DEFAULT false` to customers table. Already applied to prod.

## Open Issues (Next Session)

### P0: Pay App Delete Cascade
When deleting a pay app, the billing schedule stays locked and a ghost invoice reference remains. Delete should:
- Delete the linked invoice (or at minimum reset it)
- Reset billing schedule status if no other pay apps exist
- Chris hit this on the AGRU job (6458) today

### P0: Push to Main Discipline
We pushed discovery work (contract view link, invoice ID fix) straight to main. Must use feature branches + Vercel preview deploys for anything experimental. Only merge to main after testing on preview.

### P1: Billing Schedule Setup Flow
The auto-create on proposal lock is new and untested end-to-end. Need to:
- Test with a new customer flagged as `requires_pay_app`
- Verify the billing schedule + lines are created correctly from WTCs
- Verify the invoice flow routes to pay app automatically

### P1: Existing Pay App Customers
Chris needs to go into existing customers (like AGRU) and flip `requires_pay_app` on. The flag only drives future behavior — existing billing schedules are unaffected.

### P2: Invoice Numbering Settings
Settings page still needs invoice numbering configuration (mentioned in earlier session). Currently hardcoded to 5-digit zero-padded starting from 10000.

## File Reference
- `src/pages/Invoices.jsx` — invoice list + detail + new invoice modal + billing schedule render
- `src/components/NewPayAppModal.jsx` — pay app creation flow
- `src/components/PayAppDetailModal.jsx` — pay app detail/edit/send
- `src/components/BillingScheduleSection.jsx` — SOV management (now rendered inside InvoiceDetail)
- `src/components/ProposalDetail.jsx` — auto-create billing schedule on lock
- `src/components/NewInquiryWizard.jsx` — requires_pay_app toggle (step 5)
- `src/pages/Customers.jsx` — requires_pay_app toggle in edit modal + badge in detail
- `supabase/functions/send-invoice/index.ts` — billing email resolution fix (deployed)

## Git State
- `main` is deployed to prod with all 12 items above
- `feature/pay-app-workflow-fixes` is the active branch for next session (no commits yet)
- `feature/billing-schedule-to-invoices` was merged to main and can be cleaned up
