# Home hero images — sourcing spec

These are the rotating photos in the **top-right of the Home engagement screen**
(`src/pages/Home.jsx`). One image shows per week; it changes on its own by
week-of-year. Plan: `docs/plans/home-engagement-redesign.md` (hero rotation) +
this build's `[BLOCKED]` gate — the screen can't ship its hero until these exist.

## What to gather

| Spec | Value |
|---|---|
| **Theme** | Sunrise / landscape — calm, motivational, "new day, control the controllables." Non-literal (not job sites). |
| **Count** | **~20** (rotates ~5 months before repeating). Fewer/more is fine — see naming. |
| **Orientation** | **Landscape** (wide), never portrait. |
| **Size** | ≥ **1600px wide** (≈1600×1000 or wider). Final crop is CSS `object-fit: cover`, so exact ratio is flexible — just big + landscape. |
| **Format** | `.jpg` or `.webp`, **compressed** (aim < 300 KB each; ~20 × 300 KB keeps the bundle sane). |
| **Naming** | `hero-01.jpg`, `hero-02.jpg`, … `hero-20.jpg` — **zero-padded, sequential, NO gaps.** The rotation is `images[weekOfYear % count]`, so a gap would point at a missing file. |

## Licensing — the one rule the audit flagged

- **Download the file and commit it here. NEVER hotlink an external URL** (the mockup
  hotlinked Unsplash — that's the thing to avoid: it can change or vanish).
- Use a **free-for-commercial, no-attribution** source: **[Unsplash](https://unsplash.com)**
  or **[Pexels](https://pexels.com)**. Both licenses allow download + commercial use in
  a bundled app with no credit required.
- Optional but nice: paste the source URL for each file in the provenance list below,
  so we have a record even though attribution isn't required.

## Provenance (optional log)

```
hero-01.jpg — <source URL>
hero-02.jpg — <source URL>
...
```

## When these land

Drop the files in this folder, then the build wires the weekly-rotation helper
(`images[weekOfYear() % images.length]`) — nothing else to configure. If the final
count isn't exactly 20, that's fine; just keep the numbering sequential with no gaps
and the array length matches.
