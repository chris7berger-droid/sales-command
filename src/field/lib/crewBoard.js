import { crewWeekRows, crewRowInRange } from "../../schedule/lib/crewScheduleRows.js";
import { getJobStatus } from "../../schedule/lib/jobStatus.js";
import { tripRange } from "../../schedule/lib/trips.js";

// Field Crews command-view helpers. Scheduled truth is Crew Scheduler:
// crewWeekRows(jobs, live job_mobilizations, assignments, from, to).
// Exceptions come only from crew_status !== 'available' — never inferred
// from a missing assignment or a missing punch.

export const EXCEPTION_LABELS = {
  sick: "Called Out",
  off: "Called Out",
  noshow: "No Show",
};

export const CREW_STATUS_FILTERS = [
  { value: "Scheduled", label: "Scheduled" },
  { value: "In Progress", label: "In Progress" },
  { value: "On Hold", label: "On Hold" },
  { value: "Ongoing", label: "Ongoing" },
  { value: "no-crew", label: "No Crew" },
  { value: "called-out", label: "Called Out" },
  { value: "no-show", label: "No Show" },
];

export function flipStoredCrewName(n) {
  if (!n) return "";
  const p = String(n).split(",");
  return p.length === 2 ? `${p[1].trim()} ${p[0].trim()}` : String(n);
}

export function crewFirstNameKey(stored) {
  const display = flipStoredCrewName(stored);
  return (display.trim().split(/\s+/)[0] || display).toLowerCase();
}

export function compareByFirstName(aName, bName) {
  const fa = crewFirstNameKey(aName);
  const fb = crewFirstNameKey(bName);
  if (fa !== fb) return fa.localeCompare(fb);
  return flipStoredCrewName(aName).localeCompare(flipStoredCrewName(bName));
}

export function isoDay(d) {
  const dt = d instanceof Date ? d : new Date(String(d) + (String(d).includes("T") ? "" : "T00:00:00"));
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dayStr, n) {
  const d = new Date(`${dayStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export function mondayOf(dayStr) {
  const d = new Date(`${dayStr}T00:00:00`);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return isoDay(d);
}

export function thisWeekBounds(today) {
  const from = mondayOf(today);
  return { from, to: addDays(from, 6) };
}

export function lastWeekBounds(today) {
  const from = addDays(mondayOf(today), -7);
  return { from, to: addDays(from, 6) };
}

export function monthBounds(dayStr) {
  const d = new Date(`${dayStr}T00:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth();
  const from = isoDay(new Date(y, m, 1));
  const to = isoDay(new Date(y, m + 1, 0));
  return { from, to };
}

export function eachDay(from, to) {
  const out = [];
  if (!from || !to || from > to) return out;
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function shortDate(iso, { withYear = false } = {}) {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

// display_job_number is a composite ("10079 - Demo VCT - Carpet"). JOB # is the
// bare number only — same split Call Log uses on the job-number cell.
export function jobNumberOnly(job) {
  const n = job?.job_number;
  if (n != null && String(n).trim() !== "") return String(n).replace(/^#/, "").trim();
  const raw = String(job?.display_job_number || job?.job_num || "");
  const idx = raw.indexOf(" - ");
  const num = (idx > -1 ? raw.slice(0, idx) : raw).replace(/^#/, "").trim();
  return num;
}

function locationOf(job) {
  return [job?.jobsite_city, job?.jobsite_state].filter(Boolean).join(", ");
}

function jobFields(job) {
  return {
    jobId: job?.job_id ?? null,
    jobNum: jobNumberOnly(job),
    jobName: job?.job_name || "",
    workType: job?.work_type || "",
    customer: job?.customer_name || "",
    location: locationOf(job),
  };
}

function mobilizationLabel(trip) {
  if (!trip) return "";
  const generic =
    !trip.label || trip.parent || trip.label === "Job schedule" || trip.label === "Crew history";
  if (!generic) return trip.label;
  if (trip.start_date || trip.end_date) return tripRange(trip);
  return "";
}

function statusOf(name, date, statuses) {
  return statuses?.[`${name}|${date}`] || "available";
}

function exceptionStatusKey(raw) {
  if (raw === "noshow") return "no-show";
  if (raw === "sick" || raw === "off") return "called-out";
  return raw;
}

function makeRow({ id, kind, date, crewName, crewSecondary, job, trip, statusKey, statusLabel, dot, extra = {} }) {
  const fields = job ? jobFields(job) : {
    jobId: null, jobNum: "", jobName: "", workType: "", customer: "", location: "",
  };
  return {
    id,
    kind,
    category: kind === "exception" ? "exceptions" : kind,
    date,
    dateLabel: shortDate(date),
    crewName: crewName || "",
    crewDisplay: crewName ? flipStoredCrewName(crewName) : "",
    crewSecondary: crewSecondary || "",
    ...fields,
    statusKey,
    statusLabel,
    mobilization: mobilizationLabel(trip),
    notes: (trip?.note || "").trim(),
    dot,
    ...extra,
  };
}

export function buildCrewCommandView({ date, from, to, jobs, allocations, assignments, crew, statuses }) {
  const start = from || date;
  const end = to || date || from;
  const dates = eachDay(start, end);
  const roster = (crew || []).filter((c) => c?.name && !c.archived);
  const teamByName = new Map(roster.map((c) => [c.name, c.team || ""]));
  const board = crewWeekRows(jobs, allocations, assignments, start, end);

  const assignedMap = new Map();
  const expectedJob = new Map();
  const assignedJobDays = new Set();

  for (const row of board) {
    for (const a of row.assignments || []) {
      if (!a.crew_name || !a.date || a.date < start || a.date > end) continue;
      expectedJob.set(`${a.crew_name}|${a.date}`, row.job);
      assignedJobDays.add(`${row.job.job_id}|${a.date}`);
      if (statusOf(a.crew_name, a.date, statuses) !== "available") continue;
      const key = `${a.crew_name}|${row.job.job_id}|${a.date}`;
      if (assignedMap.has(key)) continue;
      const jobStatus = getJobStatus(row.job);
      assignedMap.set(key, makeRow({
        id: `out:${key}`,
        kind: "out",
        date: a.date,
        crewName: a.crew_name,
        crewSecondary: teamByName.get(a.crew_name) || "",
        job: row.job,
        trip: row.trip,
        statusKey: jobStatus,
        statusLabel: jobStatus,
        dot: "teal",
      }));
    }
  }

  const unassignedMap = new Map();
  for (const day of dates) {
    for (const row of board) {
      if (!crewRowInRange(row, day) || row.unavailable) continue;
      const jid = String(row.job.job_id);
      if (assignedJobDays.has(`${row.job.job_id}|${day}`) || assignedJobDays.has(`${jid}|${day}`)) continue;
      const key = `${jid}|${day}`;
      if (unassignedMap.has(key)) continue;
      unassignedMap.set(key, makeRow({
        id: `unassigned:${key}`,
        kind: "unassigned",
        date: day,
        crewName: "",
        job: row.job,
        trip: row.trip,
        statusKey: "no-crew",
        statusLabel: "No Crew",
        dot: "muted",
      }));
    }
  }

  const exceptionRows = [];
  for (const day of dates) {
    for (const person of roster) {
      const raw = statusOf(person.name, day, statuses);
      if (raw === "available") continue;
      const job = expectedJob.get(`${person.name}|${day}`) || null;
      exceptionRows.push(makeRow({
        id: `exception:${person.name}|${day}`,
        kind: "exception",
        date: day,
        crewName: person.name,
        crewSecondary: person.team || "",
        job,
        trip: null,
        statusKey: exceptionStatusKey(raw),
        statusLabel: EXCEPTION_LABELS[raw] || raw,
        dot: "red",
        extra: { rawStatus: raw },
      }));
    }
  }

  const assignedRows = [...assignedMap.values()];
  const unassignedRows = [...unassignedMap.values()];
  const range = start !== end;

  return {
    from: start,
    to: end,
    range,
    rows: sortCrewCommandRows([...assignedRows, ...exceptionRows, ...unassignedRows], {
      range,
      crewName: "",
      category: "all",
    }),
    crews: roster.slice().sort((a, b) => compareByFirstName(a.name, b.name)),
    rosterSize: roster.length,
  };
}

export function filterCrewCommandRows(
  rows,
  { category = "all", crewName = "", jobQuery = "", status = "" } = {}
) {
  const q = String(jobQuery || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (category === "out" || category === "covered") {
      if (r.kind !== "out") return false;
    } else if (category === "exceptions") {
      if (r.kind !== "exception") return false;
    } else if (category === "unassigned") {
      if (r.kind !== "unassigned") return false;
    } else if (category && category !== "all" && r.category !== category) {
      return false;
    }
    if (crewName && r.crewName !== crewName) return false;
    if (status) {
      if (r.statusKey !== status) return false;
    }
    if (q) {
      const hay = `${r.jobNum} ${r.jobName} ${r.customer} ${r.location} ${r.crewDisplay}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function summarizeCrewCommand(rows, { rosterSize = 0 } = {}) {
  const peopleOut = new Set();
  const jobsCovered = new Set();
  const jobsUnassigned = new Set();
  const scheduled = new Set();
  let exceptions = 0;
  for (const r of rows || []) {
    if (r.kind === "out") {
      if (r.crewName) peopleOut.add(r.crewName);
      if (r.jobId != null) {
        jobsCovered.add(String(r.jobId));
        scheduled.add(String(r.jobId));
      }
    } else if (r.kind === "unassigned") {
      if (r.jobId != null) {
        jobsUnassigned.add(String(r.jobId));
        scheduled.add(String(r.jobId));
      }
    } else if (r.kind === "exception") {
      exceptions += 1;
    }
  }
  return {
    crewsOut: peopleOut.size,
    crewsTotal: rosterSize,
    jobsCovered: jobsCovered.size,
    scheduledJobs: scheduled.size,
    jobsUnassigned: jobsUnassigned.size,
    exceptions,
  };
}

export function sortCrewCommandRows(rows, { range = false, crewName = "", category = "all" } = {}) {
  const list = [...(rows || [])];
  const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || ""));
  const byJob = (a, b) => String(a.jobNum || "").localeCompare(String(b.jobNum || ""));
  const byName = (a, b) => compareByFirstName(a.crewName || "", b.crewName || "");
  const chrono = range && !!crewName;

  if (category === "unassigned") {
    list.sort((a, b) => byDate(a, b) || byJob(a, b));
    return list;
  }
  if (category === "exceptions") {
    list.sort((a, b) => (chrono ? byDate(a, b) || byName(a, b) : byName(a, b) || byDate(a, b)));
    return list;
  }
  if (chrono) {
    list.sort((a, b) => byDate(a, b) || byJob(a, b) || byName(a, b));
    return list;
  }
  if (range) {
    list.sort((a, b) => byDate(a, b) || byName(a, b) || byJob(a, b));
    return list;
  }

  const rank = { out: 0, exception: 1, unassigned: 2 };
  list.sort((a, b) => {
    const ra = rank[a.kind] ?? 9;
    const rb = rank[b.kind] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.kind === "unassigned") return byJob(a, b);
    return byName(a, b) || byJob(a, b);
  });
  return list;
}
