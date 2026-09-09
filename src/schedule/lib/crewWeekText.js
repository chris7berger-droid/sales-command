import { buildJobTrips } from './trips.js'
import { pickAllocField } from './allocations.js'
import { fmtD, getMonday } from './weeks.js'

export const DEFAULT_CREW_START = 'Meet at the shop at 6:30 AM'

export function crewDisplayName(name = '') {
  const parts = name.split(',')
  return parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : name
}

export function crewWeekDates(value) {
  const monday = getMonday(new Date(`${value}T12:00:00`))
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday)
    date.setDate(date.getDate() + i)
    return fmtD(date)
  })
}

export function crewDateLabel(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  })
}

function startLabel(job, date, defaultStart) {
  if (String(job.deferred_days || '').split(',').map(d => d.trim()).includes(date)) {
    const match = /^(\d{1,2}):(\d{2})/.exec(job.deferred_time || '')
    if (!match || +match[1] > 23 || +match[2] > 59) return 'Delayed start — confirm time'
    const hour = +match[1]
    return `Delayed start ${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`
  }
  return defaultStart.trim() || 'Confirm start time'
}

// Assignments determine attendance, including trips outside the parent dates.
// Match the board's UUID-first attribution; never guess an overlapping trip.
export function buildCrewWeekText({ name, dates, jobs, allocations, assignments, defaultStart = DEFAULT_CREW_START, updatedAt }) {
  const days = new Map(dates.map(date => [date, []]))
  const warnings = new Set()
  const jobMap = new Map(jobs.map(job => [String(job.job_id), job]))
  const weekAssignments = assignments.filter(a => days.has(a.date))
  const myJobIds = new Set(weekAssignments.filter(a => a.crew_name === name).map(a => String(a.job_id)))
  for (const id of myJobIds) {
    const job = jobMap.get(id)
    if (!job) {
      warnings.add(`An assigned job (${id}) could not be loaded. Refresh or check the board before sending.`)
      for (const date of new Set(weekAssignments.filter(a => String(a.job_id) === id && a.crew_name === name).map(a => a.date))) {
        days.get(date).push('Job details unavailable — confirm with office')
      }
      continue
    }
    const jobAssignments = weekAssignments.filter(a => String(a.job_id) === id)
    const trips = buildJobTrips(Object.values(allocations[id] || {}), jobAssignments, job)
    for (const trip of trips) {
      const myDates = [...new Set(trip.assignments.filter(a => a.crew_name === name).map(a => a.date))].sort()
      for (const date of myDates) {
        const title = [job.job_num, job.job_name].filter(Boolean).join(' — ') || 'Unnamed job'
        const address = [job.jobsite_address, job.jobsite_city, job.jobsite_state, job.jobsite_zip].filter(Boolean).join(', ')
        // Ambiguous legacy crew days cannot establish a trip lead or coworkers.
        const lead = trip.legacy ? '' : pickAllocField(trip, job, 'lead')
        const coworkers = [...new Set(trip.assignments
          .filter(a => a.date === date && a.crew_name !== name).map(a => a.crew_name))].sort()
        const lines = [title]
        if (!trip.parent && !trip.legacy && trip.label) lines.push(`Trip: ${trip.label}`)
        lines.push(`Address: ${job.jobsite_address ? address : [address, 'Confirm street address with office'].filter(Boolean).join(' — ')}`)
        lines.push(`Start: ${startLabel(job, date, defaultStart)}`)
        lines.push(`Lead: ${lead ? crewDisplayName(lead) : 'Confirm with office'}`)
        lines.push(trip.legacy ? 'Crew: confirm trip and coworkers with office' :
          `With: ${coworkers.length ? coworkers.map(crewDisplayName).join(', ') : 'No other crew assigned'}`)
        if (job.work_type) lines.push(`Work: ${job.work_type}`)
        if (!trip.legacy) {
          for (const [field, label] of [['vehicle', 'Vehicle'], ['equipment', 'Equipment'], ['power_source', 'Power']]) {
            const value = pickAllocField(trip, job, field)
            if (value) lines.push(`${label}: ${value}`)
          }
          // jobs.notes is internal. Only include the saved trip's instructions.
          if (trip.note) lines.push(`Trip notes: ${trip.note}`)
        }
        if (!job.jobsite_address) warnings.add(`${title}: street address missing.`)
        if (!lead) warnings.add(`${title}: lead needs confirmation.`)
        if (trip.legacy) warnings.add(`${title}: assigned days are not linked to a clear trip; confirm crew details.`)
        days.get(date).push(lines.join('\n'))
      }
    }
  }
  const lines = [crewDisplayName(name), `Week of ${dates[0]} through ${dates.at(-1)}`, '']
  for (const [date, entries] of days) {
    lines.push(crewDateLabel(date).toUpperCase())
    if (entries.length > 1) {
      lines.push('Multiple assignments — confirm order/start times with office.')
      warnings.add(`${crewDateLabel(date)}: multiple assignments; confirm timing.`)
    }
    lines.push(entries.length ? entries.join('\n\n') : 'No work assigned', '')
  }
  if (updatedAt) lines.push(`Updated ${updatedAt.toLocaleString('en-US')}`)
  return { text: lines.join('\n').trim(), warnings: [...warnings] }
}
