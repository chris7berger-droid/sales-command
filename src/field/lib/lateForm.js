// Late-form rule — PORTED from field-command/src/components/PunchStatusBar.js so
// the office desk and the crew phone flag the SAME "!". Do NOT re-derive the
// thresholds here ([[feedback_extend_canonical_not_twin]]).
//
// The phone computes this for ONE crew member's own punches; this version rolls
// it up PER JOB (earliest clock-in across the crew, any clock-out) for the
// office Today list.
//
// Phone rule (verbatim):
//   - 15 min after clock in, no SOD  → amber "SOD LOG NEEDED"
//   - 4 hrs on site,        no MOD   → amber "MID DAY LOG DUE"
//   - after clock out,      no EOD   → red   "EOD LOG REQUIRED"
//   - after clock out,      no PRT   → red   "PRT NOT SUBMITTED"

export const DEFAULT_THRESHOLDS = {
  sodDueMinutes: 15, // phone's current hardcode
  modDueHours: 4, // phone's current hardcode
  eodRequired: true,
  prtRequired: true,
};

// Each form returns { status, level? }:
//   'done'    — filed
//   'due'     — overdue, show "!" (level 'amber' for SOD/MOD, 'red' for EOD/PRT)
//   'pending' — a crew is on the job but it isn't due yet (no flag)
//   'off'     — not required for this tenant
export function jobFormStatus({
  punches = [],
  logTypes = new Set(),
  prtDone = false,
  now = new Date(),
  thresholds = DEFAULT_THRESHOLDS,
}) {
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };

  const clockInMs = punches
    .filter((p) => p.punch_type === "clock_in")
    .map((p) => new Date(p.punch_time).getTime())
    .filter((n) => !Number.isNaN(n));
  const firstClockIn = clockInMs.length ? Math.min(...clockInMs) : null;
  const clockedOut = punches.some((p) => p.punch_type === "clock_out");
  const msSince = firstClockIn != null ? now.getTime() - firstClockIn : null;

  return {
    sod: deriveTimed(logTypes.has("SOD"), msSince, t.sodDueMinutes * 60 * 1000, "amber"),
    mod: deriveTimed(logTypes.has("MOD"), msSince, t.modDueHours * 60 * 60 * 1000, "amber"),
    eod: deriveOnClockOut(logTypes.has("EOD"), clockedOut, t.eodRequired, "red"),
    prt: deriveOnClockOut(prtDone, clockedOut, t.prtRequired, "red"),
    clockedIn: firstClockIn != null,
    clockedOut,
  };
}

function deriveTimed(done, msSince, thresholdMs, level) {
  if (done) return { status: "done" };
  if (msSince != null && msSince > thresholdMs) return { status: "due", level };
  return { status: "pending" };
}

function deriveOnClockOut(done, clockedOut, required, level) {
  if (!required) return { status: "off" };
  if (done) return { status: "done" };
  if (clockedOut) return { status: "due", level };
  return { status: "pending" };
}
