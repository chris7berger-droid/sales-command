# Plan — Standard AIA G702/G703 Pay App PDF Generator

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PARKED (scaffolded 2026-07-13) — exploratory design locked, full plan not yet written. Parked behind current in-flight build work.

---

## §0 Baseline (observed current state) [DERIVED — from a code trace 2026-07-13, re-verify before planning]

Trace of the existing pay app chain in sales-command (read-verified, file:line as of 2026-07-13):

- **Data already exists.** The pay app flow computes every input the AIA form needs — original contract sum, per-SOV-line scheduled value / from-previous / this-period / stored, retainage %, totals, current payment due. No new data plumbing required.
  - Generation trigger: `src/components/NewPayAppModal.jsx` `handleCreate` (~:123); amounts computed ~:93–110; writes `billing_schedule_pay_apps` + `billing_schedule_pay_app_lines` + a `type:"pay-app"` invoice.
  - Retainage default 5% literal: `src/components/ProposalDetail.jsx:350` and `src/pages/Invoices.jsx:110`; consumed at `NewPayAppModal.jsx:105` (`schedule.retainage_pct`). See memory: Retention Default 5%.
- **jsPDF already in the codebase.** `src/lib/sovPdf.js` (`generateSovPdf`, ~:5) renders the G703 SOV via jsPDF (landscape letter). Same lib to render the G702.
- **Existing custom-GC path (KEEP — do not touch):**
  - `src/components/PayAppCheatSheet.jsx` — on-screen copy-paste helper Chris uses to hand-fill a GC's own form. This is the workflow for custom-GC forms.
  - `src/lib/payAppPdf.js` — pdf-lib overlay onto a customer-**uploaded** template (only when `template.is_fillable`, which is hard-coded `false` on upload at `Customers.jsx:294`).
  - `customers.requires_pay_app` routing (`ProposalDetail.jsx:344`, `Invoices.jsx:89`) — pay-app vs regular-invoice.
- **Delivery today:** `supabase/functions/send-pay-app/index.ts` emails PDFs via Resend; storage in `job-attachments`.
- **Visual target:** the `HDSP_PayApp1_Job7432_G702-G703.pdf` Chris already has (clean, green-accented, from-scratch AIA G702+G703). NOT produced by sales-command today — it's the look the new generator should match.

## §1 Problem / intent [LOCKED]

Sales Command should own **one canonical AIA G702/G703 pay app**, generated as a finished **native PDF** from existing pay app data, on a button press. The standard AIA form is accepted by almost all GCs; PDF output is always fine (no editable-Excel requirement). This makes app-generated the default and per-GC custom forms the exception — reversing today's "overlay each GC's uploaded form" default.

## §2 Proposed change [LOCKED intent, DESIGN-OPEN details]

- **[LOCKED]** New canonical G702/G703 renderer — native PDF via jsPDF (same lib as `sovPdf.js`), styled to match the HDSP target doc.
- **[LOCKED]** Fills entirely from existing pay app data. Only per-GC variable = the owner/GC/project block at the top (name, address, project, app #, period, dates).
- **[LOCKED]** New **"Generate Standard Pay App"** button in `PayAppDetailModal` → renders → drops the PDF into the same pay app document slot the manual upload uses today.
- **[LOCKED] Additive, overwrite nothing.** Keep `PayAppCheatSheet.jsx`, `payAppPdf.js` overlay path, and `requires_pay_app` routing exactly as-is — that's Chris's custom-GC workflow (copy from our numbers → paste into their form → upload).
- **[DESIGN-OPEN]** Retainage: the standard AIA form splits 5a (completed work %) vs 5b (stored material %); our model tracks one retainage %. Map ours → 5a, 0 → 5b (matches how jobs actually bill). Confirm.
- **[DESIGN-OPEN]** Where the owner/GC/project block sources its fields (customer record vs job vs entered at generate time).
- **[DESIGN-OPEN]** Exact jsPDF layout/spacing to match the HDSP target — build from that PDF as the reference.

## §3 Files to touch [DERIVED — confirm at plan time]

- NEW: `src/lib/payAppStandardPdf.js` (or extend `sovPdf.js`) — the G702+G703 renderer.
- EDIT: `src/components/PayAppDetailModal.jsx` — add the "Generate Standard Pay App" button + wire to storage slot.
- Reuse existing storage/attach pattern (`job-attachments`, `billing_schedule_pay_apps` doc url). Possibly `send-pay-app/index.ts` if it should attach the standard PDF.
- DO NOT edit: `PayAppCheatSheet.jsx`, `payAppPdf.js`, `requires_pay_app` routing.

## §4 Out of scope / deferred [LOCKED]

- Editable-Excel output (`.xlsx` fill of the GC master spreadsheet) — not needed; PDF is always accepted.
- Per-GC field-mapping automation (`customer_pay_app_templates.field_mapping` / `is_fillable`) — leave stubbed; custom GCs stay on the manual cheat-sheet + upload path.
- No changes to `requires_pay_app` routing or the overlay path.

## §5 Estimate / time budget [TODO]

<!-- Fill at plan time. Rough shape: one renderer (medium — jsPDF layout to match HDSP target) + one button/wiring (small). No new data plumbing. -->

## Guardrail — "touches nothing existing" checklist [LOCKED]
- [ ] `PayAppCheatSheet.jsx` unchanged
- [ ] `payAppPdf.js` (overlay path) unchanged
- [ ] `requires_pay_app` routing unchanged
- [ ] No migrations (text/PDF only — no shared-DB collision risk)
