import {
  buildCrewCommandView,
  compareByFirstName,
  filterCrewCommandRows,
  flipStoredCrewName,
  jobNumberOnly,
  sortCrewCommandRows,
  summarizeCrewCommand,
  thisWeekBounds,
} from "./crewBoard.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(flipStoredCrewName("Berger, Chris") === "Chris Berger", "flip Last, First");
assert(compareByFirstName("Berger, Chris", "Adams, Pat") < 0, "first-name sort Chris before Pat");
assert(jobNumberOnly({ job_number: 10079, display_job_number: "10079 - Demo VCT - Carpet" }) === "10079", "job_number wins");
assert(jobNumberOnly({ display_job_number: "10079 - Demo VCT - Carpet" }) === "10079", "split display_job_number");
assert(jobNumberOnly({ job_num: "10079" }) === "10079", "plain job_num");

const date = "2026-09-15";
const jobs = [
  {
    job_id: 1,
    job_number: 10023,
    display_job_number: "10023 - City Hall Renovation",
    job_name: "City Hall Renovation",
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
    job_number: 10025,
    display_job_number: "10025 - Sunset Retail",
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
    job_number: 10099,
    job_name: "Complete Job",
    status: "Complete",
    scheduled_start: "2026-09-15",
    scheduled_end: "2026-09-15",
  },
];
const allocations = {
  1: { 1: { id: "trip-1", seq: 1, label: "Trip 1", start_date: "2026-09-14", end_date: "2026-09-20", note: "Left yard 6:30" } },
  2: { 1: { id: "trip-2", seq: 1, label: "Trip 1", start_date: "2026-09-15", end_date: "2026-09-18", note: "Needs crew" } },
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
const counts = summarizeCrewCommand(view.rows, { rosterSize: view.rosterSize });

assert(counts.crewsOut === 2, `crewsOut ${counts.crewsOut}`);
assert(counts.jobsCovered === 1, `jobsCovered ${counts.jobsCovered}`);
assert(counts.jobsUnassigned === 1, `jobsUnassigned ${counts.jobsUnassigned}`);
assert(counts.exceptions === 1, `exceptions ${counts.exceptions}`);
assert(view.rosterSize === 3, "archived excluded from roster total");
assert(view.rows[0].crewDisplay === "Amy Nguyen", `first assigned row should be Amy, got ${view.rows[0].crewDisplay}`);
assert(view.rows[1].crewDisplay === "Chris Berger", "second assigned is Chris");
assert(view.rows[0].jobNum === "10023", `JOB # is number only, got ${view.rows[0].jobNum}`);
assert(view.rows[0].jobName === "City Hall Renovation", "job name not stuffed into job #");
assert(view.rows.some((r) => r.kind === "exception" && r.statusLabel === "Called Out"), "sick is Called Out");
assert(view.rows.some((r) => r.kind === "unassigned" && r.jobNum === "10025" && !r.crewDisplay), "unassigned has no fake crew");
assert(!view.rows.some((r) => r.crewDisplay === "Unassigned"), "no Unassigned crew label");
assert(!view.rows.some((r) => r.jobNum === "10099"), "complete unstaffed job is not unassigned");
assert(!view.rows.some((r) => r.crewDisplay === "Pat Diaz" && r.kind === "out"), "exception is not counted as out");
assert(view.rows.find((r) => r.kind === "out" && r.crewName === "Berger, Chris").notes === "Left yard 6:30", "trip note");
assert(filterCrewCommandRows(view.rows, { category: "unassigned" }).every((r) => r.kind === "unassigned"), "unassigned filter");
assert(filterCrewCommandRows(view.rows, { category: "exceptions" }).length === 1, "exceptions filter");
assert(filterCrewCommandRows(view.rows, { crewName: "Berger, Chris" }).length === 1, "crew filter");
assert(filterCrewCommandRows(view.rows, { jobQuery: "sunset" }).length === 1, "job search");
assert(filterCrewCommandRows(view.rows, { status: "called-out" }).length === 1, "called-out status filter");
assert(filterCrewCommandRows(view.rows, { category: "out" }).every((r) => r.kind === "out"), "out filter");

const unassignedOnly = buildCrewCommandView({
  date,
  jobs,
  allocations,
  assignments: [],
  crew,
  statuses: {},
});
assert(summarizeCrewCommand(unassignedOnly.rows).exceptions === 0, "no assignment is not an exception");
assert(summarizeCrewCommand(unassignedOnly.rows).crewsOut === 0, "no assignment is not out");

const rangeAssignments = [
  { id: "r1", job_id: 1, crew_name: "Berger, Chris", date: "2026-09-14", mobilization_id: "trip-1" },
  { id: "r2", job_id: 1, crew_name: "Berger, Chris", date: "2026-09-15", mobilization_id: "trip-1" },
  { id: "r3", job_id: 2, crew_name: "Berger, Chris", date: "2026-09-16", mobilization_id: "trip-2" },
];
const rangeView = buildCrewCommandView({
  from: "2026-09-14",
  to: "2026-09-16",
  jobs,
  allocations,
  assignments: rangeAssignments,
  crew,
  statuses: { "Berger, Chris|2026-09-16": "noshow" },
});
const chrisDays = sortCrewCommandRows(
  filterCrewCommandRows(rangeView.rows, { crewName: "Berger, Chris", category: "out" }),
  { range: true, crewName: "Berger, Chris", category: "out" }
);
assert(chrisDays.length === 2, `chris out days ${chrisDays.length}`);
assert(chrisDays[0].date === "2026-09-14" && chrisDays[1].date === "2026-09-15", "range crew sort is chronological");
assert(summarizeCrewCommand(rangeView.rows).crewsOut === 1, "range crews out is distinct people, not assignment-days");
assert(summarizeCrewCommand(rangeView.rows).exceptions === 1, "noshow is an exception record");
assert(
  filterCrewCommandRows(rangeView.rows, { category: "exceptions" })[0].statusLabel === "No Show",
  "noshow label"
);
assert(
  filterCrewCommandRows(rangeView.rows, { jobQuery: "10023", category: "out" }).every((r) => r.jobNum === "10023"),
  "range + job filter"
);

const noshowExpected = filterCrewCommandRows(rangeView.rows, { category: "exceptions" })[0];
assert(noshowExpected.jobNum === "10025", `expected job on exception day, got ${noshowExpected.jobNum}`);

const week = thisWeekBounds("2026-09-15");
assert(week.from === "2026-09-14" && week.to === "2026-09-20", `this week Mon-Sun ${week.from}..${week.to}`);

// Called Out with a real assignment must keep Expected Job even when the
// assignment date is a timestamp (board `date <= end` would drop it).
const misaDay = "2026-09-15";
const misaView = buildCrewCommandView({
  date: misaDay,
  jobs,
  allocations,
  assignments: [
    { id: "misa-a", job_id: 1, crew_name: "Misa", date: "2026-09-15T00:00:00", mobilization_id: "trip-1" },
  ],
  crew: [...crew, { name: "Misa", team: "Floor", archived: false }],
  statuses: { [`Misa|${misaDay}`]: "sick" },
});
const misaEx = misaView.rows.find((r) => r.kind === "exception" && r.crewName === "Misa");
assert(misaEx, "Misa Called Out row exists");
assert(misaEx.jobNum === "10023", `Misa Sep 15 expected job from assignment, got ${misaEx.jobNum}`);
assert(misaEx.statusLabel === "Called Out", "Misa exception is Called Out");
assert(!misaView.rows.some((r) => r.kind === "out" && r.crewName === "Misa"), "Misa exception is not Crews Out");

// Adam Little Sep 7 — roster is Last, First; assignment still wins over Called Out.
const adamDay = "2026-09-07";
const adamJobs = [
  {
    job_id: 40,
    job_number: 10079,
    display_job_number: "10079 - Demo VCT - Carpet",
    job_name: "Demo VCT - Carpet",
    status: "In Progress",
    scheduled_start: "2026-09-07",
    scheduled_end: "2026-09-12",
  },
];
const adamView = buildCrewCommandView({
  date: adamDay,
  jobs: adamJobs,
  allocations: {
    40: { 1: { id: "trip-adam", seq: 1, label: "Trip 1", start_date: "2026-09-07", end_date: "2026-09-12" } },
  },
  assignments: [
    { id: "adam-a", job_id: 40, crew_name: "Little, Adam", date: adamDay, mobilization_id: "trip-adam" },
  ],
  crew: [{ name: "Little, Adam", team: "Floor", archived: false }],
  statuses: { [`Little, Adam|${adamDay}`]: "off" },
});
const adamEx = adamView.rows.find((r) => r.kind === "exception" && r.crewName === "Little, Adam");
assert(adamEx, "Adam Little Called Out row exists");
assert(adamEx.jobNum === "10079", `Adam Sep 7 expected job from assignment, got ${adamEx.jobNum}`);
assert(adamEx.crewDisplay === "Adam Little", "Adam display name flipped");

const adamFlipView = buildCrewCommandView({
  date: adamDay,
  jobs: adamJobs,
  allocations: {
    40: { 1: { id: "trip-adam", seq: 1, label: "Trip 1", start_date: "2026-09-07", end_date: "2026-09-12" } },
  },
  assignments: [
    { id: "adam-flip", job_id: 40, crew_name: "Adam Little", date: adamDay, mobilization_id: "trip-adam" },
  ],
  crew: [{ name: "Little, Adam", team: "Floor", archived: false }],
  statuses: { [`Little, Adam|${adamDay}`]: "sick" },
});
assert(
  adamFlipView.rows.find((r) => r.kind === "exception" && r.crewName === "Little, Adam")?.jobNum === "10079",
  "expected job matches Last, First roster to First Last assignment"
);

const noJobView = buildCrewCommandView({
  date: misaDay,
  jobs: [],
  allocations: {},
  assignments: [
    { id: "orphan-a", job_id: 99, crew_name: "Misa", date: misaDay, mobilization_id: null },
  ],
  crew: [{ name: "Misa", team: "Floor", archived: false }],
  statuses: { [`Misa|${misaDay}`]: "sick" },
});
assert(
  !noJobView.rows.find((r) => r.kind === "exception" && r.crewName === "Misa")?.jobNum,
  "assignment to an unknown job does not invent an expected job label"
);

// No assignment for the exception day → Expected Job stays blank. Do not invent.
const blankView = buildCrewCommandView({
  date: misaDay,
  jobs,
  allocations,
  assignments: [],
  crew: [{ name: "Misa", team: "Floor", archived: false }],
  statuses: { [`Misa|${misaDay}`]: "sick" },
});
const blankEx = blankView.rows.find((r) => r.kind === "exception" && r.crewName === "Misa");
assert(blankEx, "exception without assignment still listed");
assert(!blankEx.jobNum && !blankEx.jobName, "no assignment → blank expected job");

console.log("crewBoard assertions passed");
