import { useState } from "react";
import { C } from "../../lib/tokens";
import { fmtD } from "../../lib/utils";
import FieldScreen, {
  StatStrip,
  FilterChips,
  StatusChip,
  ErrorNote,
  EmptyNote,
  RefreshBtn,
} from "../components/FieldScreen";
import { useAsync } from "../lib/useAsync";
import { fetchLoadOutJobs } from "../lib/queries";
import { loadJobWithWTCs } from "../../schedule/lib/queries";
import LoadOutModal from "../../schedule/components/LoadOutModal";
import Btn from "../../components/Btn";

function loadOutChip(j) {
  const total = j.total || 0;
  const loaded = j.loaded || 0;
  if (total === 0) return { label: "No list", tone: "muted" };
  if (loaded >= total) return { label: "Ready", tone: "teal" };
  if (loaded > 0) return { label: "Short", tone: "amber" };
  return { label: "Not loaded", tone: "red" };
}

function isReady(j) {
  return loadOutChip(j).label === "Ready";
}

// Load-Outs is a SHORTCUT into Schedule's existing LoadOutModal (two doors, one
// room). The list is a thin near-term window; opening a job hydrates it through
// the canonical loadJobWithWTCs (no drifting fetch) and hands it to the modal.
// The modal's CSS is fenced under .schedule-root, so it's rendered inside that.
export default function LoadOuts() {
  const { data, loading, error, reload } = useAsync(fetchLoadOutJobs, []);
  const [chip, setChip] = useState("all");
  const [openJob, setOpenJob] = useState(null);
  const [opening, setOpening] = useState(null);
  const [openError, setOpenError] = useState(null);

  const jobs = data?.jobs || [];
  const ready = jobs.filter(isReady);
  const notReady = jobs.filter((j) => !isReady(j));
  const shown = chip === "ready" ? ready : chip === "notready" ? notReady : jobs;

  async function open(jobPk) {
    setOpening(jobPk);
    setOpenError(null);
    try {
      const { data: job, error: err } = await loadJobWithWTCs(jobPk);
      if (err || !job) throw err || new Error("Job not found");
      setOpenJob(job);
    } catch (e) {
      setOpenError(e?.message || "Could not open load-out");
    } finally {
      setOpening(null);
    }
  }

  const note = error || openError;

  return (
    <FieldScreen
      title="Load-Outs"
      subtitle="Material load-outs for the next several days"
      right={<RefreshBtn onClick={reload} loading={loading} />}
    >
      <StatStrip
        items={[
          { label: "Jobs", value: jobs.length, tone: "teal" },
          { label: "Ready", value: ready.length, tone: "teal" },
          { label: "Not ready", value: notReady.length, tone: "red" },
        ]}
      />
      <FilterChips
        value={chip}
        onChange={setChip}
        options={[
          { id: "all", label: "All", count: jobs.length },
          { id: "notready", label: "Not ready", count: notReady.length },
          { id: "ready", label: "Ready", count: ready.length },
        ]}
      />
      {note && <ErrorNote>{note}</ErrorNote>}

      {loading && jobs.length === 0 && !note && <EmptyNote>Loading…</EmptyNote>}
      {!note && !loading && jobs.length === 0 && (
        <EmptyNote>No jobs to load out in the next several days.</EmptyNote>
      )}

      {shown.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((j) => {
            const st = loadOutChip(j);
            return (
              <div key={j.jobPk} style={cardStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.textHead, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {j.jobName}
                  </div>
                  <div style={{ fontSize: 12, color: C.textFaint, marginTop: 4 }}>
                    {j.jobNum ? `#${j.jobNum} · ` : ""}
                    {j.scheduledStart ? fmtD(j.scheduledStart) : "unscheduled"}
                    {` · ${j.loaded || 0} of ${j.total || 0} loaded`}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <StatusChip tone={st.tone}>{st.label}</StatusChip>
                  <Btn v="teal" sz="sm" onClick={() => open(j.jobPk)} disabled={opening === j.jobPk}>
                    {opening === j.jobPk ? "…" : "Load-out"}
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openJob && (
        <div className="schedule-root">
          <LoadOutModal job={openJob} onClose={() => setOpenJob(null)} />
        </div>
      )}
    </FieldScreen>
  );
}

const cardStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  padding: "12px 16px",
  background: C.linenCard,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
};
