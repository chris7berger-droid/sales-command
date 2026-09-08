import assert from 'node:assert/strict'
import { crewRequirement, staffingForDay, staffingSummary, allocationsInWindow } from '../src/schedule/lib/allocations.js'

for (const value of [null, undefined, '', ' ', 'unknown', -1, 1.5]) assert.equal(crewRequirement(value), null)
assert.equal(crewRequirement(0), 0)
assert.equal(crewRequirement('4'), 4)
const job = { start_date: null, end_date: null, crew_needed: 3, lead: 'Job lead' }
const trips = [
  { start_date: '2026-10-12', end_date: '2026-10-13', crew_needed: 1, lead: 'Bash Dave' },
  { start_date: '2026-10-15', end_date: '2026-10-16', crew_needed: 4, lead: 'Smith, Jane' },
]
const monday = staffingForDay(job, trips, '2026-10-12')
const thursday = staffingForDay(job, trips, '2026-10-15')
assert.equal(monday.needed, 1);assert.deepEqual(monday.leads, ['Bash Dave'])
assert.equal(thursday.needed, 4);assert.deepEqual(thursday.leads, ['Smith, Jane'])
assert.equal(staffingForDay(job, trips, '2026-10-14').active, false)
assert.equal(staffingSummary([monday, thursday]).label, 'varies')
assert.equal(staffingSummary([monday, thursday]).detailsVary, true)
assert.equal(staffingSummary([monday, staffingForDay(job, trips, '2026-10-14')]).label, '1')
const zero = [{ ...trips[0], crew_needed: 0 }]
assert.equal(staffingForDay(job, zero, '2026-10-12').needed, 0, 'Zero must not inherit job target')
assert.equal(staffingForDay(job, [{ ...trips[0], crew_needed: null }], '2026-10-12').needed, 3)
assert.equal(staffingForDay({ ...job, crew_needed: null }, [], '2026-10-12').needed, null)
const overlap = staffingForDay(job, [trips[0], { ...trips[0], crew_needed: 4 }], '2026-10-12')
assert.equal(overlap.ambiguous, true);assert.equal(overlap.needed, null)
assert.equal(staffingSummary([overlap]).label, '?', 'Overlaps must not silently use the first target')
console.log('PASS unknown vs zero, inheritance, day-specific requirements/leads, gaps, and explicit overlapping-trip uncertainty.')
const spanning={id:'full-span',seq:3,start_date:'2026-10-01',end_date:'2026-10-30'}
const matching=allocationsInWindow({2:trips[1],1:trips[0],3:spanning,4:{start_date:'2026-11-02',end_date:'2026-11-03'},5:{start_date:null,end_date:null}},'2026-10-12','2026-10-17')
assert.deepEqual(matching,[spanning,trips[0],trips[1]])
assert.equal(matching[0],spanning,'Keep the original trip identity and entire date span')
assert.deepEqual(allocationsInWindow(null,'2026-10-12','2026-10-17'),[])
console.log('PASS visible-week titles include all matching trips, retain full multiweek spans, and exclude undated/other-week trips.')
