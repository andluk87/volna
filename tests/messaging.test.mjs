import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,scryptSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';

test('v0.2 files, replies, forwarding, edits, deletion, reactions, pins, search and privacy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-rich-'));const app=createApp({database:join(dir,'db'),uploads:join(dir,'uploads')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const call=async(path,token,data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const upload=async(token,name='test.txt')=>{const r=await fetch(base+'/uploads',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'text/plain','X-File-Name':encodeURIComponent(name)},body:'private attachment'});assert.equal(r.status,201);return r.json();};
 try{
  const users=[];for(const username of ['alice','bob','eve'])users.push((await call('/register','',{username,password:'long-password'})).data);
  const [a,b,e]=users;const chat=(await call('/chats',a.token,{user_id:b.user.id})).data.id;
  const file=await upload(a.token,'Отчёт.txt');assert.equal((await fetch(base+'/files/'+file.id,{headers:{Authorization:'Bearer '+b.token}})).status,404);
  const payload={text:'Привет Москва',attachment_id:file.id,client_id:randomUUID()};const sent=await call(`/chats/${chat}/messages`,a.token,payload);assert.equal(sent.status,201);const id=sent.data.id;
  assert.equal((await call(`/chats/${chat}/messages`,a.token,payload)).data.id,id);
  const download=await fetch(base+'/files/'+file.id,{headers:{Authorization:'Bearer '+b.token}});assert.equal(await download.text(),'private attachment');
  assert.equal((await fetch(base+'/files/'+file.id,{headers:{Authorization:'Bearer '+e.token}})).status,404);
  assert.equal((await call(`/uploads/${file.id}/discard`,a.token,{})).status,409);
  assert.equal((await call(`/chats/${chat}/messages`,b.token,{text:'stolen',attachment_id:file.id,client_id:randomUUID()})).status,403);
  assert.equal((await call(`/messages/${id}/edit`,b.token,{text:'bad'})).status,403);
  assert.equal((await call(`/messages/${id}/delete`,b.token,{})).status,403);
  for(const action of ['edit','delete','pin','react','forward'])assert.equal((await call(`/messages/${id}/${action}`,e.token,{})).status,404);
  const reply=(await call(`/chats/${chat}/messages`,b.token,{text:'Ответ',reply_to:id,client_id:randomUUID()})).data;assert.equal(reply.reply.id,id);
  assert.equal((await call(`/messages/${id}/edit`,a.token,{text:'Обновлённый Текст'})).status,200);
  assert.equal((await call(`/chats/${chat}/search?q=${encodeURIComponent('обновлённый')}`,b.token)).data.length,1);
  assert.equal((await call(`/chats/${chat}/search?q=${encodeURIComponent('отчёт')}`,b.token)).data.length,1);
  let reacted=await call(`/messages/${id}/react`,b.token,{emoji:'❤️',active:true});assert.equal(reacted.data.reactions.length,1);
  reacted=await call(`/messages/${id}/react`,b.token,{emoji:'❤️',active:true});assert.equal(reacted.data.reactions.length,1);
  assert.equal((await call(`/messages/${id}/react`,b.token,{emoji:'❤️',active:false})).data.reactions.length,0);
  await call(`/messages/${id}/pin`,b.token,{pinned:true});assert.equal((await call(`/chats/${chat}/pins`,a.token)).data[0].id,id);
  const saved=(await call('/saved',b.token,{})).data.id;assert.equal((await call('/saved',b.token,{})).data.id,saved);
  assert.equal((await call(`/chats/${saved}/messages`,a.token)).status,404);
  assert.equal((await call(`/chats/${saved}/messages`,b.token,{text:'cross reply',reply_to:id,client_id:randomUUID()})).status,400);
  const forwardPayload={chat_id:saved,client_id:randomUUID()};const forwarded=await call(`/messages/${id}/forward`,b.token,forwardPayload);assert.equal(forwarded.status,201);assert.equal(forwarded.data.attachment.id,file.id);
  assert.equal((await call(`/messages/${id}/forward`,b.token,forwardPayload)).data.id,forwarded.data.id);
  const ownSaved=(await call('/saved',a.token,{})).data.id;
  assert.equal((await call(`/messages/${id}/forward`,b.token,{chat_id:ownSaved,client_id:randomUUID()})).status,404);
  assert.equal((await call(`/messages/${id}/delete`,a.token,{})).status,200);
  assert.equal((await call(`/messages/${id}`,b.token)).data.text,'');assert.equal((await call(`/messages/${reply.id}`,b.token)).data.reply.text,'Сообщение удалено');
  assert.equal((await call(`/chats/${chat}/pins`,a.token)).data.length,0);
  // Bob's saved copy retains the file; Alice loses access to the deleted original.
  assert.equal((await fetch(base+'/files/'+file.id,{headers:{Authorization:'Bearer '+a.token}})).status,404);
  assert.equal((await fetch(base+'/files/'+file.id,{headers:{Authorization:'Bearer '+b.token}})).status,200);
  await call(`/messages/${forwarded.data.id}/delete`,b.token,{});
  assert.equal((await fetch(base+'/files/'+file.id,{headers:{Authorization:'Bearer '+b.token}})).status,404);
  const unused=await upload(a.token);assert.equal((await call(`/uploads/${unused.id}/discard`,a.token,{})).status,200);
  assert.equal((await fetch(base+'/files/'+unused.id,{headers:{Authorization:'Bearer '+a.token}})).status,404);
  assert.equal((await call('/chats',b.token)).data.find(c=>c.id===saved).saved,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

