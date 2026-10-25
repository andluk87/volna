import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index.mjs';
test('server restart preserves Android and Windows refresh sessions in the existing database',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'volna-restart-'));let app;
 t.after(async()=>{if(app)await app.close();await rm(directory,{recursive:true,force:true});});
 const start=async()=>{app=createApp({database:path.join(directory,'volna.db'),newsEnabled:false,phoneAuthOptions:{smsReady:true,sender:async()=>({id:'test'}),codeGenerator:()=> '123456'}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));};
 const call=async(route,data,token)=>{const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api`+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,data:await response.json()};};
 await start();const sms=await call('/auth/sms/request',{phone:'+79001112233'});const android=(await call('/auth/sms/verify',{sms_session_id:sms.data.sms_session_id,code:'123456'})).data;
 const qr=(await call('/auth/qr/request',{platform:'windows'})).data;await call('/auth/qr/scan',{qr_text:qr.qr_text},android.token);await call('/auth/qr/confirm',{qr_text:qr.qr_text,approve:true},android.token);const windows=(await call('/auth/qr/poll',{id:qr.id,poll_token:qr.poll_token})).data;
 assert.ok(windows.refresh_token);const hmac=app.db.prepare("SELECT value FROM auth_settings WHERE key='hmac'").get().value;
 await app.close();app=null;await start();assert.equal(app.db.prepare("SELECT value FROM auth_settings WHERE key='hmac'").get().value,hmac);
 for(const saved of [android,windows]){const restored=await call('/auth/refresh',{refresh_token:saved.refresh_token,account_id:saved.user.id});assert.equal(restored.status,200);assert.equal(restored.data.platform,saved.platform);assert.equal((await call('/me',undefined,restored.data.token)).status,200);}
});
