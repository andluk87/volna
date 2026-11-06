import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-notice109.html',js=root+'src/qa-notice109.jsx';
const app=createApp({database:':memory:',origins:['http://localhost:5208']});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const api='http://127.0.0.1:'+app.server.address().port;
const register=async username=>(await fixtureFetch(api+'/api/register',{method:'POST',body:JSON.stringify({username})})).json();const alice=await register('notice-alice'),bob=await register('notice-bob');
const request=async(path,token,data)=>{const r=await fetch(api+'/api'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert.ok(r.ok);return r.json();};
const chat=await request('/chats',alice.token,{user_id:bob.user.id});
await writeFile(js,(await readFile(root+'src/main.jsx','utf8')).replace('restoreSession().then(result=>','Promise.resolve(window.__session).then(result=>'));await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-notice109.jsx"></script>');
const vite=await createServer({root,server:{host:'127.0.0.1',port:5208,strictPort:true,proxy:{'/api':api}},logLevel:'error'});await vite.listen();let browser;
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const desktop of [true,false]){
  const context=await browser.newContext();await context.addInitScript(({session,desktop})=>{window.__session=session;window.__notifications=[];if(desktop)window.volnaDesktop={platform:'win32',onShortcut:()=>()=>{},onOpenChat:()=>()=>{},onShowCall:()=>()=>{},onUpdate:()=>()=>{},updateState:async()=>null,unreadCount:async()=>{},notifyMessage:async value=>{window.__notifications.push(value);},callState:async()=>{},loadSession:async()=>null,notificationStatus:async()=>({systemEnabled:true})};},{session:alice,desktop});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:5208/qa-notice109.html');await page.locator('.chat-row').first().waitFor();await page.waitForTimeout(300);
  const message=await request('/chats/'+chat.id+'/messages',bob.token,{text:'Журнал звонков: тест уведомления '+desktop,client_id:crypto.randomUUID()});
  if(desktop){await page.waitForFunction(id=>window.__notifications.some(x=>x.body.includes('тест уведомления')),message.id);assert.equal(await page.locator('.toast').count(),0,'Windows has no duplicate bottom banner');}else await page.locator('.toast').filter({hasText:'тест уведомления'}).waitFor();
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS full app: Windows preserves desktop notification and removes duplicate bottom banner; Web preview remains');
}finally{await browser?.close();await vite.close();await app.close();await Promise.all([unlink(html),unlink(js)]);}
