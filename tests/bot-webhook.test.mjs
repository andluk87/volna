import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
import {signature} from '../server/bot-webhooks.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(fn){for(let i=0;i<200;i++){const v=await fn();if(v)return v;await sleep(50);}assert.fail('Timed out');}
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'volna-webhook-')),requests=[],key=randomBytes(32);let deliveryGate;let clock=Date.now(),reply={ok:false,status:500},validation=true,validateGate;
 const options={database:join(dir,'db'),uploads:join(dir,'uploads'),newsEnabled:false,webhookOptions:{key,now:()=>clock,random:()=>0.5,egress:async input=>{if(input.op==='validate'){if(validateGate)await validateGate;return {ok:validation};}requests.push(input);if(deliveryGate)await deliveryGate;return reply;}}};
 let app=createApp(options);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 async function call(path,token,data,method,headers={}){const r=await fetch('http://127.0.0.1:'+app.server.address().port+path,{method:method||(data===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:r.status===204?null:await r.json()};}
 const db=()=>app.db;
 function user(name){const id=db().prepare('INSERT INTO users(username,name,phone) VALUES(?,?,?)').run(name,name,'+7900'+String(Math.floor(Math.random()*1e7)).padStart(7,'0')).lastInsertRowid,token=randomUUID();db().prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);return {id,token};}
 const owner=user('webhook_owner'),other=user('webhook_other'),bot=(await call('/developer/v1/bots',owner.token,{username:'webhook_test_bot',display_name:'Webhook'})).data;
 const chat=(await call('/api/bots/'+bot.bot.id+'/start',other.token,{})).data.id;
 return {call,db,owner,other,bot,chat,requests,advance(ms){clock+=ms;},setReply(v){reply=v;},setValidation(v){validation=v;},gate(v){validateGate=v;},deliveryGate(v){deliveryGate=v;},async restart(){await app.close();app=createApp(options);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));},send:(text)=>call(`/api/chats/${chat}/messages`,other.token,{text,client_id:randomUUID()}),status:()=>call('/bot/v1/delivery/status',bot.token)};
}

test('webhook switches active poll atomically, signs exact bytes, retries durable event after restart, ACKs only 2xx',async t=>{
 const f=await fixture(t),b=f.bot;
 const poll=f.call('/bot/v1/updates?timeout=10',b.token);await sleep(50);
 const set=await f.call('/bot/v1/delivery/webhook',b.token,{url:'https://example.com/events'},'PUT');assert.equal(set.status,200,JSON.stringify(set.data));assert.equal((await poll).status,409);
 assert.equal((await f.call('/bot/v1/updates?timeout=0',b.token)).data.error.code,'DELIVERY_MODE_CONFLICT');
 const saved=f.db().prepare('SELECT secret FROM bot_webhooks WHERE bot_id=?').get(b.bot.id);assert.ok(!saved.secret.includes(set.data.webhook_secret));assert.equal((await f.status()).data.webhook_secret,undefined);
 await f.send('first webhook message');await eventually(()=>f.requests.length===1);const first=f.requests[0];assert.equal(first.signature,signature(set.data.webhook_secret,first.timestamp,first.body));assert.ok(!JSON.stringify(first).includes(b.token));
 await eventually(()=>f.db().prepare('SELECT failures FROM bot_webhooks WHERE bot_id=?').get(b.bot.id).failures===1);
 assert.equal(f.db().prepare('SELECT acked FROM bot_updates WHERE bot_id=?').get(b.bot.id).acked,0);
 await f.restart();await sleep(550);assert.equal(f.requests.length,1);f.setReply({ok:true,status:204});f.advance(1100);
 await eventually(()=>f.requests.length===2);assert.equal(f.requests[1].event_id,first.event_id);assert.equal(f.requests[1].body,first.body);
 await eventually(()=>f.db().prepare('SELECT acked FROM bot_updates WHERE bot_id=?').get(b.bot.id).acked===1);
 assert.equal((await f.status()).data.recent_attempts[0].attempts,2);f.advance(600000);await sleep(550);assert.equal(f.requests.length,2);
 assert.equal((await f.call('/bot/v1/delivery/webhook',b.token,undefined,'DELETE')).status,204);assert.equal((await f.call('/bot/v1/updates?timeout=0',b.token)).status,200);
});

test('webhook validation, token rotation race, event subscription, pause/revoke and private grant checks',async t=>{
 const f=await fixture(t),b=f.bot;
 for(const data of [{url:'http://example.com'},{url:'https://127.1'},{url:'https://example.com',event_types:['unknown']},{url:'https://example.com',secret:'forged'}])assert.equal((await f.call('/bot/v1/delivery/webhook',b.token,data,'PUT')).status,400);
 f.setValidation(false);assert.equal((await f.call('/bot/v1/delivery/webhook',b.token,{url:'https://example.com'},'PUT')).status,400);assert.equal((await f.status()).data.mode,'polling');f.setValidation(true);
 let release;f.gate(new Promise(r=>release=r));const pending=f.call('/bot/v1/delivery/webhook',b.token,{url:'https://example.com'},'PUT');await sleep(50);
 const next=await f.call('/developer/v1/bots/'+b.bot.id+'/tokens',f.owner.token,{});release();assert.equal((await pending).status,401);f.gate(null);b.token=next.data.token;
 assert.equal((await f.call('/bot/v1/delivery/webhook',b.token,{url:'https://example.com',event_types:['message.created']},'PUT')).status,200);
 await f.call('/developer/v1/bots/'+b.bot.id,f.owner.token,{status:'suspended'},'PATCH');await f.send('during pause');await sleep(550);assert.equal(f.requests.length,0);
 await f.call('/developer/v1/bots/'+b.bot.id,f.owner.token,{status:'active'},'PATCH');
 await f.send('queued then blocked');await f.call('/api/bots/'+b.bot.id+'/block',f.other.token,{});await sleep(600);assert.equal(f.requests.length,0);
 await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{});f.setReply({ok:true,status:200});await f.send('after unblock');await eventually(()=>f.requests.length===1);assert.equal(JSON.parse(f.requests[0].body).data.text,'after unblock');
 await f.call('/developer/v1/bots/'+b.bot.id+'/tokens/'+next.data.token_id,f.owner.token,undefined,'DELETE');await f.send('revoked token');await sleep(600);assert.equal(f.requests.length,1);
});

test('main bot owns webhook configuration, validates asynchronously and displays secret only in owner private chat',async t=>{
 const f=await fixture(t),b=f.bot,manager=(await f.call('/api/bots/manager',f.owner.token,{})).data;
 const send=text=>f.call(`/api/chats/${manager.id}/messages`,f.owner.token,{text,client_id:randomUUID()});
 await send(`/webhook @${b.bot.username} https://example.com/events`);
 await eventually(async()=> (await f.status()).data.mode==='webhook');
 const history=(await f.call(`/api/chats/${manager.id}/messages`,f.owner.token)).data,answer=history.find(m=>m.text.includes('Секрет подписи (храните в секрете)'));
 assert.ok(answer);const secret=answer.text.match(/секрете\):\n([A-Za-z0-9_-]{43})/)[1];assert.ok(secret);assert.ok(!JSON.stringify((await f.status()).data).includes(secret));
 const stranger=(await f.call('/api/bots/manager',f.other.token,{})).data;await f.call(`/api/chats/${stranger.id}/messages`,f.other.token,{text:`/webhook @${b.bot.username} off`,client_id:randomUUID()});await sleep(100);assert.equal((await f.status()).data.mode,'webhook');
 await send(`/webhook @${b.bot.username} off`);await eventually(async()=> (await f.status()).data.mode==='polling');
 f.setValidation(false);await send(`/webhook @${b.bot.username} https://example.com/new`);await eventually(async()=> (await f.status()).data.last_error==='ADDRESS_VALIDATION_FAILED');assert.equal((await f.status()).data.mode,'polling');
});

test('webhook callback subscription, expired events and late old-generation response cannot ACK new transport',async t=>{
 const f=await fixture(t),b=f.bot;
 // Queue an event under polling, then let its TTL expire before webhook sends.
 await f.send('expire me');await f.call('/bot/v1/updates?timeout=0',b.token);
 const first=f.db().prepare('SELECT * FROM bot_updates WHERE bot_id=?').get(b.bot.id);
 f.db().prepare('UPDATE bot_updates SET expires=? WHERE bot_id=?').run(Date.now()-1,b.bot.id);
 await f.call('/bot/v1/delivery/webhook',b.token,{url:'https://example.com',event_types:['callback.created']},'PUT');
 await f.send('not subscribed');await sleep(600);assert.equal(f.requests.length,0);
 const sent=await f.call('/bot/v1/messages',b.token,{chat_id:String(f.chat),type:'text',text:'Press',reply_markup:{inline_keyboard:[[{text:'Go',callback_data:'private payload'}]]}},'POST',{'Idempotency-Key':randomUUID()});assert.equal(sent.status,201);
 const history=(await f.call(`/api/chats/${f.chat}/messages`,f.other.token)).data,message=history.find(m=>m.id===Number(sent.data.id));
 f.setReply({ok:true,status:200});const click=await f.call('/api/bots/interactions',f.other.token,{message_id:sent.data.id,button_id:message.bot_buttons[0][0].id,interaction_id:randomUUID()});assert.equal(click.status,200);
 await eventually(()=>f.requests.length===1);assert.equal(JSON.parse(f.requests[0].body).event_type,'callback.created');assert.equal(JSON.parse(f.requests[0].body).data.data,'private payload');await sleep(100);f.requests.length=0;
 await f.call('/bot/v1/delivery/webhook',b.token,undefined,'DELETE');
 const pending=(await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates;assert.equal(pending.length,1);assert.equal(pending[0].data.text,'not subscribed');assert.notEqual(pending[0].event_id,first.event_id);
 await f.call('/bot/v1/delivery/webhook',b.token,{url:'https://example.com'},'PUT');
 let release;f.deliveryGate(new Promise(r=>release=r));f.setReply({ok:true,status:200});await eventually(()=>f.requests.length===1);
 await f.call('/bot/v1/delivery/webhook',b.token,undefined,'DELETE');release();f.deliveryGate(null);await sleep(100);
 assert.equal(f.db().prepare('SELECT acked FROM bot_updates WHERE bot_id=? AND event_id=?').get(b.bot.id,pending[0].event_id).acked,0);
 assert.equal((await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates[0].event_id,pending[0].event_id);
});

test('paused bots and subscriptions without matching events do not starve active webhook delivery',async t=>{
 const f=await fixture(t),target=f.bot;f.setReply({ok:true,status:200});
 for(let i=0;i<5;i++){
  const b=(await f.call('/developer/v1/bots',f.owner.token,{username:'blocked_webhook_'+i,display_name:'Paused'})).data;
  await f.call('/bot/v1/delivery/webhook',b.token,{url:'https://example.com',event_types:['callback.created']},'PUT');
  const chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
  await f.call(`/api/chats/${chat}/messages`,f.other.token,{text:'not in subscription',client_id:randomUUID()});
  if(i<4)await f.call('/developer/v1/bots/'+b.bot.id,f.owner.token,{status:'suspended'},'PATCH');
 }
 await f.call('/bot/v1/delivery/webhook',target.token,{url:'https://example.com'},'PUT');await f.send('must deliver');
 await eventually(()=>f.requests.length===1);assert.equal(JSON.parse(f.requests[0].body).bot_id,target.bot.id);
});
