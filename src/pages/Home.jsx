import { C, F } from "../lib/tokens";
import { fmt$, fmtD, tod, over } from "../lib/utils";
import { callLog, STAGES, STAGE_C } from "../lib/mockData";
import StatCard from "../components/StatCard";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";

export default function Home() {
  const sc   = STAGES.reduce((a, s) => ({ ...a, [s]: callLog.filter(r => r.stage === s).length }), {});
  const pCol = { "New Inquiry": C.teal, "Wants Bid": C.amber, "Has Bid": C.purple, Sold: C.green, Lost: C.red };
  const tot  = STAGES.reduce((a, s) => a + (sc[s] || 0), 0) || 1;
  const bids = callLog.filter(r => r.bidDue === tod()).length;
  const fups = callLog.filter(r => r.followUp === tod()).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.ui, marginBottom: 6 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase", lineHeight: 1.1 }}>
          Good Morning, Jordan
        </h1>
        <p style={{ margin: "8px 0 0", color: C.textMuted, fontSize: 14.5, fontFamily: F.body }}>
          Here's the state of the pipeline today.
        </p>
      </div>

      {(bids > 0 || fups > 0) && (
        <div style={{ background: "rgba(249,168,37,0.12)", border: "1.5px solid rgba(249,168,37,0.4)", borderRadius: 10, padding: "11px 18px", display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span style={{ fontSize: 13.5, color: "#7a5000", fontWeight: 700, fontFamily: F.ui }}>
            {bids > 0 && `${bids} bid${bids > 1 ? "s" : ""} due today`}
            {bids > 0 && fups > 0 && <span style={{ margin: "0 10px", opacity: 0.35 }}>|</span>}
            {fups > 0 && `${fups} follow-up${fups > 1 ? "s" : ""} today`}
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(172px,1fr))", gap: 12 }}>
        <StatCard label="New Inquiries"    value={8}            sub="This month"        accent={C.teal} />
        <StatCard label="Wants Bid"        value={3}            sub="Active"            accent={C.amber} />
        <StatCard label="Has Bid"          value={2}            sub="Awaiting decision" accent={C.purple} />
        <StatCard label="Sold"             value={2}            sub="This month"        accent={C.green} />
        <StatCard label="Monthly Billings" value={fmt$(132550)} sub="March 2026"        accent={C.teal} />
        <StatCard label="Yearly Sales"     value={fmt$(412800)} sub="YTD accepted"      accent={C.tealDark} />
      </div>

      <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "20px 24px", boxShadow: "0 2px 8px rgba(28,24,20,0.07)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textLight, fontFamily: F.ui, marginBottom: 12 }}>Pipeline Overview</div>
        <div style={{ display: "flex", gap: 3, height: 7, borderRadius: 6, overflow: "hidden" }}>
          {STAGES.map(s => {
            const pct = ((sc[s] || 0) / tot) * 100;
            return pct > 0 ? <div key={s} style={{ width: `${pct}%`, background: pCol[s], minWidth: 4 }} title={`${s}: ${sc[s]}`} /> : null;
          })}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" }}>
          {STAGES.map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: pCol[s] }} />
              <span style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui }}>
                {s} <strong style={{ color: C.textHead }}>{sc[s] || 0}</strong>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionHeader title="Recent Call Log" />
        <DataTable
          cols={[
            { k: "id",        l: "Job #",    r: v => <span style={{ fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{v}</span> },
            { k: "jobName",   l: "Job Name", r: v => <span style={{ fontWeight: 500 }}>{v}</span> },
            { k: "stage",     l: "Stage",    r: v => <Pill label={v} cm={STAGE_C} /> },
            { k: "salesName", l: "Rep" },
            { k: "bidDue",    l: "Bid Due",  r: v => <span style={{ color: over(v) ? C.red : C.textBody, fontWeight: 500 }}>{fmtD(v)}</span> },
          ]}
          rows={callLog.slice(0, 5)}
        />
      </div>
    </div>
  );
}