// Crew Scheduler person-day availability. Stored on crew_status.status.
// Available is not stored — the row is deleted. Do not infer a type from a
// missing assignment or a missing punch.

export const CREW_STATUS_SICK = "sick";
export const CREW_STATUS_CALL_IN = "off";
export const CREW_STATUS_NO_SHOW = "noshow";
export const CREW_STATUS_SCHEDULED_OFF = "scheduled-off";

export const CREW_STATUS_UI_LABELS = {
  sick: "Sick",
  off: "Call In",
  noshow: "No Show",
  "scheduled-off": "Scheduled Off",
};

export const CREW_STATUS_SHORT_LABELS = {
  sick: "SICK",
  off: "CALL",
  noshow: "N/S",
  "scheduled-off": "OFF",
};

export function crewStatusUiLabel(status) {
  if (!status || status === "available") return "Available";
  return CREW_STATUS_UI_LABELS[status] || status;
}

export function crewStatusShortLabel(status) {
  if (!status || status === "available") return "\u2713";
  return CREW_STATUS_SHORT_LABELS[status] || status;
}

export function isCrewStatusOut(status) {
  return !!(status && status !== "available");
}

export function crewStatusDateKey(value) {
  if (value == null || value === "") return "";
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function ymd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function addDaysIso(dayStr, n) {
  const day = crewStatusDateKey(dayStr);
  if (!day) return "";
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function mondayOfIso(dayStr) {
  const day = crewStatusDateKey(dayStr);
  if (!day) return "";
  const d = new Date(`${day}T00:00:00`);
  const wd = d.getDay();
  d.setDate(d.getDate() + (wd === 0 ? -6 : 1 - wd));
  return ymd(d);
}

export function thisWeekMonSat(today) {
  const from = mondayOfIso(today);
  return { from, to: addDaysIso(from, 5) };
}

export function nextWeekMonSat(today) {
  const from = addDaysIso(mondayOfIso(today), 7);
  return { from, to: addDaysIso(from, 5) };
}

export function eachInclusiveDay(from, to) {
  const start = crewStatusDateKey(from);
  const end = crewStatusDateKey(to);
  if (!start || !end) return { error: "Choose a valid FROM and TO date." };
  if (end < start) return { error: "TO cannot be before FROM." };
  const days = [];
  let cur = start;
  while (cur <= end) {
    days.push(cur);
    cur = addDaysIso(cur, 1);
    if (days.length > 366) return { error: "Choose a range of 366 days or fewer." };
  }
  return { days };
}

function jobConflictLabel(job, jobId) {
  if (!job) return jobId == null ? "Unknown job" : `Job ${jobId}`;
  const num = String(job.job_num || "").split(/\s+[—–-]\s+/)[0].replace(/^⚠\s*/, "").trim();
  const name = String(job.job_name || "").trim();
  if (num && name) return `${num} — ${name}`;
  return num || name || `Job ${jobId}`;
}

function shortDateLabel(iso) {
  const day = crewStatusDateKey(iso);
  if (!day) return "";
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Plan writes for a Scheduled Off range. Does not mutate assignments.
// Dates already scheduled-off are left as-is. Sick / Call In / No Show are
// never overwritten.
export function planScheduledOff({ days, existingStatusByDate = {}, assignments = [], jobsById = new Map() }) {
  const writeDays = [];
  const alreadyOff = [];
  const statusConflicts = [];
  for (const day of days || []) {
    const st = existingStatusByDate[day];
    if (!st || st === "available") writeDays.push(day);
    else if (st === CREW_STATUS_SCHEDULED_OFF) alreadyOff.push(day);
    else {
      statusConflicts.push({
        date: day,
        dateLabel: shortDateLabel(day),
        status: st,
        label: crewStatusUiLabel(st),
      });
    }
  }

  const assignmentConflicts = [];
  const seen = new Set();
  for (const a of assignments) {
    const day = crewStatusDateKey(a.date);
    if (!day || !(days || []).includes(day)) continue;
    const key = `${day}|${a.job_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const job = jobsById.get(String(a.job_id));
    assignmentConflicts.push({
      date: day,
      dateLabel: shortDateLabel(day),
      jobId: a.job_id,
      label: jobConflictLabel(job, a.job_id),
    });
  }
  assignmentConflicts.sort((a, b) => a.date.localeCompare(b.date) || String(a.label).localeCompare(String(b.label)));

  return {
    writeDays,
    alreadyOff,
    statusConflicts,
    assignmentConflicts,
    canWrite: writeDays.length > 0,
    needsConfirm: writeDays.length > 0 && (statusConflicts.length > 0 || assignmentConflicts.length > 0),
  };
}
