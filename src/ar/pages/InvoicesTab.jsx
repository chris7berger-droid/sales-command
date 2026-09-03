import { useState } from "react";
import { C, F } from "../lib/tokens";
import { fmt, parseDate, getPeriodRange } from "../lib/utils";
import { useAR } from "../lib/ARContext";
import PeriodNav from "../components/PeriodNav";

export default function InvoicesTab({ onSelectInvoice }) {
  const { allInvoices, isCollections, isGoback } = useAR();
  const [mode, setMode] = useState("week");
  const [offset, setOffset] = useState(0);

  const range = getPeriodRange(mode, offset);
  const filtered = allInvoices.filter((inv) => {
    if (inv.type !== "Invoice") return false;
    if (isCollections(inv, inv.customer)) return false;
    if (isGoback(inv, inv.customer)) return false;
    const d = parseDate(inv.date);
    if (!d) return false;
    return d >= range.start && d < range.end;
  }).sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const totalAmt = filtered.reduce((s, inv) => s + inv.amount, 0);
  const totalOpen = filtered.reduce((s, inv) => s + inv.openBalance, 0);

  return (
    <div>
      <PeriodNav mode={mode} offset={offset}
        onModeChange={(m) => { setMode(m); setOffset(0); }}
        onOffsetChange={setOffset} />
      <div style={S.summary}>
        <div style={S.scard}><div style={S.scLabel}>Invoiced</div><div style={S.scVal}>{fmt(totalAmt)}</div><div style={S.scSub}>{filtered.length} invoice{filtered.length !== 1 ? "s" : ""}</div></div>
        <div style={S.scard}><div style={S.scLabel}>Still Open</div><div style={{ ...S.scVal, color: "#dc2626" }}>{fmt(totalOpen)}</div><div style={S.scSub}>of {fmt(totalAmt)} invoiced</div></div>
      </div>
      <div style={S.listWrap}>
        {!filtered.length && <div style={S.empty}>No invoices in this period</div>}
        {filtered.map((inv, i) => (
          <div key={i} style={S.row} onClick={() => onSelectInvoice(inv)}>
            <span style={S.num}>#{inv.num}</span>
            <span style={S.cust}>{inv.customer}</span>
            <span style={S.job}>{inv.job}</span>
            <span style={S.date}>{inv.date}</span>
            <span style={S.amt}>{fmt(inv.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const S = {
  summary: { display: "flex", gap: 16, marginBottom: 16 },
  scard: { flex: 1, background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "16px 20px" },
  scLabel: { fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint },
  scVal: { fontFamily: F.display, fontSize: 24, fontWeight: 800, color: C.textHead, marginTop: 4 },
  scSub: { fontSize: 11, color: C.textFaint, marginTop: 2 },
  listWrap: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, overflow: "hidden", maxHeight: "calc(100vh - 320px)", overflowY: "auto" },
  row: { display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", gap: 12, transition: "background 0.1s" },
  num: { fontFamily: F.display, fontWeight: 800, fontSize: 13, color: C.textHead, minWidth: 70 },
  cust: { fontWeight: 600, fontSize: 12, color: C.textBody, flex: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  job: { fontSize: 11, color: C.textLight, flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  date: { fontSize: 11, color: C.textFaint, minWidth: 80 },
  amt: { fontFamily: F.display, fontWeight: 800, fontSize: 14, color: C.textHead, minWidth: 90, textAlign: "right" },
  empty: { padding: 40, textAlign: "center", color: C.textFaint },
};
