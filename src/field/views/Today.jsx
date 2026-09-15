import { C, F } from "../../lib/tokens";
import FieldScreen, {
  StatStrip,
  ErrorNote,
  EmptyNote,
  RefreshBtn,
} from "../components/FieldScreen";
import { useAsync } from "../lib/useAsync";
import { fetchTodayRows } from "../lib/queries";

function needsLook(r) {
  const due = [r.sod, r.mod, r.eod, r.prt].some((f) => f?.status === "due");
  const lo = r.loadout;
  const shortLoad = lo && lo.total > 0 && lo.checked < lo.total;
  return due || shortLoad;
}

// The at-a-glance list: one row per job going today —
// Job · Crew · Hrs · SOD · MOD · EOD · PRT · Load-out.
// Late "!" reuses the phone's rule (src/field/lib/lateForm.js) so desk + phone
// flag the same jobs. View-only.
export default function Today() {
  const { data, loading, error, reload } = useAsync(fetchTodayRows, []);
  const rows = data?.rows || [];
  const look = rows.filter(needsLook);

  return (
    <FieldScreen
      title="Today"
      subtitle="Is today under control"
      right={<RefreshBtn onClick={reload} loading={loading} />}
    >
      <StatStrip
        items={[
          { label: "Running", value: rows.length, tone: "teal" },
          { label: "Need a look", value: look.length, tone: "red" },
        ]}
      />
      {error && <ErrorNote>{error}</ErrorNote>}

      {!error && !loading && rows.length === 0 && (
        <EmptyNote>No jobs scheduled for today.</EmptyNote>
      )}

      {rows.length > 0 && (
        <div
          style={{
            overflowX: "auto",
            borderRadius: 10,
            border: `1px solid ${C.borderStrong}`,
            boxShadow: "0 2px 10px rgba(28,24,20,0.08)",
          }}
        >
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: C.dark }}>
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
              {rows.map((r, i) => (
                <tr
                  key={r.jobId}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    background: i % 2 === 0 ? C.linenLight : C.linen,
                  }}
                >
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
const LEVEL_COLOR = { amber: C.amber, red: C.red };

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

function Th({ children, style }) {
  return (
    <th
      style={{
        textAlign: "center",
        padding: "11px 15px",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.45)",
        fontFamily: F.ui,
        whiteSpace: "nowrap",
        borderBottom: `1px solid ${C.darkBorder}`,
        ...style,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, style }) {
  return (
    <td style={{ textAlign: "center", padding: "12px 15px", fontSize: 13.5, fontFamily: F.ui, verticalAlign: "middle", ...style }}>
      {children}
    </td>
  );
}

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  fontFamily: F.ui,
};
