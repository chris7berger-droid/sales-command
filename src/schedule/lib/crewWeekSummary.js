import { crewScheduleRows, crewRowInRange, crewRowStaffing, crewRowNames } from './crewScheduleRows.js'

// Match the board's trip rows and UUID-based assignment attribution. Count a
// Sales job once even when several Schedule rows share its call_log_id. Legacy
// crew history stays visible on the board but never invents a planned endpoint
// or fills the requirements of several overlapping trips.
export function crewWeekSummary(jobs, allocations, assignments, dates, rows = null) {
  const groups = { starting: new Map(), ending: new Map(), needing: new Map(), unknown: new Map() }
  function add(kind, job, detail) {
    const key = job.call_log_id != null ? `sales:${job.call_log_id}` : `job:${job.job_id}`
    if (!groups[kind].has(key)) groups[kind].set(key, { key, job, details: [] })
    groups[kind].get(key).details.push({ ...detail, jobId: job.job_id })
  }
  const start = dates[0], end = dates.at(-1)
  for (const row of rows || jobs.flatMap(job => crewScheduleRows(job, allocations[job.job_id], assignments, start, end))) {
      const { trip, job } = row
      if (trip.legacy || (trip.start_date && trip.end_date && trip.end_date < trip.start_date)) continue
      if (trip.start_date >= start && trip.start_date <= end) add('starting', job, { trip })
      if (trip.end_date >= start && trip.end_date <= end) add('ending', job, { trip })
      for (const date of dates) {
        if (!crewRowInRange(row, date)) continue
        const staffing = crewRowStaffing(row, date)
        const count = crewRowNames(row, date).length
        const detail = { date, trip, assigned: count, needed: staffing.needed, editTrips: [trip] }
        if (staffing.needed == null) add('unknown', job, { ...detail, reason: 'Crew requirement not set' })
        else if (count < staffing.needed) add('needing', job, { ...detail, short: staffing.needed - count })
      }
  }
  return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, [...value.values()]]))
}
