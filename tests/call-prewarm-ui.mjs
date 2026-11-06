import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-warm108.html',js=root+'src/qa-warm108.jsx';
await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-warm108.jsx"></script>');
await writeFile(js,`import React from 'react';import {createRoot} from 'react-dom/client';import Calls from './Calls';createRoot(document.getElementById('root')).render(<Calls token="test" accountId={1} onError={console.error}/>);`);
const vite=await createServer({root,server:{host:'127.0.0.1',port:5196,strictPort:true},logLevel:'error'});await vite.listen();let browser;
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage();let call={id:'a'.repeat(32),incoming:true,status:'ringing',peer:{id:2,name:'Test'}};
 await page.addInitScript(()=>{window.__mic=0;window.__pcs=[];const PC=RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(config){super(config);window.__pcs.push(this);}};navigator.mediaDevices.getUserMedia=async()=>{window.__mic++;throw Error('unexpected microphone');};});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let body=call;if(path.endsWith('/config'))body={relayConfigured:true,iceServers:[{urls:'turn:127.0.0.1:9',username:'test',credential:'test'}]};if(path.endsWith('/diagnostics'))body={ok:true};if(path.endsWith('/end')){call=null;body={ok:true};}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto('http://127.0.0.1:5196/qa-warm108.html');await page.getByRole('button',{name:'Принять звонок',exact:true}).waitFor();await page.waitForFunction(()=>window.__pcs.length===1);assert.equal(await page.evaluate(()=>window.__mic),0);
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>window.__pcs.length===2&&window.__pcs[0].connectionState==='closed');assert.equal(await page.evaluate(()=>window.__mic),0);
 await page.getByRole('button',{name:'Отклонить звонок',exact:true}).click();await page.waitForFunction(()=>window.__pcs.every(pc=>pc.connectionState==='closed'));assert.equal(await page.evaluate(()=>window.__mic),0);console.log('PASS incoming prewarm: real peer, no microphone before answer, route change replaces peer, decline disposes all');
}finally{await browser?.close();await vite.close();await Promise.all([unlink(html),unlink(js)]);}
