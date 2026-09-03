import { useEffect, useState, useCallback } from "react";
import { C, F } from "../../lib/tokens";
import { fmtD } from "../../lib/utils";
import FieldScreen from "../components/FieldScreen";
import { fetchTodayRows } from "../lib/queries";

// The at-a-glance list: one row per job going today —
// Job · Crew · Hrs · SOD · MOD · EOD · PRT · Load-out.
// Late "!" reuses the phone's rule (src/field/lib/lateForm.js) so desk + phone
// flag the same jobs. View-only.
export default function Today() {
  const [state, setState] = useState({ loading: true, error: null, rows: [], today: "" });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { rows, today } = await fetchTodayRows();
      setState({ loading: false, error: null, rows, today });
    } catch (e) {
      setState({ loading: false, error: e?.message || "Failed to load", rows: [], today: "" });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { loading, error, rows, today } = state;

  return (
    <FieldScreen
      title="Today"
      subtitle={today ? fmtD(today) : "Every job running today, at a glance"}
      right={
        <button onClick={load} disabled={loading} style={btnStyle}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      }
    >
      {error && <Banner>{error}</Banner>}

      {!error && !loading && rows.length === 0 && (
        <div style={emptyStyle}>No jobs scheduled for today.</div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th style={{ textAlign: "left" }}>Job</Th>
                <Th style={{ textAlign: "left" }}>Crew</Th>
                <Th>Hrs</Th>
                <Th>SOD</Th>
                <Th>MOD</Th>
                <Th>EOD</Th>
                <Th>PRT</Th>
                <Th>Load-out</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.jobId} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700, color: C.textHead }}>{r.jobName}</div>
                    {r.jobNum != null && (
                      <div style={{ fontSize: 11.5, color: C.textFaint }}>#{r.jobNum}</div>
                    )}
                  </Td>
                  <Td style={{ textAlign: "left", color: C.textBody }}>
                    {r.crew.length ? r.crew.join(", ") : <span style={{ color: C.textFaint }}>—</span>}
                  </Td>
                  <Td>{r.hours > 0 ? r.hours.toFixed(1) : <Faint />}</Td>
                  <Td><FormCell f={r.sod} /></Td>
                  <Td><FormCell f={r.mod} /></Td>
                  <Td><FormCell f={r.eod} /></Td>
                  <Td><FormCell f={r.prt} /></Td>
                  <Td><LoadoutCell lo={r.loadout} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && <Legend />}
    </FieldScreen>
  );
}

// ── status cells ───────────────────────────────────────────────────────
const LEVEL_COLOR = { amber: "#e0a92e", red: "#ef6b6b" };

function FormCell({ f }) {
  if (!f) return <Faint />;
  if (f.status === "done") return <Pill color={C.teal}>✓</Pill>;
  if (f.status === "due") return <Pill color={LEVEL_COLOR[f.level] || LEVEL_COLOR.amber}>!</Pill>;
  if (f.status === "off") return <Faint title="not required" />;
  return <Faint title="not yet due" />; // pending
}

function LoadoutCell({ lo }) {
  if (!lo || lo.total === 0) return <Faint />;
  const done = lo.checked >= lo.total;
  return (
    <Pill color={done ? C.teal : LEVEL_COLOR.amber}>
      {lo.checked}/{lo.total}
    </Pill>
  );
}

function Pill({ color, children }) {
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: 26,
        padding: "3px 8px",
        borderRadius: 6,
        background: C.dark,
        color,
        fontWeight: 800,
        fontSize: 12.5,
        fontFamily: F.ui,
        lineHeight: 1.2,
      }}
    >
      {children}
    </span>
  );
}

function Faint({ title }) {
  return (
    <span title={title} style={{ color: C.textFaint }}>
      ·
    </span>
  );
}

function Legend() {
  return (
    <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, color: C.textLight }}>
      <span><Pill color={C.teal}>✓</Pill> filed</span>
      <span><Pill color={LEVEL_COLOR.amber}>!</Pill> overdue (start / mid-day)</span>
      <span><Pill color={LEVEL_COLOR.red}>!</Pill> missing (end-of-day / production report)</span>
      <span><Faint /> not yet due</span>
      <span style={{ color: C.textFaint }}>
        SOD start-of-day · MOD mid-day · EOD end-of-day · PRT production report
      </span>
    </div>
  );
}

// ── table primitives ───────────────────────────────────────────────────
function Th({ children, style }) {
  return (
    <th
      style={{
        textAlign: "center",
        padding: "8px 12px",
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: C.textMuted,
        fontFamily: F.ui,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, style }) {
  return (
    <td style={{ textAlign: "center", padding: "10px 12px", fontSize: 13.5, fontFamily: F.ui, verticalAlign: "middle", ...style }}>
      {children}
    </td>
  );
}
function Banner({ children }) {
  return (
    <div style={{ padding: "12px 16px", borderRadius: 8, background: "#3a1c1c", color: "#ef6b6b", fontSize: 13, marginBottom: 14 }}>
      {children}
    </div>
  );
}

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  background: C.linenCard,
  borderRadius: 10,
  overflow: "hidden",
};
const emptyStyle = {
  border: `1px dashed ${C.borderStrong}`,
  borderRadius: 10,
  background: C.linenCard,
  padding: "40px 24px",
  textAlign: "center",
  color: C.textLight,
  fontSize: 14,
};
const btnStyle = {
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
