import {
  CREW_STATUS_CALL_IN,
  CREW_STATUS_NO_SHOW,
  CREW_STATUS_SCHEDULED_OFF,
  crewStatusShortLabel,
  crewStatusUiLabel,
  eachInclusiveDay,
  isCrewStatusOut,
  nextWeekMonSat,
  planScheduledOff,
  thisWeekMonSat,
} from "./crewStatus.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(CREW_STATUS_CALL_IN === "off", "Call In keeps stored value off");
assert(CREW_STATUS_SCHEDULED_OFF === "scheduled-off", "Scheduled Off is a distinct stored value");
assert(crewStatusUiLabel("off") === "Call In", "off displays as Call In");
assert(crewStatusUiLabel("scheduled-off") === "Scheduled Off", "scheduled-off displays as Scheduled Off");
assert(crewStatusUiLabel("sick") === "Sick", "sick label");
assert(crewStatusShortLabel("off") === "CALL", "off short CALL");
assert(crewStatusShortLabel("scheduled-off") === "OFF", "scheduled-off short OFF");
assert(isCrewStatusOut("scheduled-off"), "scheduled-off is out");
assert(!isCrewStatusOut("available"), "available is not out");
assert(!isCrewStatusOut(""), "empty is not out");

const days = eachInclusiveDay("2026-10-12", "2026-10-16");
assert(!days.error && days.days.join(",") === "2026-10-12,2026-10-13,2026-10-14,2026-10-15,2026-10-16", "inclusive Oct 12–16");
assert(eachInclusiveDay("2026-10-16", "2026-10-12").error, "TO before FROM is invalid");
assert(eachInclusiveDay("", "2026-10-12").error, "missing FROM is invalid");
assert(eachInclusiveDay("2026-09-30", "2026-10-01").days.join(",") === "2026-09-30,2026-10-01", "range may cross months");

const week = thisWeekMonSat("2026-09-15");
assert(week.from === "2026-09-14" && week.to === "2026-09-19", `this week Mon-Sat ${week.from}..${week.to}`);
const next = nextWeekMonSat("2026-09-15");
assert(next.from === "2026-09-21" && next.to === "2026-09-26", "next week is the following Mon-Sat");
assert(thisWeekMonSat("2026-09-15").from !== "2026-10-12", "this-week preset is not the displayed-week example");

const sundayRange = eachInclusiveDay("2026-10-11", "2026-10-12");
assert(sundayRange.days[0] === "2026-10-11", "custom range may include Sunday");

const jobsById = new Map([["40", { job_id: 40, job_num: "10079 - Demo", job_name: "Demo VCT" }]]);
const planned = planScheduledOff({
  days: days.days,
  existingStatusByDate: {
    "2026-10-13": "sick",
    "2026-10-14": "scheduled-off",
  },
  assignments: [
    { job_id: 40, date: "2026-10-12" },
    { job_id: 40, date: "2026-10-12T00:00:00" },
  ],
  jobsById,
});
assert(planned.writeDays.join(",") === "2026-10-12,2026-10-15,2026-10-16", `write days ${planned.writeDays}`);
assert(planned.alreadyOff.join(",") === "2026-10-14", "existing scheduled-off is left as-is");
assert(planned.statusConflicts.length === 1 && planned.statusConflicts[0].status === "sick", "sick is not overwritten");
assert(planned.assignmentConflicts.length === 1 && planned.assignmentConflicts[0].date === "2026-10-12", "assignments warn once per job/day");
assert(planned.assignmentConflicts[0].label.includes("10079"), "assignment warning includes job number");
assert(planned.needsConfirm, "assignments or status conflicts require confirm");
assert(planned.canWrite, "remaining free days can still be written");

const blocked = planScheduledOff({
  days: ["2026-10-13"],
  existingStatusByDate: { "2026-10-13": "off" },
});
assert(!blocked.canWrite && blocked.statusConflicts[0].label === "Call In", "Call In blocks silent overwrite");

const noshowBlocked = planScheduledOff({
  days: ["2026-10-13"],
  existingStatusByDate: { "2026-10-13": CREW_STATUS_NO_SHOW },
});
assert(!noshowBlocked.canWrite && noshowBlocked.statusConflicts[0].status === "noshow", "No Show is not overwritten");

const noAssign = planScheduledOff({ days: ["2026-11-01"], existingStatusByDate: {}, assignments: [] });
assert(noAssign.canWrite && !noAssign.needsConfirm && noAssign.writeDays[0] === "2026-11-01", "no assignment saves without extra confirm");

const assignOnly = planScheduledOff({
  days: ["2026-10-12", "2026-10-13"],
  existingStatusByDate: {},
  assignments: [{ job_id: 40, date: "2026-10-13" }],
  jobsById,
});
assert(assignOnly.writeDays.join(",") === "2026-10-12,2026-10-13", "assignment conflict still writes scheduled-off");
assert(assignOnly.needsConfirm && assignOnly.assignmentConflicts[0].label.includes("Demo VCT"), "assignment warning includes job name");
assert(assignOnly.statusConflicts.length === 0, "assignments are not treated as status overwrites");

console.log("crewStatus assertions passed");
