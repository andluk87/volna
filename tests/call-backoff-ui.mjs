import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-backoff110.html',js=root+'src/qa-backoff110.jsx';
await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-backoff110.jsx"></script>');await writeFile(js,`import React from 'react';import {createRoot} from 'react-dom/client';import Calls from './Calls';createRoot(document.getElementById('root')).render(<Calls token="test" accountId={1} onError={console.error}/>);`);
const vite=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'error'});await vite.listen();const base='http://127.0.0.1:'+vite.httpServer.address().port;let browser;
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const desktop of [false,true]){
  const context=await browser.newContext();if(desktop)await context.addInitScript(()=>{window.volnaDesktop={platform:'win32',callState:async()=>{},onShowCall:()=>()=>{}};});const page=await context.newPage(),polls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let body={ok:true};if(path.endsWith('/current')){polls.push(Date.now());if(polls.length===2)return route.fulfill({status:429,headers:{'Retry-After':'1'},contentType:'application/json',body:JSON.stringify({error:'limited',server_time:Date.now(),retry_at:Date.now()+1000})});body={id:'a'.repeat(32),incoming:true,status:'ringing',ring_received:true,peer:{id:2,name:'Test'}};}if(path.endsWith('/config'))body={relayConfigured:false,iceServers:[]};return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
  await page.goto(base+'/qa-backoff110.html');await page.getByRole('button',{name:'Принять звонок',exact:true}).waitFor();const wait=async n=>{const until=Date.now()+5000;while(polls.length<n&&Date.now()<until)await page.waitForTimeout(25);assert.ok(polls.length>=n);};await wait(2);await page.waitForTimeout(100);
  await page.evaluate(()=>{for(let i=0;i<20;i++)window.dispatchEvent(new CustomEvent('volna-media-event',{detail:{type:'call.ringing'}}));});await page.waitForTimeout(300);assert.equal(polls.length,2,'SSE wakes must honor server cooldown');await wait(3);assert.ok(polls[2]-polls[1]>=950);assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS Web/Windows: real 429 response pauses active polling and repeated SSE wakes cannot bypass Retry-After');
}finally{await browser?.close();await vite.close();await Promise.all([unlink(html),unlink(js)]);}
