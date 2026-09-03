import { C } from "../../lib/tokens";
import { fmtD } from "../../lib/utils";
import FieldScreen, { PlainTable, RefreshBtn, useAsync } from "../components/FieldScreen";
import { fetchFieldLogs } from "../lib/queries";

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${fmtD(d.toLocaleDateString("en-CA"))} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

export default function DailyLogs() {
  const { data: rows, loading, error, reload } = useAsync(() => fetchFieldLogs({ days: 7 }), []);
  return (
    <FieldScreen
      title="Daily Logs"
      subtitle="Start-of-day, mid-day, and end-of-day entries — last 7 days"
      right={<RefreshBtn onClick={reload} loading={loading} />}
    >
      {error ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "#3a1c1c", color: "#ef6b6b", fontSize: 13 }}>{error}</div>
      ) : (
        <PlainTable
          rows={rows || []}
          empty={loading ? "Loading…" : "No log entries in the last 7 days."}
          columns={[
            { key: "at", label: "When", render: (r) => fmtWhen(r.at) },
            { key: "job", label: "Job" },
            { key: "type", label: "Type", render: (r) => <b style={{ color: C.textHead }}>{r.type || "—"}</b> },
            { key: "notes", label: "Notes", render: (r) => r.notes || <span style={{ color: C.textFaint }}>—</span> },
          ]}
        />
      )}
    </FieldScreen>
  );
}
