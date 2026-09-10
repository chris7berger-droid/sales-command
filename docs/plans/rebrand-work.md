# Plan — Rebrand Work

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PARKED (assessed 2026-09-10) — assessment complete, not yet ideated or planned.

**Source documents (committed alongside this plan):**
- `docs/design/SUBCON_COMMAND_UI_STANDARD.md` — the canonical UI theme standard v1.0 (this is what a coding terminal reads; the PDF is a rendering of it)
- `docs/design/Subcon_Command_Visual_Brand_Guide.pdf` — brand guide v1.0, September 2026, includes the canonical Crew Schedule reference mockup on page 2 and the locked identity mark (Geometry A)

**Migrations:** none. This is UI-only. No shared-DB collision.

---

## §0 Baseline (observed current state) [DERIVED — read-verified 2026-09-10 against main @ 639b815]

### Styling stack
- React 19 + Vite. No Tailwind, no CSS-in-JS library. Styling is **inline style objects** fed by a shared token object.
- Token layer: `src/lib/tokens.js` exports `C` (colors), `F` (fonts), `SP`/`R`/`FS` (spacing, radius, font-size scales), and `GLOBAL_CSS` (injected via `<style>` in `src/App.jsx:219,223`). Fonts loaded there: Barlow Condensed, Barlow, Inter, JetBrains Mono.
- **Duplicate token files that drift:** `src/ar/lib/tokens.js` (same palette + AR aging pairs), `~/field-command/src/lib/tokens.js` (React Native, same palette).
- Schedule module (`src/schedule/`) is CSS-class based with its **own 40-variable namespace** in `src/schedule/index.css` (`--sand`, `--bg-card`, `--command-green`, `--cyan: #0891b2`, `--teal`, …) and a 6,853-line `src/schedule/App.css`.

### Scale of the surface
| Surface | Count |
|---|---|
| UI code | ~53,000 lines / 159 JSX files |
| Inline `style={{…}}` objects | 4,285 |
| `C.*` token references (repaint for free on a token swap) | 3,417 |
| Raw hardcoded hex outside the token layer | 1,072 in 73 files |
| Raw hardcoded teal alpha `rgba(48,207,172,…)` | 85 |
| JSX files using **no** tokens at all | 64 of 159 |
| Raw hex inside `src/schedule/App.css` | 253 |
| `--command-green` uses in schedule CSS (green as *accent*, not semantic) | 123 |
| Modal / fixed-overlay surfaces | 39 |
| `borderRadius` distinct values in use | 15 (8 / 6 / 10 / 4 / 5 / 14 / 7 / 20 / 16 / 12 / 2 / 3 / 9 / 1 / 999) |
| Looping animations (`@keyframes`) | 15 |

Raw hex by module: `src/schedule` 546 · `src/pages` 360 · `src/ar` 223 · `src/components` 173 · `src/field` 14 · `src/App.jsx` 0.

### Current look vs. standard (the five real shifts)
| Element | Today | Standard |
|---|---|---|
| Page shell | opaque tan `#b5a896`, **flat color, no texture** in web app | deep brown `#6A5544` + woven linen tile `/assets/brand/subcon-linen.webp` |
| Cards / panels | opaque linen `#c8bcaa` / opaque near-black `#1c1814` | translucent light glass / translucent espresso, `backdrop-filter: blur(10px)` |
| Accent | teal `#30cfac` (+ `tealDark`, `tealDeep`, `teal-ink` for text on light) | cyan `#12D8F2` (no dark/ink variant provided) |
| Body font | Barlow | Inter |
| Mono font | JetBrains Mono / DM Mono | Roboto Mono |

Computed: Light Glass 2 (`rgba(242,233,217,.76)`) over the `#6A5544` shell resolves to ≈ `#D1C5B5`, within a few points of today's `linenCard #c8bcaa`. **Light work areas will feel familiar; shell gaps, sidebar, and every dark panel change dramatically.**

### Brand assets on disk
- Web: `public/favicon.svg` (teal crosshair on dark circle), `src/components/Logo.jsx` (`SalesCommandMark` teal circle "SC" + `AppWordmark`), `src/schedule/components/Logo.jsx` (`ScheduleCommandMark` "SCH" circle). No hexagon mark exists anywhere.
- Field mobile: `~/field-command/assets/linen-texture.png` (real crosshatch tile, used via `LinenBackground.js` at 0.55 opacity). Web app has **no** tile.
- Sidebar icons (`src/lib/nav.js`) are **emoji**.
- Boot loader `src/components/RadarLoader.jsx` (479 lines): full-HUD radar sweep, scanlines, vignette, fake telemetry.

### Customer-facing surfaces carrying the old brand
- PDF generators: `src/lib/invoicePdf.js`, `src/lib/sovPdf.js`, `src/lib/payAppPdf.js`, `src/pages/PublicSigningPage.jsx`
- Public pages: `PublicInvoicePage`, `PublicSigningPage`, `InvoicePaidPage`, `CheckoutPage`, `Login`
- Edge-function emails with brand hex: `send-invoice`, `send-proposal`, `send-pay-app`, `invite-user`, `reset-password`, `follow-up-reminders`, `stripe-webhook`, `_shared/repNotify.ts`

### Prior decisions this standard supersedes [DESIGN-OPEN — need explicit re-ratification]
- `docs/plans/schedule_reskin.md` (ideate 2026-09-04) locked "Option A: keep linen + teal `#30cfac`."
- Memory `feedback_sc_pop_color_teal` (teal is the pop, not green) and `feedback_teal_on_dark`.
- Both conflict with §4 of the standard: "Do not substitute teal for cyan."

### Velocity / collision context
- 311 commits to `main` in the 14 days before 2026-09-10. Another terminal is live in `~/sales-command` on `main`.
- Existing worktree branches show 0 unmerged `src/` changes vs main (all merged or stale) — so the collision risk is with **future** concurrent work, not existing branches.

---

## §1 Problem / intent [DERIVED from the standard — confirm]
Apply the Subcon Command design system (warm linen/brown shell, translucent dark + light surfaces, cyan command accent, condensed performance typography, locked hexagon identity mark) to the entire web app **without redesigning workflows, data bindings, IA, or responsive behavior** (standard §1, non-negotiable). Result must visually belong to the same product as the canonical Crew Schedule reference.

---

## §2 Issues found in the standard / things missed [DESIGN-OPEN — resolve in ideate]

1. **Semantic + cyan palette fails WCAG AA as text on light glass.** Contrast on warm ivory `#F2E9D9`: cyan `#12D8F2` = 1.4:1 · success `#37D47F` = 1.6:1 · warning `#FFAA2D` = 1.6:1 · danger `#FF4D43` = 2.7:1. AA needs 4.5:1. §14 demands AA; §11 sends most dense screens to light glass; no ink/dark variants are provided. The app already has `tealDark`/`tealDeep`/`--teal-ink` and AR `tx` pairs precisely for this and the standard would remove them. **Amendment needed: `--sc-cyan-ink`, `--sc-success-ink`, `--sc-warning-ink`, `--sc-danger-ink`.** (Cyan on espresso = 9.8:1, fine.)
2. **Blur on every panel contradicts "do not stack translucent layers."** §16 `.sc-panel-*` put `backdrop-filter` on every card; §5 says don't stack. Invoices page (3,591 lines) renders dozens of cards + 39 modals stack over them. iPad Safari perf risk. **Proposal: blur only on shell-level surfaces (sidebar, top bar, modals); cards translucent without blur.**
3. **Three cyans.** UI `#12D8F2`, strong `#00CFF0`, logo `#00CFE8`. Intentional per the guide, but must be stated or agents will "normalize" them.
4. **Assets the standard references do not exist:** linen tile `.webp`, master vector mark (all 9 recommended files), hero photography. Guide forbids coding agents from drawing the mark. **Every identity task is BLOCKED on a human producing these.**
5. **Reference mockup contains new functionality** not in the app: global search bar, notification bell, "+ JOB" / "ACTIONS" menu, hero photo band, "Reports" nav item, "PEOPLE SYSTEMS PROFIT FREEDOM" tagline. §1 says don't redesign. **Decide up front these are out of scope** or they creep in.
6. **Schedule module uses green as its command color** (`--command-green` ×123: accent, active state, today marker). Standard: green = healthy only, cyan = command. Semantic sweep, not find-and-replace, on the exact screen the standard calls canonical.
7. **Boot loader is exactly what §13/§15 ban** (sci-fi HUD, scanlines, looping sweep). Plus `softPulse` glow and `reasonPulse` animations. Replace.
8. **No iconography spec.** Sidebar = emoji; reference mockup = line icons. Most visible "not premium" item; standard is silent.
9. **No spec for customer-facing documents** (3 PDF generators, 8 email templates, 2 public pages). Customers see these before the sidebar.
10. **No chart / data-viz palette.** AR aging needs an 8-step ramp; standard gives 5 semantic colors + purple.
11. **No sub-brand treatment.** Memory locks "X Command" on every section; app has separate SC / SCH circular marks; standard defines one hexagon and never addresses section marks or a wordmark lockup.
12. **Unspecified states:** empty, skeleton/loading, toast, form validation error, table row hover/zebra, print.
13. **Mobile/tablet ambiguity.** §1 says "web application … mobile/tablet views." Field Command native app (`~/field-command`, 19 files, own tokens, own linen PNG) is a separate repo. Decide: in scope or later.
14. **AR module is a prototype** off a manual QuickBooks export (memory: AR held). Theming it now may be wasted if it gets rebuilt. Sequence last or defer.
15. **Doc hygiene:** the standard has two "§18" sections; §19 tells agents to read `SUBCON_COMMAND_UI_STANDARD.md` — now committed at `docs/design/`. The canonical Crew Schedule reference image is embedded in the PDF only — extract to `docs/design/crew-schedule-reference.png` so §17 step 12 is checkable.
16. **`--font-display` is referenced 13× in schedule App.css but never defined** (pre-existing bug; the theme pass should define it).

---

## §3 Proposed sequence + estimate [DERIVED — sized, not ratified]

Process rule (the biggest risk is merge collision, not code): **land the token layer on main first as a small diff with a big visual effect, then take each module on its own short branch with a Vercel preview. Never one mega-branch.**

| Phase | Build days | Blocked on |
|---|---|---|
| 0. Ideate + plan sessions; resolve §2 items 1, 2, 5, 8, 13, 14; extract reference PNG | 1 | nothing |
| 1. Token layer (`tokens.js` + schedule `index.css` + `GLOBAL_CSS`), shell texture, sidebar, top bar, fonts, focus rings; unify AR token file; kill RadarLoader | 1 | linen tile asset |
| 2. Raw-hex sweep: `src/pages` + `src/components` (533 hex, 85 teal rgba) | 2–3 | nothing |
| 3. Schedule module retheme vs canonical reference (546 hex, `--command-green` semantic sweep, 6.8k-line CSS) | 2–3 | nothing |
| 4. AR + Field web modules | 1 | AR go/no-go |
| 5. Per-screen state pass: hover/focus/selected/disabled/loading/error, 39 modals, laptop width, contrast review | 2–3 | nothing |
| 6. Identity mark: sidebar, login, favicon, PDFs, emails, public pages | 1–2 | master vector |
| 7. Field Command native app (separate repo) | 1–2 | master vector (app icons) |
| **Total** | **10–15 build days ≈ 3–4 calendar weeks** | |

Standard §17 order maps onto phases 1 → 2/3 → 5. Each phase closes with in-browser verify on a preview deploy (memory: UI First-Class) and the §18 acceptance checklist.

---

## §4 Files to touch [DERIVED — starting inventory]
- `src/lib/tokens.js`, `src/ar/lib/tokens.js` (fold into one), `src/schedule/index.css`, `src/App.jsx` (GLOBAL_CSS), `index.html` (favicon, title)
- `src/components/AppSidebar.jsx`, `src/components/Logo.jsx`, `src/schedule/components/Logo.jsx`, `src/lib/nav.js` (icons)
- `src/components/RadarLoader.jsx` (replace)
- 73 files with raw hex (list via `grep -rlE "#[0-9a-fA-F]{6}\b" src --include='*.jsx' --include='*.js'`)
- `src/schedule/App.css` + 3 small schedule CSS files
- PDF libs `src/lib/{invoicePdf,sovPdf,payAppPdf}.js`; edge fns listed in §0
- New assets: `public/assets/brand/subcon-linen.webp` + the 9 mark files named in the standard

---

## §5 Out of scope / deferred [DERIVED — confirm in ideate]
- Any feature from the reference mockup not already in the app (§2 item 5).
- Workflow / IA / data changes of any kind (standard §1).
- Field Command native app unless ratified in scope (phase 7).
- AR module until go/no-go.

## §6 Time budget
See §3. Assessment session: 2026-09-10, ~1h, read-only.
