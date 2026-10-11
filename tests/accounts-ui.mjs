import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../client/',import.meta.url)),html=root+'qa-accounts.html',js=root+'src/qa-accounts.jsx';
const api=createApp({database:':memory:',origins:['http://localhost:5187']});await new Promise(r=>api.server.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+api.server.address().port;
const register=async username=>(await fixtureFetch(target+'/api/register',{method:'POST',body:JSON.stringify({username,name:username})})).json();
const a=await register('accountalice'),b=await register('accountboris'),c=await register('accountcarol');
const req=async(path,token,data)=>{const response=await fetch(target+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.ok(response.ok,await response.clone().text());return response.json();};
const ca=await req('/chats',a.token,{user_id:c.user.id}),cb=await req('/chats',b.token,{user_id:c.user.id});
for(const [chat,token,text] of [[ca,a.token,'История Алисы'],[cb,b.token,'История Бориса']])await req(`/chats/${chat.id}/messages`,token,{text,client_id:crypto.randomUUID()});
let source=await readFile(root+'src/main.jsx','utf8');source=source.replace('restoreSession().then(result=>',"(async()=>{for(const s of window.__sessions)await saveSession(s,false);await saveSession(window.__sessions[0]);return window.__sessions[0];})().then(result=>").replace("createRoot(document.getElementById('root')).render(<><Entry/><DesktopUpdate/></>);","window.__meFor=token=>request('/me',token);createRoot(document.getElementById('root')).render(<App/>);");
await writeFile(js,source);await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-accounts.jsx"></script>');
const vite=await createServer({root,server:{host:'127.0.0.1',port:5187,strictPort:true,proxy:{'/api':target}},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),errors=[];
try{
 const context=await browser.newContext({viewport:{width:1140,height:800}});await context.addInitScript(sessions=>{window.__sessions=sessions;window.__notifications=[];window.__openedWindows=[];window.volnaDesktop={platform:'win32',openChatWindow:async value=>window.__openedWindows.push(value),saveAccounts:async()=>true,loadAccounts:async()=>null,loadSession:async()=>null,onShortcut:()=>()=>{},onOpenChat:fn=>{window.__openChat=fn;return()=>{};},onShowCall:()=>()=>{},onUpdate:()=>()=>{},unreadCount:async()=>{},notifyMessage:async value=>window.__notifications.push(value),callState:async()=>{},notificationStatus:async()=>({systemEnabled:true})};},[a,b]);
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:5187/qa-accounts.html');
 await page.locator('.chat-row').filter({hasText:'accountcarol'}).click();await page.locator('.messages [data-message-id]').filter({hasText:'История Алисы'}).waitFor();await page.getByLabel('Сообщение',{exact:true}).fill('Черновик Алисы');
 await req(`/chats/${cb.id}/messages`,c.token,{text:'Сообщение фоновому аккаунту',client_id:crypto.randomUUID()});await page.waitForFunction(id=>window.__notifications.some(n=>n.accountId===id),b.user.id);
 await page.getByLabel('Настройки и действия',{exact:true}).click();await page.locator('.menu-account-choice').filter({hasText:'accountboris'}).click();await page.locator('.chat-row').filter({hasText:'Сообщение фоновому аккаунту'}).waitFor();await page.locator('.chat-row').filter({hasText:'accountcarol'}).click();await page.locator('.messages [data-message-id]').filter({hasText:'История Бориса'}).waitFor();assert.equal(await page.locator('.messages [data-message-id]').filter({hasText:'История Алисы'}).count(),0);
 assert.equal(await page.evaluate(async token=>(await window.__meFor(token)).id,a.token),a.user.id);
 await page.evaluate(({chatId,accountId})=>window.__openChat({chatId,accountId}),{chatId:ca.id,accountId:a.user.id});await page.locator('.messages [data-message-id]').filter({hasText:'История Алисы'}).waitFor();assert.equal(await page.getByLabel('Сообщение',{exact:true}).innerText(),'Черновик Алисы');assert.equal(await page.locator('.messages [data-message-id]').filter({hasText:'История Бориса'}).count(),0);
 await page.locator('.chat-row').filter({hasText:'accountcarol'}).click({button:'right'});await page.getByRole('button',{name:'Открыть в отдельном окне',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__openedWindows),[{chatId:ca.id,accountId:a.user.id}]);
 assert.deepEqual(errors,[]);console.log('PASS: two accounts keep histories and drafts separate, background notifications identify account, old access aliases stay with their owner, notification click switches account');
}finally{await browser.close();await vite.close();await api.close();await unlink(html);await unlink(js);}
