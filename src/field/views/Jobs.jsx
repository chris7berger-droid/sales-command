import { fmtD } from "../../lib/utils";
import { useAsync } from "../components/FieldScreen";
import {
  FieldOfficeScreen,
  FieldOfficeTable,
  FieldOfficeError,
  QuietBadge,
  recordCount,
} from "../components/FieldOfficeList";
import { fetchFieldJobs } from "../lib/queries";

function fmtRange(start, end) {
  if (!start) return "—";
  const a = fmtD(start);
  if (!end || end === start) return a;
  return `${a} – ${fmtD(end)}`;
}

export default function Jobs() {
  const { data: rows, loading, error, reload } = useAsync(fetchFieldJobs, []);
  const loaded = Array.isArray(rows);
  return (
    <FieldOfficeScreen
      title="Jobs"
      subtitle="Every active field job, view-only for the office"
      count={!error && loaded ? recordCount(rows.length, "job", "jobs") : null}
      loading={loading}
      onRefresh={reload}
    >
      {error ? (
        <FieldOfficeError>{error}</FieldOfficeError>
      ) : (
        <FieldOfficeTable
          keyField="jobPk"
          loaded={loaded}
          loading={loading}
          rows={rows || []}
          empty="No active field jobs."
          columns={[
            {
              key: "job",
              label: "Job",
              width: "minmax(200px, 2.2fr)",
              render: (r) => (
                <>
                  {r.jobNum ? <span className="field-office-jobnum">#{r.jobNum}</span> : null}
                  <span className="field-office-jobname">{r.jobName}</span>
                </>
              ),
            },
            {
              key: "stage",
              label: "Stage",
              width: "minmax(120px, 0.9fr)",
              render: (r) => <QuietBadge>{r.stage}</QuietBadge>,
            },
            {
              key: "sched",
              label: "Scheduled",
              width: "minmax(168px, 1.1fr)",
              render: (r) => fmtRange(r.scheduledStart, r.scheduledEnd),
            },
          ]}
        />
      )}
    </FieldOfficeScreen>
  );
}
