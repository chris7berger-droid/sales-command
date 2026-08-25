# Plan — Leads Inbox (Twilio / Facebook / Google ad leads)

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PARKED (scaffolded 2026-08-25) — not yet planned.

---

## §0 Baseline (observed current state) [TODO — verify before planning]
<!-- What exists today, with file:line / query evidence; mark read-verified vs run-verified. -->
- How the call_log table is structured today (source/origin fields? contact fields?).
- Whether there's any existing inbound/webhook edge function pattern to reuse.
- How New Inquiry → call_log creation works today (the entry path a lead would convert into).

## §1 Problem / intent [LOCKED]
Chris is starting paid lead-gen via **Twilio** (calls/SMS), **Facebook Lead Ads**, and **Google Ads**.
Need a screen in Sales Command to **capture, triage, and manage those inbound leads**, and either
(a) manage them there and/or (b) **pull them into the call log** as real inquiries.

## §2 Proposed change [LOCKED — approach]
**Intake decided: webhook push.** The marketing company (Chris's friend, greenfield on both
sides) POSTs one lead per event to a Sales Command edge function. We own the contract; their bot
fills our fields. No polling, no direct access into their Twilio account, no rebuilding their bot
logic on our side. This keeps us decoupled from their internals — the webhook is the only seam.

Backend is small: **one edge function** that (1) validates a shared secret, (2) dedupes on a
stable lead id, (3) writes a row. The screen sits on top.

### Webhook contract [LOCKED — send this to the friend]

**Endpoint:** `POST https://<supabase-project>.functions.supabase.co/leads-intake`
**Auth:** header `X-Leads-Secret: <shared secret>` — reject with 401 if missing/wrong. Secret
lives in edge-fn env, never in the client.
**Content-Type:** `application/json`

**Body:**
```json
{
  "lead_id": "abc-123",              // REQUIRED. Stable id from THEIR side. Dedupe key — a retry with
                                     //   the same lead_id must NOT create a second row (upsert on this).
  "channel": "facebook",            // REQUIRED. enum: "facebook" | "google" | "twilio" | "other"
  "received_at": "2026-08-25T14:03:00Z", // REQUIRED. ISO-8601 UTC. When THEIR bot captured the lead.
  "name": "Jane Contractor",        // contact — at least one of name/phone/email should be present
  "phone": "+15551234567",          // E.164 preferred
  "email": "jane@example.com",
  "campaign": "fb-spring-reroof",   // attribution — free text or their campaign name
  "ad_id": "1200456789",            // attribution — platform ad id, for ROI later
  "message": "Need a quote on...",  // the lead's message / conversation text (may be long)
  "raw": { }                        // OPTIONAL escape hatch: their full original payload, stored as
                                     //   jsonb. Lets us recover fields we didn't model without a
                                     //   re-integration. Never displayed raw.
}
```

**Response contract (so their side can log/retry sensibly):**
- `200 {"ok":true,"deduped":false}` — new lead stored
- `200 {"ok":true,"deduped":true}` — already had this lead_id, no-op (safe retry)
- `400 {"ok":false,"error":"..."}` — bad payload (missing required field); do NOT retry
- `401` — bad/missing secret
- `5xx` — our fault; **please retry with backoff** (this is why lead_id dedupe matters)

**Field rules of thumb for the friend:**
- Always send `lead_id`, `channel`, `received_at`. Everything else best-effort.
- Send whatever you have even if partial — a lead with only a phone number is still a lead.
- Never change the meaning of `lead_id` once assigned; it's our dedupe anchor.

### Still DESIGN-OPEN (not blocking the contract)
- New `leads` table vs. reuse/extend `call_log` with a `source` + `status` (new/contacted/qualified/junk/converted)?
- Dedupe rule (same phone/email hitting multiple channels).
- Attribution fields to keep (campaign, ad, channel, cost hooks for later ROI).

**Screen / UX**
- Standalone "Leads" inbox section vs. a filter/view on the existing call log.
- Triage actions: assign, mark junk, convert-to-inquiry (creates call_log record).
- Preserve existing call-log mental model (see memory: Job Detail Is Home).

**Boundary**
- Convert action = the bridge from lead → call_log; one-directional, no double-entry.

## §3 Files to touch [TODO]

## §4 Out of scope / deferred [TODO]
- ROI/cost-per-lead reporting (later; capture attribution fields now so it's possible).

## §5 Estimate / time budget [TODO]

---

## ⚠️ Migration flag
This feature will likely add DB migrations (new table or new call_log columns). Migrations hit the
**shared Supabase DB** — author them in `command-suite-db`, not here, and rehearse before push.
Coordinate so this doesn't collide with the migration in the currently-live fix.

---

## §6 Bolt-on structure [LOCKED — 2026-08-25]
Leads is a **paid add-on**, not part of the base product. It must NOT ship on when we sell
Sales Command to other customers.
- Switch: `tenant_config.leads_enabled boolean NOT NULL DEFAULT false`. Off for everyone until
  flipped per customer.
- Receiver (leads-intake edge fn) refuses with 403 `leads_not_enabled` unless that customer's
  flag is on — so even a correct webhook does nothing for a non-subscriber.
- Screen: only renders when the current tenant's `leads_enabled` is true.
- To bolt on for a customer: flip the flag on + set that customer's secret/tenant env on the
  receiver. (Later: can attach to a Stripe add-on price like Sales/Schedule do.)

## Build status (2026-08-25) — receiver built, NOT live
Written on branch, nothing deployed:
- `db/leads-table.draft.sql` — leads table + leads_enabled flag (DRAFT; move to command-suite-db
  + rehearse before applying to the shared DB).
- `supabase/functions/leads-intake/index.ts` — the receiver (secret check, bolt-on gate, dedupe,
  store). Not deployed.
Remaining before live: apply table via command-suite-db (rehearse first), deploy the function,
set 3 secrets (LEADS_INTAKE_SECRET, LEADS_INTAKE_TENANT_ID, + flip leads_enabled), then hand the
URL+secret to the marketing side. The inbox SCREEN is still to build (and the standalone-vs-
call-log-view decision is still open).

## §7 Where leads show up [LOCKED — 2026-08-25]
Both surfaces, stored once:
- **Dedicated Leads screen** — a place to go look at just leads (reads the leads table).
- **Inside the call log** — leads also appear in the call-log list, **tagged uniquely** as leads.
- **Stored once, shown twice:** the call log surfaces leads by pulling from the leads table and
  tagging them — it does NOT copy them into call_log as their own rows. Prevents double-entry:
  converting a lead to a real job later must not leave two entries for the same lead.
- On convert: lead becomes a single call_log inquiry, lead row marked status='converted'.
- Open sub-question for the screen build: exact visual tag + whether the call-log list is a live
  merged view (leads UNION call_log) or leads rendered as a distinct pinned band. (Build-time UX
  call, not a data-model blocker.)

## §8 Screen built (2026-08-25) — verified build, NOT live
On branch, `npm run build` passes:
- `src/pages/Leads.jsx` — Campaign Leads screen (triage, status, search, convert-to-job).
- `src/App.jsx` — nav item "Campaign Leads" + `/leads` route, gated on `leads_enabled`.
- `src/pages/CallLog.jsx` — tagged "CAMPAIGN LEADS" band above the job list (shown, not copied).
- `src/components/NewInquiryWizard.jsx` — `initialLead` prefill + returns created job so
  convert links `leads.call_log_id` (campaign origin survives → acquisition-cost tracing via
  existing tools).
Tag wording: **"Campaign Lead"** (unique, signals paid-marketing origin), per Chris 2026-08-25.

## §9 Go-live checklist (needs Chris go-ahead — touches shared DB)
1. Apply `db/leads-table.draft.sql` via **command-suite-db** (rehearse first, per standing rule);
   coordinate with the other in-flight job so migrations don't collide.
2. Deploy the edge function: `supabase functions deploy leads-intake --no-verify-jwt`.
3. Set function secrets: `LEADS_INTAKE_SECRET`, `LEADS_INTAKE_TENANT_ID` (HDSP tenant id).
4. Flip `tenant_config.leads_enabled = true` for HDSP.
5. Smoke-test the 5 acceptance cases, then hand the marketing side the URL + secret.
URL (real after step 2): https://pbgvgjjuhnpsumnowuym.supabase.co/functions/v1/leads-intake
Secret: generated 2026-08-25, shared with Chris out-of-band (NOT stored in git).
