# Plan — Proposal Summary: Hours (Regular/OT) + Size at a Glance

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature   <!-- feature | bug -->

**Status:** PARKED (scaffolded 2026-06-30) — not yet planned.

---

## §0 Baseline (observed current state) [TODO — verify before planning]
<!-- Read-verify before planning. -->
The proposal detail SUMMARY panel today shows a per-WTC table with columns:
**Price / Cost / Margin / Profit**, then a **Total** row, plus Customer, Contract Sum,
Created, Status. (See screenshot 2026-06-30, Proposal 7432 — Lake Tahoe School Demo,
4 WTCs: Demo, 100% Solids Epoxy x2, Underlayment.)

No hours or size/area information surfaces in the summary. Find where WTC labor hours
and square footage / size already live in the Work Type Calculator data model
(regular hrs, OT hrs, area) — verify whether these are stored per-WTC or derived.

## §1 Problem / intent [LOCKED]
On a multi-WTC project, Chris wants the summary screen to tell him **at a glance**:
- **Regular hours** and **Overtime hours** (broken out, not just a blended number)
- **Size** (square footage / area) per WTC
- A sensible **total hours** rollup across all WTCs

Today the summary is price/cost/margin/profit only — no way to read total project
labor hours or size without opening each WTC. Goal: make a project with multiple WTCs
legible for hours + size the same way it already is for money.

**Scope:** applies to **single-WTC ("regular"), multi-WTC, AND multi-GC jobs** —
same columns on every proposal; a single-WTC job is just the one-row case of the same
Total rollup. No separate layout for single vs. multi.

**[DESIGN-OPEN] Multi-GC rollup:** money is already allocated per-GC on multi-GC jobs
(see docs/plans/multi_gc_allocation.md, feat/multi-gc-allocation). Decide whether the
summary shows Reg/OT hours + size **per-GC** (mirroring the money allocation) in
addition to the project total, or project total only. Leaning per-GC for parity with
the money view — confirm at plan time.

## §2 Proposed change [TODO]
<!-- Likely: add Reg Hrs / OT Hrs / Size columns (or a parallel mini-table) to the
     summary WTC table, with a Total row that sums hours and size across WTCs.
     Decide column layout vs. separate "Labor & Size" block. -->

## §3 Files to touch [TODO]
<!-- Summary panel component (proposal detail). Per V52 refactor: detail/modal lives in
     components/, page file is list-view only. Locate the summary table component. -->

## §4 Out of scope / deferred [TODO]

## §5 Estimate / time budget [TODO]
