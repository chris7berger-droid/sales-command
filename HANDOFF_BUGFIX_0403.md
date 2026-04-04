# Bug Fix Session — Handoff Doc

**Date:** 2026-04-03
**Session:** Bug hunting + invoice improvements

---

## What Was Fixed

### Bugs Fixed
- **Pill import missing** in ProposalDetail — crashed Proposals page
- **`teamMember is not defined`** in invoice send — used `repContact.email` instead
- **Invoice list empty** — `invoices.proposal_id` was uuid but `proposals.id` is text; fixed column type + added FK constraint
- **Orphaned invoice_lines** — deleted stale invoice 10000 + lines that showed 100% billed
- **`stripe_checkout_id` not saved** — payment webhook couldn't match invoices; now saved on send
- **Proposal signing page blank for customers** — `proposals` table was missing anon RLS policies; customers (unauthenticated) couldn't read proposal data. Added anon SELECT + UPDATE policies on `proposals` and anon UPDATE on `call_log`
- **`STAGES is not defined` crash in New Inquiry wizard** — when NewInquiryWizard.jsx was extracted from CallLog.jsx in the v52 refactor, the `STAGES` import was not carried over. Added `import { STAGES } from "../lib/mockData"` to fix

### Features Added
- **Editable Job Number** in CallLogDetail (Job Info section)
- **Save/Cancel buttons in header** bar (visible without scrolling)
- **Show cents toggle** (`show_cents` on call_log) for legacy jobs — affects ProposalDetail, ProposalPDFModal, PublicSigningPage, Invoices, InvoicePDFModal
- **Default intro text** on proposals (auto-fills from tenant config)
- **Invoice description** field in creation modal with default text, shown on invoice PDF
- **Sales rep email/phone** on invoice PDF header + footer (was hardcoded to estimates@hdspnv.com)
- **Jobsite address** on invoice PDF (Bill To section, matching proposal layout)
- **Customer/Business Address section** in CallLogDetail for editing
- **"Same as customer/business address" checkbox** for jobsite in New Inquiry wizard
- **"Customer Address" label** for Residential customers (was always "Business Address")
- **Sender notification email** when invoice is sent (matches proposal pattern)
- **Fixed webhook `from` email** — payment receipts now sent from rep's email

### DB Changes (applied directly, not in migrations)
- `ALTER TABLE call_log ADD COLUMN show_cents boolean DEFAULT false`
- `ALTER TABLE invoices ALTER COLUMN proposal_id TYPE text`
- `ALTER TABLE invoices ADD CONSTRAINT invoices_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES proposals(id)`
- `CREATE POLICY "anon: signing page read" ON proposals FOR SELECT TO anon USING (signing_token IS NOT NULL)`
- `CREATE POLICY "anon: signing page update" ON proposals FOR UPDATE TO anon USING/WITH CHECK (signing_token IS NOT NULL)`
- `CREATE POLICY "anon: signing page update" ON call_log FOR UPDATE TO anon USING (EXISTS (SELECT 1 FROM proposals WHERE proposals.call_log_id = call_log.id AND proposals.signing_token IS NOT NULL))`

### Edge Functions Deployed
- `send-invoice` — added sender notification email
- `stripe-webhook` — fixed `from` email to use rep's email

### Files Modified
- `src/lib/utils.js` — added `fmt$c`
- `src/lib/config.js` — added default_proposal_intro, default_invoice_description
- `src/components/CallLogDetail.jsx` — job number field, show_cents toggle, save/cancel in header, customer address section
- `src/components/ProposalDetail.jsx` — auto-fill intro, Pill import, show_cents support
- `src/components/ProposalPDFModal.jsx` — show_cents support
- `src/components/NewInquiryWizard.jsx` — jobsite same-as checkbox, residential label
- `src/pages/Proposals.jsx` — show_cents in call_log select
- `src/pages/Invoices.jsx` — show_cents, description field, rep contact, jobsite address, invoice PDF styling
- `src/pages/PublicSigningPage.jsx` — show_cents support
- `supabase/functions/send-invoice/index.ts` — sender notification
- `supabase/functions/stripe-webhook/index.ts` — rep email as from address

---

## Known Items
- Invoice "opened" tracking not implemented (no customer-facing invoice view page exists; Stripe handles payment)
- `tenant_config` still has `estimates@hdspnv.com` as company email — update via Settings page if needed
- Default intro/description text can be customized in `tenant_config` columns: `default_proposal_intro`, `default_invoice_description`
