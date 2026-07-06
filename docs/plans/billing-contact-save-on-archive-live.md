# Plan — Billing Contact Not Saving on Archive → Live

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** bug

**Status:** PARKED (scaffolded 2026-07-06) — not yet planned.

---

## §0 Reproduction [TODO — observe before planning]
<!-- Trigger steps + observed pre-fix state. No §0 = no audit (/auditcriteria refuses without a real §0). -->
- Trigger: making an archive job live, then adding a billing contact during that flow.
- Observed: the billing contact is NOT saving to the customer record.
- TODO: capture exact steps, which screen/modal, and the pre-fix DB state (customer_contacts row absent? wrong customer_id? role not set?).

## §1 Problem / intent [TODO]
When an archive job is brought live and a billing contact is entered in that flow, the contact should persist to the customer record (canonical store: customer_contacts, role='Billing Contact') — it currently does not.

## §2 Proposed change [TODO]

## §3 Files to touch [TODO]

## §4 Out of scope / deferred [TODO]

## §5 Estimate / time budget [TODO]
