// Focused layout check: Crew Schedule date header stays put while job rows scroll.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.VITE_SUPABASE_URL = 'https://schedule-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'codex-fixture-only'

const PORT = 5198
const server = await createServer({
  root: resolve('.'),
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
  plugins: [{
    name: 'sticky-dates-test',
    resolveId(id) { if (id === 'virtual:sticky-dates') return '\0sticky-dates' },
    load(id) {
      if (id !== '\0sticky-dates') return
      return `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {MemoryRouter,Routes,Route} from 'react-router-dom';
        import ScheduleLayout from '/src/schedule/ScheduleLayout.jsx';
        createRoot(document.getElementById('root')).render(
          React.createElement(MemoryRouter,{initialEntries:['/schedule/schedule']},
            React.createElement(Routes,null,
              React.createElement(Route,{path:'/schedule/*',element:React.createElement(ScheduleLayout,{teamMember:{name:'Fixture admin',role:'Admin'}})}))));`
    },
    configureServer(vite) {
      vite.middlewares.use('/__sticky-dates', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(await vite.transformIndexHtml('/__sticky-dates', `<html style="height:100%"><body style="height:100%;margin:0">
          <div data-app-shell style="display:flex;height:100vh;overflow:hidden">
            <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
              <div data-app-header style="height:50px;flex-shrink:0;background:#1c1814"></div>
              <div data-app-content style="flex:1;overflow-y:auto;min-height:0">
                <div id="root" style="height:100%"></div>
              </div>
            </div>
          </div>
          <script type="module">import "virtual:sticky-dates"</script>
        </body></html>`))
      })
    },
  }],
})
await server.listen()

const crew = ['Alex', 'Blair', 'Casey', 'Drew'].map(name => ({ name, archived: false, team: '1' }))
const jobs = Array.from({ length: 28 }, (_, i) => ({
  job_id: i + 1,
  call_log_id: 100 + i,
  job_num: String(7200 + i),
  job_name: `Fixture job ${i + 1}`,
  status: 'Scheduled',
  deleted: 'No',
  merged_into_job_id: null,
  start_date: '2026-09-07',
  end_date: '2026-09-12',
  crew_needed: 2,
  job_wtcs: [],
  call_log: { id: 100 + i, job_number: 7200 + i, job_name: `Fixture job ${i + 1}`, customer_name: 'Fixture' },
}))
const mobs = jobs.map(j => ({
  id: `trip-${j.job_id}`,
  job_id: j.job_id,
  seq: 1,
  label: `Trip ${j.job_id}`,
  start_date: '2026-09-07',
  end_date: '2026-09-12',
  crew_needed: 2,
}))
const assignments = jobs.flatMap(j => [
  { job_id: j.job_id, crew_name: 'Alex', date: '2026-09-08' },
  { job_id: j.job_id, crew_name: 'Blair', date: '2026-09-08' },
])

let browser
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, timezoneId: 'America/Los_Angeles' })
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00-07:00'))
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', async route => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname === '127.0.0.1') return route.continue()
    if (url.hostname !== 'schedule-fixture.supabase.co') return route.abort()
    const table = url.pathname.split('/').pop()
    const send = (data, status = 200) => route.fulfill({
      status,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify(data),
    })
    if (req.method() === 'OPTIONS') return send([])
    if (table === 'crew') return send(crew)
    if (table === 'jobs') return send(jobs)
    if (table === 'job_mobilizations') return send(mobs)
    if (table === 'assignments') return send(assignments)
    return send([])
  })

  await page.goto(`http://127.0.0.1:${PORT}/__sticky-dates`)
  await page.waitForFunction(() => document.querySelector('.sch-brd-hdr-job') && document.querySelector('.sch-brd') && document.querySelectorAll('.sch-board-row-wrap').length > 10)

  const before = await page.evaluate(() => {
    const content = document.querySelector('[data-app-content]')
    const capacity = document.querySelector('.hcs')
    const board = document.querySelector('.sch-brd')
    const header = document.querySelector('.sch-brd-hdr-job')
    const firstJob = document.querySelector('.sch-brd-job-label')
    return {
      extraBar: !!document.querySelector('.sch-date-bar'),
      headerInBoard: board.contains(header),
      contentScroll: content.scrollTop,
      contentCanScroll: content.scrollHeight > content.clientHeight + 1,
      bodyCanScroll: board.scrollHeight > board.clientHeight + 1,
      capacityBottom: capacity.getBoundingClientRect().bottom,
      headerTop: header.getBoundingClientRect().top,
      headerLeft: header.getBoundingClientRect().left,
      headerText: `${header.innerText} ${[...document.querySelectorAll('.sch-brd-hdr')].map(el => el.innerText).join(' ')}`.replace(/\s+/g, ' ').trim(),
      firstJobTop: firstJob.getBoundingClientRect().top,
      firstJobLeft: firstJob.getBoundingClientRect().left,
      firstJobHeight: firstJob.getBoundingClientRect().height,
      firstJobName: firstJob.querySelector('.sch-brd-job-name').textContent,
    }
  })

  assert.equal(before.extraBar, false, 'Must not add a second date bar under capacity')
  assert.equal(before.headerInBoard, true, 'Date header must stay on the job board')
  assert.equal(before.contentCanScroll, false, 'Host pane must not scroll the capacity bar')
  assert.equal(before.bodyCanScroll, true, 'Job rows must overflow their own scroller')
  assert.match(before.headerText, /JOB/i)
  assert.match(before.headerText, /MO/i)
  assert.match(before.headerText, /SA/i)
  assert.ok(Math.abs(before.headerLeft - before.firstJobLeft) < 2, 'Date header must line up with job rows')
  assert.ok(before.firstJobHeight >= 48, 'Job rows must keep their natural height')

  await page.locator('.sch-brd').evaluate(el => { el.scrollTop = 400 })
  await page.waitForTimeout(80)

  const after = await page.evaluate(() => {
    const content = document.querySelector('[data-app-content]')
    const capacity = document.querySelector('.hcs')
    const board = document.querySelector('.sch-brd')
    const header = document.querySelector('.sch-brd-hdr-job')
    const firstJob = document.querySelector('.sch-brd-job-label')
    return {
      contentScroll: content.scrollTop,
      bodyScroll: board.scrollTop,
      capacityBottom: capacity.getBoundingClientRect().bottom,
      headerTop: header.getBoundingClientRect().top,
      firstJobTop: firstJob.getBoundingClientRect().top,
      firstJobHeight: firstJob.getBoundingClientRect().height,
      firstJobName: firstJob.querySelector('.sch-brd-job-name').textContent,
    }
  })

  assert.equal(after.contentScroll, 0, 'Job scroll must not move the host pane')
  assert.ok(after.bodyScroll > 200, 'Job body should have scrolled')
  assert.equal(after.headerTop, before.headerTop, 'Date row must stay fixed')
  assert.equal(after.capacityBottom, before.capacityBottom, 'Capacity bar must stay fixed')
  assert.ok(after.firstJobTop < before.firstJobTop - 100, 'Only job rows should move')
  assert.equal(after.firstJobHeight, before.firstJobHeight, 'Scrolling must not squash job rows')
  assert.equal(after.firstJobName, before.firstJobName)
  assert.deepEqual(errors, [])
  console.log('PASS Crew Schedule board date header stays put; only job rows scroll.')
} catch (error) {
  console.error(error)
  throw error
} finally {
  if (browser) await browser.close()
  await server.close()
}
