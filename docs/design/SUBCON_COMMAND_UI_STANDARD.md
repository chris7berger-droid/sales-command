# SUBCON COMMAND UI STANDARD

**Version:** 1.0  
**Status:** Canonical UI theme standard  
**Applies to:** All Subcon Command web application screens, components, states, dashboards, lists, schedules, forms, reporting, mobile/tablet views, and future modules.

---

## 1. Non-negotiable instruction for coding agents

> **Do not redesign the interface while applying this theme. Preserve existing functionality, information architecture, data bindings, interactions, and responsive behavior unless explicitly instructed otherwise. Theme the existing application using the Subcon Command design system.**

Before making any UI change, read this file. Treat it as the visual source of truth. Do not invent alternate colors, surface opacities, type styles, corner radii, shadows, or component patterns unless a requirement cannot be satisfied with the system below.

**Canonical visual reference:** the approved Crew Schedule mockup using warm linen/brown background, translucent dark and light surfaces, high-contrast cyan instrumentation, condensed performance typography, and industrial/tactical construction language.

---

## 2. Brand idea

**Helping Craftsmen Become Businessmen.**

Subcon Command is a premium construction operating platform. It should feel like a combination of:

- Professional contractor equipment: RIDGID / DeWalt / Procore-level confidence and utility.
- Performance instrumentation: sports-car cockpit, action-sport equipment, race telemetry.
- Tactical operating discipline: precise, calm, high-signal, mission-oriented.
- Real construction: concrete, steel, tools, machinery, field crews, production, margin.

The product is serious, expensive, operational software. The interface should communicate **control, capability, speed, confidence, financial awareness, and field credibility**.

### Core brand themes

- Tactical Margin Systems
- Real-time metrics
- Financial optimization
- Crew management technology
- Quality control
- Production-rate control
- Operational discipline
- Turning field execution into business performance

### The emotional target

**Focused, capable, energized, in control.**

Not cozy. Not lifestyle. Not generic SaaS. Not sci-fi. Not gamer UI. Not militaristic costume.

---

## 3. Visual formula

**Warm material base + transparent operating surfaces + cyan instrumentation + disciplined typography.**

The application is not a black theme. The brown/linen world must remain visible through the UI.

### Priority order

1. Readability
2. Operational hierarchy
3. Brand distinctiveness
4. Low eye strain
5. Density without visual noise

---

## 4. Color system

Use these as design tokens. Do not substitute teal for cyan.

```css
:root {
  /* Brand */
  --sc-cyan: #12D8F2;
  --sc-cyan-strong: #00CFF0;
  --sc-cyan-soft: rgba(18, 216, 242, 0.16);
  --sc-cyan-glow: rgba(18, 216, 242, 0.28);

  /* Material world */
  --sc-espresso: #241B16;
  --sc-brown-900: #2F241D;
  --sc-brown-800: #3C2E25;
  --sc-brown-700: #584534;
  --sc-taupe: #8B735E;
  --sc-linen: #D4C3AA;
  --sc-sand: #E7DAC4;
  --sc-warm-ivory: #F2E9D9;

  /* Ink */
  --sc-ink: #161513;
  --sc-ink-soft: #302B26;
  --sc-white: #F8F5EF;
  --sc-text-muted-dark: rgba(248,245,239,.64);
  --sc-text-muted-light: rgba(22,21,19,.62);

  /* Semantic */
  --sc-success: #37D47F;
  --sc-warning: #FFAA2D;
  --sc-danger: #FF4D43;
  --sc-info-blue: #249DEA;
  --sc-category-purple: #7637F5;

  /* Borders */
  --sc-border-dark: rgba(255,255,255,.14);
  --sc-border-dark-strong: rgba(255,255,255,.23);
  --sc-border-light: rgba(62,45,34,.18);
  --sc-border-light-strong: rgba(62,45,34,.28);
}
```

### Cyan usage

Cyan is the **command color**. Use it for:

- Active navigation
- Primary buttons
- Selected tabs
- Current day / current state
- Progress / live instrumentation
- Key interactive affordances
- Focus rings
- Important data accents
- Small brand marks

Do **not** wash entire screens in cyan. It works because the surrounding palette is restrained.

### Semantic colors

- Green = healthy / on target / available / completed
- Amber = caution / needs attention / risk
- Red = intervention / missing / blocked / late
- Purple or blue = category identity, job classification, or scheduling distinction
- Gray = unavailable / inactive / neutral

Never use semantic colors decoratively.

---

## 5. Surface and transparency system

Transparency is essential. Avoid opaque black panels and opaque beige panels except where contrast is required for accessibility.

```css
:root {
  --sc-surface-dark-1: rgba(24, 21, 18, .58);
  --sc-surface-dark-2: rgba(24, 21, 18, .70);
  --sc-surface-dark-3: rgba(17, 16, 14, .82);

  --sc-surface-brown-1: rgba(75, 57, 44, .34);
  --sc-surface-brown-2: rgba(75, 57, 44, .48);

  --sc-surface-light-1: rgba(242, 233, 217, .62);
  --sc-surface-light-2: rgba(242, 233, 217, .76);
  --sc-surface-light-3: rgba(246, 239, 227, .88);

  --sc-backdrop-blur: 10px;
}
```

### Surface roles

**Dark Glass 1** - navigation wells, secondary cards, overlays where the background may remain visible.  
**Dark Glass 2** - dashboards, KPI modules, headers, dense information on dark surfaces.  
**Dark Glass 3** - modal surfaces or places where readability must dominate.

**Light Glass 1** - large schedule/table canvas.  
**Light Glass 2** - dense operational work areas.  
**Light Glass 3** - forms, editor surfaces, or text-heavy areas requiring maximum contrast.

### Rules

- Linen/background texture should subtly show through translucent surfaces.
- Do not stack multiple high-opacity glass layers unnecessarily.
- Backdrop blur should be subtle. Avoid frosted-glass novelty.
- Light work surfaces should feel like warm technical paper, not white SaaS cards.
- Dark surfaces should read espresso/graphite, not pure black.

---

## 6. Background texture

The global shell should use a **warm linen / woven material texture** over a brown/taupe base.

Recommended implementation:

```css
.sc-app-shell {
  background-color: #6A5544;
  background-image:
    linear-gradient(rgba(36,27,22,.10), rgba(36,27,22,.10)),
    url('/assets/brand/subcon-linen.webp');
  background-size: auto, 420px 420px;
  background-repeat: repeat;
}
```

Texture rules:

- Fine scale, low contrast.
- Must not reduce readability.
- Do not put a different texture on every card.
- Use one global texture plus occasional industrial imagery or topographic/technical line art at very low opacity.
- Texture should feel material, not decorative wallpaper.

---

## 7. Typography

### Recommended font stack

**Display / KPI / command language:** `Barlow Condensed`  
**UI / body / tables:** `Inter`  
**Optional micro-data / IDs:** `Roboto Mono`

Fallbacks:

```css
--sc-font-display: "Barlow Condensed", "Arial Narrow", sans-serif;
--sc-font-ui: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--sc-font-mono: "Roboto Mono", "SFMono-Regular", Consolas, monospace;
```

### Hierarchy

- Page command title: 30-42 px, 700-800, condensed, tight leading
- KPI primary number: 36-56 px, 700-800, condensed
- Section header: 16-20 px, 700-800, condensed, uppercase optional
- Card title: 14-17 px, 700
- Body/data: 13-15 px, 400-600
- Micro-label: 10-12 px, 600-700, uppercase, tracking .08-.16em

### Tone

Use short, operational language: **CREW CAPACITY, GROSS MARGIN, JOBS AT RISK, TODAY, PRODUCTION RATE, NEEDS CREW, EXECUTE.**

Avoid overly friendly SaaS copy such as “Here’s what’s happening today!”

---

## 8. Geometry

```css
:root {
  --sc-radius-xs: 4px;
  --sc-radius-sm: 6px;
  --sc-radius-md: 9px;
  --sc-radius-lg: 12px;
  --sc-radius-pill: 999px;

  --sc-space-1: 4px;
  --sc-space-2: 8px;
  --sc-space-3: 12px;
  --sc-space-4: 16px;
  --sc-space-5: 20px;
  --sc-space-6: 24px;
  --sc-space-8: 32px;
  --sc-space-10: 40px;
  --sc-space-12: 48px;
}
```

### Geometry rules

- Corners are controlled and technical, not pillowy.
- Cards: 6-10 px radius.
- Major containers: 10-12 px max.
- Buttons: 6-8 px unless a circular control is intentional.
- Borders are thin and precise.
- Align cards, labels, and controls to a visible grid.

---

## 9. Borders, depth, and lighting

Use depth sparingly. The system should feel machined, not floating.

```css
.sc-glass-dark {
  background: var(--sc-surface-dark-2);
  border: 1px solid var(--sc-border-dark);
  box-shadow:
    0 10px 28px rgba(16, 12, 9, .18),
    inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter: blur(var(--sc-backdrop-blur));
}

.sc-glass-light {
  background: var(--sc-surface-light-2);
  border: 1px solid var(--sc-border-light);
  box-shadow:
    0 8px 24px rgba(49, 36, 26, .10),
    inset 0 1px 0 rgba(255,255,255,.24);
  backdrop-filter: blur(var(--sc-backdrop-blur));
}
```

Use cyan glow only on active/focus states and keep it small.

---

## 10. Component rules

### Sidebar

- Espresso translucent shell.
- Active item receives cyan bar or cyan icon + controlled cyan wash.
- Navigation text is high contrast but not bright white everywhere.
- Section labels can use condensed uppercase micro-type.
- Brand mission may appear near the footer: **HELPING CRAFTSMEN BECOME BUSINESSMEN.**

### Top bar

- Warm transparent surface.
- Search field should be darker than the bar or lightly inset.
- Keep icons compact.
- Avoid large pill controls.

### KPI cards

- One primary value.
- One short label.
- One supporting metric or trend.
- Cyan only for command/action/live instrumentation; semantic colors for performance status.
- Use mini bars, rings, sparklines, or meters only when they answer a real question.

### Tables / schedules

- Dense work areas should generally use Light Glass 1 or Light Glass 2.
- Header row can use translucent espresso/graphite.
- Current day uses cyan outline/wash, not a huge solid block.
- Keep grid lines subtle.
- Use strong numeric alignment.
- Preserve generous row height and readable labels.
- Assignment blocks may use category colors.

### Crew panels

- Warm brown translucent surface.
- Status dots are semantic.
- Names remain high-contrast.
- Secondary employee/job IDs are subdued.
- Avoid over-ornamenting each row.

### Buttons

**Primary:** cyan fill, dark text.  
**Secondary:** transparent/dark glass with light border.  
**Danger:** red only when destructive or intervention-oriented.

```css
.sc-btn-primary {
  background: var(--sc-cyan);
  color: #071316;
  border: 1px solid rgba(255,255,255,.18);
  border-radius: var(--sc-radius-sm);
  font-weight: 800;
}
```

### Inputs

- Strong contrast with surrounding surface.
- 36-44 px typical control height on desktop.
- Cyan focus ring.
- Placeholder text must remain readable.

### Modals / drawers

- Dark Glass 3 or Light Glass 3 based on information density.
- Preserve global linen/brown context around the modal.
- Do not turn modals into pure black slabs.

---

## 11. Screen-density strategy

### Cinematic / command screens

Examples: Home, Executive Dashboard, Sales Command landing, Field Command landing.

Use:

- More dark glass
- Hero imagery or industrial line art where useful
- Large KPIs
- Strong condensed typography
- Cyan instrumentation

### Dense operational screens

Examples: Crew Schedule, Calendar, AR lists, job lists, estimating tables, production logs.

Use:

- Warm translucent light canvas for the primary work area
- Dark glass for framing/navigation/header metrics
- Strong row hierarchy
- Minimal visual decoration
- Cyan for selection/navigation only

This combination is critical. Do not force all screens into an all-dark theme.

---

## 12. Photography and imagery

Allowed:

- Concrete work
- Surface prep
- Grinding/polishing equipment
- Construction sites
- Skilled tradespeople
- Steel, tools, machinery, trucks
- Real field conditions

Treatment:

- Warm/desaturated
- High-contrast
- Slightly cinematic
- Often partially obscured behind translucent surfaces

Do not use:

- Generic office-team stock photography
- Lifestyle/wellness imagery
- Futuristic holograms
- Fake tactical soldiers/camouflage
- Overly glossy corporate construction stock

---

## 13. Motion

```css
:root {
  --sc-motion-fast: 120ms;
  --sc-motion-normal: 180ms;
  --sc-motion-slow: 240ms;
  --sc-ease: cubic-bezier(.2,.8,.2,1);
}
```

Use motion for:

- Hover/selected changes
- Navigation state
- Expand/collapse
- Small progress updates
- Drawer/modal transitions

Avoid looping animation, neon pulsing, excessive glow, bouncing, or game-like effects.

---

## 14. Accessibility and eye-strain rules

- Body text must meet WCAG AA contrast wherever practical.
- Never place small gray text directly on busy photography.
- If the linen texture competes with content, increase surface opacity before removing the texture globally.
- Avoid pure white on pure black across large areas.
- Prefer warm off-white text on dark surfaces.
- Use 13 px minimum for dense desktop data unless space is extremely constrained.
- Do not rely on color alone for critical status.
- Maintain visible keyboard focus using cyan.

---

## 15. DO / DON'T

### DO

- Let brown linen remain visible.
- Use translucent surfaces.
- Use cyan as an intentional pop.
- Use condensed type for performance and command language.
- Keep tables crisp and highly readable.
- Use status color semantically.
- Make the UI feel premium, industrial, and operational.
- Preserve existing functional density.

### DON'T

- Do not use opaque black as the default screen background.
- Do not turn cyan into teal.
- Do not make every card glow.
- Do not use oversized rounded SaaS cards.
- Do not use pastel/lifestyle styling.
- Do not make the interface look like a video game.
- Do not add military camouflage, stencil clichés, or tactical cosplay.
- Do not texture individual controls.
- Do not redesign workflows while applying the theme.

---

## 16. Reference component CSS

```css
.sc-panel-dark {
  color: var(--sc-white);
  background: var(--sc-surface-dark-2);
  border: 1px solid var(--sc-border-dark);
  border-radius: var(--sc-radius-md);
  backdrop-filter: blur(10px);
}

.sc-panel-light {
  color: var(--sc-ink);
  background: var(--sc-surface-light-2);
  border: 1px solid var(--sc-border-light);
  border-radius: var(--sc-radius-md);
  backdrop-filter: blur(10px);
}

.sc-active {
  border-color: rgba(18,216,242,.72);
  box-shadow: inset 3px 0 0 var(--sc-cyan);
}

.sc-focusable:focus-visible {
  outline: 2px solid var(--sc-cyan);
  outline-offset: 2px;
}

.sc-kpi-value {
  font-family: var(--sc-font-display);
  font-weight: 800;
  letter-spacing: -.02em;
  line-height: .95;
}

.sc-command-label {
  font-family: var(--sc-font-display);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
}
```

---

## 17. Implementation sequence for existing screens

When theming an existing screen, work in this order:

1. Preserve structure and functionality.
2. Apply global shell: linen/brown environment.
3. Apply sidebar/top-bar theme.
4. Classify each major surface as Dark Glass or Light Glass.
5. Apply typography hierarchy.
6. Replace arbitrary accent colors with cyan or semantic colors.
7. Normalize radii, borders, and shadows.
8. Normalize buttons, tabs, inputs, chips, and selected states.
9. Check dense data readability at laptop width.
10. Check mobile/tablet behavior.
11. Run contrast/accessibility review.
12. Compare against the canonical Crew Schedule reference.

---

## 18. AI coding-agent acceptance checklist

Before declaring a UI task complete, verify:

- [ ] Existing functionality and data behavior are unchanged unless explicitly requested.
- [ ] Brown/linen environment is still visible.
- [ ] No major surface is unnecessarily pure black.
- [ ] Cyan, not teal, is the command accent.
- [ ] Dark and light glass opacities use approved tokens.
- [ ] Typography follows the display/UI hierarchy.
- [ ] Semantic colors mean something operational.
- [ ] Dense areas remain easy to read.
- [ ] Corner radii are controlled and consistent.
- [ ] Hover, focus, selected, disabled, loading, and error states are themed.
- [ ] No generic SaaS/lifestyle styling has been introduced.
- [ ] Screen visually belongs to the same product as the canonical Crew Schedule reference.

---

## 19. Standard prompt for coding terminals

Copy this into a coding session when applying the theme:

```text
Read SUBCON_COMMAND_UI_STANDARD.md before making changes.

Apply the Subcon Command design system to this screen without redesigning its workflow or changing existing functionality, data bindings, information architecture, or responsive behavior unless I explicitly request a functional change.

Use the approved visual language: warm brown linen environment, translucent espresso/graphite dark surfaces, translucent warm sand/ivory work surfaces, cyan command accent, condensed industrial performance typography, precise low-radius geometry, subtle borders, restrained depth, and semantic operational colors.

The canonical visual reference is the approved Crew Schedule theme. The result must feel like premium construction operating software: tactical, performance-driven, field credible, readable, and financially focused. Avoid pure-black slabs, teal accents, generic SaaS cards, lifestyle softness, sci-fi styling, gamer effects, or military clichés.

Before finishing, verify all UI states and compare the result against the acceptance checklist in the standard.
```

---

## 20. Final principle

**The interface should feel like equipment, not decoration.**

Subcon Command exists to help craftsmen run stronger businesses. Every visual decision should improve the user's sense of operational control: people, schedule, quality, production, margin, and cash.

---

## 18. Locked Subcon Command identity mark

**Status: LOCKED. Master geometry: Geometry A - Bold & Open.**

The Subcon Command symbol is not to be redrawn, reinterpreted, stretched, rotated, or regenerated by an AI model. Production assets must be derived from the approved master vector geometry once created from Geometry A.

### Brand meaning

The mark combines three ideas:

1. **Hexagonal bolt head** - construction, hardware, fastening, strength, reliability, and engineered systems.
2. **Two complementary interlocking pieces** - craftsmanship and business; field and office; labor and intellect; production and margin; people and systems.
3. **Center S / negative space** - Subcon Command. The center must remain open enough to read immediately as an S at small sizes.

The two pieces must feel as if they were machined from one system: separate, complementary, and able to fit perfectly together.

> **Subcon Command should feel like professional equipment that happens to run on a screen.**

### Master geometry rules

- Use **Geometry A - Bold & Open** as the canonical silhouette.
- Preserve the regular hexagonal / bolt-head silhouette.
- Preserve equal visual weight between the two complementary pieces.
- Preserve the open center S and generous negative-space gap.
- All primary angles are based on the 60-degree / 120-degree hexagonal system.
- Do not tighten the center merely to make the mark look more technical. Readability and recognition win.
- Do not introduce impossible-perspective / Escher geometry. The pieces should read as physically manufacturable parts.
- Do not alter geometry between the premium, utility, monochrome, app, desktop, or favicon versions. Optical simplification at micro sizes may remove surface detail, but not change the silhouette.

### Official mark hierarchy

**1. Premium / dimensional mark**

Use for login, splash, website hero, marketing, presentations, large navigation branding, print, apparel, signage, and other large-format applications.

- Geometry A is unchanged.
- Cyan interlocking pieces.
- Gunmetal / machined bolt structure.
- Dark recessed negative space.
- Physical depth may include restrained bevels, brushed metal, micro-scratches, and realistic shadows.
- Avoid glass, neon glow, sci-fi lighting, excessive chrome, or gaming-logo effects.

**2. Utility / recognition mark**

Use for app icons, desktop icons, favicons, menus, navigation, compact UI, and small-format digital applications.

- Cyan hexagonal bolt silhouette.
- Black / espresso complementary pieces.
- Cyan center negative space.
- Minimal or no texture at small sizes.
- Strong silhouette takes priority over material realism.

**3. Monochrome mark**

Use for engraving, embossing, stamps, one-color printing, embroidery constraints, invoices, and accessibility cases. Preserve the exact Geometry A silhouette and center S.

### Size behavior

- **1024-512 px:** full dimensional treatment is allowed.
- **256-128 px:** simplify material detail; retain subtle bevel only if crisp.
- **64-32 px:** use the flat utility construction. No texture, glow, scratches, or complex shadows.
- **16 px:** use the simplest approved utility glyph. The center S must remain visibly open.

Never shrink the dimensional hero render and call it a favicon.

### Clear space

Maintain clear space around the standalone symbol equal to at least **25% of the symbol height** on all sides. For hero/marketing placements, prefer 35-50% where composition allows.

### Logo color tokens

```css
:root {
  --sc-logo-cyan: #00CFE8;
  --sc-logo-black: #0B0B0B;
  --sc-logo-gunmetal: #6B7280;
  --sc-logo-linen: #D7C6B1;
}
```

Use the broader UI palette when integrating the mark into the application. Do not introduce alternate brand colors into the logo.

### Forbidden alterations

Do not:

- stretch, skew, rotate, or crop the symbol;
- change the interlock geometry or center S;
- make the two pieces different arbitrary colors;
- substitute purple, green, orange, or generic blue for cyan;
- add neon outlines or strong glow;
- turn the mark into translucent glass;
- add gradients that obscure the two-piece construction;
- place text inside the hexagon;
- use the detailed dimensional mark below the size at which its materials remain legible;
- ask an image generator to recreate the production logo from a prompt.

### Coding-agent rule

**Never recreate the Subcon Command mark with CSS polygons, text glyphs, icon libraries, or generative image tools when an approved asset is available.** Reference the official SVG/PNG asset from the brand asset directory. Geometry is brand IP and is not an implementation detail to improvise.

Recommended asset naming:

```text
/assets/brand/subcon-command-mark-master.svg
/assets/brand/subcon-command-mark-premium.png
/assets/brand/subcon-command-mark-utility.svg
/assets/brand/subcon-command-mark-mono-dark.svg
/assets/brand/subcon-command-mark-mono-light.svg
/assets/brand/subcon-command-app-icon-1024.png
/assets/brand/subcon-command-desktop-icon-512.png
/assets/brand/favicon-32.png
/assets/brand/favicon-16.png
```

### Recognition principle

At large sizes, **material and depth create premium character**. At small sizes, **silhouette and contrast create recognition**. Both expressions must always resolve to the same Geometry A mark.

