import assert from 'node:assert/strict'
import { createServer } from 'vite'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.VITE_SUPABASE_URL = 'https://schedule-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'fixture-only'
const job = { job_id: 1179, job_num: '10088', job_name: 'Islanders 3 - Durastone Re-Seal', start_date: '2026-09-14', end_date: '2026-09-17' }
const assignments = [24, 25, 26, 27].map(date => ({ id: date * 2, job_id: 1179, crew_name: 'Little, Adam', date: `2026-08-${date}`, mobilization_id: null })).concat([14, 15, 16, 17].flatMap(date => [
  { id: date * 2, job_id: 1179, crew_name: 'Ary, Darrin', date: `2026-09-${date}`, mobilization_id: null },
  { id: date * 2 + 1, job_id: 1179, crew_name: 'Ary, Jesse', date: `2026-09-${date}`, mobilization_id: null },
]))
let trips = [], nextId = 1, writes = []
const server = await createServer({ server: { host: '127.0.0.1', port: 5194, strictPort: true }, plugins: [{
  name: 'conversion-test',
  resolveId(id) { if (id === 'virtual:conversion-test') return '\0conversion-test' },
  load(id) { if (id !== '\0conversion-test') return; return `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import TripsPanel from '/src/schedule/components/TripsPanel.jsx';createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(TripsPanel,{job:${JSON.stringify(job)},today:'2026-09-10'})));` },
  configureServer(vite) { vite.middlewares.use('/__conversion', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__conversion', '<html><body><div id="root"></div><script type="module">import "virtual:conversion-test"</script></body></html>')) }) },
}] })
await server.listen()
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const page = await browser.newPage(); page.setDefaultTimeout(12000)
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()
  if (url.hostname === '127.0.0.1') return route.continue()
  if (url.hostname !== 'schedule-fixture.supabase.co') return route.abort()
  const send = data => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(data) })
  if (req.method() === 'OPTIONS') return send([])
  if (table === 'job_mobilizations' && req.method() === 'POST') {
    const body = req.postDataJSON(); const row = { ...body, id: `trip-${nextId++}` }; trips.push(row); writes.push({ table, method: req.method(), row }); return send([{ id: row.id }])
  }
  if (table === 'assignments' && req.method() === 'PATCH') {
    const body = req.postDataJSON(); const ids = [...url.searchParams].find(([k]) => k === 'id')?.[1]?.slice(3).split(',') || []
    assignments.forEach(a => { if (ids.includes(String(a.id))) a.mobilization_id = body.mobilization_id }); writes.push({ table, method: req.method(), ids }); return send([])
  }
  if (table === 'job_mobilizations') return send(trips)
  if (table === 'assignments') return send(assignments)
  return send([])
})
try {
  await page.goto('http://127.0.0.1:5194/__conversion')
  await page.locator('.job-trip').first().waitFor()
  assert.equal(await page.locator('.job-trip').count(), 2)
  assert.equal(await page.locator('[data-trip-id^="legacy:"]').count(), 0)
  assert.match(await page.locator('.job-trip').nth(0).locator('.job-trip-title').innerText(), /Trip 1.*Aug 24, 2026 – Aug 27, 2026/s)
  assert.match(await page.locator('.job-trip').nth(1).locator('.job-trip-title').innerText(), /Trip 2.*Sep 14, 2026 – Sep 17, 2026/s)
  assert.equal(writes.filter(w => w.table === 'job_mobilizations').length, 2)
  assert.equal(writes.filter(w => w.table === 'assignments').length, 2)
  assert.equal(assignments.every(a => a.mobilization_id), true)
  assert.equal(await page.locator('.job-schedule-reference').count(), 1)
  console.log('PASS 10088 conversion creates two linked trips and removes the legacy crew-record blocks.')
} finally { await browser.close(); await server.close() }
