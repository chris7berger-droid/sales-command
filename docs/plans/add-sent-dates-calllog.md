# Plan — Add Sent Dates to Proposals + Invoices on Call Log Detail

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature   <!-- feature | bug -->

**Status:** PARKED (scaffolded 2026-08-20) — not yet planned.

---

## §0 Baseline (observed current state) [TODO — verify before planning]
<!-- Feature: what exists today, with file:line / query evidence; mark read-verified vs run-verified. -->

- Display-only change. **No migration needed** — sent dates are already stored:
  - `invoices.sent_at` (a `date` column; see src/lib/utils.js:25, src/pages/Invoices.jsx)
  - `proposals.sent_at` (see src/components/ProposalDetail.jsx:1336)
- Target screen: `src/components/CallLogDetail.jsx` — the proposals + invoices sections at the bottom of the job detail screen.
- Invoices query at CallLogDetail.jsx:227 already `.order("sent_at", ...)` but does **not** select `sent_at`. [DERIVED — verify]
- Need to confirm the proposals query on the same screen selects/exposes `sent_at`. [TODO]

## §1 Problem / intent [LOCKED]
On the call log (job) detail screen, the proposals and invoices lists at the bottom should show each item's sent date.

## §2 Proposed change [TODO]
- Add `sent_at` to the CallLogDetail invoices SELECT; render "Sent {date}" on each invoice row.
- Same for proposals rows.
- Use existing `fmtD` / wall-clock date helpers — `sent_at` is a `date` column, do NOT `toISOString()` it ([[feedback-date-columns-wall-clock]]).

## §3 Files to touch [TODO]
- `src/components/CallLogDetail.jsx` (likely the only file).

## §4 Out of scope / deferred [TODO]
- No changes to how/when `sent_at` is written.
- No changes to other screens.

## §5 Estimate / time budget [TODO]
- Fix-sized: single-file display edit. ~20–30 min.
