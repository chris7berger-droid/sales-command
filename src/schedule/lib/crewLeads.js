// Scheduling's roster owns lead choices. Keep the stored crew name unchanged;
// callers may format it for display, but jobs/mobilizations store the raw name.
export function crewLeadNames(crew) {
  return [...new Set(crew
    .filter(member => !member.archived && member.name?.trim())
    .map(member => member.name))]
    .sort((a, b) => a.localeCompare(b))
}
