import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import { mgrData } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import StatCard from "../components/StatCard";

export default function Managers() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Manager Dashboard" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        <StatCard label="YTD Actual"  value={fmt$(206000)}        sub="Accepted proposals" accent={C.teal} />
        <StatCard label="Annual Goal" value={fmt$(750000)}        sub="FY 2026"            accent={C.textFaint} />
        <StatCard label="To Goal"     value={fmt$(206000-750000)} sub="Remaining"          accent={C.red} />
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
            {mgrData.map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.linenLight : C.linen }}>
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
                  {r.dollarsBid > 0 ? `${Math.round((r.dollarsAcc / r.dollarsBid) * 100)}%` : "—"}
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
              {[20, 12, 7].map((val, j) => (
                <td key={j} style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: "#fff" }}>{val}</td>
              ))}
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: C.teal }}>58%</td>
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt$(318000)}</td>
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt$(206000)}</td>
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: C.teal }}>65%</td>
              <td style={{ padding: "11px 14px", textAlign: "right", fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt$(251700)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}