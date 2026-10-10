import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createApp} from '../server/index.mjs';
import {defaultAdminSettings} from '../server/admin-config.mjs';
async function fixture(t,adminOptions={}){
 const dir=mkdtempSync(join(tmpdir(),'volna-admin-')),sent=[],regular=[];let now=Date.now(),cookie='',csrf='';
 const app=createApp({database:join(dir,'volna.db'),uploads:join(dir,'uploads'),adminOptions:{origin:'http://admin.test',cookieSecure:true,smsReady:true,sender:async row=>{sent.push({...row});return {id:'admin-provider'};},clock:()=>now,serviceStatus:async()=>({available:true,ready:true,state:'ready'}),...adminOptions},phoneAuthOptions:{smsReady:true,clock:()=>now,sender:async row=>{regular.push({...row});return {id:'regular-provider'};}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));await new Promise(r=>app.adminServer.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.adminServer.address().port}`,normal=`http://127.0.0.1:${app.server.address().port}/api`;
 async function admin(path,payload,headers={}){const r=await fetch(base+'/admin/api/'+path,{method:payload===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:'http://admin.test','X-Admin-CSRF':csrf,...headers},...(payload===undefined?{}:{body:JSON.stringify(payload)})});const d=await r.json();return {status:r.status,data:d,response:r};}
 async function call(path,payload,token){const r=await fetch(normal+path,{method:payload===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)})});return {status:r.status,data:await r.json()};}
 async function login(){const r=await admin('auth/request',{phone:'89681411241'});assert.equal(r.status,200,JSON.stringify(r.data));const v=await admin('auth/verify',{sms_session_id:r.data.sms_session_id,code:sent.at(-1).code});assert.equal(v.status,200,JSON.stringify(v.data));cookie=v.response.headers.get('set-cookie').split(';')[0];csrf=v.data.csrf_token;return v;}
 async function user(phone='+79000000001'){const r=await call('/auth/sms/request',{phone});assert.equal(r.status,200);const v=await call('/auth/sms/verify',{sms_session_id:r.data.sms_session_id,code:regular.at(-1).code});assert.equal(v.status,200);return v.data;}
 return {app,dir,base,admin,call,login,user,sent,regular,advance:ms=>now+=ms,cookie:()=>cookie};
}
test('admin SMS is separate, restricted to bootstrap phone, one-use, hashed and protected against CSRF/cross-origin',async t=>{
 const f=await fixture(t);assert.equal((await f.admin('users')).status,401);
 assert.equal((await f.admin('auth/request',{phone:'+79000000001'})).status,403);assert.equal(f.sent.length,0);
 const normal=await f.user();assert.equal((await f.admin('users',undefined,{Authorization:'Bearer '+normal.token})).status,401);
 assert.equal((await f.admin('auth/verify',{sms_session_id:f.regular[0].id,code:f.regular[0].code})).status,410);
 const v=await f.login();assert.match(v.response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal((await f.call('/auth/sms/verify',{sms_session_id:f.sent[0].id,code:f.sent[0].code})).status,410);
 assert.equal((await f.admin('auth/verify',{sms_session_id:f.sent[0].id,code:f.sent[0].code})).status,410);
 assert.equal((await f.admin('settings',{settings:defaultAdminSettings,reason:'test'},{'X-Admin-CSRF':''})).status,403);
 assert.equal((await f.admin('users',undefined,{Origin:'https://evil.test'})).status,403);
 assert.equal((await f.admin('users',undefined,{'Sec-Fetch-Site':'same-site'})).status,403);
 assert.equal((await f.admin('settings',{settings:defaultAdminSettings,reason:'test'})).status,200);
 const rows=f.app.db.prepare('SELECT * FROM admin_sessions').all();assert.ok(!JSON.stringify(rows).includes(f.cookie().slice(12)));assert.equal(rows.length,1);
 const sms=f.app.db.prepare('SELECT * FROM admin_sms').get();assert.notEqual(sms.code_hash,f.sent[0].code);
 assert.equal((await f.admin('logout',{})).status,200);assert.equal((await f.admin('users')).status,401);
});
test('admin SMS cooldown, five attempts and expiry never issue a session',async t=>{
 const f=await fixture(t);let r=await f.admin('auth/request',{phone:'+79681411241'});assert.equal(r.status,200);
 assert.equal((await f.admin('auth/request',{phone:'+79681411241'})).status,429);
 const wrong=f.sent[0].code==='000000'?'111111':'000000';for(let i=0;i<5;i++)assert.equal((await f.admin('auth/verify',{sms_session_id:r.data.sms_session_id,code:wrong})).status,400);
 assert.equal((await f.admin('auth/verify',{sms_session_id:r.data.sms_session_id,code:f.sent[0].code})).status,410);
 f.advance(60001);r=await f.admin('auth/request',{phone:'+79681411241'});f.advance(300001);assert.equal((await f.admin('auth/verify',{sms_session_id:r.data.sms_session_id,code:f.sent.at(-1).code})).status,410);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0);
 await f.login();f.advance(28800001);assert.equal((await f.admin('session')).status,401);
});
test('blocking revokes normal sessions and refresh, protects administrator, settings affect new registration',async t=>{
 const f=await fixture(t);await f.login();const u=await f.user(),a=await f.user('+79681411241');
 assert.equal((await f.admin('users/'+a.user.id+'/block',{blocked:true,reason:'test'})).status,403);
 assert.equal((await f.admin('users/'+a.user.id+'/anonymize',{confirm:String(a.user.id),reason:'test'})).status,403);
 assert.equal((await f.admin('users/'+u.user.id+'/block',{blocked:true})).status,400);
 assert.equal((await f.admin('users/'+u.user.id+'/block',{blocked:true,reason:'Спам'})).status,200);
 assert.equal((await f.call('/me',undefined,u.token)).status,401);assert.equal((await f.call('/auth/refresh',{refresh_token:u.refresh_token})).status,401);
 assert.equal((await f.call('/auth/sms/request',{phone:u.user.phone})).status,403);
 assert.equal((await f.admin('users/'+u.user.id+'/block',{blocked:false,reason:'Проверено'})).status,200);
 assert.equal((await f.admin('settings',{settings:{...defaultAdminSettings,registration_enabled:false},reason:'Закрываем регистрацию'})).status,200);
 assert.equal((await f.call('/auth/sms/request',{phone:'+79000000002'})).status,403);
 assert.equal((await f.admin('settings',{settings:{...defaultAdminSettings,upload_max_mb:1000},reason:'test'})).status,400);
 assert.equal((await f.admin('users/'+u.user.id+'/anonymize',{confirm:String(u.user.id),reason:'Удаление аккаунта'})).status,200);
 assert.equal(f.app.db.prepare('SELECT phone FROM users WHERE id=?').get(u.user.id).phone,'deleted:'+u.user.id);
 const audit=await f.admin('audit');assert.ok(audit.data.items.some(r=>r.action==='user.block'&&r.reason==='Спам'));
});
test('chat freeze/delete/restore and message moderation reach normal clients immediately',async t=>{
 const f=await fixture(t);await f.login();const a=await f.user(),b=await f.user('+79000000002');
 const chat=(await f.call('/chats',{user_id:b.user.id},a.token)).data;
 const message=(await f.call('/chats/'+chat.id+'/messages',{text:'Модерация',client_id:randomUUID()},a.token)).data;
 assert.equal((await f.admin('messages/'+message.id+'/pin',{pinned:true,reason:'Важно'})).status,200);
 assert.ok(f.app.db.prepare('SELECT 1 FROM pins WHERE message_id=?').get(message.id));
 assert.equal((await f.admin('chats/'+chat.id+'/lock',{locked:true,reason:'Проверка'})).status,200);
 assert.equal((await f.call('/chats/'+chat.id+'/messages',{text:'x',client_id:randomUUID()},a.token)).status,403);
 assert.equal(Boolean((await f.call('/chats',undefined,a.token)).data.find(c=>c.id===chat.id).can_send),false);
 assert.equal((await f.admin('messages/'+message.id+'/delete',{confirm:String(message.id),reason:'Нарушение'})).status,200);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM pins WHERE message_id=?').get(message.id).n,0);assert.equal(f.app.db.prepare('SELECT text FROM messages WHERE id=?').get(message.id).text,'');
 assert.equal((await f.admin('chats/'+chat.id+'/delete',{confirm:String(chat.id),reason:'Удалено'})).status,200);
 assert.ok(!(await f.call('/chats',undefined,a.token)).data.some(c=>c.id===chat.id));assert.equal((await f.call('/chats/'+chat.id+'/messages',undefined,a.token)).status,404);
 assert.equal((await f.admin('chats/'+chat.id+'/restore',{confirm:String(chat.id),reason:'Восстановлено'})).status,200);
 assert.equal((await f.call('/chats/'+chat.id+'/messages',undefined,a.token)).status,200);
});
test('admin list pages have safe SQL, full backup contains database/files and downloads require admin auth',async t=>{
 const f=await fixture(t);await f.login();const u=await f.user();
 const file='a'.repeat(48);writeFileSync(join(f.dir,'uploads',file),'test file');f.app.db.prepare('INSERT INTO attachments(id,owner_id,name,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(file,u.user.id,'test.txt','text/plain',9,Date.now());
 for(const path of ['stats','users','users/'+u.user.id,'chats','messages','files','packs','sms','devices','calls','settings','backups','audit','admin-sessions']){const r=await f.admin(path);assert.equal(r.status,200,path+' '+JSON.stringify(r.data));assert.ok(!JSON.stringify(r.data).includes('code_hash'));assert.ok(!JSON.stringify(r.data).includes('refresh_hash'));}
 assert.equal((await f.admin('users?q='+encodeURIComponent("' OR 1=1 --"))).data.total,0);
 assert.equal((await f.admin('files/'+file+'/block',{blocked:true,reason:'Опасный файл'})).status,200);
 assert.equal((await f.call('/files/'+file,undefined,u.token)).status,404);
 const backup=await f.admin('backups',{reason:'Перед обновлением'});assert.equal(backup.status,201,JSON.stringify(backup.data));
 const archive=join(f.dir,'admin-backups',backup.data.filename);const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'});assert.match(names,/volna.db/);assert.match(names,new RegExp('uploads/'+file));
 const url=f.base+'/admin/api/backups/'+backup.data.id+'/download';assert.equal((await fetch(url)).status,401);const download=await fetch(url,{headers:{Cookie:f.cookie()}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);await download.arrayBuffer();
 assert.equal((await f.admin('backups/'+backup.data.id+'/delete',{confirm:backup.data.id,reason:'Проверочная копия'})).status,200);
 const r=await fetch(f.base+'/');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await r.text(),/Панель|Администратор/);
});
test('community owners and membership, announcement, device revocation and maintenance operate without bypasses',async t=>{
 const f=await fixture(t);await f.login();const a=await f.user(),b=await f.user('+79000000002');
 const chat=Number(f.app.db.prepare("INSERT INTO chats(pair,kind,title,created_by) VALUES(?,'group','Группа',?)").run(randomUUID(),a.user.id).lastInsertRowid);f.app.db.prepare("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'owner')").run(chat,a.user.id);
 assert.equal((await f.admin('chats/'+chat+'/members',{operation:'add',user_id:b.user.id,role:'owner',reason:'Передача'})).status,200);
 assert.equal(f.app.db.prepare('SELECT role FROM members WHERE chat_id=? AND user_id=?').get(chat,a.user.id).role,'admin');assert.equal(f.app.db.prepare("SELECT COUNT(*) n FROM members WHERE chat_id=? AND role='owner'").get(chat).n,1);
 assert.equal((await f.admin('chats/'+chat+'/members',{operation:'remove',user_id:b.user.id,reason:'test'})).status,409);
 assert.equal((await f.admin('chats/'+chat+'/lock',{locked:true,reason:'Заморозка группы'})).status,200);
 const topic=(await f.call('/groups/'+chat+'/topics',{name:'Новая подтема',client_id:randomUUID()},b.token)).data;
 assert.ok(topic.id);assert.equal((await f.call('/chats/'+topic.id+'/messages',{text:'Обход',client_id:randomUUID()},b.token)).status,403);
 assert.equal(Boolean((await f.call('/chats',undefined,b.token)).data.find(c=>c.id===topic.id).can_send),false);
 const announcement=await f.admin('announcement',{text:'Новости',confirm:'SEND',reason:'Обновление'});assert.equal(announcement.status,200,JSON.stringify(announcement.data));assert.equal(announcement.data.recipients,2);
 assert.ok((await f.call('/chats',undefined,a.token)).data.some(c=>c.id===announcement.data.chat_id));
 const devices=(await f.admin('devices')).data.items;const device=devices.find(d=>d.user_id===b.user.id);assert.equal((await f.admin('devices/'+device.id+'/revoke',{reason:'Потерян телефон'})).status,200);assert.equal((await f.call('/me',undefined,b.token)).status,401);
 assert.equal((await f.admin('settings',{settings:{...defaultAdminSettings,maintenance:true},reason:'Обновление'})).status,200);
 assert.equal((await f.call('/chats/'+chat+'/messages',{text:'test',client_id:randomUUID()},a.token)).status,503);
 assert.equal((await f.admin('stats')).status,200);assert.equal((await f.call('/logout',{},a.token)).status,200);
});

test('failed admin SMS provider returns a safe error and no challenge can authenticate',async t=>{
 const f=await fixture(t,{sender:async()=>{throw Error('private provider key/phone/code');}});
 const r=await f.admin('auth/request',{phone:'+79681411241'});assert.equal(r.status,503);assert.ok(!JSON.stringify(r.data).includes('private'));
 assert.equal(f.app.db.prepare('SELECT status FROM admin_sms').get().status,'failed');assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0);
});
test('administrative chat creation, file blocking and terminating calls enforce server state',async t=>{
 const f=await fixture(t);await f.login();const a=await f.user(),b=await f.user('+79000000002');
 const group=await f.admin('chats',{kind:'group',title:'Новая группа',owner_id:a.user.id,reason:'Создание'});assert.equal(group.status,201);
 assert.equal(f.app.db.prepare('SELECT role FROM members WHERE chat_id=? AND user_id=?').get(group.data.id,a.user.id).role,'owner');
 assert.equal((await f.admin('chats',{kind:'direct',title:'Неверно',owner_id:a.user.id,reason:'test'})).status,400);
 const chat=(await f.call('/chats',{user_id:b.user.id},a.token)).data;
 const call=await f.call('/calls/start',{chat_id:chat.id,device:'1'.repeat(32)},a.token);assert.equal(call.status,201);
 assert.equal((await f.admin('calls')).data.active.length,1);assert.equal((await f.admin('calls/'+call.data.id+'/end',{reason:'Проверка'})).status,200);assert.equal((await f.admin('calls')).data.active.length,0);
 const file='b'.repeat(48);writeFileSync(join(f.dir,'uploads',file),'test');f.app.db.prepare('INSERT INTO attachments(id,owner_id,name,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(file,a.user.id,'test.txt','text/plain',4,Date.now());
 assert.equal((await f.admin('files/'+file+'/block',{blocked:true,reason:'Блокировка'})).status,200);
 assert.equal((await f.call('/chats/'+chat.id+'/messages',{text:'',attachment_id:file,client_id:randomUUID()},a.token)).status,404);
 assert.equal((await f.admin('files/'+file+'/block',{blocked:false,reason:'Восстановление'})).status,200);
 assert.equal((await f.call('/chats/'+chat.id+'/messages',{text:'',attachment_id:file,client_id:randomUUID()},a.token)).status,201);
});

test('changing administrator phone revokes old administrative credentials while same-phone restart preserves sessions',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-admin-restart-'));let app;
 t.after(async()=>{if(app)await app.close();rmSync(dir,{recursive:true,force:true});});
 const create=phone=>createApp({database:join(dir,'volna.db'),adminOptions:{adminPhone:phone}});
 app=create('+79681411241');app.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?,?,?)').run('a'.repeat(32),'b'.repeat(64),Date.now(),Date.now()+100000,Date.now(),'test','local');await app.close();app=null;
 app=create('+79681411241');assert.equal(app.db.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,1);await app.close();app=null;
 app=create('+79000000002');assert.equal(app.db.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0);assert.equal(app.db.prepare("SELECT value FROM admin_meta WHERE key='admin-phone'").get().value,'+79000000002');
});
