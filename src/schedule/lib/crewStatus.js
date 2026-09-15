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
