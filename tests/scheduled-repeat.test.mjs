import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scheduledMessages} from '../server/scheduled-messages.mjs';
import {repeatAt,nextRepeat} from '../shared/scheduled-time.mjs';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
test('calendar recurrence retains local time across DST, anchor day and leap years',()=>{
 const iso=(kind,anchor,index,zone='UTC')=>new Date(repeatAt(kind,Date.parse(anchor),index,zone)).toISOString();
 assert.equal(iso('monthly','2026-01-31T10:15:00Z',1),'2026-02-28T10:15:00.000Z');assert.equal(iso('monthly','2026-01-31T10:15:00Z',2),'2026-03-31T10:15:00.000Z');
 assert.equal(iso('yearly','2024-02-29T10:15:00Z',1),'2025-02-28T10:15:00.000Z');assert.equal(iso('yearly','2024-02-29T10:15:00Z',4),'2028-02-29T10:15:00.000Z');
 assert.equal(iso('daily','2026-03-28T08:00:00Z',1,'Europe/Berlin'),'2026-03-29T07:00:00.000Z');assert.equal(iso('daily','2026-10-24T07:00:00Z',1,'Europe/Berlin'),'2026-10-25T08:00:00.000Z');
 assert.equal(iso('weekly','2026-01-01T12:00:00Z',1),'2026-01-08T12:00:00.000Z');assert.equal(iso('fortnightly','2026-01-01T12:00:00Z',1),'2026-01-15T12:00:00.000Z');assert.equal(iso('quarterly','2026-01-31T12:00:00Z',1),'2026-04-30T12:00:00.000Z');assert.equal(iso('semiannual','2026-08-31T12:00:00Z',1),'2027-02-28T12:00:00.000Z');
 const next=nextRepeat({kind:'daily',time_zone:'UTC'},Date.parse('2020-01-01T10:00:00Z'),0,Date.parse('2026-01-01T12:00:00Z'));assert.equal(new Date(next.due).toISOString(),'2026-01-02T10:00:00.000Z');
});
test('recurring queue survives restart, skips missed slots and can be edited or cancelled without duplicate delivery',()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-repeat-')),file=join(dir,'db');let db,queue,now=Date.parse('2026-01-31T10:00:00Z'),delivered=[];
 const open=()=>{db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,admin_blocked INTEGER DEFAULT 0);INSERT OR IGNORE INTO users(id) VALUES(1),(2);CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY,kind TEXT);INSERT OR IGNORE INTO chats VALUES(1,\'direct\');CREATE TABLE IF NOT EXISTS members(chat_id INTEGER,user_id INTEGER);CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,owner_id INTEGER,admin_blocked INTEGER,name TEXT,mime TEXT,size INTEGER);CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,attachment_id TEXT);');queue=scheduledMessages({db,clock:()=>now,member:(chat,uid)=>{if(chat!==1||uid!==1)throw Object.assign(Error('Denied'),{status:404});},canPublish:()=>{},publish:()=>{},send:(_chat,_uid,payload)=>{delivered.push(payload);return []}});};
 try{open();const data={client_id:'recurring-job-000001',text:'Повтор',schedule_at:now+60000,repeat:'monthly',time_zone:'UTC'},job=queue.create(1,1,data);now+=60000;queue.tick();assert.equal(delivered.length,1);let row=queue.list(1,1)[0];assert.equal(new Date(row.due).toISOString(),'2026-02-28T10:01:00.000Z');assert.equal(row.occurrence,1);assert.equal(queue.create(1,1,data).id,job.id);
 queue.close();db.close();open();now=Date.parse('2026-05-01T12:00:00Z');queue.tick();assert.equal(delivered.length,2);row=queue.list(1,1)[0];assert.equal(new Date(row.due).toISOString(),'2026-05-31T10:01:00.000Z');assert.notEqual(delivered[0].client_id,delivered[1].client_id);queue.tick();assert.equal(delivered.length,2);
 assert.throws(()=>queue.update(2,job.id,{text:'Подмена',schedule_at:now+60000}),e=>e.status===404);
 assert.throws(()=>queue.update(1,job.id,{text:'Подмена',schedule_at:now+60000,repeat:'invalid'}),e=>e.status===400);assert.equal(queue.list(1,1)[0].payload.text,'Повтор');
 queue.update(1,job.id,{text:'Новый текст',schedule_at:now+60000,repeat:'weekly',time_zone:'UTC'});now+=60000;queue.tick();assert.equal(delivered.length,3);assert.equal(delivered[2].text,'Новый текст');assert.equal(queue.list(1,1)[0].repeat_rule.kind,'weekly');queue.cancel(1,job.id);now+=366*86400000;queue.tick();assert.equal(delivered.length,3);assert.equal(queue.list(1,1).length,0);
 for(const data of [{repeat:'hourly'},{repeat:'daily',time_zone:'invalid/zone'},{when_online:true,repeat:'daily',time_zone:'UTC'}])assert.throws(()=>queue.create(1,1,{client_id:crypto.randomUUID(),text:'x',schedule_at:now+60000,...data}),e=>e.status===400);
 }finally{queue?.close();db?.close();rmSync(dir,{recursive:true,force:true});}
});
test('repeat attachments remain reserved, can send again and reschedule as a final one-shot',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-repeat-api-')),app=createApp({database:':memory:',uploads:dir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const req=async(path,data,token,method)=>{const r=await fixtureFetch(base+path,{method:method||(data===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const a=(await req('/register',{username:'repeat_owner'})).data,b=(await req('/register',{username:'repeat_member'})).data,chat=(await req('/chats',{user_id:b.user.id},a.token)).data.id;
 const file=await (await fetch(base+'/uploads',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'image/png','X-File-Name':'repeat.png'},body:Buffer.from('image bytes')})).json();
 const job=(await req(`/chats/${chat}/scheduled`,{text:'Картинка',attachment_id:file.id,client_id:crypto.randomUUID(),schedule_at:Date.now()+60000,repeat:'daily',time_zone:'Europe/Moscow',silent:true,effect:'🔥'},a.token)).data;
 assert.equal((await req(`/chats/${chat}/messages`,{text:'Уже в очереди',attachment_id:file.id,client_id:crypto.randomUUID()},a.token)).status,403);
 for(let i=0;i<2;i++)assert.equal((await req(`/scheduled/${job.id}/send`,{},a.token)).status,200);
 let messages=(await req(`/chats/${chat}/messages`,undefined,a.token)).data;assert.equal(messages.length,2);assert.notEqual(messages[0].client_id,messages[1].client_id);assert.equal(messages[0].attachment.id,file.id);assert.equal(messages[1].attachment.id,file.id);assert.equal(messages[1].silent,1);assert.equal(messages[1].effect,'🔥');
 assert.equal((await req(`/uploads/${file.id}/discard`,{},a.token)).status,409);assert.equal((await req(`/scheduled/${job.id}`,{text:'Чужое',schedule_at:Date.now()+60000},b.token,'PATCH')).status,404);
 assert.equal((await req(`/scheduled/${job.id}`,{text:'Последняя',schedule_at:Date.now()+60000,repeat:'never'},a.token,'PATCH')).status,200);assert.equal((await req(`/scheduled/${job.id}/send`,{},a.token)).status,200);messages=(await req(`/chats/${chat}/messages`,undefined,a.token)).data;assert.equal(messages.length,3);assert.equal(messages[2].text,'Последняя');assert.equal((await req(`/chats/${chat}/scheduled`,undefined,a.token)).data.length,0);
});
test('migration preserves a pending one-shot from the previous version',()=>{
 const db=new DatabaseSync(':memory:');let q,delivered=0;
 try{db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY,admin_blocked INTEGER);INSERT INTO users VALUES(1,0);CREATE TABLE attachments(id TEXT PRIMARY KEY,owner_id INTEGER,admin_blocked INTEGER,name TEXT,mime TEXT,size INTEGER);CREATE TABLE messages(id INTEGER PRIMARY KEY,attachment_id TEXT);CREATE TABLE scheduled_messages(id INTEGER PRIMARY KEY,sender INTEGER NOT NULL,chat_id INTEGER NOT NULL,payload TEXT NOT NULL,due INTEGER NOT NULL,when_online INTEGER NOT NULL DEFAULT 0,peer INTEGER,status TEXT NOT NULL DEFAULT 'pending',error TEXT,created INTEGER NOT NULL,client_id TEXT NOT NULL,UNIQUE(sender,client_id));");const due=Date.now()+60000,id='legacy-scheduled-000001';db.prepare('INSERT INTO scheduled_messages(sender,chat_id,payload,due,created,client_id) VALUES(?,?,?,?,?,?)').run(1,1,JSON.stringify({text:'Старая очередь',client_id:id}),due,Date.now(),id);
 q=scheduledMessages({db,member:()=>{},canPublish:()=>{},publish:()=>{},send:()=>{delivered++;return [];}});assert.equal(q.list(1,1)[0].repeat_rule,null);assert.equal(q.list(1,1)[0].due,due);q.sendNow(1,1);assert.equal(delivered,1);q.tick();assert.equal(delivered,1);assert.equal(q.list(1,1).length,0);
 }finally{q?.close();db.close();}
});
