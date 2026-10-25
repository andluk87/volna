import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../client/',import.meta.url)),html=root+'qa-desktop-update.html',js=root+'src/qa-desktop-update.jsx';
const api=createApp({database:':memory:',origins:['http://localhost:5190']});
await new Promise(r=>api.server.listen(0,'127.0.0.1',r));
const target='http://127.0.0.1:'+api.server.address().port;
const register=async username=>(await fixtureFetch(target+'/api/register',{method:'POST',body:JSON.stringify({username,name:username})})).json();
const alice=await register('updatealice'),bob=await register('updatebob'),empty=await register('updateempty');
const request=async(path,data)=>{const r=await fetch(target+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.ok(r.ok,await r.clone().text());return r.json();};
const chat=await request('/chats',{user_id:bob.user.id});
const folders=await request('/folders');await request('/folders',{version:folders.version,folders:[{id:'work',name:'Работа',chats:[chat.id],icon:'💼'}]});
let source=await readFile(root+'src/main.jsx','utf8');
source=source.replace('restoreSession().then(result=>','Promise.resolve(window.__session).then(result=>');
await writeFile(js,source);await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-desktop-update.jsx"></script>');
const vite=await createServer({root,server:{host:'127.0.0.1',port:5190,strictPort:true,proxy:{'/api':target}},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),errors=[];
function bootstrap({session,desktop}){
 window.__session=session;
 if(!desktop)return;
 window.__updateCalls=0;window.__updateChecks=0;
 const listeners=new Set();
 window.__updateState={status:'ready',version:'0.12.61',percent:100,message:'Обновление готово к установке'};
 window.__setUpdate=value=>{window.__updateState=value;for(const fn of listeners)fn(value);};
 window.volnaDesktop={platform:'win32',onShortcut:()=>()=>{},onOpenChat:()=>()=>{},onShowCall:()=>()=>{},unreadCount:async()=>{},notifyMessage:async()=>{},callState:async()=>{},notificationStatus:async()=>({systemEnabled:true}),soundSettings:async()=>{},loadSession:async()=>null,
  updateState:async()=>window.__updateState,onUpdate:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  update:async()=>{window.__updateCalls++;return window.__updateState;},checkUpdates:async()=>{window.__updateChecks++;return window.__updateState;}};
}
async function pageFor(session,desktop=true){const context=await browser.newContext({viewport:{width:1100,height:780}});await context.addInitScript(bootstrap,{session,desktop});const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:5190/qa-desktop-update.html');return page;}
async function footerBounds(page,withRail){const sidebar=await page.locator('.app>.sidebar').boundingBox(),bar=await page.locator('.sidebar>.desktop-update').boundingBox(),list=await page.locator('.sidebar>.chat-list').boundingBox();assert.ok(bar&&list&&sidebar);assert.ok(Math.abs(bar.y+bar.height-sidebar.y-sidebar.height)<2);assert.ok(list.y+list.height<=bar.y+1);assert.ok(Math.abs(bar.x-list.x)<1&&Math.abs(bar.width-list.width)<1);if(withRail)assert.ok(bar.x>sidebar.x+60);else assert.ok(Math.abs(bar.x-sidebar.x)<1);}
try{
 const page=await pageFor(alice);await page.locator('.desktop-folder-sidebar').waitFor();await page.getByRole('button',{name:'Обновить VLN',exact:true}).waitFor();await footerBounds(page,true);
 await page.getByRole('button',{name:'Обновить VLN',exact:true}).click();assert.equal(await page.evaluate(()=>window.__updateCalls),1);
 await page.evaluate(()=>window.__setUpdate({status:'downloading',version:'0.12.61',percent:37.4,message:'Скачиваем обновление…'}));
 await page.getByRole('button',{name:'Загрузка обновления · 37%',exact:true}).waitFor();assert.equal(await page.locator('.desktop-update>button').isDisabled(),true);await footerBounds(page,true);
 await page.evaluate(()=>window.__setUpdate({status:'error',version:'0.12.61',manual:false,message:'Ошибка сети'}));await page.getByRole('button',{name:'Повторить обновление',exact:true}).click();assert.equal(await page.evaluate(()=>window.__updateChecks),1);
 await page.evaluate(()=>window.__setUpdate({status:'current',manual:true,message:'Установлена последняя версия'}));await page.locator('.desktop-update').waitFor({state:'hidden'});
 await page.evaluate(()=>window.__setUpdate({status:'ready',version:'0.12.61',message:'Обновление готово к установке'}));await page.getByRole('button',{name:'Обновить VLN',exact:true}).waitFor();
 await mkdir(new URL('../work/desktop-update-screens/',import.meta.url),{recursive:true});await page.screenshot({path:new URL('../work/desktop-update-screens/with-folders.png',import.meta.url).pathname});
 const blank=await pageFor(empty);await blank.locator('.desktop-no-folders').waitFor();await blank.getByRole('button',{name:'Обновить VLN',exact:true}).waitFor();await footerBounds(blank,false);await blank.screenshot({path:new URL('../work/desktop-update-screens/empty.png',import.meta.url).pathname});
 await blank.setViewportSize({width:470,height:780});await footerBounds(blank,false);
 const web=await pageFor(empty,false);await web.locator('.app>.sidebar').waitFor();assert.equal(await web.locator('.desktop-update').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: update bar stays below chat list with folders, without folders, empty and narrow; installation, progress, retry and current states work; Web has no updater');
}finally{await browser.close();await vite.close();await api.close();await unlink(html);await unlink(js);}
