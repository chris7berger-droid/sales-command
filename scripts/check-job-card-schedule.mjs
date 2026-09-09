import assert from 'node:assert/strict'
import { jobCardSchedule, crewScheduleLink } from '../src/schedule/lib/jobCardSchedule.js'
const trip = { id: 'trip2', start_date: '2026-09-28', end_date: '2026-10-30', crew_needed: 3 }
const weekends = new Set(['2026-10-03', '2026-10-10', '2026-10-17'])
assert.deepEqual(jobCardSchedule({}, { 2: trip }, weekends), { hasDate: true, workDays: 28, required: 3, hasTrips: true })
assert.equal(jobCardSchedule({}, { 2: { ...trip, crew_needed: null } }).required, '?')
assert.equal(jobCardSchedule({ crew_needed: 4 }, { 2: { ...trip, crew_needed: null } }).required, 4)
assert.equal(jobCardSchedule({}, { 2: { ...trip, crew_needed: 0 } }).required, 0)
assert.equal(jobCardSchedule({}, { 2: trip, 3: { ...trip, id: 'other', crew_needed: 2 } }).required, 'varies')
assert.equal(jobCardSchedule({}, { 2: trip, 3: { ...trip, id: 'other' } }).workDays, 25)
assert.equal(jobCardSchedule({}, { 2: { ...trip, start_date: '2026-09-28', end_date: '2026-09-28' }, 3: { ...trip, id: 'other', start_date: '2026-10-30', end_date: '2026-10-30' } }).workDays, 2)
assert.equal(jobCardSchedule({}, { 2: { ...trip, start_date: null, end_date: null } }).hasDate, false)
assert.equal(jobCardSchedule({}, { 2: { ...trip, end_date: null } }).workDays, null)
assert.equal(jobCardSchedule({}, { 2: { ...trip, id: undefined } }).hasDate, false)
assert.equal(jobCardSchedule({ scheduled_start: '2026-09-28', scheduled_end: '2026-10-02' }).workDays, 5)
console.log('PASS trip-only card dates, staffed weekends, overlap deduplication, gaps, partial/undated trips, crew overrides, unknown/zero/varied targets and job-only schedules.')

assert.equal(crewScheduleLink({ job_id: 1280 }, { 2: { ...trip, id: 'target' } }), '/schedule/schedule?job=1280&week=2026-09-28&trip=target')
assert.equal(crewScheduleLink({ job_id: 1280 }, { 2: { ...trip, id: 'target', start_date: '2026-09-30' } }), '/schedule/schedule?job=1280&week=2026-09-28&trip=target')
assert.equal(crewScheduleLink({ job_id: 1280, start_date: '2026-10-04' }), '/schedule/schedule?job=1280&week=2026-09-28')
assert.equal(crewScheduleLink({ job_id: 1280 }), '/schedule/schedule?job=1280')
console.log('PASS CREW link uses first trip week/identity, local Monday, parent fallback and undated fallback.')
