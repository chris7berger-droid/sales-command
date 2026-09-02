import { useEffect, useState, useCallback } from "react";
import { C, F } from "../../lib/tokens";

// Shared chrome for every Field web screen: a titled header band + content well.
// View-only office screens — no toolbar actions (Manager/Admin corrections come later).
export default function FieldScreen({ title, subtitle, right, children }) {
  return (
    <div style={{ fontFamily: F.ui, color: C.textBody }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              color: C.textHead,
              fontFamily: F.display,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <div style={{ marginTop: 4, fontSize: 13.5, color: C.textFaint }}>{subtitle}</div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// Run an async loader on mount + on demand. Returns { data, loading, error, reload }.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: e?.message || "Failed to load" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}

// Minimal data table for the "later UI session" screens — real rows, plain look.
// columns: [{ key, label, align?, render?(row) }]. rows: array of objects.
export function PlainTable({ columns, rows, empty = "Nothing to show.", keyField }) {
  if (!rows || rows.length === 0) return <div style={wellStyle}>{empty}</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", background: C.linenCard, borderRadius: 10, overflow: "hidden" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align || "left",
                  padding: "8px 12px",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: C.textMuted,
                  fontFamily: F.ui,
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={keyField ? row[keyField] : i} style={{ borderTop: `1px solid ${C.border}` }}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{ textAlign: c.align || "left", padding: "10px 12px", fontSize: 13.5, fontFamily: F.ui, color: C.textBody, verticalAlign: "middle" }}
                >
                  {c.render ? c.render(row) : row[c.key] ?? <span style={{ color: C.textFaint }}>—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Shared refresh button for the plain screens.
export function RefreshBtn({ onClick, loading }) {
  return (
    <button onClick={onClick} disabled={loading} style={refreshStyle}>
      {loading ? "…" : "↻ Refresh"}
    </button>
  );
}

const wellStyle = {
  border: `1px dashed ${C.borderStrong}`,
  borderRadius: 10,
  background: C.linenCard,
  padding: "40px 24px",
  textAlign: "center",
  color: C.textLight,
  fontSize: 14,
};
const refreshStyle = {
  background: C.dark,
  color: C.teal,
  border: "none",
  borderRadius: 6,
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: 700,
  fontFamily: F.ui,
  cursor: "pointer",
};
