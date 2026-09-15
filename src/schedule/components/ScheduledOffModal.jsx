import { useState } from "react";
import {
  CREW_STATUS_SCHEDULED_OFF,
  addDaysIso,
  crewStatusDateKey,
  crewStatusUiLabel,
  nextWeekMonSat,
  thisWeekMonSat,
} from "../lib/crewStatus";

function flipName(n) {
  if (!n) return "";
  const p = String(n).split(",");
  return p.length === 2 ? `${p[1].trim()} ${p[0].trim()}` : String(n);
}

export default function ScheduledOffModal({
  name,
  today,
  initialFrom,
  initialTo,
  phase = "edit",
  plan = null,
  error = "",
  busy = false,
  onCancel,
  onReview,
  onConfirm,
}) {
  const [from, setFrom] = useState(crewStatusDateKey(initialFrom) || today);
  const [to, setTo] = useState(crewStatusDateKey(initialTo) || crewStatusDateKey(initialFrom) || today);

  function setRange(nextFrom, nextTo) {
    const a = crewStatusDateKey(nextFrom);
    const b = crewStatusDateKey(nextTo);
    if (!a) return;
    setFrom(a);
    setTo(!b || b < a ? a : b);
  }

  const title = `${flipName(name).toUpperCase()} — SCHEDULED OFF`;

  return (
    <div className="sch-modal-overlay" onClick={() => { if (!busy) onCancel(); }}>
      <div className="sch-modal sch-modal-soff" onClick={(e) => e.stopPropagation()}>
        <div className="sch-modal-title">{title}</div>
        {phase === "edit" ? (
          <>
            <div className="sch-modal-label">When will this person intentionally be unavailable?</div>
            <div className="sch-soff-dates">
              <label className="sch-soff-field">
                <span>From</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setRange(e.target.value, to)}
                />
              </label>
              <label className="sch-soff-field">
                <span>To</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setRange(from, e.target.value)}
                />
              </label>
            </div>
            <div className="sch-soff-presets">
              <button type="button" className="sch-btn" onClick={() => setRange(today, today)}>Today</button>
              <button type="button" className="sch-btn" onClick={() => { const t = addDaysIso(today, 1); setRange(t, t); }}>Tomorrow</button>
              <button type="button" className="sch-btn" onClick={() => { const w = thisWeekMonSat(today); setRange(w.from, w.to); }}>This Week</button>
              <button type="button" className="sch-btn" onClick={() => { const w = nextWeekMonSat(today); setRange(w.from, w.to); }}>Next Week</button>
            </div>
            {error ? <div className="sch-soff-error" role="alert">{error}</div> : null}
            <div className="sch-modal-actions sch-soff-actions">
              <button type="button" className="sch-btn" disabled={busy} onClick={onCancel}>Cancel</button>
              <button
                type="button"
                className="sch-btn"
                style={{ background: "var(--command-green)", color: "var(--ink)", borderColor: "var(--command-green)" }}
                disabled={busy}
                onClick={() => onReview(from, to)}
              >
                {busy ? "Checking…" : "Schedule Off"}
              </button>
            </div>
          </>
        ) : (
          <>
            {plan?.assignmentConflicts?.length > 0 ? (
              <div className="sch-soff-warn" role="alert">
                <strong>{flipName(name)} has existing job assignments during this Scheduled Off period.</strong>
                <p>Scheduled Off will record planned unavailability. Existing job assignments will remain unchanged and may need crew coverage or reassignment.</p>
                <ul className="sch-soff-list">
                  {plan.assignmentConflicts.map((row) => (
                    <li key={`${row.date}|${row.jobId}`}>{row.dateLabel}: {row.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {plan?.statusConflicts?.length > 0 ? (
              <div className="sch-soff-warn">
                <strong>Existing crew status will not be overwritten.</strong>
                <p>These days stay {plan.statusConflicts.map((r) => r.label).filter((v, i, a) => a.indexOf(v) === i).join(" / ")}:</p>
                <ul className="sch-soff-list">
                  {plan.statusConflicts.map((row) => (
                    <li key={row.date}>{row.dateLabel}: {row.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {plan?.canWrite ? (
              <p className="sch-soff-note">
                {[
                  plan.writeDays.length === 1
                    ? `Will mark 1 day as ${crewStatusUiLabel(CREW_STATUS_SCHEDULED_OFF)}.`
                    : plan.writeDays.length > 1
                      ? `Will mark ${plan.writeDays.length} days as ${crewStatusUiLabel(CREW_STATUS_SCHEDULED_OFF)}.`
                      : null,
                  plan.removeDays?.length === 1
                    ? "Will remove 1 Scheduled Off day that is no longer in this range."
                    : plan.removeDays?.length > 1
                      ? `Will remove ${plan.removeDays.length} Scheduled Off days that are no longer in this range.`
                      : null,
                ].filter(Boolean).join(" ")}
              </p>
            ) : (
              <p className="sch-soff-error">No days in this range can be marked Scheduled Off without overwriting another status.</p>
            )}
            {error ? <div className="sch-soff-error" role="alert">{error}</div> : null}
            <div className="sch-modal-actions sch-soff-actions">
              <button type="button" className="sch-btn" disabled={busy} onClick={onCancel}>Cancel</button>
              {plan?.canWrite ? (
                <button
                  type="button"
                  className="sch-btn"
                  style={{ background: "var(--command-green)", color: "var(--ink)", borderColor: "var(--command-green)" }}
                  disabled={busy}
                  onClick={onConfirm}
                >
                  {busy ? "Saving…" : "Confirm Scheduled Off"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}