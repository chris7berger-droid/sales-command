import React, { useState, useEffect } from "react";
import { C, F } from "../lib/tokens";
import { fmt$, tod } from "../lib/utils";
import { STAGES } from "../lib/mockData";
import { supabase } from "../lib/supabase";
import StatCard from "../components/StatCard";
import SectionHeader from "../components/SectionHeader";
import Btn from "../components/Btn";

const GOALS = {
  monthlyBilling:  450000,
  yearlyBilling:  5400000,
  conversionRate:      50,
  proposalsSent:       30,
};

// Any proposal that was actually sent to a customer
const SENT_STATUSES = ["Sent","Viewed","Approved","Sold","Lost"];

function GoalCard({ label, actual, goal, fmt = v => v, items = [] }) {
  const pct   = Math.min(Math.round((actual / goal) * 100), 100);
  const color = pct >= 100 ? C.green : pct >= 60 ? C.amber : C.red;
  const barW  = `${pct}%`;
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: "20px 24px", boxShadow: "0 2px 8px rgba(28,24,20,0.07)", display: "flex", flexDirection: "column", gap: 12, cursor: items.length ? "pointer" : "default" }}
      onClick={() => items.length && setOpen(o => !o)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.ui }}>{label}</div>
        {items.length > 0 && <span style={{ fontSize: 10, color: C.textFaint, fontFamily: F.ui }}>{open ? "▲" : "▼"} {items.length}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.02em", lineHeight: 1 }}>{fmt(actual)}</div>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, paddingBottom: 3 }}>goal {fmt(goal)}</div>
      </div>
      <div style={{ height: 8, background: C.border, borderRadius: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", width: barW, background: color, borderRadius: 6, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: F.ui }}>{pct}% of goal</span>
        <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>{pct >= 100 ? "Goal reached!" : `${fmt(goal - actual)} to go`}</span>
      </div>
      {open && items.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }} onClick={e => e.stopPropagation()}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontFamily: F.ui, color: C.textBody, padding: "4px 0" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                {it.sub && <span style={{ fontSize: 11, color: C.textFaint }}>{it.sub}</span>}
              </div>
              <span style={{ fontWeight: 700, color: C.textHead, marginLeft: 12, whiteSpace: "nowrap" }}>{it.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SalesDash({ displayName, displayRole }) {
  const [rows,          setRows]          = useState([]);
  const [monthRows,     setMonthRows]     = useState([]);
  const [billing,       setBilling]       = useState(0);
  const [ytd,           setYtd]           = useState(0);
  const [proposalsSent, setProposalsSent] = useState(0);
  const [soldTotal,     setSoldTotal]     = useState(0);
  const [loading,       setLoading]       = useState(true);

  const [billingItems,  setBillingItems]  = useState([]);
  const [ytdItems,      setYtdItems]      = useState([]);
  const [sentItems,     setSentItems]     = useState([]);
  const [convItems,     setConvItems]     = useState([]);

  const [forecastData,  setForecastData]  = useState([]);
  const [showForecast,  setShowForecast]  = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  const [salesReps,     setSalesReps]     = useState([]);
  const [selectedRep,   setSelectedRep]   = useState("__all__");

  const isAdmin = ["Admin","Manager"].includes(displayRole);

  useEffect(() => {
    supabase.from("team_members").select("name, role").eq("active", true).then(({ data }) => {
      const reps = (data || []).filter(t => ["Sales Rep","Admin","Manager"].includes(t.role)).map(t => t.name).sort();
      setSalesReps(reps);
      // If not admin, auto-select self
      if (!isAdmin && displayName) setSelectedRep(displayName);
    });
  }, [isAdmin, displayName]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const now   = new Date();
      const month = now.toISOString().slice(0, 7);
      const year  = now.getFullYear().toString();

      const filterByRep = selectedRep !== "__all__" ? selectedRep : null;

      let logQuery = supabase.from("call_log").select("*").order("created_at", { ascending: false });
      if (filterByRep) logQuery = logQuery.eq("sales_name", filterByRep);
      const { data: log } = await logQuery;
      setRows(log || []);
      setMonthRows((log || []).filter(r => r.created_at?.startsWith(month)));

      const { data: props } = await supabase.from("proposals").select("total, approved_at, created_at, status, call_log_id, call_log(sales_name, customer_name, job_name, customer_id, customers(billing_terms)), proposal_wtc(end_date)");
      const filteredProps = filterByRep ? (props || []).filter(p => p.call_log?.sales_name === filterByRep) : (props || []);

      const getEndDate = p => {
        const wtcs = p.proposal_wtc || [];
        const dates = wtcs.map(w => w.end_date).filter(Boolean).sort();
        return dates[dates.length - 1] || null;
      };

      // Monthly Billings
      const monthSold = filteredProps.filter(p => p.status === "Sold" && getEndDate(p)?.startsWith(month));
      setBilling(monthSold.reduce((s, p) => s + (p.total || 0), 0));
      setBillingItems(monthSold.map(p => ({ label: p.call_log?.job_name || p.call_log?.customer_name || "—", sub: p.call_log?.customer_name || "", value: fmt$(p.total) })));

      // YTD
      const ytdSold = filteredProps.filter(p => p.status === "Sold" && getEndDate(p)?.startsWith(year));
      setYtd(ytdSold.reduce((s, p) => s + (p.total || 0), 0));
      setYtdItems(ytdSold.map(p => ({ label: p.call_log?.job_name || p.call_log?.customer_name || "—", sub: p.call_log?.customer_name || "", value: fmt$(p.total) })));

      // Proposals Sent
      const sentProps = filteredProps.filter(p => SENT_STATUSES.includes(p.status));
      setProposalsSent(sentProps.length);
      setSentItems(sentProps.map(p => ({ label: p.call_log?.job_name || p.call_log?.customer_name || "—", sub: p.status, value: fmt$(p.total) })));

      // Conversion
      const soldList = filteredProps.filter(p => p.status === "Sold");
      const lostList = filteredProps.filter(p => p.status === "Lost");
      setSoldTotal(soldList.length);
      setConvItems([
        ...soldList.map(p => ({ label: p.call_log?.job_name || "—", sub: "Sold", value: fmt$(p.total) })),
        ...lostList.map(p => ({ label: p.call_log?.job_name || "—", sub: "Lost", value: fmt$(p.total) })),
      ]);

      // Cash Flow Forecast — Sold + pipeline (Has Bid / Sent statuses)
      const forecastStatuses = ["Sold", "Sent", "Viewed", "Approved Internally", "Approved"];
      const forecastProps = filteredProps.filter(p => forecastStatuses.includes(p.status));
      const yr = now.getFullYear();
      const months = Array.from({ length: 12 }, (_, i) => ({
        month: i,
        label: new Date(yr, i).toLocaleString("en-US", { month: "long" }),
        invoiced: 0,
        invoiceJobs: [],
        received: 0,
        receivedJobs: [],
      }));

      for (const p of forecastProps) {
        const endDate = getEndDate(p);
        if (!endDate) continue;
        const ed = new Date(endDate + "T00:00:00");
        if (ed.getFullYear() !== yr) continue;
        const invoiceMonth = ed.getMonth();
        const total = p.total || 0;
        const jobLabel = p.call_log?.job_name || p.call_log?.customer_name || "—";
        const billingTerms = p.call_log?.customers?.billing_terms || 30;

        months[invoiceMonth].invoiced += total;
        months[invoiceMonth].invoiceJobs.push({ label: jobLabel, total, status: p.status });

        // Payment month = invoice date + billing terms
        const payDate = new Date(ed);
        payDate.setDate(payDate.getDate() + billingTerms);
        if (payDate.getFullYear() === yr) {
          const payMonth = payDate.getMonth();
          months[payMonth].received += total;
          months[payMonth].receivedJobs.push({ label: jobLabel, total, terms: billingTerms, status: p.status });
        }
      }

      setForecastData(months);
      setLoading(false);
    }
    load();
  }, [displayName, displayRole, selectedRep]);

  const sc   = STAGES.reduce((a, s) => ({ ...a, [s]: (["Has Bid","Sold"].includes(s) ? rows : monthRows).filter(r => r.stage === s).length }), {});
  const pCol = { "New Inquiry": C.teal, "Wants Bid": C.amber, "Has Bid": C.purple, Sold: C.green, Lost: C.red };
  const tot  = STAGES.reduce((a, s) => a + (sc[s] || 0), 0) || 1;

  const soldCount   = sc["Sold"] || 0;
  const totalClosed = soldCount + (sc["Lost"] || 0);
  const convRate    = totalClosed > 0 ? Math.round((soldCount / totalClosed) * 100) : 0;

  const viewingName = selectedRep !== "__all__" ? selectedRep : "All Salespeople";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>

      {/* HEADER + PICKER */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.ui, marginBottom: 6 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase", lineHeight: 1.1 }}>
            {selectedRep !== "__all__" ? `${selectedRep.split(" ")[0]}'s Dashboard` : "Sales Dashboard"}
          </h1>
          {isAdmin && salesReps.length > 0 && (
            <select
              value={selectedRep}
              onChange={e => setSelectedRep(e.target.value)}
              style={{
                background: C.linenDeep, color: C.textBody, border: `1px solid ${C.borderStrong}`,
                borderRadius: 8, padding: "6px 12px", fontSize: 13, fontFamily: F.ui, fontWeight: 600,
                cursor: "pointer", WebkitAppearance: "none",
              }}
            >
              <option value="__all__">All Salespeople</option>
              {salesReps.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
        </div>
        <p style={{ margin: "8px 0 0", color: C.textMuted, fontSize: 14.5, fontFamily: F.body }}>
          {selectedRep !== "__all__" ? `Viewing ${viewingName}'s pipeline and goals.` : "Company-wide pipeline and goals."}
        </p>
      </div>

      {/* STAT CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(172px,1fr))", gap: 12 }}>
        <StatCard label="New Inquiries" value={loading ? "…" : sc["New Inquiry"] || 0} sub="This month" accent={C.teal} />
        <StatCard label="Wants Bid"     value={loading ? "…" : sc["Wants Bid"]   || 0} sub="Active"     accent={C.amber} />
        <StatCard label="Has Bid"       value={loading ? "…" : sc["Has Bid"]     || 0} sub="Awaiting"   accent={C.purple} />
        <StatCard label="Sold"          value={loading ? "…" : soldTotal}               sub="All time"   accent={C.green} />
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

      {/* GOAL SCORECARDS — clickable with drill-down */}
      <SectionHeader title="Monthly Goals" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
        <GoalCard label="Monthly Billings"  actual={loading ? 0 : billing}       goal={GOALS.monthlyBilling}  fmt={fmt$}          items={billingItems} />
        <GoalCard label="Yearly Sales"      actual={loading ? 0 : ytd}           goal={GOALS.yearlyBilling}   fmt={fmt$}          items={ytdItems} />
        <GoalCard label="Conversion Rate"   actual={loading ? 0 : convRate}      goal={GOALS.conversionRate}  fmt={v => `${v}%`}  items={convItems} />
        <GoalCard label="Proposals Sent"    actual={loading ? 0 : proposalsSent} goal={GOALS.proposalsSent}   fmt={v => `${v}`}   items={sentItems} />
      </div>

      {/* ACTION BUTTONS */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        <Btn onClick={() => setShowForecast(true)} v="dark">Cash Flow Forecast</Btn>
        <Btn onClick={() => setShowAnalytics(true)} v="dark">Analytics</Btn>
      </div>

      {/* MODALS */}
      {showForecast && <CashFlowModal data={forecastData} onClose={() => setShowForecast(false)} />}
      {showAnalytics && <AnalyticsModal onClose={() => setShowAnalytics(false)} selectedRep={selectedRep} />}

    </div>
  );
}

function CashFlowModal({ data, onClose }) {
  const [expandedRow, setExpandedRow] = useState(null);
  const yr = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const totalInvoiced = data.reduce((s, m) => s + m.invoiced, 0);
  const totalReceived = data.reduce((s, m) => s + m.received, 0);

  const thStyle = { padding: "11px 14px", textAlign: "left", fontWeight: 700, fontSize: 10.5, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.ui, whiteSpace: "nowrap" };
  const tdStyle = { padding: "12px 14px", fontSize: 13, fontFamily: F.ui, color: C.textBody, borderBottom: `1px solid ${C.border}` };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }} onClick={onClose}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 28, width: 700, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            {yr} Cash Flow Forecast
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textFaint, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.dark }}>
                <th style={thStyle}>Month</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Est. Invoice</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Est. Payment</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m, i) => {
                const isNow = i === currentMonth;
                const hasJobs = m.invoiceJobs.length > 0 || m.receivedJobs.length > 0;
                const expanded = expandedRow === i;
                return (
                  <React.Fragment key={i}>
                    <tr
                      onClick={() => hasJobs && setExpandedRow(expanded ? null : i)}
                      style={{
                        background: isNow ? C.tealGlow : i % 2 === 0 ? C.linenLight : C.linen,
                        cursor: hasJobs ? "pointer" : "default",
                        borderLeft: isNow ? `3px solid ${C.teal}` : "3px solid transparent",
                      }}
                    >
                      <td style={{ ...tdStyle, fontWeight: isNow ? 800 : 600 }}>
                        {m.label}
                        {hasJobs && <span style={{ fontSize: 10, color: C.textFaint, marginLeft: 6 }}>{expanded ? "▲" : "▼"}</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: m.invoiced > 0 ? C.textHead : C.textFaint }}>
                        {fmt$(m.invoiced)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: m.received > 0 ? C.green : C.textFaint }}>
                        {fmt$(m.received)}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={3} style={{ padding: 0, background: C.linenDeep }}>
                          <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                            {m.invoiceJobs.map((j, ji) => (
                              <div key={`inv-${ji}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: F.ui, padding: "3px 0" }}>
                                <span style={{ color: C.textBody }}>
                                  {j.label}
                                  {j.status !== "Sold" && <span style={{ marginLeft: 6, fontSize: 10, color: C.amber, fontWeight: 700 }}>PIPELINE</span>}
                                </span>
                                <span style={{ color: C.textHead, fontWeight: 600 }}>{fmt$(j.total)}</span>
                              </div>
                            ))}
                            {m.receivedJobs.length > 0 && m.receivedJobs.some(j => !m.invoiceJobs.some(ij => ij.label === j.label)) && (
                              <>
                                <div style={{ fontSize: 10, color: C.textFaint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>Payments from prior months</div>
                                {m.receivedJobs.filter(j => !m.invoiceJobs.some(ij => ij.label === j.label)).map((j, ji) => (
                                  <div key={`pay-${ji}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: F.ui, padding: "3px 0" }}>
                                    <span style={{ color: C.textBody }}>{j.label} <span style={{ fontSize: 10, color: C.textFaint }}>Net {j.terms}</span></span>
                                    <span style={{ color: C.green, fontWeight: 600 }}>{fmt$(j.total)}</span>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {/* TOTALS ROW */}
              <tr style={{ background: C.dark }}>
                <td style={{ padding: "12px 14px", fontSize: 12, fontWeight: 800, color: C.teal, fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.06em" }}>Total</td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontSize: 14, fontWeight: 800, color: C.teal, fontFamily: F.display }}>{fmt$(totalInvoiced)}</td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontSize: 14, fontWeight: 800, color: C.teal, fontFamily: F.display }}>{fmt$(totalReceived)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: C.textFaint, fontFamily: F.ui, lineHeight: 1.5 }}>
          Invoice month based on job end date. Payment month = invoice month + customer billing terms.
          <span style={{ marginLeft: 8, color: C.amber, fontWeight: 700 }}>PIPELINE</span> = not yet sold.
        </div>
      </div>
    </div>
  );
}

/* ─── Analytics Modal ─── */
function AnalyticsModal({ onClose, selectedRep }) {
  const [workTypes, setWorkTypes]     = useState([]);
  const [salesReps, setSalesReps]     = useState([]);
  const [wtcData, setWtcData]         = useState([]);
  const [invoiceData, setInvoiceData] = useState([]);
  const [loading, setLoading]         = useState(true);

  // Filters
  const yr = new Date().getFullYear();
  const [dateFrom, setDateFrom] = useState(`${yr}-01-01`);
  const [dateTo, setDateTo]     = useState(`${yr}-12-31`);
  const [filterWt, setFilterWt] = useState("__all__");
  const [filterRep, setFilterRep] = useState(selectedRep || "__all__");
  const [view, setView]         = useState("proposals"); // proposals | invoices

  useEffect(() => {
    async function load() {
      const [{ data: wt }, { data: tm }, { data: pwData }, { data: invData }] = await Promise.all([
        supabase.from("work_types").select("id, name").order("name"),
        supabase.from("team_members").select("name, role").eq("active", true),
        supabase.from("proposal_wtc").select("id, proposal_id, work_type_id, regular_hours, ot_hours, burden_rate, ot_burden_rate, markup_pct, materials, travel, discount, size, start_date, end_date, work_types(name), proposals(id, total, status, created_at, call_log_id, call_log(sales_name, customer_name, job_name))"),
        supabase.from("invoices").select("id, job_id, amount, status, sent_at, paid_at, job_name, invoice_lines(amount, proposal_wtc_id, proposal_wtc(work_type_id, work_types(name)))"),
      ]);
      setWorkTypes(wt || []);
      setSalesReps((tm || []).filter(t => ["Sales Rep","Admin","Manager"].includes(t.role)).map(t => t.name).sort());
      setWtcData(pwData || []);
      setInvoiceData(invData || []);
      setLoading(false);
    }
    load();
  }, []);

  const inputStyle = { padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.borderStrong}`, background: C.linenDeep, color: C.textBody, fontSize: 12, fontFamily: F.ui, WebkitAppearance: "none" };
  const thStyle = { padding: "10px 14px", textAlign: "left", fontWeight: 700, fontSize: 10.5, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.ui, whiteSpace: "nowrap" };
  const tdBase = { padding: "10px 14px", borderBottom: `1px solid ${C.border}`, fontSize: 13, fontFamily: F.ui };

  // --- PROPOSALS by work type ---
  const filteredWtc = wtcData.filter(pw => {
    const prop = pw.proposals;
    if (!prop) return false;
    if (!["Sent","Viewed","Approved Internally","Approved","Sold"].includes(prop.status)) return false;
    const d = pw.end_date || pw.start_date || prop.created_at?.slice(0, 10);
    if (d && (d < dateFrom || d > dateTo)) return false;
    if (filterRep !== "__all__" && prop.call_log?.sales_name !== filterRep) return false;
    if (filterWt !== "__all__" && String(pw.work_type_id) !== filterWt) return false;
    return true;
  });

  // Group by work type
  const propByWt = {};
  for (const pw of filteredWtc) {
    const wtName = pw.work_types?.name || "Unknown";
    if (!propByWt[wtName]) propByWt[wtName] = { total: 0, count: 0 };
    propByWt[wtName].total += (pw.proposals?.total || 0);
    propByWt[wtName].count += 1;
  }
  // Deduplicate proposal totals — each proposal counted once per work type it contains
  const propByWtDeduped = {};
  const seenProposals = {};
  for (const pw of filteredWtc) {
    const wtName = pw.work_types?.name || "Unknown";
    const propId = pw.proposal_id;
    const key = `${wtName}-${propId}`;
    if (!seenProposals[key]) {
      seenProposals[key] = true;
      if (!propByWtDeduped[wtName]) propByWtDeduped[wtName] = { total: 0, count: 0 };
      propByWtDeduped[wtName].total += (pw.proposals?.total || 0);
      propByWtDeduped[wtName].count += 1;
    }
  }

  // Group by sales rep
  const propByRep = {};
  const seenPropsByRep = {};
  for (const pw of filteredWtc) {
    const rep = pw.proposals?.call_log?.sales_name || "Unknown";
    const propId = pw.proposal_id;
    const key = `${rep}-${propId}`;
    if (!seenPropsByRep[key]) {
      seenPropsByRep[key] = true;
      if (!propByRep[rep]) propByRep[rep] = { total: 0, count: 0 };
      propByRep[rep].total += (pw.proposals?.total || 0);
      propByRep[rep].count += 1;
    }
  }

  const propWtEntries = Object.entries(propByWtDeduped).sort((a, b) => b[1].total - a[1].total);
  const propRepEntries = Object.entries(propByRep).sort((a, b) => b[1].total - a[1].total);
  const propGrandTotal = propWtEntries.reduce((s, [, v]) => s + v.total, 0);
  const maxWtTotal = propWtEntries.length > 0 ? propWtEntries[0][1].total : 1;

  // --- INVOICES by work type ---
  const filteredInv = invoiceData.filter(inv => {
    const d = inv.sent_at?.slice(0, 10) || inv.paid_at?.slice(0, 10);
    if (d && (d < dateFrom || d > dateTo)) return false;
    return true;
  });

  const invByWt = {};
  for (const inv of filteredInv) {
    for (const line of (inv.invoice_lines || [])) {
      const wtName = line.proposal_wtc?.work_types?.name || "Unknown";
      if (filterWt !== "__all__" && String(line.proposal_wtc?.work_type_id) !== filterWt) continue;
      if (!invByWt[wtName]) invByWt[wtName] = { invoiced: 0, paid: 0 };
      invByWt[wtName].invoiced += (line.amount || 0);
      if (inv.status === "Paid") invByWt[wtName].paid += (line.amount || 0);
    }
  }
  const invWtEntries = Object.entries(invByWt).sort((a, b) => b[1].invoiced - a[1].invoiced);
  const invGrandInvoiced = invWtEntries.reduce((s, [, v]) => s + v.invoiced, 0);
  const invGrandPaid = invWtEntries.reduce((s, [, v]) => s + v.paid, 0);
  const maxInvTotal = invWtEntries.length > 0 ? invWtEntries[0][1].invoiced : 1;

  const tabStyle = (active) => ({
    padding: "6px 14px", borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: "pointer",
    fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
    border: `1.5px solid ${active ? C.teal : C.border}`,
    background: active ? C.dark : "transparent",
    color: active ? C.teal : C.textMuted,
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }} onClick={onClose}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 28, width: 780, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>Analytics</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textFaint, cursor: "pointer" }}>✕</button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, textTransform: "uppercase" }}>From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, textTransform: "uppercase" }}>To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
          </div>
          <select value={filterWt} onChange={e => setFilterWt(e.target.value)} style={inputStyle}>
            <option value="__all__">All Work Types</option>
            {workTypes.map(w => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
          </select>
          <select value={filterRep} onChange={e => setFilterRep(e.target.value)} style={inputStyle}>
            <option value="__all__">All Sales Reps</option>
            {salesReps.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <button onClick={() => setView("proposals")} style={tabStyle(view === "proposals")}>Proposals</button>
          <button onClick={() => setView("invoices")} style={tabStyle(view === "invoices")}>Invoices</button>
        </div>

        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13, padding: 20 }}>Loading...</div>
        ) : view === "proposals" ? (
          <>
            {/* Work Type Bar Chart */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 10 }}>Proposals by Work Type</div>
              {propWtEntries.length === 0 ? (
                <div style={{ color: C.textFaint, fontSize: 13, fontFamily: F.ui }}>No data for selected filters</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {propWtEntries.map(([name, data]) => (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 140, fontSize: 12, fontFamily: F.ui, color: C.textBody, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }} title={name}>{name}</div>
                      <div style={{ flex: 1, height: 22, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(data.total / maxWtTotal) * 100}%`, background: C.teal, borderRadius: 4, minWidth: 2, transition: "width 0.4s" }} />
                      </div>
                      <div style={{ width: 90, textAlign: "right", fontSize: 12, fontWeight: 700, color: C.textHead, fontFamily: F.ui, flexShrink: 0 }}>{fmt$(data.total)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* By Sales Rep Table */}
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 8 }}>By Sales Rep</div>
            <div style={{ borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden", marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: C.dark }}>
                  <th style={thStyle}>Sales Rep</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Proposals</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                </tr></thead>
                <tbody>
                  {propRepEntries.map(([name, data], i) => (
                    <tr key={name} style={{ background: i % 2 === 0 ? C.linenLight : C.linen }}>
                      <td style={{ ...tdBase, fontWeight: 600, color: C.textBody }}>{name}</td>
                      <td style={{ ...tdBase, textAlign: "center", color: C.textMuted }}>{data.count}</td>
                      <td style={{ ...tdBase, textAlign: "right", fontWeight: 700, color: C.textHead }}>{fmt$(data.total)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: C.dark }}>
                    <td style={{ padding: "10px 14px", fontWeight: 800, color: C.teal, fontFamily: F.display, fontSize: 12, textTransform: "uppercase" }}>Total</td>
                    <td style={{ padding: "10px 14px", textAlign: "center", fontWeight: 800, color: C.teal, fontFamily: F.display }}>{propRepEntries.reduce((s, [, v]) => s + v.count, 0)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, color: C.teal, fontFamily: F.display, fontSize: 14 }}>{fmt$(propGrandTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            {/* Invoices by Work Type Chart */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 10 }}>Invoices by Work Type</div>
              {invWtEntries.length === 0 ? (
                <div style={{ color: C.textFaint, fontSize: 13, fontFamily: F.ui }}>No data for selected filters</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {invWtEntries.map(([name, data]) => (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 140, fontSize: 12, fontFamily: F.ui, color: C.textBody, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }} title={name}>{name}</div>
                      <div style={{ flex: 1, height: 22, background: C.border, borderRadius: 4, overflow: "hidden", position: "relative" }}>
                        <div style={{ height: "100%", width: `${(data.invoiced / maxInvTotal) * 100}%`, background: C.amber, borderRadius: 4, minWidth: 2 }} />
                        <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${(data.paid / maxInvTotal) * 100}%`, background: C.green, borderRadius: 4, minWidth: data.paid > 0 ? 2 : 0 }} />
                      </div>
                      <div style={{ width: 90, textAlign: "right", fontSize: 12, fontWeight: 700, color: C.textHead, fontFamily: F.ui, flexShrink: 0 }}>{fmt$(data.invoiced)}</div>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: C.amber }} /><span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>Invoiced</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: C.green }} /><span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>Paid</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* Invoice Totals Table */}
            <div style={{ borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: C.dark }}>
                  <th style={thStyle}>Work Type</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Invoiced</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Paid</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Outstanding</th>
                </tr></thead>
                <tbody>
                  {invWtEntries.map(([name, data], i) => (
                    <tr key={name} style={{ background: i % 2 === 0 ? C.linenLight : C.linen }}>
                      <td style={{ ...tdBase, fontWeight: 600, color: C.textBody }}>{name}</td>
                      <td style={{ ...tdBase, textAlign: "right", fontWeight: 700, color: C.textHead }}>{fmt$(data.invoiced)}</td>
                      <td style={{ ...tdBase, textAlign: "right", fontWeight: 700, color: C.green }}>{fmt$(data.paid)}</td>
                      <td style={{ ...tdBase, textAlign: "right", fontWeight: 700, color: data.invoiced - data.paid > 0 ? C.amber : C.green }}>{fmt$(data.invoiced - data.paid)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: C.dark }}>
                    <td style={{ padding: "10px 14px", fontWeight: 800, color: C.teal, fontFamily: F.display, fontSize: 12, textTransform: "uppercase" }}>Total</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, color: C.teal, fontFamily: F.display, fontSize: 14 }}>{fmt$(invGrandInvoiced)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, color: C.teal, fontFamily: F.display, fontSize: 14 }}>{fmt$(invGrandPaid)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, color: C.teal, fontFamily: F.display, fontSize: 14 }}>{fmt$(invGrandInvoiced - invGrandPaid)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
