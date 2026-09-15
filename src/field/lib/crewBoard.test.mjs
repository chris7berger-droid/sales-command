import { buildCrewCommandView, compareByFirstName, filterCrewCommandRows, flipStoredCrewName } from "./crewBoard.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(flipStoredCrewName("Berger, Chris") === "Chris Berger", "flip Last, First");
assert(flipStoredCrewName("Chris Berger") === "Chris Berger", "flip already First Last");
assert(compareByFirstName("Berger, Chris", "Adams, Pat") < 0, "first-name sort Chris before Pat");
assert(compareByFirstName("Berger, Chris", "Berger, Amy") > 0, "Amy before Chris when last names match");

const date = "2026-09-15";
const jobs = [
  {
    job_id: 1,
    job_num: "10023",
    job_name: "City Hall",
    status: "In Progress",
    work_type: "Exterior Concrete",
    customer_name: "Riverside City",
    jobsite_city: "Riverside",
    jobsite_state: "CA",
    scheduled_start: "2026-09-14",
    scheduled_end: "2026-09-20",
  },
  {
    job_id: 2,
    job_num: "10025",
    job_name: "Sunset Retail",
    status: "Scheduled",
    work_type: "Site Prep",
    customer_name: "Sunset Properties",
    jobsite_city: "Mesa",
    jobsite_state: "AZ",
    scheduled_start: "2026-09-15",
    scheduled_end: "2026-09-18",
  },
  {
    job_id: 3,
    job_num: "10099",
    job_name: "Complete Job",
    status: "Complete",
    scheduled_start: "2026-09-15",
    scheduled_end: "2026-09-15",
  },
];
const allocations = {
  1: { 1: { id: "trip-1", seq: 1, label: "Trip 1", start_date: "2026-09-14", end_date: "2026-09-20", note: "Left yard 6:30" } },
  2: { 1: { id: "trip-2", seq: 1, label: "Trip 1", start_date: "2026-09-15", end_date: "2026-09-18", note: "" } },
  3: { 1: { id: "trip-3", seq: 1, label: "Trip 1", start_date: "2026-09-15", end_date: "2026-09-15", note: "" } },
};
const assignments = [
  { id: "a1", job_id: 1, crew_name: "Berger, Chris", date, mobilization_id: "trip-1" },
  { id: "a2", job_id: 1, crew_name: "Nguyen, Amy", date, mobilization_id: "trip-1" },
];
const crew = [
  { name: "Berger, Chris", team: "Floor", archived: false },
  { name: "Nguyen, Amy", team: "Floor", archived: false },
  { name: "Diaz, Pat", team: "Floater", archived: false },
  { name: "Old, Person", team: "Floor", archived: true },
];
const statuses = { [`Diaz, Pat|${date}`]: "sick" };

const view = buildCrewCommandView({ date, jobs, allocations, assignments, crew, statuses });

assert(view.counts.crewsOut === 2, `crewsOut ${view.counts.crewsOut}`);
assert(view.counts.jobsCovered === 1, `jobsCovered ${view.counts.jobsCovered}`);
assert(view.counts.jobsUnassigned === 1, `jobsUnassigned ${view.counts.jobsUnassigned}`);
assert(view.counts.crewsOff === 1, `crewsOff ${view.counts.crewsOff}`);
assert(view.counts.crewsTotal === 3, "archived excluded from roster total");
assert(view.rows[0].crewDisplay === "Amy Nguyen", `first assigned row should be Amy, got ${view.rows[0].crewDisplay}`);
assert(view.rows[1].crewDisplay === "Chris Berger", "second assigned is Chris");
assert(view.rows.some((r) => r.kind === "off" && r.statusLabel === "Sick"), "Pat is Sick, not unassigned");
assert(view.rows.some((r) => r.kind === "unassigned" && r.jobNum === "10025"), "Sunset is unassigned");
assert(!view.rows.some((r) => r.jobNum === "10099"), "complete unstaffed job is not unassigned");
assert(!view.rows.some((r) => r.crewDisplay === "Pat Diaz" && r.kind === "out"), "off is not counted as out");
assert(view.rows.find((r) => r.kind === "out" && r.crewName === "Berger, Chris").notes === "Left yard 6:30", "trip note");
assert(
  filterCrewCommandRows(view.rows, { category: "unassigned" }).every((r) => r.kind === "unassigned"),
  "unassigned filter"
);
assert(filterCrewCommandRows(view.rows, { crewName: "Berger, Chris" }).length === 1, "crew filter");
assert(filterCrewCommandRows(view.rows, { jobQuery: "sunset" }).length === 1, "job search");
assert(filterCrewCommandRows(view.rows, { status: "sick" }).length === 1, "status filter");
assert(
  filterCrewCommandRows(view.rows, { category: "out" }).every((r) => r.kind === "out"),
  "out filter"
);

const unassignedOnly = {
  ...buildCrewCommandView({
    date,
    jobs,
    allocations,
    assignments: [],
    crew,
    statuses: {},
  }),
};
assert(unassignedOnly.counts.crewsOff === 0, "no assignment is not off");
assert(unassignedOnly.counts.crewsOut === 0, "no assignment is not out");

console.log("crewBoard assertions passed");
