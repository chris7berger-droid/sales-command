# Session Handoff — 2026-04-10
**Focus:** Proposal send bug fix + email domain migration + recipients card

---

## Bug Fixed

### Proposal send failing — "Edge Function returned a non-2xx status code"
- **Root cause:** The `from` field in the Resend API call used the rep's email (`sales@hdspnv.com`) directly. While `hdspnv.com` is verified in Resend, the real fix was to standardize all outbound email to use the verified `salescommand.app` domain.
- **Fix:** `from` now uses `"Rep Name <noreply@salescommand.app>"` with `reply_to` set to the rep's actual email so customer replies go to the right person.
- **Secondary issue:** Customer email had a typo (`cody@hollandwaterproofing,com` — comma instead of dot). Added client-side email validation in ProposalPDFModal before hitting the edge function.

## Email Domain Migration

Migrated all `noreply@scmybiz.com` references to `noreply@salescommand.app` across 6 files:
- `supabase/functions/send-proposal/index.ts`
- `supabase/functions/send-invoice/index.ts`
- `supabase/functions/invite-user/index.ts`
- `supabase/functions/reset-password/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `src/pages/Invoices.jsx`

**DNS setup:** Added `salescommand.app` to Resend with DKIM, SPF, DMARC, and MX records. Domain is verified.

All 5 edge functions redeployed with `--no-verify-jwt`.

## Feature Added

### Recipients Card on Proposal Detail
- New card section in left column (below WTC section, above Summary)
- Shows primary customer contact (name + email from `customers` table)
- Shows additional contacts from `customer_contacts` table
- **Edit button on primary contact** — inline email editing, saves to `customers.email` and `customers.contact_email`
- **Edit/delete on additional contacts** — inline editing with name, email, phone, role; saves to `customer_contacts`
- **+ Add Contact** button to create new `customer_contacts` rows
- Invalid emails highlighted in red with "Invalid" tag

## Files Changed
- `src/components/ProposalDetail.jsx` — Recipients card + edit functionality
- `src/components/ProposalPDFModal.jsx` — Email validation + companyName in send body
- `src/pages/Invoices.jsx` — noreply domain update
- `supabase/functions/send-proposal/index.ts` — from/reply_to fix + domain
- `supabase/functions/send-invoice/index.ts` — domain update
- `supabase/functions/invite-user/index.ts` — domain update
- `supabase/functions/reset-password/index.ts` — domain update
- `supabase/functions/stripe-webhook/index.ts` — domain update

## Notes for Next Session
- The signing link URL is hardcoded to `salescommand.app` in ProposalPDFModal line 47 — this is correct now that the domain migration is done
- `customer_contacts` rows are only created via the inquiry wizard's "additional contacts" step or manually via the new Recipients card. The primary contact info lives on the `customers` table itself.
- Holland Waterproofing's email typo was fixed manually in the app (comma → dot)
