import { fmtD } from "../../lib/utils";
import { useAsync } from "../components/FieldScreen";
import {
  FieldOfficeScreen,
  FieldOfficeTable,
  FieldOfficeError,
  PunchBadge,
  recordCount,
} from "../components/FieldOfficeList";
import { fetchFieldPunches } from "../lib/queries";

const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export default function TimeClock() {
  const { data, loading, error, reload } = useAsync(fetchFieldPunches, []);
  const rows = data?.punches;
  const loaded = Array.isArray(rows);
  return (
    <FieldOfficeScreen
      title="Time Clock"
      subtitle={data?.today ? `Crew punches · ${fmtD(data.today)}` : "Crew punches, by job and day"}
      count={!error && loaded ? recordCount(rows.length, "punch", "punches") : null}
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
          empty="No punches today."
          columns={[
            {
              key: "time",
              label: "Time",
              width: "minmax(88px, 0.7fr)",
              render: (r) => fmtTime(r.time),
            },
            {
              key: "member",
              label: "Crew member",
              width: "minmax(140px, 1.2fr)",
              render: (r) => <span className="field-office-member">{r.member}</span>,
            },
            {
              key: "job",
              label: "Job",
              width: "minmax(180px, 1.6fr)",
            },
            {
              key: "type",
              label: "Punch",
              width: "minmax(120px, 0.9fr)",
              render: (r) => <PunchBadge type={r.type} />,
            },
          ]}
        />
      )}
    </FieldOfficeScreen>
  );
}
