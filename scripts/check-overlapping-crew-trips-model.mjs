import assert from 'node:assert/strict'
import { crewScheduleRows, crewRowInRange, crewRowStaffing, crewRowNames } from '../src/schedule/lib/crewScheduleRows.js'
const job = { job_id: 1, start_date: '2026-08-22', end_date: '2026-10-02', crew_needed: 4, lead: 'Dave' }
const wide = { id: 'wide', seq: 1, label: 'Google', start_date: job.start_date, end_date: job.end_date }
const short = { id: 'short', seq: 2, label: 'Concrete Sealing', start_date: '2026-09-28', end_date: '2026-09-29', crew_needed: 2, lead: 'Jane' }
const day = '2026-09-28'
const assignments = [
  { id: 1, job_id: 1, date: day, crew_name: 'Dave', mobilization_id: 'wide' },
  { id: 2, job_id: 1, date: day, crew_name: 'Jane', mobilization_id: 'short' },
  { id: 3, job_id: 1, date: day, crew_name: 'Legacy', mobilization_id: null },
]
const rows = crewScheduleRows(job, [wide, short], assignments, day, '2026-10-03')
assert.equal(rows.length, 3, 'Two saved trips plus one ambiguous crew row; no duplicate parent')
assert.deepEqual(rows.map(r => r.assignments.map(a => a.id)), [[1], [2], [3]])
assert.equal(crewRowStaffing(rows[0], day).needed, 4)
assert.equal(crewRowStaffing(rows[1], day).needed, 2)
assert.deepEqual(crewRowStaffing(rows[1], day).leads, ['Jane'])
assert.equal(crewRowInRange(rows[1], '2026-09-30'), false)
assert.deepEqual(crewRowNames(rows[0], day), ['Dave'])
assert.equal(crewRowStaffing(rows[2], day).needed, null)
assert.equal(crewRowInRange(rows[2], '2026-09-29'), false)
assert.equal(crewScheduleRows(job, [wide, { ...short, crew_needed: 0 }], [], day, '2026-10-03').map(r => crewRowStaffing(r, day).needed)[1], 0)
assert.equal(crewScheduleRows(job, [wide, { ...short, start_date: wide.start_date, end_date: wide.end_date }], [], day, '2026-10-03').length, 2, 'Identical dates retain separate UUIDs')
assert.equal(crewScheduleRows(job, [wide, short], [], '2026-09-30', '2026-10-03').length, 1)
assert.equal(crewScheduleRows(job, [short], [], day, '2026-10-03').length, 1, 'Saved trips replace synthetic parent plans without editing original job dates')
assert.equal(crewScheduleRows({ job_id: 1 }, [short], [], day, '2026-10-03').length, 1, 'Trip works without parent dates')
assert.equal(crewScheduleRows({ job_id: 1 }, [], [], day, '2026-10-03').length, 1, 'Undated job stays visible')
assert.equal(crewScheduleRows(job, [wide], [assignments[2]], day, '2026-10-03')[0].assignments.length, 0, 'Matching dates never establish trip ownership')
assert.equal(crewScheduleRows(job, [wide], [{ ...assignments[2], mobilization_id: 'missing' }], day, '2026-10-03').length, 2, 'Unknown UUID never assigned by dates')
console.log('PASS: nested/identical trips, per-trip staffing, zero, parent fallback, legacy identity')
