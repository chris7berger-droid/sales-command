import { C, F, COL } from "../lib/tokens";
import { fmt, fmtShort } from "../lib/utils";
import { useAR } from "../lib/ARContext";

const COLS = [
  { key: "name", label: "Customer", align: "left" },
  { key: "current", label: "Current", align: "right" },
  { key: "days30", label: "1-30", align: "right" },
  { key: "days60", label: "31-60", align: "right" },
  { key: "days90", label: "61-90", align: "right" },
  { key: "over90", label: "91+", align: "right" },
  { key: "total", label: "Total", align: "right" },
];

const COL_COLORS = { current: COL.cur.bg, days30: COL.d30.bg, days60: COL.d60.bg, days90: COL.d90.bg, over90: COL.o90.bg };

export default function AgingTable({ filtered, sortBy, sortDir, onSort, onSelectCustomer }) {
  const { getCustBuckets, getCustRetTotal, getCustCollTotal, getCustGobackTotal } = useAR();

  const filteredTotal = filtered.reduce((s, c) => s + c.total, 0);

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        {COLS.map((col) => (
          <div key={col.key} style={{ ...S.headerCell, textAlign: col.align, cursor: "pointer", flex: col.key === "name" ? 2 : 1 }}
            onClick={() => onSort(col.key)}>
            {col.label}
            {sortBy === col.key && <span style={S.arrow}>{sortDir === "desc" ? " \u25BC" : " \u25B2"}</span>}
          </div>
        ))}
        <div style={{ ...S.headerCell, width: 30 }} />
      </div>
      <div style={S.body}>
        {filtered.map((c) => {
          const b = getCustBuckets(c, false);
          const ret = getCustRetTotal(c);
          const coll = getCustCollTotal(c);
          const goback = getCustGobackTotal(c);
          return (
            <div key={c.name} style={S.row} onClick={() => onSelectCustomer(c)}>
              <div style={{ ...S.cell, flex: 2, fontWeight: 600 }}>
                {c.name}
                <span style={S.badge}>{c.invoices.length}</span>
              </div>
              {["current", "days30", "days60", "days90", "over90"].map((k) => (
                <div key={k} style={{ ...S.cell, flex: 1, textAlign: "right", color: b[k] ? COL_COLORS[k] : C.textFaint, fontWeight: b[k] ? 700 : 400 }}>
                  {b[k] ? fmt(b[k]) : "\u2014"}
                </div>
              ))}
              <div style={{ ...S.cell, flex: 1, textAlign: "right", fontWeight: 800, fontFamily: F.display, fontSize: 14, color: C.textHead }}>
                {fmt(c.total)}
              </div>
              <div style={{ ...S.cell, width: 30, textAlign: "center", color: C.textFaint }}>{"\u203A"}</div>
            </div>
          );
        })}
      </div>
      <div style={S.footer}>
        <span>{filtered.length} customer{filtered.length !== 1 ? "s" : ""}</span>
        <span style={{ fontWeight: 700, color: C.textHead }}>Filtered: {fmt(filteredTotal)}</span>
      </div>
    </div>
  );
}

const S = {
  wrap: { border: `1px solid ${C.borderStrong}`, borderRadius: 10, overflow: "hidden", background: C.linenCard },
  header: { display: "flex", background: C.dark, padding: "0 12px" },
  headerCell: { fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint, padding: "10px 8px", flex: 1 },
  arrow: { fontSize: 8, opacity: 0.7 },
  body: { maxHeight: "calc(100vh - 360px)", overflowY: "auto" },
  row: { display: "flex", padding: "0 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", transition: "background 0.1s", alignItems: "center" },
  cell: { padding: "10px 8px", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  badge: { display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.dark, color: C.textFaint, fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "1px 5px", marginLeft: 6, fontFamily: F.display },
  footer: { display: "flex", justifyContent: "space-between", padding: "10px 16px", fontSize: 11, color: C.textFaint, borderTop: `1px solid ${C.borderStrong}` },
};
