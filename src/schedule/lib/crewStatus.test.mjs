import {
  CREW_STATUS_CALL_IN,
  CREW_STATUS_SCHEDULED_OFF,
  crewStatusShortLabel,
  crewStatusUiLabel,
  isCrewStatusOut,
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

console.log("crewStatus assertions passed");
