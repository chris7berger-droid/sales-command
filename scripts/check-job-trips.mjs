// Real job-row -> Trips -> existing editor, with stateful intercepted Supabase calls.
// No credentials, real DB access, or live writes. Optional TRIPS_SNAPSHOT is read-only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { buildJobTrips } from '../src/schedule/lib/trips.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.VITE_SUPABASE_URL = 'https://schedule-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'codex-fixture-only'
const job = { job_id: 1150, job_num: '7215', job_name: 'STY 4', customer: 'Contract Flooring', status: 'Ongoing', start_date: '2026-08-03', end_date: '2026-08-05', lead: null, crew_needed: null, vehicle: 'Job truck', field_sow: [], _wtcs: [] }
const base = { job_id: 1150, is_go_back: false, lead: null, crew_needed: null, vehicle: null, equipment: null, power_source: null, sow: null, note: null }
let rows = [
  { ...base, id: 'past', seq: 1, label: 'First visit', start_date: '2026-08-03', end_date: '2026-08-05' },
  { ...base, id: 'multiweek', seq: 2, label: 'Google', start_date: '2026-08-22', end_date: '2026-10-02' },
  { ...base, id: 'future', seq: 5, label: 'WTC1 - Concrete Sealing', start_date: '2026-10-12', end_date: '2026-10-13', lead: 'Bash Dave', crew_needed: 3, vehicle: 'Truck 2', equipment: 'Grinder', power_source: 'Generator', sow: 'Seal the concrete.\n'.repeat(100), note: 'North entrance', mob_type: 'unconfirmed' },
  { ...base, id: 'undated', seq: 6, label: 'Return visit', start_date: null, end_date: null, is_go_back: true },
]
let assignments = [
  { id: 1, job_id: 1150, date: '2026-08-22', crew_name: 'Bash Dave', mobilization_id: 'multiweek' },
  { id: 2, job_id: 1150, date: '2026-09-10', crew_name: 'Bash Dave', mobilization_id: 'multiweek' },
  { id: 3, job_id: 1150, date: '2026-07-03', crew_name: 'Older crew', mobilization_id: null },
  { id: 4, job_id: 1150, date: '2026-07-06', crew_name: 'Older crew', mobilization_id: null },
]
if (process.env.TRIPS_SNAPSHOT) {
  const data = JSON.parse(readFileSync(process.env.TRIPS_SNAPSHOT, 'utf8')).rows[0].trip_data
  if (data.job) Object.assign(job, data.job)
  else { for (const field of ['vehicle', 'equipment', 'power_source', 'sow']) job[field] = null }
  rows = data.allocations; assignments = data.crew_days.map((a, i) => ({ ...a, id: i, job_id: 1150 }))
}
const server = await createServer({ server: { host: '127.0.0.1', port: 5191, strictPort: true }, plugins: [{
  name: 'trips-test',
  resolveId(id) { if (id === 'virtual:trips-test') return '\0trips-test' },
  load(id) {
    if (id !== '\0trips-test') return
    return `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,useLocation} from 'react-router-dom';
    import StageJobCard from '/src/schedule/components/StageJobCard.jsx';import {UserProvider} from '/src/schedule/lib/user.jsx';
    import '/src/schedule/App.css';import '/src/schedule/index.css';
    function Harness(){const [job,setJob]=React.useState(${JSON.stringify(job)});window.tripSetJob=setJob;const [cardInputs,setCardInputs]=React.useState({});window.setCardInputs=setCardInputs;window.tripPath=useLocation().pathname+useLocation().search;return React.createElement(StageJobCard,{...cardInputs,job,stage:'active',autoOpen:true,onJobUpdate:()=>setJob(j=>({...j}))})}
    createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/schedule/jobs']},React.createElement(UserProvider,{teamMember:{name:'Codex test'}},React.createElement(Harness))));`
  },
  configureServer(vite) { vite.middlewares.use('/__trips-test', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html');res.end(await vite.transformIndexHtml('/__trips-test', '<html><body><div class="schedule-root" style="padding:20px;min-height:100vh"><div id="root"></div></div><script type="module">import "virtual:trips-test"</script></body></html>'))
  }) },
}] })
await server.listen()
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
page.setDefaultTimeout(10000)
await page.clock.setFixedTime(new Date('2026-09-08T12:00:00-07:00'))
const runtimeErrors = [], mutations = []
let failRead = false, failSave = false, failCrew = false
page.on('pageerror', e => runtimeErrors.push(e.message))
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url())
  if (url.hostname === '127.0.0.1') return route.continue()
  if (url.hostname !== 'schedule-fixture.supabase.co') return route.abort()
  const table = url.pathname.split('/').pop()
  const send = (data, status = 200) => route.fulfill({ status, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(data) })
  if (req.method() === 'OPTIONS') return send([])
  if (req.method() !== 'GET') {
    const payload = req.postDataJSON();mutations.push({ table, payload, method: req.method(), query: url.searchParams.toString() })
    if (process.env.TRIPS_SNAPSHOT) throw new Error('Snapshot mode must never write')
    if (table === 'job_mobilizations' && req.method() === 'POST') {
      const row = { ...base, ...payload, id: 'added-trip' };rows.push(row);return send(row)
    }
    if (table === 'job_mobilizations' && req.method() === 'PATCH') {
      if (failSave) return send({ message: 'Fixture save failed' }, 400)
      const row = rows.find(r => `eq.${r.id}` === url.searchParams.get('id') && `eq.${r.job_id}` === url.searchParams.get('job_id'))
      if (!row) return send({ message: 'Trip no longer belongs to this job' }, 406)
      Object.assign(row, payload);return send(row)
    }
    if (table === 'job_mobilizations' && req.method() === 'DELETE') {
      const removed = rows.filter(r => `eq.${r.id}` === url.searchParams.get('id') && `eq.${r.job_id}` === url.searchParams.get('job_id'))
      rows = rows.filter(r => !removed.includes(r)); return send(removed.map(r => ({ id: r.id })))
    }
    return send([])
  }
  if (table === 'jobs') return send({ ...job, call_log_id: 3791, merged_into_job_id: null, deleted: 'No' })
  if (table === 'crew') {
    assert.equal(url.searchParams.get('select'), 'name,archived', 'Crew has no id column')
    if (failCrew) return send({ message: 'Fixture crew unavailable' }, 400)
    return send([{ name: 'Bash Dave', archived: false }, { name: 'Smith, Jane', archived: false }, { name: 'Archived crew', archived: true }])
  }
  if (table === 'team_members') throw new Error('Trip editor must use Scheduling crew, not Sales team')
  if (table === 'job_mobilizations' || table === 'assignments') {
    assert.equal(url.searchParams.get('job_id'), 'eq.1150', 'Every trip/assignment read must be scoped to this job')
    if (failRead && table === 'assignments') return send({ message: 'Fixture read failed' }, 400)
    return send(table === 'job_mobilizations' ? rows : assignments.filter(a => !url.searchParams.has('mobilization_id') || `eq.${a.mobilization_id}` === url.searchParams.get('mobilization_id')))
  }
  return send([])
})
const article = id => page.locator(`[data-trip-id="${id}"]`)
async function openTrips() { await page.getByRole('button', { name: 'TRIPS', exact: true }).click();await page.locator('.job-trip').first().waitFor() }
try {
  await page.goto('http://127.0.0.1:5191/__trips-test')
  if (!process.env.TRIPS_SNAPSHOT) {
    await page.getByRole('button', { name: 'PLANNING', exact: true }).click()
    await page.evaluate(() => {
      window.tripSetJob(j => ({ ...j, start_date: null, end_date: null, call_log_id: 3791 }))
      window.setCardInputs({ mobsByJobId: { 1150: { 2: { id: 'card-trip', seq: 2, start_date: '2026-09-28', end_date: '2026-10-30', crew_needed: 3 } } }, crewByCallLog: { 3791: [{name:'A'}, {name:'B'}, {name:'C'}] }, assignmentsByJobId: { 1150: new Set(['2026-10-03','2026-10-10','2026-10-17']) } })
    })
    await page.locator('.sjc-score').filter({ hasText: 'DAYS' }).getByText('28d', { exact: true }).waitFor()
    await page.locator('.sjc-score').filter({ hasText: 'CREW' }).getByText('3 / 3', { exact: true }).waitFor()
    await page.locator('.sjc-score').filter({ hasText: 'CREW' }).click()
    await page.waitForFunction(() => window.tripPath === '/schedule/schedule?job=1150&week=2026-09-28&trip=card-trip')
    await page.locator('.sjc-score').filter({ hasText: 'DAYS' }).click()
    const calendar = page.getByRole('dialog', { name: 'Job schedule calendar' })
    await calendar.waitFor()
    assert.equal(await calendar.locator('.days-cal-on').count(), 28)
    await calendar.getByText('September 2026', { exact: true }).waitFor()
    await calendar.getByText('October 2026', { exact: true }).waitFor()
    await calendar.getByRole('button', { name: 'Close', exact: true }).click()
    await calendar.waitFor({ state: 'hidden' })
    console.log('PASS Planning DAYS opens original calendar with 28 highlighted trip/assigned-weekend dates across September and October.')
    await page.reload()
  }
  await openTrips()
  if (process.env.TRIPS_SNAPSHOT) {
    const future = article('45ad5024-45e2-4cdf-a470-d7f50835df05')
    assert.match(await future.innerText(), /Oct 12, 2026 – Oct 13, 2026/)
    const expected = buildJobTrips(rows, assignments, job)
    const expectedFuture = expected.find(t => t.id === '45ad5024-45e2-4cdf-a470-d7f50835df05')
    const people = new Set(expectedFuture.assignments.map(a => a.crew_name)).size
    assert.match(await future.innerText(), people ? new RegExp(`${people} people`) : /No crew assigned yet/)
    assert.equal(expected.flatMap(t => t.assignments).length, assignments.length)
    assert.equal(await page.locator('.job-trip').count(), expected.length)
    assert.equal(await page.locator('.job-trip:not([data-trip-id^="legacy:"]):not([data-trip-id^="job:"])').count(), rows.length)
    for (const row of rows) assert.equal(await article(row.id).count(), 1)
    await future.locator('button.job-trip-summary').click()
    assert.match(await future.innerText(), /Bash Dave/)
    await page.screenshot({ path: '/private/tmp/codex-trips-live-snapshot.png', fullPage: true })
    assert.equal(mutations.length, 0)
    console.log('PASS job 7215 real-data snapshot: all saved trips once, October dates/lead/staffing visible; no crew records lost or duplicated; no writes.')
  } else {
    assert.equal(await page.locator('.job-trip').count(), 5)
    assert.equal(await page.getByRole('region', { name: 'Upcoming', exact: true }).locator('.job-trip').count(), 1)
    assert.equal(await page.getByRole('region', { name: 'Current dates', exact: true }).locator('.job-trip').count(), 1)
    assert.equal(await page.getByRole('region', { name: 'Dates to set', exact: true }).locator('.job-trip').count(), 1)
    assert.match(await article('multiweek').innerText(), /Aug 22, 2026 – Oct 2, 2026/)
    assert.match(await article('future').innerText(), /No crew assigned yet/)
    await article('future').locator('button.job-trip-summary').click()
    assert.match(await article('future').innerText(), /Seal the concrete\./)
    assert.match(await article('future').innerText(), /North entrance/)
    assert(await article('future').locator('.job-trip-sow').evaluate(e => e.clientHeight <= 180 && e.scrollHeight > e.clientHeight), 'Long SOW must scroll within its panel')
    await article('future').getByRole('button', { name: 'Edit trip', exact: true }).click()
    await page.getByRole('textbox', { name: 'Trip label', exact: true }).waitFor()
    assert.equal(await page.getByLabel('Vehicle', { exact: true }).inputValue(), 'Truck 2')
    assert.equal(await page.getByLabel('Trip notes', { exact: true }).inputValue(), 'North entrance')
    await page.getByRole('combobox', { name: 'Lead', exact: true }).selectOption('Bash Dave')
    assert.equal(await page.locator('option').filter({ hasText: 'Archived crew' }).count(), 0)
    assert.equal(await page.getByRole('textbox', { name: 'Scope of work', exact: true }).evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(243, 237, 224)')
    await page.screenshot({ path: '/private/tmp/codex-trips-editor.png', fullPage: true })
    await page.getByLabel('End date', { exact: true }).fill('2026-10-11')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('End date can’t be before the start date.').waitFor()
    assert.equal(mutations.length, 0)
    await page.getByLabel('End date', { exact: true }).fill('2026-10-14')
    failSave = true
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Fixture save failed', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('End date', { exact: true }).inputValue(), '2026-10-14')
    failSave = false
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('textbox', { name: 'Trip label', exact: true }).waitFor({ state: 'hidden' })
    await article('future').getByText('Oct 12, 2026 – Oct 14, 2026', { exact: true }).waitFor()
    const patch = mutations.filter(m => m.table === 'job_mobilizations').at(-1).payload
    assert.deepEqual(Object.keys(patch).sort(), ['end_date', 'label', 'start_date'])
    assert.equal(rows.find(r => r.id === 'future').note, 'North entrance')
    assert.equal(rows.find(r => r.id === 'future').mob_type, 'unconfirmed')
    assert.equal(rows.find(r => r.id === 'future').seq, 5)
    console.log('PASS real job-row Trips tab and editor: date-only edit preserves crew, scope, notes, identity/type; bad dates and save failures stay visible.')
    assignments.push({ id: 5, job_id: 1150, date: '2026-10-12', crew_name: 'Bash Dave', mobilization_id: 'future' })
    await page.getByRole('button', { name: 'Refresh trips' }).click()
    await article('future').getByText('1 person · 1 crew date', { exact: true }).waitFor()
    assert.equal(await page.locator('.job-trip').count(), 5)
    assert.equal(await article('future').count(), 1)
    await article('future').getByRole('button', { name: 'Edit trip', exact: true }).click()
    await page.getByLabel('Trip notes', { exact: true }).fill('Use south entrance')
    await page.getByRole('combobox', { name: 'Lead', exact: true }).selectOption('Smith, Jane')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await article('future').getByText('Use south entrance', { exact: true }).waitFor()
    assert.equal(rows.find(r => r.id === 'future').lead, 'Smith, Jane')
    assert.equal(assignments.filter(a => a.mobilization_id === 'future').length, 1)
    await page.reload();await openTrips()
    assert.equal(await page.locator('.job-trip').count(), 5)
    await article('future').locator('button.job-trip-summary').click()
    assert.match(await article('future').innerText(), /Use south entrance/)
    await page.screenshot({ path: '/private/tmp/codex-trips-panel.png', fullPage: true })
    console.log('PASS assigning crew keeps the same trip, saves retain UUID and assignments, and updates survive reload.')
    failRead = true;await page.getByRole('button', { name: 'Refresh trips' }).click()
    await page.getByRole('alert').filter({ hasText: 'Fixture read failed' }).waitFor()
    assert.equal(await page.locator('.job-trip').count(), 0, 'Failed partial load must not display misleading staffing counts')
    failRead = false;await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await article('future').waitFor()
    failCrew = true
    await article('future').getByRole('button', { name: 'Edit trip', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Fixture crew unavailable' }).waitFor()
    assert(await page.getByRole('combobox', { name: 'Lead', exact: true }).isDisabled())
    failCrew = false;await page.getByRole('button', { name: 'Retry crew', exact: true }).click()
    await page.getByRole('combobox', { name: 'Lead', exact: true }).selectOption('Smith, Jane')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    // A Combine/move after opening the editor must not edit a different parent.
    await article('future').getByRole('button', { name: 'Edit trip', exact: true }).click()
    await page.getByLabel('Trip notes', { exact: true }).fill('Must not save')
    rows.find(r => r.id === 'future').job_id = 999
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Trip no longer belongs to this job', { exact: true }).waitFor()
    assert.equal(rows.find(r => r.id === 'future').note, 'Use south entrance')
    rows.find(r => r.id === 'future').job_id = 1150
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    // Cover the older Planning entry point to the same editor, including new trips.
    await page.getByRole('button', { name: 'PLANNING', exact: true }).click()
    await page.getByTitle('Add or edit mobilizations', { exact: true }).click()
    await page.getByRole('button', { name: '+ Add Go Back', exact: true }).click()
    await page.getByLabel('Trip label', { exact: true }).fill('Warranty check')
    await page.getByLabel('Trip notes', { exact: true }).fill('Call before arriving')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: '+ Add Go Back', exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('[aria-label="Trip label"]'))
    const added = rows.find(r => r.id === 'added-trip')
    assert.equal(added.seq, 7);assert.equal(added.is_go_back, true);assert.equal(added.note, 'Call before arriving')
    assert.equal(added.start_date, null)
    await page.getByRole('dialog', { name: 'Manage trips' }).getByRole('button', { name: 'Close', exact: true }).click()
    await article('added-trip').waitFor()
    await page.getByRole('button', { name: 'PLANNING', exact: true }).click()
    console.log('PASS stale moved-trip save rejected; Planning editor still adds a dated-later go-back with its own identity and notes.')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: '/private/tmp/codex-trips-mobile.png', fullPage: true })
    assert(await page.locator('.job-trips').evaluate(e => e.scrollWidth <= e.clientWidth), 'Trips panel must fit mobile width')
    await article('future').getByRole('button', { name: 'Open Crew Schedule' }).click()
    await page.waitForFunction(() => window.tripPath === '/schedule/schedule?job=1150&week=2026-10-12&trip=future')
    console.log('PASS failed reads/retry, crew roster error/retry, responsive panel, and trip-specific Crew Schedule link.')
    // Review gap: first trips also exist as dates on jobs, before a trip row exists.
    rows = [];assignments = []
    Object.assign(job, { start_date: '2026-10-12', end_date: '2026-10-30' })
    await page.evaluate(job => window.tripSetJob(job), job)
    const initial = article('job:1150:initial')
    await initial.waitFor()
    assert.equal(await page.locator('.job-trip').count(), 1)
    assert.match(await initial.innerText(), /Oct 12, 2026 – Oct 30, 2026/)
    assert.match(await initial.innerText(), /No crew assigned yet/)
    assignments = ['2026-10-12', '2026-10-30'].map((date, i) => ({ id: i + 1, job_id: 1150, crew_name: 'Bash Dave', date, mobilization_id: null }))
    await page.getByRole('button', { name: 'Refresh trips' }).click()
    await initial.getByText('1 person · 2 crew dates', { exact: true }).waitFor()
    assert.equal(await page.locator('.job-trip').count(), 1, 'Parent date span must not split when staffing has a long gap')
    await initial.locator('button.job-trip-summary').click()
    assert.match(await initial.innerText(), /dates are saved on the job/)
    assert.equal(await initial.getByRole('button', { name: 'Edit trip', exact: true }).count(), 0, 'Never send a parent-derived trip to the UUID editor')
    await page.setViewportSize({ width: 1440, height: 1050 })
    await page.screenshot({ path: '/private/tmp/codex-review-parent-trip.png', fullPage: true })
    console.log('PASS parent-only trip before crew assignment and after assignments 18 days apart; same span and identity.')
    rows = [{ ...base, id: 'short', seq: 2, label: 'Short visit', start_date: '2026-10-15', end_date: '2026-10-16' }]
    assignments.push({ id: 3, job_id: 1150, date: '2026-10-15', crew_name: 'Smith, Jane', mobilization_id: 'short' })
    await page.getByRole('button', { name: 'Refresh trips' }).click()
    await article('short').waitFor()
    assert.equal(await page.locator('.job-trip').count(), 2)
    assert.match(await initial.innerText(), /Oct 12, 2026 – Oct 30, 2026/)
    assert.match(await initial.innerText(), /1 person · 2 crew dates/)
    assert.match(await article('short').innerText(), /Oct 15, 2026 – Oct 16, 2026/)
    await page.screenshot({ path: '/private/tmp/codex-review-parent-overlap.png', fullPage: true })
    console.log('PASS shorter overlapping trip does not hide or fragment the parent span; linked crew stays on the explicit trip.')
  }
  if (!process.env.TRIPS_SNAPSHOT) {
    await article('short').locator('button.job-trip-summary').click()
    await article('short').getByRole('button', { name: 'Edit trip', exact: true }).click()
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Delete trip', exact: true }).click()
    await page.getByText('This trip has crew assignments.', { exact: false }).waitFor()
    assert(rows.some(r => r.id === 'short'))
    assignments = assignments.filter(a => a.mobilization_id !== 'short')
    const cancelled = new Promise(resolve => page.once('dialog', async d => { await d.dismiss(); resolve() }))
    await page.getByRole('button', { name: 'Delete trip', exact: true }).click()
    await cancelled
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Delete trip' && !b.disabled))
    assert(rows.some(r => r.id === 'short'), 'Cancel preserves trip')
    page.once('dialog', async d => { assert.match(d.message(), /The job and other trips will remain/); await d.accept() })
    await page.getByRole('button', { name: 'Delete trip', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await article('short').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('[data-trip-id="job:1150:initial"]').count(), 1, 'Job schedule remains')
    assert(!mutations.some(m => m.table === 'jobs'), 'Trip deletion must never delete or change the job')
    console.log('PASS scrollable SOW; trip deletion cancel, staffed-trip block, scoped deletion and retained parent schedule.')
  }
  assert.deepEqual(runtimeErrors, [])
  assert(!mutations.some(m => m.table === 'assignments'), 'Editing a trip must not change crew-day assignments')
  console.log('PASS no runtime errors and no real database traffic.')
} finally { await browser.close();await server.close() }
