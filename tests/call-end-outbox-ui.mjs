import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-end110.html',js=root+'src/qa-end110.jsx';
await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-end110.jsx"></script>');await writeFile(js,`import React from 'react';import {createRoot} from 'react-dom/client';import Calls from './Calls';createRoot(document.getElementById('root')).render(<Calls token="test" accountId={1} onError={console.error}/>);`);
const vite=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'error'});await vite.listen();const base='http://127.0.0.1:'+vite.httpServer.address().port;let browser;
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const desktop of [false,true]){
  const context=await browser.newContext();await context.addInitScript(desktop=>{window.__panels=[];document.addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{if(document.querySelector('.call-panel'))window.__panels.push(true);}).observe(document.body,{childList:true,subtree:true}));if(desktop)window.volnaDesktop={platform:'win32',callState:async()=>{},onShowCall:()=>()=>{}};},desktop);
  let call={id:'a'.repeat(32),incoming:true,status:'ringing',peer:{id:2,name:'Test'}},canEnd=false;const attempts=[];const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let body=call;if(path.endsWith('/config'))body={relayConfigured:true,iceServers:[{urls:'turn:127.0.0.1:9',username:'test',credential:'test'}]};if(path.endsWith('/diagnostics'))body={ok:true};if(path.endsWith('/end')){attempts.push(route.request().postDataJSON());if(!canEnd)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"offline"}'});await new Promise(r=>setTimeout(r,300));call=null;body={ok:true};}return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
  await page.goto(base+'/qa-end110.html');await page.getByRole('button',{name:'Отклонить звонок',exact:true}).click();await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('volna.call.ends.')));await page.locator('.call-panel').waitFor({state:'hidden'});
  canEnd=true;await page.reload();await page.waitForFunction(()=>!Object.keys(localStorage).some(k=>k.startsWith('volna.call.ends.')));await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.__panels.length),0,'stale server call must not reopen after reload');assert.ok(attempts.length>=2);assert.equal(attempts[0].device,attempts.at(-1).device,'retry uses original owner device');assert.equal(attempts.at(-1).end_reason,'user_reject');assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS Web/Windows: declined call stays closed offline; reload retries only the original call/device and clears durable intent');
}finally{await browser?.close();await vite.close();await Promise.all([unlink(html),unlink(js)]);}
