import { C, F, R, SP } from "../lib/tokens";

// Dark hero "pipeline" panel — the top-of-screen stat strip on Call Log,
// Proposals, and Invoices (matches the 2026-08-22 mockup). Generic: each screen
// passes its own stat `items` and bar `segments`, so there's one panel, not
// three twins. Cards are clickable (drill into the jobs behind the number).
//
// item: { key, glyph, color, value, label, sub, subColor?, onClick?, active? }
// segment: { color, value }  — proportional widths for the gradient-style bar
const LIGHT = "#f3ede1";
const LIGHT_MUTED = "rgba(243,237,225,0.60)";

export default function PipelinePanel({ label, footnote, items = [], segments = [] }) {
  const segTotal = segments.reduce((s, x) => s + (x.value || 0), 0);
  return (
    <div style={{ background: C.dark, borderRadius: R.hero, padding: `${SP.lg}px ${SP.xl}px` }}>
      {label && (
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: LIGHT_MUTED, fontFamily: F.ui, marginBottom: SP.md }}>
          {label}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`, gap: SP.lg }}>
        {items.map(it => {
          const clickable = !!it.onClick;
          return (
            <button
              key={it.key}
              type="button"
              onClick={it.onClick}
              disabled={!clickable}
              title={clickable ? `View ${it.label} jobs` : undefined}
              style={{
                display: "flex", alignItems: "center", gap: SP.md, textAlign: "left",
                background: it.active ? "rgba(243,237,225,0.08)" : "transparent",
                border: it.active ? `1px solid ${it.color}` : "1px solid transparent",
                borderRadius: R.chip, padding: `${SP.sm}px ${SP.md}px`,
                cursor: clickable ? "pointer" : "default", transition: "background 0.12s",
              }}
              onMouseEnter={e => { if (clickable && !it.active) e.currentTarget.style.background = "rgba(243,237,225,0.05)"; }}
              onMouseLeave={e => { if (clickable && !it.active) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                flexShrink: 0, width: 48, height: 48, borderRadius: "50%", background: it.color,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, color: C.dark, fontWeight: 800,
              }}>
                {it.glyph}
              </span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: LIGHT, fontFamily: F.display, lineHeight: 1, letterSpacing: "0.01em", fontVariantNumeric: "tabular-nums" }}>
                  {it.value}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: LIGHT_MUTED, fontFamily: F.ui, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {it.label}
                </span>
                {it.sub != null && it.sub !== "" && (
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: it.subColor || C.teal, fontFamily: F.ui, marginTop: 4, whiteSpace: "nowrap" }}>
                    {it.sub}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {segTotal > 0 && (
        <div style={{ display: "flex", gap: 3, height: 5, borderRadius: 4, overflow: "hidden", marginTop: SP.lg }}>
          {segments.map((s, i) => {
            const pct = (s.value / segTotal) * 100;
            return pct > 0 ? <div key={i} style={{ width: `${pct}%`, background: s.color, minWidth: 3 }} /> : null;
          })}
        </div>
      )}

      {footnote && (
        <div style={{ textAlign: "center", fontSize: 12, color: LIGHT_MUTED, fontFamily: F.ui, marginTop: SP.md }}>
          {footnote}
        </div>
      )}
    </div>
  );
}
