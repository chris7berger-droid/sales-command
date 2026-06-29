# Plan — Invoice "sent" state stale: Edit / Sync-to-QuickBooks buttons don't clear after send

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** bug

**Status:** PARKED (scaffolded 2026-06-29) — not yet planned.

---

## §0 Reproduction [TODO — observe before planning]
<!-- Trigger steps + observed pre-fix state. /auditcriteria refuses to generate a manifest without a real §0. -->
<!-- Known so far (from report, verify): -->
<!-- - Send an invoice (both PAY PACKAGE invoices AND STANDARD invoices affected). -->
<!-- - After send, the "Edit" and "Sync to QuickBooks" buttons stay visible — as if the invoice was never sent. -->
<!-- - Clicking away from the screen and clicking back makes them disappear (sent state finally renders). -->
<!-- - Started ~couple weeks ago (~mid-June 2026). Smells like a missing local state refresh / stale query after the send mutation. -->

## §1 Problem / intent [TODO]
<!-- The sent-invoice UI does not update in place after the send action; requires a navigate-away/return to reflect true state.
     Expected: buttons clear (or switch to sent-state controls) immediately on successful send, no manual refresh. -->

## §2 Proposed change [TODO]

## §3 Files to touch [TODO]

## §4 Out of scope / deferred [TODO]

## §5 Estimate / time budget [TODO]
