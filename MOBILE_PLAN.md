# Mobile Optimization Plan

**Status:** Planning complete, implementation not started.
**Branch:** `claude/ultraplan-setup-2QNY4`
**Goal:** Make the app render well on mobile and on resized desktop windows. Both problems share the same root causes (hardcoded widths, non-folding grids, table-only list views), so this plan fixes both.

---

## Start here tomorrow

Run **Phase 0** first — it's foundational and has zero visual impact on desktop. Then Phase 1 is where mobile improvements first become visible. Verify each phase in the browser before moving to the next. Commit at the end of every phase.

---

## Decisions already made

1. **Strategy: Hybrid.** CSS utility classes in `GLOBAL_CSS` (`tokens.js`) handle the bulk of grid/padding/font fixes via `@media` queries. A small `useIsMobile()` hook handles the ~5 places that need real layout branching (nav drawer, DataTable card mode, FilterBar collapse).
2. **Btn `sm` tap-target bump → mobile-only.** Don't change desktop button height.
3. **FilterBar flex restructure → mobile-only.** Keep desktop's current fixed-width inputs.
4. **PublicSigningPage white card stays white.** It's the documented exception in CLAUDE.md (customer-facing / PDF context).
5. **Print stylesheets are off-limits.** `@media print` blocks in `ProposalPDFModal.jsx` and `Invoices.jsx` must not be touched.

---

## Top 5 worst offenders (priority order)

### 1. `src/App.jsx` — top nav / app shell
- Sidebar `width: open ? 228 : 56` never collapses below 56px (eats ~17% of a 360px viewport).
- Content padding `28px 32px` too generous for narrow screens.
- No hamburger / drawer.

### 2. `src/components/DataTable.jsx` — used on every list page
- `<table style={{ width: "100%" }}>` inside `overflowX: "auto"`. Headers `whiteSpace: "nowrap"`. With 7–8 columns the table runs 900–1200px wide → horizontal scroll with no row context.
- Cascades to: `CallLog.jsx:238`, `Invoices.jsx`, `Proposals.jsx`, `Customers.jsx`, `Archive.jsx`, `SalesDash.jsx`.

### 3. Modals with hardcoded widths
- `NewInquiryWizard.jsx:694` → `width: 620`
- `NewProposalModal.jsx:63` → `width: 540`
- `Customers.jsx:76, 181, 283` → `width: 520 / 420 / 460`
- `SalesDash.jsx:302, 519` → `width: 700 / 780`
- `Invoices.jsx:1143` inner grid `1fr 1fr`, `:1199` `repeat(3,1fr)`
- `ProposalPDFModal.jsx:391` `1fr 1fr 1fr`, `:416` `2fr 1fr`

### 4. `src/pages/WTCCalculator.jsx`
- Fixed grids: `1fr 1fr 1fr` at 322, 393, 545, 641; `260px 1fr` at 561.
- Materials table at line 472 has `minWidth: 700`.
- Line 581: `<div style={{ minWidth: 200 }}>` StatCards in flex rows.

### 5. `src/pages/PublicSigningPage.jsx` — customer-facing, highest stakes
- `flex` `space-between` rows at lines 450, 465 don't wrap → right column squeezes.
- Inputs at 587, 601 use `fontSize: 15` → **iOS Safari will zoom on focus** (must be ≥16).
- Header padding `28px 32px` too large on narrow screens.
- Note: this page uses a local `T.*` palette and white background — that's the documented exception. Leave palette alone.

### Honorable mentions
- `FilterBar.jsx` — fixed input widths 110–170 stack messily.
- `CallLogDetail.jsx:372, 438, 475, 494` two-column form grids.
- `ProposalDetail.jsx:1003, 1011, 1020, 1029, 1037` five-col WTC summary grids.

---

## Phase 0 — Foundations (~15 min, zero visual change)

**Verifies:** desktop renders identically; new utilities are available for later phases.

1. Create `src/lib/useIsMobile.js`:
   - `useSyncExternalStore` over `matchMedia("(max-width: 768px)")`.
   - SSR-safe default `false`.
   - Optional `useBreakpoint()` returning `'sm' | 'md' | 'lg'`.
2. Extend `GLOBAL_CSS` in `src/lib/tokens.js` with utility classes (all gated under `@media (max-width: 768px)` unless noted):
   - `.sc-page` — responsive page padding (16px mobile, 28px desktop).
   - `.sc-grid-2`, `.sc-grid-3` — 2/3 cols desktop, 1 col mobile.
   - `.sc-grid-auto` — `auto-fill, minmax(220px, 1fr)` (continuous, no breakpoint).
   - `.sc-modal-shell` — `width: min(620px, 94vw); max-height: 92vh`.
   - `.sc-hide-mobile`, `.sc-show-mobile`.
   - `.sc-tap` — `min-height: 40px` (mobile-only).
   - `@media (max-width: 768px) { input, select, textarea { font-size: 16px !important } }` (prevents iOS zoom).
3. Verify `index.html` has `<meta name="viewport" content="width=device-width, initial-scale=1">`.
4. Commit: `feat(mobile): add useIsMobile hook + responsive utility classes`.

---

## Phase 1 — App shell + DataTable card mode (1–2 days)

**Visible mobile improvement starts here.**

### `src/App.jsx`
- Gate sidebar with `useIsMobile()`.
- Mobile: 48px top bar with hamburger; sidebar becomes slide-in `position: fixed` drawer with backdrop.
- Reduce content padding to `16px` on mobile via `.sc-page` class.
- Mobile header: just current page label (no breadcrumb chips).
- Persist desktop's `open` state separately so resize back to desktop doesn't keep collapsed.
- Move `PageBadge` to `bottom: 12px; right: 12px` on mobile to avoid colliding with hamburger.

### `src/components/DataTable.jsx`
- Add new prop `mobileCardKeys?: { title, subtitle, badge }` (or `mobileMode`). Default `undefined` = legacy horizontal-scroll (no breaking changes).
- When `useIsMobile()` and prop provided: render `<div role="list">` cards using `C.linenCard`. Primary heading + secondary lines + badge. Sortable header → single-select sort dropdown.
- Roll out one page at a time: start with CallLog, then Invoices, Proposals, Customers, SalesDash, Archive.

Commit after shell, commit after each list page opts in.

---

## Phase 2 — Modals (1 day)

Create `src/components/ModalShell.jsx` — standard backdrop + `width: min(620px, 94vw)` + close button. Replace fixed-width modals:

- `NewInquiryWizard.jsx:694`
- `NewProposalModal.jsx:63`
- `Customers.jsx:76, 181, 283`
- `SalesDash.jsx:302, 519`
- `ProposalPDFModal.jsx:391, 416` — fold internal `1fr 1fr 1fr` and `2fr 1fr` to `.sc-grid-3` / `.sc-grid-2`
- `Invoices.jsx:1143, 1199, 1471, 433`
- `Home.jsx:43` drilldown — already `90%, maxWidth: 540`; just shrink padding on mobile

Commit: `feat(mobile): standardize modal shells, fold inner grids`.

---

## Phase 3 — Forms / FilterBar / WTCCalculator (1–2 days)

### `FilterBar.jsx` (mobile-only changes)
- Keep desktop fixed widths.
- Under 768px: collapse into a "Filters" toggle button that expands to a stacked column.

### `WTCCalculator.jsx`
- Convert `gridTemplateColumns: "1fr 1fr 1fr"` at 322, 393, 545, 641 → `.sc-grid-3`.
- Materials table at 472: keep desktop `minWidth: 700`; on mobile render as stacked cards (use DataTable card pattern or local helper).

### `CallLogDetail.jsx`
- Form grids at 372, 438, 475, 494 → `.sc-grid-2`.

### `ProposalDetail.jsx`
- Five-col WTC summary grids (1003–1037): on mobile collapse to `1fr` with line breaks; desktop unchanged.

Commit: `feat(mobile): responsive forms, filters, and WTC layouts`.

---

## Phase 4 — PublicSigningPage (1 day, **test on real iPhone**)

- Bump input/button `fontSize` 15 → 16 (lines 587, 601, etc.) to prevent iOS zoom.
- Header (line 450) and Prepared-For row (465): under 600px change `flex` `space-between` → `display: grid; grid-template-columns: 1fr` so logo/contact stack.
- Reduce header padding `28px 32px` → `20px 18px` on mobile.
- Increase tap targets on the print/save action bar.
- **Do not touch the white card or `T.*` palette** — documented exception.

Commit: `feat(mobile): optimize public signing page for iOS`.

---

## Phase 5 — Polish (~0.5 day)

- `Login.jsx:121` — shrink `padding: "40px 36px"` → `28px 22px` on mobile.
- `Btn.jsx` `sm` size — add `.sc-tap` class so tap-target bumps to 40px **mobile-only**.
- `SearchSelect.jsx` — confirm dropdown panel width is `100%` of trigger, not fixed.
- Audit `Home.jsx` and `SalesDash.jsx` `auto-fill, minmax(...)` grids — likely fine, just confirm at 360px viewport.

Commit: `feat(mobile): polish login, buttons, dropdowns`.

---

## Reusable primitives to introduce

| Name | Location | Purpose |
|---|---|---|
| `useIsMobile()` | `src/lib/useIsMobile.js` | Boolean for layout branching (≤768px). |
| `useBreakpoint()` | same file | `'sm' \| 'md' \| 'lg'` for finer control. |
| `ModalShell` | `src/components/ModalShell.jsx` | Backdrop + responsive width + close button. |
| `DataTable` mobile mode | extend `src/components/DataTable.jsx` | Card rendering on mobile via `mobileCardKeys` prop. |
| GLOBAL_CSS utilities | `src/lib/tokens.js` | `.sc-page`, `.sc-grid-2/3/auto`, `.sc-modal-shell`, `.sc-hide-mobile`, `.sc-show-mobile`, `.sc-tap`. |

---

## Risks + style rules to respect

- **DataTable card-mode is the riskiest change.** Land behind opt-in prop; roll out one page at a time; verify sort/filter still work after each.
- **iOS 16px input rule** may visually inflate FilterBar/CallLogDetail/WTCCalculator inputs on mobile. Verify density.
- **CLAUDE.md style rules:**
  - No white backgrounds in the internal app — use `C.linen`, `C.linenCard`, etc. PublicSigningPage is the documented exception.
  - Teal buttons keep black text (`C.dark`).
  - Inputs use `C.linenDeep` background.
  - Import colors only from `src/lib/tokens.js`. `Login.jsx` extending `_C` with aliases is the only allowed exception.
- **Print stylesheets exempt** — don't add responsive media queries that interact with `@media print` in `ProposalPDFModal.jsx:185–224` or `Invoices.jsx:618–619`.
- **PageBadge / TOCOverlay** in `App.jsx:320` are `position: absolute` — verify they don't collide with the new mobile hamburger.

---

## Verification checklist (each phase)

- [ ] `npm run dev` — no console errors.
- [ ] Desktop at 1440px wide — visually unchanged.
- [ ] Desktop window resized to ~700px wide — content adapts smoothly.
- [ ] Chrome DevTools device mode at iPhone SE (375px) — readable, no horizontal overflow.
- [ ] At iPhone 14 Pro (393px) — same.
- [ ] All buttons reachable with thumb (no actions hidden behind nav).
- [ ] No regressions to print preview (`Cmd+P` from `ProposalPDFModal`).
- [ ] Phase 4 only: tested on a real iPhone (not just DevTools).
