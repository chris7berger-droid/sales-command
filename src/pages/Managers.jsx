import { useState, useEffect } from "react";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/supabaseHelpers";
import SectionHeader from "../components/SectionHeader";
import StatCard from "../components/StatCard";

const ANNUAL_GOAL = 750000;

function buildMonthRows(callLog, proposals) {
  // Get all months present in either dataset
  const monthSet = new Set();
  (callLog || []).forEach(r => { if (r.created_at) monthSet.add(r.created_at.slice(0, 7)); });
  (proposals || []).forEach(p => { if (p.created_at) monthSet.add(p.created_at.slice(0, 7)); });

  const SENT_STATUSES     = ["Sent", "Viewed", "Approved Internally", "Approved"];
  const ACCEPTED_STATUSES = ["Approved Internally", "Approved"];

  return [...monthSet].sort().reverse().map(month => {
    const calls    = (callLog   || []).filter(r => r.created_at?.startsWith(month));
    const sent     = (proposals || []).filter(p => p.created_at?.startsWith(month) && SENT_STATUSES.includes(p.status));
    const accepted = (proposals || []).filter(p => p.created_at?.startsWith(month) && ACCEPTED_STATUSES.includes(p.status));
    const billed   = (proposals || []).filter(p => p.approved_at?.startsWith(month));

    return {
      month:          formatMonth(month),
      monthKey:       month,
      newCalls:       calls.length,
      propsSent:      sent.length,
      propsAccepted:  accepted.length,
      dollarsBid:     sent.reduce((s, p)     => s + (p.total || 0), 0),
      dollarsAcc:     accepted.reduce((s, p) => s + (p.total || 0), 0),
      billings:       billed.reduce((s, p)   => s + (p.total || 0), 0),
    };
  });
}

function formatMonth(ym) {
  const [y, m] = ym.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function Managers() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [callLog, proposals] = await Promise.all([
        fetchAll("call_log", "created_at"),
        fetchAll("proposals", "total, created_at, approved_at, status", {
          filters: [["is", "deleted_at", null]],
        }),
      ]);
      setRows(buildMonthRows(callLog, proposals));
      setLoading(false);
    }
    load();
  }, []);

  // Totals
  const totNewCalls      = rows.reduce((s, r) => s + r.newCalls,      0);
  const totSent          = rows.reduce((s, r) => s + r.propsSent,      0);
  const totAccepted      = rows.reduce((s, r) => s + r.propsAccepted,  0);
  const totDollarsBid    = rows.reduce((s, r) => s + r.dollarsBid,     0);
  const totDollarsAcc    = rows.reduce((s, r) => s + r.dollarsAcc,     0);
  const totBillings      = rows.reduce((s, r) => s + r.billings,       0);
  const totCapPct        = totSent     > 0 ? Math.round((totAccepted / totSent)     * 100) : 0;
  const totDollarCapPct  = totDollarsBid > 0 ? Math.round((totDollarsAcc / totDollarsBid) * 100) : 0;

  // YTD = current year accepted
  const thisYear = new Date().getFullYear().toString();
  const ytd = rows
    .filter(r => r.monthKey?.startsWith(thisYear))
    .reduce((s, r) => s + r.dollarsAcc, 0);
  const toGoal = ANNUAL_GOAL - ytd;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Manager Dashboard" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        <StatCard label="YTD Actual"  value={loading ? "…" : fmt$(ytd)}                          sub="Accepted proposals" accent={C.teal} />
        <StatCard label="Annual Goal" value={fmt$(ANNUAL_GOAL)}                                   sub="FY 2026"            accent={C.textFaint} />
        <StatCard label="To Goal"     value={loading ? "…" : toGoal > 0 ? fmt$(toGoal) : "🎯 Hit!"} sub="Remaining"       accent={toGoal > 0 ? C.red : C.green} />
      </div>

      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.borderStrong}`, boxShadow: "0 2px 10px rgba(28,24,20,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
          <thead>
            <tr style={{ background: C.dark }}>
              {["Month","New Calls","Sent","Accepted","Cap %","$ Bid","$ Accepted","$ Cap %","Billings"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: h === "Month" ? "left" : "right", fontWeight: 700, fontSize: 10, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: `1px solid ${C.darkBorder}`, whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: C.textFaint, fontFamily: F.ui }}>Loading…</td></tr>
              : rows.map((r, i) => (
              <tr key={r.month} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.linenLight : C.linen }}>
                <td style={{ padding: "11px 14px", fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em" }}>{r.month}</td>
                {[r.newCalls, r.propsSent, r.propsAccepted].map((val, j) => (
                  <td key={j} style={{ padding: "11px 14px", textAlign: "right", color: val === 0 ? C.textFaint : C.textBody }}>{val || "—"}</td>
                ))}
                <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 700, color: r.propsSent > 0 ? C.tealDark : C.textFaint }}>
                  {r.propsSent > 0 ? `${Math.round((r.propsAccepted / r.propsSent) * 100)}%` : "—"}
                </td>
                {[r.dollarsBid, r.dollarsAcc].map((val, j) => (
                  <td key={j} style={{ padding: "11px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: val === 0 ? C.textFaint : C.textBody }}>{val > 0 ? fmt$(val) : "—"}</td>
                ))}
                <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 700, color: r.dollarsBid > 0 ? C.tealDark : C.textFaint }}>
                  {r.dollarsBid > 0 ? `${Math.round((r.propsAccepted / r.propsSent) * 100)}%` : "—"}
                </td>
                <td style={{ padding: "11px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.billings === 0 ? C.textFaint : C.textBody }}>
                  {r.billings > 0 ? fmt$(r.billings) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: C.dark, borderTop: `2px solid ${C.teal}` }}>
              <td style={{ padding: "11px 14px", fontWeight: 900, color: C.teal, fontFamily: F.display, letterSpacing: "0.08em" }}>TOTAL</td>
              {[totNewCalls, totSent, totAccepted].map((val, j) => (
                <td key={j} style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: "#fff" }}>{val || "—"}</td>
              ))}
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: C.teal }}>{totCapPct > 0 ? `${totCapPct}%` : "—"}</td>
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{totDollarsBid > 0 ? fmt$(totDollarsBid) : "—"}</td>
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{totDollarsAcc > 0 ? fmt$(totDollarsAcc) : "—"}</td>
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: C.teal }}>{totDollarCapPct > 0 ? `${totDollarCapPct}%` : "—"}</td>
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{totBillings > 0 ? fmt$(totBillings) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}