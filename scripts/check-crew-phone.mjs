// Real app entry point, synthetic login and schedule; every API request intercepted.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5197'
const engine = process.env.BROWSER_ENGINE || 'chromium'
const browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ channel: 'chrome', headless: true }))
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated' }
const session = { access_token: 'fixture-only', refresh_token: 'fixture-only', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user }
const tenant = '00000000-0000-0000-0000-000000000002'
const jobs = [{ job_id: 1, call_log_id: 10, job_num: '6618', job_name: 'Lakes Crossing', status: 'Scheduled', start_date: '2026-08-01', end_date: '2026-08-02', lead: 'Wrong Parent Lead', deleted: 'No', deferred_days: '2026-09-13', deferred_time: '09:00', notes: 'PRIVATE OFFICE NOTE',
  call_log: { id: 10, job_name: 'Lakes Crossing', display_job_number: '6618', jobsite_address: '123 Example Way', jobsite_city: 'Las Vegas', jobsite_state: 'NV', jobsite_zip: '89101' } }]
const crew = [{ name: 'JoseJR' }, { name: 'Kurtis Zomparelli' }, { name: 'No Assignments' }]
const trips = [{ id: 'burnish', job_id: 1, seq: 1, label: 'Final Burnish', start_date: '2026-09-11', end_date: '2026-09-13', lead: 'Kurtis Zomparelli', note: 'Use north gate' },
  { id: 'seal', job_id: 1, seq: 2, label: 'Seal', start_date: '2026-09-11', end_date: '2026-09-11', lead: 'Wrong Lead' }]
const assignments = [{ id: 1, job_id: 1, date: '2026-09-11', crew_name: 'JoseJR', mobilization_id: 'burnish' },
  { id: 2, job_id: 1, date: '2026-09-11', crew_name: 'Kurtis Zomparelli', mobilization_id: 'burnish' },
  { id: 3, job_id: 1, date: '2026-09-11', crew_name: 'Wrong Coworker', mobilization_id: 'seal' },
  { id: 4, job_id: 1, date: '2026-09-13', crew_name: 'JoseJR', mobilization_id: 'burnish' }]
let signedIn = false, allowedApps = ['sales', 'schedule'], failTable = null, delayedWeek = null
const pending = [], errors = [], writes = [], reads = []
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
const cookieFile = process.env.PREVIEW_COOKIES || '/private/tmp/crew-phone-preview-cookies.txt'
if (existsSync(cookieFile)) {
  const cookies = readFileSync(cookieFile, 'utf8').split('\n').filter(l => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_'))).map(l => {
    const [domain,, path, secure, expires, name, value] = l.replace(/^#HttpOnly_/, '').split('\t')
    return { domain, path, secure: secure === 'TRUE', expires: Number(expires) || -1, name, value, httpOnly: true }
  })
  await context.addCookies(cookies)
}
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: async data => {
    window.sharedText = data.text
    if (window.shareFailure) throw new DOMException('fixture', window.shareFailure)
  } })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
    if (window.copyFailure) throw new Error('denied')
    window.copiedText = text
  } } })
})
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror', e => errors.push(e.message))
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url())
  if (url.origin === new URL(base).origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const table = url.pathname.split('/').pop(), single = req.headers().accept?.includes('vnd.pgrst.object')
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' }, body: JSON.stringify(data) })
  if (req.method() === 'OPTIONS') return send([])
  if (url.pathname.startsWith('/auth/')) {
    if (table === 'token') { signedIn = true; return send(session) }
    return send(user)
  }
  if (req.method() !== 'GET' && req.method() !== 'HEAD') { writes.push({ table, method: req.method() }); return send({ message: 'Fixture blocked mutation' }, 400) }
  reads.push(table)
  if (table === 'team_members') return send(single ? { ...user, name: 'Preview User', role: 'Admin', onboarded: true, apps: allowedApps } : [])
  if (table === 'tenant_config') return send(signedIn ? { id: tenant, company_name: 'Preview Company', apps: ['sales', 'schedule'] } : null)
  const week = url.searchParams.getAll('date').find(v => v.startsWith('gte.'))?.slice(4)
  const end = url.searchParams.getAll('date').find(v => v.startsWith('lte.'))?.slice(4)
  if (table === 'assignments' && week === delayedWeek) await new Promise(resolve => pending.push(resolve))
  if (table === failTable) return send({ message: 'Fixture unavailable' }, 400)
  const db = { jobs, crew, job_mobilizations: trips, assignments: assignments.filter(a => (!week || a.date >= week) && (!end || a.date <= end)) }
  const rows = db[table] || []
  return send(single ? rows[0] || null : rows)
})
const root = page.locator('.crew-phone')
const preview = page.locator('textarea[aria-label="Full text to share"]')
const copy = page.getByRole('button', { name: 'Copy week', exact: true })
async function loaded() { await root.getByRole('button', { name: 'Refresh', exact: true }).waitFor() }
async function fits() {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page horizontal overflow')
  for (const selector of ['.cp-picker', '.cp-week input', '.cp-picker select', '.cp-actions']) {
    const box = await page.locator(selector).boundingBox()
    assert(box.x >= 0 && box.x + box.width <= await page.evaluate(() => innerWidth) + 1, `${selector} fits phone width`)
  }
  const box = await copy.boundingBox()
  assert(box.y >= 0 && box.y + box.height <= await page.evaluate(() => innerHeight), 'Copy stays reachable')
}
try {
  await page.goto(`${base}/crew-texts?week=2026-09-07`)
  await page.getByRole('button', { name: 'Sign In', exact: true }).waitFor()
  assert(!reads.includes('jobs') && !reads.includes('crew'), 'No schedule fetched before sign-in')
  await page.locator('input[type=email]').fill('fixture@example.test')
  await page.locator('input[type=password]').fill('fixture-only')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await loaded()
  assert(page.url().endsWith('/crew-texts?week=2026-09-07'), 'Direct link and week survive login')
  assert.equal(await page.locator('[data-app-shell], [data-app-sidebar]').count(), 0, 'Phone route has no desktop shell')
  const text = await preview.inputValue()
  assert.match(text, /^JoseJR\n/)
  assert.match(text, /6618 — Lakes Crossing/)
  assert.match(text, /With: Kurtis Zomparelli/)
  assert.match(text, /Lead: Kurtis Zomparelli/)
  assert.match(text, /Start: Meet at the shop at 6:30 AM/)
  assert.match(text, /SUNDAY, SEP 13[\s\S]*Start: Delayed start 9:00 AM/)
  assert.doesNotMatch(text, /Wrong Lead|Wrong Coworker|PRIVATE OFFICE/)
  assert.equal(await page.locator('.cp-day').count(), 7)
  await copy.click()
  assert.equal(await page.evaluate(() => window.copiedText), text)
  await page.getByRole('button', { name: 'Share week', exact: true }).click()
  assert.equal(await page.evaluate(() => window.sharedText), text, 'Share receives exact reviewed week')
  for (const width of [390, 360, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await fits()
    await page.screenshot({ path: `/private/tmp/crew-phone-${engine}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('Start / meeting instructions', { exact: true }).click()
  await page.getByLabel('Usual start', { exact: true }).fill('Meet at shop at 7:00 AM')
  await page.getByRole('button', { name: 'Next person →', exact: true }).click()
  assert.match(await preview.inputValue(), /^Kurtis Zomparelli\n/)
  assert.match(await preview.inputValue(), /Start: Meet at shop at 7:00 AM/)
  await page.getByRole('button', { name: '← Previous person', exact: true }).click()
  jobs[0].deferred_time = '10:30'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Full text to share"]')?.value.includes('Delayed start 10:30 AM'))
  assert.equal(await page.getByLabel('Usual start', { exact: true }).inputValue(), 'Meet at shop at 7:00 AM', 'Refresh preserves meeting draft')
  await page.evaluate(() => { window.shareFailure = 'AbortError' })
  await page.getByRole('button', { name: 'Share week', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.cp-primary').disabled)
  assert(!(await root.innerText()).includes('Sharing is unavailable'), 'Share cancellation is not an error')
  await page.evaluate(() => { window.shareFailure = 'NotAllowedError' })
  await page.getByRole('button', { name: 'Share week', exact: true }).click()
  await page.getByText('Sharing is unavailable. Use Copy, then paste into Messages.', { exact: true }).waitFor()
  await page.evaluate(() => { window.copyFailure = true })
  await copy.click()
  await preview.waitFor({ state: 'visible' })
  await page.getByText('Select and copy the text below, then paste it into Messages.', { exact: true }).waitFor()
  await page.evaluate(() => { window.copyFailure = false; window.shareFailure = null })
  for (const table of ['assignments']) {
    failTable = table
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert(await copy.isDisabled(), 'No stale share after partial read failure')
    assert.equal(await preview.count(), 0)
    failTable = null
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await loaded()
  }
  delayedWeek = '2026-09-14'
  await page.getByRole('button', { name: 'Next week', exact: true }).click()
  await page.getByText('Loading weekly schedules…', { exact: true }).waitFor()
  assert(await copy.isDisabled())
  await page.getByRole('button', { name: 'Next week', exact: true }).click()
  await loaded()
  for (const release of pending) release()
  delayedWeek = null
  await copy.click()
  assert.match(await page.evaluate(() => window.copiedText), /Week of 2026-09-21/)
  assert.equal((await preview.inputValue()).match(/No work assigned/g).length, 7)

  // Existing full desktop app and its navigation still render at their own URLs.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${base}/schedule/schedules?week=2026-09-07`)
  await page.getByRole('textbox', { name: 'Text preview', exact: true }).waitFor()
  assert.equal(await root.count(), 0)
  assert.equal(await page.locator('[data-app-sidebar]').count(), 1)
  assert.equal((await page.locator('[data-app-sidebar]').boundingBox()).width, 228)
  await page.screenshot({ path: `/private/tmp/crew-phone-desktop-${engine}.png`, fullPage: true })
  await page.locator('[data-app-sidebar]').getByTitle('Crew Schedule', { exact: true }).click()
  await page.getByRole('button', { name: 'Weekly crew texts', exact: true }).waitFor()
  assert.equal(await page.locator('[data-app-sidebar]').count(), 1)
  assert.equal(await root.count(), 0)
  await page.screenshot({ path: `/private/tmp/crew-phone-board-${engine}.png`, fullPage: true })

  // Authenticated users without Schedule entitlement cannot load the phone data.
  allowedApps = ['sales']
  const before = reads.filter(t => t === 'jobs' || t === 'crew').length
  await page.goto(`${base}/crew-texts`)
  await page.getByText('Not authorized', { exact: true }).waitFor()
  assert.equal(await root.count(), 0)
  assert.equal(reads.filter(t => t === 'jobs' || t === 'crew').length, before)
  assert.deepEqual(writes, [], 'No API mutations outside synthetic authentication')
  assert.deepEqual(errors, [], 'No page errors')
  console.log(`PASS ${engine}: actual login/direct link, 360/390/430px phone layout, trip/day details, exact copy/share, cancellation/fallback, refresh/drafts, read failures/races, empty week, desktop shell/board, entitlement, no data writes`)
} finally {
  for (const release of pending) release()
  await browser.close()
}
