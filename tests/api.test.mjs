import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';

test('registration, auth, authorization, realtime delivery, idempotency, receipts, pagination, restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-'));const database=join(dir,'test.db');let app=createApp({database});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 let base=`http://127.0.0.1:${app.server.address().port}/api`;
 const call=async(path,token,data,extra={})=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 try{
  const alice=(await call('/register','',{username:'alice',name:'Алиса',password:'correct-password'})).data;
  const bob=(await call('/register','',{username:'bob',name:'Боб',password:'correct-password'})).data;
  const eve=(await call('/register','',{username:'eve',password:'correct-password'})).data;
  assert.ok(alice.token);assert.equal((await call('/register','',{username:'alice',password:'correct-password'})).status,409);
  assert.equal((await call('/chats','')).status,401);
  assert.equal((await call('/me',alice.token,undefined,{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('/users?q=bob',alice.token)).data[0].id,bob.user.id);
  const chat=(await call('/chats',alice.token,{user_id:bob.user.id})).data;
  assert.equal((await call('/chats',bob.token,{user_id:alice.user.id})).data.id,chat.id);
  assert.equal((await call(`/chats/${chat.id}/messages`,eve.token)).status,404);
  assert.equal((await call(`/chats/${chat.id}/messages`,eve.token,{text:'hack',client_id:randomUUID()})).status,404);
  assert.equal((await call(`/chats/${chat.id}/read`,eve.token,{message_id:1})).status,404);
  const controller=new AbortController();const stream=await fetch(base+'/events',{headers:{Authorization:'Bearer '+bob.token},signal:controller.signal});const reader=stream.body.getReader();await reader.read();
  const data={text:'Привет! <script>alert(1)</script>',client_id:randomUUID()};
  const sent=await call(`/chats/${chat.id}/messages`,alice.token,data);assert.equal(sent.status,201);
  const next=await Promise.race([reader.read(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('SSE timeout')),3000);timer.unref();})]);
  assert.match(new TextDecoder().decode(next.value),/"type":"message"/);controller.abort();
  assert.equal((await call(`/chats/${chat.id}/messages`,alice.token,data)).data.id,sent.data.id);
  assert.equal((await call(`/chats/${chat.id}/messages`,alice.token,{...data,text:'changed'})).status,409);
  assert.equal((await call('/chats',bob.token)).data[0].unread,1);
  assert.equal((await call(`/chats/${chat.id}/read`,bob.token,{message_id:sent.data.id})).status,200);
  assert.equal((await call('/chats',bob.token)).data[0].unread,0);
  assert.equal((await call('/chats',alice.token)).data[0].peer_read,sent.data.id);
  for(let i=0;i<52;i++)assert.equal((await call(`/chats/${chat.id}/messages`,alice.token,{text:'Message '+i,client_id:randomUUID()})).status,201);
  const latest=(await call(`/chats/${chat.id}/messages`,bob.token)).data;assert.equal(latest.length,50);
  assert.equal((await call(`/chats/${chat.id}/messages?before=${latest[0].id}`,bob.token)).data.length,3);
  assert.equal((await call(`/chats/${chat.id}/messages`,alice.token,{text:'x'.repeat(4001),client_id:randomUUID()})).status,400);
  assert.equal((await call('/logout',eve.token,{})).status,200);assert.equal((await call('/me',eve.token)).status,401);
  await app.close();app=createApp({database});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}/api`;
  assert.equal((await call('/me',alice.token)).data.username,'alice');assert.equal((await call(`/chats/${chat.id}/messages`,bob.token)).data.length,50);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
