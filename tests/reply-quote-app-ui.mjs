import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-quote-app.html',js=root+'src/qa-quote-app.jsx';
const api=createApp({database:':memory:',origins:['http://localhost:5181']});await new Promise(r=>api.server.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+api.server.address().port;
const register=async username=>(await fixtureFetch(target+'/api/register',{method:'POST',body:JSON.stringify({username,name:username})})).json();const alice=await register('quoteappalice'),bob=await register('quoteappbob');
const req=async(path,data)=>{const r=await fetch(target+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.ok(r.ok,await r.clone().text());return r.json();};
const chat=await req('/chats',{user_id:bob.user.id});
const original=await req(`/chats/${chat.id}/messages`,{text:'Мука\nМолоко\nВанилин\nТуалетная бумага\nСредство для мытья детям\nШампунь детям\nКурилки',client_id:crypto.randomUUID()});
await req(`/chats/${chat.id}/messages`,{text:'Следующее сообщение',client_id:crypto.randomUUID()});
const source=(await readFile(root+'src/main.jsx','utf8')).replace('restoreSession().then(result=>','Promise.resolve(window.__session).then(result=>');await writeFile(js,source);await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-quote-app.jsx"></script>');
const vite=await createServer({root,server:{host:'127.0.0.1',port:5181,strictPort:true,proxy:{'/api':target}},logLevel:'error'});let browser;
try{
 await vite.listen();browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1150,height:850}});
 await context.addInitScript(s=>{window.__session=s;window.volnaDesktop={platform:'win32',onShortcut:()=>()=>{},onOpenChat:()=>()=>{},onShowCall:()=>()=>{},onUpdate:()=>()=>{},unreadCount:async()=>{},notifyMessage:async()=>{},callState:async()=>{},notificationStatus:async()=>({systemEnabled:true}),loadSession:async()=>null};},alice);
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:5181/qa-quote-app.html');await page.locator('.chat-row').filter({hasText:'quoteappbob'}).click();
 const body=page.locator('#message-'+original.id+' .message-text');await body.waitFor();
 const coordinates=async text=>body.evaluate((el,text)=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const i=node.textContent.indexOf(text);if(i<0)continue;const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+text.length);const b=range.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height};}throw Error('fragment absent');},text);
 const b=await coordinates('Туалетная бумага');await page.mouse.move(b.x,b.y+b.h/2);await page.mouse.down();await page.mouse.move(b.x+b.w,b.y+b.h/2,{steps:12});await page.mouse.up();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.evaluate(()=>getSelection().toString()),'Туалетная бумага');assert.equal(await page.locator('.message-selected').count(),0);
 await page.mouse.click(b.x+b.w/2,b.y+b.h/2,{button:'right'});await page.getByRole('menuitem',{name:'Ответить с цитатой',exact:true}).click();
 await page.getByRole('button',{name:'Изменить цитату',exact:true}).waitFor();assert.equal(await page.locator('.reply-context-edit span').textContent(),'Туалетная бумага');
 await page.getByRole('button',{name:'Изменить цитату',exact:true}).click();await page.getByRole('dialog',{name:'Изменение цитаты'}).waitFor();
 // A gesture beginning in message text stays text selection even when it crosses the next row.
 await page.getByRole('button',{name:'Отмена',exact:true}).click();
 const again=await coordinates('Туалетная бумага'),bottom=await page.locator('#message-'+original.id).boundingBox();await page.mouse.move(again.x,again.y+again.h/2);await page.mouse.down();await page.mouse.move(again.x+10,bottom.y+bottom.height+22,{steps:15});await page.mouse.up();
 assert.equal(await page.locator('.message-selected').count(),0,'text drag must not switch to selecting whole messages');assert.ok((await page.evaluate(()=>getSelection().toString())).includes('Туалетная бумага'));
 // The explicit quote command also works without a prior selection in the history.
 await page.evaluate(()=>getSelection().removeAllRanges());await body.click({button:'right',position:{x:5,y:5}});
 await page.getByRole('menuitem',{name:'Выбрать фрагмент для цитаты',exact:true}).click();
 const raw=await page.locator('.quote-source-text').evaluate(el=>{const node=el.firstChild,i=node.textContent.indexOf('Молоко'),r=document.createRange();r.setStart(node,i);r.setEnd(node,i+6);const b=r.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height};});
 await page.mouse.move(raw.x,raw.y+raw.h/2);await page.mouse.down();await page.mouse.move(raw.x+raw.w,raw.y+raw.h/2,{steps:10});await page.mouse.up();
 await page.getByRole('button',{name:'Цитировать фрагмент',exact:true}).click();assert.equal(await page.locator('.reply-context-edit span').textContent(),'Молоко');
 await page.getByLabel('Сообщение',{exact:true}).fill('Куплю');
 const sent=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/messages'));await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();const answer=await (await sent).json();assert.equal(answer.reply.quote.text,'Молоко');assert.equal(answer.reply.id,original.id);await page.locator('#message-'+answer.id).waitFor();await page.locator('.reply-context-edit').waitFor({state:'detached'});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 // Clicking the ellipsis must capture selection before its summary receives focus.
 const last=await coordinates('Ванилин');await page.mouse.move(last.x,last.y+last.h/2);await page.mouse.down();await page.mouse.move(last.x+last.w,last.y+last.h/2,{steps:10});await page.mouse.up();
 assert.equal(await page.evaluate(()=>getSelection().toString()),'Ванилин');await page.locator('#message-'+original.id+' .message-actions summary').click();await page.getByRole('menuitem',{name:'Ответить с цитатой',exact:true}).click();assert.equal(await page.locator('.reply-context-edit span').textContent(),'Ванилин');
 assert.deepEqual(errors,[]);console.log('PASS actual Windows App: mouse text selection, quote menu/editor and text drag across row boundary');
}finally{await browser?.close();await vite.close();await api.close();await unlink(html);await unlink(js);}
