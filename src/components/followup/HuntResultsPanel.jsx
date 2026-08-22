// Box 6 results companion (home-engagement-redesign.md Box 6 / F51 v1).
// The payoff of working the Sleepers list, shown right beside it — because no
// rep works a list they can't see results from. Two stats, this rep, last 7
// days: Activity (calls logged) + Impact ($ of stalled bids re-engaged). Both
// tap-through to their detail so a rep can go work them more. Passes the "pair,
// don't pad" rule: it serves the list it sits next to.
import { C, F, SP, R, FS } from "../../lib/tokens";
import { fmt$ } from "../../lib/utils";

function Stat({ value, label, sub, count, onClick }) {
  const clickable = count > 0 && onClick;
  return (
    <button
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      style={{
        textAlign: "left", background: "none", border: "none", padding: 0,
        cursor: clickable ? "pointer" : "default", width: "100%",
      }}
    >
      <div style={{ fontSize: FS.boxNum, fontWeight: 800, color: C.teal, fontFamily: F.display, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(243,237,225,0.6)", fontFamily: F.ui, marginTop: SP.xs }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: "rgba(243,237,225,0.5)", fontFamily: F.body, marginTop: 2 }}>{sub}</div>}
      {clickable && <div style={{ fontSize: 10, fontWeight: 700, color: C.tealDark, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>Tap to see them ›</div>}
    </button>
  );
}

export default function HuntResultsPanel({ callsThisWeek = 0, reengaged = 0, onDrill }) {
  const worked = callsThisWeek > 0;
  return (
    <div style={{ background: C.dark, borderRadius: R.hero, padding: SP.xl, display: "flex", flexDirection: "column", gap: SP.lg, alignSelf: "start" }}>
      <div style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.teal, fontFamily: F.ui }}>Waking Up the Sleepers</div>
      {/* two stats side-by-side so the card stays short, not a tall stack */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SP.lg }}>
        <Stat value={callsThisWeek} label="Calls logged" count={callsThisWeek} onClick={() => onDrill?.("calls")} />
        <Stat value={fmt$(reengaged)} label="Back in motion" sub="stalled bids you re-engaged" count={callsThisWeek} onClick={() => onDrill?.("jobs")} />
      </div>
      <div style={{ borderTop: `1px solid ${C.darkBorder}`, paddingTop: SP.md, fontSize: 12.5, color: "rgba(243,237,225,0.6)", fontFamily: F.body, lineHeight: 1.4 }}>
        {worked ? "Every sleeper you wake moves a bid off the dead pile. Keep pulling." : "Log a call to start waking up stalled money."}
      </div>
    </div>
  );
}
