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

## §2 Proposed change [TODO — DESIGN-OPEN]
Open design questions to resolve before planning (this is what /detach is capturing for later):

**Intake / channels**
- Twilio: what exactly comes in — missed-call → SMS auto-reply? inbound SMS? a tracking number per campaign? Do we need call recording/voicemail transcription?
- Facebook Lead Ads: pull via Facebook Lead Ads webhook / Graph API, or via a Zapier/Make bridge, or CSV?
- Google Ads: Lead Form extensions (webhook) vs. landing-page form vs. call-only ads (routes back through Twilio)?

**Data model**
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
