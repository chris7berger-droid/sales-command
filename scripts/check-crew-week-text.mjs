// Intercepted React browser checks: no production credentials or data writes.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.VITE_SUPABASE_URL = 'https://schedule-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'fixture-only'
const server = await createServer({ root: resolve('.'), server: { host: '127.0.0.1', port: 5196, strictPort: true }, plugins: [{
  name: 'weekly-text-check',
  resolveId(id) { if (id === 'virtual:weekly-text') return '\0weekly-text' },
  load(id) { if (id !== '\0weekly-text') return; return `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MemoryRouter,useNavigate,Routes,Route} from 'react-router-dom';
    import ScheduleLayout from '/src/schedule/ScheduleLayout.jsx';
    import {GLOBAL_CSS} from '/src/lib/tokens.js';
    function Harness(){window.testNavigate=useNavigate();return React.createElement(React.Fragment,null,
      React.createElement('style',null,GLOBAL_CSS),React.createElement(Routes,null,
      React.createElement(Route,{path:'/schedule/*',element:React.createElement(ScheduleLayout,{teamMember:{name:'Fixture admin',role:'Admin'}})})))}
    createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/schedule/schedules?week=2026-09-07']},React.createElement(Harness)));` },
  configureServer(vite) { vite.middlewares.use('/__weekly-text', async (_req,res) => {
    res.setHeader('Content-Type','text/html')
    res.end(await vite.transformIndexHtml('/__weekly-text','<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import "virtual:weekly-text"</script></body></html>'))
  }) },
}] })
await server.listen()
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, permissions:['clipboard-read','clipboard-write'] })
  const page = await context.newPage()
  const errors=[]
  page.on('pageerror', e => errors.push(e.message))
  const jobs=[{job_id:1,call_log_id:10,job_num:'6618',job_name:'Lakes Crossing',status:'Scheduled',start_date:'2026-08-01',end_date:'2026-08-02',lead:'Old Lead',vehicle:'Box 3',deleted:'No',deferred_days:'2026-09-13',deferred_time:'09:00',
    call_log:{id:10,job_name:'Lakes Crossing',display_job_number:'6618',jobsite_address:'123 Example Way',jobsite_city:'Las Vegas'},notes:'PRIVATE OFFICE NOTE'}]
  const crew=[{name:'JoseJR'},{name:'Kurtis Zomparelli'},{name:'No Assignments'}]
  const trips=[{id:'burnish',job_id:1,seq:1,label:'Final Burnish',start_date:'2026-09-11',end_date:'2026-09-13',lead:'Kurtis Zomparelli'},
    {id:'seal',job_id:1,seq:2,label:'Seal',start_date:'2026-09-11',end_date:'2026-09-11',lead:'Wrong Lead'}]
  const assignments=[{id:1,job_id:1,date:'2026-09-11',crew_name:'JoseJR',mobilization_id:'burnish'},
    {id:2,job_id:1,date:'2026-09-11',crew_name:'Kurtis Zomparelli',mobilization_id:'burnish'},
    {id:3,job_id:1,date:'2026-09-11',crew_name:'Wrong Coworker',mobilization_id:'seal'},
    {id:4,job_id:1,date:'2026-09-13',crew_name:'JoseJR',mobilization_id:'burnish'}]
  let failTable=null, delayWeek=null
  const pending=[]
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url())
    if(url.hostname==='127.0.0.1')return route.continue()
    if(url.hostname!=='schedule-fixture.supabase.co')return route.abort()
    const table=url.pathname.split('/').pop()
    const send=(data,status=200)=>route.fulfill({status,headers:{'content-type':'application/json','access-control-allow-origin':'*'},body:JSON.stringify(data)})
    if(req.method()==='OPTIONS')return send([])
    assert.equal(req.method(),'GET','No database mutations allowed')
    const week=url.searchParams.getAll('date').find(v=>v.startsWith('gte.'))?.slice(4)
    const end=url.searchParams.getAll('date').find(v=>v.startsWith('lte.'))?.slice(4)
    if(table==='assignments' && week===delayWeek)await new Promise(resolve=>pending.push(resolve))
    if(table===failTable)return send({message:'Fixture unavailable'},400)
    if(table==='jobs')return send(jobs)
    if(table==='crew')return send(crew)
    if(table==='job_mobilizations')return send(trips)
    if(table==='assignments')return send(assignments.filter(a=>(!week||a.date>=week)&&(!end||a.date<=end)))
    return send([])
  })
  await page.goto('http://127.0.0.1:5196/__weekly-text')
  const preview=page.getByRole('textbox',{name:'Text preview',exact:true})
  await preview.waitFor()
  let text=await preview.inputValue()
  assert.match(text,/Lead: Kurtis Zomparelli/)
  assert.match(text,/With: Kurtis Zomparelli/)
  assert.match(text,/Address: 123 Example Way, Las Vegas/)
  assert.match(text,/SUNDAY, SEP 13[\s\S]*Final Burnish/)
  assert.doesNotMatch(text,/Wrong Lead|Wrong Coworker|PRIVATE OFFICE NOTE/)
  assert.match(text,/Start: Meet at the shop at 6:30 AM/)
  assert.match(text,/SUNDAY, SEP 13[\s\S]*Start: Delayed start 9:00 AM/)
  await page.getByLabel('Usual start / meeting instructions (optional)',{exact:true}).fill('Meet at shop at 6:30 AM')
  await page.getByRole('button',{name:'Copy JoseJR’s week',exact:true}).click()
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await preview.inputValue())
  await page.screenshot({path:'/private/tmp/weekly-crew-text-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No phone horizontal overflow')
  await page.screenshot({path:'/private/tmp/weekly-crew-text-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Next person →',exact:true}).click()
  assert.match(await preview.inputValue(),/^Kurtis Zomparelli\n/)
  assert.match(await preview.inputValue(),/With: JoseJR/)
  await page.getByRole('button',{name:'← Previous person',exact:true}).click()
  assert.match(await preview.inputValue(),/^JoseJR\n/)
  assert.match(await preview.inputValue(),/Meet at shop at 6:30 AM/)
  await page.getByRole('button',{name:'← Previous person',exact:true}).click()
  assert.match(await preview.inputValue(),/^Wrong Coworker\n/,'Previous wraps from first person to last')
  await page.getByRole('button',{name:'Next person →',exact:true}).click()
  assert.match(await preview.inputValue(),/^JoseJR\n/,'Next wraps from last person to first')
  await page.getByRole('combobox',{name:'Crew member',exact:true}).selectOption('No Assignments')
  assert.equal(((await preview.inputValue()).match(/No work assigned/g)||[]).length,7)
  // Rapid week navigation cannot expose a stale preview or copy control.
  delayWeek='2026-09-14'
  await page.getByRole('button',{name:'Next week →',exact:true}).click()
  await page.getByText('Loading weekly schedules…',{exact:true}).waitFor()
  assert.equal(await preview.count(),0)
  await page.getByRole('button',{name:'Next week →',exact:true}).click()
  await preview.waitFor()
  assert.match(await preview.inputValue(),/Week of 2026-09-21/)
  for(const release of pending)release()
  await page.getByRole('button',{name:'Copy No Assignments’s week',exact:true}).click()
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Week of 2026-09-21/)
  delayWeek=null
  for(const table of ['assignments','job_mobilizations','jobs','crew']) {
    failTable=table
    await page.getByRole('button',{name:'Refresh',exact:true}).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await preview.count(),0)
    failTable=null
    await page.getByRole('button',{name:'Retry',exact:true}).click()
    await preview.waitFor()
  }
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw new Error('denied')}}))
  await page.getByRole('button',{name:'Copy No Assignments’s week',exact:true}).click()
  await page.getByText('Clipboard unavailable. Select the preview text and copy it manually.',{exact:true}).waitFor()
  // Existing menu now opens the real screen rather than a placeholder modal.
  await page.getByRole('button',{name:'Actions ▾',exact:true}).click()
  await page.getByRole('button',{name:'Send Schedules',exact:true}).click()
  await page.getByRole('heading',{name:'Weekly crew texts',exact:true}).waitFor()
  // Board launch carries the week actually displayed.
  await page.evaluate(()=>window.testNavigate('/schedule/schedule?week=2026-10-12'))
  const launch=page.getByRole('button',{name:'Weekly crew texts',exact:true})
  await launch.waitFor()
  await page.waitForFunction(()=>document.querySelector('.sch-wklbl')?.textContent.includes('Oct 12'))
  await launch.click()
  await preview.waitFor()
  assert.match(await preview.inputValue(),/Week of 2026-10-12/)
  assert.deepEqual(errors,[])
  console.log('PASS: complete weekly copy, daily crew/lead, Sunday, picker, phone layout, delayed weeks, read failures/retry, clipboard fallback, menu and board week link; no DB writes')
} finally {
  await browser?.close()
  await server.close()
}
