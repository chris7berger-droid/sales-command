// Inspect the deployed app with synthetic proposals. All API requests are intercepted.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.PREVIEW_URL
if (!base) throw new Error('PREVIEW_URL is required')
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated' }
const session = { access_token: 'fixture-only', refresh_token: 'fixture-only', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user }
const tenant = '00000000-0000-0000-0000-000000000002'
const trips = [
  { id: '00000000-0000-0000-0000-000000000011', seq: 1, label: 'Preparation', start_date: '2026-10-12', end_date: '2026-10-13' },
  { id: '00000000-0000-0000-0000-000000000012', seq: 2, label: 'Finish', start_date: '2026-10-20', end_date: '2026-10-21' },
]
const workTypes = [{ id: 1, name: 'Demo', tenant_id: tenant, active: true }, { id: 2, name: 'Coating', tenant_id: tenant, active: true }]
let db, writes, notices, errors
function reset(kind = 'multi', status = 'Sold') {
  const callLog = { id: 9001, job_number: 99999, display_job_number: '99999 - Trips Preview', job_name: 'Trips Preview', customer_name: 'Preview Customer', sales_name: 'Preview User', customer_id: 'customer', jobsite_address: '123 Preview Lane', jobsite_city: 'Reno', jobsite_state: 'NV', jobsite_zip: '89501', stage: status, tenant_id: tenant, customers: { name: 'Preview Customer', email: 'fixture@example.test' } }
  const proposal = { id: 'trips-preview', call_log_id: 9001, call_log: callLog, status, customer: 'Preview Customer', proposal_number: 1, created_at: '2026-09-10T12:00:00Z', approved_at: status === 'Sold' ? '2026-09-10T12:00:00Z' : null, intro: 'Preview proposal', total: 2400, tenant_id: tenant, mobilizations: structuredClone(kind === 'empty' ? [] : kind === 'single' ? trips.slice(0, 1) : trips) }
  const wtcs = (kind === 'multi' ? workTypes : workTypes.slice(0, 1)).map((wt, i) => ({
    id: `wtc-${i}`, proposal_id: proposal.id, work_type_id: wt.id, work_types: wt,
    created_at: `2026-09-10T12:0${i}:00Z`, locked: status === 'Sold', burden_rate: 50, ot_burden_rate: 75,
    tax_rate: 0, regular_hours: 24, ot_hours: 0, markup_pct: 0, size: 800, unit: 'SQFT', materials: [], travel: {}, discount: 0,
    start_date: null, end_date: null, dates_tbd: true, sales_sow: `Customer-facing scope ${i}`,
    field_sow: kind === 'empty' ? [] : [{ id: `day-${i}`, day_label: `Day ${i + 1}`, date: null,
      mobilization_id: kind === 'single' ? null : trips[i].id, scope_notes: `Crew instructions ${i}\nKeep this day's scope with its trip.`, crew_count: 3, hours_planned: 24,
      sq_ft: 800, linear_ft: 50, tasks: [{ id: `task-${i}`, description: i ? 'Apply finish' : 'Prepare floor', pct_complete: 100 }], materials: [],
    }],
  }))
  db = { proposals: [proposal], proposal_wtc: wtcs, call_log: [callLog], work_types: workTypes, jobs: [], job_wtcs: [], job_mobilizations: [] }
  writes = []; notices = []; errors = []
}
reset()
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
page.setDefaultTimeout(15000)
page.on('pageerror', e => errors.push(e.message))
page.on('dialog', async d => { notices.push(d.message()); await d.dismiss() })
const cookieFile = process.env.PREVIEW_COOKIES || '/private/tmp/sales-trips-preview-cookies.txt'
if (existsSync(cookieFile)) {
  const cookies = readFileSync(cookieFile, 'utf8').split('\n').filter(l => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_'))).map(l => {
    const [domain,, path, secure, expires, name, value] = l.replace(/^#HttpOnly_/, '').split('\t')
    return { domain, path, secure: secure === 'TRUE', expires: Number(expires) || -1, name, value, httpOnly: true }
  })
  await page.context().addCookies(cookies)
}
await page.addInitScript(session => { for (const project of ['pbgvgjjuhnpsumnowuym', 'schedule-fixture']) localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)) }, session)
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url())
  if (url.origin === new URL(base).origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const table = url.pathname.split('/').pop(), single = req.headers().accept?.includes('vnd.pgrst.object')
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' }, body: JSON.stringify(data) })
  if (req.method() === 'OPTIONS') return send([])
  if (url.pathname.startsWith('/auth/')) return send(table === 'user' ? user : session)
  if (url.pathname.startsWith('/storage/')) return send([])
  const matches = row => [...url.searchParams].every(([k, v]) => v.startsWith('eq.') ? String(row[k]) === v.slice(3) : v.startsWith('neq.') ? String(row[k]) !== v.slice(4) : v === 'is.null' ? row[k] == null : v.startsWith('in.') ? v.slice(4, -1).split(',').includes(String(row[k])) : true)
  if (req.method() !== 'GET' && req.method() !== 'HEAD') {
    assert(['jobs', 'job_wtcs', 'job_mobilizations', 'job_changes', 'call_log', 'proposals', 'proposal_wtc'].includes(table), `Unexpected write ${table}`)
    const payload = req.postDataJSON()
    writes.push({ table, method: req.method(), payload })
    if (req.method() === 'PATCH') {
      const rows = (db[table] || []).filter(matches); rows.forEach(r => Object.assign(r, payload))
      return send(single ? rows[0] : rows)
    }
    if (req.method() === 'POST') {
      const rows = (Array.isArray(payload) ? payload : [payload]).map((r, i) => ({ ...r,
        ...(table === 'jobs' ? { job_id: 1280, id: 1280, deleted: 'No', tenant_id: tenant, call_log: db.call_log[0] } : { id: r.id || `${table}-${i}` }),
      }))
      db[table] ||= []
      db[table].push(...rows); return send(single ? rows[0] : rows)
    }
    return send([])
  }
  if (table === 'team_members') return send(single ? { ...user, name: 'Preview User', role: 'Admin', onboarded: true, apps: ['sales', 'schedule'] } : [])
  if (table === 'tenant_config') return send({ id: tenant, company_name: 'Preview Company', apps: ['sales', 'schedule'], default_burden_rate: 50, default_ot_burden_rate: 75, default_tax_rate: 0 })
  let rows = (db[table] || []).filter(matches)
  if (table === 'proposals') rows = rows.map(p => ({ ...p, proposal_wtc: db.proposal_wtc, proposal_recipients: [] }))
  if (table === 'jobs') rows = rows.map(j => ({ ...j, job_wtcs: db.job_wtcs.filter(w => w.job_id === j.job_id) }))
  const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || rows.length)
  rows = rows.slice(offset, offset + limit)
  return send(single ? rows[0] || null : rows)
})
async function openProposal() {
  await page.goto(`${base}/sales/proposals/trips-preview`)
  await page.getByRole('button', { name: 'Edit WTC', exact: true }).first().waitFor()
}
async function openWtc() {
  await page.getByRole('button', { name: 'Edit WTC', exact: true }).first().click()
  await page.getByRole('button', { name: /4 · Scope of Work/ }).click()
  await page.getByText('Step 1 · Trips', { exact: true }).waitFor()
  assert(!/Mobilization|\bMob \d/.test(await page.locator('body').innerText()))
}
try {
  // Real WTC editor: retain and rename one trip, create another, assign its scope.
  reset('single', 'Draft')
  db.proposal_wtc[0].field_sow[0].mobilization_id = trips[0].id
  await openProposal(); await openWtc()
  await page.locator('input[type=checkbox]:checked').waitFor()
  await page.getByRole('checkbox').filter({ visible: true }).first().uncheck()
  await page.getByRole('button', { name: '+ Add Trip', exact: true }).click()
  await page.getByLabel('Trip title', { exact: true }).fill('Return coating')
  await Promise.all([page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes('/proposals')), page.getByRole('button', { name: 'Save', exact: true }).click()])
  assert.equal(db.proposals[0].mobilizations.length, 2)
  const added = db.proposals[0].mobilizations[1]
  await page.getByRole('button', { name: 'Add Day Entry', exact: false }).first().click()
  const tripSelectors = page.locator('select').filter({ has: page.locator(`option[value="${added.id}"]`) })
  assert.equal(await tripSelectors.count(), 2)
  await tripSelectors.nth(1).selectOption(added.id)
  await page.getByPlaceholder('Describe task…', { exact: true }).nth(1).fill('Apply return coat')
  await Promise.all([page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes('/proposal_wtc')), page.getByRole('button', { name: 'Save Field SOW', exact: true }).click()])
  assert.equal(db.proposal_wtc[0].field_sow[0].mobilization_id, trips[0].id)
  assert.equal(db.proposal_wtc[0].field_sow[1].mobilization_id, added.id)
  assert.equal(db.proposal_wtc[0].field_sow[1].tasks[0].description, 'Apply return coat')
  assert.equal(db.proposal_wtc[0].sales_sow, 'Customer-facing scope 0')
  await page.screenshot({ path: '/private/tmp/sales-trips-wtc.png', fullPage: true })
  assert.deepEqual(errors, [])

  for (const kind of ['multi', 'single', 'empty']) {
    await page.goto('about:blank'); reset(kind)
    const original = structuredClone({ proposals: db.proposals, wtcs: db.proposal_wtc })
    await openProposal()
    await page.getByRole('button', { name: 'Send to Schedule', exact: true }).click()
    await page.getByRole('button', { name: '✓ Sent to Schedule', exact: true }).waitFor()
    assert.equal(await page.getByText('Confirm & Send', { exact: true }).count(), 0)
    assert.equal(db.jobs.length, 1)
    assert(!('sow' in db.jobs[0]))
    assert.equal(db.job_mobilizations.length, original.proposals[0].mobilizations.length)
    assert.equal(db.job_wtcs.length, original.wtcs.length)
    for (const [i, w] of db.job_wtcs.entries()) {
      const expected = original.wtcs[i].field_sow.map(({ mobilization_id, ...day }) => ({ ...day, date: null, mobilization_seq: original.proposals[0].mobilizations.find(m => m.id === mobilization_id)?.seq ?? 1 }))
      assert.deepEqual(w.field_sow, expected)
    }
    assert.deepEqual(db.proposal_wtc, original.wtcs)
    assert(!writes.some(w => ['proposals', 'proposal_wtc', 'assignments'].includes(w.table)))
    assert.deepEqual(notices, [])
    assert.deepEqual(errors, [])
    if (kind === 'multi') {
      await page.screenshot({ path: '/private/tmp/sales-trips-sent.png', fullPage: true })
      await page.goto(`${base}/schedule/jobs?job=1280&panel=trips`)
      await page.locator('.job-trips .job-trip').first().waitFor()
      assert.equal(await page.locator('.job-trips .job-trip').count(), 2)
      assert((await page.locator('.job-trips').innerText()).includes('Preparation'))
      assert((await page.locator('.job-trips').innerText()).includes('Finish'))
      await page.locator('.job-trips').screenshot({ path: '/private/tmp/sales-trips-schedule.png' })
      await page.getByRole('button', { name: 'PLANNING', exact: true }).click()
      await page.locator('.sjc-score').filter({ has: page.getByText('SOW', { exact: true }) }).click()
      const builder = page.locator('.fsb-wrap')
      await builder.waitFor()
      const firstScope = db.job_wtcs[0].field_sow[0].scope_notes
      assert.equal(await builder.locator('.fsb-day-scope-notes > div').last().textContent(), firstScope)
      assert.equal(await builder.locator('.fsb-day-scope-notes > div').last().evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap')
      assert(!(await builder.innerText()).includes('Customer-facing scope'))
      await page.locator('.mdl').screenshot({ path: '/private/tmp/sales-trips-schedule-scope.png' })
      await builder.locator('input[type=date]').fill('2026-10-12')
      await builder.getByRole('button', { name: 'Save Field SOW', exact: true }).click()
      await builder.getByRole('button', { name: '✓ Saved', exact: true }).waitFor()
      assert.equal(db.job_wtcs[0].field_sow[0].scope_notes, firstScope)
      assert.equal(db.job_wtcs[0].field_sow[0].mobilization_seq, 1)
      await page.locator('.mdl').getByRole('button', { name: 'Coating', exact: true }).click()
      assert.equal(await builder.locator('.fsb-day-scope-notes > div').last().textContent(), db.job_wtcs[1].field_sow[0].scope_notes)
      assert(!(await builder.innerText()).includes('Crew instructions 0'))
      assert.deepEqual(db.proposal_wtc, original.wtcs)
      assert.deepEqual(errors, [])
    }
  }
  await page.goto('about:blank'); reset()
  db.proposal_wtc[1].field_sow[0].mobilization_id = null
  await openProposal()
  await page.getByRole('button', { name: 'Send to Schedule', exact: true }).click()
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent === 'Sending...'))
  assert.equal(writes.length, 0)
  assert(notices.some(n => n.includes('Field SOW days without a valid trip') && n.includes('WTC 2')))
  assert.deepEqual(errors, [])
  console.log('PASS deployed app: WTC multi-trip authoring and scope save; one-click single/multiple/no-trip sends; Sales SOW retained only in Sales; Schedule trips render; incomplete Field SOW selection blocks before writes. All API traffic intercepted.')
} catch (e) {
  console.error((await page.locator('body').innerText()).slice(0, 3000))
  console.error({ errors, notices, writes: writes.map(w => `${w.method} ${w.table}`) })
  throw e
} finally { await browser.close() }
