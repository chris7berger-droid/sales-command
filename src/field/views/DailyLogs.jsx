import { useState } from "react";
import { C } from "../../lib/tokens";
import { fmtD, tod } from "../../lib/utils";
import FieldScreen, {
  StatStrip,
  FilterChips,
  StatusChip,
  ErrorNote,
  PlainTable,
  RefreshBtn,
} from "../components/FieldScreen";
import { useAsync } from "../lib/useAsync";
import { fetchFieldLogs } from "../lib/queries";
import { logTypeLabel, logTypeTone } from "../lib/display";

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${fmtD(d.toLocaleDateString("en-CA"))} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

function dayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA");
}

export default function DailyLogs() {
  const { data: rows, loading, error, reload } = useAsync(() => fetchFieldLogs({ days: 7 }), []);
  const [chip, setChip] = useState("all");
  const list = rows || [];
  const today = tod();
  const todayRows = list.filter((r) => dayKey(r.at) === today);
  const start = list.filter((r) => String(r.type || "").toUpperCase() === "SOD");
  const mid = list.filter((r) => String(r.type || "").toUpperCase() === "MOD");
  const end = list.filter((r) => String(r.type || "").toUpperCase() === "EOD");
  const shown = chip === "SOD" ? start : chip === "MOD" ? mid : chip === "EOD" ? end : list;

  return (
    <FieldScreen
      title="Daily Logs"
      subtitle="Did today get written down — or is something late?"
      right={<RefreshBtn onClick={reload} loading={loading} />}
    >
      <StatStrip
        items={[
          { label: "Today", value: todayRows.length, tone: "teal" },
          { label: "Start", value: start.length, tone: "teal" },
          { label: "Mid", value: mid.length, tone: "amber" },
          { label: "End", value: end.length, tone: "red" },
        ]}
      />
      <FilterChips
        value={chip}
        onChange={setChip}
        options={[
          { id: "all", label: "All", count: list.length },
          { id: "SOD", label: "Start", count: start.length },
          { id: "MOD", label: "Mid", count: mid.length },
          { id: "EOD", label: "End", count: end.length },
        ]}
      />
      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : (
        <PlainTable
          rows={shown}
          empty={loading ? "Loading…" : "No log entries in the last 7 days."}
          columns={[
            { key: "at", label: "When", render: (r) => fmtWhen(r.at) },
            { key: "job", label: "Job" },
            {
              key: "type",
              label: "Type",
              render: (r) => <StatusChip tone={logTypeTone(r.type)}>{logTypeLabel(r.type)}</StatusChip>,
            },
            {
              key: "notes",
              label: "Notes",
              render: (r) => r.notes || <span style={{ color: C.textFaint }}>—</span>,
            },
          ]}
        />
      )}
    </FieldScreen>
  );
}
