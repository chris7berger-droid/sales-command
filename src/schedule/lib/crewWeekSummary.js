import { buildJobTrips } from './trips.js'
import { jobRanges, inRange, staffingForDay } from './allocations.js'

// Input jobs are the same active jobs displayed by the crew board. Count a Sales
// job once even when legacy Schedule rows share its call_log_id. Unlinked jobs
// retain their own identity. History inferred from assignments is not a plan.
export function crewWeekSummary(jobs, allocations, assignments, dates) {
  const groups = { starting: new Map(), ending: new Map(), needing: new Map(), unknown: new Map() }
  const assigned = new Map()
  for (const row of assignments) {
    const key = `${row.job_id}|${row.date}`
    if (!assigned.has(key)) assigned.set(key, new Set())
    if (row.crew_name) assigned.get(key).add(row.crew_name)
  }
  function add(kind, job, detail) {
    const key = job.call_log_id != null ? `sales:${job.call_log_id}` : `job:${job.job_id}`
    if (!groups[kind].has(key)) groups[kind].set(key, { key, job, details: [] })
    groups[kind].get(key).details.push({ ...detail, jobId: job.job_id })
  }
  const start = dates[0], end = dates.at(-1)
  for (const job of jobs) {
    const rows = Object.values(allocations[job.job_id] || {})
    const trips = buildJobTrips(rows, [], job)
    for (const trip of trips) {
      if (trip.start_date && trip.end_date && trip.end_date < trip.start_date) continue
      if (trip.start_date >= start && trip.start_date <= end) add('starting', job, { trip })
      if (trip.end_date >= start && trip.end_date <= end) add('ending', job, { trip })
    }
    const ranges = jobRanges(job, rows)
    for (const date of dates) {
      if (!inRange(ranges, date)) continue
      const staffing = staffingForDay(job, rows, date)
      const count = assigned.get(`${job.job_id}|${date}`)?.size || 0
      const trip = staffing.allocation || trips.find(t => t.parent) || trips[0]
      const detail = { date, trip, assigned: count, needed: staffing.needed,
        editTrips: staffing.ambiguous ? trips.filter(t => !t.parent &&
          (t.start_date || t.end_date) && (!t.start_date || t.start_date <= date) && (!t.end_date || t.end_date >= date)) : [trip],
      }
      if (staffing.needed == null) {
        add('unknown', job, { ...detail,
          tripLabel: staffing.ambiguous ? rows.filter(row =>
            (row.start_date || row.end_date) && (!row.start_date || row.start_date <= date) && (!row.end_date || row.end_date >= date))
            .map(row => row.label || `Trip ${row.seq}`).join(' / ') : null,
          reason: staffing.ambiguous ? 'Overlapping trips — check crew needs' : 'Crew needs not set',
        })
      } else if (count < staffing.needed) {
        add('needing', job, { ...detail, short: staffing.needed - count })
      }
    }
  }
  return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, [...value.values()]]))
}
