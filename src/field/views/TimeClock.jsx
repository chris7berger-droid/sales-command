import { fmtD } from "../../lib/utils";
import FieldScreen, { PlainTable, RefreshBtn, useAsync } from "../components/FieldScreen";
import { fetchFieldPunches } from "../lib/queries";

const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};
const label = (t) => (t ? t.replace(/_/g, " ") : "—");

export default function TimeClock() {
  const { data, loading, error, reload } = useAsync(fetchFieldPunches, []);
  const rows = data?.punches || [];
  return (
    <FieldScreen
      title="Time Clock"
      subtitle={data?.today ? `Crew punches · ${fmtD(data.today)}` : "Crew punches, by job and day"}
      right={<RefreshBtn onClick={reload} loading={loading} />}
    >
      {error ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "#3a1c1c", color: "#ef6b6b", fontSize: 13 }}>{error}</div>
      ) : (
        <PlainTable
          rows={rows}
          empty={loading ? "Loading…" : "No punches today."}
          columns={[
            { key: "time", label: "Time", render: (r) => fmtTime(r.time) },
            { key: "member", label: "Crew member" },
            { key: "job", label: "Job" },
            { key: "type", label: "Punch", render: (r) => label(r.type) },
          ]}
        />
      )}
    </FieldScreen>
  );
}
