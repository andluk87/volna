import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {createRequire} from 'node:module';
import {createPresence} from '../server/presence.mjs';
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'volna98-'));let app,base;
 const start=async()=>{app=createApp({database:join(dir,'db'),uploads:join(dir,'uploads')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}/api`;};await start();t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const call=async(path,token,data,method)=>{const res=await fixtureFetch(base+path,{method:method||(data===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:res.status,data:await res.json()};};
 const users=[];for(const username of ['owner98','member98','outsider98'])users.push((await call('/register','',{username})).data);
 const [a,b,c]=users,chat=(await call('/chats',a.token,{user_id:b.user.id})).data.id;
 const upload=async mime=>{const r=await fixtureFetch(base+'/uploads',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':mime,'X-File-Name':'sample.'+(mime==='image/png'?'png':'webm')},body:Buffer.from('test bytes')});assert.equal(r.status,201);return r.json();};
 return {get app(){return app},call,a,b,c,chat,upload,restart:async()=>{await app.close();await start();},send:(id,text,extra={})=>call(`/chats/${id}/messages`,a.token,{text,client_id:randomUUID(),...extra})};
}
test('scheduled messages survive restart, send once with silent/effect and enforce owner and retained files',async t=>{
 const f=await fixture(t),{a,b,chat,call}=f,file=await f.upload('image/png');
 const payload={text:'На потом',attachment_id:file.id,client_id:randomUUID(),schedule_at:Date.now()+60000,silent:true,effect:'🎉'};
 const queued=await call(`/chats/${chat}/scheduled`,a.token,payload);assert.equal(queued.status,201,JSON.stringify(queued));const id=queued.data.id;
 assert.equal((await call(`/chats/${chat}/scheduled`,a.token,payload)).data.id,id);
 assert.equal((await call(`/uploads/${file.id}/discard`,a.token,{})).status,409);
 assert.equal((await call(`/chats/${chat}/scheduled`,b.token)).data.length,0);
 assert.equal((await call(`/scheduled/${id}/send`,b.token,{})).status,404);
 await f.restart();assert.equal((await call(`/chats/${chat}/scheduled`,a.token)).data.length,1);
 assert.equal((await call(`/scheduled/${id}/send`,a.token,{})).status,200);
 const rows=(await call(`/chats/${chat}/messages`,b.token)).data;assert.equal(rows.length,1);assert.equal(rows[0].text,payload.text);assert.equal(rows[0].silent,1);assert.equal(rows[0].effect,'🎉');
 assert.equal((await call(`/scheduled/${id}/send`,a.token,{})).status,409);assert.equal((await call(`/chats/${chat}/messages`,a.token)).data.length,1);
 assert.equal((await call(`/chats/${chat}/scheduled`,a.token,{text:'x',client_id:randomUUID(),schedule_at:Date.now()+60000,attachment_ids:[]})).status,400);
 const cancel=(await call(`/chats/${chat}/scheduled`,a.token,{text:'Отмена',client_id:randomUUID(),schedule_at:Date.now()+60000})).data;
 assert.equal((await call(`/scheduled/${cancel.id}`,a.token,undefined,'DELETE')).status,200);assert.equal((await call(`/chats/${chat}/scheduled`,a.token)).data.length,0);
});
test('when-online waits for visible presence and respects privacy and lost group posting permissions',async t=>{
 const f=await fixture(t),{call,a,b,chat}=f;
 assert.equal((await call(`/chats/${chat}/scheduled`,a.token,{text:'При активности',client_id:randomUUID(),when_online:true})).status,201);
 await new Promise(r=>setTimeout(r,1100));assert.equal((await call(`/chats/${chat}/messages`,a.token)).data.length,0);
 await call('/presence',b.token,{client:'foreground_android_98',visible:true,sequence:1});
 for(let n=0;n<20;n++){if((await call(`/chats/${chat}/messages`,a.token)).data.length)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal((await call(`/chats/${chat}/messages`,a.token)).data.length,1);
 await call('/contacts/settings',b.token,{presence:'nobody'});assert.equal((await call(`/chats/${chat}/scheduled`,a.token,{text:'Скрытый',client_id:randomUUID(),when_online:true})).status,403);
 const group=(await call('/communities',a.token,{kind:'group',title:'Очередь',client_id:randomUUID()})).data.id;await call(`/communities/${group}/add`,a.token,{user_id:b.user.id});
 const job=(await call(`/chats/${group}/scheduled`,b.token,{text:'Запрещённое',client_id:randomUUID(),schedule_at:Date.now()+60000})).data;
 await call(`/communities/${group}/settings`,a.token,{posting_policy:'admins'});
 assert.equal((await call(`/scheduled/${job.id}/send`,b.token,{})).status,403);assert.equal((await call(`/chats/${group}/messages`,a.token)).data.length,0);
});
test('group settings save atomically, welcome is single, reactions inherited and audit private',async t=>{
 const f=await fixture(t),{call,a,b,c}=f,group=(await call('/communities',a.token,{kind:'group',title:'Группа',client_id:randomUUID()})).data.id;
 const settings={welcome_message:'Добро пожаловать, {name}!',allowed_reactions:['👍'],topic_settings:{enabled:true,layout:'list',create_policy:'admins',manage_policy:'admins'}};
 assert.equal((await call(`/communities/${group}/settings`,a.token,settings)).status,200);
 assert.equal((await call(`/groups/${group}/topics`,a.token)).data.layout,'list');
 assert.equal((await call(`/communities/${group}/settings`,a.token,{welcome_message:'Изменение',topic_settings:{layout:'broken'}})).status,400);
 assert.equal((await call(`/communities/${group}`,a.token)).data.welcome_message,settings.welcome_message);
 await call(`/communities/${group}/add`,a.token,{user_id:b.user.id});await call(`/communities/${group}/add`,a.token,{user_id:b.user.id});
 const welcome=(await call(`/chats/${group}/messages`,b.token)).data;assert.equal(welcome.length,1);assert.equal(welcome[0].sender_name,'Волна');assert.match(welcome[0].text,/member98/);
 assert.equal(f.app.db.prepare('SELECT admin_blocked FROM users WHERE id=?').get(welcome[0].sender_id).admin_blocked,1);
 assert.equal((await call(`/communities/${group}/settings`,b.token,{allowed_reactions:[]})).status,403);
 const topic=(await call(`/groups/${group}/topics`,a.token,{name:'Тема',client_id:randomUUID()})).data;
 const m=(await f.send(topic.id,'Проверка реакций')).data;
 assert.equal((await call(`/messages/${m.id}/react`,b.token,{emoji:'❤️',active:true})).status,403);
 assert.equal((await call(`/messages/${m.id}/react`,b.token,{emoji:'👍',active:true})).status,200);
 await call(`/communities/${group}/settings`,a.token,{allowed_reactions:[]});assert.equal((await call(`/messages/${m.id}/react`,b.token,{emoji:'👍',active:false})).status,200);
 assert.equal((await call(`/communities/${group}/audit`,b.token)).status,403);assert.equal((await call(`/communities/${group}/audit`,c.token)).status,404);
 const audit=(await call(`/communities/${group}/audit`,a.token)).data;assert.ok(audit.some(x=>x.action==='settings'));assert.ok(audit.some(x=>x.action==='add'));
 await call(`/groups/${group}/topics/settings`,a.token,{enabled:false});assert.equal((await call(`/chats/${topic.id}/messages`,b.token)).data.length,1);
});
test('calendar reaches unloaded history, nearest day, time zone and personal cutoff; albums are scoped',async t=>{
 const f=await fixture(t),{a,b,c,chat,call}=f;
 let first;for(let i=0;i<65;i++){const m=(await f.send(chat,'Строка '+i)).data;if(i===0)first=m;f.app.db.prepare('UPDATE messages SET created_at=? WHERE id=?').run(i<3?'2026-07-02T21:30:00.000Z':'2026-11-01T08:00:00.000Z',m.id);}
 assert.equal((await call(`/chats/${chat}/messages`,a.token)).data.length,50);
 const result=await call(`/chats/${chat}/calendar?date=2026-07-03&tz=-180`,a.token);assert.equal(result.status,200);assert.equal(result.data.anchor_id,first.id);
 const month=(await call(`/chats/${chat}/calendar?month=2026-07&tz=-180`,a.token)).data;assert.deepEqual(month.days,[{date:'2026-07-03',count:3}]);
 assert.equal((await call(`/chats/${chat}/calendar?date=2026-06-01`,a.token)).data.anchor_id,first.id);
 assert.equal((await call(`/chats/${chat}/calendar?date=2026-02-30`,a.token)).status,400);
 assert.equal((await call(`/chats/${chat}/calendar?month=2026-07`,c.token)).status,404);
 await call(`/chats/${chat}/clear-history`,b.token,{});assert.equal((await call(`/chats/${chat}/calendar?date=2026-07-03`,b.token)).data.anchor_id,null);
 const files=await Promise.all([f.upload('image/png'),f.upload('image/png'),f.upload('image/png')]);
 const album=(await call(`/chats/${chat}/album`,a.token,{attachment_ids:files.slice(0,2).map(x=>x.id),text:'Альбом',client_id:randomUUID()})).data;await f.send(chat,'Отдельное',{attachment_id:files[2].id});
 assert.deepEqual((await call(`/chats/${chat}/media?album_id=${encodeURIComponent(album[0].album_id)}`,a.token)).data.map(x=>x.id),album.map(x=>x.id));
});
test('foreground leases expire and stale events cannot revive a hidden window',()=>{
 let now=1000,seen=0;const p=createPresence({clock:()=>now,ttl:25000,db:{prepare:()=>({run:value=>{seen=value;}})}});
 try{p.update(1,'session',{client:'foreground_window_98',visible:true,sequence:1});assert.equal(p.online(1),true);now+=26000;p.sweep();assert.equal(p.online(1),false);assert.equal(seen,1000);
 p.update(1,'session',{client:'foreground_window_98',visible:false,sequence:3});const hiddenSeen=seen;now+=10000;p.update(1,'session',{client:'foreground_window_98',visible:false,sequence:4});assert.equal(seen,hiddenSeen);p.update(1,'session',{client:'foreground_window_98',visible:true,sequence:2});assert.equal(p.online(1),false);
 p.update(1,'session',{client:'foreground_window_98',visible:true,sequence:5});p.removeSession('session');assert.equal(p.online(1),false);}finally{p.close();}
});

test('Windows media fullscreen restores the previous mode and tolerates repeated close',()=>{
 const {mediaFullscreen}=createRequire(import.meta.url)('../client/electron/media-fullscreen.cjs');
 for(const original of [false,true]){let mode=original;const changes=[];const win={isDestroyed:()=>false,isFullScreen:()=>mode,setFullScreen:v=>{mode=v;changes.push(v);}};
 mediaFullscreen(win,true);mediaFullscreen(win,true);assert.equal(mode,true);mediaFullscreen(win,false);mediaFullscreen(win,false);assert.equal(mode,original);assert.deepEqual(changes,[true,original]);assert.throws(()=>mediaFullscreen(win,'true'));}
 assert.equal(mediaFullscreen({isDestroyed:()=>true},true),false);
});
test('offline when-online jobs cannot starve timed delivery',async t=>{
 const f=await fixture(t),{call,a,b,chat}=f;
 const data={text:'Ждать',client_id:randomUUID(),when_online:true};assert.equal((await call(`/chats/${chat}/scheduled`,b.token,data)).status,201);
 const insert=f.app.db.prepare('INSERT INTO scheduled_messages(sender,chat_id,payload,due,when_online,peer,created,client_id) VALUES(?,?,?,?,?,?,?,?)');
 for(let i=0;i<99;i++){const id=randomUUID();insert.run(b.user.id,chat,JSON.stringify({text:'Ждать '+i,client_id:id}),0,1,a.user.id,Date.now(),id);}
 const timed=(await call(`/chats/${chat}/scheduled`,a.token,{text:'По времени',client_id:randomUUID(),schedule_at:Date.now()+60000})).data;
 assert.equal((await call(`/scheduled/${timed.id}/send`,a.token,{})).status,200);const messages=(await call(`/chats/${chat}/messages`,a.token)).data;assert.equal(messages.length,1);assert.equal(messages[0].text,'По времени');
});
