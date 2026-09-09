import { getJobStatus } from './jobStatus.js'
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

// Every saved crew day must remain visible, even when job dates/status no longer
// place it on the board. Both board and sidebar consume these exact rows.
export function crewWeekRows(jobs, allocations, assignments, start, end) {
  const week = assignments.filter(a => a.date >= start && a.date <= end)
  const known = new Set(jobs.map(j => String(j.job_id)))
  const rows = jobs.flatMap(job => {
    const active = ['Scheduled', 'In Progress', 'On Hold', 'Ongoing'].includes(getJobStatus(job))
    return crewScheduleRows(job, allocations[job.job_id], week, start, end)
      .filter(row => row.assignments.length || (active && row.ranges.length && overlapsWeek(row.ranges, start, end)))
      .map(row => ({ ...row, issue: !active ? 'Crew remains assigned to a job outside the active schedule.'
        : row.assignments.some(a => a.mobilization_id && !inRange(row.ranges, a.date))
          ? 'Assigned crew dates fall outside this trip. Review the crew days below.'
          : row.trip.legacy ? 'These crew days have no matching trip. Review them before scheduling more crew.' : null }))
  })
  const missing = new Map()
  for (const a of week) {
    if (known.has(String(a.job_id))) continue
    const key = String(a.job_id ?? 'unlinked')
    if (!missing.has(key)) missing.set(key, {
      key: `unavailable:${key}`, unavailable: true,
      job: { job_id: a.job_id, job_num: a.job_id == null ? 'Unlinked allocation' : `Unavailable job ${a.job_id}`, job_name: '' },
      trip: { key, legacy: true, label: 'Allocation needs review' }, ranges: [], assignments: [],
      issue: 'This allocation has no available job. It still counts as booked; its job link needs review.',
    })
    missing.get(key).assignments.push(a)
  }
  for (const row of missing.values()) {
    const days = row.assignments.map(a => a.date).sort()
    row.trip.start_date = days[0]; row.trip.end_date = days.at(-1)
  }
  return [...rows, ...missing.values()].map((row, colorIndex) => ({ ...row, colorIndex }))
}

export function crewCardRows(rows, name) {
  return rows.filter(row => row.assignments.some(a => a.crew_name === name))
    .map(row => ({ ...row, dates: [...new Set(row.assignments.filter(a => a.crew_name === name).map(a => a.date))] }))
}

// Count people, not assignment rows: double booking must not inflate capacity.
// Time off still takes precedence, matching the existing capacity denominator.
export function crewWeekCapacity(rows, crew, statuses, dates, today) {
  const roster = crew.filter(c => !c.archived)
  return { capacityDays: dates.map(date => {
    const available = [], assigned = [], out = []
    for (const person of roster) {
      const status = statuses[`${person.name}|${date}`] || 'available'
      const allocations = crewCardRows(rows, person.name).filter(row => row.dates.includes(date))
      if (status !== 'available') out.push({ name: person.name, status })
      else if (allocations.length) assigned.push({ name: person.name,
        job: allocations[0].job,
        allocationLabel: allocations.map(row => `${row.job.job_num} · ${row.trip.label || 'Trip'}${row.issue ? ' (needs review)' : ''}`).join('; '),
      })
      else available.push({ name: person.name })
    }
    const avail = roster.length - out.length
    return { date, assigned: assigned.length, avail, free: available.length, out: out.length,
      pct: avail ? Math.round(assigned.length / avail * 100) : 0, isToday: date === today,
      detail: { available, assigned, out } }
  }) }
}
