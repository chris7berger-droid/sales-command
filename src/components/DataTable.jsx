import { useState, useMemo } from "react";
import { C, F } from "../lib/tokens";

export default function DataTable({ cols, rows, onRow, defaultSort = null }) {
  const initialIdx = defaultSort
    ? cols.findIndex((c, i) => (defaultSort.key ? c.k === defaultSort.key : false) || (defaultSort.idx === i))
    : -1;
  const [sortIdx, setSortIdx] = useState(initialIdx);
  const [sortDir, setSortDir] = useState(defaultSort?.dir === "desc" ? "desc" : "asc");

  const isSortable = (c) => c.sortable !== false && !!c.l;

  const handleSort = (i) => {
    if (!isSortable(cols[i])) return;
    if (sortIdx === i) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortIdx(i);
      setSortDir("asc");
    }
  };

  const sortedRows = useMemo(() => {
    if (sortIdx < 0 || !cols[sortIdx]) return rows;
    const col = cols[sortIdx];
    const getVal = col.sortVal || ((r) => r[col.k]);
    const cmp = (a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      const aNull = av === null || av === undefined || av === "";
      const bNull = bv === null || bv === undefined || bv === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      if (av instanceof Date && bv instanceof Date) return av - bv;
      const aDate = Date.parse(av);
      const bDate = Date.parse(bv);
      if (!isNaN(aDate) && !isNaN(bDate) && /^\d{4}-\d{2}-\d{2}/.test(String(av))) return aDate - bDate;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
    };
    return [...rows].sort((a, b) => (sortDir === "asc" ? cmp(a, b) : cmp(b, a)));
  }, [rows, sortIdx, sortDir, cols]);

  return (
    <div style={{
      overflowX: "auto",
      borderRadius: 10,
      border: `1px solid ${C.borderStrong}`,
      boxShadow: "0 2px 10px rgba(28,24,20,0.08)",
    }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
        <thead>
          <tr style={{ background: C.dark }}>
            {cols.map((c, i) => {
              const sortable = isSortable(c);
              const active = sortIdx === i;
              return (
                <th
                  key={i}
                  onClick={sortable ? () => handleSort(i) : undefined}
                  style={{
                    padding: "11px 15px",
                    textAlign: "left",
                    fontWeight: 700,
                    fontSize: 10.5,
                    color: active ? C.teal : "rgba(255,255,255,0.45)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    borderBottom: `1px solid ${C.darkBorder}`,
                    whiteSpace: "nowrap",
                    cursor: sortable ? "pointer" : "default",
                    userSelect: "none",
                  }}
                >
                  {c.l}
                  {sortable && (
                    <span style={{
                      marginLeft: 6,
                      fontSize: 10,
                      color: active ? C.teal : "rgba(255,255,255,0.25)",
                      fontWeight: 800,
                    }}>
                      {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <tr key={i}
              onClick={() => onRow && onRow(row)}
              style={{
                borderBottom: `1px solid ${C.border}`,
                background: i % 2 === 0 ? C.linenLight : C.linen,
                cursor: onRow ? "pointer" : "default",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => { if (onRow) e.currentTarget.style.background = C.tealGlow; }}
              onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? C.linenLight : C.linen; }}
            >
              {cols.map((c, j) => (
                <td key={j} style={{ padding: "12px 15px", color: C.textBody, verticalAlign: "middle" }}>
                  {c.r ? c.r(row[c.k], row) : row[c.k] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
