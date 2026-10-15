import assert from 'node:assert/strict';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {createServer as createHttpServer} from 'node:http';
import path from 'node:path';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-call-53.html',js=root+'src/qa-call-53.jsx';
await mkdir(new URL('../work/',import.meta.url),{recursive:true});
await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-call-53.jsx"></script>');
await writeFile(js,`import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';import Calls from './Calls';import './style.css';function App(){const ref=useRef(null),[error,setError]=useState('');return <><Calls token="test" ref={ref} onError={setError} accountId={1} accountName="and_work"/><button onClick={()=>ref.current.start({id:1})}>Начать тест</button><output>{error}</output></>;}createRoot(document.getElementById('root')).render(<App/>);`);
const vite=await createServer({root,server:{host:'127.0.0.1',port:5197,strictPort:true},logLevel:'error'});await vite.listen();let browser;
const toastServer=createHttpServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root))throw Error();const bytes=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html'});res.end(bytes);}catch{res.writeHead(404);res.end();}});await new Promise(r=>toastServer.listen(0,'127.0.0.1',r));
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 for(const desktop of [false,true]) {
  const context=await browser.newContext({permissions:['microphone'],viewport:{width:1000,height:800}});let call=null;
  await context.addInitScript(desktop=>{window.__callOverlays=[];window.addEventListener('volna-call-visibility',()=>window.__callOverlays.push(!!document.querySelector('.call-panel:not(.call-minimized)')));if(desktop)window.volnaDesktop={platform:'win32',callState:async()=>{},onShowCall:()=>()=>{}};},desktop);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let body={};if(path.endsWith('/config'))body={iceServers:[],relay:false};else if(path.endsWith('/start'))body=call={id:'test-call',incoming:false,status:'ringing',peer:{id:2,name:'Иван'}};else if(path.endsWith('/end')){call=null;body={ok:true};}else body=call;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await page.goto('http://127.0.0.1:5197/qa-call-53.html');await page.getByText('Начать тест',{exact:true}).click();
  const topbar=page.locator('.call-topbar');const label=await topbar.locator('span').first().boundingBox(),account=await page.locator('.call-encryption').boundingBox();assert.ok(account.x>=label.x+label.width+12||account.y>=label.y+label.height,'call status and account are separate');assert.equal(await page.locator('.call-avatar').evaluate(n=>getComputedStyle(n,'::before').content),'none');
  await page.getByRole('button',{name:'Свернуть звонок, чтобы открыть переписку',exact:true}).click();
  const mini=page.locator('.call-minimized');await mini.waitFor();const first=await mini.boundingBox();assert.equal(await page.evaluate(()=>window.__callOverlays.at(-1)),false);assert.ok(first.y<30,'starts at the top');
  assert.equal(await page.locator('.call-mini-drag').count(),0,'strip has no drag handle');
  assert.equal(Math.round(first.width),1000,'strip spans the window');
  assert.ok(first.height<=50,'strip stays compact');
  assert.notEqual(await mini.evaluate(n=>getComputedStyle(n,'::before').animationName),'none');
  await page.setViewportSize({width:390,height:500});await page.waitForTimeout(100);const small=await mini.boundingBox();assert.equal(Math.round(small.width),390);assert.equal(small.y,0);
  await page.screenshot({path:new URL(`../work/call-${desktop?'windows':'web'}-0.12.54.png`,import.meta.url).pathname});
  await page.getByRole('button',{name:'Развернуть звонок',exact:true}).click();await page.getByRole('button',{name:'Свернуть звонок, чтобы открыть переписку',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__callOverlays.at(-1)),true);
  await page.getByRole('button',{name:'Завершить звонок',exact:true}).click();await page.locator('.call-panel').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);await context.close();
 }
 const page=await browser.newPage({viewport:{width:360,height:552}});
 await page.addInitScript(()=>{window.__opened=[];window.__closed=[];window.vlnToast={subscribe:fn=>window.__deliver=fn,open:id=>window.__opened.push(id),close:id=>window.__closed.push(id)};});
 await page.goto(`http://127.0.0.1:${toastServer.address().port}/electron/notification.html`);
 for(let n=1;n<=7;n++)await page.evaluate(n=>window.__deliver(Array.from({length:Math.min(n,5)},(_,i)=>({id:Math.max(1,n-4)+i,title:'Иван',body:'Текст сообщения '+(Math.max(1,n-4)+i)}))),n);
 assert.equal(await page.locator('.toast').count(),5);assert.deepEqual(await page.locator('.toast p').allTextContents(),[3,4,5,6,7].map(n=>'Текст сообщения '+n));
 const cards=await page.locator('.toast').all();for(let n=1;n<cards.length;n++)assert.ok((await cards[n].boundingBox()).y>(await cards[n-1].boundingBox()).y);
 await cards[4].click();assert.deepEqual(await page.evaluate(()=>window.__opened),[7]);
 await cards[0].getByRole('button',{name:'Закрыть уведомление'}).click();assert.deepEqual(await page.evaluate(()=>window.__closed),[3]);
 await page.screenshot({path:new URL('../work/toasts-0.12.54.png',import.meta.url).pathname});
 await page.evaluate(()=>window.__deliver([{id:8,title:'<script>bad()</script>',body:'<img src=x onerror=bad()>'}]));assert.equal(await page.locator('.toast p').innerText(),'<img src=x onerror=bad()>');assert.equal(await page.locator('.toast p img').count(),0);
 await page.evaluate(()=>window.__deliver([]));assert.equal(await page.locator('.toast').count(),0);
 console.log('PASS: Web/Windows animated full-width call strip, responsive viewport bounds, expand/end; toast text/order/max-five/click/dismiss/escaped markup');
} finally {await browser?.close();await vite.close();await new Promise(r=>toastServer.close(r));await Promise.all([unlink(html),unlink(js)]);}
