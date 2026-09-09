// Real React browser checks with intercepted fixtures; no live database access.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.VITE_SUPABASE_URL = 'https://schedule-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'codex-fixture-only'
const server = await createServer({root:resolve('.'),server:{host:'127.0.0.1',port:5192,strictPort:true},plugins:[{
  name:'crew-week-test',
  resolveId(id){if(id==='virtual:crew-week')return '\0crew-week'},
  load(id){if(id!=='\0crew-week')return;return `import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemoryRouter,useNavigate,Routes,Route} from 'react-router-dom';
    import ScheduleLayout from '/src/schedule/ScheduleLayout.jsx';
    function Harness(){window.testNavigate=useNavigate();return React.createElement(Routes,null,React.createElement(Route,{path:'/schedule/*',element:React.createElement(ScheduleLayout,{teamMember:{name:'Fixture admin',role:'Admin'}})}))}
    createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/schedule/schedule']},React.createElement(Harness)));`},
  configureServer(vite){vite.middlewares.use('/__crew-week',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__crew-week','<html><body><div id="root"></div><script type="module">import "virtual:crew-week"</script></body></html>'))})},
}]})
await server.listen()
let browser
try {
  browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
  const page = await browser.newPage({viewport:{width:1600,height:1050},timezoneId:'America/Los_Angeles'})
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00-07:00'))
  page.setDefaultTimeout(10000)
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  const crew=['Alex','Blair','Casey','Drew'].map(name=>({name,archived:false,team:'1'}))
  const jobs=[{job_id:1,call_log_id:10,job_num:'7215',job_name:'Warehouse',status:'Scheduled',deleted:'No',merged_into_job_id:null,start_date:'2026-09-07',end_date:'2026-09-12',crew_needed:null,job_wtcs:[],call_log:{id:10,job_number:7215,job_name:'Warehouse',customer_name:'Fixture'}}]
  const mobs=[{id:'baseline',job_id:1,seq:3,label:'Original work',start_date:'2026-09-07',end_date:'2026-09-12',crew_needed:0},{id:'return',job_id:1,seq:1,label:'October sealing',start_date:'2026-10-12',end_date:'2026-10-13',crew_needed:4},
    {id:'unknown',job_id:1,seq:2,label:'Check overlap',start_date:'2026-10-13',end_date:'2026-10-13',crew_needed:null}]
  const assignments=[{job_id:1,crew_name:'Alex',date:'2026-09-08'},
    {job_id:1,crew_name:'Blair',date:'2026-10-12'},{job_id:1,crew_name:'Casey',date:'2026-10-12'}]
  let delayWeek=null, failWeek=null, failTrips=false
  const requests=[]
  const pending=[]
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url())
    if(url.hostname==='127.0.0.1')return route.continue()
    if(url.hostname!=='schedule-fixture.supabase.co')return route.abort()
    const table=url.pathname.split('/').pop()
    const send=(data,status=200)=>route.fulfill({status,headers:{'content-type':'application/json','access-control-allow-origin':'*'},body:JSON.stringify(data)})
    if(req.method()==='OPTIONS')return send([])
    assert.equal(req.method(),'GET','This suite must never mutate database rows')
    const week=url.searchParams.getAll('date').find(x=>x.startsWith('gte.'))?.slice(4)
    requests.push({table,week})
    if((table==='assignments'||table==='crew_status')&&week===delayWeek)await new Promise(resolve=>pending.push(resolve))
    if((table==='assignments'||table==='crew_status')&&week===failWeek)return send({message:'Fixture week unavailable'},400)
    if(table==='crew')return send(crew)
    if(table==='jobs')return send(jobs)
    if(table==='job_mobilizations')return failTrips?send({message:'Fixture trips unavailable'},400):send(mobs)
    if(table==='assignments'||table==='crew_status'){
      const source=table==='assignments'?assignments:[]
      const end=url.searchParams.getAll('date').find(x=>x.startsWith('lte.'))?.slice(4)
      return send(source.filter(a=>(!week||a.date>=week)&&(!end||a.date<=end)))
    }
    return send([])
  })
  const next=()=>page.locator('.sch-wknav').getByRole('button',{name:'Next',exact:true}).click()
  const navigate=path=>page.evaluate(path=>window.testNavigate(path),path)
  const badge=label=>page.getByRole('button',{name:new RegExp(label)})
  async function ready(label){console.log('Checking week:',label);await page.waitForFunction(label=>document.querySelector('.hcs-week')?.textContent===label&&document.querySelector('.hcs-badge-button'),label).catch(async error=>{console.error('Page:',await page.locator('body').innerText());console.error('Runtime errors:',errors);throw error})}
  await page.goto('http://127.0.0.1:5192/__crew-week')
  await ready('Sep 7 – Sep 12, 2026')
  assert.equal(await page.locator('.hcs').count(),1)
  assert.equal(await page.locator('.sch-week-changed').count(),0,'No glow on initial load')
  assert.equal(await badge('Jobs Starting').locator('.hcs-badge-circle').textContent(),'1')
  assert.equal(await badge('Jobs Needing Crew').locator('.hcs-badge-circle').textContent(),'0')
  assert.match(await page.locator('.hcs-day').nth(1).innerText(),/1 \/ 4/)
  // Prove stale values disappear before the next week's response arrives.
  delayWeek='2026-09-14'
  await next()
  await page.getByText('Loading selected week…').waitFor()
  assert.equal(await page.locator('.hcs-week').textContent(),'Sep 14 – Sep 19, 2026')
  assert.equal(await page.locator('.sch-wklbl').textContent(),'Sep 14 – Sep 19, 2026')
  assert.equal(await page.locator('.sch-week-changed').count(),2)
  assert.equal(await page.locator('.hcs-day').count(),0)
  assert.equal(await page.locator('.sch-board-row-wrap').count(),0)
  // A slow previous response must not overwrite the final selection.
  await next()
  await ready('Sep 21 – Sep 26, 2026')
  delayWeek=null;pending.splice(0).forEach(resolve=>resolve())
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.hcs-week').textContent(),'Sep 21 – Sep 26, 2026')
  assert.equal(await badge('Jobs Starting').locator('.hcs-badge-circle').textContent(),'0')
  await badge('Jobs Starting').click()
  await page.getByRole('dialog').getByText('No matching jobs this week.').waitFor()
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
  // All navigation controls feed both dates.
  await page.locator('.sch-wknav').getByRole('button',{name:'Prev',exact:true}).click()
  await ready('Sep 14 – Sep 19, 2026')
  await page.locator('.sch-wknav').getByRole('button',{name:'This Week',exact:true}).click()
  await ready('Sep 7 – Sep 12, 2026')
  // Remount via a different route, then open a future trip deep link.
  await navigate('/schedule/materials')
  await page.getByRole('button',{name:'View Crew Schedule →'}).waitFor()
  assert.match(await page.locator('.hcs-badges').innerText(),/Crew Available/i,'Other screens keep their existing summary')
  await navigate('/schedule/schedule?job=1&week=2026-10-12')
  await ready('Oct 12 – Oct 17, 2026')
  assert.equal(await badge('Jobs Starting').locator('.hcs-badge-circle').textContent(),'1')
  assert.equal(await badge('Jobs Ending').locator('.hcs-badge-circle').textContent(),'1')
  assert.equal(await badge('Jobs Needing Crew').locator('.hcs-badge-circle').textContent(),'1')
  assert.equal(await page.locator('.hcs-day-today').count(),0)
  await badge('Jobs Starting').click()
  await page.getByRole('dialog').getByRole('button',{name:'October sealing →',exact:true}).waitFor()
  await page.getByRole('dialog').getByRole('button',{name:'Check overlap →',exact:true}).waitFor()
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
  await badge('Jobs Needing Crew').click()
  assert.match(await page.getByRole('dialog').innerText(),/2 \/ 4 assigned · needs 2 more/)
  await page.getByRole('dialog').getByRole('button',{name:/Also check/}).click()
  assert.match(await page.getByRole('dialog').innerText(),/0 assigned · Crew requirement not set/)
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
  await page.locator('.hcs-day').first().click()
  assert.match(await page.locator('.sch-modal').innerText(),/Blair/)
  assert.match(await page.locator('.sch-modal').innerText(),/Casey/)
  await page.locator('.sch-modal').getByRole('button',{name:/^close$/i}).click()
  // Every list opens the exact job/trip editor on the board without another search.
  for (const label of ['Jobs Starting','Jobs Ending','Jobs Needing Crew']) {
    await badge(label).click()
    await page.getByRole('dialog').getByRole('button',{name:'October sealing →',exact:true}).first().click()
    await page.locator('[data-schedule-trip-id="return"]').waitFor()
    assert.equal(await page.getByRole('dialog').count(),0)
    assert.equal(await page.locator('[data-trip-row="return"]').getByRole('combobox',{name:'Select trip title'}).inputValue(),'return')
  }
  await page.getByRole('button',{name:'1 job: crew requirements unclear',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Check overlap →',exact:true}).click()
  await page.locator('[data-schedule-trip-id="unknown"]').waitFor()
  assert.equal(await page.locator('[data-trip-row="unknown"]').getByRole('combobox',{name:'Select trip title'}).inputValue(),'unknown')
  const returnRow=page.locator('[data-trip-row="return"]')
  const unknownRow=page.locator('[data-trip-row="unknown"]')
  await page.screenshot({path:'/private/tmp/crew-week-summary.png',fullPage:true})
  await returnRow.getByRole('textbox',{name:'Trip notes',exact:true}).fill('Keep this draft')
  await next()
  assert.equal(await page.locator('.hcs-week').textContent(),'Oct 12 – Oct 17, 2026')
  assert.equal(await returnRow.getByRole('textbox',{name:'Trip notes',exact:true}).inputValue(),'Keep this draft')
  await unknownRow.getByRole('textbox',{name:'Trip notes',exact:true}).fill('Sibling draft')
  await returnRow.getByRole('button',{name:'Cancel',exact:true}).click()
  await next()
  assert.equal(await page.locator('.hcs-week').textContent(),'Oct 12 – Oct 17, 2026','Cancelling one trip must not clear another trip’s draft guard')
  await unknownRow.getByRole('button',{name:'Cancel',exact:true}).click()

  await page.emulateMedia({reducedMotion:'reduce'})
  failWeek='2026-10-19'
  await next()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.hcs-badge-button').count(),0,'Failure must not masquerade as zero')
  assert.equal(await page.locator('.sch-wklbl').evaluate(el=>getComputedStyle(el).animationName),'none')
  failWeek=null
  await page.getByRole('button',{name:'Retry',exact:true}).click()
  await ready('Oct 19 – Oct 24, 2026')
  // Trip load errors are visible and retryable, not silently parent-only totals.
  await navigate('/schedule/materials')
  failTrips=true
  await navigate('/schedule/schedule')
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(),/Fixture trips unavailable/)
  failTrips=false
  await page.getByRole('button',{name:'Retry',exact:true}).click()
  await ready('Sep 7 – Sep 12, 2026')
  assert.equal(await page.locator('.hcs').count(),1)
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00-07:00'))
  await navigate('/schedule/materials')
  await navigate('/schedule/schedule?job=1&week=2026-10-12')
  await ready('Oct 12 – Oct 17, 2026')
  assert.equal(await page.locator('.hcs-check-needs').count(),0,'Past weeks should not prompt crew requirement cleanup')
  await badge('Jobs Needing Crew').click()
  await page.getByRole('dialog').getByRole('button',{name:'View historical crew details for 1 job',exact:true}).click()
  const historical=page.getByRole('dialog',{name:'Historical Crew Details'})
  assert.match(await historical.innerText(),/0 assigned · Crew requirement not recorded/)
  assert.doesNotMatch(await historical.innerText(),/requirements need checking/)
  await historical.getByRole('button',{name:'Check overlap →',exact:true}).click()
  await page.locator('[data-schedule-trip-id="unknown"]').waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS shared weeks, all controls, deep links, glow/reduced motion, trip counts/details, daily people, loading/races, error/retry, unchanged Logistics header, direct editor links, and historical wording.')
  console.log('Screenshot: /private/tmp/crew-week-summary.png')
} catch(error) { console.error(error); throw error } finally {if(browser)await browser.close();await server.close()}
