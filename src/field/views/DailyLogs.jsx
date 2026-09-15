import { fmtD } from "../../lib/utils";
import { useAsync } from "../components/FieldScreen";
import {
  FieldOfficeScreen,
  FieldOfficeTable,
  FieldOfficeError,
  LogTypeBadge,
  recordCount,
} from "../components/FieldOfficeList";
import { fetchFieldLogs } from "../lib/queries";

function WhenCell({ at }) {
  if (!at) return <span className="field-office-dash">—</span>;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return <span className="field-office-dash">—</span>;
  return (
    <>
      <div className="field-office-when-date">{fmtD(d.toLocaleDateString("en-CA"))}</div>
      <div className="field-office-when-time">
        {d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </div>
    </>
  );
}

export default function DailyLogs() {
  const { data: rows, loading, error, reload } = useAsync(() => fetchFieldLogs({ days: 7 }), []);
  const loaded = Array.isArray(rows);
  return (
    <FieldOfficeScreen
      title="Daily Logs"
      subtitle="Start-of-day, mid-day, and end-of-day entries — last 7 days"
      count={!error && loaded ? recordCount(rows.length, "entry", "entries") : null}
      loading={loading}
      onRefresh={reload}
    >
      {error ? (
        <FieldOfficeError>{error}</FieldOfficeError>
      ) : (
        <FieldOfficeTable
          loaded={loaded}
          loading={loading}
          rows={rows || []}
          empty="No log entries in the last 7 days."
          columns={[
            {
              key: "at",
              label: "When",
              width: "minmax(120px, 0.9fr)",
              render: (r) => <WhenCell at={r.at} />,
            },
            {
              key: "job",
              label: "Job",
              width: "minmax(160px, 1.3fr)",
            },
            {
              key: "type",
              label: "Type",
              width: "minmax(76px, 0.55fr)",
              render: (r) => <LogTypeBadge type={r.type} />,
            },
            {
              key: "notes",
              label: "Notes",
              width: "minmax(200px, 2fr)",
              render: (r) =>
                r.notes ? <div className="field-office-notes">{r.notes}</div> : <span className="field-office-dash">—</span>,
            },
          ]}
        />
      )}
    </FieldOfficeScreen>
  );
}
