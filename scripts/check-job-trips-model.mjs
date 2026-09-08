import assert from 'node:assert/strict'
import { buildJobTrips, tripPeriod } from '../src/schedule/lib/trips.js'

const trip = { id: 'long', seq: 1, start_date: '2026-08-22', end_date: '2026-10-02' }
const crew = dates => dates.map((date, i) => ({ id: i, date, crew_name: 'Bash Dave', mobilization_id: 'long' }))
const days = crew(['2026-08-22', '2026-08-24', '2026-09-10', '2026-10-02'])
assert.equal(buildJobTrips([trip], [])[0].id, 'long', 'A planned trip exists before crew assignments')
let result = buildJobTrips([trip], days)
assert.equal(result.length, 1, 'Weekends, new weeks, and long staffing gaps do not split a saved trip')
assert.equal(result[0].assignments.length, days.length)
assert.equal(result[0].end_date, '2026-10-02')

const overlapping = { ...trip, id: 'other', seq: 2 }
const extra = [{ id: 9, date: '2026-09-01', crew_name: 'Unlinked', mobilization_id: null }]
result = buildJobTrips([trip, overlapping], [...days, ...extra])
assert.equal(result[0].assignments.length, days.length, 'Explicit link wins even with overlapping spans')
assert.equal(result[1].assignments.length, 0)
assert.equal(result.find(t => t.legacy).assignments.length, 1, 'Ambiguous crew date retained separately, never duplicated')
assert.equal(result.flatMap(t => t.assignments).length, days.length + extra.length)
assert.equal(buildJobTrips([trip], extra).length, 1, 'One unambiguous span can contain an older unlinked crew date')
result = buildJobTrips([trip], [{ ...extra[0], mobilization_id: 'missing-trip' }])
assert.equal(result.length, 2, 'A missing explicit link must not silently be reassigned by date')

const old = ['2026-07-03', '2026-07-06', '2026-07-10', '2026-07-13', '2026-07-22'].map((date, id) => ({ id, date, crew_name: 'Older crew' }))
result = buildJobTrips([], old)
assert.equal(result.length, 2, 'Legacy grouping preserves existing six-day-gap rule, not calendar weeks')
assert.equal(result[0].start_date, '2026-07-03')
assert.equal(result[0].end_date, '2026-07-13')
assert.equal(result.flatMap(t => t.assignments).length, old.length)

assert.equal(tripPeriod(trip, '2026-09-08'), 'current')
assert.equal(tripPeriod(trip, '2026-08-01'), 'upcoming')
assert.equal(tripPeriod(trip, '2026-10-03'), 'past')
assert.equal(tripPeriod({}, '2026-09-08'), 'undated')
assert.equal(tripPeriod({ start_date: '2026-08-01' }, '2026-09-08'), 'undated')
assert.equal(tripPeriod({ start_date: '2026-10-01', end_date: '2026-08-01' }, '2026-09-08'), 'undated')
console.log('PASS trip identity, multiweek spans, staffing gaps, ambiguous/legacy history, and date-based grouping.')

const parent = { job_id: 50, start_date: '2026-10-12', end_date: '2026-10-30' }
result = buildJobTrips([], [], parent)
assert.equal(result.length, 1);assert.equal(result[0].parent, true)
const parentKey = result[0].key
assert.equal(tripPeriod(result[0], '2026-09-08'), 'upcoming')
result = buildJobTrips([], ['2026-10-12', '2026-10-30'].map(date => ({ date, crew_name: 'Dave', mobilization_id: null })), parent)
assert.equal(result.length, 1, 'Parent-only span must survive an 18-day gap in crew assignments')
assert.equal(result[0].key, parentKey);assert.equal(result[0].assignments.length, 2)
assert.equal(result[0].end_date, '2026-10-30')
result = buildJobTrips([], [], { ...parent, scheduled_start: '2026-11-01', scheduled_end: '2026-11-20' })
assert.equal(result[0].start_date, '2026-11-01');assert.equal(result[0].end_date, '2026-11-20')
const explicit = { id: 'explicit', seq: 1, start_date: parent.start_date, end_date: parent.end_date }
assert.equal(buildJobTrips([explicit], [], parent).length, 1, 'Explicit trip must not be copied by a parent fallback')
const later = { ...explicit, id: 'later', start_date: '2026-12-01', end_date: '2026-12-03' }
assert.equal(buildJobTrips([later], [], parent).length, 2, 'Parent first trip remains visible alongside a later allocation')
console.log('PASS parent-only trip before/after staffing, scheduled-date precedence, and explicit-trip duplicate suppression.')
