import { C, F, COL } from "../lib/tokens";
import { fmtShort } from "../lib/utils";
import { useAR } from "../lib/ARContext";

export default function Scorecards({ currentFilter, onFilterChange }) {
  const { getTotals } = useAR();
  const t = getTotals();

  const cards = [
    { id: "all", label: "All Outstanding", amount: t.total, count: t.cCur + t.c30 + t.c60 + t.c90 + t.cO90, bg: "#1e293b" },
    { id: "current", label: "Current", amount: t.current, count: t.cCur, bg: COL.cur.bg },
    { id: "days30", label: "1\u201330 Days", amount: t.days30, count: t.c30, bg: COL.d30.bg },
    { id: "days60", label: "31\u201360 Days", amount: t.days60, count: t.c60, bg: COL.d60.bg },
    { id: "days90", label: "61\u201390 Days", amount: t.days90, count: t.c90, bg: COL.d90.bg },
    { id: "over90", label: "91+ Days", amount: t.over90, count: t.cO90, bg: COL.o90.bg },
    { id: "retention", label: "Retention", amount: t.retention, count: t.cRet, bg: COL.ret.bg },
    { id: "collections", label: "In Collections", amount: t.collections, count: t.cColl, bg: COL.coll.bg },
    { id: "goback", label: "Go Back Issues", amount: t.goback, count: t.cGo, bg: COL.goback.bg },
    { id: "acctreview", label: "Acct Review", amount: t.acct, count: t.cAcct, bg: "#1565c0" },
  ];

  return (
    <div style={S.wrap}>
      {cards.map((c) => {
        const active = currentFilter === c.id;
        return (
          <div key={c.id} onClick={() => onFilterChange(c.id)}
            style={{
              ...S.card,
              ...(active ? { background: c.bg, borderColor: c.bg, transform: "translateY(-2px)", boxShadow: `0 6px 20px ${c.bg}33` } : {}),
            }}>
            <div style={S.label}>{c.label}</div>
            <div style={{ ...S.amount, color: active ? "#fff" : c.bg }}>{fmtShort(c.amount)}</div>
            <div style={{ ...S.count, ...(active ? { color: "rgba(255,255,255,0.7)" } : {}) }}>{c.count} account{c.count !== 1 ? "s" : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

const S = {
  wrap: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  card: { flex: "1 1 120px", minWidth: 120, border: `2px solid ${C.borderStrong}`, borderRadius: 10, padding: "16px 14px 14px", cursor: "pointer", textAlign: "left", transition: "all 0.2s", background: C.linenCard },
  label: { fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textMuted, marginBottom: 6 },
  amount: { fontFamily: F.display, fontSize: 22, fontWeight: 800, lineHeight: 1.1 },
  count: { fontSize: 11, color: C.textFaint, marginTop: 4 },
};
