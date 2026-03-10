import { C, F } from "../lib/tokens";

export default function DataTable({ cols, rows, onRow }) {
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
            {cols.map(c => (
              <th key={c.k} style={{
                padding: "11px 15px",
                textAlign: "left",
                fontWeight: 700,
                fontSize: 10.5,
                color: "rgba(255,255,255,0.45)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                borderBottom: `1px solid ${C.darkBorder}`,
                whiteSpace: "nowrap",
              }}>
                {c.l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
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
              {cols.map(c => (
                <td key={c.k} style={{ padding: "12px 15px", color: C.textBody, verticalAlign: "middle" }}>
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