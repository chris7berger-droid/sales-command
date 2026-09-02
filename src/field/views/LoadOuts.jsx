import { useEffect, useState, useCallback } from "react";
import { C, F } from "../../lib/tokens";
import { fmtD } from "../../lib/utils";
import FieldScreen from "../components/FieldScreen";
import { fetchLoadOutJobs } from "../lib/queries";
import { loadJobWithWTCs } from "../../schedule/lib/queries";
import LoadOutModal from "../../schedule/components/LoadOutModal";

// Load-Outs is a SHORTCUT into Schedule's existing LoadOutModal (two doors, one
// room). The list is a thin near-term window; opening a job hydrates it through
// the canonical loadJobWithWTCs (no drifting fetch) and hands it to the modal.
// The modal's CSS is fenced under .schedule-root, so it's rendered inside that.
export default function LoadOuts() {
  const [state, setState] = useState({ loading: true, error: null, jobs: [] });
  const [openJob, setOpenJob] = useState(null); // hydrated job for the modal
  const [opening, setOpening] = useState(null); // jobPk currently hydrating

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { jobs } = await fetchLoadOutJobs();
      setState({ loading: false, error: null, jobs });
    } catch (e) {
      setState({ loading: false, error: e?.message || "Failed to load", jobs: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function open(jobPk) {
    setOpening(jobPk);
    try {
      const { data, error } = await loadJobWithWTCs(jobPk);
      if (error || !data) throw error || new Error("Job not found");
      setOpenJob(data);
    } catch (e) {
      setState((s) => ({ ...s, error: e?.message || "Could not open load-out" }));
    } finally {
      setOpening(null);
    }
  }

  const { loading, error, jobs } = state;

  return (
    <FieldScreen
      title="Load-Outs"
      subtitle="Material load-outs for the next several days"
      right={
        <button onClick={load} disabled={loading} style={btnStyle}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      }
    >
      {error && (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "#3a1c1c", color: "#ef6b6b", fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {!error && !loading && jobs.length === 0 && (
        <div style={emptyStyle}>No jobs to load out in the next several days.</div>
      )}

      {jobs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {jobs.map((j) => (
            <div key={j.jobPk} style={cardStyle}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.textHead, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {j.jobName}
                </div>
                <div style={{ fontSize: 12, color: C.textFaint }}>
                  {j.jobNum ? `#${j.jobNum} · ` : ""}
                  {j.scheduledStart ? fmtD(j.scheduledStart) : "unscheduled"}
                  {j.loaded > 0 ? ` · ${j.loaded} loaded` : ""}
                </div>
              </div>
              <button onClick={() => open(j.jobPk)} disabled={opening === j.jobPk} style={btnStyle}>
                {opening === j.jobPk ? "…" : "Load-out →"}
              </button>
            </div>
          ))}
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

const btnStyle = {
  background: C.dark,
  color: C.teal,
  border: "none",
  borderRadius: 6,
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: 700,
  fontFamily: F.ui,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
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
const emptyStyle = {
  border: `1px dashed ${C.borderStrong}`,
  borderRadius: 10,
  background: C.linenCard,
  padding: "40px 24px",
  textAlign: "center",
  color: C.textLight,
  fontSize: 14,
};
