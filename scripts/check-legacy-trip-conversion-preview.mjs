// Deployed bundle + rehearsed snapshot. Every API call is intercepted; no live writes.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base=process.env.PREVIEW_URL
if(!base)throw new Error('PREVIEW_URL is required')
const snapshot=JSON.parse(readFileSync(process.env.CREW_SNAPSHOT||'/private/tmp/legacy-trips-rehearsed.json','utf8')).rows[0].snapshot
const original=structuredClone(snapshot),writes=[],errors=[]
const user={id:'00000000-0000-0000-0000-000000000001',email:'fixture@example.test',aud:'authenticated',role:'authenticated'}
const session={access_token:'fixture-only',refresh_token:'fixture-only',expires_at:4102444800,expires_in:3600,token_type:'bearer',user}
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
const page=await browser.newPage({viewport:{width:1500,height:1100}})
page.setDefaultTimeout(15000)
page.on('pageerror',e=>errors.push(e.message))
await page.clock.setFixedTime(new Date('2026-09-10T12:00:00-07:00'))
if(existsSync('/private/tmp/trip-preview-cookies.txt')) {
 const cookies=readFileSync('/private/tmp/trip-preview-cookies.txt','utf8').split('\n').filter(l=>l&&(!l.startsWith('#')||l.startsWith('#HttpOnly_'))).map(l=>{
  const [domain,,path,secure,expires,name,value]=l.replace(/^#HttpOnly_/,'').split('\t')
  return {domain,path,secure:secure==='TRUE',expires:Number(expires)||-1,name,value,httpOnly:true}
 })
 await page.context().addCookies(cookies)
}
await page.addInitScript(session=>{for(const project of ['pbgvgjjuhnpsumnowuym','schedule-fixture'])localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify(session))},session)
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.origin===new URL(base).origin)return route.continue()
 if(!url.hostname.endsWith('.supabase.co'))return route.abort()
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)})
 if(req.method()==='OPTIONS')return send([])
 if(url.pathname.startsWith('/auth/'))return send(table==='user'?user:session)
 const matches=row=>[...url.searchParams].every(([k,v])=>v.startsWith('eq.')?String(row[k])===v.slice(3):v.startsWith('gte.')?row[k]>=v.slice(4):v.startsWith('lte.')?row[k]<=v.slice(4):v.startsWith('in.')?v.slice(4,-1).split(',').includes(String(row[k])):true)
 if(req.method()!=='GET') {
  writes.push({table,method:req.method(),payload:req.postDataJSON()})
  if(table==='job_changes')return send([])
  assert.equal(table,'job_mobilizations','Only explicit trip editing may write')
  assert.equal(req.method(),'PATCH')
  const rows=snapshot.trips.filter(matches);assert.equal(rows.length,1)
  Object.assign(rows[0],req.postDataJSON());return send(single?rows[0]:rows)
 }
 if(table==='team_members')return send(single?{...user,name:'Preview Fixture',role:'Admin',onboarded:true,apps:['sales','schedule']}:[])
 if(table==='tenant_config')return send({id:snapshot.jobs[0].tenant_id,company_name:'Preview Fixture',apps:['sales','schedule']})
 const data={jobs:snapshot.jobs.map(j=>({...j,job_wtcs:snapshot.wtcs.filter(w=>w.job_id===j.job_id)})),job_mobilizations:snapshot.trips,assignments:snapshot.assignments,crew:snapshot.crew,job_wtcs:snapshot.wtcs}[table]
 if(data) {
  const rows=data.filter(matches),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||rows.length)
  return send(single?rows[0]||null:rows.slice(offset,offset+limit))
 }
 return send([])
})
const sortTrips=(a,b)=>String(a.start_date||a.end_date||'9999-12-31').localeCompare(String(b.start_date||b.end_date||'9999-12-31'))||a.seq-b.seq||a.id.localeCompare(b.id)
async function inspectJob(job) {
 await page.goto(`${base}/schedule/jobs?job=${job.job_id}&panel=trips`)
 const panel=page.locator('.job-trips');await panel.locator('.job-trip').first().waitFor({timeout:30000})
 const trips=snapshot.trips.filter(t=>t.job_id===job.job_id).sort(sortTrips)
 assert.equal(await panel.locator('.job-trip').count(),trips.length)
 assert.equal(await panel.locator('[data-trip-id^="legacy:"], [data-trip-id^="job:"]').count(),0)
 assert.equal(await panel.locator('.job-schedule-reference').count(),1)
 for(const [i,t] of trips.entries()) {
  const card=panel.locator(`[data-trip-id="${t.id}"]`)
  assert((await card.locator('.job-trip-title strong').innerText()).startsWith(`Trip ${i+1}`))
  assert((await card.innerText()).includes(t.label))
  assert.equal(await card.getByText('Please update trip title.',{exact:true}).count(),/^Trip \d+$/.test(t.label)?1:0)
 }
 assert.equal(writes.length,0,'Opening Trips must not convert or modify records')
 await panel.screenshot({path:`/private/tmp/legacy-trips-${job.job_id}.png`})
 return trips
}
try {
 const tahoe=snapshot.jobs.find(j=>j.job_id===1179),holland=snapshot.jobs.find(j=>String(j.job_num).startsWith('7380'))
 assert(tahoe&&holland)
 await inspectJob(tahoe)
 const trips=await inspectJob(holland)
 const active=trips.find(t=>t.start_date<='2026-09-14'&&t.end_date>='2026-09-18'&&snapshot.assignments.some(a=>a.mobilization_id===t.id&&a.date==='2026-09-14'))
 assert(active,'7380 upcoming trip must exist with its saved crew')
 const card=page.locator(`[data-trip-id="${active.id}"]`)
 await card.locator('.job-trip-summary').click()
 await card.getByRole('button',{name:'Edit trip',exact:true}).click()
 const title=page.getByLabel('Trip title',{exact:true});await title.fill('   ')
 await page.getByRole('button',{name:'Save',exact:true}).click()
 assert.equal(writes.length,0)
 await title.fill('Fixture renamed trip')
 await page.getByRole('button',{name:'Save',exact:true}).click()
 await title.waitFor({state:'hidden'})
 assert.equal(snapshot.trips.find(t=>t.id===active.id).label,'Fixture renamed trip')
 assert.deepEqual(snapshot.assignments,original.assignments,'Renaming must preserve every crew row and UUID link')
 assert.deepEqual(snapshot.jobs,original.jobs)
 await page.goto(`${base}/schedule/schedule?job=${holland.job_id}&week=2026-09-14&trip=${active.id}`)
 const row=page.locator(`[data-trip-row="${active.id}"]`);await row.waitFor({timeout:30000})
 assert((await row.innerText()).includes('Fixture renamed trip'))
 assert.equal(await page.locator('[data-trip-row="unidentified"]').count(),0)
 assert.equal(await page.locator('[data-trip-row="job"]').count(),0)
 const unique=new Set(original.assignments.filter(a=>a.job_id===holland.job_id&&a.date>='2026-09-14'&&a.date<='2026-09-19').map(a=>a.crew_name)).size
 assert.match(await row.locator('.sch-brd-crew-info').innerText(),new RegExp(`${unique}/`))
 for(let i=0;i<6;i++) {
  const date=`2026-09-${14+i}`
  const expected=new Set(original.assignments.filter(a=>a.mobilization_id===active.id&&a.date===date).map(a=>a.crew_name)).size
  const cell=row.locator('.sch-brd-cell').nth(i)
  assert.equal(await cell.locator('.sch-brd-cnt').count(),expected?1:0)
  if(expected)assert.equal(Number(await cell.locator('.sch-brd-cnt').innerText()),expected)
 }
 await row.locator('.sch-brd-job-label').click()
 await page.screenshot({path:'/private/tmp/legacy-trips-7380-crew.png',fullPage:true})
 assert.deepEqual(errors,[])
 console.log(`PASS deployed bundle: 10088/7380 dates, chronological titles, reminder, no load writes, blank-title block, rename retains all ${snapshot.assignments.length} crew rows/links, staffed Crew Schedule row.`)
} catch(e) {console.error((await page.locator('body').innerText()).slice(0,2500));throw e} finally {await browser.close()}
