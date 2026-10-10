import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {smsMessage} from '../server/sms-message.mjs';
import {gatewaySender,notificoreSender} from '../server/sms-providers.mjs';
const hash='AbCdEfGhIjK';
async function fixture(t,extra={}){
 let now=Date.now(),hold;const sent=[];
 const app=createApp({database:':memory:',phoneAuthOptions:{smsReady:true,appHashes:[hash],clock:()=>now,codeGenerator:()=>String(123456+sent.length).padStart(6,'0'),sender:async row=>{sent.push(row);if(hold)await hold;return {id:'id-'+sent.length};},...extra}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const call=async(path,data)=>{const r=await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
 const start=(data={})=>call('v1/auth/otp/start',{phone_e164:'+79001234567',platform:'android',locale:'ru',request_id:'test-request-00000001',app_hash:hash,...data});
 return {app,sent,call,start,advance:ms=>now+=ms,pause:()=>{let release;hold=new Promise(r=>release=r);return ()=>{hold=null;release();};}};
}
test('Android OTP sends bounded own-app message, masked metadata and leading-zero codes through both providers',async()=>{
 const challenge={id:'A'.repeat(43),phone:'+79001234567',code:'001234',reference:'ref',android:true,appHash:hash};
 const text=smsMessage(challenge);assert.ok(Buffer.byteLength(text)<=140);assert.equal(text,'001234 твоя волна Попытка: AAAAAAAA AbCdEfGhIjK');assert.ok(!/[\r\n]/.test(text));
 assert.equal(smsMessage({...challenge,android:false}),'001234 твоя волна');
 assert.ok(!smsMessage({...challenge,appHash:''}).endsWith(hash));
 let observed;
 await notificoreSender({key:'test',originator:'Volna',fetcher:async(_,options)=>{observed=JSON.parse(options.body).body;return {ok:true,text:async()=>'{"result":{"error":0,"id":"001"}}'};}})(challenge);assert.equal(observed,text);
 await gatewaySender({url:'http://sms.invalid/',user:'test',password:'test',fetcher:async url=>{observed=new URL(url).searchParams.get('m');return {ok:true,text:async()=> 'Sending,L4 Send SMS to:89001234567; ID:0001'};}})(challenge);assert.equal(observed,text);
});
test('Android start is idempotent, exposes no OTP, verifies once and leaves legacy login available',async t=>{
 const f=await fixture(t);const a=await f.start();assert.equal(a.status,200);assert.equal(a.body.otp_length,6);assert.equal(a.body.sms_retriever,true);assert.equal(a.body.sms_nonce,a.body.challenge_id.slice(0,8));assert.ok(!JSON.stringify(a.body).includes('123456'));assert.ok(!JSON.stringify(a.body).includes('79001234567'));
 assert.equal((await f.start()).body.challenge_id,a.body.challenge_id);assert.equal(f.sent.length,1);
 const auth=await f.call('v1/auth/otp/verify',{challenge_id:a.body.challenge_id,code:f.sent[0].code});assert.equal(auth.status,200);assert.ok(auth.body.refresh_token);
 assert.equal((await f.call('v1/auth/otp/verify',{challenge_id:a.body.challenge_id,code:f.sent[0].code})).body.code,'CODE_EXPIRED');
 assert.equal((await f.start()).body.code,'REQUEST_ALREADY_PROCESSED');
 f.advance(60001);assert.equal((await f.call('auth/sms/request',{phone:'+79001234567'})).status,200);assert.equal(f.sent.at(-1).android,false);
});
test('untrusted APK hashes and missing hashes use consent/manual SMS, not arbitrary app hashes',async t=>{
 const f=await fixture(t);assert.equal((await f.start({app_hash:'Z'.repeat(11)})).body.sms_retriever,false);assert.equal(f.sent[0].appHash,'');
 assert.equal((await f.call('auth/config')).body.sms_retriever_hashes[0],hash);
 assert.equal((await f.start({request_id:'x'})).status,400);
 assert.equal((await f.start({platform:'web'})).status,400);
});
test('Android resend enforces server time, changes nonce/code and invalidates old OTP',async t=>{
 const f=await fixture(t),a=(await f.start()).body;
 const request={challenge_id:a.challenge_id,request_id:'test-request-00000002'};
 const early=await f.call('v1/auth/otp/resend',request);assert.equal(early.status,429);assert.equal(early.body.code,'RATE_LIMITED');assert.equal(early.body.retry_at,a.resend_available_at);
 f.advance(60001);const b=(await f.call('v1/auth/otp/resend',request)).body;assert.notEqual(a.challenge_id,b.challenge_id);assert.notEqual(a.sms_nonce,b.sms_nonce);assert.notEqual(f.sent[0].code,f.sent[1].code);
 assert.equal((await f.call('v1/auth/otp/resend',request)).body.challenge_id,b.challenge_id);assert.equal(f.sent.length,2);
 assert.equal((await f.call('v1/auth/otp/verify',{challenge_id:a.challenge_id,code:f.sent[0].code})).body.code,'CODE_EXPIRED');
});
test('Android status/cancel reveal only attempt metadata and never permit a cancelled login',async t=>{
 const f=await fixture(t),a=(await f.start()).body;
 const status=await f.call('v1/auth/otp/status',{challenge_id:a.challenge_id});assert.equal(status.body.status,'sent');assert.ok(!JSON.stringify(status.body).includes(f.sent[0].code));
 assert.equal((await f.call('v1/auth/otp/cancel',{challenge_id:a.challenge_id})).status,200);
 assert.equal((await f.call('v1/auth/otp/verify',{challenge_id:a.challenge_id,code:f.sent[0].code})).body.code,'CODE_EXPIRED');
 assert.equal((await f.call('v1/auth/otp/status',{challenge_id:'unknown'})).body.code,'CHALLENGE_NOT_FOUND');
});
test('Android pending concurrent start sends only one SMS and expiry/attempt limits remain authoritative',async t=>{
 const f=await fixture(t),release=f.pause();const first=f.start();
 while(!f.sent.length)await new Promise(r=>setTimeout(r,5));
 assert.equal((await f.start()).body.code,'REQUEST_IN_PROGRESS');release();const a=(await first).body;assert.equal(f.sent.length,1);
 for(let n=0;n<5;n++){const result=await f.call('v1/auth/otp/verify',{challenge_id:a.challenge_id,code:'000000'});assert.equal(result.body.code,n===4?'ATTEMPTS_EXCEEDED':'INVALID_CODE');}
 assert.equal((await f.call('v1/auth/otp/verify',{challenge_id:a.challenge_id,code:f.sent[0].code})).body.code,'ATTEMPTS_EXCEEDED');
 f.advance(60001);const b=(await f.start({request_id:'test-request-00000003'})).body;f.advance(300001);
 assert.equal((await f.call('v1/auth/otp/verify',{challenge_id:b.challenge_id,code:f.sent.at(-1).code})).body.code,'CODE_EXPIRED');
});

test('Android hourly/day limits expose the actual server-controlled next request time',async t=>{
 const f=await fixture(t),a=(await f.start()).body;
 f.app.db.prepare('INSERT OR REPLACE INTO admin_config(id,value) VALUES(1,?)').run(JSON.stringify({sms_day:1}));
 f.advance(60001);const limited=await f.start({request_id:'test-request-00000002'});
 assert.equal(limited.status,429);assert.equal(limited.body.retry_at,a.server_time+86400000);assert.equal(f.sent.length,1);
});
