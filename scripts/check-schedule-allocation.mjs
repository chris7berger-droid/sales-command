// Browser regression for allocation creation -> Schedule/Calendar/Daily reads.
// Requires Playwright (or PLAYWRIGHT_MODULE pointing to its installed index.mjs).
// Uses fake credentials and intercepts all remote traffic. Never accesses a DB.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = resolve(process.env.SCHEDULE_TEST_ROOT || '.')
process.env.VITE_SUPABASE_URL = 'https://schedule-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'codex-fixture-only'
const server = await createServer({
  root, server: { host: '127.0.0.1', port: 5190, strictPort: true },
  plugins: [{
    name: 'allocation-test-harness',
    resolveId(id) { if (id === 'virtual:allocation-test') return '\0allocation-test' },
    load(id) {
      if (id !== '\0allocation-test') return
      return `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {MemoryRouter,useNavigate} from 'react-router-dom';
        import ScheduleLayout from '/src/schedule/ScheduleLayout.jsx';
        import {addJobMobilization} from '/src/schedule/lib/queries.js';
        window.testAdd = addJobMobilization;
        function Harness(){window.testNavigate=useNavigate();return React.createElement(ScheduleLayout,{teamMember:{name:'Codex regression',role:'Admin'}})}
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/settings']},React.createElement(Harness)));`
    },
    configureServer(vite) {
      vite.middlewares.use('/__allocation-test', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(await vite.transformIndexHtml('/__allocation-test', '<html><body><div id="root"></div><script type="module">import "virtual:allocation-test"</script></body></html>'))
      })
    },
  }],
})
await server.listen()
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
})
const page = await browser.newPage({viewport:{width:1400,height:1050}})
await page.clock.setFixedTime(new Date('2026-10-12T12:00:00-07:00'))
const runtimeErrors=[]
page.on('pageerror', e=>runtimeErrors.push(e.message))
const callLog={id:3791,job_number:7215,display_job_number:'7215 - STY 4',job_name:'STY 4',customer_name:'Fixture customer'}
const main={job_id:1150,call_log_id:3791,call_log:callLog,job_num:'7215',job_name:'STY 4',status:'Ongoing',deleted:'No',merged_into_job_id:null,start_date:'2026-08-03',end_date:'2026-08-05',lead:null,crew_needed:null,job_wtcs:[]}
const folded={...main,job_id:1199,merged_into_job_id:1150,start_date:'2026-08-31',end_date:'2026-09-03'}
const deleted={...main,job_id:1200,deleted:'Yes'}
const jobs=[main,folded,deleted]
let mobs=[], failInsert=false
let snapshotAssignments=[]
if (process.env.SCHEDULE_SNAPSHOT) {
  const snapshot=JSON.parse(readFileSync(process.env.SCHEDULE_SNAPSHOT,'utf8')).rows[0].snapshot
  jobs.splice(0,jobs.length,...snapshot.jobs)
  mobs=snapshot.allocations
  snapshotAssignments=snapshot.assignments || []
}
const mutations=[]
await page.route('**/*', async route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.hostname==='127.0.0.1')return route.continue()
  if(url.hostname!=='schedule-fixture.supabase.co')return route.abort()
  const table=url.pathname.split('/').pop()
  const headers={'access-control-allow-origin':'*','content-type':'application/json'}
  const send=(data,status=200)=>route.fulfill({status,headers,body:JSON.stringify(data)})
  if(req.method()==='OPTIONS')return send([])
  if(req.method()!=='GET'){
    const payload=req.postDataJSON();mutations.push({table,payload,method:req.method()})
    if(table==='job_mobilizations'){
      if(failInsert)return send({message:'Fixture insert failure'},400)
      const row={id:'test-trip-'+(mobs.length+1),...payload};mobs.push(row);return send(row)
    }
    return send([])
  }
  if(table==='crew')return send([{name:'Bash Dave',team:'1',archived:false},{name:'Sales-looking inactive',archived:true}])
  if(table==='work_types')return send([{name:'Concrete Sealing'}])
  if(table==='assignments')return send(snapshotAssignments)
  if(table==='call_log')return send([{...callLog,jobs:jobs.map(({job_id,deleted,merged_into_job_id})=>({job_id,deleted,merged_into_job_id}))}])
  if(table==='jobs'){
    let rows=jobs
    if(url.searchParams.has('job_id'))rows=rows.filter(j=>String(j.job_id)===url.searchParams.get('job_id').replace('eq.',''))
    if(url.searchParams.get('merged_into_job_id')==='is.null')rows=rows.filter(j=>j.merged_into_job_id==null)
    if(url.searchParams.has('or'))rows=rows.filter(j=>j.deleted!=='Yes')
    return send(req.headers().accept?.includes('vnd.pgrst.object')?rows[0]:rows)
  }
  if(table==='job_mobilizations'){
    let rows=mobs
    const filter=url.searchParams.get('job_id')
    if(filter?.startsWith('eq.'))rows=rows.filter(m=>String(m.job_id)===filter.slice(3))
    if(filter?.startsWith('in.')){const ids=filter.slice(4,-1).split(',');rows=rows.filter(m=>ids.includes(String(m.job_id)))}
    return send(rows)
  }
  return send([])
})
async function view(path){await page.evaluate(path=>window.testNavigate(path),path)}
async function modal(){
  await view('/settings');await page.getByRole('button',{name:'+ Job',exact:true}).click()
  await page.getByPlaceholder('🔎 Search existing job by #, customer…').fill('7215')
  await page.locator('.mwt-row').first().waitFor()
  assert.equal(await page.locator('.mwt-row').count(),1,'Search must omit combined and deleted jobs')
  await page.locator('.mwt-row').click()
  await page.getByRole('combobox',{name:'Crew lead'}).selectOption('Bash Dave')
  await page.getByPlaceholder('Trip label (optional)').fill('WTC1 - Concrete Sealing')
  await page.locator('.mdl input[type=number]').fill('3')
  await page.locator('.mdl input[type=date]').nth(0).fill('2026-10-12')
  await page.locator('.mdl input[type=date]').nth(1).fill('2026-10-13')
}
async function verifyViews(){
  await view('/schedule')
  const row=page.locator('.sch-board-row-wrap').filter({hasText:'7215'})
  await row.waitFor();assert.equal(await row.count(),1)
  assert.match(await row.innerText(),/0\/3 crew.*Lead: Bash Dave/s)
  assert.equal(await row.locator('.sch-brd-needs-crew').count(),2,'Crew board must mark exactly Monday and Tuesday as needing crew')
  await page.screenshot({path:'/private/tmp/codex-allocation-schedule.png'})
  await view('/calendar')
  const bar=page.locator('.cal-bar[title*="Bash Dave"]').filter({hasText:'7215'})
  await bar.waitFor();assert.equal(await bar.count(),1)
  assert.match(await bar.getAttribute('title'),/3 crew.*Bash Dave/)
  assert.equal(await bar.evaluate(el=>el.style.gridColumn),'2 / 4','October month row: Monday + Tuesday only')
  await page.locator('select').filter({has:page.locator('option', {hasText:'All Crews'})}).selectOption('Bash Dave')
  assert.equal(await bar.count(),1,'Filtering by allocation lead must retain the bar')
  await page.screenshot({path:'/private/tmp/codex-allocation-calendar.png'})
  await view('/daily')
  const card=page.locator('.dly-card').filter({hasText:'7215'})
  await card.waitFor();assert.equal(await card.locator('.dly-card-badge').textContent(),'0/3')
  assert.match(await card.innerText(),/Lead: Bash Dave/i)
  assert.equal(await card.locator('.dly-alert').count(),2,'Daily gaps must be only October 12 and 13')
  await page.screenshot({path:'/private/tmp/codex-allocation-daily.png'})
}
try{
 await page.goto('http://127.0.0.1:5190/__allocation-test')
 await page.waitForFunction(()=>typeof window.testNavigate==='function')
 if (process.env.SCHEDULE_SNAPSHOT) {
   await verifyViews()
   await page.reload();await page.waitForFunction(()=>typeof window.testNavigate==='function');await verifyViews()
   assert.equal(mutations.length,0)
   assert.equal(runtimeErrors.length,0)
   console.log('PASS repaired database snapshot renders in all three real views after reload; no mutations or runtime errors.')
 } else {
 await modal()
 // A job combined after search was opened must fail visibly, with no insert.
 main.merged_into_job_id=9000
 await page.getByRole('button',{name:'Add Trip',exact:true}).click()
 await page.getByText(/This job was combined into another record/).waitFor()
 assert.equal(mobs.length,0);main.merged_into_job_id=null
 console.log('PASS search excludes combined/deleted records; stale selection rejected without saving.')
 // The shared helper also protects callers other than this modal.
 for(const jobId of [1199,1200]){
  const result=await page.evaluate(async id=>{const r=await window.testAdd(id,{seq:1,label:'must not save'},'test');return r.error?.message},jobId)
  assert.match(result,/combined|deleted/)
 }
 assert.equal(mutations.filter(x=>x.table==='job_mobilizations').length,0)
 // Failed inserts must not close the dialog or show success.
 failInsert=true;await page.getByRole('button',{name:'Add Trip',exact:true}).click()
 await page.getByText('Fixture insert failure',{exact:true}).waitFor()
 assert(await page.getByRole('heading',{name:'Add to Schedule'}).isVisible());failInsert=false
 await page.getByRole('button',{name:'Add Trip',exact:true}).click()
 await page.getByRole('heading',{name:'Add to Schedule'}).waitFor({state:'hidden'})
 assert.equal(mobs.length,1);assert.equal(mobs[0].job_id,1150);assert.equal(mobs[0].lead,'Bash Dave')
 console.log('PASS actual modal save uses main record; failed save remains visible.')
 await verifyViews()
 await page.reload();await page.getByRole('button',{name:'+ Job',exact:true}).waitFor();await verifyViews()
 console.log('PASS saved allocation reloaded in Crew Schedule, Calendar (including lead filter), and Daily on October 12–13; 0/3 assigned shown honestly.')
 // Calendar must also work when dates exist only on the allocation.
 main.start_date=null;main.end_date=null;await view('/settings');await verifyViews()
 console.log('PASS allocation-only dates (no parent dates) remain visible on all three views.')
 assert.equal(runtimeErrors.length,0,JSON.stringify(runtimeErrors))
 console.log('PASS no runtime errors; all database requests intercepted, zero real DB traffic.')
 }
} finally {await browser.close();await server.close()}
