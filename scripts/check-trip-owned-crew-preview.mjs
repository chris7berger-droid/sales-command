// Runs the deployed app bundle; all Supabase requests are intercepted fixtures.
// Database predicate/trigger behavior is verified separately in command-suite-db.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.PREVIEW_URL
if (!base) throw new Error('PREVIEW_URL is required')
const project = 'pbgvgjjuhnpsumnowuym'
const user = { id:'00000000-0000-0000-0000-000000000001',email:'fixture@example.test',aud:'authenticated',role:'authenticated' }
const session={access_token:'fixture-only',refresh_token:'fixture-only',expires_at:4102444800,expires_in:3600,token_type:'bearer',user}
const job={job_id:1279,call_log_id:9001,job_num:'10262 - Flake Epoxy Garage',job_name:'Flake Epoxy Garage',status:'Ongoing',deleted:'No',lead:'Misa',crew_needed:3,start_date:'2026-09-14',end_date:'2026-09-18',job_wtcs:[]}
const empty={id:'62fc6ad1-a123-4b34-a635-52146191f8a1',job_id:1279,seq:1,label:'Flake Floor',start_date:'2026-09-14',end_date:'2026-09-16'}
const kept={id:'00000000-0000-0000-0000-000000000002',job_id:1279,seq:2,label:'Flake Floor',start_date:'2026-09-17',end_date:'2026-09-19'}
const people=['Luna, Daniel','Medina, Jacob','Ramirez, Jorge']
let trips=[empty], assignments=people.flatMap((crew_name,n)=>[17,18,19].map(d=>({id:n*3+d,job_id:1279,crew_name,date:`2026-09-${d}`,mobilization_id:null})))
const before=structuredClone(assignments), writes=[], errors=[]
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
const page=await browser.newPage({viewport:{width:1500,height:1100}})
if (existsSync('/private/tmp/trip-preview-cookies.txt')) {
 const cookies=readFileSync('/private/tmp/trip-preview-cookies.txt','utf8').split('\n').filter(l=>l && (!l.startsWith('#') || l.startsWith('#HttpOnly_'))).map(l=>{
  const [domain,,path,secure,expires,name,value]=l.replace(/^#HttpOnly_/,'').split('\t')
  return {domain,path,secure:secure==='TRUE',expires:Number(expires)||-1,name,value,httpOnly:true}
 })
 await page.context().addCookies(cookies)
}
page.setDefaultTimeout(12000)
page.on('pageerror',e=>errors.push(e.message))
await page.addInitScript(({project,session})=>localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify(session)),{project,session})
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.origin===new URL(base).origin) return route.continue()
 if(!url.hostname.endsWith('.supabase.co')) return route.abort()
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)})
 if(req.method()==='OPTIONS') return send([])
 if(url.pathname.startsWith('/auth/')) return send(table==='user'?user:session)
 const matches=row=>[...url.searchParams].every(([k,v])=>v.startsWith('eq.')?String(row[k])===v.slice(3):v.startsWith('gte.')?row[k]>=v.slice(4):v.startsWith('lte.')?row[k]<=v.slice(4):true)
 if(table==='check_schedule_deletion') {
  const {p_job_id,p_trip_id}=req.postDataJSON();assert.equal(p_job_id,1279)
  return send(assignments.some(a=>p_trip_id?a.mobilization_id===p_trip_id:a.job_id===p_job_id)?{code:'crew',message:'Cannot delete this trip — crew is still assigned. Remove or reassign crew from this trip in Crew Schedule, then return to delete it.'}:null)
 }
 if(req.method()!=='GET') {
  writes.push({table,method:req.method()})
  assert.equal(table,'job_mobilizations','Preview deletion must not mutate crew or parent')
  assert.equal(req.method(),'DELETE')
  const removed=trips.filter(matches);assert.deepEqual(removed.map(t=>t.id),[empty.id])
  trips=trips.filter(t=>!removed.includes(t));return send(removed.map(t=>({id:t.id})))
 }
 if(table==='team_members') return send(single?{...user,name:'Preview Fixture',role:'Admin',onboarded:true,apps:['sales','schedule']} : [])
 if(table==='tenant_config') return send({id:'fixture',company_name:'Preview Fixture',apps:['sales','schedule']})
 if(table==='jobs') return send(single?job:[job])
 if(table==='job_mobilizations') return send(trips.filter(matches))
 if(table==='assignments') return send(assignments.filter(matches))
 if(table==='crew') return send(people.map(name=>({name,team:'1',archived:false})))
 return send([])
})
try {
 const url=`${base}/schedule/schedule?job=1279&week=2026-09-14&trip=${empty.id}`
 await page.goto(url)
 const emptyRow=()=>page.locator(`[data-trip-row="${empty.id}"]`)
 await emptyRow().waitFor({timeout:30000})
 assert.match(await emptyRow().locator('.sch-brd-crew-info').innerText(),/0\/3/)
 await page.locator('[data-trip-row="unidentified"]').waitFor()
 await emptyRow().locator('.sch-brd-job-label').click()
 const title=emptyRow().getByLabel('Trip title',{exact:true})
 await title.fill('   ')
 await emptyRow().getByRole('button',{name:'Save trip',exact:true}).click()
 await emptyRow().getByText('Enter a trip title before saving.',{exact:true}).waitFor()
 assert.equal(writes.length,0,'Blank title must not write from the deployed editor')
 await page.screenshot({path:'/private/tmp/trip-title-preview-required.png',fullPage:true})
 await emptyRow().getByRole('button',{name:'Cancel',exact:true}).click()
 await emptyRow().getByRole('button',{name:'Delete trip',exact:true}).click()
 const dialog=()=>page.getByRole('alertdialog')
 await dialog().getByRole('button',{name:'Continue',exact:true}).waitFor()
 await page.screenshot({path:'/private/tmp/trip-owned-preview-empty.png',fullPage:true})
 await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
 assert.deepEqual(assignments,before)
 // Match dates deliberately: NULL links must still never staff the saved trip.
 assignments=assignments.map(a=>({...a,date:'2026-09-14'}))
 await page.reload();await emptyRow().waitFor()
 assert.match(await emptyRow().locator('.sch-brd-crew-info').innerText(),/0\/3/)
 await page.locator('[data-trip-row="unidentified"]').waitFor()
 // Model the authorized explicit repair, preserving each person/date/record ID.
 trips=[empty,kept];assignments=before.map(a=>({...a,mobilization_id:kept.id}))
 await page.reload();await emptyRow().waitFor()
 const keptRow=()=>page.locator(`[data-trip-row="${kept.id}"]`)
 assert.match(await keptRow().locator('.sch-brd-crew-info').innerText(),/3\/3/)
 await emptyRow().locator('.sch-brd-job-label').click()
 await emptyRow().getByRole('button',{name:'Delete trip',exact:true}).click()
 await dialog().getByRole('button',{name:'Continue',exact:true}).click()
 await dialog().getByLabel('Type DELETE to confirm').fill('DELETE')
 await dialog().getByRole('button',{name:'Permanently delete trip'}).click()
 await emptyRow().waitFor({state:'hidden'})
 assert.deepEqual(assignments.map(({mobilization_id,...a})=>({...a,mobilization_id:null})),before)
 await keptRow().locator('.sch-brd-job-label').click()
 await keptRow().getByRole('button',{name:'Delete trip',exact:true}).click()
 await dialog().getByRole('heading',{name:'Cannot delete this trip'}).waitFor()
 assert.equal(writes.length,1)
 assert.equal(await page.locator('[data-trip-row="job"]').count(),0,'Original job dates must not create phantom crew requirements beside saved trips')
 await page.screenshot({path:'/private/tmp/trip-owned-preview-kept.png',fullPage:true})
 // The full board is desktop-width; verify the open dialog at phone width.
 await page.setViewportSize({width:390,height:844})
 await page.screenshot({path:'/private/tmp/trip-owned-preview-mobile.png',fullPage:true})
 assert(await dialog().evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth))
 // 10088: job dates plus unlinked saved crew must render only the crew row.
 await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
 await page.setViewportSize({width:1500,height:1100})
 Object.assign(job,{job_num:'10088 - Islanders 3',start_date:'2026-09-14',end_date:'2026-09-17',crew_needed:2})
 people.splice(0,people.length,'Ary, Darrin','Ary, Jesse')
 trips=[];assignments=people.flatMap((crew_name,n)=>[14,15,16,17].map(d=>({id:n*4+d,job_id:1279,crew_name,date:`2026-09-${d}`,mobilization_id:null})))
 await page.reload()
 await page.locator('[data-trip-row="unidentified"]').waitFor()
 assert.equal(await page.locator('[data-trip-row="job"]').count(),0)
 assert.equal(await page.locator('.sch-board-row-wrap').count(),1)
 assert.equal(assignments.length,8)
 assert.equal(writes.length,1)
 await page.screenshot({path:'/private/tmp/trip-owned-preview-10088.png',fullPage:true})
 assert.deepEqual(errors,[])
 console.log('PASS Vercel bundle: empty trip, date-match isolation, explicit 9-day repair, sibling-safe deletion, linked-crew block, desktop/mobile dialogs; no live data requests.')
} catch(e) {console.error((await page.locator('body').innerText()).slice(0,4500));throw e} finally {await browser.close()}
