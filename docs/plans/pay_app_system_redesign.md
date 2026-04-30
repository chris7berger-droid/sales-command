# Sales Command Pay-App Generator — System Plan

_Authored 2026-04-30. Trigger: AGRU America / Plenium Builders pay-app #1 (job 6458, $101,627.37) produced an output with multiple field-mapping defects. Coordinate-based template overlay is not scalable to additional GC formats._

---

## 1. Problem Summary

The current pay-app generator overlays text onto a customer-supplied PDF via hand-eyeballed x/y coordinates stored in `customer_pay_app_templates.field_mapping`. The first real run (AGRU/Plenium, job 6458) produced a PDF with the wrong source field in Application #, period dates and description on the wrong rows, all eight numbered dollar values stacked in one column, stray characters, a blank page 2 (Conditional Waiver), and no G703 SOV continuation sheet appended. Coordinate-mapping each new GC's template by hand is unsustainable; the system needs a generator that produces correct AIA-quality output for the common case and a non-coordinate authoring path for the long tail.

## 2. Proposed Architecture

**Recommended path: build a from-scratch AIA G702/G703 generator first, layer a Conditional Waiver block on top of it, then add an AcroForm-first authoring path for custom GC templates with a visual mapper as a fallback.** This inverts today's flow — most pay apps will be generated, not overlaid.

### 2.1 Authoring experience for custom templates — Hybrid (AcroForm-preferred, visual mapper fallback)

Recommend **(c) hybrid**, prioritizing AcroForm.

- On template upload, parse the PDF with `pdf-lib`'s `getForm().getFields()`. If named form fields exist and any name matches the canonical source-field list (see 2.5), auto-create a `field_mapping` entry mapping AcroForm field name → canonical source field. Chris confirms or remaps via a simple dropdown UI per detected field. No coordinates involved.
- If the PDF has no AcroForm fields (most GC templates won't), fall back to a visual mapper: render the page in a `<canvas>` via `pdfjs-dist` (already a transitive dep, but verify), let Chris click-and-drag a rectangle on the page, then pick a canonical source field from a dropdown. Save `{x, y, width, height, page, fontSize, align}` to `field_mapping`.
- Store both shapes in the same `field_mapping` jsonb (discriminator: `kind: "acroform" | "coords"`). The fill engine handles both.

Tradeoff: AcroForm-first is robust and re-targetable (PDFs can be renamed-fields by Chris in any AcroForm editor without re-mapping in the app), but most uploaded GC templates won't have AcroForm fields out of the box — so the visual mapper is unavoidable. We just don't make him use it for templates that are already form-fillable.

### 2.2 Standard G702/G703 generator (no template needed)

Generated from scratch with `pdf-lib` (no new lib — pdf-lib's text+rect+line primitives are sufficient for tabular AIA-style layouts and we already use it for `invoicePdf.js`). The generator is a pure function in a new module `src/lib/payApp/standardG702G703.js`:

```
generateStandardPayApp({ tenantConfig, customer, callLog, proposal,
                         schedule, lines, payApp, payAppLines,
                         priorPayApps, priorPayAppLines, options })
  → { pdfBytes }
```

It draws Page 1 (G702: header, From/To, Application/Period, Contract Summary block, Lines 1–9 numbered totals, Certification + signature block) and Page 2+ (G703: tabular SOV with cols A–I per line, prior + this + total to date, balance to finish, retainage). When no `customer_pay_app_templates` row exists, this is the default path. This solves item 3 (G703 page) for free since G703 is one of the pages this generator renders.

### 2.3 G703 SOV page as a reusable block

Extract the G703 page renderer into a separate function `renderG703({ pdfDoc, lines, payApp, priorPayAppLines })` that takes a `pdfDoc` and appends one or more pages. Both the standard generator and the custom-template path call it. For custom-template flows, after the template's page(s) are filled, the engine calls `renderG703(pdfDoc, …)` to append the SOV continuation. This addresses item 6 (the AGRU PDF saying "PLEASE INCLUDE YOUR SCHEDULE OF VALUES" with nothing attached).

### 2.4 Reusable Conditional Waiver block

`src/lib/payApp/waiver.js` exports `renderConditionalWaiver({ pdfDoc, variant: "progress" | "final", values })` that appends the waiver page using a fixed AIA-derived layout. Values auto-fill from the pay-app context (Property Name, Location, Customer, Invoice/Pay App #, Payment Amount, Date, Subcontractor name, Through Date). This serves both the standard generator (always appends) and custom-template flows (opt-in flag on the template row, default true since most GCs require it). Solves item 4 and the AGRU page-2-blank issue (5).

### 2.5 Canonical source-field naming

Define one source-of-truth in `src/lib/payApp/fields.js` exporting `CANONICAL_FIELDS` — an array of `{ key, label, group, source, formatter }` describing every field the generator can fill. `source` is a function `(ctx) → value` where ctx is `{ tenantConfig, customer, callLog, proposal, schedule, lines, payApp, payAppLines, priorPayApps }`. This kills the ambiguity that put `call_log.job_number` (10020) in the Application # slot — every canonical field has exactly one source. The minimum set covers: identity (`application_number`, `application_date`, `period_from`, `period_to`, `project_name`, `project_location`), parties (`subcontractor_name`, `subcontractor_address_block`, `gc_name`, `gc_address_block`, `architect_name`), contract math (`original_contract_sum`, `change_orders_executed_net`, `contract_sum_to_date`, `total_completed_and_stored`, `retainage_completed_work`, `retainage_stored_material`, `total_retainage`, `total_earned_less_retainage`, `previous_certificates_for_payment`, `current_payment_due`, `balance_to_finish`), and waiver (`waiver_payment_amount`, `waiver_through_date`, `waiver_signer_name`).

The visual mapper and AcroForm matcher both reference this list — there is no free-text source field anywhere.

### 2.6 Migration plan for the existing AGRU template

Don't migrate it — replace it. Plenium's blank template will be re-uploaded under the new model in Phase 2. The current `customer_pay_app_templates` row for AGRU has `field_mapping = null` (per migration default and the Customers.jsx insert at line 273), so it's already falling through to `DEFAULT_DA_BUILDERS_JOB_FIELD_MAP` — that's the source of the wrong-coordinate output. For the immediate AGRU re-test, Phase 1 (standard G702/G703) will produce a correct PDF that Plenium accepts, since AIA G702/G703 is industry-standard and AGRU's template is itself an AIA derivative.

### 2.7 Phasing

See section 3.

## 3. Phasing

### Phase 1 — Standard G702/G703 generator (foundation)

**Scope:** Pure-function generator in `src/lib/payApp/` that produces a complete G702 + G703 + Conditional Waiver PDF from billing-schedule data alone. New `payAppGenerator.js` orchestrator. `NewPayAppModal.jsx` and `PayAppDetailModal.jsx` updated to call the orchestrator instead of inline logic; the >60-line PDF block in each is removed. `BillingScheduleSection.jsx` is not touched in this phase — it just keeps loading data.

**Files touched (new):** `src/lib/payApp/standardG702G703.js`, `src/lib/payApp/g703.js`, `src/lib/payApp/waiver.js`, `src/lib/payApp/fields.js`, `src/lib/payApp/index.js`, `src/lib/payApp/__tests__/` (vitest if not present, else snapshot-render to bytes and check page count + key strings).

**Files touched (edit):** `src/components/NewPayAppModal.jsx` (lines 211–269 — replace inline fill with `generatePayApp(ctx)`), `src/components/PayAppDetailModal.jsx` (lines 93–181 — same), keep `src/lib/payAppPdf.js` as-is for now.

**Migrations:** None required. Optionally add `customer_pay_app_templates.kind text DEFAULT 'coords'` column for forward compat — defer to Phase 2.

**Ships:** Any customer with no template gets a clean AIA pay-app PDF. **Ships AGRU/Plenium-quality output for AGRU** by uploading the AGRU customer with no `customer_pay_app_templates` row (or by deleting the broken existing one). The output won't be Plenium's exact form, but it will be AIA-standard and Plenium accepts AIA. Solves items 1, 2, 3, 5, 6 for AGRU.

**Deferred:** Custom GC templates (Phase 2). Plenium's exact form layout (Phase 2 if needed; in practice unlikely).

### Phase 2 — AcroForm-first custom template authoring

**Scope:** New "Map Fields" UI in Customers → pay app templates. On upload, detect AcroForm fields; if found, present each with a dropdown of canonical fields (auto-suggest by name fuzzy match). If absent, render the PDF in a canvas-based visual mapper (drag rectangles, pick canonical field). Save `field_mapping` as `{ kind: "acroform" | "coords", fields: [...] }`. Update `fillPayAppPdf` to dispatch by kind; AcroForm fill uses `pdf-lib` `form.getTextField(name).setText(value)` and `form.flatten()` so the output is non-editable. After filling the template, append G703 + Waiver from Phase 1 modules.

**Files touched (new):** `src/components/PayAppTemplateMapper.jsx` (visual mapper + AcroForm picker), `src/lib/payApp/fillTemplate.js` (replaces `payAppPdf.js`).

**Files touched (edit):** `src/pages/Customers.jsx` around lines 252–276 (template upload calls mapper after upload), retire `src/lib/payAppPdf.js` and the `DEFAULT_DA_BUILDERS_JOB_FIELD_MAP` constant.

**Migrations:** `ALTER TABLE customer_pay_app_templates ADD COLUMN append_g703 boolean NOT NULL DEFAULT true, ADD COLUMN append_waiver text` (waiver as `null | 'progress' | 'final'`). Versioning: `field_mapping_version int DEFAULT 2` so the loader knows which shape it has.

**Ships:** Plenium-form-accurate output if Chris wants it. Any future GC's PDF with named form fields works zero-config. Visual mapper covers the rest.

**Deferred:** OCR/AI auto-mapping (Phase 3, optional).

### Phase 3 — AI-assisted auto-mapping (optional, only if Phase 2 mapping feels slow in practice)

**Scope:** New edge function `auto-map-pay-app-template` that takes the template PDF, runs Claude vision over a render of each page, returns a draft `coords` `field_mapping` keyed to canonical fields. Mapper UI shows AI suggestions overlaid; Chris confirms or adjusts. Reuses the existing `extract-sov` edge function pattern.

**Files touched:** `supabase/functions/auto-map-pay-app-template/index.ts`, `PayAppTemplateMapper.jsx`.

**Migrations:** None.

**Ships:** ~80% of new GC templates need only confirmation, not authoring. Worth it only if Chris is mapping more than 2–3 templates a year.

## 4. Key Decisions and Tradeoffs

1. **Generate, don't overlay, by default.** The AGRU bug isn't a coordinate bug — it's that overlay is the wrong default. Most subcontractors send AIA G702/G703. Customers who require their own form are a smaller set, and many of those forms are themselves AIA derivatives. Generating from scratch eliminates an entire class of bugs (wrong coordinates, wrong source fields, missing pages) and makes the custom-template path strictly an enhancement layer.

2. **AcroForm-first over visual-first authoring.** AcroForm field names survive PDF re-exports; coordinates don't. A GC who tweaks their template (changes margins, moves the Period block) breaks every coord mapping but leaves a named-field mapping intact. Counter: most GC templates don't have AcroForm fields. So we keep the visual mapper but don't lead with it — and importantly, when Chris hits a template without form fields, he can open it in Acrobat or Foxit, drop named fields, and re-upload — that's a 5-minute one-time job per GC.

3. **G703 and Waiver as composable blocks, not template features.** Treating these as `pdfDoc.appendPage` operations means the same G703 renderer works for the standard generator and for any custom template. The alternative (having each template's mapping include the G703 layout) duplicates work and lets G703 drift between templates.

## 5. Out of Scope (v1)

- Multi-tenant template sharing (cross-customer template library).
- Editing prior pay apps after submission (the snapshot pattern in the schema already locks them).
- E-signature on the generated pay app — current send flow attaches the PDF to email and the GC signs in their workflow.
- A new PDF library (pdfkit/pdfmake/react-pdf). pdf-lib handles G702/G703 fine and we already use it.
- Procore/GCPay/Textura API integrations — those are separate features, not template formats.
- Migrating the DA Builders job-scoped flow (their template still works under the existing path during Phase 1; it gets unified in Phase 2).

## 6. Open Questions for Chris

1. For the AGRU re-test: are we comfortable sending Plenium an AIA-standard G702/G703 (Phase 1 output), or does Plenium specifically require their own form? If the former, Phase 1 alone unblocks AGRU.
2. Do you have an AGRU-supplied blank Plenium pay app template PDF you can share for Phase 2 mapping, or do we work from the previously-filled output?
3. Conditional Waiver default: append progress waiver to every pay app unless `is_final = true`, or make it explicit per pay app? Default-on is the AIA convention.
4. Subcontractor address on output: pull from `tenant_config.address/city/state/zip` always, or per-customer override (some subs have multiple offices)?
5. Phase 3 (AI auto-mapping) — pursue eagerly, or only if Phase 2's manual mapping turns out to be a bottleneck after the first 2–3 GC templates?

## 7. Effort Estimate

- **Phase 1:** ~3 dev-days. The G702 layout is one page of measured text + lines; G703 is a 10-column table; Waiver is fixed text + 6 fill-ins. The component refactor (extracting fill logic out of NewPayAppModal/PayAppDetailModal) is the real work — ~half a day. Snapshot tests ~half a day.
- **Phase 2:** ~4 dev-days. AcroForm detection + dropdown picker is a day. Visual mapper (canvas render of PDF page, drag-to-place, source-field dropdown, persist) is the meatier ~2 days. Migration + retiring the old `payAppPdf.js` + Customers.jsx wiring is a day.
- **Phase 3 (optional):** ~2 dev-days. Mostly a thin wrapper around the existing `extract-sov` pattern, plus a confirm/adjust UI tied into Phase 2's mapper.

**Total: 7 dev-days for Phases 1–2, the path to "no more hand-edited coordinates."** Phase 1 alone (3 days) gets AGRU to a sendable state.

### Critical Files for Implementation

- `src/lib/payAppPdf.js`
- `src/components/NewPayAppModal.jsx`
- `src/components/PayAppDetailModal.jsx`
- `src/pages/Customers.jsx`
- `supabase/migrations/20260417140000_pay_apps.sql`

## 8. Pre-Start Checklist (read before Phase 1)

- **Recent edits in this area** — `Customers.jsx` and `BillingScheduleSection.jsx` were both touched in v89 (customer delete/merge) and v88 (QB linking). Phase 1 deliberately does NOT modify `BillingScheduleSection.jsx`, so no merge risk there. Phase 1 DOES edit `NewPayAppModal.jsx` and `PayAppDetailModal.jsx` — both are stable since v87, low risk.
- **Phase 2 retires `src/lib/payAppPdf.js`** — before deleting it, grep the repo for any other importers besides `NewPayAppModal` / `PayAppDetailModal`:
  ```
  grep -rn "payAppPdf" src/
  ```
- **AGRU template row** — the `customer_pay_app_templates` row labeled "AGRU Pay App" (job-scope, customer Plenium Builders) is the broken one. Phase 1 path: delete that row (or set `field_mapping = null`) so the customer falls through to the new standard generator.
- **Test job for Phase 1 validation** — call_log 6458 (MB AGRU America, Plenium Builders, $101,627.37 contract). The existing pay app #1 ($21,956 completed, $1,098 retainage, $20,858 due) is the data we already entered; regenerate against the new generator and compare.
- **Open questions in §6 are gating** — at minimum answer Q1 (Plenium accepts AIA G702/G703?) before starting Phase 1, since the answer determines whether Phase 1 alone unblocks AGRU or whether Phase 2 has to ship together.
