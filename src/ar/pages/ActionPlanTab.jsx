import { useState } from "react";
import { C, F, COL } from "../lib/tokens";
import { fmt, parseDate, daysOverdue, invKey } from "../lib/utils";
import { useAR } from "../lib/ARContext";

function rptFmt(n) {
  if (n === 0) return "$0";
  const neg = n < 0; const a = Math.abs(n);
  if (a >= 1000) return (neg ? "-" : "") + "$" + a.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (neg ? "-" : "") + "$" + a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ActionPlanTab({ onSelectCustomer, onSelectInvoice }) {
  const ar = useAR();
  const [panel, setPanel] = useState("cleanup");
  const [blinders, setBlinders] = useState(true);
  const today = new Date();

  // Blinders mode: skip invoices that are triaged "good" or have a confirmed decision
  const shouldSkipInv = (inv, custName) => {
    if (!blinders) return false;
    const k = invKey(custName, inv.num, inv.date);
    if (ar.triageFlags[k] === "good") return true;
    if (ar.decisions?.[k]?.confirmedAt) return true;
    return false;
  };

  // Build cleanup items
  const cleanupItems = [];
  ar.customers.forEach((c) => { c.invoices.forEach((inv) => {
    if (inv.openBalance < 0) cleanupItems.push({ customer: c.name, detail: `Unapplied credit/overpayment \u2014 ${inv.type || ""} ${inv.num ? "#" + inv.num : ""}${inv.date ? " from " + inv.date : ""}`, amount: inv.openBalance, fix: "Apply to open invoices in QB \u2192 Receive Payment \u2192 apply to oldest invoices", priority: Math.abs(inv.openBalance) > 1000 ? 1 : 3 });
    if (inv.type === "Invoice" && inv.openBalance > 0 && inv.openBalance < 500) {
      const d = parseDate(inv.date); if (!d) return;
      const age = Math.floor((today - d) / 86400000);
      if (age > 180) cleanupItems.push({ customer: c.name, detail: `Small stale balance \u2014 Invoice #${inv.num} \u2014 ${rptFmt(inv.openBalance)}, ${age} days`, amount: inv.openBalance, fix: "Write off. Not worth the phone call.", priority: 3 });
    }
  }); });

  // Misapplied payment detection
  const credits2 = [], debits2 = [];
  ar.customers.forEach((c) => { let cr = 0, db = 0; c.invoices.forEach((inv) => { if (inv.openBalance < 0) cr += inv.openBalance; else db += inv.openBalance; }); if (cr < -1000) credits2.push({ name: c.name, amount: cr }); if (db > 1000) debits2.push({ name: c.name, amount: db }); });
  credits2.forEach((cr) => { debits2.forEach((db) => {
    if (cr.name === db.name) return;
    const cW = cr.name.toLowerCase().split(/\s+/), dW = db.name.toLowerCase().split(/\s+/);
    if (cW.filter((w) => w.length > 2 && dW.includes(w)).length > 0)
      cleanupItems.push({ customer: `\u26a0\ufe0f ${cr.name} / ${db.name} \u2014 Check This`, detail: `${cr.name} has ${rptFmt(Math.abs(cr.amount))} credit. ${db.name} owes ${rptFmt(db.amount)}. Same company?`, amount: 0, amtDisplay: `~${rptFmt(Math.min(Math.abs(cr.amount), db.amount))} fix`, fix: `In QB: check if ${cr.name}'s payment should apply to ${db.name}'s invoices.`, priority: 1, special: true });
  }); });
  cleanupItems.sort((a, b) => a.priority - b.priority || Math.abs(b.amount) - Math.abs(a.amount));

  // Build chase groups
  const chaseGroups = { over90: [], days90: [], days60: [], days30: [], current: [] };
  ar.customers.forEach((c) => { c.invoices.forEach((inv) => {
    if (inv.type !== "Invoice" || inv.openBalance <= 0) return;
    if (ar.isRetention(inv, c.name) || ar.isCollections(inv, c.name) || ar.isGoback(inv, c.name)) return;
    if (shouldSkipInv(inv, c.name)) return;
    const d = parseDate(inv.dueDate || inv.date); if (!d) return;
    const age = Math.floor((today - d) / 86400000);
    if (age > 90) chaseGroups.over90.push({ inv, cust: c.name });
    else if (age > 60) chaseGroups.days90.push({ inv, cust: c.name });
    else if (age > 30) chaseGroups.days60.push({ inv, cust: c.name });
    else if (age > 0) chaseGroups.days30.push({ inv, cust: c.name });
    else chaseGroups.current.push({ inv, cust: c.name });
  }); });

  function groupByCust(items) {
    const g = {};
    items.forEach((it) => { if (!g[it.cust]) g[it.cust] = { name: it.cust, invs: [], total: 0 }; g[it.cust].invs.push(it.inv); g[it.cust].total += it.inv.openBalance; });
    return Object.values(g).sort((a, b) => b.total - a.total);
  }

  const cleanupValue = cleanupItems.reduce((s, it) => s + Math.abs(it.amount), 0);
  const biggestFix = cleanupItems.reduce((m, it) => Math.max(m, Math.abs(it.amount)), 0);
  const chaseTotal = [...chaseGroups.over90, ...chaseGroups.days90, ...chaseGroups.days60, ...chaseGroups.days30].reduce((s, it) => s + it.inv.openBalance, 0);

  const findCustomer = (name) => {
    const n = name.replace(/^\u26a0\ufe0f\s*/, "").trim();
    const parts = n.split(" / ").map((p) => p.replace(/ \u2014.*$/, "").trim());
    for (const p of parts) {
      const found = ar.customers.find((c) => c.name === p || c.name.startsWith(p));
      if (found) { onSelectCustomer(found); return; }
    }
  };

  const tiers = [
    { items: chaseGroups.over90, cls: "#dc2626", icon: "\ud83d\udd34", label: "91+ Days \u2014 Escalate Now", desc: "Every day makes collection harder." },
    { items: chaseGroups.days90, cls: "#e65100", icon: "\ud83d\udfe0", label: "61\u201390 Days \u2014 Demand", desc: "Involve sales contact." },
    { items: chaseGroups.days60, cls: "#d97706", icon: "\ud83d\udfe1", label: "31\u201360 Days \u2014 Follow Up", desc: "Active collection needed." },
    { items: chaseGroups.days30, cls: "#1565c0", icon: "\ud83d\udd35", label: "1\u201330 Days \u2014 Remind", desc: "Normal for construction." },
    { items: chaseGroups.current, cls: "#059669", icon: "\u2705", label: "Current \u2014 Track", desc: "Not due yet." },
  ];

  const p1 = cleanupItems.filter((it) => it.priority === 1);
  const p3 = cleanupItems.filter((it) => it.priority === 3);

  return (
    <div>
      {/* Sub-tabs */}
      <div style={S.tabs}>
        <button style={{ ...S.tab, ...(panel === "cleanup" ? S.tabActive : {}) }} onClick={() => setPanel("cleanup")}>1. Clean Up QB</button>
        <button style={{ ...S.tab, ...(panel === "chase" ? S.tabActive : {}) }} onClick={() => setPanel("chase")}>2. Chase Cash</button>
        {panel === "chase" && (
          <label style={S.blindersToggle}>
            <input type="checkbox" checked={blinders} onChange={() => setBlinders(!blinders)} style={{ display: "none" }} />
            <div style={{ ...S.blindersBox, ...(blinders ? { background: C.tealDark, borderColor: C.tealDark, color: "#fff" } : {}) }}>{"\u2713"}</div>
            <span style={S.blindersLabel}>Blinders Mode</span>
            <span style={S.blindersHint}>{blinders ? "Hiding triaged Good + confirmed actions" : "Showing all invoices"}</span>
          </label>
        )}
      </div>

      {/* Cleanup panel */}
      {panel === "cleanup" && (
        <div>
          <div style={S.summary}>
            <div style={S.scard}><div style={S.scL}>Items to Fix</div><div style={S.scV}>{cleanupItems.length}</div></div>
            <div style={S.scard}><div style={S.scL}>Cleanup Value</div><div style={{ ...S.scV, color: "#dc2626" }}>{rptFmt(cleanupValue)}</div></div>
            <div style={S.scard}><div style={S.scL}>Biggest Fix</div><div style={{ ...S.scV, color: "#dc2626" }}>{rptFmt(biggestFix)}</div></div>
          </div>
          <p style={S.intro}>These items make your AR report <strong>inaccurate</strong>. Fix them and your numbers get honest. Click any row for the exact fix.</p>
          {p1.length > 0 && <>
            <div style={{ ...S.slabel, color: "#dc2626" }}>Priority 1 \u2014 Fix This Week</div>
            <div style={S.sdesc}>Large unapplied credits inflating your AR.</div>
            {p1.map((it, i) => <CleanupItem key={i} item={it} onOpen={() => findCustomer(it.customer)} />)}
          </>}
          {p3.length > 0 && <>
            <div style={{ ...S.slabel, color: C.textFaint }}>Priority 3 \u2014 Batch Cleanup</div>
            <div style={S.sdesc}>Small balances. 20 minutes of QB work.</div>
            {p3.map((it, i) => <CleanupItem key={i} item={it} onOpen={() => findCustomer(it.customer)} />)}
          </>}
          {!cleanupItems.length && <p style={{ color: C.textFaint, padding: 24, textAlign: "center" }}>No cleanup items. Your QB is clean.</p>}
        </div>
      )}

      {/* Chase panel */}
      {panel === "chase" && (
        <div>
          <div style={S.summary}>
            <div style={S.scard}><div style={S.scL}>Past Due Total</div><div style={{ ...S.scV, color: "#dc2626" }}>{rptFmt(chaseTotal)}</div></div>
            <div style={S.scard}><div style={S.scL}>91+ Days</div><div style={{ ...S.scV, color: "#dc2626" }}>{rptFmt(chaseGroups.over90.reduce((s, it) => s + it.inv.openBalance, 0))}</div></div>
            <div style={S.scard}><div style={S.scL}>Current (Not Due)</div><div style={{ ...S.scV, color: C.pop }}>{rptFmt(chaseGroups.current.reduce((s, it) => s + it.inv.openBalance, 0))}</div></div>
          </div>
          {tiers.map((tier) => {
            if (!tier.items.length) return null;
            const tierTotal = tier.items.reduce((s, it) => s + it.inv.openBalance, 0);
            return (
              <div key={tier.label}>
                <div style={{ ...S.slabel, color: tier.cls }}>{tier.icon} {tier.label} \u2014 {rptFmt(tierTotal)}</div>
                <div style={S.sdesc}>{tier.desc}</div>
                {groupByCust(tier.items).map((g) => (
                  <ChaseCustBlock key={g.name} group={g} color={tier.cls}
                    onClickCustomer={() => findCustomer(g.name)}
                    onClickInvoice={(inv) => onSelectInvoice(inv)} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CleanupItem({ item: it, onOpen }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...IS.card, borderLeftColor: it.priority === 1 ? "#dc2626" : C.textFaint, ...(it.special ? { background: "rgba(198,40,40,0.04)" } : {}) }}
      onClick={() => setOpen(!open)}>
      <div style={IS.top}>
        <div>
          <div style={IS.cust} onClick={(e) => { e.stopPropagation(); onOpen(); }}>{it.customer}</div>
          <div style={IS.detail}>{it.detail}</div>
          {open && <div style={IS.fix}>{"\u2192"} {it.fix}
            <span style={IS.openLink} onClick={(e) => { e.stopPropagation(); onOpen(); }}>Open Customer {"\u2192"}</span>
          </div>}
        </div>
        <div style={{ ...IS.amt, ...(it.amount < 0 ? { color: "#dc2626" } : {}) }}>{it.amtDisplay || rptFmt(it.amount)}</div>
      </div>
    </div>
  );
}

function ChaseCustBlock({ group: g, color, onClickCustomer, onClickInvoice }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={BS.block}>
      <div style={BS.head} onClick={() => setOpen(!open)}>
        <div style={BS.headLeft}>
          <span style={BS.cn} onClick={(e) => { e.stopPropagation(); onClickCustomer(); }}>{g.name}</span>
          <small style={BS.small}>{g.invs.length} inv</small>
        </div>
        <span style={BS.ct}>{rptFmt(g.total)}</span>
      </div>
      {open && (
        <div style={BS.invs}>
          {g.invs.sort((a, b) => b.openBalance - a.openBalance).map((inv, i) => (
            <div key={i} style={BS.inv} onClick={() => onClickInvoice(inv)}>
              <span>#{inv.num} {"\u00b7"} {inv.date} \u2014 {(inv.job || inv.fullName || "").substring(0, 60)}</span>
              <span style={BS.invAmt}>{rptFmt(inv.openBalance)} <span style={{ color: C.popDeep, fontSize: 10 }}>{"\u25b6"}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function rptFmtLocal(n) { return rptFmt(n); }

const S = {
  tabs: { display: "flex", gap: 4, marginBottom: 16 },
  tab: { fontFamily: F.display, padding: "10px 20px", fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${C.borderStrong}`, borderRadius: 8, background: C.linenCard, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" },
  tabActive: { background: C.dark, color: C.pop, borderColor: C.dark },
  blindersToggle: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginLeft: "auto", padding: "6px 0" },
  blindersBox: { width: 16, height: 16, borderRadius: 3, border: "2px solid #d1d5db", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "transparent", transition: "all 0.15s", flexShrink: 0 },
  blindersLabel: { fontSize: 11, fontWeight: 700, fontFamily: F.display, color: C.textHead, letterSpacing: "0.02em" },
  blindersHint: { fontSize: 10, color: C.textFaint },
  summary: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 },
  scard: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "14px 16px" },
  scL: { fontFamily: F.display, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint },
  scV: { fontFamily: F.display, fontSize: 22, fontWeight: 800, color: C.textHead, marginTop: 4 },
  intro: { fontSize: 12, color: C.textLight, marginBottom: 16, lineHeight: 1.5 },
  slabel: { fontFamily: F.display, fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 16, marginBottom: 4 },
  sdesc: { fontSize: 11, color: C.textFaint, marginBottom: 10 },
};

const IS = {
  card: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderLeft: "4px solid", borderRadius: 8, padding: "12px 16px", marginBottom: 8, cursor: "pointer" },
  top: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 },
  cust: { fontWeight: 600, fontSize: 12, color: C.textBody, textDecoration: "underline", textDecorationColor: C.pop, cursor: "pointer" },
  detail: { fontSize: 11, color: C.textLight, marginTop: 4 },
  fix: { fontSize: 11, color: C.tealDark, fontWeight: 600, marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.border}` },
  openLink: { display: "inline-block", marginTop: 6, color: C.popDeep, fontWeight: 700, cursor: "pointer", textDecoration: "underline", marginLeft: 8 },
  amt: { fontFamily: F.display, fontWeight: 800, fontSize: 14, color: C.textHead, whiteSpace: "nowrap" },
};

const BS = {
  block: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 8, marginBottom: 8, overflow: "hidden" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", cursor: "pointer" },
  headLeft: { display: "flex", alignItems: "center", gap: 8 },
  cn: { fontWeight: 600, fontSize: 12, color: C.textBody, textDecoration: "underline", textDecorationColor: C.pop, cursor: "pointer" },
  small: { fontSize: 10, color: C.textFaint },
  ct: { fontFamily: F.display, fontWeight: 800, fontSize: 14, color: C.textHead },
  invs: { borderTop: `1px solid ${C.border}`, padding: "4px 0" },
  inv: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 16px", fontSize: 11, color: C.textLight, cursor: "pointer", borderBottom: `1px solid ${C.border}` },
  invAmt: { fontFamily: F.display, fontWeight: 800, fontSize: 12, color: C.textHead, whiteSpace: "nowrap" },
};
