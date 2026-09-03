import { useState } from "react";
import { C, F } from "../lib/tokens";
import { fmt, fmtShort, parseDate, daysOverdue } from "../lib/utils";
import { useAR } from "../lib/ARContext";

function rptFmt(n) {
  if (n === 0) return "$0";
  const neg = n < 0; const a = Math.abs(n);
  if (a >= 1000) return (neg ? "-" : "") + "$" + a.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (neg ? "-" : "") + "$" + a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildAnomalies(customerList, allInvoices) {
  const anomalies = []; const today = new Date();
  customerList.forEach((c) => { c.invoices.forEach((inv) => {
    if (inv.type !== "Invoice" || inv.openBalance <= 0) return;
    const d = parseDate(inv.date); if (!d) return;
    const age = Math.floor((today - d) / 86400000);
    if (age > 365) anomalies.push({ type: "STALE INVOICE", severity: "HIGH", customer: c.name, detail: `Invoice #${inv.num} for ${rptFmt(inv.openBalance)} from ${inv.date} \u2014 ${age > 730 ? Math.floor(age / 365) + " YEARS old" : Math.floor(age / 30) + " months old"}. ${inv.job}`, amount: inv.openBalance, action: age > 730 ? "Likely uncollectable. Evaluate for write-off or send final demand letter." : "Escalate immediately. Collection likelihood drops each month." });
    else if (age > 180 && inv.openBalance < 500) anomalies.push({ type: "SMALL STALE BALANCE", severity: "MEDIUM", customer: c.name, detail: `Invoice #${inv.num} \u2014 ${rptFmt(inv.openBalance)}, ${age} days past due`, amount: inv.openBalance, action: "Write off. Not worth the phone call." });
  }); });
  customerList.forEach((c) => { c.invoices.forEach((inv) => {
    if (inv.openBalance >= 0) return;
    anomalies.push({ type: "CREDIT/OVERPAYMENT", severity: "MEDIUM", customer: c.name, detail: `Negative balance of ${rptFmt(inv.openBalance)} \u2014 ${inv.type || ""} ${inv.num ? "#" + inv.num : ""}${inv.date ? " from " + inv.date : ""}`, amount: inv.openBalance, action: "Apply credit to open invoices or issue refund" });
  }); });
  customerList.slice().sort((a, b) => b.total - a.total).forEach((c) => {
    if (c.total > 25000) anomalies.push({ type: "CONCENTRATION RISK", severity: "INFO", customer: c.name, detail: `${rptFmt(c.total)} total open across ${c.invoices.filter((i) => i.openBalance > 0).length} invoices`, amount: c.total, action: "Prioritize collection \u2014 large exposure" });
  });
  // Misapplied payment detection
  const credits = [], debits = [];
  customerList.forEach((c) => { let cr = 0, db = 0; c.invoices.forEach((inv) => { if (inv.openBalance < 0) cr += inv.openBalance; else db += inv.openBalance; }); if (cr < -1000) credits.push({ name: c.name, amount: cr }); if (db > 1000) debits.push({ name: c.name, amount: db }); });
  credits.forEach((cr) => { debits.forEach((db) => {
    if (cr.name === db.name) return;
    const cW = cr.name.toLowerCase().split(/\s+/), dW = db.name.toLowerCase().split(/\s+/);
    const sh = cW.filter((w) => w.length > 2 && dW.includes(w));
    if (sh.length > 0) anomalies.push({ type: "POSSIBLE MISAPPLIED PAYMENT", severity: "HIGH", customer: `${cr.name} / ${db.name}`, detail: `${cr.name} has a ${rptFmt(Math.abs(cr.amount))} credit. ${db.name} owes ${rptFmt(db.amount)}. Check if payment was applied to wrong customer.`, amount: Math.abs(cr.amount), action: `In QB: open ${cr.name}'s account, check if payments should apply to ${db.name}'s invoices. Could clear ${rptFmt(Math.min(Math.abs(cr.amount), db.amount))} instantly.` });
  }); });
  return anomalies;
}

export default function HealthCheckTab({ onSelectCustomer }) {
  const ar = useAR();
  const [healthFilter, setHealthFilter] = useState("ALL");
  const t = ar.getTotals();

  let totalCredits = 0, numInv = 0;
  ar.allInvoices.forEach((inv) => { if (inv.openBalance < 0) totalCredits += inv.openBalance; if (inv.type === "Invoice" && inv.openBalance > 0) numInv++; });

  const anomalies = buildAnomalies(ar.customers, ar.allInvoices).sort((a, b) => {
    const sev = { HIGH: 0, MEDIUM: 1, INFO: 2 };
    return (sev[a.severity] || 3) - (sev[b.severity] || 3);
  });

  const counts = { ALL: anomalies.length, HIGH: 0, MEDIUM: 0, INFO: 0 };
  anomalies.forEach((a) => { counts[a.severity] = (counts[a.severity] || 0) + 1; });

  const filteredA = healthFilter === "ALL" ? anomalies : anomalies.filter((a) => a.severity === healthFilter);

  const topCusts = ar.customers.slice().sort((a, b) => b.total - a.total).slice(0, 15).map((c) => {
    let oldest = "";
    c.invoices.forEach((inv) => { if (inv.date && (!oldest || inv.date < oldest)) oldest = inv.date; });
    return { name: c.name, total: c.total, count: c.invoices.filter((i) => i.openBalance > 0).length, oldest };
  });
  const maxAmt = topCusts.length ? topCusts[0].total : 1;

  const bData = [
    { v: t.current, c: "#2e7d32", l: "Current" }, { v: t.days30, c: "#689f38", l: "1-30" },
    { v: t.days60, c: "#e65100", l: "31-60" }, { v: t.days90, c: "#d84315", l: "61-90" },
    { v: t.over90, c: "#c62828", l: "91+" },
  ];

  const findCustomer = (name) => {
    const n = name.trim();
    let found = ar.customers.find((c) => c.name === n);
    if (found) { onSelectCustomer(found); return; }
    const parts = n.split(" / ");
    for (const p of parts) {
      const pn = p.replace(/^[^a-zA-Z0-9]+/, "").trim();
      found = ar.customers.find((c) => c.name === pn || c.name.startsWith(pn));
      if (found) { onSelectCustomer(found); return; }
    }
  };

  return (
    <div>
      {/* Summary cards */}
      <div style={S.summary}>
        <div style={S.scard}><div style={S.scL}>Total Open AR</div><div style={S.scV}>{rptFmt(t.total)}</div></div>
        <div style={S.scard}><div style={S.scL}>Net AR (after credits)</div><div style={{ ...S.scV, color: C.pop }}>{rptFmt(t.total + totalCredits)}</div></div>
        <div style={S.scard}><div style={S.scL}>Open Invoices</div><div style={S.scV}>{numInv}</div></div>
        <div style={S.scard}><div style={S.scL}>Credits to Apply</div><div style={{ ...S.scV, color: "#dc2626" }}>{rptFmt(totalCredits)}</div></div>
        <div style={S.scard}><div style={S.scL}>Retention Held</div><div style={S.scV}>{rptFmt(t.retention)}</div></div>
      </div>

      {/* Aging breakdown bar */}
      <div style={S.secTitle}>Aging Breakdown</div>
      <div style={S.secDesc}>Where your money is sitting. Green = on time. Red = way overdue.</div>
      <div style={S.barWrap}>
        {bData.map((b) => {
          const pct = t.total ? (b.v / t.total * 100) : 0;
          if (pct <= 0) return null;
          return <div key={b.l} style={{ ...S.barSeg, width: pct + "%", background: b.c }}><div style={S.barLabel}>{b.l}</div><div style={S.barVal}>{rptFmt(b.v)}</div></div>;
        })}
      </div>
      <div style={S.legend}>
        {bData.map((b) => <span key={b.l} style={S.legendItem}><span style={{ ...S.legendDot, background: b.c }} /> {b.l}: {rptFmt(b.v)} ({t.total ? (b.v / t.total * 100).toFixed(1) : 0}%)</span>)}
      </div>

      {/* Findings */}
      <div style={S.secTitle}>Findings & Anomalies</div>
      <div style={S.secDesc}>Issues found by analyzing your AR. Click any card for the recommended action.</div>
      <div style={S.filters}>
        {[{ f: "ALL", l: "All Findings" }, { f: "HIGH", l: "\ud83d\udd34 Critical" }, { f: "MEDIUM", l: "\ud83d\udfe0 Investigate" }, { f: "INFO", l: "\ud83d\udd35 Watch" }].map((fb) => (
          <button key={fb.f} onClick={() => setHealthFilter(fb.f)}
            style={{ ...S.filterBtn, ...(healthFilter === fb.f ? S.filterActive : {}) }}>
            {fb.l} ({counts[fb.f]})
          </button>
        ))}
      </div>
      {filteredA.map((a, i) => (
        <AnomalyCard key={i} anomaly={a} onClick={() => findCustomer(a.customer)} />
      ))}

      {/* Top customers */}
      <div style={S.secTitle}>Who Owes You</div>
      <div style={S.secDesc}>Top customers by open balance.</div>
      <div style={S.tableWrap}>
        <div style={S.tableHeader}>
          <span style={{ ...S.th, width: 30 }}>#</span>
          <span style={{ ...S.th, flex: 2 }}>Customer</span>
          <span style={{ ...S.th, flex: 1, textAlign: "right" }}>Open Balance</span>
          <span style={{ ...S.th, width: 40, textAlign: "center" }}>Inv</span>
          <span style={{ ...S.th, width: 80 }}>Oldest</span>
          <span style={{ ...S.th, flex: 1.5 }} />
        </div>
        {topCusts.map((c, i) => (
          <div key={c.name} style={S.tableRow} onClick={() => findCustomer(c.name)}>
            <span style={{ ...S.td, width: 30, color: C.textFaint }}>{i + 1}</span>
            <span style={{ ...S.td, flex: 2, fontWeight: 600, cursor: "pointer", textDecoration: "underline", textDecorationColor: C.pop }}>{c.name}</span>
            <span style={{ ...S.td, flex: 1, textAlign: "right", fontFamily: F.display, fontWeight: 800 }}>{rptFmt(c.total)}</span>
            <span style={{ ...S.td, width: 40, textAlign: "center" }}>{c.count}</span>
            <span style={{ ...S.td, width: 80, color: C.textFaint, fontSize: 11 }}>{c.oldest || "\u2014"}</span>
            <span style={{ ...S.td, flex: 1.5 }}><div style={{ height: 6, borderRadius: 3, background: C.pop, width: (c.total / maxAmt * 100).toFixed(1) + "%" }} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnomalyCard({ anomaly: a, onClick }) {
  const [open, setOpen] = useState(false);
  const sevColor = a.severity === "HIGH" ? "#dc2626" : a.severity === "MEDIUM" ? "#e65100" : "#1565c0";
  return (
    <div style={{ ...AS.card, borderLeftColor: sevColor }} onClick={() => setOpen(!open)}>
      <div style={AS.top}>
        <div>
          <span style={{ ...AS.badge, background: sevColor + "18", color: sevColor }}>{a.severity}</span>
          <span style={AS.type}>{a.type}</span>
        </div>
        <span style={AS.amt}>{a.amount ? rptFmt(a.amount) : "\u2014"}</span>
      </div>
      <div style={AS.cust} onClick={(e) => { e.stopPropagation(); onClick(); }}>{a.customer}</div>
      <div style={AS.detail}>{a.detail}</div>
      {open && <div style={AS.action}>{"\u2192"} {a.action}</div>}
    </div>
  );
}

const S = {
  summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 },
  scard: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "14px 16px" },
  scL: { fontFamily: F.display, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint },
  scV: { fontFamily: F.display, fontSize: 22, fontWeight: 800, color: C.textHead, marginTop: 4 },
  secTitle: { fontFamily: F.display, fontSize: 14, fontWeight: 800, color: C.textHead, marginTop: 24, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" },
  secDesc: { fontSize: 11, color: C.textFaint, marginBottom: 12 },
  barWrap: { display: "flex", borderRadius: 8, overflow: "hidden", height: 48, marginBottom: 8 },
  barSeg: { display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minWidth: 40 },
  barLabel: { fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.8)", fontFamily: F.display },
  barVal: { fontSize: 11, fontWeight: 800, color: "#fff", fontFamily: F.display },
  legend: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 },
  legendItem: { fontSize: 11, color: C.textMuted, display: "flex", alignItems: "center", gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 2, display: "inline-block" },
  filters: { display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" },
  filterBtn: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 600, fontFamily: F.body, color: C.textMuted, cursor: "pointer" },
  filterActive: { background: C.dark, color: C.pop, borderColor: C.dark },
  tableWrap: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, overflow: "hidden", marginBottom: 20 },
  tableHeader: { display: "flex", padding: "8px 16px", background: C.dark },
  th: { fontFamily: F.display, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint, padding: "4px 0" },
  tableRow: { display: "flex", padding: "8px 16px", borderBottom: `1px solid ${C.border}`, alignItems: "center", cursor: "pointer" },
  td: { fontSize: 12, color: C.textBody, padding: "4px 0" },
};

const AS = {
  card: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderLeft: "4px solid", borderRadius: 8, padding: "12px 16px", marginBottom: 8, cursor: "pointer", transition: "all 0.15s" },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  badge: { fontSize: 9, fontWeight: 800, fontFamily: F.display, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.04em" },
  type: { fontSize: 10, fontWeight: 700, fontFamily: F.display, color: C.textMuted, marginLeft: 8, letterSpacing: "0.04em" },
  amt: { fontFamily: F.display, fontWeight: 800, fontSize: 14, color: C.textHead },
  cust: { fontWeight: 600, fontSize: 12, color: C.textBody, textDecoration: "underline", textDecorationColor: C.pop, cursor: "pointer" },
  detail: { fontSize: 11, color: C.textLight, marginTop: 4 },
  action: { fontSize: 11, color: C.tealDark, fontWeight: 600, marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.border}` },
};
