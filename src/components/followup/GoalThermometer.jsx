// Hand-rolled goal thermometer (home-engagement-redesign.md part 5 §E — no chart lib).
// The whole team's money SOLD this month vs the un-split company goal. One rope,
// NO ranking, NO leaderboard. Company-wide (never rep-scoped) — it sums all
// proposals incl. orphan Sold (N2 / REG-1). Calm and static (no slide-up — that
// lives with the deferred %-runway, F49). Independent of the runway state.
//
// Geometry: horizontal rounded track, height 12, radius 6, track C.linenDeep,
// fill = pct% in teal, pct label right-anchored (anchor-both-edges).
import { C, F } from "../../lib/tokens";
import { fmt$ } from "../../lib/utils";

export default function GoalThermometer({ sold = 0, goal = 0, pct = 0 }) {
  const w = Math.max(0, Math.min(100, pct)); // fill never overflows the track
  return (
    <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: 24, boxShadow: "0 2px 8px rgba(28,24,20,0.07)" }}>
      {/* anchor both edges: label hard-left, "everyone pulls" hard-right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textLight, fontFamily: F.ui }}>Company Goal · One Rope</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.ui }}>everyone pulls</div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 40, fontWeight: 800, color: C.tealDeep, fontFamily: F.display, lineHeight: 1 }}>{fmt$(sold)}</span>
        <span style={{ fontSize: 13, color: C.textMuted, fontFamily: F.body }}>of {fmt$(goal)} this month</span>
      </div>

      <div style={{ position: "relative", height: 12, borderRadius: 6, background: C.linenDeep, overflow: "hidden" }}>
        <div style={{ width: `${w}%`, height: "100%", background: C.teal, borderRadius: 6, transition: "width 0.4s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.tealDeep, fontFamily: F.ui }}>{pct}%</span>
      </div>
    </div>
  );
}
