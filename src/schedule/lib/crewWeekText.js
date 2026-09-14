import { buildJobTrips } from './trips.js'
import { pickAllocField } from './allocations.js'
import { fmtD, getMonday } from './weeks.js'

export const DEFAULT_CREW_START = 'Meet at the shop at 6:30 AM'
const BOARD_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function crewGrid(job, trip, boardDates) {
  const byName = new Map()
  for (const a of trip.assignments) {
    if (!boardDates.includes(a.date) || !a.crew_name) continue
    if (!byName.has(a.crew_name)) byName.set(a.crew_name, new Set())
    byName.get(a.crew_name).add(a.date)
  }
  const names = [...byName.keys()].sort((a, b) => crewDisplayName(a).localeCompare(crewDisplayName(b)))
  if (!names.length) return null
  const title = [job.job_num, !trip.parent && !trip.legacy && trip.label].filter(Boolean).join(' — ')
    || [job.job_num, job.job_name].filter(Boolean).join(' — ') || 'Crew'
  const labels = names.map(crewDisplayName)
  const width = Math.max(...labels.map(label => label.length), 0)
  const pad = label => label.padEnd(width, ' ')
  const lines = [title, `${pad('')} ${BOARD_DAYS.join(' ')}`]
  names.forEach((name, i) => {
    lines.push(`${pad(labels[i])} ${boardDates.map(date => byName.get(name).has(date) ? '●' : '·').join('  ')}`)
  })
  return { key: `${job.job_id}:${trip.id || trip.key}`, title, text: lines.join('\n') }
}

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
  const grids = []
  const seenGrids = new Set()
  const boardDates = dates.slice(0, 6)
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
      if (myDates.length) {
        const grid = crewGrid(job, trip, boardDates)
        const gridKey = grid?.key
        if (grid && !seenGrids.has(gridKey)) {
          seenGrids.add(gridKey)
          grids.push(grid)
        }
      }
      for (const date of myDates) {
        const title = [job.job_num, job.job_name].filter(Boolean).join(' — ') || 'Unnamed job'
        const address = [job.jobsite_address, job.jobsite_city, job.jobsite_state, job.jobsite_zip].filter(Boolean).join(', ')
        // Same lead as the Crew Schedule board: trip lead if set, else job lead.
        // Unlinked days have no trip lead, so they inherit the job lead.
        const lead = pickAllocField(trip.legacy ? null : trip, job, 'lead')
        const lines = [title]
        if (!trip.parent && !trip.legacy && trip.label) lines.push(`Trip: ${trip.label}`)
        lines.push(`Address: ${job.jobsite_address ? address : [address, 'Confirm street address with office'].filter(Boolean).join(' — ')}`)
        lines.push(`Start: ${startLabel(job, date, defaultStart)}`)
        lines.push(`Lead: ${lead ? crewDisplayName(lead) : 'Confirm with office'}`)
        if (trip.legacy) lines.push('Crew: confirm trip and coworkers with office')
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
  const scheduled = [...days].filter(([, entries]) => entries.length)
  for (const [date, entries] of scheduled) {
    lines.push(crewDateLabel(date).toUpperCase())
    if (entries.length > 1) {
      lines.push('Multiple assignments — confirm order/start times with office.')
      warnings.add(`${crewDateLabel(date)}: multiple assignments; confirm timing.`)
    }
    lines.push(entries.join('\n\n'), '')
  }
  if (grids.length) {
    lines.push('CREW', '')
    for (const grid of grids) lines.push(grid.text, '')
  }
  if (updatedAt) lines.push(`Updated ${updatedAt.toLocaleString('en-US')}`)
  return { text: lines.join('\n').trim(), warnings: [...warnings],
    days: scheduled.map(([date, entries]) => ({ date, entries })),
    grids,
  }
}
