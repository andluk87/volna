import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
test('chat archive and mute are private, durable preferences; unread filter data stays available',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-chat-pref-'));const database=join(dir,'db.sqlite');let app=createApp({database});
 const listen=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${app.server.address().port}/api`;};let base=await listen();
 const call=async(path,token,data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 try{
  const alice=(await call('/register','',{username:'prefalice',name:'Алиса',password:'test-password-long'})).data;
  const bob=(await call('/register','',{username:'prefbob',name:'Боб',password:'test-password-long'})).data;
  const eve=(await call('/register','',{username:'prefeve',name:'Ева',password:'test-password-long'})).data;
  const chat=(await call('/chats',alice.token,{user_id:bob.user.id})).data;
  assert.equal((await call(`/chats/${chat.id}/preferences`,alice.token,{muted:true})).data.muted,1);
  assert.equal((await call(`/chats/${chat.id}/preferences`,alice.token,{pinned:true})).data.pinned,1);
  let rows=(await call('/chats',alice.token)).data;assert.equal(rows.find(c=>c.id===chat.id).muted,1);assert.equal(rows.find(c=>c.id===chat.id).pinned,1);
  assert.equal((await call('/chats',bob.token)).data.find(c=>c.id===chat.id).muted,0);
  assert.equal((await call(`/chats/${chat.id}/preferences`,eve.token,{archived:true})).status,404);
  assert.equal((await call(`/chats/${chat.id}/preferences`,alice.token,{muted:'yes'})).status,400);
  assert.equal((await call(`/chats/${chat.id}/preferences`,alice.token,{archived:true})).data.archived,1);
  const newer=(await call('/chats',alice.token,{user_id:eve.user.id})).data;
  await call(`/chats/${newer.id}/messages`,eve.token,{text:'Новее закреплённого',client_id:randomUUID()});
  assert.equal((await call('/chats',alice.token)).data[0].id,chat.id);
  await app.close();app=createApp({database});base=await listen();
  rows=(await call('/chats',alice.token)).data;assert.equal(rows.find(c=>c.id===chat.id).archived,1);assert.equal(rows.find(c=>c.id===chat.id).muted,1);assert.equal(rows.find(c=>c.id===chat.id).pinned,1);
  assert.equal((await call(`/chats/${chat.id}/preferences`,alice.token,{archived:false,muted:false})).data.archived,0);
  const msg=await call(`/chats/${chat.id}/messages`,bob.token,{text:'Тест',client_id:randomUUID()});assert.equal(msg.status,201);
  rows=(await call('/chats',alice.token)).data;assert.equal(rows.find(c=>c.id===chat.id).unread,1);
  assert.equal(rows.find(c=>c.id===chat.id).archived,0);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
