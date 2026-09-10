import assert from 'node:assert/strict'
import { buildCrewWeekText, crewWeekDates } from '../src/schedule/lib/crewWeekText.js'
const dates = crewWeekDates('2026-09-11')
assert.deepEqual(dates, ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13'])
assert.equal(crewWeekDates('2026-11-01')[0], '2026-10-26', 'DST Sunday stays in its own week')
const job = { job_id: 1, job_num: '6618', job_name: 'Lakes Crossing',
  start_date: '2026-08-01', end_date: '2026-08-02', lead: 'Parent Lead',
  vehicle: 'Box 3', jobsite_address: '123 Example Way', jobsite_city: 'Las Vegas',
  deferred_days: '2026-09-13', deferred_time: '13:15', notes: 'PRIVATE OFFICE NOTE' }
const allocations = { 1: {
  1: { id: 'burnish', seq: 1, label: 'Final Burnish', start_date: dates[4], end_date: dates[6], lead: 'Zomparelli, Kurtis', note: 'Use north gate' },
  2: { id: 'seal', seq: 2, label: 'Seal', start_date: dates[4], end_date: dates[4], lead: 'Other Lead' },
} }
const assignments = [
  { job_id: 1, date: dates[4], crew_name: 'JoseJR', mobilization_id: 'burnish' },
  { job_id: 1, date: dates[4], crew_name: 'Kurtis', mobilization_id: 'burnish' },
  { job_id: 1, date: dates[4], crew_name: 'Wrong Trip', mobilization_id: 'seal' },
  { job_id: 1, date: dates[5], crew_name: 'Wrong Day', mobilization_id: 'burnish' },
  { job_id: 1, date: dates[6], crew_name: 'JoseJR', mobilization_id: 'burnish' },
  { job_id: 1, date: dates[6], crew_name: 'Sunday Crew', mobilization_id: 'burnish' },
]
const args = { name: 'JoseJR', dates, jobs: [job], allocations, assignments, defaultStart: 'Shop 6:30 AM' }
const result = buildCrewWeekText(args)
assert.match(result.text, /Lead: Kurtis Zomparelli/)
assert.match(result.text, /Address: 123 Example Way, Las Vegas/)
assert.match(result.text, /Vehicle: Box 3/)
assert.match(result.text, /Trip notes: Use north gate/)
assert.match(result.text, /Start: Shop 6:30 AM/)
assert.match(result.text, /SUNDAY, SEP 13[\s\S]*Start: Delayed start 1:15 PM[\s\S]*With: Sunday Crew/)
assert.match(result.text, /FRIDAY, SEP 11[\s\S]*With: Kurtis/)
assert.doesNotMatch(result.text, /Wrong Trip|Wrong Day|PRIVATE OFFICE|Other Lead|Parent Lead/)
assert.equal(result.warnings.length, 0)
const ambiguous = buildCrewWeekText({ ...args, assignments: [{job_id:1,date:dates[4],crew_name:'JoseJR'}] })
assert.match(ambiguous.text, /Lead: Confirm with office/)
assert.match(ambiguous.text, /confirm trip and coworkers/)
assert.doesNotMatch(ambiguous.text, /Kurtis|Other Lead|Box 3/)
const parent = buildCrewWeekText({ ...args, jobs: [{...job,start_date:dates[0],end_date:dates[6]}], allocations:{},
  assignments:[{job_id:1,date:dates[4],crew_name:'JoseJR'},{job_id:1,date:dates[4],crew_name:'Parent Coworker'}] })
assert.match(parent.text, /Lead: Confirm with office/)
assert.doesNotMatch(parent.text, /With: Parent Coworker/)
assert.match(parent.text, /confirm trip and coworkers/)
const missing = buildCrewWeekText({ ...args, jobs: [] })
assert.match(missing.text, /Job details unavailable/)
assert.equal(missing.warnings.length, 1)
const empty = buildCrewWeekText({ ...args, assignments: [] })
assert.equal((empty.text.match(/No work assigned/g) || []).length, 7)
const multiple = buildCrewWeekText({ ...args, assignments: [...assignments,{job_id:1,date:dates[4],crew_name:'JoseJR',mobilization_id:'seal'}] })
assert.match(multiple.text, /Multiple assignments/)
assert.match(multiple.text, /Lead: Other Lead/)
const duplicate = buildCrewWeekText({ ...args, assignments: [...assignments,assignments[0]] })
assert.equal(duplicate.text, result.text, 'Duplicate assignment does not duplicate an itinerary entry')
const defaulted = buildCrewWeekText({ ...args, defaultStart: undefined })
assert.match(defaulted.text, /Start: Meet at the shop at 6:30 AM/)
assert.match(defaulted.text, /Start: Delayed start 1:15 PM/)
const noStart = buildCrewWeekText({ ...args, defaultStart: '' })
assert.match(noStart.text, /Start: Confirm start time/)
console.log('PASS: day/trip coworkers, override/inheritance, Sunday/DST, deferred start, missing jobs, ambiguity, duplicate/multiple assignments, internal note exclusion')
