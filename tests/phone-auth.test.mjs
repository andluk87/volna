import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {notificoreSender} from '../server/phone-auth.mjs';
async function fixture(t){
 let now=Date.now();const sent=[];const app=createApp({database:':memory:',phoneAuthOptions:{sender:async row=>{sent.push({...row});return {id:'provider-'+sent.length};},smsReady:true,referenceStart:4,clock:()=>now}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const call=async(path,data,token)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),'User-Agent':'VolnaAndroid/test'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const login=async phone=>{const request=await call('/auth/sms/request',{phone});assert.equal(request.status,200);const code=sent.at(-1).code;const verified=await call('/auth/sms/verify',{sms_session_id:request.data.sms_session_id,code});assert.equal(verified.status,200);return verified.data;};
 return {app,call,sent,login,advance:ms=>{now+=ms;}};
}
test('phone login, fresh IDs, phone privacy, one-use SMS, retries and old auth removed',async t=>{
 const f=await fixture(t);const a=await f.login('+7 (900) 111-22-33');assert.ok(a.user.id>=1000000000);assert.equal(a.user.phone,'+79001112233');
 assert.equal(f.sent[0].reference,'ext_id_005');assert.equal(f.app.db.prepare('SELECT status FROM sms_challenges').get().status,'verified');
 const reuse=await f.call('/auth/sms/verify',{sms_session_id:f.sent[0].id,code:f.sent[0].code});assert.equal(reuse.status,410);
 f.advance(60001);const b=await f.login('+79001112233');assert.equal(a.user.id,b.user.id);assert.equal(f.sent[1].reference,'ext_id_006');assert.notEqual(f.sent[0].code,f.sent[1].code);
 const outsider=await f.login('+79009998877');assert.equal((await f.call('/users/'+a.user.id,undefined,outsider.token)).data.phone,undefined);
 for(const path of ['/register','/login','/password','/auth/telegram/config','/auth/telegram/start','/auth/telegram/exchange'])assert.equal((await f.call(path,{})).status,404);
 assert.deepEqual(f.app.db.prepare('PRAGMA table_info(users)').all().map(x=>x.name).filter(x=>/salt|hash|telegram|password/.test(x)),[]);
});
test('SMS expiry, resend invalidation, 5 attempts, cooldown and independent atomic references',async t=>{
 const f=await fixture(t);const phone='+79001112233';let first=await f.call('/auth/sms/request',{phone});const original={...f.sent.at(-1)};
 assert.equal((await f.call('/auth/sms/request',{phone})).status,429);
 f.advance(60001);const second=await f.call('/auth/sms/request',{phone});
 assert.equal((await f.call('/auth/sms/verify',{sms_session_id:first.data.sms_session_id,code:original.code})).status,410);
 const code=f.sent.at(-1).code,wrong=code==='000000'?'999999':'000000';
 for(let i=0;i<5;i++)assert.equal((await f.call('/auth/sms/verify',{sms_session_id:second.data.sms_session_id,code:wrong})).status,400);
 assert.equal((await f.call('/auth/sms/verify',{sms_session_id:second.data.sms_session_id,code})).status,410);
 f.advance(60001);first=await f.call('/auth/sms/request',{phone});f.advance(300001);
 assert.equal((await f.call('/auth/sms/verify',{sms_session_id:first.data.sms_session_id,code:f.sent.at(-1).code})).status,410);
 await Promise.all(Array.from({length:8},(_,i)=>f.call('/auth/sms/request',{phone:'+7900000000'+i})));
 assert.equal(new Set(f.sent.map(x=>x.reference)).size,f.sent.length);
 assert.ok(f.sent.every(x=>/^\d{6}$/.test(x.code)));
 assert.ok(f.app.db.prepare('SELECT * FROM sms_challenges').all().every(x=>!JSON.stringify(x).includes('"code":')));
});
test('QR scan requires Android and explicit approval, poll secret, expiration, one-use and rejection',async t=>{
 const f=await fixture(t);const android=await f.login('+79001112233');
 let q=(await f.call('/auth/qr/request',{platform:'web'})).data;
 assert.equal((await f.call('/auth/qr/poll',{id:q.id,poll_token:q.poll_token})).data.status,'pending');
 assert.equal((await f.call('/auth/qr/poll',{id:q.id,poll_token:'bad'})).status,404);
 assert.equal((await f.call('/auth/qr/scan',{qr_text:q.qr_text})).status,401);
 assert.equal((await f.call('/auth/qr/scan',{qr_text:q.qr_text},android.token)).status,200);
 assert.equal((await f.call('/auth/qr/poll',{id:q.id,poll_token:q.poll_token})).data.status,'scanned');
 await f.call('/auth/qr/confirm',{qr_text:q.qr_text,approve:true},android.token);
 const web=(await f.call('/auth/qr/poll',{id:q.id,poll_token:q.poll_token})).data;assert.ok(web.token);assert.equal(web.user.id,android.user.id);
 assert.equal((await f.call('/auth/qr/poll',{id:q.id,poll_token:q.poll_token})).data.token,undefined);
 assert.equal((await f.call('/auth/qr/scan',{qr_text:q.qr_text},android.token)).status,410);
 q=(await f.call('/auth/qr/request',{platform:'windows'})).data;
 assert.equal((await f.call('/auth/qr/scan',{qr_text:q.qr_text},web.token)).status,403);
 await f.call('/auth/qr/scan',{qr_text:q.qr_text},android.token);await f.call('/auth/qr/confirm',{qr_text:q.qr_text,approve:false},android.token);
 assert.equal((await f.call('/auth/qr/poll',{id:q.id,poll_token:q.poll_token})).data.status,'rejected');
 q=(await f.call('/auth/qr/request',{platform:'windows'})).data;f.advance(180001);
 assert.equal((await f.call('/auth/qr/poll',{id:q.id,poll_token:q.poll_token})).data.status,'expired');
});
test('refresh rotates secrets, preserves device sessions, revoke/logout kills refresh and pending approvals',async t=>{
 const f=await fixture(t);const a=await f.login('+79001112233');f.advance(60001);const b=await f.login('+79001112233');
 const rotated=await f.call('/auth/refresh',{refresh_token:a.refresh_token});assert.equal(rotated.status,200);assert.notEqual(rotated.data.token,a.token);
 assert.equal((await f.call('/me',undefined,a.token)).status,401);assert.equal((await f.call('/me',undefined,b.token)).status,200);
 assert.equal((await f.call('/auth/refresh',{refresh_token:a.refresh_token})).status,401);
 const sessions=(await f.call('/sessions',undefined,rotated.data.token)).data;assert.equal(sessions.length,2);
 await f.call('/sessions/others/revoke',{},rotated.data.token);assert.equal((await f.call('/auth/refresh',{refresh_token:b.refresh_token})).status,401);
 await f.call('/logout',{},rotated.data.token);assert.equal((await f.call('/auth/refresh',{refresh_token:rotated.data.refresh_token})).status,401);
});
test('Notificore exact payload and headers, structured success, provider failures do not expose responses',async()=>{
 let request;const send=notificoreSender({key:'secret-for-test',originator:'Volna',fetcher:async(url,opts)=>{request={url,...opts};return {ok:true,text:async()=>JSON.stringify({result:{error:0,id:'213',body:'should-not-be-retained'}})};}});
 assert.deepEqual(await send({phone:'+79001112233',code:'234568',reference:'ext_id_005'}),{id:'213',error:0});
 assert.equal(request.url,'https://api.notificore.ru/v1.0/sms/create');assert.equal(request.headers['X-API-KEY'],'secret-for-test');
 assert.deepEqual(JSON.parse(request.body),{destination:'phone',originator:'Volna',body:'234-568 твоя волна',msisdn:'79001112233',reference:'ext_id_005'});
 for(const text of ['not json',JSON.stringify({result:{error:25,errorDescription:'private data'}})])await assert.rejects(notificoreSender({key:'key',originator:'Volna',fetcher:async()=>({ok:true,text:async()=>text})})({phone:'+79001112233',code:'123456',reference:'ext_id_001'}),e=>e.status===503&&!e.message.includes('private'));
});
test('web QR delivers HttpOnly cookie, refresh accepts the cookie, phones and provider codes stay private',async t=>{
 const f=await fixture(t),a=await f.login('+79001234567');const request=await f.call('/auth/qr/request',{platform:'web'});
 assert.equal((await f.call('/auth/qr/scan',{qr_text:request.data.qr_text},a.token)).status,200);
 assert.equal((await f.call('/auth/qr/confirm',{qr_text:request.data.qr_text,approve:true},a.token)).status,200);
 const base=`http://127.0.0.1:${f.app.server.address().port}/api`;
 const poll=await fetch(base+'/auth/qr/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:request.data.id,poll_token:request.data.poll_token})});const data=await poll.json(),cookie=poll.headers.get('set-cookie');
 assert.ok(data.token);assert.equal(data.refresh_token,undefined);assert.match(cookie,/HttpOnly; Secure; SameSite=Strict; Path=\/api\/auth/);
 const refreshed=await fetch(base+'/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie.split(';')[0]},body:'{}'});assert.equal(refreshed.status,200);assert.equal((await refreshed.json()).refresh_token,undefined);assert.notEqual(refreshed.headers.get('set-cookie'),cookie);
});
test('failed provider invalidates the challenge and SMS phone rate persists in the database',async t=>{
 const sent=[];let now=Date.now();const app=createApp({database:':memory:',phoneAuthOptions:{smsReady:true,clock:()=>now,sender:async row=>{sent.push(row);throw Error('private provider secret');}}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}/api`;
 async function call(path,data){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
 for(let i=0;i<5;i++){const result=await call('/auth/sms/request',{phone:'+79001234567'});assert.equal(result.status,503);assert.ok(!JSON.stringify(result.data).includes('private'));assert.equal(result.data.code,undefined);now+=60001;}
 assert.equal((await call('/auth/sms/request',{phone:'+79001234567'})).status,429);
 assert.equal((await call('/auth/sms/verify',{sms_session_id:sent[0].id,code:sent[0].code})).status,410);
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
});

test('SMS diagnostics distinguish provider rejection without retaining phones, body or secrets',async()=>{
 const send=notificoreSender({key:'private-key',originator:'Volna',fetcher:async()=>({ok:false,status:401,text:async()=>JSON.stringify({result:{error:25,errorDescription:'private response',body:'123456',msisdn:'79001234567'}})})});
 await assert.rejects(send({phone:'+79001234567',code:'123456',reference:'ext_id_001'}),e=>{assert.deepEqual(e.smsDiagnostic,{kind:'provider-rejected',http_status:401,provider_error:25});assert.ok(!JSON.stringify(e).includes('private'));return e.status===503;});
});

test('SMS request logs acceptance or a network failure without leaking the challenge',async t=>{
 const events=[];let broken=true;
 const app=createApp({database:':memory:',phoneAuthOptions:{smsReady:true,logger:event=>events.push(event),sender:async()=>{if(broken)throw Object.assign(new Error('private credentials and phone'),{cause:{code:'ECONNREFUSED'}});return {id:'accepted-id'};}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const request=phone=>fetch(`http://127.0.0.1:${app.server.address().port}/api/auth/sms/request`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});
 assert.equal((await request('+79001234567')).status,503);broken=false;assert.equal((await request('+79007654321')).status,200);
 assert.deepEqual(events,[{event:'failed',reference:'ext_id_001',kind:'ECONNREFUSED'},{event:'accepted',reference:'ext_id_002'}]);
 assert.ok(!JSON.stringify(events).includes('private'));assert.ok(!JSON.stringify(events).includes('7900'));
});
