import { C } from "../../lib/tokens";
import { fmtD } from "../../lib/utils";
import FieldScreen, { PlainTable, RefreshBtn, useAsync } from "../components/FieldScreen";
import { fetchFieldJobs } from "../lib/queries";

export default function Jobs() {
  const { data: rows, loading, error, reload } = useAsync(fetchFieldJobs, []);
  return (
    <FieldScreen
      title="Jobs"
      subtitle="Every active field job, view-only for the office"
      right={<RefreshBtn onClick={reload} loading={loading} />}
    >
      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : (
        <PlainTable
          keyField="jobPk"
          rows={rows || []}
          empty={loading ? "Loading…" : "No active field jobs."}
          columns={[
            {
              key: "job",
              label: "Job",
              render: (r) => (
                <span>
                  {r.jobNum ? <b style={{ color: C.textHead }}>#{r.jobNum}</b> : null} {r.jobName}
                </span>
              ),
            },
            { key: "stage", label: "Stage", render: (r) => r.stage || "—" },
            {
              key: "sched",
              label: "Scheduled",
              render: (r) =>
                r.scheduledStart
                  ? `${fmtD(r.scheduledStart)}${r.scheduledEnd ? " – " + fmtD(r.scheduledEnd) : ""}`
                  : "—",
            },
          ]}
        />
      )}
    </FieldScreen>
  );
}

function ErrorNote({ children }) {
  return <div style={{ padding: "12px 16px", borderRadius: 8, background: "#3a1c1c", color: "#ef6b6b", fontSize: 13 }}>{children}</div>;
}
