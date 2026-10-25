import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {writeFile,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../client/',import.meta.url)),html=root+'qa-session-restore.html';
const api=createApp({database:':memory:',origins:['http://localhost:5191']});await new Promise(r=>api.server.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+api.server.address().port;
const login=async username=>(await fixtureFetch(target+'/api/register',{method:'POST',body:JSON.stringify({username,name:username})})).json();
const alice=await login('restorealice'),bob=await login('restorebob');
await writeFile(html,'<div id="root"></div><script type="module" src="/src/main.jsx"></script>');
const vite=await createServer({root,server:{host:'127.0.0.1',port:5191,strictPort:true,proxy:{'/api':target}},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),errors=[];
function bootstrap({stored,offline=false,locked=false,revoked=null}){
 window.__saved=stored;window.__saveCalls=[];window.__online=!offline;window.__unlocked=!locked;
 window.volnaDesktop={platform:'win32',onShortcut:()=>()=>{},onOpenChat:()=>()=>{},onShowCall:()=>()=>{},onUpdate:()=>()=>{},unreadCount:async()=>{},notifyMessage:async()=>{},callState:async()=>{},notificationStatus:async()=>({systemEnabled:true}),soundSettings:async()=>{},updateState:async()=>({status:'idle'}),loadSession:async()=>null,
 loadAccounts:async()=>{if(!window.__unlocked)throw Error('Protected storage unavailable');return window.__saved;},saveAccounts:async value=>{window.__saveCalls.push(value);window.__saved=value;},
 refreshSession:async value=>{if(!window.__online)return {status:503};if(value.accountId===revoked)return {status:401};const current=window.__saved.accounts.find(a=>a.user.id===value.accountId);const response=await fetch('/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:current.refresh_token,account_id:value.accountId,select:false})});const session=await response.json();return {status:response.status,session};}};
}
async function open(options){const context=await browser.newContext({viewport:{width:1000,height:740}});await context.addInitScript(bootstrap,options);const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:5191/qa-session-restore.html');return page;}
try{
 const offline=await open({stored:{selected:alice.user.id,accounts:[{...alice,expires:1}]},offline:true});
 await offline.getByRole('button',{name:'Повторить подключение',exact:true}).waitFor();assert.equal(await offline.getByRole('heading',{name:'Вход по QR',exact:true}).count(),0);assert.equal(await offline.evaluate(()=>window.__saveCalls.length),0);
 await offline.evaluate(()=>window.__online=true);await offline.getByRole('button',{name:'Повторить подключение',exact:true}).click();await offline.locator('.app>.sidebar').waitFor();
 const persisted=await offline.evaluate(()=>window.__saved);assert.equal(persisted.accounts[0].user.id,alice.user.id);assert.notEqual(persisted.accounts[0].refresh_token,alice.refresh_token);
 const restarted=await open({stored:persisted});await restarted.locator('.app>.sidebar').waitFor();assert.equal(await restarted.getByRole('heading',{name:'Вход по QR',exact:true}).count(),0);
 const locked=await open({stored:persisted,locked:true});await locked.getByRole('button',{name:'Повторить подключение',exact:true}).waitFor();assert.equal(await locked.evaluate(()=>window.__saveCalls.length),0);await locked.evaluate(()=>window.__unlocked=true);await locked.getByRole('button',{name:'Повторить подключение',exact:true}).click();await locked.locator('.app>.sidebar').waitFor();
 const revoked=await open({stored:{selected:alice.user.id,accounts:[{...persisted.accounts[0],expires:1},bob]},revoked:alice.user.id});await revoked.locator('.app>.sidebar').waitFor();const retained=await revoked.evaluate(()=>window.__saved);assert.deepEqual(retained.accounts.map(a=>a.user.id),[bob.user.id]);assert.equal(retained.selected,bob.user.id);
 assert.deepEqual(errors,[]);console.log('PASS: server outage and locked storage retain accounts and retry without QR; app restart restores saved session; revoking one account preserves the other');
}finally{await browser.close();await vite.close();await api.close();await unlink(html);}
