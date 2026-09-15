import { crewWeekRows, crewRowInRange } from "../../schedule/lib/crewScheduleRows.js";
import { getJobStatus } from "../../schedule/lib/jobStatus.js";
import { tripRange } from "../../schedule/lib/trips.js";

// Field Crews command-view helpers. Scheduled truth is Crew Scheduler:
// crewWeekRows(jobs, live job_mobilizations, assignments, date, date).
// Off is crew_status !== 'available' only — never inferred from an empty day.

export const CREW_OFF_LABELS = {
  sick: "Sick",
  off: "Off",
  noshow: "No Show",
};

export const CREW_STATUS_FILTERS = [
  { value: "Scheduled", label: "Scheduled" },
  { value: "In Progress", label: "In Progress" },
  { value: "On Hold", label: "On Hold" },
  { value: "Ongoing", label: "Ongoing" },
  { value: "no-crew", label: "No Crew" },
  { value: "sick", label: "Sick" },
  { value: "off", label: "Off" },
  { value: "noshow", label: "No Show" },
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

function locationOf(job) {
  return [job?.jobsite_city, job?.jobsite_state].filter(Boolean).join(", ");
}

function jobFields(job) {
  return {
    jobId: job?.job_id ?? null,
    jobNum: job?.job_num || "",
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

export function buildCrewCommandView({ date, jobs, allocations, assignments, crew, statuses }) {
  const roster = (crew || []).filter((c) => c?.name && !c.archived);
  const teamByName = new Map(roster.map((c) => [c.name, c.team || ""]));
  const board = crewWeekRows(jobs, allocations, assignments, date, date);

  const jobsWithAssignment = new Set();
  const assignedMap = new Map();

  for (const row of board) {
    const dayAsgn = (row.assignments || []).filter((a) => a.date === date && a.crew_name);
    for (const a of dayAsgn) {
      jobsWithAssignment.add(String(row.job.job_id));
      if (statusOf(a.crew_name, date, statuses) !== "available") continue;
      const key = `${a.crew_name}|${row.job.job_id}`;
      if (assignedMap.has(key)) continue;
      const jobStatus = getJobStatus(row.job);
      assignedMap.set(key, {
        id: `out:${key}`,
        kind: "out",
        category: "out",
        crewName: a.crew_name,
        crewDisplay: flipStoredCrewName(a.crew_name),
        crewSecondary: teamByName.get(a.crew_name) || "",
        ...jobFields(row.job),
        statusKey: jobStatus,
        statusLabel: jobStatus,
        mobilization: mobilizationLabel(row.trip),
        notes: (row.trip?.note || "").trim(),
        dot: "teal",
      });
    }
  }

  const unassignedMap = new Map();
  for (const row of board) {
    if (!crewRowInRange(row, date)) continue;
    if (row.unavailable) continue;
    const jid = String(row.job.job_id);
    if (jobsWithAssignment.has(jid) || unassignedMap.has(jid)) continue;
    const dayAsgn = (row.assignments || []).filter((a) => a.date === date);
    if (dayAsgn.length) continue;
    unassignedMap.set(jid, {
      id: `unassigned:${jid}`,
      kind: "unassigned",
      category: "unassigned",
      crewName: "",
      crewDisplay: "Unassigned",
      crewSecondary: "",
      ...jobFields(row.job),
      statusKey: "no-crew",
      statusLabel: "No Crew",
      mobilization: mobilizationLabel(row.trip),
      notes: (row.trip?.note || "").trim(),
      dot: "muted",
    });
  }

  const assignedRows = [...assignedMap.values()].sort(
    (a, b) => compareByFirstName(a.crewName, b.crewName) || String(a.jobNum).localeCompare(String(b.jobNum))
  );
  const unassignedRows = [...unassignedMap.values()].sort((a, b) =>
    String(a.jobNum).localeCompare(String(b.jobNum))
  );
  const offRows = roster
    .filter((person) => statusOf(person.name, date, statuses) !== "available")
    .map((person) => {
      const st = statusOf(person.name, date, statuses);
      return {
        id: `off:${person.name}`,
        kind: "off",
        category: "off",
        crewName: person.name,
        crewDisplay: flipStoredCrewName(person.name),
        crewSecondary: person.team || "",
        jobId: null,
        jobNum: "",
        jobName: "",
        workType: "",
        customer: "",
        location: "",
        statusKey: st,
        statusLabel: CREW_OFF_LABELS[st] || st,
        mobilization: "",
        notes: "",
        dot: "red",
      };
    })
    .sort((a, b) => compareByFirstName(a.crewName, b.crewName));

  const crewsOut = new Set(assignedRows.map((r) => r.crewName)).size;
  const jobsCovered = jobsWithAssignment.size;
  const jobsUnassigned = unassignedRows.length;

  return {
    date,
    rows: [...assignedRows, ...offRows, ...unassignedRows],
    counts: {
      crewsOut,
      crewsTotal: roster.length,
      jobsCovered,
      scheduledJobs: jobsCovered + jobsUnassigned,
      jobsUnassigned,
      crewsOff: offRows.length,
    },
    crews: roster.slice().sort((a, b) => compareByFirstName(a.name, b.name)),
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
    } else if (category && category !== "all" && r.category !== category) {
      return false;
    }
    if (crewName && r.crewName !== crewName) return false;
    if (status && r.statusKey !== status) return false;
    if (q) {
      const hay = `${r.jobNum} ${r.jobName} ${r.customer} ${r.location} ${r.crewDisplay}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
