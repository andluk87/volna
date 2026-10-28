import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';

test('finished calls update chat previews, unread and cross-device read without duplicate messages',async t=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const req=async(path,token,data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const users=[];for(const username of ['callalice','callboris','callcarol'])users.push((await req('/register','',{username,password:'password-long-enough'})).data);
 const [a,b,c]=users,device=randomBytes(16).toString('hex');
 const chat=(await req('/chats',a.token,{user_id:b.user.id})).data.id;
 const preview=async token=>(await req('/chats',token)).data.find(row=>row.id===chat);
 const ring=async()=>{
  const start=await req('/calls/start',a.token,{chat_id:chat,device});assert.equal(start.status,201);
  const id=start.data.id;
  assert.equal((await req(`/calls/${id}/offer`,a.token,{device,description:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}})).status,200);
  return id;
 };
 const id=await ring();assert.equal((await preview(b.token)).unread,0);
 assert.equal((await req(`/calls/${id}/end`,a.token,{device})).status,200);
 let p=await preview(b.token);assert.equal(p.last_text,'Пропущенный звонок');assert.equal(p.unread,1);assert.equal(p.last_call.id,id);assert.equal(p.last_call.incoming,true);assert.equal(p.last_id,null);
 p=await preview(a.token);assert.equal(p.last_text,'Отменённый звонок');assert.equal(p.unread,0);
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM messages WHERE chat_id=?').get(chat).n,0);
 assert.equal((await req('/calls/read',c.token,{chat_id:chat,call_ids:[id]})).status,404);
 // Caller cannot clear the callee's unread state.
 await req('/calls/read',a.token,{chat_id:chat,call_ids:[id]});assert.equal((await preview(b.token)).unread,1);
 await req('/calls/read',b.token,{chat_id:chat,call_ids:[id]});assert.equal((await preview(b.token)).unread,0);
 const next=await ring();await req(`/calls/${next}/end`,a.token,{device});
 await req('/calls/read',b.token,{chat_id:chat,call_ids:[id]});assert.equal((await preview(b.token)).unread,1);
 // A newer message wins the preview; unread calls and messages are counted together.
 await req(`/chats/${chat}/messages`,a.token,{text:'После звонка',client_id:randomBytes(16).toString('hex')});
 p=await preview(b.token);assert.equal(p.last_text,'После звонка');assert.equal(p.last_call,undefined);assert.equal(p.unread,2);
 await req(`/chats/${chat}/delete-chat`,b.token,{});assert.equal(await preview(b.token),undefined);
 const third=await ring();await req(`/calls/${third}/end`,a.token,{device});
 p=await preview(b.token);assert.equal(p.last_text,'Пропущенный звонок');assert.equal(p.unread,1);
 assert.equal((await req('/calls/read',b.token,{chat_id:chat,call_ids:['bad']})).status,400);
});

test('history preview respects answered, unoffered and per-user hidden calls',async t=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const req=async(path,token,data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const users=[];for(const username of ['historyalice','historyboris'])users.push((await req('/register','',{username,password:'password-long-enough'})).data);
 const [a,b]=users,chat=(await req('/chats',a.token,{user_id:b.user.id})).data.id;
 const id=randomBytes(16).toString('hex'),now=Date.now()-1000;
 app.db.prepare("INSERT INTO call_history(id,chat_id,caller,callee,created,answered,ended,status,ringed) VALUES(?,?,?,?,?,?,?,'ended',1)").run(id,chat,a.user.id,b.user.id,now,now,now+500);
 let rows=(await req('/chats',b.token)).data;assert.equal(rows.find(c=>c.id===chat).last_text,'Входящий звонок');assert.equal(rows.find(c=>c.id===chat).unread,0);
 await req('/calls/history/clear',b.token,{before:Date.now()});rows=(await req('/chats',b.token)).data;assert.equal(rows.find(c=>c.id===chat).last_call,undefined);
 assert.equal((await req('/chats',a.token)).data.find(c=>c.id===chat).last_text,'Исходящий звонок');
 const device=randomBytes(16).toString('hex');const start=(await req('/calls/start',a.token,{chat_id:chat,device})).data;
 await req(`/calls/${start.id}/end`,a.token,{device});assert.equal((await req('/calls/history',b.token)).data.length,0);
});
