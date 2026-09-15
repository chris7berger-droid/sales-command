import {
  CREW_STATUS_CALL_IN,
  CREW_STATUS_NO_SHOW,
  CREW_STATUS_SCHEDULED_OFF,
  compactStatusDot,
  crewStatusShortLabel,
  crewStatusUiLabel,
  eachInclusiveDay,
  formatScheduledOffRange,
  groupContiguousDays,
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
assert((planned.removeDays || []).length === 0, "create plan has no removals");

assert(compactStatusDot("scheduled-off") === "soff", "scheduled-off uses gray soff dot");
assert(compactStatusDot("off") !== "soff", "legacy off is not Scheduled Off");
assert(compactStatusDot("sick") === "sick", "sick keeps its own dot");

const octWeek = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
const octStatus = Object.fromEntries(days.days.map((d) => [d, "scheduled-off"]));
assert(octWeek.map((d) => compactStatusDot(octStatus[d] || "")).join(",") === "soff,soff,soff,soff,soff,", "Oct 12–16 gray Mon–Fri; Sat 17 unaffected");

const grouped = groupContiguousDays([...days.days, "2026-10-19"]);
assert(grouped.length === 2, "gap splits ranges");
assert(grouped[0].from === "2026-10-12" && grouped[0].to === "2026-10-16", "Oct 12–16 is one contiguous range");
assert(formatScheduledOffRange("2026-10-12", "2026-10-16") === "Oct 12 – Oct 16, 2026", `range label ${formatScheduledOffRange("2026-10-12", "2026-10-16")}`);
assert(formatScheduledOffRange("2026-10-12", "2026-10-12") === "Oct 12, 2026", "single-day range label");

const existingForEdit = {
  "2026-10-12": "scheduled-off",
  "2026-10-13": "scheduled-off",
  "2026-10-14": "scheduled-off",
  "2026-10-15": "scheduled-off",
  "2026-10-16": "scheduled-off",
};
const shrunk = planScheduledOff({
  days: ["2026-10-12", "2026-10-13", "2026-10-14"],
  originalDays: days.days,
  existingStatusByDate: existingForEdit,
});
assert(shrunk.writeDays.length === 0, "shrink does not rewrite remaining days");
assert(shrunk.removeDays.join(",") === "2026-10-15,2026-10-16", "shrink removes only days that left the range");
assert(shrunk.canWrite && !shrunk.needsConfirm, "shrink with no new conflicts saves without extra confirm");

const expandIntoSick = planScheduledOff({
  days: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"],
  originalDays: ["2026-10-12", "2026-10-13", "2026-10-14"],
  existingStatusByDate: {
    "2026-10-12": "scheduled-off",
    "2026-10-13": "scheduled-off",
    "2026-10-14": "scheduled-off",
    "2026-10-15": "sick",
  },
});
assert(!expandIntoSick.writeDays.includes("2026-10-15"), "edit does not overwrite sick");
assert(expandIntoSick.statusConflicts[0].status === "sick", "expanding into sick surfaces a conflict");
assert(expandIntoSick.removeDays.length === 0, "failed expand does not remove the original range");

const editAssign = planScheduledOff({
  days: days.days,
  originalDays: ["2026-10-12"],
  existingStatusByDate: { "2026-10-12": "scheduled-off" },
  assignments: [{ job_id: 40, date: "2026-10-16" }],
  jobsById,
});
assert(editAssign.needsConfirm && editAssign.assignmentConflicts[0].date === "2026-10-16", "edit still warns on assignments in the new range");

const otherRangeSafe = planScheduledOff({
  days: ["2026-10-12", "2026-10-13", "2026-10-14"],
  originalDays: days.days,
  existingStatusByDate: {
    ...existingForEdit,
    "2026-10-19": "scheduled-off",
  },
});
assert(!otherRangeSafe.removeDays.includes("2026-10-19"), "edit does not remove a separate Scheduled Off range");

const leaveOffAlone = planScheduledOff({
  days: ["2026-10-12"],
  originalDays: ["2026-10-12", "2026-10-13"],
  existingStatusByDate: { "2026-10-12": "scheduled-off", "2026-10-13": "off" },
});
assert(!leaveOffAlone.removeDays.includes("2026-10-13"), "edit does not delete a legacy off row");

console.log("crewStatus assertions passed");
