import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
async function fixture(t){let now=Date.now(),counter=834000,smsReady=true;const sent=[],logs=[];const app=createApp({database:':memory:',phoneAuthOptions:{clock:()=>now,smsReady:()=>smsReady,codeGenerator:()=>String(++counter),sender:async value=>{sent.push(value);return{id:'fixture'};},logger:event=>logs.push(event)}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const call=async(path,data,token)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','User-Agent':'Volna Windows 11 fixture',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const login=async phone=>{const start=(await call('/auth/sms/request',{phone})).data;return(await call('/auth/sms/verify',{sms_session_id:start.sms_session_id,code:sent.at(-1).code})).data;};
 const start=(phone,extra={})=>call('/auth/desktop/request',{phone,request_id:randomUUID(),client_secret:randomBytes(32).toString('base64url'),...extra});
 return {app,call,login,start,sent,logs,setSmsReady:value=>{smsReady=value;},advance:ms=>now+=ms,lastCode:()=>String(counter),channel:owner=>app.db.prepare('SELECT chat_id FROM login_code_channels WHERE owner=?').get(owner)?.chat_id};}
const intent=phone=>({phone,request_id:randomUUID(),client_secret:randomBytes(32).toString('base64url')});
test('Windows code is delivered privately without SMS, bound to its window and cannot issue Android credentials',async t=>{
 const f=await fixture(t),phone='+79991234567',user=await f.login(phone),other=await f.login('+79997654321'),data=intent(phone),before=f.sent.length;
 f.setSmsReady(false);const start=await f.call('/auth/desktop/request',data);assert.equal(start.status,200);assert.equal(start.data.delivery,'service');assert.equal(f.sent.length,before);const code=f.lastCode(),id=f.channel(user.user.id);assert.ok(id);assert.ok(!JSON.stringify(start.data).includes(code));
 const rows=(await f.call(`/chats/${id}/messages`,undefined,user.token)).data;assert.ok(rows.at(-1).text.includes(code));const direct=(await f.call('/chats',{user_id:other.user.id},user.token)).data;const forwarded=await f.call(`/messages/${rows.at(-1).id}/forward`,{chat_id:direct.id,client_id:randomUUID()},user.token);assert.equal(forwarded.status,201);assert.ok(!forwarded.data.text.includes(code));assert.equal((await f.call(`/chats/${id}/messages`,undefined,other.token)).status,404);assert.equal((await f.call(`/chats/${id}/messages`,{text:'fake',client_id:randomUUID()},user.token)).status,403);
 assert.equal((await f.call('/auth/sms/verify',{sms_session_id:start.data.challenge_id,code})).status,410);
 assert.equal((await f.call('/auth/desktop/verify',{challenge_id:start.data.challenge_id,client_secret:randomBytes(32).toString('base64url'),code})).status,401);
 const result=await f.call('/auth/desktop/verify',{challenge_id:start.data.challenge_id,client_secret:data.client_secret,code});assert.equal(result.status,200);assert.equal(result.data.platform,'windows');assert.equal(result.data.user.id,user.user.id);
 assert.equal((await f.call('/auth/qr/scan',{qr_text:'volna://login/'+'a'.repeat(43)},result.data.token)).status,403);
 assert.equal((await f.call('/auth/desktop/verify',{challenge_id:start.data.challenge_id,client_secret:data.client_secret,code})).status,410);
 const after=(await f.call(`/chats/${id}/messages`,undefined,user.token)).data;assert.ok(!after.some(row=>row.text.includes(code)));assert.ok(after.some(row=>row.text.includes('Вход с нового устройства')&&row.text.includes('Windows')));assert.equal(f.app.db.prepare('SELECT cipher FROM login_code_messages WHERE challenge_id=?').get(start.data.challenge_id).cipher,null);
 assert.ok(!JSON.stringify(f.logs).includes(code));assert.ok(!f.app.db.prepare('SELECT text FROM messages').all().some(row=>row.text.includes(code)));
});
test('idempotent requests do not send another code and replacement, attempts and cancellation clear old encrypted codes',async t=>{
 const f=await fixture(t),phone='+79991234567',user=await f.login(phone),data=intent(phone),a=await f.call('/auth/desktop/request',data),code=f.lastCode();assert.equal((await f.call('/auth/desktop/request',data)).data.challenge_id,a.data.challenge_id);assert.equal(f.lastCode(),code);
 assert.equal((await f.start(phone)).status,429);f.advance(60001);const bData=intent(phone),b=await f.call('/auth/desktop/request',bData);assert.equal((await f.call('/auth/desktop/verify',{challenge_id:a.data.challenge_id,client_secret:data.client_secret,code})).status,410);
 for(let i=0;i<5;i++){const bad=await f.call('/auth/desktop/verify',{challenge_id:b.data.challenge_id,client_secret:bData.client_secret,code:'000000'});assert.equal(bad.status,400);if(i===4)assert.equal(bad.data.code,'ATTEMPTS_EXCEEDED');}
 assert.equal(f.app.db.prepare('SELECT cipher FROM login_code_messages WHERE challenge_id=?').get(b.data.challenge_id).cipher,null);
 f.advance(60001);const cData=intent(phone),c=await f.call('/auth/desktop/request',cData);assert.equal((await f.call('/auth/desktop/cancel',{challenge_id:c.data.challenge_id,client_secret:data.client_secret})).status,401);assert.equal((await f.call('/auth/desktop/cancel',{challenge_id:c.data.challenge_id,client_secret:cData.client_secret})).status,200);
 const rows=(await f.call(`/chats/${f.channel(user.user.id)}/messages`,undefined,user.token)).data;assert.ok(rows.every(x=>!x.text.includes(f.lastCode())));
});
test('unknown numbers cannot register; expired or fully revoked account challenges cannot log in',async t=>{
 const f=await fixture(t),phone='+79991234567',user=await f.login(phone),unknown=intent('+79991110000'),a=await f.call('/auth/desktop/request',unknown),code=f.lastCode(),count=f.app.db.prepare('SELECT COUNT(*) n FROM users').get().n;
 assert.equal(a.status,200);assert.equal((await f.call('/auth/desktop/verify',{challenge_id:a.data.challenge_id,client_secret:unknown.client_secret,code})).status,410);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM users').get().n,count);
 const data=intent(phone),b=await f.call('/auth/desktop/request',data),valid=f.lastCode();f.app.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.user.id);assert.equal((await f.call('/auth/desktop/verify',{challenge_id:b.data.challenge_id,client_secret:data.client_secret,code:valid})).status,410);assert.equal(f.app.db.prepare('SELECT cipher FROM login_code_messages WHERE challenge_id=?').get(b.data.challenge_id).cipher,null);
 f.advance(300001);assert.equal((await f.call('/auth/desktop/verify',{challenge_id:a.data.challenge_id,client_secret:unknown.client_secret,code})).status,410);
});
test('QR Windows login sends one private new-device notification, refresh and used polls do not repeat it',async t=>{
 const f=await fixture(t),user=await f.login('+79991234567'),qr=(await f.call('/auth/qr/request',{platform:'windows'})).data;await f.call('/auth/qr/scan',{qr_text:qr.qr_text},user.token);await f.call('/auth/qr/confirm',{qr_text:qr.qr_text,approve:true},user.token);const win=(await f.call('/auth/qr/poll',{id:qr.id,poll_token:qr.poll_token})).data;
 const id=f.channel(user.user.id);assert.ok(id);await f.call('/auth/qr/poll',{id:qr.id,poll_token:qr.poll_token});await f.call('/auth/refresh',{refresh_token:win.refresh_token});const rows=(await f.call(`/chats/${id}/messages`,undefined,user.token)).data;assert.equal(rows.filter(row=>row.text.includes('Вход с нового устройства')).length,1);
});

test('refresh preserves a delivered code; revoking all delivery devices cannot be bypassed by a later login',async t=>{
 const f=await fixture(t),phone='+79991234567',mobile=await f.login(phone),aData=intent(phone),a=await f.call('/auth/desktop/request',aData),aCode=f.lastCode();
 assert.equal((await f.call('/auth/refresh',{refresh_token:mobile.refresh_token})).status,200);
 assert.equal((await f.call('/auth/desktop/verify',{challenge_id:a.data.challenge_id,client_secret:aData.client_secret,code:aCode})).status,200);
 f.advance(60001);const bData=intent(phone),b=await f.call('/auth/desktop/request',bData),bCode=f.lastCode();f.app.db.prepare('DELETE FROM sessions WHERE user_id=?').run(mobile.user.id);f.advance(60001);const again=await f.login(phone);const messages=(await f.call(`/chats/${f.channel(again.user.id)}/messages`,undefined,again.token)).data;assert.ok(messages.every(row=>!row.text.includes(bCode)));
 assert.equal((await f.call('/auth/desktop/verify',{challenge_id:b.data.challenge_id,client_secret:bData.client_secret,code:bCode})).status,410);
});
