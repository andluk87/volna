import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';

async function fixture(t){
 let now=Date.now();const sent=[],logs=[];
 const app=createApp({database:':memory:',phoneAuthOptions:{clock:()=>now,smsReady:true,codeGenerator:()=>String(900000+sent.length),sender:async c=>{sent.push({...c});return{id:'fixture'};},logger:e=>logs.push(e)}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const call=async(path,data,token)=>{const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:response.status,data:await response.json()};};
 const request=async phone=>(await call('/auth/sms/request',{phone})).data;
 const verify=async challenge=>(await call('/auth/sms/verify',{sms_session_id:challenge.sms_session_id,code:sent.find(c=>c.id===challenge.sms_session_id).code})).data;
 const login=async phone=>verify(await request(phone));
 const channel=uid=>app.db.prepare('SELECT chat_id FROM login_code_channels WHERE owner=?').get(uid)?.chat_id;
 return{app,base,call,request,verify,login,channel,sent,logs,advance:ms=>now+=ms};
}

test('same SMS code is readable only in the account private read-only service channel and encrypted at rest',async t=>{
 const f=await fixture(t),phone='+79991234567',first=await f.login(phone),other=await f.login('+79997654321');
 assert.equal(f.channel(first.user.id),undefined);
 f.advance(60001);
 const data={phone_e164:phone,platform:'android',request_id:randomUUID(),app_hash:''};
 const start=await f.call('/v1/auth/otp/start',data);assert.equal(start.status,200);
 const code=f.sent.at(-1).code,id=f.channel(first.user.id);assert.ok(id);
 const rows=await f.call(`/chats/${id}/messages`,undefined,first.token);assert.equal(rows.status,200);assert.equal(rows.data.length,1);assert.ok(rows.data[0].text.includes(code));
 assert.equal((await f.call(`/chats/${id}/messages`,undefined,other.token)).status,404);
 assert.equal((await f.call(`/chats/${id}/messages`)).status,401);
 assert.equal((await f.call(`/chats/${id}/messages`,{text:'fake code',client_id:randomUUID()},first.token)).status,403);
 assert.equal((await f.call(`/communities/${id}/invite`,{},first.token)).status,403);
 const direct=(await f.call('/chats',{user_id:other.user.id},first.token)).data;
 const forwarded=await f.call(`/messages/${rows.data[0].id}/forward`,{chat_id:direct.id,client_id:randomUUID()},first.token);
 assert.equal(forwarded.status,201);assert.equal(forwarded.data.text.includes(code),false);

 assert.ok(f.app.db.prepare('SELECT text FROM messages WHERE chat_id=?').all(id).every(r=>!r.text.includes(code)));
 assert.equal(f.app.db.prepare('SELECT cipher FROM login_code_messages').get().cipher.length,6);
 assert.equal(JSON.stringify(f.logs).includes(code),false);
 assert.equal(JSON.stringify(start.data).includes(code),false);
 assert.equal((await f.call('/v1/auth/otp/start',data)).status,200);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM login_code_messages').get().n,1);
 const verified=await f.verify(start.data);assert.equal(verified.user.id,first.user.id);
 assert.equal(f.app.db.prepare('SELECT cipher FROM login_code_messages').get().cipher,null);
 const after=await f.call(`/chats/${id}/messages`,undefined,first.token);assert.equal(after.data[0].text.includes(code),false);
 assert.equal((await f.call('/auth/sms/verify',{sms_session_id:start.data.challenge_id,code})).status,410);
});

test('expired, cancelled and replaced attempts no longer expose the code; revoked accounts receive no device copy',async t=>{
 const f=await fixture(t),phone='+79991234567',user=await f.login(phone);f.advance(60001);
 const first=await f.request(phone),firstCode=f.sent.at(-1).code,id=f.channel(user.user.id);f.advance(60001);
 const second=await f.request(phone),secondCode=f.sent.at(-1).code;
 let rows=(await f.call(`/chats/${id}/messages`,undefined,user.token)).data;
 assert.equal(rows.some(r=>r.text.includes(firstCode)),false);assert.ok(rows.some(r=>r.text.includes(secondCode)));
 await f.call('/auth/sms/cancel',{challenge_id:second.sms_session_id});
 rows=(await f.call(`/chats/${id}/messages`,undefined,user.token)).data;assert.equal(rows.some(r=>r.text.includes(secondCode)),false);
 f.advance(60001);await f.request(phone);const expiredCode=f.sent.at(-1).code;f.advance(300001);
 rows=(await f.call(`/chats/${id}/messages`,undefined,user.token)).data;assert.equal(rows.some(r=>r.text.includes(expiredCode)),false);
 const count=f.app.db.prepare('SELECT COUNT(*) n FROM login_code_messages').get().n;
 f.app.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.user.id);
 await f.request(phone);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM login_code_messages').get().n,count);
});

test('service notification reaches existing Android, Web and Windows sessions of the same account',async t=>{
 const f=await fixture(t),phone='+79991234567',one=await f.login(phone);
 const devices=[one];
 for(const platform of ['web','windows']){
  const qr=(await f.call('/auth/qr/request',{platform})).data;
  await f.call('/auth/qr/scan',{qr_text:qr.qr_text},one.token);
  await f.call('/auth/qr/confirm',{qr_text:qr.qr_text,approve:true},one.token);
  const device=(await f.call('/auth/qr/poll',{id:qr.id,poll_token:qr.poll_token})).data;
  assert.equal(device.platform,platform);devices.push(device);
 }
 f.advance(60001);
 const controllers=devices.map(()=>new AbortController());
 const readEvent=async(token,controller)=>{
  const r=await fetch(f.base+'/events',{headers:{Authorization:'Bearer '+token},signal:controller.signal});
  const reader=r.body.getReader();let buffer='';
  return{next:async()=>{while(true){const part=await reader.read();if(part.done)throw Error('stream ended');buffer+=new TextDecoder().decode(part.value);let p;while((p=buffer.indexOf('\n\n'))>=0){const line=buffer.slice(0,p);buffer=buffer.slice(p+2);if(line.startsWith('data: ')){const event=JSON.parse(line.slice(6));if(event.type==='message')return event;}}}},reader};
 };
 t.after(()=>controllers.forEach(c=>c.abort()));
 const streams=await Promise.all(devices.map((d,i)=>readEvent(d.token,controllers[i])));
 await f.request(phone);const code=f.sent.at(-1).code;
 const events=await Promise.all(streams.map(s=>s.next()));assert.equal(events[0].message.id,events[1].message.id);assert.ok(events.every(e=>e.message.text.includes(code)));
 controllers.forEach(c=>c.abort());
});
