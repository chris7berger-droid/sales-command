import { useState } from "react";
import { C } from "../../lib/tokens";
import FieldScreen, {
  StatStrip,
  FilterChips,
  StatusChip,
  ErrorNote,
  PlainTable,
  RefreshBtn,
} from "../components/FieldScreen";
import { useAsync } from "../lib/useAsync";
import { fetchFieldCrews } from "../lib/queries";
import { prettyStage, stageTone } from "../lib/display";

export default function Crews() {
  const { data, loading, error, reload } = useAsync(fetchFieldCrews, []);
  const [chip, setChip] = useState("people");
  const assignments = data?.assignments || [];
  const jobs = data?.jobs || [];
  const missing = jobs.filter((j) => (j.crewCount || 0) === 0);
  const covered = jobs.filter((j) => (j.crewCount || 0) > 0).length;

  return (
    <FieldScreen
      title="Crews"
      subtitle="Who's on it. Who's missing."
      right={<RefreshBtn onClick={reload} loading={loading} />}
    >
      <StatStrip
        items={[
          { label: "People out", value: assignments.length, tone: "teal" },
          { label: "Jobs covered", value: covered, tone: "teal" },
          { label: "Missing crew", value: missing.length, tone: "red" },
        ]}
      />
      <FilterChips
        value={chip}
        onChange={setChip}
        options={[
          { id: "people", label: "People", count: assignments.length },
          { id: "missing", label: "Missing crew", count: missing.length },
        ]}
      />
      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : chip === "missing" ? (
        <PlainTable
          keyField="jobPk"
          rows={missing}
          empty={loading ? "Loading…" : "Every active job has a crew."}
          columns={[
            {
              key: "job",
              label: "Job #",
              render: (r) => (
                <span>
                  {r.jobNum ? <b style={{ color: C.textHead }}>#{r.jobNum}</b> : "—"} {r.jobName}
                </span>
              ),
            },
            {
              key: "stage",
              label: "Status",
              render: (r) => <StatusChip tone={stageTone(r.stage)}>{prettyStage(r.stage)}</StatusChip>,
            },
            {
              key: "crew",
              label: "Crew",
              render: () => <StatusChip tone="red">None</StatusChip>,
            },
          ]}
        />
      ) : (
        <PlainTable
          rows={assignments}
          empty={loading ? "Loading…" : "No crew assigned to active jobs."}
          columns={[
            { key: "member", label: "Crew member" },
            { key: "role", label: "Role", render: (r) => r.role || "—" },
            { key: "job", label: "Job" },
          ]}
        />
      )}
    </FieldScreen>
  );
}
