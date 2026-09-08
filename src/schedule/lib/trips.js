// A saved trip owns its entire date span, even across weeks or gaps in staffing.
// Assignment links are authoritative. Date matching is only a read-time fallback
// for older, unlinked crew days, and only when exactly one saved trip fits.
export function buildJobTrips(rows = [], assignments = []) {
  const trips = rows.map(row => ({ ...row, key: row.id, assignments: [], legacy: false }))
  const byId = new Map(trips.map(trip => [trip.id, trip]))
  const unmatched = []
  for (const assignment of assignments) {
    let trip = byId.get(assignment.mobilization_id)
    if (!trip && !assignment.mobilization_id) {
      const matches = trips.filter(t => t.start_date && t.end_date &&
        t.start_date <= assignment.date && assignment.date <= t.end_date)
      if (matches.length === 1) trip = matches[0]
    }
    if (trip) trip.assignments.push(assignment)
    else unmatched.push(assignment)
  }

  // Preserve the existing history rule for days with no identifiable saved trip:
  // short gaps/weekends stay together; a gap of MORE than six days starts a run.
  const days = [...new Set(unmatched.map(a => a.date).filter(Boolean))].sort()
  let legacy = null, previous = null
  for (const day of days) {
    if (!previous || (Date.parse(day) - Date.parse(previous)) / 86400000 > 6) {
      legacy = { key: `legacy:${day}`, legacy: true, label: 'Crew history', start_date: day, end_date: day, assignments: [] }
      trips.push(legacy)
    }
    legacy.end_date = day
    legacy.assignments.push(...unmatched.filter(a => a.date === day))
    previous = day
  }
  return trips
}

export function tripPeriod(trip, today) {
  const { start_date: start, end_date: end } = trip
  if (start && end && end < start) return 'undated'
  if (start && start > today) return 'upcoming'
  if (end && end < today) return 'past'
  if (start && end) return 'current'
  return 'undated'
}

export function tripDate(iso) {
  if (!iso) return 'Date to set'
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function tripRange(trip) {
  if (!trip.start_date && !trip.end_date) return 'Dates to set'
  if (trip.start_date === trip.end_date) return tripDate(trip.start_date)
  return `${tripDate(trip.start_date)} – ${tripDate(trip.end_date)}`
}
