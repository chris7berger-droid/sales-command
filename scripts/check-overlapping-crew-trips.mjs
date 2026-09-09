// Actual React board with intercepted Supabase requests; no live database traffic.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.VITE_SUPABASE_URL = 'https://schedule-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'codex-fixture-only'
const root = resolve('.')
const server = await createServer({ root, cacheDir: '/private/tmp/sales-command-overlap-vite-cache', server: { host: '127.0.0.1', port: 5197, strictPort: true }, plugins: [{
  name: 'overlap-harness',
  resolveId(id) { if (id === 'virtual:overlap') return '\0overlap' },
  load(id) {
    if (id !== '\0overlap') return
    return `import React from 'react';import {createRoot} from 'react-dom/client';
      import {MemoryRouter} from 'react-router-dom';import Schedule from '/src/schedule/views/Schedule.jsx';
      import {ToastProvider} from '/src/schedule/lib/toast.jsx';import {UserProvider} from '/src/schedule/lib/user.jsx';
      import '/src/schedule/App.css';import '/src/schedule/index.css';import {GLOBAL_CSS} from '/src/lib/tokens.js';document.head.appendChild(Object.assign(document.createElement('style'),{textContent:GLOBAL_CSS}));
      createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/schedule/schedule?job=1150&week=2026-09-28&trip=short']},React.createElement(UserProvider,{teamMember:{name:'Fixture',role:'Admin'}},React.createElement(ToastProvider,null,React.createElement('div',{className:'schedule-root'},React.createElement(Schedule))))));`
  },
  configureServer(vite) { vite.middlewares.use('/__overlap', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end(await vite.transformIndexHtml('/__overlap', '<html><body><div id="root"></div><script type="module">import "virtual:overlap"</script></body></html>'))
  }) },
}] })
const job = { job_id: 1150, call_log_id: 3791, job_num: '7215', job_name: 'STY 4', status: 'Ongoing', deleted: 'No', lead: 'Bash Dave', crew_needed: 4, start_date: '2026-08-22', end_date: '2026-10-02', job_wtcs: [] }
const trips = [
  { id: 'wide', job_id: 1150, seq: 1, label: 'Google', start_date: job.start_date, end_date: job.end_date },
  { id: 'short', job_id: 1150, seq: 2, label: 'WTC 1 - Concrete Sealing', start_date: '2026-09-28', end_date: '2026-09-29', crew_needed: 2, lead: 'Smith, Jane' },
]
let assignments = [], id = 1, failSave = false
const writes = [], errors = []
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00-07:00'))
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.hostname === '127.0.0.1') return route.continue()
    if (url.hostname !== 'schedule-fixture.supabase.co') return route.abort()
    const table = url.pathname.split('/').pop()
    const send = (data, status = 200) => route.fulfill({ status, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(data) })
    if (req.method() === 'OPTIONS') return send([])
    const matches = row => [...url.searchParams].every(([key, val]) => {
      if (val.startsWith('eq.')) return String(row[key]) === val.slice(3)
      if (val.startsWith('in.')) return val.slice(3).replace(/^\(|\)$/g, '').split(',').includes(String(row[key]))
      if (val.startsWith('gte.')) return row[key] >= val.slice(4)
      if (val.startsWith('lte.')) return row[key] <= val.slice(4)
      return true
    })
    if (req.method() !== 'GET') {
      const payload = req.postData() ? req.postDataJSON() : null
      writes.push({ table, method: req.method(), payload, query: url.search })
      if (failSave) return send({ message: 'Fixture save failure' }, 400)
      if (table === 'assignments') {
        if (req.method() === 'POST') { const added = payload.map(a => ({ ...a, id: id++ })); assignments.push(...added); return send(added) }
        if (req.method() === 'DELETE') { const deleted = assignments.filter(matches); assignments = assignments.filter(a => !matches(a)); return send(deleted) }
      }
      if (table === 'job_mobilizations' && req.method() === 'PATCH') { const trip = trips.find(matches); Object.assign(trip, payload); return send(trip) }
      return send([])
    }
    if (table === 'jobs') return send(req.headers().accept?.includes('vnd.pgrst.object') ? job : [job])
    if (table === 'job_mobilizations') return send(trips.filter(matches))
    if (table === 'assignments') return send(assignments.filter(matches))
    if (table === 'crew') return send([{ name: 'Bash Dave', team: '1', archived: false }, { name: 'Smith, Jane', team: '1', archived: false }])
    return send([])
  })
  await page.goto('http://127.0.0.1:5197/__overlap')
  const wide = page.locator('[data-trip-row="wide"]'), short = page.locator('[data-trip-row="short"]')
  await short.waitFor()
  assert.equal(await short.locator('.sch-label-focused').count(), 1)
  assert.equal(await wide.locator('.sch-label-focused').count(), 0)
  console.log('PASS future-week trip deep link highlights only its exact trip among overlapping rows.')
  assert.equal(await page.locator('.sch-board-row-wrap').count(), 2)
  assert.equal(await wide.locator('.sch-brd-needs-crew').count(), 5)
  assert.equal(await short.locator('.sch-brd-needs-crew').count(), 2)
  assert.match(await wide.locator('.sch-brd-crew-info').innerText(), /0\/4 crew/)
  assert.match(await short.locator('.sch-brd-crew-info').innerText(), /0\/2 crew/)
  await short.locator('.sch-brd-job-label').click()
  assert.equal(await short.getByRole('textbox', { name: 'Trip title', exact: true }).inputValue(), 'WTC 1 - Concrete Sealing')
  await short.getByRole('textbox', { name: 'Trip title', exact: true }).fill('Sealing return')
  await short.getByRole('button', { name: 'Save trip' }).click()
  await page.waitForFunction(() => document.querySelector('[data-trip-row="short"] .sch-trip-label strong')?.textContent === 'Sealing return')
  assert.equal(trips[0].label, 'Google')
  assert.equal(writes.filter(w => w.table === 'jobs').length, 0)
  // Assign the same person on both trips, then remove from just the short trip.
  async function assign(row, expectedDays) {
    await page.locator('.sch-chip').filter({ hasText: 'Bash Dave' }).dragTo(row.locator('.sch-brd-cell').first())
    const modal = page.locator('.sch-modal')
    await modal.waitFor()
    await modal.getByRole('button', { name: `Select all ${expectedDays}` }).click()
    await modal.getByRole('button', { name: 'Assign', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
  }
  await assign(wide, 5)
  await assign(short, 2)
  assert.equal(assignments.filter(a => a.mobilization_id === 'wide').length, 5)
  assert.equal(assignments.filter(a => a.mobilization_id === 'short').length, 2)
  assert.equal(await short.locator('.sch-brd-cnt').first().innerText(), '1')
  assert.equal(await wide.locator('.sch-brd-cnt').first().innerText(), '1')
  // B109 integration: unique people in daily capacity, trip-specific shortages
  // in the popup, and one job count even when both overlapping trips need crew.
  const needs = page.getByRole('button', { name: /Jobs Needing Crew/ })
  assert.equal(await needs.locator('.hcs-badge-circle').innerText(), '1')
  assert.equal(await page.locator('.hcs-day-count').first().innerText(), '1 / 2')
  await needs.click()
  let summary = page.getByRole('dialog', { name: 'Jobs Needing Crew' })
  assert.match(await summary.innerText(), /1 \/ 4 assigned · needs 3 more/)
  assert.match(await summary.innerText(), /1 \/ 2 assigned · needs 1 more/)
  await summary.getByRole('button', { name: 'Close', exact: true }).click()
  await short.locator('.sch-tg-x').click()
  await page.waitForFunction(() => document.querySelector('[data-trip-row="short"] .sch-brd-crew-info')?.textContent.includes('0/2'))
  assert.equal(assignments.length, 5)
  assert(assignments.every(a => a.mobilization_id === 'wide'))
  await needs.click()
  summary = page.getByRole('dialog', { name: 'Jobs Needing Crew' })
  assert.match(await summary.innerText(), /0 \/ 2 assigned · needs 2 more/)
  assert.match(await summary.innerText(), /1 \/ 4 assigned · needs 3 more/)
  await summary.getByRole('button', { name: 'Close', exact: true }).click()

  const removal = writes.find(w => w.method === 'DELETE')
  assert.match(removal.query, /id=in/)
  // Failed writes stay visible and do not change the other trip.
  failSave = true
  await page.locator('.sch-chip').filter({ hasText: 'Bash Dave' }).dragTo(short.locator('.sch-brd-cell').first())
  await page.locator('.sch-modal').getByRole('button', { name: 'Select all 2' }).click()
  await page.locator('.sch-modal').getByRole('button', { name: 'Assign', exact: true }).click()
  await page.getByText('Fixture save failure', { exact: true }).waitFor()
  assert.equal(assignments.length, 5)
  await page.locator('.sch-modal').getByRole('button', { name: 'Cancel', exact: true }).click()
  failSave = false
  // Legacy ambiguous days remain visible once, without filling both trips.
  assignments.push({ id: id++, job_id: 1150, crew_name: 'Smith, Jane', date: '2026-09-28', mobilization_id: null })
  await page.reload()
  await page.locator('[data-trip-row="unidentified"]').waitFor()
  assert.equal(await page.locator('.sch-board-row-wrap').count(), 3)
  assert.match(await short.locator('.sch-brd-crew-info').innerText(), /0\/2/)
  await page.screenshot({ path: '/private/tmp/overlapping-crew-trips-fixed.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: actual board nested trips, edit identity, linked assignment, sibling-safe removal, failure, reload and legacy visibility')
} finally { await browser?.close(); await server.close() }
