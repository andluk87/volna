import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {writeFile,unlink} from 'node:fs/promises';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-accounts-call.html',js=root+'src/qa-accounts-call.jsx';
await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-accounts-call.jsx"></script>');
await writeFile(js,`import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';import AccountCalls from './AccountCalls';import './style.css';function App(){const [selected,setSelected]=useState(window.__accounts[0].user.id),ref=useRef(null),[error,setError]=useState('');return <><AccountCalls accounts={window.__accounts} selected={selected} selectedRef={ref} onError={setError}/><button onClick={()=>setSelected(window.__accounts[1].user.id)}>Switch account</button><output>{error}</output><p id="selected">{selected}</p></>;}createRoot(document.getElementById('root')).render(<App/>);`);
const app=createApp({database:':memory:',origins:['http://127.0.0.1:5198']});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+app.server.address().port;
async function request(path,token,data){const r=await fixtureFetch(target+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.ok(r.ok,path);return r.json();}
const accounts=[];for(const [username,name] of [['selected_ui','Выбранный аккаунт'],['background_ui','Рабочий аккаунт'],['caller_ui','Собеседник']])accounts.push(await request('/register','',{username,name}));
const chat=await request('/chats',accounts[2].token,{user_id:accounts[1].user.id});
const vite=await createServer({root,server:{host:'127.0.0.1',port:5198,strictPort:true,proxy:{'/api':target}},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),errors=[];
try{
 for(const desktop of [false,true]){
  const context=await browser.newContext();await context.addInitScript(({accounts,desktop})=>{window.__accounts=accounts;if(desktop)window.volnaDesktop={platform:'win32',callState:async()=>{},onShowCall:()=>()=>{}};},{accounts:accounts.slice(0,2),desktop});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5198/qa-accounts-call.html');
  const device=crypto.randomUUID().replaceAll('-',''),call=await request('/calls/start',accounts[2].token,{device,chat_id:chat.id});
  await request(`/calls/${call.id}/offer`,accounts[2].token,{device,description:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}});
  const dialog=page.getByRole('dialog',{name:'Аудиозвонок',exact:true});await dialog.getByText('Аккаунт: Рабочий аккаунт',{exact:true}).waitFor();
  assert.equal(await page.locator('#selected').textContent(),String(accounts[0].user.id));
  assert.equal((await request('/calls/current?device='+device,accounts[2].token)).ring_received,true);
  await page.getByText('Switch account',{exact:true}).evaluate(button=>button.click());await dialog.getByRole('button',{name:'Принять звонок',exact:true}).waitFor();
  assert.equal((await request('/calls/current?device='+device,accounts[2].token)).id,call.id);
  await dialog.getByRole('button',{name:'Отклонить звонок',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.waitForTimeout(100);assert.equal(await request('/calls/current?device='+device,accounts[2].token),null);
  const again=await request('/calls/start',accounts[2].token,{device,chat_id:chat.id});
  await request(`/calls/${again.id}/offer`,accounts[2].token,{device,description:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}});
  await dialog.waitFor({state:'visible'});const winner=crypto.randomUUID().replaceAll('-','');await request(`/calls/${again.id}/accept`,accounts[1].token,{device:winner,protocol:2});await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('output').textContent(),'','answered elsewhere closes the call without an error banner');await request(`/calls/${again.id}/end`,accounts[1].token,{device:winner});
  assert.equal(await page.locator('output').textContent(),'','ordinary remote hangup must not display an error banner');
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: background account immediately displays Web/Windows call controls; account switching preserves the call; decline uses the recipient account');
}finally{await browser.close();await vite.close();await app.close();await unlink(html);await unlink(js);}
