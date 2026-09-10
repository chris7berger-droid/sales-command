import assert from 'node:assert/strict'
import { crewWeekRows, crewCardRows, crewWeekCapacity } from '../src/schedule/lib/crewScheduleRows.js'
import { crewWeekSummary } from '../src/schedule/lib/crewWeekSummary.js'
const dates = ['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19']
const jobs = [
 { job_id: 1, job_num: '10233', status: 'Ongoing', start_date: '2026-09-22', end_date: '2026-09-25' },
 { job_id: 2, job_num: '10232', status: 'Ongoing', start_date: dates[0], end_date: dates[2], crew_needed: 1 },
 { job_id: 3, status: 'Complete', start_date: dates[0], end_date: dates[1] },
 { job_id: 4, status: 'Ongoing' },
]
const assignments = [
 { id: 1, job_id: 1, crew_name: 'Jacob', date: dates[0], mobilization_id: null },
 { id: 2, job_id: 2, crew_name: 'Jacob', date: dates[0], mobilization_id: null },
 { id: 3, job_id: 3, crew_name: 'Other', date: dates[0], mobilization_id: null },
 { id: 4, job_id: 999, crew_name: 'Missing', date: dates[0], mobilization_id: null },
]
const rows = crewWeekRows(jobs, {}, assignments, dates[0], dates.at(-1))
assert.deepEqual(rows.flatMap(r => r.assignments.map(a => a.id)).sort(), [1,2,3,4])
assert.equal(rows.some(r => r.job.job_id === 4), false)
assert.equal(crewCardRows(rows, 'Jacob').length, 2)
assert.ok(rows.find(r => r.job.job_id === 1).issue)
assert.ok(rows.find(r => r.job.job_id === 3).issue)
assert.ok(rows.find(r => r.job.job_id === 999).unavailable)
const crew = ['Jacob','Other','Missing','Free','Off'].map(name => ({name}))
const capacity = crewWeekCapacity(rows, crew, {'Off|2026-09-14':'sick'}, dates, dates[0]).capacityDays[0]
assert.equal(capacity.assigned, 3) // Jacob counts once despite two allocations.
assert.equal(capacity.avail, 4)
assert.equal(capacity.free, 1)
assert.equal(capacity.pct, 75)
assert.equal(capacity.detail.assigned.length, 3)
assert.match(capacity.detail.assigned.find(c => c.name === 'Jacob').allocationLabel, /10233.*10232/)
const trip = {id:'trip', job_id:2, start_date:'2026-09-07',end_date:'2026-09-08',label:'Earlier trip'}
const wrong = crewWeekRows([jobs[1]], {2:[trip]}, [{id:5,job_id:2,mobilization_id:'trip',crew_name:'Jacob',date:dates[0]}], dates[0],dates.at(-1))
assert.match(wrong.find(r=>r.trip.id==='trip').issue, /outside/)
assert.equal(crewCardRows(wrong,'Jacob')[0].trip.id,'trip') // no automatic relinking
const summary = crewWeekSummary([],{},[],dates,rows)
assert.equal(summary.starting.some(entry => entry.job.job_id === 1), false)
assert.equal(summary.needing.some(entry => entry.job.job_id === 2), false, 'Reference job dates do not invent a staffing requirement')
assert.equal(rows.some(row => row.trip.parent), false, 'No undeletable synthetic Job schedule row beside unlinked crew')
console.log('PASS shared board/cards/capacity: off-date, inactive, unavailable, conflict, time off, trip mismatch, no invented starts.')
