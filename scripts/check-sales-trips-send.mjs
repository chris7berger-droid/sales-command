// Real direct-send handlers with an in-memory database. No production requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/components/ProposalDetail.jsx', import.meta.url), 'utf8')
const validation = source.slice(source.indexOf('function buildMobValidation('), source.indexOf('function ProposalDetail('))
const handlers = source.slice(source.indexOf('  async function handleSendToSchedule('), source.indexOf('  async function handleInternalApprove('))
const trips = [
  { id: 'prep', seq: 2, label: 'Preparation', start_date: '2026-10-12', end_date: '2026-10-13' },
  { id: 'finish', seq: 7, label: 'Finish', start_date: '2026-10-20', end_date: '2026-10-21' },
]
const wtcs = trips.map((trip, i) => ({
  id: `wtc-${i}`, work_type_id: i + 1, work_types: { name: i ? 'Coating' : 'Demo' },
  sales_sow: `CUSTOMER ONLY ${i}`, start_date: '2026-09-15', end_date: '2026-09-16',
  field_sow: [{ id: `day-${i}`, day_label: `Day ${i + 1}`, date: '2026-09-15', mobilization_id: trip.id,
    scope_notes: `Instructions ${i}`, crew_count: 3, hours_planned: 24, sq_ft: 800, linear_ft: 50,
    tasks: [{ id: `task-${i}`, description: trip.label, pct_complete: 100 }],
    materials: [{ name: `Material ${i}`, qty_planned: 2, specs_confirmed: true }],
  }],
}))

async function run({ mobilizations = trips, wtcList = wtcs, failRead, invoiceOnRead, existing, shortWrite = false } = {}) {
  const before = JSON.stringify({ mobilizations, wtcList })
  const writes = [], notices = []
  let sent = false, busy = false, invoiceReads = 0
  const supabase = { from(table) {
    const call = { table, method: 'read', payload: null, filters: [] }
    const q = new Proxy({}, { get(_target, key) {
      if (key === 'then') return resolve => {
        if (call.method !== 'read') writes.push(structuredClone(call))
        let data = []
        const error = call.method === 'read' && table === failRead ? { message: `Cannot read ${table}` } : null
        if (table === 'invoices' && ++invoiceReads === invoiceOnRead) data = [{ id: 'invoice' }]
        if (table === 'proposals') data = { mobilizations }
        if (table === 'proposal_wtc') data = wtcList
        if (table === 'jobs' && call.method === 'insert') data = [{ job_id: 1280 }]
        if (table === 'jobs' && call.method === 'delete') data = [{ job_id: 1280 }]
        if (table === 'jobs' && call.filters.some(([field, value]) => field === 'deleted' && value === 'No')) data = existing || null
        if (table === 'job_wtcs' && call.method === 'upsert') data = shortWrite ? [] : call.payload
        resolve({ data: error ? null : data, error })
      }
      return (...args) => {
        if (['insert', 'upsert', 'update', 'delete'].includes(key)) { call.method = key; call.payload = args[0] }
        if (key === 'eq') call.filters.push(args)
        return q
      }
    } })
    return q
  } }
  const context = vm.createContext({ supabase,
    p: { id: 'proposal', call_log_id: 3803, call_log: { display_job_number: '10227', job_name: 'Demo' }, total: 100 },
    calcBidStamp: () => ({ total: 100 }), usesExactPricing: () => false,
    setSendingToSchedule(value) { busy = value }, refreshAlerts() {}, setSentToSchedule(value) { sent = value },
    alert(message) { notices.push(message) }, console,
  })
  await vm.runInContext(`${validation}\n${handlers}\nhandleSendToSchedule()`, context)
  assert.equal(busy, false)
  assert.equal(JSON.stringify({ mobilizations, wtcList }), before, 'Sending never rewrites Sales input')
  assert(!writes.some(w => ['assignments', 'proposals', 'proposal_wtc'].includes(w.table)), 'No existing scope or crew writes')
  return { writes, notices, sent }
}

const multi = await run()
assert(multi.sent)
assert.deepEqual(multi.notices, [])
const job = multi.writes.find(w => w.table === 'jobs').payload[0]
assert(!('sow' in job), 'Sales SOW stays on proposal')
assert(!JSON.stringify(multi.writes).includes('CUSTOMER ONLY'))
const copied = multi.writes.find(w => w.table === 'job_wtcs').payload
for (const [i, wtc] of copied.entries()) {
  const { mobilization_id, date, ...content } = wtcs[i].field_sow[0]
  const expected = { ...content, date: null, mobilization_seq: trips[i].seq }
  assert.deepEqual(wtc.field_sow[0], expected, 'Distinct trip scope, task IDs, metrics and materials survive')
  assert.deepEqual(job.field_sow[i], expected)
}
assert.deepEqual(multi.writes.find(w => w.table === 'job_mobilizations').payload.map(m => [m.seq, m.label, m.start_date, m.end_date]), trips.map(m => [m.seq, m.label, m.start_date, m.end_date]))

const unassigned = structuredClone(wtcs.slice(0, 1))
unassigned[0].field_sow[0].mobilization_id = null
const single = await run({ mobilizations: trips.slice(0, 1), wtcList: unassigned })
assert(single.sent)
assert.equal(single.writes.find(w => w.table === 'job_wtcs').payload[0].field_sow[0].mobilization_seq, 2)
const empty = await run({ mobilizations: [], wtcList: [{ ...wtcs[0], field_sow: [] }] })
assert(empty.sent, 'Sales SOW alone needs no trip')
assert(!empty.writes.some(w => w.table === 'job_mobilizations'))

const stale = structuredClone(unassigned)
stale[0].field_sow[0].mobilization_id = 'deleted-trip'
const unconfirmed = structuredClone(wtcs)
unconfirmed[0].field_sow[0].materials[0].specs_confirmed = false
for (const options of [
  { wtcList: unassigned }, { mobilizations: [], wtcList: unassigned },
  { mobilizations: trips.slice(0, 1), wtcList: stale },
  { mobilizations: [{ ...trips[0], label: '  ' }] }, { wtcList: unconfirmed },
  ...['jobs', 'invoices', 'proposals', 'proposal_wtc'].map(failRead => ({ failRead })),
  { invoiceOnRead: 1 }, { invoiceOnRead: 2 }, { existing: { job_id: 99 } },
]) {
  const result = await run(options)
  assert.equal(result.writes.length, 0, `Blocked send must not write: ${JSON.stringify(options)}`)
  assert(result.notices.length > 0)
  assert.equal(result.sent, !!options.existing)
}
const rollback = await run({ shortWrite: true })
assert.equal(rollback.sent, false)
assert(rollback.writes.some(w => w.table === 'jobs' && w.method === 'delete'))
assert(!rollback.writes.some(w => ['job_mobilizations', 'call_log'].includes(w.table)))
console.log('PASS direct send: multiple/single/no trips, distinct Field SOW preserved, no Sales SOW transfer, validation/read failures stop writes, and existing WTC rollback retained.')
