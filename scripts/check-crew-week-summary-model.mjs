import assert from 'node:assert/strict'
import { crewWeekSummary } from '../src/schedule/lib/crewWeekSummary.js'
const dates = ['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17']
const job = {job_id:1,call_log_id:10,crew_needed:4,start_date:'2026-08-03',end_date:'2026-08-05'}
const trip = {id:'a',seq:1,label:'Return trip',start_date:dates[0],end_date:dates[1],crew_needed:4}
const rows = [0,1,2].map(n=>({job_id:1,date:dates[0],crew_name:`Person ${n}`}))
rows.push(...[0,1].map(n=>({job_id:1,date:dates[1],crew_name:`Person ${n}`})),rows[0])
let result = crewWeekSummary([job],{1:[trip]},rows,dates)
assert.equal(result.starting.length,1)
assert.equal(result.ending.length,1)
assert.equal(result.needing.length,1)
assert.deepEqual(result.needing[0].details.map(d=>d.short),[1,2])
assert.equal(result.unknown.length,0)
result = crewWeekSummary([job],{1:[{...trip,crew_needed:0}]},[],dates)
assert.equal(result.needing.length,0,'Explicit zero is fully staffed without assignments')
result = crewWeekSummary([job],{1:[{...trip,crew_needed:''}]},[],dates)
assert.equal(result.needing[0].details[0].needed,4,'Blank inherits the parent')
result = crewWeekSummary([{...job,crew_needed:null}],{1:[{...trip,crew_needed:null}]},[],dates)
assert.equal(result.needing.length,0)
assert.equal(result.unknown.length,1,'Unknown is not a known shortage or a fully staffed claim')
result = crewWeekSummary([job],{1:[trip,{...trip,id:'b',seq:2,label:'Second trip'}]},[],dates)
assert.equal(result.starting.length,1,'Multiple trips still count as one job')
assert.equal(result.needing.length,1,'Overlapping trips retain known requirements and count as one job')
assert.equal(result.unknown.length,0,'Overlap alone is not an unknown requirement after B110')
assert.deepEqual(result.needing[0].details.map(d=>d.trip.id),['a','a','b','b'])
result = crewWeekSummary([job,{...job,job_id:2}],{1:[trip],2:[{...trip,id:'b'}]},[],dates)
assert.equal(result.starting.length,1,'Rows sharing a Sales job count once')
assert.equal(result.needing.length,1)
result = crewWeekSummary([{...job,call_log_id:null},{...job,job_id:2,call_log_id:null}],{1:[trip],2:[trip]},[],dates)
assert.equal(result.starting.length,2,'Unlinked jobs remain distinct')
result = crewWeekSummary([{...job,start_date:dates[0],end_date:dates[1]}],{1:[trip]},[],dates)
assert.equal(result.starting[0].details.length,1,'Identical parent and trip spans are not listed twice')
result = crewWeekSummary([{...job,start_date:dates[0],end_date:dates[2]}],{},[],dates)
assert.equal(result.starting.length,1,'Parent-only plans count')
result = crewWeekSummary([job],{1:[{...trip,start_date:'2026-10-05',end_date:'2026-10-23'}]},[],dates)
assert.equal(result.starting.length,0)
assert.equal(result.ending.length,0)
assert.equal(result.needing[0].details.length,6,'Spanning trips still need daily staffing')
result = crewWeekSummary([job],{},rows,dates)
assert.equal(result.starting.length,0,'Crew history must not invent planned trips')
assert.equal(result.needing.length,0)
console.log('Crew week summary: return trips, parent plans, deduplication, daily shortages, zero/inherit/unknown and overlap checks passed.')
// A missing target is not missing crew (10062 preview feedback).
const historicalDates=['2026-08-31','2026-09-01','2026-09-02','2026-09-03']
const historicalCrew=historicalDates.flatMap((date,index)=>Array.from({length:index===3?3:2},(_,n)=>({job_id:1081,date,crew_name:`Crew ${n}`})))
result=crewWeekSummary([{job_id:1081,call_log_id:3521,crew_needed:null}],{1081:[{id:'schommers',seq:4,start_date:historicalDates[0],end_date:historicalDates[3],crew_needed:null}]},historicalCrew,historicalDates)
assert.equal(result.needing.length,0,'Missing historical target must not claim a shortage')
assert.deepEqual(result.unknown[0].details.map(d=>d.assigned),[2,2,2,3],'Keep the recorded staffing visible')
console.log('PASS historical missing targets preserve recorded crew counts and do not become known shortages.')

// Per-trip assignment identity: filling one trip must not fill its sibling.
const overlapTrips=[{...trip,crew_needed:1},{...trip,id:'b',seq:2,crew_needed:1}]
const linked=[{job_id:1,date:dates[0],crew_name:'Same person',mobilization_id:'a'},
  {job_id:1,date:dates[0],crew_name:'Unidentified person',mobilization_id:null}]
result=crewWeekSummary([job],{1:overlapTrips},linked,dates)
assert.equal(result.needing[0].details.find(d=>d.trip.id==='b'&&d.date===dates[0]).assigned,0)
assert.equal(result.needing[0].details.some(d=>d.trip.id==='a'&&d.date===dates[0]),false)
assert.equal(result.unknown.length,0,'Unidentified crew history does not invent a missing requirement')
linked.push({job_id:1,date:dates[0],crew_name:'Same person',mobilization_id:'b'})
result=crewWeekSummary([job],{1:overlapTrips},linked,dates)
assert(result.needing[0].details.every(d=>d.date===dates[1]),'Each trip uses its own linked assignment')
console.log('PASS overlapping trip requirements, UUID assignment isolation, and conservative legacy attribution match the board.')
