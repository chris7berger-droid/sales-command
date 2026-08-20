// Box 6 results companion (home-engagement-redesign.md Box 6 / F51 v1).
// The payoff of working the call list, shown right beside it — because no rep
// works a list they can't see results from. Two stats, this rep, last 7 days:
// Activity (calls logged) + Impact ($ of stalled bids re-engaged). Passes the
// "pair, don't pad" rule: it serves the list it sits next to, doesn't restate
// numbers from elsewhere on the screen.
import { C, F, SP, R, FS } from "../../lib/tokens";
import { fmt$ } from "../../lib/utils";

function Stat({ value, label, sub }) {
  return (
    <div>
      <div style={{ fontSize: FS.boxNum, fontWeight: 800, color: C.teal, fontFamily: F.display, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(243,237,225,0.6)", fontFamily: F.ui, marginTop: SP.xs }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: "rgba(243,237,225,0.5)", fontFamily: F.body, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function HuntResultsPanel({ callsThisWeek = 0, reengaged = 0 }) {
  const worked = callsThisWeek > 0;
  return (
    <div style={{ background: C.dark, borderRadius: R.hero, padding: SP.xl, display: "flex", flexDirection: "column", gap: SP.xl, alignSelf: "start" }}>
      <div style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.teal, fontFamily: F.ui }}>This Week's Work</div>
      <Stat value={callsThisWeek} label="Calls logged" />
      <Stat value={fmt$(reengaged)} label="Back in motion" sub="stalled bids you re-engaged" />
      <div style={{ borderTop: `1px solid ${C.darkBorder}`, paddingTop: SP.md, fontSize: 12.5, color: "rgba(243,237,225,0.6)", fontFamily: F.body, lineHeight: 1.4 }}>
        {worked ? "Every call worked moves a bid off the dead pile. Keep pulling." : "Log a call to start putting stalled money back in play."}
      </div>
    </div>
  );
}
