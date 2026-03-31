import { useState, useEffect } from "react";
import { C, F } from "../lib/tokens";
import { fmt$, tod } from "../lib/utils";
import { STAGES } from "../lib/mockData";
import { supabase } from "../lib/supabase";
import { getTenantConfig, DEFAULTS } from "../lib/config";
import StatCard from "../components/StatCard";
import SectionHeader from "../components/SectionHeader";

function GoalCard({ label, actual, goal, fmt = v => v, accent = C.teal, onClick, items = [] }) {
  const pct     = Math.min(Math.round((actual / goal) * 100), 100);
  const color   = pct >= 100 ? C.green : pct >= 60 ? C.amber : C.red;
  const barW    = `${pct}%`;

  return (
    <div onClick={onClick} style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: "20px 24px", boxShadow: "0 2px 8px rgba(28,24,20,0.07)", display: "flex", flexDirection: "column", gap: 12, cursor: onClick ? "pointer" : "default", transition: "transform 0.15s ease" }} onMouseEnter={e => { if (onClick) e.currentTarget.style.transform = "translateY(-2px)"; }} onMouseLeave={e => { if (onClick) e.currentTarget.style.transform = "none"; }}>
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
          {pct >= 100 ? "Goal reached!" : `${fmt(goal - actual)} to go`}
        </span>
      </div>
    </div>
  );
}

function GoalDrilldown({ title, items, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.linen, border: `1px solid ${C.borderStrong}`, borderRadius: 14, width: "90%", maxWidth: 540, maxHeight: "70vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(28,24,20,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textHead, fontFamily: F.display }}>{title}</span>
          <span onClick={onClose} style={{ cursor: "pointer", fontSize: 18, color: C.textMuted, lineHeight: 1 }}>✕</span>
        </div>
        <div style={{ overflowY: "auto", padding: "8px 0" }}>
          {items.length === 0 && (
            <div style={{ padding: "24px 20px", textAlign: "center", color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>No items to show</div>
          )}
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", background: i % 2 === 0 ? "transparent" : C.linenDeep, gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.jobNumber ? `${item.jobNumber} — ` : ""}{item.jobName || "Untitled"}
                </div>
                <div style={{ fontSize: 11.5, color: C.textMuted, fontFamily: F.ui, marginTop: 2 }}>
                  {item.customer}{item.status ? ` · ${item.status}` : ""}
                </div>
              </div>
              {item.total != null && (
                <div style={{ fontSize: 14, fontWeight: 700, color: C.teal, fontFamily: F.ui, whiteSpace: "nowrap" }}>{fmt$(item.total)}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home({ displayName = "there", displayRole = "Sales Rep", setActive, setBidDueFilter, onStageFilter }) {

  const [rows,          setRows]          = useState([]);
  const [monthRows,     setMonthRows]     = useState([]);
  const [billing,       setBilling]       = useState(0);
  const [ytd,           setYtd]           = useState(0);
  const [proposalsSent, setProposalsSent] = useState(0);
  const [soldTotal,       setSoldTotal]       = useState(0);
  const [monthItems,    setMonthItems]    = useState([]);
  const [ytdItems,      setYtdItems]      = useState([]);
  const [sentItems,     setSentItems]     = useState([]);
  const [drilldown,     setDrilldown]     = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [GOALS, setGOALS] = useState({ monthlyBilling: DEFAULTS.monthly_billing_goal, yearlyBilling: DEFAULTS.yearly_billing_goal, conversionRate: DEFAULTS.conversion_rate_goal, proposalsSent: DEFAULTS.proposals_sent_goal });

  useEffect(() => {
    getTenantConfig().then(cfg => setGOALS({
      monthlyBilling: cfg.monthly_billing_goal,
      yearlyBilling: cfg.yearly_billing_goal,
      conversionRate: cfg.conversion_rate_goal,
      proposalsSent: cfg.proposals_sent_goal,
    }));
  }, []);

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

      let propQuery = supabase.from("proposals").select('total, approved_at, created_at, status, call_log_id, call_log(sales_name, job_name, display_job_number, customer_name), proposal_wtc(end_date)');
      const { data: props } = await propQuery;
      const filteredProps = isRep ? (props || []).filter(p => p.call_log?.sales_name === displayName) : (props || []);

      const getEndDate = p => {
        const wtcs = p.proposal_wtc || [];
        const dates = wtcs.map(w => w.end_date).filter(Boolean).sort();
        return dates[dates.length - 1] || null;
      };

      const toItem = p => ({ jobName: p.call_log?.job_name, jobNumber: p.call_log?.display_job_number, customer: p.call_log?.customer_name || "", total: p.total || 0, status: p.status });

      const monthSold = filteredProps.filter(p => p.status === "Sold" && getEndDate(p)?.startsWith(month));
      const monthBill = monthSold.reduce((sum, p) => sum + (p.total || 0), 0);

      const ytdSold = filteredProps.filter(p => p.status === "Sold" && getEndDate(p)?.startsWith(year));
      const ytdBill = ytdSold.reduce((sum, p) => sum + (p.total || 0), 0);

      const sentList = filteredProps.filter(p => ["Sent","Viewed","Approved","Sold","Lost"].includes(p.status));

      setBilling(monthBill);
      setYtd(ytdBill);
      setProposalsSent(sentList.length);
      setSoldTotal(filteredProps.filter(p => p.status === "Sold").length);
      setMonthItems(monthSold.map(toItem));
      setYtdItems(ytdSold.map(toItem));
      setSentItems(sentList.map(toItem));
      setLoading(false);
    }
    load();
  }, [displayName, displayRole]);

  const sc = STAGES.reduce((a, s) => ({ ...a, [s]: (["Has Bid","Sold"].includes(s) ? rows : monthRows).filter(r => r.stage === s).length }), {});
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
        <div onClick={() => { if (setBidDueFilter) setBidDueFilter(true); if (setActive) setActive("calllog"); }} style={{ background: "rgba(249,168,37,0.12)", border: "1.5px solid rgba(249,168,37,0.4)", borderRadius: 10, padding: "11px 18px", display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}>
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
        <StatCard label="New Inquiries" value={loading ? "…" : sc["New Inquiry"] || 0} sub="This month" accent={C.teal}   onClick={() => onStageFilter && onStageFilter("New Inquiry")} />
        <StatCard label="Wants Bid"     value={loading ? "…" : sc["Wants Bid"]   || 0} sub="Active"     accent={C.amber}  onClick={() => onStageFilter && onStageFilter("Wants Bid")} />
        <StatCard label="Has Bid"       value={loading ? "…" : sc["Has Bid"]     || 0} sub="Awaiting"   accent={C.purple} onClick={() => onStageFilter && onStageFilter("Has Bid")} />
        <StatCard label="Sold"          value={loading ? "…" : soldTotal} sub="All time" accent={C.green}  onClick={() => onStageFilter && onStageFilter("Sold")} />
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
        <GoalCard label="Monthly Billings"  actual={loading ? 0 : billing}       goal={GOALS.monthlyBilling}  fmt={fmt$}          accent={C.teal}     onClick={() => setDrilldown({ title: "Monthly Billings", items: monthItems })} />
        <GoalCard label="Yearly Sales"      actual={loading ? 0 : ytd}           goal={GOALS.yearlyBilling}   fmt={fmt$}          accent={C.tealDark} onClick={() => setDrilldown({ title: "Yearly Sales", items: ytdItems })} />
        <GoalCard label="Conversion Rate"   actual={loading ? 0 : convRate}      goal={GOALS.conversionRate}  fmt={v => `${v}%`}  accent={C.green} />
        <GoalCard label="Proposals Sent"    actual={loading ? 0 : proposalsSent} goal={GOALS.proposalsSent}   fmt={v => `${v}`}   accent={C.purple}   onClick={() => setDrilldown({ title: "Proposals Sent", items: sentItems })} />
      </div>

      {drilldown && <GoalDrilldown title={drilldown.title} items={drilldown.items} onClose={() => setDrilldown(null)} />}

    </div>
  );
}