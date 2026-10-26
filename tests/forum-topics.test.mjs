import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {topicNotification} from '../server/topics.mjs';
async function fixture(t,options={}){
 let app=createApp({database:':memory:',...options}),base;
 async function start(){await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}/api`;}
 await start();t.after(()=>app.close());
 const call=async(path,token,data,method)=>{const response=await fixtureFetch(base+path,{method:method||(data===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,data:await response.json()};};
 const register=async nick=>(await call('/register','',{username:nick,name:nick})).data;
 const owner=await register('forum_owner'),member=await register('forum_member'),outsider=await register('forum_outsider');
 const group=(await call('/communities',owner.token,{kind:'group',title:'Форум',client_id:randomUUID()})).data.id;
 await call(`/communities/${group}/add`,owner.token,{user_id:member.user.id});
 const topic=async(name='Разработка')=>(await call(`/groups/${group}/topics`,owner.token,{name,icon:'💻',client_id:randomUUID()})).data;
 const send=async(chat,session,text,extra={})=>(await call(`/chats/${chat}/messages`,session.token,{text,client_id:randomUUID(),...extra}));
 return {get app(){return app},call,owner,member,outsider,group,topic,send,restart:async()=>{await app.close();app=createApp(options);await start();}};
}
test('General preserves old messages, can be renamed/hidden but never deleted; mode changes preserve histories',async t=>{
 const f=await fixture(t),{call,owner,group}=f;const old=await f.send(group,owner,'Старая история');assert.equal((await call(`/groups/${group}/topics`,owner.token)).data.enabled,false);
 const created=await f.topic();let info=(await call(`/groups/${group}/topics`,owner.token)).data;assert.equal(info.enabled,true);assert.equal(info.general.id,group);assert.equal(info.general.general,true);assert.equal(info.general.last_text,'Старая история');
 assert.equal((await call(`/groups/${group}/topics/${group}`,owner.token,{name:'Общение',hidden:true},'PATCH')).status,200);
 info=(await call(`/groups/${group}/topics`,owner.token)).data;assert.equal(info.general.name,'Общение');assert.equal(info.general.hidden,true);assert.equal((await call(`/groups/${group}/topics/${group}`,owner.token,undefined,'DELETE')).status,400);
 assert.equal((await call(`/chats/${group}/messages`,owner.token)).data[0].id,old.data.id);
 assert.equal((await call(`/groups/${group}/topics/${created.id}`,owner.token,{hidden:true},'PATCH')).status,400);
 await call(`/groups/${group}/topics/settings`,owner.token,{enabled:false});assert.equal((await call(`/groups/${group}/topics`,owner.token)).data.enabled,false);assert.equal((await call(`/groups/${group}/topics`,owner.token)).data.topics.length,1);
});
test('pinned topics are global, reorder restricted to admins, and rejects foreign/duplicate/missing IDs atomically',async t=>{
 const f=await fixture(t),a=await f.topic('Первая'),b=await f.topic('Вторая'),{call,owner,member,group}=f;
 for(const id of [a.id,b.id,group])assert.equal((await call(`/groups/${group}/topics/${id}`,owner.token,{pinned:true},'PATCH')).status,200);
 assert.equal((await call(`/groups/${group}/topics/${a.id}`,member.token,{pinned:false},'PATCH')).status,403);
 assert.equal((await call(`/groups/${group}/topics/reorder`,member.token,{ids:[b.id,a.id,group]})).status,403);
 assert.equal((await call(`/groups/${group}/topics/reorder`,owner.token,{ids:[b.id,a.id,group]})).status,200);
 for(const ids of [[a.id],[a.id,a.id,group],[a.id,b.id,99999999]])assert.equal((await call(`/groups/${group}/topics/reorder`,owner.token,{ids})).status,400);
 const info=(await call(`/groups/${group}/topics`,member.token)).data;assert.deepEqual(info.topics.map(t=>t.id),[b.id,a.id]);assert.equal(info.general.pin_order,2);
});
test('closed topics permit admins to publish while ordinary members retain read-only access; all pipelines enforce it',async t=>{
 const f=await fixture(t),topic=await f.topic(),{call,owner,member,group}=f;await call(`/groups/${group}/topics/${topic.id}`,owner.token,{closed:true},'PATCH');
 assert.equal((await f.send(topic.id,member,'Нет')).status,403);assert.equal((await f.send(topic.id,owner,'Объявление')).status,201);
 const ownChats=(await call('/chats',owner.token)).data,memberChats=(await call('/chats',member.token)).data;assert.equal(ownChats.find(c=>c.id===topic.id).can_send,1);assert.equal(memberChats.find(c=>c.id===topic.id).can_send,0);
 assert.equal((await call(`/groups/${group}/topics/${topic.id}`,owner.token)).data.can_send,true);assert.equal((await call(`/groups/${group}/topics/${topic.id}`,member.token)).data.can_send,false);
 assert.equal((await call(`/groups/${group}/topics/${topic.id}/messages`,member.token)).status,200);
 assert.equal((await call(`/groups/${topic.id}/topics`,owner.token,{name:'Вложенная',client_id:randomUUID()})).status,400);
});
test('combined feed is chronological, searchable, paginated and respects membership, removed topics and personal history cutoffs',async t=>{
 const f=await fixture(t),a=await f.topic('Разработка'),b=await f.topic('Новости'),{call,owner,member,outsider,group}=f;
 const first=(await f.send(group,owner,'Общий')).data,second=(await f.send(a.id,owner,'Поиск иглы')).data,third=(await f.send(b.id,member,'Третье')).data;
 let feed=await call(`/chats/${group}/messages?forum=1`,member.token);assert.deepEqual(feed.data.map(m=>m.id),[first.id,second.id,third.id]);assert.equal(feed.data[1].topic_name,'Разработка');assert.equal(feed.data[0].topic_name,'Общие вопросы');
 assert.equal((await call(`/chats/${group}/messages?forum=1`,outsider.token)).status,404);assert.equal((await call(`/chats/${a.id}/messages?forum=1`,owner.token)).status,400);
 assert.deepEqual((await call(`/chats/${group}/messages?forum=1&q=иглы`,member.token)).data.map(m=>m.id),[second.id]);assert.deepEqual((await call(`/chats/${group}/messages?forum=1&before=${third.id}`,member.token)).data.map(m=>m.id),[first.id,second.id]);
 await call(`/chats/${a.id}/clear-history`,member.token,{});assert.deepEqual((await call(`/chats/${group}/messages?forum=1`,member.token)).data.map(m=>m.id),[first.id,third.id]);assert.equal((await call(`/chats/${a.id}/messages`,owner.token)).data.length,1);
 await call(`/groups/${group}/topics/${b.id}`,owner.token,undefined,'DELETE');assert.deepEqual((await call(`/chats/${group}/messages?forum=1`,owner.token)).data.map(m=>m.id),[first.id,second.id]);
});
test('notification inheritance, explicit override, reset and mentions/replies do not change membership',async t=>{
 const f=await fixture(t),topic=await f.topic(),{app,call,owner,member,group}=f;const uid=member.user.id;
 await call(`/chats/${group}/preferences`,member.token,{muted:true});assert.equal(topicNotification(app.db,topic.id,uid,'Привет'),false);
 await call(`/groups/${group}/topics/${topic.id}/notifications`,member.token,{mode:'all'});assert.equal(topicNotification(app.db,topic.id,uid,'Привет'),true);
 await call(`/groups/${group}/topics/${topic.id}/notifications`,member.token,{mode:'inherit'});assert.equal(topicNotification(app.db,topic.id,uid,'Привет'),false);
 await call(`/groups/${group}/topics/${topic.id}/notifications`,member.token,{mode:'mentions'});
 const own=(await f.send(topic.id,member,'Мой вопрос')).data;assert.equal(topicNotification(app.db,topic.id,uid,'Ответ',own.id),true);assert.equal(topicNotification(app.db,topic.id,uid,'Не ответ'),false);assert.equal(topicNotification(app.db,topic.id,uid,'@forum_member'),true);
 await call(`/groups/${group}/topics/${topic.id}/notifications`,member.token,{mode:'none'});assert.equal(topicNotification(app.db,topic.id,uid,'@forum_member',own.id),false);assert.equal((await call(`/chats/${topic.id}/messages`,member.token)).status,200);
});
test('disabling forum mode and pinned order survive repeated startup migrations',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-forum-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=await fixture(t,{database:join(dir,'db.sqlite')}),topic=await f.topic();
 await f.call(`/groups/${f.group}/topics/${topic.id}`,f.owner.token,{pinned:true},'PATCH');await f.call(`/groups/${f.group}/topics/settings`,f.owner.token,{enabled:false});
 await f.restart();const info=(await f.call(`/groups/${f.group}/topics`,f.owner.token)).data;assert.equal(info.enabled,false);assert.equal(info.topics[0].pinned,true);
});
test('topic files, polls, replies, reactions and pins remain scoped while the combined feed hydrates them',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-forum-files-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=await fixture(t,{uploads:dir}),a=await f.topic(),b=await f.topic('Вторая'),{call,owner,member,group}=f;
 const poll=(await f.send(a.id,owner,'',{poll:{question:'Выбираем?',options:[{text:'Да'},{text:'Нет'}]}})).data;
 assert.equal((await call(`/messages/${poll.id}/vote`,member.token,{option:0})).status,200);
 const response=await fetch(`http://127.0.0.1:${f.app.server.address().port}/api/uploads`,{method:'POST',headers:{Authorization:'Bearer '+owner.token,'Content-Type':'text/plain','X-File-Name':'report.txt'},body:'topic report'});assert.equal(response.status,201);const file=await response.json();
 const message=(await f.send(a.id,owner,'Отчёт',{attachment_id:file.id,reply_to:poll.id})).data;
 assert.equal((await call(`/messages/${message.id}/pin`,owner.token,{pinned:true})).status,200);assert.equal((await call(`/messages/${message.id}/react`,member.token,{emoji:'👍',active:true})).status,200);
 assert.equal((await call(`/chats/${a.id}/media`,member.token)).data[0].attachment.id,file.id);assert.equal((await call(`/chats/${b.id}/media`,member.token)).data.length,0);assert.equal((await call(`/chats/${a.id}/pins`,member.token)).data[0].id,message.id);assert.equal((await call(`/chats/${group}/pins`,member.token)).data.length,0);
 const feed=(await call(`/chats/${group}/messages?forum=1`,member.token)).data;assert.deepEqual(feed[0].poll.options[0].voters,[member.user.id]);assert.equal(feed[1].attachment.id,file.id);assert.equal(feed[1].reply.id,poll.id);assert.equal(feed[1].reactions[0].emoji,'👍');assert.equal(feed[1].message_thread_id,a.id);
});
test('Android topic contract: 64 code points, metadata, five pins and owner-controlled management policy',async t=>{
 const f=await fixture(t),{call,owner,member,group}=f;
 for(const name of ['', '   ', 'я'.repeat(65)])assert.equal((await call(`/groups/${group}/topics`,owner.token,{name,client_id:randomUUID()})).status,400);
 const emojiName='😀'.repeat(64);assert.equal((await f.topic(emojiName)).name,emojiName);
 const a=await f.topic('Одинаковая'),b=await f.topic('Одинаковая');assert.notEqual(a.id,b.id);
 const message=await f.send(a.id,member,'Последнее сообщение');let info=(await call(`/groups/${group}/topics`,owner.token)).data;
 assert.equal(info.member_count,2);assert.equal(info.topics[0].id,a.id);assert.equal(info.topics[0].last_id,message.data.id);assert.equal(info.topics[0].last_sender,'forum_member');
 const more=[await f.topic('3'),await f.topic('4'),await f.topic('5'),await f.topic('6')];const pins=[a,b,...more];
 for(const topic of pins.slice(0,5))assert.equal((await call(`/groups/${group}/topics/${topic.id}`,owner.token,{pinned:true},'PATCH')).status,200);
 assert.equal((await call(`/groups/${group}/topics/${pins[5].id}`,owner.token,{pinned:true},'PATCH')).status,409);
 await call(`/communities/${group}/role`,owner.token,{user_id:member.user.id,role:'admin'});
 assert.equal((await call(`/groups/${group}/topics/settings`,member.token,{enabled:false})).status,403);
 assert.equal((await call(`/groups/${group}/topics/settings`,owner.token,{manage_policy:'owner'})).status,200);
 for(const body of [{name:'Нельзя'}, {pinned:false}, {closed:true}])assert.equal((await call(`/groups/${group}/topics/${a.id}`,member.token,body,'PATCH')).status,403);
 assert.equal((await call(`/groups/${group}/topics`,member.token)).data.can_manage,false);
 await call(`/groups/${group}/topics/settings`,owner.token,{manage_policy:'admins'});
 assert.equal((await call(`/groups/${group}/topics/${a.id}`,member.token,{name:'Можно'},'PATCH')).status,200);
});
test('Android topic pages use a stable cursor and support 1000 topics without returning the entire catalog',async t=>{
 const f=await fixture(t),{call,owner,group,app}=f;
 app.db.exec('BEGIN');for(let i=0;i<1000;i++){const id=Number(app.db.prepare("INSERT INTO chats(pair,kind,title,parent_id,created_by) VALUES(?,'group',?,?,?)").run('bulk-'+i,'Тема '+i,group,owner.user.id).lastInsertRowid);app.db.prepare("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'owner')").run(id,owner.user.id);}app.db.exec('COMMIT');
 let cursor='',seen=[];for(let page=0;page<20;page++){const response=await call(`/groups/${group}/topics?limit=50${cursor?'&cursor='+encodeURIComponent(cursor):''}`,owner.token);assert.equal(response.status,200);assert.equal(response.data.topics.length,50);seen.push(...response.data.topics.map(t=>t.id));cursor=response.data.next_cursor;}
 assert.equal(cursor,null);assert.equal(new Set(seen).size,1000);
 assert.equal((await call(`/groups/${group}/topics`,owner.token,{name:'1001',client_id:randomUUID()})).status,409);
 assert.equal((await call(`/groups/${group}/topics?limit=50&cursor=bad`,owner.token)).status,400);
 assert.equal((await call(`/groups/${group}/topics?limit=-1`,owner.token)).status,400);
 assert.ok((await call(`/groups/${group}/topics?limit=50&q=999`,owner.token)).data.topics.every(t=>t.name.includes('999')));
});
test('topic revision conflicts preserve the newer name, audit entries and events; Cyrillic search ignores case',async t=>{
 const f=await fixture(t),{call,owner,group,app}=f,a=await f.topic('Ёлка');
 const changed=await call(`/groups/${group}/topics/${a.id}`,owner.token,{name:'Дизайн',revision:a.revision},'PATCH');assert.equal(changed.status,200);assert.equal(changed.data.revision,a.revision+1);
 assert.equal((await call(`/groups/${group}/topics/${a.id}`,owner.token,{name:'Старое имя',revision:a.revision},'PATCH')).status,409);
 assert.equal((await call(`/groups/${group}/topics?limit=50&q=${encodeURIComponent('ДИЗАЙН')}`,owner.token)).data.topics[0].name,'Дизайн');
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM topic_audit WHERE topic_id=?').get(a.id).n,2);
});
test('silent topic notifications stay enabled and preserve unread state',async t=>{
 const f=await fixture(t),{call,owner,member,group,app}=f,a=await f.topic('Тихая');await f.send(a.id,owner,'Непрочитанное');
 await call(`/chats/${a.id}/preferences`,member.token,{muted:true});
 assert.equal((await call(`/groups/${group}/topics/${a.id}/notifications`,member.token,{mode:'silent'})).status,200);
 assert.equal(topicNotification(app.db,a.id,member.user.id,'Привет'),true);
 const info=(await call(`/groups/${group}/topics`,member.token)).data;assert.equal(info.topics[0].notification_mode,'silent');assert.equal(info.topics[0].unread_count,1);
});
test('upgrading keeps legacy 80-character names manageable without allowing new overlong names',async t=>{
 const f=await fixture(t),a=await f.topic('Старая'),{app,call,owner,group}=f;
 app.db.prepare('UPDATE chats SET title=? WHERE id=?').run('я'.repeat(80),a.id);
 assert.equal((await call(`/groups/${group}/topics/${a.id}`,owner.token,{closed:true},'PATCH')).status,200);
 assert.equal((await call(`/groups/${group}/topics/${a.id}`,owner.token,{name:'я'.repeat(80)},'PATCH')).status,400);
 assert.equal((await call(`/groups/${group}/topics/${a.id}`,owner.token,{name:'Новое имя'},'PATCH')).status,200);
});
