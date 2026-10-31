import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-whitespace.html',js=root+'src/qa-whitespace.jsx';
const api=createApp({database:':memory:',origins:['http://localhost:5195']});
let browser,vite;
try{
 await new Promise(r=>api.server.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+api.server.address().port;
 const register=async username=>(await fixtureFetch(target+'/api/register',{method:'POST',body:JSON.stringify({username,name:username})})).json();
 const alice=await register('whitespacealice'),bob=await register('whitespacebob');
 const req=async(path,data)=>{const r=await fetch(target+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,value:await r.json()};};
 const chat=(await req('/chats',{user_id:bob.user.id})).value;
 const source=(await readFile(root+'src/main.jsx','utf8')).replace('restoreSession().then(result=>','Promise.resolve(window.__session).then(result=>');
 await writeFile(js,source);await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-whitespace.jsx"></script>');
 vite=await createServer({root,server:{host:'127.0.0.1',port:5195,strictPort:true,proxy:{'/api':target}},logLevel:'error'});await vite.listen();
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const desktop of [true,false]){
  const context=await browser.newContext({viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']});
  await context.addInitScript(({session,desktop})=>{window.__session=session;if(desktop)window.volnaDesktop={platform:'win32',onOpenChat:()=>()=>{},onShowCall:()=>()=>{},callState:async()=>{},loadSession:async()=>null};},{session:alice,desktop});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  const sent=[];page.on('request',request=>{if(request.method()==='POST'&&/\/(messages|edit)$/.test(new URL(request.url()).pathname)){try{sent.push(request.postDataJSON().text);}catch{}}});
  await page.goto('http://localhost:5195/qa-whitespace.html');if(!desktop)await page.getByRole('button',{name:'Позже',exact:true}).click({timeout:2000}).catch(()=>{});
  await page.locator('.chat-row').filter({hasText:'whitespacebob'}).click();
  const editor=page.getByRole('textbox',{name:'Сообщение',exact:true});await editor.waitFor();
  const first='Это ссылку я создала, чтобы пригласить в созданную группу.',second='Я смогла  удалить группу.',third='  Раньше было нельзя.';
  await editor.fill(first);await editor.press('End');await editor.press('Shift+Enter');await editor.press('Shift+Enter');await editor.pressSequentially(second);await editor.press('Shift+Enter');await editor.press('Shift+Enter');await editor.press('Shift+Enter');await editor.pressSequentially(third);
  const text=first+'\n\n'+second+'\n\n\n'+third;
  assert.equal(await editor.textContent(),text);
  await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
  let row=page.locator('.message.outgoing').filter({hasText:first}).last();await row.waitFor();
  const id=await row.getAttribute('data-message-id');assert.ok(id);assert.equal((await req('/messages/'+id)).value.text,text);assert.equal(sent.at(-1),text);
  row=page.locator('#message-'+id);const body=row.locator('.message-text');
  const visibleText=()=>body.evaluate(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('.message-time-space,.message-inline-meta,.message-block-meta').forEach(n=>n.remove());return copy.textContent;});
  assert.equal(await visibleText(),text);
  const lineHeight=await body.evaluate(el=>parseFloat(getComputedStyle(el).lineHeight));assert.ok((await body.boundingBox()).height>=lineHeight*6-1,'blank lines must occupy full text lines');
  await row.scrollIntoViewIfNeeded();await row.click({button:'right',position:{x:8,y:8}});await page.getByRole('menuitem',{name:'Редактировать',exact:true}).click();
  assert.equal(await editor.textContent(),text);
  const edited='  Изменённый  текст\n \n\n\tСтрока с отступом\n\n';await editor.fill(edited);
  await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
  await page.waitForFunction(({id,text})=>{const el=document.querySelector('#message-'+id+' .message-text');if(!el)return false;const copy=el.cloneNode(true);copy.querySelectorAll('.message-time-space,.message-inline-meta,.message-block-meta').forEach(n=>n.remove());return copy.textContent===text;},{id,text:edited}).catch(async error=>{console.error('EDIT DEBUG',JSON.stringify({sent,stored:(await req('/messages/'+id)).value,editor:await editor.innerHTML(),body:await visibleText(),errors}));throw error;});
  assert.equal((await req('/messages/'+id)).value.text,edited);assert.equal(sent.at(-1),edited);
  const copied=await body.evaluate(el=>{const node=el.querySelector('p'),range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);const event=new Event('copy',{bubbles:true,cancelable:true});const values={};Object.defineProperty(event,'clipboardData',{value:{setData:(type,value)=>values[type]=value}});el.dispatchEvent(event);selection.removeAllRanges();return values['text/plain'];});assert.equal(copied,edited);
  await mkdir('work/whitespace97',{recursive:true});await row.screenshot({path:`work/whitespace97/${desktop?'windows':'web'}.png`});
  
  await editor.fill('Подпись  к фото\n\nВторая строка');
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=12;const ctx=canvas.getContext('2d');ctx.fillStyle='#f00';ctx.fillRect(0,0,16,12);const png=await new Promise(r=>canvas.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);});
  await editor.focus();await page.keyboard.press('Control+v');
  const preview=page.getByRole('dialog',{name:'Подготовка фото',exact:true});await preview.waitFor();await preview.getByRole('img',{name:'Предпросмотр фото'}).waitFor();
  assert.equal(await editor.textContent(),'Подпись  к фото\n\nВторая строка');
  await preview.getByRole('button',{name:'Добавить к сообщению',exact:true}).click();await preview.waitFor({state:'hidden'});await page.locator('.draft-file').waitFor();
  await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();const photoMessage=page.locator('.message.outgoing').filter({hasText:'Подпись  к фото'}).last();await photoMessage.locator('img').waitFor();
  const photoId=await photoMessage.getAttribute('data-message-id'),saved=(await req('/messages/'+photoId)).value;assert.equal(saved.text,'Подпись  к фото\n\nВторая строка');assert.ok(saved.attachment.mime.startsWith('image/'));
  assert.deepEqual(errors,[]);await context.close();
 }
 assert.equal((await req(`/chats/${chat.id}/messages`,{text:' \n\t ',client_id:crypto.randomUUID()})).status,400);
 console.log('PASS: real Windows/Web compose, Shift+Enter, send/edit API, blank-line height, indentation, repeated spaces, tabs and selection copy preserve text; real Ctrl+V opens image preview and sends photo with caption; whitespace-only messages rejected');
}finally{await browser?.close();await vite?.close();await api.close();await Promise.all([unlink(html).catch(()=>{}),unlink(js).catch(()=>{})]);}
