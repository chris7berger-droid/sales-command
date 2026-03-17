import { useState, useEffect } from "react";
import { C, F } from "../lib/tokens";
import { fmt$, tod } from "../lib/utils";
import { STAGES } from "../lib/mockData";
import { supabase } from "../lib/supabase";
import StatCard from "../components/StatCard";
import SectionHeader from "../components/SectionHeader";

const GOALS = {
  monthlyBilling:  450000,
  yearlyBilling:  5400000,
  conversionRate:      50, // %
  proposalsSent:       30, // per month
};

function GoalCard({ label, actual, goal, fmt = v => v, accent = C.teal }) {
  const pct     = Math.min(Math.round((actual / goal) * 100), 100);
  const color   = pct >= 100 ? C.green : pct >= 60 ? C.amber : C.red;
  const barW    = `${pct}%`;

  return (
    <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: "20px 24px", boxShadow: "0 2px 8px rgba(28,24,20,0.07)", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.ui }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.02em", lineHeight: 1 }}>
          {fmt(actual)}
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, paddingBottom: 3 }}>
          goal {fmt(goal)}
        </div>
      </div>
      <div style={{ height: 8, background: C.border, borderRadius: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", width: barW, background: color, borderRadius: 6, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: F.ui }}>{pct}% of goal</span>
        <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>
          {pct >= 100 ? "🎯 Goal reached!" : `${fmt(goal - actual)} to go`}
        </span>
      </div>
    </div>
  );
}

export default function Home({ displayName = "there", displayRole = "Sales Rep" }) {
 
  const [rows,          setRows]          = useState([]);
  const [monthRows,     setMonthRows]     = useState([]);
  const [billing,       setBilling]       = useState(0);
  const [ytd,           setYtd]           = useState(0);
  const [proposalsSent, setProposalsSent] = useState(0);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    async function load() {
      const now   = new Date();
      const month = now.toISOString().slice(0, 7);
      const year  = now.getFullYear().toString();

      const isRep = !["Admin","Manager"].includes(displayRole);
      let logQuery = supabase.from("call_log").select("*").order("created_at", { ascending: false });
      if (isRep) logQuery = logQuery.eq("sales_name", displayName);
      const { data: log } = await logQuery;
      setRows(log || []);
      const monthLog = (log || []).filter(r => r.created_at?.startsWith(month));
      setMonthRows(monthLog);

      let propQuery = supabase.from("proposals").select('total, approved_at, created_at, status, call_log_id, call_log(sales_name)');
      const { data: props } = await propQuery;
      const filteredProps = isRep ? (props || []).filter(p => p.call_log?.sales_name === displayName) : (props || []);

      const monthBill = filteredProps
        .filter(p => p.approved_at?.startsWith(month))
        .reduce((sum, p) => sum + (p.total || 0), 0);

      const ytdBill = filteredProps
        .filter(p => p.approved_at?.startsWith(year))
        .reduce((sum, p) => sum + (p.total || 0), 0);

      const sent = filteredProps
        .filter(p => ["Sent","Viewed","Approved Internally","Approved"].includes(p.status))
        .length;

      setBilling(monthBill);
      setYtd(ytdBill);
      setProposalsSent(sent);
      setLoading(false);
    }
    load();
  }, [displayName, displayRole]);

  const sc           = STAGES.reduce((a, s) => ({ ...a, [s]: monthRows.filter(r => r.stage === s).length }), {});
  const pCol         = { "New Inquiry": C.teal, "Wants Bid": C.amber, "Has Bid": C.purple, Sold: C.green, Lost: C.red };
  const tot          = STAGES.reduce((a, s) => a + (sc[s] || 0), 0) || 1;
  const bids         = rows.filter(r => r.bid_due === tod()).length;
  const fups         = rows.filter(r => r.follow_up === tod()).length;
  const soldCount    = sc["Sold"] || 0;
  const totalClosed  = soldCount + (sc["Lost"] || 0);
  const convRate     = totalClosed > 0 ? Math.round((soldCount / totalClosed) * 100) : 0;
  const firstName    = displayName.split(" ")[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>

      {/* GREETING */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.ui, marginBottom: 6 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase", lineHeight: 1.1 }}>
          Good Morning, {firstName}
        </h1>
        <p style={{ margin: "8px 0 0", color: C.textMuted, fontSize: 14.5, fontFamily: F.body }}>
          Here's the state of the pipeline today.
        </p>
      </div>

      {/* ALERT BANNER */}
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

      {/* STAT CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(172px,1fr))", gap: 12 }}>
        <StatCard label="New Inquiries" value={loading ? "…" : sc["New Inquiry"] || 0} sub="This month" accent={C.teal} />
        <StatCard label="Wants Bid"     value={loading ? "…" : sc["Wants Bid"]   || 0} sub="Active"     accent={C.amber} />
        <StatCard label="Has Bid"       value={loading ? "…" : sc["Has Bid"]     || 0} sub="Awaiting"   accent={C.purple} />
        <StatCard label="Sold"          value={loading ? "…" : sc["Sold"]        || 0} sub="This month" accent={C.green} />
      </div>

      {/* PIPELINE BAR */}
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

      {/* GOAL SCORECARDS */}
      <SectionHeader title="Monthly Goals" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
        <GoalCard label="Monthly Billings"  actual={loading ? 0 : billing}       goal={GOALS.monthlyBilling}  fmt={fmt$}          accent={C.teal} />
        <GoalCard label="Yearly Sales"      actual={loading ? 0 : ytd}           goal={GOALS.yearlyBilling}   fmt={fmt$}          accent={C.tealDark} />
        <GoalCard label="Conversion Rate"   actual={loading ? 0 : convRate}      goal={GOALS.conversionRate}  fmt={v => `${v}%`}  accent={C.green} />
        <GoalCard label="Proposals Sent"    actual={loading ? 0 : proposalsSent} goal={GOALS.proposalsSent}   fmt={v => `${v}`}   accent={C.purple} />
      </div>

    </div>
  );
}