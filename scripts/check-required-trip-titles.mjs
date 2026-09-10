// Actual Sales editor and legacy import boundary, intercepted requests only.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.VITE_SUPABASE_URL = 'https://schedule-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'fixture-only'
const server = await createServer({ server:{host:'127.0.0.1',port:5193,strictPort:true}, plugins:[{
 name:'title-test', resolveId(id){if(id==='virtual:title-test')return '\0title-test'},
 load(id){if(id==='\0title-test')return `import React from 'react';import {createRoot} from 'react-dom/client';import Editor from '/src/components/MobilizationsEditor.jsx';import {applyImport} from '/src/schedule/lib/importData.js';window.testImport=applyImport;window.tagged=[];createRoot(document.getElementById('root')).render(React.createElement(Editor,{proposalId:'test',onTagCurrentWtcDays:id=>window.tagged.push(id)}));`},
 configureServer(v){v.middlewares.use('/__titles',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await v.transformIndexHtml('/__titles','<html><body><div id="root"></div><script type="module">import "virtual:title-test"</script></body></html>'))})},
}]})
await server.listen()
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
const page=await browser.newPage()
page.setDefaultTimeout(10000)
const writes=[], errors=[]
let mobs=[]
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.hostname==='127.0.0.1')return route.continue()
 if(url.hostname!=='schedule-fixture.supabase.co')return route.abort()
 const table=url.pathname.split('/').pop()
 const send=data=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)})
 if(req.method()==='OPTIONS')return send([])
 if(req.method()!=='GET'){
  writes.push({table,payload:req.postDataJSON()})
  assert.equal(table,'proposals','Unexpected collateral write')
  mobs=req.postDataJSON().mobilizations
 }
 return send(table==='proposals'?{mobilizations:mobs}:[])
})
try {
 await page.goto('http://127.0.0.1:5193/__titles')
 const standard=page.getByRole('checkbox')
 await standard.click()
 await page.getByText('Enter and save a trip title, then select Standard job.',{exact:true}).waitFor()
 assert.equal(await standard.isChecked(),false)
 assert.equal(writes.length,0)
 assert.deepEqual(await page.evaluate(()=>window.tagged),[])
 await page.getByLabel('Trip title').fill(' \t ')
 await page.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByText('Enter a trip title before saving.',{exact:true}).waitFor()
 assert.equal(writes.length,0)
 await page.getByLabel('Trip title').fill('  Flake Floor  ')
 await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'),page.getByRole('button',{name:'Save',exact:true}).click()])
 await page.getByRole('button',{name:'Edit',exact:true}).waitFor()
 assert.equal(mobs[0].label,'Flake Floor')
 const id=mobs[0].id
 await standard.check()
 await page.waitForFunction(()=>window.tagged.length===1)
 assert.deepEqual(await page.evaluate(()=>window.tagged),[id])
 assert.equal(mobs[0].id,id)
 const count=writes.length
 const result=await page.evaluate(()=>window.testImport({jobsRaw:[],assignmentsRaw:[{JobID:'1',CrewName:'Eric',Date:'2026-09-14'}]}, {'1':9001}))
 assert.equal(result.ok,false)
 assert.match(result.error,/no trip titles or trip links/)
 assert.equal(writes.length,count,'Unsupported crew import must stop before any writes')
 assert.deepEqual(errors,[])
 console.log('PASS Sales title requirement, Standard job named-trip tagging, stable identity, and legacy crew import stops before any write.')
} finally {await browser.close();await server.close()}
