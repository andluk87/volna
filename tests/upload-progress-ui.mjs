import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {readFile,writeFile,unlink,mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-upload.html',js=root+'src/qa-upload.jsx',directory=await mkdtemp(os.tmpdir()+'/volna-upload-ui-');
const api=createApp({database:':memory:',uploads:directory,origins:['http://localhost:5186']});await new Promise(r=>api.server.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+api.server.address().port;
const register=async username=>(await fixtureFetch(target+'/api/register',{method:'POST',body:JSON.stringify({username,name:username})})).json();const alice=await register('uploadalice'),bob=await register('uploadbob');
const req=async(path,data)=>{const response=await fetch(target+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.ok(response.ok,await response.clone().text());return response.json();};const chat=await req('/chats',{user_id:bob.user.id});
await writeFile(js,(await readFile(root+'src/main.jsx','utf8')).replace('restoreSession().then(result=>','Promise.resolve(window.__session).then(result=>'));await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-upload.jsx"></script>');
const vite=await createServer({root,server:{host:'127.0.0.1',port:5186,strictPort:true,proxy:{'/api':target}},logLevel:'error'});await vite.listen();const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 await mkdir('work/upload-reference',{recursive:true});
 for(const desktop of [false,true]){
  const context=await browser.newContext({viewport:{width:1100,height:800}});await context.addInitScript(({session,desktop})=>{window.__session=session;if(desktop)window.volnaDesktop={platform:'win32',onShortcut:()=>()=>{},onOpenChat:()=>()=>{},onShowCall:()=>()=>{},onUpdate:()=>()=>{},unreadCount:async()=>{},notifyMessage:async()=>{},callState:async()=>{},notificationStatus:async()=>({systemEnabled:true}),loadSession:async()=>null};},{session:alice,desktop});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);await page.goto('http://localhost:5186/qa-upload.html');await page.getByRole('button',{name:'Позже',exact:true}).click({timeout:3000}).catch(()=>{});await page.locator('.chat-row').filter({hasText:'uploadbob'}).click();
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:10,downloadThroughput:8*1024*1024,uploadThroughput:256*1024});
  let uploads=0,failUpload=false,failMessage=false;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/uploads'))uploads++;});
  await page.route('**/api/uploads',route=>{if(failUpload){failUpload=false;return route.abort('failed');}return route.continue();});
  await page.route(`**/api/chats/${chat.id}/messages`,route=>{if(route.request().method()==='POST'&&failMessage){failMessage=false;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Сеть временно недоступна"}'});}return route.continue();});
  const pick=()=>page.getByLabel('Выбрать файл',{exact:true}).setInputFiles({name:'Volna-Android.apk',mimeType:'application/octet-stream',buffer:Buffer.alloc(2*1024*1024,65)});
  const before=(await req(`/chats/${chat.id}/messages`)).length;
  await pick();assert.equal(uploads,0,'file selection must not start an upload before Send');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();const card=page.getByRole('article',{name:'Загрузка Volna-Android.apk'});await card.waitFor();
  await page.waitForFunction(()=>{const text=document.querySelector('.upload-file-copy span')?.textContent;return text&&text!=='0 Б / 2.0 МБ'&&text!=='0.0 МБ / 2.0 МБ'&&text!=='2.0 МБ / 2.0 МБ'&&text.includes('/ 2.0 МБ');});
  await card.screenshot({path:`work/upload-reference/${desktop?'windows':'web'}-progress.png`});await card.getByRole('button',{name:'Отменить загрузку Volna-Android.apk'}).click();await card.waitFor({state:'detached'});assert.equal((await req(`/chats/${chat.id}/messages`)).length,before);
  // A failed upload can be retried, then a failed message commit reuses the uploaded file.
  failUpload=true;await pick();await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();await card.getByRole('button',{name:'Повторить отправку Volna-Android.apk'}).waitFor();
  failMessage=true;await card.getByRole('button',{name:'Повторить отправку Volna-Android.apk'}).click();await card.getByRole('button',{name:'Отменить загрузку Volna-Android.apk'}).waitFor();try{await card.getByRole('button',{name:'Повторить отправку Volna-Android.apk'}).waitFor();}catch(e){console.log('UPLOAD STATE',await card.innerText(),uploads,failMessage);throw e;}const uploadCount=uploads;
  await card.getByRole('button',{name:'Повторить отправку Volna-Android.apk'}).click();await card.waitFor({state:'detached'});assert.equal(uploads,uploadCount,'message retry must reuse the successfully uploaded attachment');
  const messages=await req(`/chats/${chat.id}/messages`);assert.equal(messages.length,before+1);assert.equal(messages.at(-1).attachment.name,'Volna-Android.apk');assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS Web/Windows full App: deferred upload, real byte progress, cancel aborts without a message, network retry, commit retry reuses attachment; screenshots saved');
}finally{await browser.close();await vite.close();await api.close();await Promise.all([unlink(html),unlink(js)]);await rm(directory,{recursive:true,force:true});}
