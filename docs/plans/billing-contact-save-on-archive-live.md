# Plan — Billing Contact Not Saving on Archive → Live

**Status: CLOSED 2026-08-06 — fixed without this plan.** Parked 2026-07-06 and never planned;
the bug was rediscovered in live use a month later and fixed in-flow via `/fix`. See
`docs/handoffs/SC_Handoff_v176.txt` (bug 1) and the 2026-08-06 Completed Log rows in
`docs/BACKLOG.md`. Fix merged to main @ `a9dc3fd`.

Kept as a record of the parked stream, not as work to pick up. The worktree
(`~/sales-command-billing-contact-save-on-archive-live`) and branch
(`feat/billing-contact-save-on-archive-live`) were removed on close-out.

**What it turned out to be:** `ImportToLiveWizard.handleImport()` persisted the Contact & Billing
step only inside its `customerMode === "new"` branch. On the existing-customer path the entire
step — billing contact, billing terms, job contact phone/email — was collected, validated as
REQUIRED, shown on Review, and then discarded. `NewInquiryWizard` had received exactly this fix in
Loop #28 (2026-05-28, `docs/plans/billing_contact_wizard_existing_customer.md`) and it was never
mirrored here. A second bug in the same step was found alongside it: the shared picker's
`billingSame` flag was being spread into wizard form state, where the same key means the billing
**address** toggle — so typing a billing contact nulled the job's billing address.

**Why it sat for a month:** parking created the isolated space and the stub, and nothing carried
the item forward into a working session. It surfaced only when a real job (6653, Incline Property
Management) hit it and the missing contact blocked invoice creation. Same shape as MIG-1 — an
item that rode along unowned across a boundary. Worth remembering when parking anything.

---

## Original stub, as parked 2026-07-06

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** bug

**Status:** PARKED (scaffolded 2026-07-06) — not yet planned.

### §0 Reproduction [TODO — observe before planning]
- Trigger: making an archive job live, then adding a billing contact during that flow.
- Observed: the billing contact is NOT saving to the customer record.
- TODO: capture exact steps, which screen/modal, and the pre-fix DB state (customer_contacts row absent? wrong customer_id? role not set?).

### §1 Problem / intent [TODO]
When an archive job is brought live and a billing contact is entered in that flow, the contact should persist to the customer record (canonical store: customer_contacts, role='Billing Contact') — it currently does not.

### §2 Proposed change [TODO]

### §3 Files to touch [TODO]

### §4 Out of scope / deferred [TODO]

### §5 Estimate / time budget [TODO]
