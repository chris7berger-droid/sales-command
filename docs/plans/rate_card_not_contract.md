# F44 — Rate cards must not count as contract dollars

**Branch:** `feat/rate-card-not-contract` · **Repo:** sales-command (+ command-suite-db migration)
**Mode:** plan → build, one session · **Model:** Opus 4.8
**Backlog:** F44 (T1). Decision locked with Chris 2026-08-10: **A — a rate card is $0 of fixed value.**

## The bug

A `proposal_wtc` with `is_rate_card = true` is a T&M rate sheet (hourly rates entered as
1-hour WTCs), not committed contract work. But it flows through the same fixed-total sums as
real work types, so it inflates every "contract value" figure. On job 7215 (P7) the proposal
reads **$28,379.64** where the real contract is **$27,999.64** of material — the extra **$380**
is three rate cards ($105/$125/$150). The new Job Totals ledger now surfaces this as
**"Remaining on contract $380"** — an actionable phantom inviting someone to bill money that
does not exist.

## The decision (locked)

A rate card contributes **$0** to every fixed-dollar total and is **rendered as a rate**, not a
line price — on internal screens **and** the customer-facing proposal PDF + signing page.

## Why the fix is NOT "guard `calcWtcPrice`"

`calcWtcPrice` is a **billing primitive**, not just a display one. It computes *persisted invoice
amounts*: percent lines (`Invoices:280` = `calcWtcPrice × pct`), SOV values (`:151/159`),
save-time recomputes (`:2093`). Making it return 0 for rate cards is the exact
`calcWtcPrice → 0` mechanism that silently zeroed archive invoices (`14000c5`) and pay-app
invoices (`33c385e`) — CLAUDE.md Data Integrity Rule #6. **The primitive is not touched.**

Safe because: T&M never bills through those primitives. It bills via day-rows / `storedAmt`,
and the billing sites already branch `isTM`/`is_rate_card` away from `calcWtcPrice`
(`Invoices:2688`, `:1213`, `invoicePdf:289`).

## Site classification (verified 2026-08-10)

### FIX — fixed-total sums, exclude `is_rate_card`
| Site | Role | Change |
|---|---|---|
| `calc.js:186` `calcProposalTotal` | shared total primitive (1 caller today) | filter out `is_rate_card`; becomes the canonical contract-value fn |
| `ProposalDetail.jsx:341` | writes `proposals.total` | route through `calcProposalTotal` |
| `WTCCalculator.jsx:2245`, `:2272` | write `proposals.total` | same |
| `ProposalPDFModal.jsx:189` | customer signed price | exclude rate cards from the reduce |
| `MultiGCWizard.jsx:530`, `:635` | per-GC proposal totals | exclude rate cards |
| `ProposalDetail.jsx:344/357` (+ any WTCCalculator/Invoices twin) | SOV `contract_sum` + `billing_schedule_lines` seed | contract_sum uses contract-value fn; skip rate-card lines |

### FIX — per-line rendering, show rate not price
| Site | Change |
|---|---|
| `ProposalDetail.jsx:933` | rate-card line → "$X/hr (T&M)", no fixed price |
| `ProposalPDFModal.jsx:358` | same on the PDF |
| `PublicSigningPage.jsx:551` | same on signing page (needs view fields) |

### LEAVE — per-line billing primitives (do not touch)
`Invoices.jsx:280`, `:2093`, `:2688`, `:1213`; `invoicePdf.js:289`. Rate cards never reach these
(T&M day-row path); changing them re-opens the zeroing trap.

## Migration (command-suite-db)

`get_public_proposal_view` (SECURITY DEFINER) returns per-WTC `locked_line_total` only, so a
rate-card line prints $380 on the signing page. **`CREATE OR REPLACE`** it to add
`is_rate_card`, `rate_amount`, `rate_class` to each `wtc` object. **Must restate** `SECURITY
DEFINER` + `SET search_path = public` (CREATE OR REPLACE drops them otherwise) and keep the
anon EXECUTE grant + INVALID_TOKEN raises. The `total` field stays `p.total` — it auto-corrects
once the writers exclude rate cards. No column-level exposure change (all three fields are
display-safe; no cost basis).

**Rehearse before push** (O11 gate refreshed 2026-08-07, so `--against-prod` is trustworthy):
`cd ~/command-suite-db && ./scripts/rehearse.sh <migration>`. Function-body change needs the
behavioural key-diff, not just fingerprint counts.

## Out of scope (deferred, stays its own row)

- **F46 folded item (3):** server-side CHECK that `invoice_lines.amount == reg/ot/dt × rate`.
  Distinct concern (cent-rounding, deliberate rate edits, null-hours guard); not coupled to this
  migration.

## Verify (before anything goes live)

1. Job 7215 (P7): Remaining on contract reads **$0**, not $380; job value + T&M unaffected.
2. Proposal screen total == PDF signed price == signing-page total (all exclude rate cards).
3. Rate-card lines render as rates on all three customer surfaces — **in-browser, Chris's eyes**.
4. A non-rate-card proposal is byte-unchanged (no regression to normal totals/billing).
5. Migration rehearsed `--against-prod` green + behavioural key-diff on the function body.
6. A percent/SOV invoice still bills the correct amount (billing primitives untouched).
