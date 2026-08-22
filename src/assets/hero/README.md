# Home hero images — sourcing spec

**STATUS (2026-08-17):** v1 ships a **single static image** — `hero-01.jpg` is in place
(the sunrise-mountains shot from the approved mockup). The weekly **rotation** + the
full **~20-image set** are deferred to **backlog F50**. The spec below is the target for
F50; nothing is blocking the build now.

These are the photos in the **top-right of the Home engagement screen**
(`src/pages/Home.jsx`). In F50 one shows per week, changing on its own by week-of-year.
Plan: `docs/plans/home-engagement-redesign.md` (hero image / part 1 + part 4 §D1).

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
hero-01.jpg — https://images.unsplash.com/photo-1464822759023-fed622ff2c3b (Unsplash License, free commercial, no attribution) — the mockup's sunrise-mountains shot
hero-02.jpg — <source URL>   ← F50
...
```

## When these land

Drop the files in this folder, then the build wires the weekly-rotation helper
(`images[weekOfYear() % images.length]`) — nothing else to configure. If the final
count isn't exactly 20, that's fine; just keep the numbering sequential with no gaps
and the array length matches.
