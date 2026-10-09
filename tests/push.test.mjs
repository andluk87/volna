import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createECDH,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
const subscription=()=>{const key=createECDH('prime256v1');key.generateKeys();return {endpoint:'https://fcm.googleapis.com/fcm/send/'+randomUUID(),keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};};
test('push: private defaults, ownership, durable queue/key, preview, read suppression, retries, revoked sessions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-push-'));const database=join(dir,'db');let app,base;const sent=[];let status=201;
 const sender=async(sub,payload,options)=>{if(status!==201)throw Object.assign(Error('provider rejected'),{statusCode:status});sent.push({sub,payload:JSON.parse(payload),options});};
 async function start(){app=createApp({database,pushSender:sender});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}/api`;}
 async function req(path,token,data){const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};}
 const due=async()=>{app.db.prepare('UPDATE push_jobs SET next_at=0').run();await app.push.drain();};await start();
 try{
  const a=(await req('/register','',{username:'alice',password:'test-password-long'})).data,b=(await req('/register','',{username:'boris',password:'test-password-long'})).data,c=(await req('/register','',{username:'carol',password:'test-password-long'})).data;
  const sub=subscription(),chat=(await req('/chats',a.token,{user_id:b.user.id})).data.id;
  assert.equal((await req('/push/config','')).status,401);const publicKey=(await req('/push/config',b.token)).data;assert.deepEqual(Object.keys(publicKey),['publicKey']);
  for(const endpoint of ['http://127.0.0.1/internal','https://localhost/private','https://fcm.googleapis.com.evil.test/a','https://user:password@fcm.googleapis.com/a','https://fcm.googleapis.com:444/a'])assert.equal((await req('/push/subscribe',b.token,{subscription:{...sub,endpoint}})).status,400);
  assert.equal((await req('/push/subscribe',b.token,{subscription:sub})).status,200);
  assert.equal((await req('/push/subscribe',c.token,{subscription:sub})).status,409);
  assert.equal((await req('/push/status',c.token,{endpoint:sub.endpoint})).data.subscribed,false);
  const send=async text=>(await req(`/chats/${chat}/messages`,a.token,{text,client_id:randomUUID()})).data;
  await send('Первый секрет');await send('Второй секрет');assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_jobs').get().n,1);
  await app.close();await start();assert.deepEqual((await req('/push/config',b.token)).data,publicKey);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_jobs').get().n,1);
  await due();assert.equal(sent.length,1);assert.equal(sent[0].payload.title,'Волна');assert.equal(sent[0].payload.body,'Новое сообщение');assert.equal(JSON.stringify(sent[0].payload).includes('секрет'),false);assert.equal(sent[0].payload.chat_id,chat);
  await req('/push/subscribe',b.token,{subscription:sub,preview:true});await send('Видимый текст');await due();assert.equal(sent.at(-1).payload.body,'Видимый текст');
  const pushCount=sent.length;await req('/push/subscribe',b.token,{subscription:sub,preview:true});await send('Mute removes queued push');
  await req(`/chats/${chat}/preferences`,b.token,{muted:true});await due();assert.equal(sent.length,pushCount);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_jobs').get().n,0);
  await req(`/chats/${chat}/preferences`,b.token,{muted:false});
  const read=await send('Уже прочитано');await req(`/chats/${chat}/read`,b.token,{message_id:read.id});await due();assert.equal(sent.length,2);
  status=503;await send('Повтор');await due();assert.equal(app.db.prepare('SELECT attempts FROM push_jobs').get().attempts,1);status=201;await due();assert.equal(sent.at(-1).payload.body,'Повтор');
  const device=randomBytes(16).toString('hex');const call=(await req('/calls/start',a.token,{device,chat_id:chat})).data;await req(`/calls/${call.id}/offer`,a.token,{device,description:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}});assert.equal(app.db.prepare("SELECT COUNT(*) n FROM push_jobs WHERE kind='call'").get().n,1);await req(`/calls/${call.id}/end`,a.token,{device});assert.equal(app.db.prepare("SELECT COUNT(*) n FROM push_jobs WHERE kind='call'").get().n,0);
  status=410;await send('Удалённая подписка');await due();assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,0);status=201;
  await req('/push/subscribe',b.token,{subscription:sub});await send('Не отправлять после выхода');await req('/logout',b.token,{});assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,0);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_jobs').get().n,0);
  assert.equal(app.db.prepare('PRAGMA user_version').get().user_version,7);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
