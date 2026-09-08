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
        import {MemoryRouter,useNavigate,useLocation} from 'react-router-dom';
        import ScheduleLayout from '/src/schedule/ScheduleLayout.jsx';
        import StageJobCard from '/src/schedule/components/StageJobCard.jsx';
        import {UserProvider} from '/src/schedule/lib/user.jsx';
        import {addJobMobilization} from '/src/schedule/lib/queries.js';
        import {printWeekSchedule} from '/src/schedule/lib/exports.js';
        window.testAdd = addJobMobilization;
        window.testPrintWeek = printWeekSchedule;
        function Harness(){window.testNavigate=useNavigate();const location=useLocation();
          if(location.pathname==='/test-job')return React.createElement('div',{className:'schedule-root'},React.createElement(UserProvider,{teamMember:{name:'Codex regression'}},React.createElement(StageJobCard,{job:${JSON.stringify(main)},stage:'active',autoOpen:true})));
          return React.createElement(ScheduleLayout,{teamMember:{name:'Codex regression',role:'Admin'}})}
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
      if(req.method()==='PATCH'){
        const row=mobs.find(m=>`eq.${m.id}`===url.searchParams.get('id')&&`eq.${m.job_id}`===url.searchParams.get('job_id'))
        if(!row)return send({message:'Trip no longer belongs to this job'},406)
        Object.assign(row,payload);return send(row)
      }
      const row={id:'test-trip-'+(mobs.length+1),...payload};mobs.push(row);return send(row)
    }
    return send([])
  }
  if(table==='crew')return send([{name:'Bash Dave',team:'1',archived:false},{name:'Smith, Jane',team:'1',archived:false},{name:'Sales-looking inactive',archived:true}])
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
 // Review regression: blank requirements are UNKNOWN, not an explicitly zero target.
 mobs[0].crew_needed=null
 await view('/settings');await view('/daily')
 let card=page.locator('.dly-card').filter({hasText:'7215'})
 await card.waitFor()
 assert.equal(await card.locator('.dly-card-badge').innerText(),'0/?')
 assert.equal(await card.locator('.dly-alert').count(),2)
 assert.equal(await card.locator('.dly-alert').first().getAttribute('title'),'Crew requirement not set')
 assert.match(await card.getAttribute('class'),/dly-card-gap/)
 // Explicit zero stays distinct from blank, including when parent target is set.
 mobs[0].crew_needed=0;main.crew_needed=3
 await view('/settings');await view('/daily');await card.waitFor()
 assert.equal(await card.locator('.dly-card-badge').innerText(),'0/0')
 assert.equal(await card.locator('.dly-alert').count(),0)
 console.log('PASS unknown crew need stays 0/? with warnings; explicit zero stays 0/0 without a false gap.')
 // Two separate trips in one week must use the correct target and lead each day.
 main.crew_needed=null
 mobs=[{...mobs[0],id:'early',start_date:'2026-10-12',end_date:'2026-10-13',crew_needed:1,lead:'Bash Dave',vehicle:'Truck 1',equipment:'Grinder'},
       {...mobs[0],id:'late',seq:2,start_date:'2026-10-15',end_date:'2026-10-16',crew_needed:4,lead:'Smith, Jane',vehicle:'Truck 2',equipment:'Sprayer'}]
 snapshotAssignments=['2026-10-12','2026-10-13','2026-10-15','2026-10-16'].map((date,i)=>({id:i+1,job_id:1150,crew_name:'Bash Dave',date,mobilization_id:i<2?'early':'late'}))
 await view('/settings');await view('/daily');await card.waitFor()
 assert.equal(await card.locator('.dly-card-badge').innerText(),'Needs vary by day')
 assert.deepEqual(await card.locator('.dly-alert').allTextContents(),['1/4','1/4'])
 assert.match(await card.locator('.dly-staffing-row .dly-cell').nth(0).innerText(),/1.*Bash Dave/s)
 assert.match(await card.locator('.dly-staffing-row .dly-cell').nth(3).innerText(),/4.*Smith, Jane/s)
 await page.screenshot({path:'/private/tmp/codex-review-daily-multiple.png'})
 await view('/schedule')
 const multiRow=page.locator('.sch-board-row-wrap').filter({hasText:'7215'})
 await multiRow.waitFor()
 assert.equal(await multiRow.locator('.sch-brd-cell').nth(0).getByText('need 3',{exact:true}).count(),0)
 assert.match(await multiRow.locator('.sch-brd-cell').nth(3).innerText(),/need 3/)
 assert.match(await multiRow.locator('.sch-brd-cell').nth(3).innerText(),/Jane Smith/)
 assert.match(await multiRow.locator('.sch-brd-cell').nth(0).innerText(),/Bash Dave/)
 assert.equal(await multiRow.locator('.sch-trip-label').count(),2,'Show both trips in the viewed week')
 assert.match(await multiRow.locator('.sch-trip-label').nth(0).innerText(),/Oct 12, 2026.*Oct 13, 2026/s)
 assert.match(await multiRow.locator('.sch-trip-label').nth(1).innerText(),/Oct 15, 2026.*Oct 16, 2026/s)
 await page.screenshot({path:'/private/tmp/codex-review-schedule-multiple.png'})
 console.log('PASS Monday/Tuesday need 1; Thursday/Friday need 4 and flag the shortage, with the correct leads in Daily and Crew Schedule.')
 const [printPage]=await Promise.all([page.waitForEvent('popup'),page.evaluate(()=>window.testPrintWeek())])
 const printedJob=printPage.locator('tbody tr').filter({hasText:'7215'})
 await printedJob.waitFor()
 assert.equal(await printedJob.locator('td').nth(3).innerText(),'Mon: 1; Tue: 1; Thu: 4; Fri: 4')
 assert.equal(await printedJob.locator('td').nth(5).innerText(),'Mon: Truck 1; Tue: Truck 1; Thu: Truck 2; Fri: Truck 2')
 assert.equal(await printedJob.locator('td').nth(6).innerText(),'Mon: Grinder; Tue: Grinder; Thu: Sprayer; Fri: Sprayer')
 await printPage.close()
 console.log('PASS weekly printout also preserves the differing daily crew, vehicle, and equipment requirements.')
 // Bounded review: prove the actual Add to Schedule writer preserves zero vs blank.
 mobs=[];snapshotAssignments=[];main.crew_needed=3
 await modal()
 for (const invalid of ['-1','1.5']) {
   await page.getByPlaceholder('Crew #',{exact:true}).fill(invalid)
   await page.getByRole('button',{name:'Add Trip',exact:true}).click()
   await page.getByText('Crew needed must be a whole number of zero or more.',{exact:true}).first().waitFor()
   assert.equal(mobs.length,0,'Invalid crew counts must not create a trip')
 }
 await page.getByPlaceholder('Crew #',{exact:true}).fill('0')
 await page.getByRole('button',{name:'Add Trip',exact:true}).click()
 await page.getByRole('heading',{name:'Add to Schedule'}).waitFor({state:'hidden'})
 assert.equal(mobs[0].crew_needed,0,'An entered zero must be stored as zero, not null')
 await view('/daily');await card.waitFor()
 assert.equal(await card.locator('.dly-card-badge').innerText(),'0/0')
 assert.equal(await card.locator('.dly-alert').count(),0)
 await page.reload();await page.getByRole('button',{name:'+ Job',exact:true}).waitFor()
 await view('/daily');await card.waitFor()
 assert.equal(await card.locator('.dly-card-badge').innerText(),'0/0')
 mobs=[]
 await modal()
 await page.getByPlaceholder('Crew #',{exact:true}).fill('')
 await page.getByRole('button',{name:'Add Trip',exact:true}).click()
 await page.getByRole('heading',{name:'Add to Schedule'}).waitFor({state:'hidden'})
 assert.equal(mobs[0].crew_needed,null,'Blank intentionally inherits the job requirement')
 await view('/daily');await card.waitFor()
 assert.equal(await card.locator('.dly-card-badge').innerText(),'0/3')
 console.log('PASS actual Add to Schedule rejects invalid counts, stores zero through reload, and preserves blank-as-inherit.')
 // Real Jobs card -> shared editor -> real Crew Schedule -> same editor -> Jobs.
 mobs=[{...mobs[0],id:'cross-trip',label:'WTC1 - Concrete Sealing',note:'Initial trip note',vehicle:'Truck 2',equipment:'Grinder',power_source:'Generator',sow:'Seal the concrete.'},
       {...mobs[0],id:'november-trip',seq:2,label:'November return',start_date:'2026-11-02',end_date:'2026-11-03'}]
 const beforeCross=mutations.length
 await view('/test-job')
 await page.getByRole('button',{name:'TRIPS',exact:true}).click()
 const trip=page.locator('[data-trip-id="cross-trip"]')
 await trip.locator('.job-trip-summary').click()
 await trip.getByRole('button',{name:'Edit trip',exact:true}).click()
 let editor=page.getByRole('dialog',{name:'Edit trip',exact:true})
 await editor.getByLabel('Trip notes',{exact:true}).fill('TEST from Jobs')
 await editor.getByRole('button',{name:'Save',exact:true}).click()
 await editor.waitFor({state:'hidden'})
 assert.equal(mobs[0].note,'TEST from Jobs')
 await view('/schedule')
 const crossRow=page.locator('.sch-board-row-wrap').filter({hasText:'7215'})
 await crossRow.waitFor()
 assert.equal(await crossRow.locator('.sch-trip-label').count(),1,'November trip must not label October')
 assert.match(await crossRow.locator('.sch-trip-label').innerText(),/WTC1 - Concrete Sealing/)
 await crossRow.locator('.sch-brd-job-label').click()
 const details=crossRow.locator('[data-schedule-trip-id="cross-trip"]')
 await details.waitFor()
 assert.match(await details.innerText(),/Bash Dave.*Truck 2.*Grinder.*Generator.*Seal the concrete.*TEST from Jobs/s)
 assert.equal(await crossRow.locator('.sch-job-defaults').getAttribute('open'),null)
 await page.screenshot({path:'/private/tmp/codex-schedule-trip-details.png'})
 await details.getByRole('button',{name:'Edit trip',exact:true}).click()
 editor=page.getByRole('dialog',{name:'Edit trip',exact:true})
 await editor.getByLabel('Trip label',{exact:true}).fill('WTC1 - Concrete Sealing revised')
 await editor.getByLabel('Trip notes',{exact:true}).fill('Updated from Crew Schedule')
 await editor.getByLabel('Lead',{exact:true}).selectOption('Smith, Jane')
 await editor.getByRole('button',{name:'Save',exact:true}).click()
 await editor.waitFor({state:'hidden'})
 await details.getByText('Updated from Crew Schedule',{exact:true}).waitFor()
 assert.match(await details.innerText(),/Jane Smith/)
 assert.match(await crossRow.locator('.sch-trip-label').innerText(),/revised/)
 await view('/test-job')
 await page.getByRole('button',{name:'TRIPS',exact:true}).click()
 await trip.locator('.job-trip-summary').click()
 assert.match(await trip.innerText(),/revised.*Jane Smith.*Updated from Crew Schedule/s)
 assert.equal(mobs.length,2,'Editing must preserve the same trip, without inserts')
 assert.equal(mobs[0].id,'cross-trip')
 assert.equal(mobs[0].vehicle,'Truck 2')
 assert.equal(main.lead,null,'Trip lead must not overwrite the job default')
 assert.equal(snapshotAssignments.length,0,'Choosing a trip lead must not fabricate day assignments')
 assert.deepEqual(mutations.slice(beforeCross).filter(m=>m.table!=='job_changes').map(m=>[m.table,m.method]),[['job_mobilizations','PATCH'],['job_mobilizations','PATCH']])
 console.log('PASS Jobs and Crew Schedule read/edit the same trip title, lead and notes; immediate refresh; other weeks excluded; no duplicate trips, job-default writes or crew assignments.')
 assert.equal(runtimeErrors.length,0,JSON.stringify(runtimeErrors))
 console.log('PASS no runtime errors; all database requests intercepted, zero real DB traffic.')
 }
} finally {await browser.close();await server.close()}
