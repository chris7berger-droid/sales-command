import { crewRequirement, jobOwnRange, pickAllocField } from './allocations.js'
import { workedDaySet } from './workdays.js'

// Card summary uses saved trips, not proposal fallbacks or tentative WTC dates.
export function jobCardSchedule(job, mobilizations = {}, assignmentDates = null) {
  const trips = Object.values(mobilizations || {}).filter(m => m?.id)
  const own = jobOwnRange(job)
  const ranges = [...(own ? [own] : []), ...trips.map(t => ({ start: t.start_date, end: t.end_date }))]
    .filter(r => (r.start || r.end) && !(r.start && r.end && r.end < r.start))
  const days = new Set()
  for (const r of ranges) for (const day of workedDaySet(r.start, r.end, assignmentDates)) days.add(day)
  const targets = trips.length ? trips.map(t => crewRequirement(pickAllocField(t, job, 'crew_needed'))) : [crewRequirement(job.crew_needed)]
  const required = targets.some(t => t == null) ? '?' : new Set(targets).size === 1 ? targets[0] : 'varies'
  return {
    hasDate: ranges.length > 0,
    workDays: ranges.some(r => !r.start || !r.end) ? null : days.size,
    required,
    hasTrips: trips.length > 0,
  }
}

export function crewScheduleLink(job, mobilizations = {}) {
  const trip = Object.values(mobilizations || {}).filter(t => t?.id && t.start_date)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || (a.seq || 0) - (b.seq || 0))[0]
  const start = trip?.start_date || job.scheduled_start || job.start_date
  const params = new URLSearchParams({ job: String(job.job_id) })
  if (start) {
    const monday = new Date(`${start}T00:00:00`)
    if (!Number.isNaN(monday.getTime())) {
      monday.setDate(monday.getDate() - (monday.getDay() === 0 ? 6 : monday.getDay() - 1))
      params.set('week', `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`)
    }
  }
  if (trip) params.set('trip', trip.id)
  return `/schedule/schedule?${params}`
}
