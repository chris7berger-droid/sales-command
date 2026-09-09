// Real expanded trip panel + real job card. All data is intercepted; no live DB.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.VITE_SUPABASE_URL = 'https://schedule-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'codex-fixture-only'
const job = { job_id: 901, call_log_id: 9001, job_num: '7325', job_name: 'Solum North Valleys Surf Thru', status: 'Staged', deleted: 'No', field_sow: [], _wtcs: [] }
const original = { id: 'trip-one', job_id: 901, seq: 1, displayNumber: 1, label: 'Clean & Seal & Rubber Base', start_date: '2026-09-09', end_date: '2026-09-10', lead: 'Eric Simeroth Jr', crew_needed: 2 }
let trips = [{ ...original }], crew = true, work = false, failCheck = false, badReply = false, failDelete = false, zeroDelete = false
const writes = [], errors = []
const server = await createServer({ server: { host: '127.0.0.1', port: 5199, strictPort: true }, plugins: [{
  name: 'deletion-harness',
  resolveId(id) { if (id === 'virtual:deletion') return '\0deletion' },
  load(id) {
    if (id !== '\0deletion') return
    return `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,useLocation} from 'react-router-dom';
      import ScheduleTripDetails from '/src/schedule/components/ScheduleTripDetails.jsx';import StageJobCard from '/src/schedule/components/StageJobCard.jsx';
      import {UserProvider} from '/src/schedule/lib/user.jsx';import {supabase} from '/src/lib/supabase.js';
      import '/src/schedule/App.css';import '/src/schedule/index.css';import {GLOBAL_CSS} from '/src/lib/tokens.js';document.head.appendChild(Object.assign(document.createElement('style'),{textContent:GLOBAL_CSS}));
      function Harness(){const [trips,setTrips]=React.useState(${JSON.stringify(trips)});const [job,setJob]=React.useState(${JSON.stringify(job)});window.deletionPath=useLocation().pathname+useLocation().search;
      async function refresh(){const r=await supabase.from('job_mobilizations').select('*').eq('job_id',901);setTrips(r.data);window.refreshCount=(window.refreshCount||0)+1}window.refreshTrips=refresh;
      return React.createElement('div',{className:'schedule-root',style:{padding:24}},React.createElement('div',{className:'sch-brd-detail'},React.createElement(ScheduleTripDetails,{job,trips,leadNames:['Eric Simeroth Jr','Ricky Zorn'],onUpdated:refresh},'No saved trips.')),
      React.createElement(StageJobCard,{job,stage:'ready',autoOpen:true,onJobUpdate:()=>{window.jobDeleted=true;setJob(j=>({...j,deleted:'Yes'}))}}))}
      createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/schedule/schedule?week=2026-09-07']},React.createElement(UserProvider,{teamMember:{name:'Fixture',role:'Admin'}},React.createElement(Harness))));`
  },
  configureServer(vite) { vite.middlewares.use('/__deletion', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html');res.end(await vite.transformIndexHtml('/__deletion','<html><body><div id="root"></div><script type="module">import "virtual:deletion"</script></body></html>'))
  }) },
}] })
await server.listen()
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } })
page.setDefaultTimeout(8000)
page.on('pageerror', e => errors.push(e.message))
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url())
  if (url.hostname === '127.0.0.1') return route.continue()
  if (url.hostname !== 'schedule-fixture.supabase.co') return route.abort()
  const table = url.pathname.split('/').pop()
  const send = (data, status=200) => route.fulfill({ status, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:JSON.stringify(data) })
  if (req.method() === 'OPTIONS') return send([])
  if (table === 'check_schedule_deletion') {
    assert.equal(req.postDataJSON().p_job_id,901)
    if (failCheck) return send({message:'Safety service unavailable'},500)
    if (badReply) return send([])
    return send(crew ? {code:'crew',message:'Cannot delete this trip — crew is still assigned. Remove or reassign all crew in Crew Schedule, then return to delete it.'}
      : work ? {code:'work',message:'Cannot delete this trip — this job has recorded hours or field activity.'} : null)
  }
  if (req.method() !== 'GET') {
    writes.push({table,method:req.method(),query:url.searchParams.toString()})
    assert.notEqual(table,'assignments','Deletion must never clear crew automatically')
    if (table === 'job_mobilizations' && req.method() === 'DELETE') {
      if (failDelete) return send({message:'Cannot delete this trip — crew is still assigned.'},400)
      if (zeroDelete) return send([])
      const row=trips.find(t=>'eq.'+t.id===url.searchParams.get('id'))
      assert.equal(url.searchParams.get('job_id'),'eq.901')
      assert.equal(url.searchParams.get('start_date'),'eq.2026-09-09','Stale date must not silently delete an edited trip')
      trips=trips.filter(t=>t!==row);return send(row?[{id:row.id}]:[])
    }
    if (table === 'jobs') return send([{job_id:901}])
    return send([])
  }
  if (table==='job_mobilizations') return send(trips)
  return send([])
})
const trigger = () => page.locator('[data-schedule-trip-id="trip-one"]').getByRole('button',{name:'Delete trip',exact:true})
const dialog = () => page.getByRole('alertdialog')
const cancel = async () => { await dialog().getByRole('button',{name:'Cancel',exact:true}).click();await dialog().waitFor({state:'hidden'}) }
const finalStep = async () => { await dialog().getByRole('button',{name:'Continue',exact:true}).click();await dialog().getByLabel('Type DELETE to confirm').fill('DELETE') }
try {
  await page.goto('http://127.0.0.1:5199/__deletion')
  await trigger().click()
  await dialog().getByRole('heading',{name:'Cannot delete this trip'}).waitFor()
  assert.equal(writes.length,0)
  assert.equal(await dialog().getByRole('button',{name:'Continue'}).count(),0)
  await page.screenshot({path:'/private/tmp/crew-first-stop.png',fullPage:true})
  await dialog().getByRole('button',{name:'Go to Crew Schedule'}).click()
  await page.waitForFunction(()=>window.deletionPath==='/schedule/schedule?job=901&week=2026-09-07&trip=trip-one')
  await page.getByRole('button',{name:'Delete job',exact:true}).click()
  await dialog().getByRole('heading',{name:'Cannot delete this job'}).waitFor()
  assert.equal(writes.length,0);await cancel()
  console.log('PASS expanded trip and whole-job deletion stop before confirmation; crew navigation uses exact trip and Monday.')

  // Crew is manually cleared outside the deletion flow; recorded work survives.
  crew=false;work=true;await trigger().click()
  await dialog().getByRole('alert').filter({hasText:'recorded hours'}).waitFor()
  assert.equal(await dialog().getByRole('button',{name:'Go to Crew Schedule'}).count(),0)
  assert.equal(writes.length,0);await cancel();work=false
  for (const malformed of [false,true]) {
    failCheck=!malformed;badReply=malformed;await trigger().click()
    await dialog().getByRole('alert').filter({hasText:'Could not verify'}).waitFor()
    assert.equal(writes.length,0);await cancel()
  }
  failCheck=false;badReply=false
  await page.getByRole('textbox',{name:'Trip title',exact:true}).fill('Unsaved edit')
  assert(await trigger().isDisabled())
  await page.locator('[data-schedule-trip-id]').getByRole('button',{name:'Cancel',exact:true}).click()
  console.log('PASS actual work survives crew removal; failed/malformed checks and unsaved edits cannot delete.')

  await trigger().click();await cancel();assert.equal(writes.length,0)
  await trigger().click();await dialog().getByRole('button',{name:'Continue'}).click()
  assert(await dialog().getByRole('button',{name:'Permanently delete trip'}).isDisabled())
  await dialog().getByLabel('Type DELETE to confirm').fill('delete')
  assert(await dialog().getByRole('button',{name:'Permanently delete trip'}).isDisabled())
  await cancel();assert.equal(writes.length,0)
  // Preflight goes stale while the user is reading: no delete request is sent.
  await trigger().click();await finalStep();crew=true
  await dialog().getByRole('button',{name:'Permanently delete trip'}).click()
  await dialog().getByRole('alert').filter({hasText:'crew is still assigned'}).waitFor()
  assert.equal(writes.length,0);await cancel();crew=false
  // DB catches a crew insertion after the last preflight, or a stale row match.
  for (const zero of [false,true]) {
    failDelete=!zero;zeroDelete=zero;await trigger().click();await finalStep()
    await dialog().getByRole('button',{name:'Permanently delete trip'}).click()
    await dialog().getByRole('alert').filter({hasText:zero?'trip changed':'crew is still assigned'}).waitFor()
    assert.equal(trips.length,1);await cancel()
  }
  failDelete=false;zeroDelete=false
  console.log('PASS both cancellation stages, exact DELETE requirement, stale preflight, final server block and zero-row rejection.')

  await page.setViewportSize({width:390,height:844})
  await trigger().click();await finalStep()
  assert(await dialog().evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth))
  await page.screenshot({path:'/private/tmp/crew-first-confirm-mobile.png',fullPage:true})
  await dialog().getByRole('button',{name:'Permanently delete trip'}).click()
  await page.locator('[data-schedule-trip-id]').waitFor({state:'hidden'})
  await page.waitForFunction(()=>window.refreshCount>0)
  assert.equal(trips.length,0)
  assert(!writes.some(w=>w.table==='jobs'))
  await page.getByRole('button',{name:'Delete job',exact:true}).click()
  await dialog().getByText(/recoverable for 24 hours/).waitFor()
  assert(!/cannot be undone/i.test(await dialog().innerText()),'Job soft delete must not claim permanence')
  await finalStep();await dialog().getByRole('button',{name:'Delete job',exact:true}).click()
  await page.waitForFunction(()=>window.jobDeleted===true)
  assert.deepEqual(errors,[])
  console.log('PASS mobile dialog, trip removal/refresh, retained parent job, truthful job recovery copy and successful whole-job delete.')
} catch (error) { console.error({trips,writes,ui:(await page.locator('body').innerText()).slice(0,2500)});throw error } finally { await browser.close();await server.close() }
