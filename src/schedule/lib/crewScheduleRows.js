import { buildJobTrips } from './trips.js'
import { inRange, overlapsWeek, staffingForDay } from './allocations.js'

// Keep UUID identity even when trips have identical or nested date spans.
// Reuse Jobs' conservative assignment attribution: ambiguous legacy crew days
// appear once in their own row rather than being counted on every overlapping trip.
export function crewScheduleRows(job, allocations, assignments, start, end) {
  const saved = Object.values(allocations || {})
  const crewDays = assignments.filter(a => String(a.job_id) === String(job.job_id) && a.date >= start && a.date <= end)
  const trips = buildJobTrips(saved, crewDays, job)
  if (!trips.length) trips.push({ key: 'unscheduled', parent: true, label: 'Job schedule', assignments: [] })
  return trips.filter(trip => {
    const dated = trip.start_date || trip.end_date
    return (dated && overlapsWeek([{ start: trip.start_date, end: trip.end_date }], start, end)) ||
      trip.assignments.length > 0 || (trip.parent && !dated)
  }).map(trip => ({
    key: `${job.job_id}:${trip.key}`, job, trip, assignments: trip.assignments,
    ranges: trip.start_date || trip.end_date ? [{ start: trip.start_date, end: trip.end_date }] : [],
  }))
}

export function crewRowInRange(row, date) {
  return row.trip.legacy ? row.assignments.some(a => a.date === date) : inRange(row.ranges, date)
}

export function crewRowStaffing(row, date) {
  const { job, trip } = row
  const scopedJob = { ...job, scheduled_start: null, scheduled_end: null, start_date: trip.start_date, end_date: trip.end_date }
  const staffing = staffingForDay(scopedJob, trip.id ? [trip] : [], date)
  return { ...staffing, active: crewRowInRange(row, date), needed: trip.legacy ? null : staffing.needed }
}

export function crewRowNames(row, date = null) {
  return [...new Set(row.assignments.filter(a => !date || a.date === date).map(a => a.crew_name))]
}
