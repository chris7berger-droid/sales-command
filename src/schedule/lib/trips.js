// A saved trip owns its entire date span, even across weeks or gaps in staffing.
// Only a saved assignment link establishes trip ownership. Unlinked crew stays
// visible separately; editing dates must never move crew between trips.
import { jobOwnRange } from './allocations.js'

// User-facing numbering counts all trips, oldest first, including named trips.
// Stored seq remains the field-SOW key and is never rewritten for presentation.
export function tripDisplayNumbers(rows = []) {
  return new Map([...rows].sort((a, b) => String(a.start_date || a.end_date || '9999-12-31').localeCompare(String(b.start_date || b.end_date || '9999-12-31')) || (a.seq || 0) - (b.seq || 0) || String(a.id).localeCompare(String(b.id)))
    .map((row, index) => [row.id, index + 1]))
}

export function buildJobTrips(rows = [], assignments = [], job = null) {
  const numbers = tripDisplayNumbers(rows)
  const trips = rows.map(row => ({ ...row, displayNumber: numbers.get(row.id), key: row.id, assignments: [], legacy: false }))
  const byId = new Map(trips.map(trip => [trip.id, trip]))
  const own = job && jobOwnRange(job)
  // Once saved trips exist, the parent dates are reference only. Rendering them
  // as an extra trip creates a phantom staffing requirement after trip deletion.
  if (own && !rows.length) trips.push({
    key: `job:${job.job_id}:initial`, parent: true, legacy: false,
    label: 'Job schedule', start_date: own.start, end_date: own.end, assignments: [],
  })
  const unmatched = []
  for (const assignment of assignments) {
    const trip = byId.get(assignment.mobilization_id)
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
