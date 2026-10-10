import net from 'node:net';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {gatewayPhone,gatewaySender} from '../server/sms-providers.mjs';
const reply=(text,status=200)=>({ok:status>=200&&status<300,status,text:async()=>text});
test('gateway request uses exact GET parameters, local Russian format, UTF-8 text and safe provider ID',async()=>{
 let request;const sender=gatewaySender({url:'http://sms.test:3825/default/en_US/send.html',user:'qa-user',password:'qa-password',line:'4',fetcher:async(url,options)=>{request={url,options};return reply('Sending,L4 Send SMS to:89681411241; ID:00001514');}});
 const result=await sender({phone:'+79681411241',code:'123456',reference:'ext_id_001'}),url=new URL(request.url);
 assert.ok(url.search.includes('m=123-456%20'));assert.equal(url.pathname,'/default/en_US/send.html');assert.deepEqual(Object.fromEntries(url.searchParams),{u:'qa-user',p:'qa-password',l:'4',n:'89681411241',m:'123-456 твоя волна'});
 assert.equal(request.options.headers['Cache-Control'],'no-store');assert.equal(request.options.method,'GET');assert.equal(request.options.redirect,'error');assert.ok(request.options.signal instanceof AbortSignal);
 assert.deepEqual(result,{id:'00001514',provider:'gateway',error:0});assert.ok(!JSON.stringify(result).includes('89681411241'));
 assert.equal(gatewayPhone('+79001234567'),'89001234567');for(const phone of ['89681411241','+19681411241','+7968141124','+796814112411'])assert.throws(()=>gatewayPhone(phone),e=>e.status===400);
});
test('gateway rejects HTTP, explicit failure, login HTML, unknown replies and unsupported numbers without retries or leaking secrets',async()=>{
 for(const [text,status] of [['ERROR,L4 Busy',200],['Sending,L4 ERROR invalid password',200],['<html><form>Login</form></html>',200],['',200],['Something happened',200],['OK',500],['Sending,L5 Send SMS to:89001234567; ID:001',200],['Sending,L4 Send SMS to:89000000000; ID:001',200]]){
  let calls=0;const sender=gatewaySender({user:'qa-user',password:'private-qa-password',fetcher:async()=>{calls++;return reply(text,status);}});
  await assert.rejects(sender({phone:'+79001234567',code:'123456',reference:'test'}),e=>e.status===503&&!e.message.includes('private')&&!e.message.includes('7900'));assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(gatewaySender({user:'qa-user',password:'qa-password',fetcher:async()=>{calls++;return reply('OK');}})({phone:'+12025550100',code:'123456',reference:'test'}),e=>e.status===400);assert.equal(calls,0);
 for(const url of ['file:///etc/passwd','http://user:password@sms.test/send','http://sms.test/send?p=secret'])await assert.rejects(gatewaySender({url,user:'qa-user',password:'qa-password'})({phone:'+79001234567',code:'123456'}),e=>e.status===503);
});
async function fixture(t,{configured=true}={}){
 let now=Date.now(),adminCode=123456;const requests=[],logs=[];
 const app=createApp({database:':memory:',smsOptions:{notificoreKey:'qa-key',notificoreOriginator:'Volna',gatewayUrl:'http://sms.test:3825/default/en_US/send.html',gatewayUser:'qa-user',gatewayPassword:configured?'qa-password':'',gatewayLine:'4',fetcher:async(url,options)=>{requests.push({url,options});return url.startsWith('http://sms.test')?reply('Sending,L4 Send SMS to:'+new URL(url).searchParams.get('n')+'; ID:00003c01'):reply(JSON.stringify({result:{error:0,id:'notificore-qa-id'}}));}},phoneAuthOptions:{clock:()=>now,codeGenerator:()=> '234567',logger:event=>logs.push(event)},adminOptions:{origin:'http://admin.test',cookieSecure:false,clock:()=>now,codeGenerator:()=>String(adminCode++)}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));await new Promise(r=>app.adminServer.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const normal='http://127.0.0.1:'+app.server.address().port+'/api/',admin='http://127.0.0.1:'+app.adminServer.address().port+'/admin/api/';let cookie='',csrf='';
 async function call(path,data,{adminCall=false}={}){const r=await fetch((adminCall?admin:normal)+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(adminCall?{Origin:'http://admin.test',Cookie:cookie,'X-Admin-CSRF':csrf}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json(),response:r};}
 const ac=(path,data)=>call(path,data,{adminCall:true});
 async function login(){const r=await ac('auth/request',{phone:'89681411241'});assert.equal(r.status,200);const v=await ac('auth/verify',{sms_session_id:r.data.sms_session_id,code:'123456'});assert.equal(v.status,200);cookie=v.response.headers.get('set-cookie').split(';')[0];csrf=v.data.csrf_token;}
 return {app,requests,logs,call,ac,login,advance:ms=>now+=ms};
}
test('admin-selected provider immediately routes regular and admin SMS, persists attribution and keeps secrets off APIs/logs',async t=>{
 const f=await fixture(t);await f.login();assert.equal(f.requests[0].options.method,'POST');
 const initial=(await f.ac('settings')).data;assert.equal(initial.sms_provider,'notificore');const statuses=await f.ac('sms/providers');assert.equal(statuses.data.providers.gateway.configured,true);
 assert.ok(!JSON.stringify(statuses.data).includes('qa-password'));assert.ok(!JSON.stringify(statuses.data).includes('qa-key'));
 assert.equal((await f.ac('settings',{settings:{...initial,sms_provider:'gateway'},reason:'Проверка шлюза'})).status,200);
 assert.equal((await f.call('auth/config')).data.sms_enabled,true);
 const r=await f.call('auth/sms/request',{phone:'+79001234567'});assert.equal(r.status,200);assert.equal(new URL(f.requests.at(-1).url).searchParams.get('n'),'89001234567');
 const verified=await f.call('auth/sms/verify',{sms_session_id:r.data.sms_session_id,code:'234567'});assert.equal(verified.status,200);
 const row=f.app.db.prepare('SELECT provider,provider_id FROM sms_challenges WHERE id=?').get(r.data.sms_session_id);assert.deepEqual({...row},{provider:'gateway',provider_id:'00003c01'});
 f.advance(60001);const adminRequest=await f.ac('auth/request',{phone:'89681411241'});assert.equal(adminRequest.status,200);assert.equal((await f.ac('auth/verify',{sms_session_id:adminRequest.data.sms_session_id,code:'123457'})).status,200);assert.equal(new URL(f.requests.at(-1).url).searchParams.get('n'),'89681411241');assert.equal(f.app.db.prepare('SELECT provider FROM admin_sms ORDER BY created DESC').get().provider,'gateway');
 assert.equal((await f.ac('settings',{settings:{...initial,sms_provider:'notificore'},reason:'Возврат'})).status,200);
 assert.equal((await f.call('auth/sms/request',{phone:'+79001234568'})).status,200);assert.equal(f.requests.at(-1).options.method,'POST');
 assert.ok(f.logs.some(e=>e.provider==='gateway'));assert.ok(!JSON.stringify(f.logs).includes('1234567'));assert.ok(!JSON.stringify(f.logs).includes('qa-password'));
});
test('unconfigured provider cannot be selected and unsupported gateway phone consumes no SMS request',async t=>{
 const f=await fixture(t,{configured:false});await f.login();const settings=(await f.ac('settings')).data;
 assert.equal((await f.ac('settings',{settings:{...settings,sms_provider:'gateway'},reason:'test'})).status,400);assert.equal((await f.ac('settings')).data.sms_provider,'notificore');
 const full=await fixture(t);await full.login();const ready=(await full.ac('settings')).data;await full.ac('settings',{settings:{...ready,sms_provider:'gateway'},reason:'test'});
 const count=full.requests.length;assert.equal((await full.call('auth/sms/request',{phone:'+12025550100'})).status,400);assert.equal(full.requests.length,count);assert.equal(full.app.db.prepare('SELECT COUNT(*) n FROM sms_challenges').get().n,0);
});
test('0.12.12 SMS histories migrate additively, provider selection persists and credentials never enter SQLite',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'volna-sms-upgrade-'));let app;
 t.after(async()=>{if(app)await app.close();rmSync(dir,{recursive:true,force:true});});
 const options={database:join(dir,'volna.db'),smsOptions:{gatewayUser:'qa-private-user',gatewayPassword:'qa-private-password'}};
 app=createApp(options);app.db.exec('ALTER TABLE sms_challenges DROP COLUMN provider; ALTER TABLE admin_sms DROP COLUMN provider;');
 app.db.prepare('INSERT INTO sms_challenges(id,phone,code_hash,reference,created,expires,status,ip) VALUES(?,?,?,?,?,?,?,?)').run('old-regular','+79001234567','a'.repeat(64),'ext_id_700',1,2,'expired','local');
 app.db.prepare('INSERT INTO admin_sms(id,phone,code_hash,reference,created,expires,status,ip) VALUES(?,?,?,?,?,?,?,?)').run('old-admin','+79681411241','b'.repeat(64),'ext_id_701',1,2,'verified','local');
 await app.close();app=null;app=createApp(options);
 assert.equal(app.db.prepare('SELECT provider,code_hash FROM sms_challenges WHERE id=?').get('old-regular').provider,'notificore');assert.equal(app.db.prepare('SELECT code_hash FROM admin_sms WHERE id=?').get('old-admin').code_hash,'b'.repeat(64));
 const settings=(await import('../server/admin-config.mjs')).readAdminSettings(app.db);app.db.prepare('INSERT INTO admin_config VALUES(1,?)').run(JSON.stringify({...settings,sms_provider:'gateway'}));await app.close();app=null;app=createApp(options);
 const config=app.db.prepare('SELECT value FROM admin_config').get().value;assert.equal(JSON.parse(config).sms_provider,'gateway');assert.ok(!config.includes('qa-private'));assert.equal(app.db.prepare('SELECT COUNT(*) n FROM sms_challenges').get().n,1);
});

test('legacy gateway headers rejected by fetch are accepted without redirects or retries',async()=>{
 let requests=0,body='Sending,L4 Send SMS to:89681411241; ID:00001514',status=200;
 const server=net.createServer(socket=>socket.once('data',()=>{requests++;socket.end(`HTTP/1.1 ${status} Response\r\nX-Legacy: value\u0001\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\nLocation: /redirect\r\n\r\n${body}`);}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/default/en_US/send.html`;
 try{
  await assert.rejects(fetch(url),e=>e.cause?.name==='HTTPParserError');
  const sender=gatewaySender({url,user:'test',password:'test'});
  assert.equal((await sender({phone:'+79681411241',code:'123456'})).id,'00001514');assert.equal(requests,2);
  status=302;await assert.rejects(sender({phone:'+79681411241',code:'123456'}),e=>e.smsDiagnostic?.kind==='gateway-rejected');assert.equal(requests,3);
  status=200;body='ERROR invalid credentials';await assert.rejects(sender({phone:'+79681411241',code:'123456'}),e=>e.smsDiagnostic?.kind==='gateway-rejected');assert.equal(requests,4);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('gateway accepts hexadecimal receipt IDs verbatim and rejects malformed IDs',async()=>{
 for(const id of ['00003c01','00003C01','00001514']){
  const sender=gatewaySender({user:'test',password:'test',fetcher:async()=>reply(`\nSending,L4 Send SMS to:89681411241; ID:${id}\n`)});
  assert.equal((await sender({phone:'+79681411241',code:'123456'})).id,id);
 }
 for(const id of ['00003g01','00003c01!','f'.repeat(33),'']){
  const sender=gatewaySender({user:'test',password:'test',fetcher:async()=>reply(`Sending,L4 Send SMS to:89681411241; ID:${id}`)});
  await assert.rejects(sender({phone:'+79681411241',code:'123456'}),e=>e.smsDiagnostic?.kind==='gateway-rejected');
 }
});
