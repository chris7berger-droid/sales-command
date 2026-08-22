// Hand-rolled SVG money donut (home-engagement-redesign.md part 5 §E — no chart lib).
// TWO views only, cycling on tap: Booked-vs-left → Big-vs-small → (back to Booked).
// The work-type view (part 3 View 2) is DEFERRED to v1.1 — do NOT add it here.
// Session-local: view index lives in component state, so it resets to the default
// (Booked-vs-left) on reload. Read-only glance — never drills in (drill-in is Box 4).
//
// Geometry: viewBox 0 0 100 100, r=42, stroke-width 16, circumference C=2πr≈263.9.
// Slices fill from the top (group rotated -90°); each slice dash = (pct/100)·C,
// offsets accumulated. Empty ($0) → muted full ring. Over-target (View 1 >100%) →
// full teal ring + a thin inner overflow arc, never a broken >100% ring.
import { useState } from "react";
import { C, F } from "../../lib/tokens";
import { fmt$ } from "../../lib/utils";

const CX = 50, CY = 50, RAD = 42, SW = 16;
const CIRC = 2 * Math.PI * RAD; // ≈ 263.9

function Ring({ slices, over }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  let offset = 0;
  return (
    <svg viewBox="0 0 100 100" style={{ width: 116, height: 116, flexShrink: 0 }}>
      <g transform="rotate(-90 50 50)">
        {/* track */}
        <circle cx={CX} cy={CY} r={RAD} fill="none" stroke={C.linenDeep} strokeWidth={SW} />
        {total <= 0 ? null : slices.map((s, i) => {
          const frac = Math.max(0, s.value) / total;
          const len = frac * CIRC;
          const dash = <circle key={i} cx={CX} cy={CY} r={RAD} fill="none" stroke={s.color}
            strokeWidth={SW} strokeDasharray={`${len} ${CIRC - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return dash;
        })}
        {/* over-target: a thin bright overflow arc inside the ring, ~15% sweep */}
        {over && (
          <circle cx={CX} cy={CY} r={RAD - SW / 2 - 3} fill="none" stroke={C.teal} strokeWidth={3}
            strokeLinecap="round" strokeDasharray={`${0.15 * 2 * Math.PI * (RAD - SW / 2 - 3)} ${2 * Math.PI * (RAD - SW / 2 - 3)}`} />
        )}
      </g>
    </svg>
  );
}

export default function MoneyDonut({ views }) {
  const [idx, setIdx] = useState(0);
  const view = views[idx];
  const next = views[(idx + 1) % views.length];
  const advance = () => setIdx(i => (i + 1) % views.length);

  return (
    <div
      role="button" tabIndex={0} onClick={advance}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); advance(); } }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
    >
      {/* name the CURRENT view so it's never ambiguous which split you're looking at */}
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textLight, fontFamily: F.ui, textAlign: "center" }}>{view.tapLabel}</div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Ring slices={view.slices} over={view.over} />
        <div style={{ position: "absolute", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, lineHeight: 1 }}>{view.center}</div>
          {view.centerSub && <div style={{ fontSize: 9, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>{view.centerSub}</div>}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%" }}>
        {view.slices.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontFamily: F.ui }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: C.textMuted, fontWeight: 600 }}>{s.label}</span>
            <span style={{ marginLeft: "auto", color: C.textHead, fontWeight: 700 }}>{fmt$(s.value)}{s.pct != null ? ` · ${s.pct}%` : ""}</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, color: C.tealDark, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.1em" }}>
        Tap · {next.tapLabel}
      </div>
    </div>
  );
}
