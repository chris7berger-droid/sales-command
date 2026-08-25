# Integration Spec — Send Leads to Sales Command

**For:** the marketing company's engineering (Claude Code) terminal
**From:** Sales Command
**Status:** contract is fixed. Build your sender to match it exactly.

You (the marketing side) run a bot on Twilio that handles Facebook / Google / Twilio ad leads.
Sales Command needs each lead pushed to us as it happens. This doc is the whole contract — you do
not need any knowledge of how Sales Command works internally. When a lead is captured, POST it to
our endpoint per below.

---

## What you build

A single outbound call: **for every new lead your bot captures, send one HTTP POST** to our
endpoint. That's it. No polling, no read access needed on your side, no shared database.

- **Endpoint (Sales Command will give you the final URL):**
  `POST https://<sales-command-supabase>.functions.supabase.co/leads-intake`
- **Auth:** send header `X-Leads-Secret: <secret>` on every request. Sales Command will give you
  the secret out-of-band (not in this file, not in code you commit). Store it as an env var /
  secret on your side.
- **Header:** `Content-Type: application/json`

## Request body

```json
{
  "lead_id": "abc-123",
  "channel": "facebook",
  "received_at": "2026-08-25T14:03:00Z",
  "name": "Jane Contractor",
  "phone": "+15551234567",
  "email": "jane@example.com",
  "campaign": "fb-spring-reroof",
  "ad_id": "1200456789",
  "message": "Need a quote on a 20-square reroof",
  "raw": { "your": "original payload here" }
}
```

### Field rules

| Field | Required | Notes |
|---|---|---|
| `lead_id` | **YES** | A **stable, unique id from YOUR side.** This is the dedupe key — see below. Never reuse it for a different lead, never change it once assigned. |
| `channel` | **YES** | One of: `"facebook"`, `"google"`, `"twilio"`, `"other"`. |
| `received_at` | **YES** | ISO-8601, **UTC** (`...Z`). When your bot captured the lead. |
| `name` | best-effort | Send if you have it. |
| `phone` | best-effort | **E.164** format preferred (`+1...`). |
| `email` | best-effort | |
| `campaign` | best-effort | Campaign name/id — used for ROI reporting later. |
| `ad_id` | best-effort | Platform ad id — used for ROI reporting later. |
| `message` | best-effort | The lead's message / conversation text. Can be long. |
| `raw` | optional | Your full original payload as a JSON object. This is a safety net so Sales Command can recover a field nobody modeled without asking you to re-integrate. Send it if it's cheap. |

**Send partial leads.** A lead with only a phone number is still a lead — send what you have as
long as the three required fields are present.

## Dedupe / retry behavior (important)

Sales Command upserts on `lead_id`. This means **you can safely retry.** If a POST fails or times
out, send it again with the **same `lead_id`** — it will not create a duplicate.

## Responses you'll get back

| Status | Body | What it means / what you do |
|---|---|---|
| `200` | `{"ok":true,"deduped":false}` | Stored. New lead. |
| `200` | `{"ok":true,"deduped":true}` | We already had this `lead_id`. No-op. (A retry landed.) |
| `400` | `{"ok":false,"error":"..."}` | Bad payload (e.g. missing required field). **Do not retry** — fix and resend. |
| `401` | — | Bad/missing `X-Leads-Secret`. Check your secret. |
| `5xx` | — | Our fault. **Retry with backoff** (this is why `lead_id` dedupe exists). |

## Acceptance test (do this before we call it done)

1. Sales Command gives you the URL + secret.
2. Send one test lead with a `lead_id` like `"test-001"` → expect `200 deduped:false`.
3. Send the **exact same** payload again → expect `200 deduped:true` (proves dedupe works).
4. Send with a wrong/blank secret → expect `401` (proves auth works).
5. Send missing `channel` → expect `400` (proves validation works).

When all five behave as above, the integration is live.

---

**Open item for the marketing side to answer back to Sales Command:** what's your natural
`lead_id`? (Twilio message SID? Facebook lead id? your own row id?) Anything stable and unique is
fine — we just need to know it won't change on a retry.
