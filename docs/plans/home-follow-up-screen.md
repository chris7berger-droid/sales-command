# Plan — Home Screen → Follow-Up Screen

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** IDEATED (2026-08-11) — structure locked with Chris, ready for plan pass.

**Intent:** Convert the Sales Command home screen into a follow-up screen, integrating the old system's follow-up/alert features (New Inquiry claim alerts, Wants Bid due-date alerts, "You have N alerts → Take Action" banner). Reference screenshots: `docs/plans/assets/` (committed b3c98b9).

---

## Ideation decisions (2026-08-11, all [LOCKED] with Chris)

**Why (the real problem):** Sales reps don't look at the schedule 1–2 weeks ahead. Team is
99.9% inbound-trained; reps fill their day with busy work on big far-out projects while crews
head toward empty days. The screen's job is not just "react to alerts" — it's **"keep the
crews busy two weeks from now"** by converting thin schedule runway into outbound sales
activity.

1. **Follow-up takes over Home** (not an alert layer on top). Sales Dash keeps the stats job.
2. **Three zones, top-to-bottom by urgency:**
   - **Zone 1 — Alerts:** (a) *Needs claiming* = call_log in New Inquiry stage with no sales
     rep assigned; card action **Claim** → assigns you, alert clears. (b) *Bid due reached* =
     Wants Bid with bid_due ≤ today; card action **Update** → opens job to move stage or push
     date w/ note. Visible list capped at top 10 oldest-first with "+N more" expander (old
     system's 155-alert wall trained people to ignore it).
   - **Zone 2 — Schedule runway (MANUAL for v1):** admin-only entry (Chris/Manager; sales
     sees, can't set): "Weeks of booked crew work ahead: [n]" + optional one-line note.
     Rendered as colored runway bar: **≥3 green · 2 yellow · <2 red**, note beneath.
     Automation deferred until Schedule + Field builds finish.
   - **Zone 3 — Outbound worklist:** grows/expands when runway is yellow/red. V1 sources:
     (1) **Dormant customers** — sold work in past, no new inquiry/job in **6 months**
     (hardcoded v1); (2) **Gone-quiet bids** — hit Has Bid, never sold, stale. Each renders
     as a call card: customer, last touch, last job, phone, + "log the outcome" action that
     writes back (list shrinks as worked; Chris can see who's making calls). Deferred:
     sold-job neighbors/referrals (#3, fuzzier).
3. **Banner** "You have N alerts → Take Action" lives on **every other screen** (slim strip
   linking back to Home when N > 0) — Home *is* the alert screen now.
4. **Old Home stats compress to a footer strip** — one slim row (pipeline counts + monthly
   billings %); big cards go, Sales Dash carries full stats.

---

## §0 Baseline (observed current state) [TODO — verify before planning]
<!-- Feature: what exists today, with file:line / query evidence; mark read-verified vs run-verified.
     /auditcriteria refuses to generate a manifest without a real §0. -->

## §1 Problem / intent [LOCKED — see Ideation decisions above]

## §2 Proposed change [TODO — plan pass: expand ideation into file-level design]

## §3 Files to touch [TODO]

## §4 Out of scope / deferred [TODO]

## §5 Estimate / time budget [TODO]
