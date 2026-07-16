# Plan — Pay App for Archive-Imported Jobs (6897 Plenium)

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** bug   <!-- silent fallback + unreachable escape hatch; has real design surface, see §1a -->

**Status:** PARKED (scaffolded 2026-07-16) — §0 diagnosed and evidence-backed; §2 onward not yet planned.

---

## §0 Reproduction (observed 2026-07-16)

**Trigger:** Job 6897 (Plenium Builders — Virginia Palmer Elementary, Polish). Invoices → New Invoice → select the 6897 proposal.

**Expected:** pay app flow launches (Plenium is flagged Pay App Required).
**Observed:** a standard invoice was produced instead, with no warning or explanation.

**Run-verified evidence** (SELECT-only against prod, `pbgvgjjuhnpsumnowuym`):

- Invoice `10125` — `proposal_id` `ddb62e3e…`, amount `$115,657`, status `New`, soft-deleted `2026-07-16 20:55:53+00`. This is the standard invoice from the repro, created and deleted by Chris.
- The pay-app flag is **not** the fault. `customers.requires_pay_app = true` for Plenium (`ca7877db-8613-457e-b47b-8be14a1ec8ef`), and all three 6897 jobs carry `customer_id` correctly.

| call_log | display_job_number | proposal | status | total | WTCs (locked) | schedule | archive |
|---|---|---|---|---|---|---|---|
| 3653 | 6897 — base | `ddb62e3e…` | Sold | $115,657 | **0 (0)** | none | `db9a8df4…` |
| 3716 | 6897 CO1 | `5dc4c293…` | Sent | $1,950 | 2 (2) | none | — |
| 3718 | 6897 CO2 | `ba98baa9…` | Sent | $26,781.79 | 2 (2) | none | — |

- CO parentage is correct: 3716 and 3718 both have `parent_job_id = 3653`, `co_number` 1 and 2.
- Base proposal has `is_archive_proposal = true` and **zero `proposal_wtc` rows** — it carries a lump total with no breakdown behind it.
- COs are **not sold**: stage `Has Bid`, proposal status `Sent`.

### §0a Baseline — why it falls back (read-verified, file:line)

1. **The silent fallback.** `src/pages/Invoices.jsx:102-125` (`selectProposal`) auto-creates the billing schedule from WTC rows, gated on `if (wtcRows?.length)` at **:106**. Archive proposal returns 0 rows → gate fails → execution falls through to the standard invoice builder at **:128**. No error, no branch, no user-visible signal. This is the bug.
2. **The other auto-create can't fire either.** `src/components/ProposalDetail.jsx:344` gates on `allWtcs?.length && allWtcs.every(w => w.locked)`. An archive proposal has no WTCs to lock, so this path never triggers.
3. **The manual escape hatch is unreachable.** `BillingScheduleSection.jsx:358-374` renders an empty state with a **"+ Create Billing Schedule"** button (**:364**). Its only mount is `Invoices.jsx:2628`, gated `{billingProposal && inv.proposal_id && …}`, and `billingProposal` is set only at `Invoices.jsx:1573` — inside `if (sch)` at **:1567**, i.e. only when a schedule already exists. Chicken-and-egg: the button that creates the first schedule only appears once a schedule exists.
4. **COs would each spawn their own schedule.** The auto-create at `Invoices.jsx:109` keys on `proposal_id` with no parent-job awareness. CO1 and CO2 each have 2 locked WTCs, so invoicing either would create a separate `billing_schedule` — the opposite of the ratified shape in §1a.

### §0b Useful facts for whoever builds this

- **The panel already does the wanted SOV shape.** `BillingScheduleSection.jsx` splits `baseLines` / `coLines` (**:379-380**), has "+ Add CO line" (**:593**), renders CO badges (**:536-538**), and can extract an SOV from an uploaded contract PDF (`review` / `extracting` state). This is not a from-scratch build — it's unblocking gates.
- **`onOpenPayApp` ignores status.** `Invoices.jsx:2880-2895` loads schedule + lines and opens `NewPayAppModal` on **existence alone** — it never checks `schedule.status`. So a `draft` schedule with lines still opens the pay app.
- **Status vocabulary is inconsistent** [DERIVED — verify impact]. Auto-create inserts `status: "active"` (`Invoices.jsx:110`, `ProposalDetail.jsx:350`), but `BillingScheduleSection` only branches on `"draft"` (**:399**) and `"locked"` (**:402**). An `"active"` schedule shows neither "Lock Schedule" nor "+ New Pay App". Worth confirming whether existing auto-created schedules are stranded this way.
- **tenant_id trap on any seed/backfill.** `billing_schedule.tenant_id` and `billing_schedule_lines.tenant_id` are both `NOT NULL DEFAULT get_user_tenant_id()`. Seeding as the database role (MCP / service role) won't resolve that default — rows land untenanted and go invisible under RLS, looking like a silent no-op. Set tenant explicitly: `246f6551-60de-4965-bb97-9a52971bc05d` (matches the job, and all 11 existing `billing_schedule` rows — single tenant today).

---

## §1 Problem / intent

An archive-imported (History Locker) job for a pay-app customer cannot be billed as a pay app, and the app gives no indication why — it quietly hands back a standard invoice. This is not specific to 6897: it hits **every** History Locker job for a pay-app customer, because archive proposals never have work-type lines.

### §1a Ratified shape [LOCKED — Chris, 2026-07-16]

- **6897 (the base job) is THE pay app job.**
- **CO1 and CO2 become lines on 6897's SOV** — not their own pay apps.
- COs join the SOV **once sold**, not while sitting at Has Bid. Billing an unapproved CO would invoice work Plenium hasn't signed off on.

### §1b Open design question [DESIGN-OPEN — raised 2026-07-16, must resolve before §2]

**Plenium only accepts their own paper PAMF form plus a waiver.** So the deliverable for this customer may not be the G702/G703 the pay app generates — it may be the SOV and billed-to-date numbers *to fill their paper form out from*, plus waiver generation. That reshapes the build and is the reason this was parked rather than rushed. Resolve before designing §2.

Related: `project_pay_app_only_customers` — some GCs only accept their own pay-app format.

## §2 Proposed change [TODO — blocked on §1b]

## §3 Files to touch [TODO]
<!-- Likely: src/pages/Invoices.jsx (selectProposal gate, BillingScheduleSection mount, CO→parent routing),
     src/components/BillingScheduleSection.jsx. NOTE: fix/qb-payment-sync-back already has changes to
     src/pages/Invoices.jsx — check for collision before merging. -->

## §4 Out of scope / deferred [TODO]

## §5 Estimate / time budget [TODO]

---

## Session note (2026-07-16)

Diagnosed read-only at Chris's instruction — heavy security work was live on the backend. **Nothing was written to prod.** A seed of `billing_schedule` + lines for `ddb62e3e…` was scoped and ready but explicitly **not executed**; Chris chose to bill 6897 tonight outside the app via Plenium's paper PAMF + waiver, and build this right rather than rush it.
