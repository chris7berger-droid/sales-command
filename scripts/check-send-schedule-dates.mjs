// Execute the real send handler against an in-memory database boundary.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { buildJobTrips } from '../src/schedule/lib/trips.js'
import { jobRanges } from '../src/schedule/lib/allocations.js'
const source = readFileSync(new URL('../src/components/ProposalDetail.jsx', import.meta.url), 'utf8')
const handler = source.slice(source.indexOf('  async function commitSendToSchedule('), source.indexOf('  async function handleInternalApprove()'))
assert(handler.includes('setSentToSchedule(true)'))
for (const mobilizations of [
  [{ id: 'mob1', seq: 1, label: 'First visit', start_date: null, end_date: null }],
  [{ id: 'mob1', seq: 1, label: 'First visit', start_date: '2026-10-12', end_date: '2026-10-14' }, { id: 'mob2', seq: 2, label: 'Return', start_date: '2026-11-02', end_date: '2026-11-04' }],
]) {
  const wtcList = [false, true].map((dates_tbd, i) => ({ id: `wtc${i}`, work_type_id: i + 1, work_types: { name: 'Demo' }, dates_tbd,
    start_date: '2026-09-28', end_date: '2026-10-02', sales_sow: 'Preserve sold scope',
    field_sow: [{ date: '2026-09-28', mobilization_id: 'mob1', tasks: ['Prepare floor'], materials: [{ name: 'Primer', qty: 2 }] }],
  }))
  const before = JSON.stringify({ wtcList, mobilizations })
  const writes = [], notices = []
  let sent = false
  const supabase = { from(table) {
    const call = { table, method: 'read', payload: null }
    const q = new Proxy({}, { get(_target, key) {
      if (key === 'then') return resolve => {
        if (call.method !== 'read') writes.push(structuredClone(call))
        const data = table === 'jobs' && call.method === 'insert' ? [{ job_id: 1280, status: 'Parked' }]
          : table === 'job_wtcs' && call.method === 'upsert' ? call.payload : []
        resolve({ data, error: null })
      }
      return (...args) => { if (['insert', 'upsert', 'update', 'delete'].includes(key)) { call.method = key; call.payload = args[0] }; return q }
    } })
    return q
  } }
  const context = vm.createContext({ supabase, sendReview: { wtcList, mobilizations, mobById: new Map(mobilizations.map(m => [m.id, m.seq])), failures: [] },
    p: { id: 'proposal', call_log_id: 3803, call_log: { display_job_number: '10227', job_name: 'Demo' }, total: 100 },
    calcBidStamp: () => ({ total: 100 }), usesExactPricing: () => false,
    setSendingToSchedule() {}, setShowSendReview() {}, refreshAlerts() {}, setSentToSchedule(value) { sent = value }, alert(message) { notices.push(message) }, console,
  })
  await vm.runInContext(`${handler}\ncommitSendToSchedule(sendReview)`, context)
  assert.deepEqual(notices, [])
  assert(sent)
  const job = writes.find(w => w.table === 'jobs').payload[0]
  assert(!('sow' in job), 'Customer-facing Sales SOW must not transfer to Schedule')
  const wtcs = writes.find(w => w.table === 'job_wtcs').payload
  const mobs = writes.find(w => w.table === 'job_mobilizations').payload
  for (const field of ['start_date', 'end_date', 'scheduled_start', 'scheduled_end']) assert.equal(job[field], null)
  for (const wtc of wtcs) { assert.equal(wtc.start_date, null); assert.equal(wtc.end_date, null) }
  for (const day of [...job.field_sow, ...wtcs.flatMap(w => w.field_sow)]) {
    assert.equal(day.date, null); assert.equal(day.mobilization_seq, 1); assert(!('mobilization_id' in day))
    assert.deepEqual(day.tasks, ['Prepare floor']); assert.deepEqual(day.materials, [{ name: 'Primer', qty: 2 }])
  }
  assert.equal(JSON.stringify({ wtcList, mobilizations }), before, 'Sales proposal stays unchanged')
  assert.deepEqual(mobs.map(m => [m.start_date, m.end_date]), mobilizations.map(m => [m.start_date, m.end_date]))
  assert.equal(buildJobTrips(mobs, [], job).length, mobilizations.length, 'No extra parent schedule entry')
  assert(!buildJobTrips(mobs, [], job).some(t => t.parent))
  assert.equal(jobRanges(job, mobs).length, mobilizations.filter(m => m.start_date || m.end_date).length)
  const editedJob = { ...job, scheduled_start: '2026-12-01', scheduled_end: '2026-12-02' }
  assert.equal(buildJobTrips(mobs, [], editedJob).length, mobs.length, 'Parent reference dates do not create an extra trip when saved trips exist')
}
console.log('PASS real send handler: tentative and Sales day dates do not schedule work; mobilization dates, scope, links, and later Schedule edits remain intact.')
