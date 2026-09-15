import assert from 'node:assert/strict'
import { buildCrewMidweekText, buildCrewWeekText, crewCompactDayLabel, crewMidweekDates, crewWeekDates } from '../src/schedule/lib/crewWeekText.js'

const week = crewWeekDates('2026-09-11')
assert.deepEqual(week, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'])
assert.deepEqual(crewMidweekDates('2026-09-08'), week.slice(1, 5), 'Tuesday through Friday of the current week')
assert.deepEqual(crewMidweekDates('2026-09-07'), week.slice(0, 5), 'Monday through Friday')
assert.deepEqual(crewMidweekDates('2026-09-11'), ['2026-09-11'], 'Friday is only remaining weekday')
assert.deepEqual(crewMidweekDates('2026-09-12'), [], 'Saturday has no remaining weekdays through Friday')
assert.deepEqual(crewMidweekDates('2026-09-13'), [], 'Sunday has no remaining weekdays through Friday')
assert.deepEqual(crewMidweekDates('2026-09-15'), ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'])
assert.equal(crewCompactDayLabel('2026-09-15'), 'TUE 9/15')
assert.equal(crewCompactDayLabel('2026-09-18'), 'FRI 9/18')

const job = { job_id: 1, job_num: '1842', job_name: 'Lakes Crossing',
  start_date: '2026-08-01', end_date: '2026-08-02', lead: 'Parent Lead',
  jobsite_address: '123 Example Way', jobsite_city: 'Las Vegas' }
const other = { job_id: 2, job_num: '1906', job_name: 'Other Site', lead: 'Other Lead' }
const allocations = { 1: {
  1: { id: 'burnish', seq: 1, label: 'Final Burnish', start_date: week[4], end_date: week[6], lead: 'Jones, Mike' },
}, 2: {
  1: { id: 'seal', seq: 1, label: 'Seal', start_date: week[2], end_date: week[2], lead: 'Ruiz, Carlos' },
} }
const assignments = [
  { job_id: 1, date: week[4], crew_name: 'Garcia, Jose', mobilization_id: 'burnish' },
  { job_id: 1, date: week[4], crew_name: 'Jones, Mike', mobilization_id: 'burnish' },
  { job_id: 1, date: week[4], crew_name: 'Wrong Trip', mobilization_id: 'seal' },
  { job_id: 1, date: week[6], crew_name: 'Garcia, Jose', mobilization_id: 'burnish' },
  { job_id: 2, date: week[2], crew_name: 'Garcia, Jose', mobilization_id: 'seal' },
  { job_id: 2, date: week[2], crew_name: 'Ruiz, Carlos', mobilization_id: 'seal' },
]
const statuses = [
  { crew_name: 'Garcia, Jose', date: week[1], status: 'sick' },
  { crew_name: 'Garcia, Jose', date: week[2], status: 'scheduled-off' },
  { crew_name: 'Garcia, Jose', date: week[3], status: 'scheduled-off' },
  { crew_name: 'Garcia, Jose', date: week[3], status: 'off' },
  { crew_name: 'Garcia, Jose', date: '2026-09-10T00:00:00+00:00', status: 'scheduled-off' },
  { crew_name: 'Garcia, Jose', date: week[4], status: 'scheduled-off' },
  { crew_name: 'Garcia, Jose', date: week[5], status: 'noshow' },
  { crew_name: 'Garcia, Jose', date: week[0], status: 'off' },
]
const dates = crewMidweekDates(week[1])
const result = buildCrewMidweekText({
  name: 'Garcia, Jose', dates, jobs: [job, other], allocations, assignments, statuses,
})
assert.match(result.text, /^UPDATED CREW SCHEDULE — ABBREVIATED\nJose Garcia\nCurrent schedule from today forward\. Schedule may change as jobs shift\.\n\n/)
assert.match(result.text, /WED 9\/9 — JOB #1906 — with Carlos Ruiz/)
assert.match(result.text, /THU 9\/10 — \(OFF — MAY CHANGE\)/)
assert.match(result.text, /FRI 9\/11 — JOB #1842 — with Mike Jones/)
assert.doesNotMatch(result.text, /SUN 9\/13|SAT 9\/12|TUE 9\/8|MON 9\/7/)
assert.doesNotMatch(result.text, /Wrong Trip|Call In|SICK|No Show|Lakes Crossing|with no other/i)
assert.doesNotMatch(result.text, /FRI 9\/11 — \(OFF/)
assert.doesNotMatch(result.text, /WED 9\/9 — \(OFF/)
assert.equal(result.text, `UPDATED CREW SCHEDULE — ABBREVIATED
Jose Garcia
Current schedule from today forward. Schedule may change as jobs shift.

WED 9/9 — JOB #1906 — with Carlos Ruiz
THU 9/10 — (OFF — MAY CHANGE)
FRI 9/11 — JOB #1842 — with Mike Jones`)

const weekly = buildCrewWeekText({
  name: 'Garcia, Jose', dates: week, jobs: [job, other], allocations, assignments,
  defaultStart: 'Shop 6:30 AM',
})
assert.match(weekly.text, /^Jose Garcia\nWeek of 2026-09-07 through 2026-09-13/)
assert.match(weekly.text, /SUNDAY, SEP 13/)
assert.match(weekly.text, /With: Mike Jones/)
assert.doesNotMatch(weekly.text, /UPDATED CREW SCHEDULE|OFF — MAY CHANGE/)

const alone = buildCrewMidweekText({
  name: 'Garcia, Jose', dates: [week[4]], jobs: [job],
  allocations: { 1: allocations[1] },
  assignments: [{ job_id: 1, date: week[4], crew_name: 'Garcia, Jose', mobilization_id: 'burnish' }],
})
assert.match(alone.text, /FRI 9\/11 — JOB #1842$/)
assert.doesNotMatch(alone.text, / with /)

const multiple = buildCrewMidweekText({
  name: 'Garcia, Jose', dates: [week[4]], jobs: [job, other],
  allocations: {
    1: { 1: { id: 'burnish', seq: 1, label: 'Burnish', start_date: week[4], end_date: week[4] } },
    2: { 1: { id: 'second', seq: 1, label: 'Second', start_date: week[4], end_date: week[4] } },
  },
  assignments: [
    { job_id: 1, date: week[4], crew_name: 'Garcia, Jose', mobilization_id: 'burnish' },
    { job_id: 1, date: week[4], crew_name: 'Jones, Mike', mobilization_id: 'burnish' },
    { job_id: 2, date: week[4], crew_name: 'Garcia, Jose', mobilization_id: 'second' },
  ],
})
assert.match(multiple.text, /FRI 9\/11 — JOB #1842 — with Mike Jones\nFRI 9\/11 — JOB #1906$/)

const missing = buildCrewMidweekText({
  name: 'Garcia, Jose', dates: [week[4]], jobs: [], allocations: {},
  assignments: [{ job_id: 1, date: week[4], crew_name: 'Garcia, Jose', mobilization_id: 'burnish' }],
})
assert.match(missing.text, /FRI 9\/11 — Job details unavailable$/)

const inferred = buildCrewMidweekText({
  name: 'Garcia, Jose', dates: week.slice(1, 5), jobs: [job], allocations, assignments: [],
  statuses: [{ crew_name: 'Garcia, Jose', date: week[2], status: 'off' }],
})
assert.doesNotMatch(inferred.text, /OFF — MAY CHANGE|WED 9\/9|JOB #/)
assert.match(inferred.text, /^UPDATED CREW SCHEDULE — ABBREVIATED\nJose Garcia\nCurrent schedule from today forward\. Schedule may change as jobs shift\.$/)

const unlinked = buildCrewMidweekText({
  name: 'Garcia, Jose', dates: [week[4]], jobs: [{ ...job, job_num: '⚠ 1842' }],
  allocations: {},
  assignments: [
    { job_id: 1, date: week[4], crew_name: 'Garcia, Jose' },
    { job_id: 1, date: week[4], crew_name: 'Jones, Mike' },
  ],
})
assert.match(unlinked.text, /FRI 9\/11 — JOB #1842$/)
assert.doesNotMatch(unlinked.text, /with Mike Jones/)

console.log('PASS: midweek today–Friday window, compact lines, assignment-over-off, no inferred off, weekly text unchanged')
