import { useState } from "react";
import { fmtD } from "../../lib/utils";
import FieldScreen, {
  StatStrip,
  FilterChips,
  StatusChip,
  ErrorNote,
  PlainTable,
  RefreshBtn,
} from "../components/FieldScreen";
import { useAsync } from "../lib/useAsync";
import { fetchFieldPunches } from "../lib/queries";

const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

function punchTone(type) {
  const t = String(type || "").toLowerCase();
  if (t === "clock_in") return "teal";
  if (t === "clock_out") return "red";
  return "muted";
}
function punchLabel(type) {
  const t = String(type || "").toLowerCase();
  if (t === "clock_in") return "Clock in";
  if (t === "clock_out") return "Clock out";
  return type ? String(type).replace(/_/g, " ") : "—";
}

export default function TimeClock() {
  const { data, loading, error, reload } = useAsync(fetchFieldPunches, []);
  const [chip, setChip] = useState("all");
  const rows = data?.punches || [];
  const clockIn = rows.filter((r) => String(r.type || "").toLowerCase() === "clock_in");
  const clockOut = rows.filter((r) => String(r.type || "").toLowerCase() === "clock_out");
  const shown = chip === "clock_in" ? clockIn : chip === "clock_out" ? clockOut : rows;

  return (
    <FieldScreen
      title="Time Clock"
      subtitle={data?.today ? `Crew punches · ${fmtD(data.today)}` : "Crew punches, by job and day"}
      right={<RefreshBtn onClick={reload} loading={loading} />}
    >
      <StatStrip
        items={[
          { label: "Punches", value: rows.length, tone: "teal" },
          { label: "Clock in", value: clockIn.length, tone: "teal" },
          { label: "Clock out", value: clockOut.length, tone: "red" },
        ]}
      />
      <FilterChips
        value={chip}
        onChange={setChip}
        options={[
          { id: "all", label: "All", count: rows.length },
          { id: "clock_in", label: "Clock in", count: clockIn.length },
          { id: "clock_out", label: "Clock out", count: clockOut.length },
        ]}
      />
      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : (
        <PlainTable
          rows={shown}
          empty={loading ? "Loading…" : "No punches today."}
          columns={[
            { key: "time", label: "Time", render: (r) => fmtTime(r.time) },
            { key: "member", label: "Crew member" },
            { key: "job", label: "Job" },
            {
              key: "type",
              label: "Punch",
              render: (r) => <StatusChip tone={punchTone(r.type)}>{punchLabel(r.type)}</StatusChip>,
            },
          ]}
        />
      )}
    </FieldScreen>
  );
}
