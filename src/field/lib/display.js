export function stageTone(stage) {
  const s = String(stage || "").toLowerCase();
  if (s === "in progress" || s === "in_progress" || s === "mobilized") return "teal";
  if (s === "scheduled") return "amber";
  if (s === "on hold" || s === "hold") return "red";
  return "muted";
}
export function prettyStage(stage) {
  if (!stage) return "—";
  const s = String(stage);
  if (s === "in_progress") return "In Progress";
  if (s === "mobilized") return "Mobilized";
  return s;
}
export function logTypeLabel(type) {
  const t = String(type || "").toUpperCase();
  if (t === "SOD") return "Start";
  if (t === "MOD") return "Mid";
  if (t === "EOD") return "End";
  return type || "—";
}
export function logTypeTone(type) {
  const t = String(type || "").toUpperCase();
  if (t === "SOD") return "teal";
  if (t === "MOD") return "amber";
  if (t === "EOD") return "red";
  return "muted";
}
