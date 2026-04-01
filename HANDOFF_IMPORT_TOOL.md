# Data Import Tool — Handoff Doc

**Date:** 2026-04-01
**Session:** 1 of 5 (per build spec)
**Build Spec:** `~/Desktop/SC_DataImportTool_BuildSpec_v1.docx`

---

## What Was Built

### Session 1 Deliverables
- **Standalone route at `/import`** — not in the sidebar, not discoverable by users
- **Admin-only gate** — checks `displayRole === "Admin"`, shows "Not authorized" otherwise
- **Standalone page layout** — dark top bar with SC logo, "Data Import Tool" label, "Back to Sales Command" link
- **4-step wizard with horizontal stepper** — clickable completed steps, back/next nav
- **Step 1: Upload & Detect** — drag-and-drop + click-to-browse, CSV (PapaParse) + Excel (SheetJS), sheet selector for multi-sheet workbooks, header chips, 10-row preview table, row count, silent cleaning (BOM, whitespace, empty rows, zero-width chars)
- **Step 2: Data Type Selector** — 4 cards (Customers, Call Log, Proposals, Invoices), live counts from Supabase, dependency enforcement (blocks Proposals if no call_log, etc.), soft warning for Call Log (can auto-create customers)
- **Steps 3-4: Placeholders** — "Coming in Session 2/3"

### Files Created
- `src/pages/Import/Import.jsx` — main wizard page
- `src/pages/Import/FileUpload.jsx` — file upload + preview components
- `src/pages/Import/DataTypeSelector.jsx` — data type selection cards

### Files Modified
- `src/App.jsx` — added `/import` route (standalone, outside AppShell)
- `package.json` — added `papaparse`, `xlsx`

### Packages Added
- `papaparse` — CSV parsing
- `xlsx` (SheetJS) — Excel file reading

---

## How to Test

1. Run `npm run dev` (or `npx vite --port 5173`)
2. Log in at `http://localhost:5173/login` with an Admin account
3. Navigate to `http://localhost:5173/import`
4. Upload a CSV or Excel file — verify header chips, preview table, row count
5. Select a data type — verify dependency warnings appear when applicable
6. Step through the wizard — verify back/next navigation and stepper state

---

## What's Next (Sessions 2–5)

| Session | Scope | Key Files to Create |
|---------|-------|-------------------|
| **2** | ColumnMapper + importUtils | `ColumnMapper.jsx`, `importUtils.js` — auto-match algorithm, field transformations, confidence indicators, live preview row, required field validation |
| **3** | ReviewImport + importApi + duplicate detection | `ReviewImport.jsx`, `importApi.js` — validation pass (green/yellow/red), fuzzy duplicate detection (Levenshtein/Jaro-Winkler), batch upsert with progress bar, reject file export |
| **4** | import_logs table + post-import summary + polish | DB migration for `import_logs`, audit trail, success report UI, edge cases, admin role gate |
| **5** | HDSP live migration | Export Glide data, run through the tool, verify, go live |

---

## Important Notes

- **DB column names differ from spec:** The spec says `customer_name` but the actual column is `customers.name`. The spec says `call_log.customer` but the actual column is `call_log.customer_name`. Always use CLAUDE.md column reference as source of truth.
- **Not in the sidebar** — this is a standalone admin tool at `/import`, not part of the main app nav. Users should never see it.
- **Build spec location:** `~/Desktop/SC_DataImportTool_BuildSpec_v1.docx` — load this at the start of each session for full context.
