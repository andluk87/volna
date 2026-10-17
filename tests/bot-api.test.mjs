import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

async function fixture(t,{database=':memory:',uploads}={}){
 const dir=uploads||mkdtempSync(join(tmpdir(),'volna-bots-'));
 const app=createApp({database,uploads:dir,newsEnabled:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.close();if(!uploads)rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 async function call(path,token,data,method,headers={}){const r=await fetch(base+path,{method:method||(data===undefined?'GET':'POST'),headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:r.status===204?null:await r.json(),headers:r.headers};}
 let nextPhone=1000000;
 function user(name){const id=Number(app.db.prepare('INSERT INTO users(username,name,phone) VALUES(?,?,?)').run(name,name,'+7900'+String(nextPhone++).padStart(7,'0')).lastInsertRowid),token=randomUUID();app.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);return {id,token};}
 const owner=user('owner_user'),other=user('other_user');
 async function bot(options={}){const r=await call('/api/developer/v1/bots',owner.token,{username:'test_bot_'+randomUUID().slice(0,8),display_name:'Тестовый бот',...options});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
 const send=(chat,who,text)=>call(`/api/chats/${chat}/messages`,who.token,{text,client_id:randomUUID()});
 return {app,base,call,user,owner,other,bot,send};
}

test('bot identity, owner isolation, single-display hashed tokens, rotation/revocation and user-session separation',async t=>{
 const f=await fixture(t),b=await f.bot();assert.ok(b.bot.account_id);assert.equal(b.bot.execution_mode,'external');
 assert.equal((await f.call('/bot/v1/me',b.token)).data.id,b.bot.id);
 assert.equal((await f.call('/api/me',b.token)).status,401);
 assert.equal((await f.call('/bot/v1/me',f.owner.token)).status,401);
 assert.equal((await f.call('/developer/v1/bots',b.token)).status,401);
 assert.equal((await f.call('/api/developer/v1/bots/'+b.bot.id,f.other.token)).status,404);
 const list=await f.call('/api/developer/v1/bots',f.owner.token);assert.equal(list.data.bots.length,1);assert.ok(!JSON.stringify(list.data).includes(b.token));
 const credentials=f.app.db.prepare('SELECT * FROM bot_tokens WHERE bot_id=?').all(b.bot.id);assert.equal(credentials[0].token_hash,createHash('sha256').update(b.token).digest('hex'));assert.ok(!JSON.stringify(credentials).includes(b.token));
 const rotated=await f.call(`/developer/v1/bots/${b.bot.id}/tokens`,f.owner.token,{});assert.equal(rotated.status,201);assert.equal((await f.call('/bot/v1/me',b.token)).status,401);assert.equal((await f.call('/api/bot/v1/me',rotated.data.token)).status,200);
 assert.equal((await f.call(`/developer/v1/bots/${b.bot.id}/tokens/${rotated.data.token_id}`,f.owner.token,undefined,'DELETE')).status,204);
 assert.equal((await f.call('/bot/v1/me',rotated.data.token)).status,401);
 assert.equal((await f.call('/api/developer/v1/bots',f.owner.token,{username:b.bot.username.toUpperCase(),display_name:'Collision'})).status,409);
});

test('private start, durable polling, reply through Messaging Service, SSE delivery and idempotency across tokens',async t=>{
 const f=await fixture(t),b=await f.bot(),chat=(await f.call('/api/chats',f.other.token,{user_id:b.bot.account_id})).data.id;assert.ok(chat);
 const controller=new AbortController();t.after(()=>controller.abort());const stream=await fetch(f.base+'/api/events',{headers:{Authorization:'Bearer '+f.other.token},signal:controller.signal});const reader=stream.body.getReader();await reader.read();
 const m=await f.send(chat,f.other,'/start');assert.equal(m.status,201);
 const updates=await f.call('/bot/v1/updates?timeout=0',b.token);assert.equal(updates.status,200);assert.equal(updates.data.updates.length,1);assert.equal(updates.data.updates[0].data.text,'/start');
 const u=updates.data.updates[0];assert.equal((await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates[0].event_id,u.event_id);
 const payload={chat_id:String(chat),type:'text',text:'Привет от бота',reply_to_message_id:String(m.data.id)},key=randomUUID();
 const sent=await f.call('/bot/v1/messages',b.token,payload,'POST',{'Idempotency-Key':key});assert.equal(sent.status,201,JSON.stringify(sent.data));assert.equal(sent.data.status,'accepted');
 assert.equal((await f.call('/bot/v1/messages',b.token,payload,'POST',{'Idempotency-Key':key})).data.id,sent.data.id);
 assert.equal((await f.call('/bot/v1/messages',b.token,{...payload,text:'Другой текст'},'POST',{'Idempotency-Key':key})).status,409);
 const rotated=await f.call(`/developer/v1/bots/${b.bot.id}/tokens`,f.owner.token,{});assert.equal((await f.call('/bot/v1/messages',rotated.data.token,payload,'POST',{'Idempotency-Key':key})).data.id,sent.data.id);
 const history=await f.call(`/api/chats/${chat}/messages`,f.other.token);const answer=history.data.find(m=>m.id===Number(sent.data.id));assert.equal(answer.text,'Привет от бота');assert.equal(answer.sender_is_bot,true);assert.equal(answer.reply.id,m.data.id);
 let delivered=false;for(let n=0;n<4&&!delivered;n++){const chunk=await reader.read();delivered=new TextDecoder().decode(chunk.value).includes('Привет от бота');}assert.equal(delivered,true);controller.abort();
 const ack=await f.call('/bot/v1/updates?timeout=0&offset='+(u.update_id+1),rotated.data.token);assert.deepEqual(ack.data.updates,[]);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM messages WHERE sender_id=?').get(b.bot.account_id).n,1);
});

test('bots cannot initiate chats, read unrelated users, bypass block or receive queued data after regrant',async t=>{
 const f=await fixture(t),b=await f.bot();const ordinary=(await f.call('/api/chats',f.owner.token,{user_id:f.other.id})).data.id;
 const denied=await f.call('/bot/v1/messages',b.token,{chat_id:String(ordinary),type:'text',text:'No access'},'POST',{'Idempotency-Key':randomUUID()});assert.equal(denied.status,403);assert.ok(denied.data.error.request_id);assert.equal(denied.headers.get('x-request-id'),denied.data.error.request_id);
 const chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 await f.send(chat,f.other,'queued private message');await f.call('/bot/v1/updates?timeout=0',b.token);
 assert.equal((await f.call('/api/bots/'+b.bot.id+'/block',f.other.token,{})).status,200);
 assert.deepEqual((await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates,[]);
 assert.equal((await f.send(chat,f.other,'blocked')).status,403);
 assert.equal((await f.call('/api/chats',f.other.token,{user_id:b.bot.account_id})).data.blocked,true);
 assert.equal((await f.call('/bot/v1/messages',b.token,{chat_id:String(chat),type:'text',text:'blocked'},'POST',{'Idempotency-Key':randomUUID()})).status,403);
 await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{});assert.deepEqual((await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates,[]);
 await f.send(chat,f.other,'new message');assert.equal((await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates[0].data.text,'new message');
});

test('group privacy: explicit administrator grant, restricted commands/mentions/replies, scope AND full_read, revocation',async t=>{
 const f=await fixture(t),b=await f.bot({scopes:['messages:send','messages:read_events','groups:read_all']}),group=(await f.call('/api/communities',f.owner.token,{kind:'group',title:'Bot group',client_id:randomUUID()})).data.id;
 await f.send(group,f.owner,'before invitation');
 await f.call(`/api/communities/${group}/add`,f.owner.token,{user_id:f.other.id});
 assert.equal((await f.call(`/api/chats/${group}/bots/${b.bot.id}`,f.other.token,{},'PUT')).status,403);
 assert.equal((await f.call(`/api/chats/${group}/bots/${b.bot.id}`,f.owner.token,{},'PUT')).status,200);
 await f.send(group,f.other,'private discussion');await f.send(group,f.other,'/help');await f.send(group,f.other,'hello @'+b.bot.username+'!');
 let events=(await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates;assert.deepEqual(events.map(e=>e.data.text),['/help','hello @'+b.bot.username+'!']);
 assert.equal((await f.call(`/api/chats/${group}/bots/${b.bot.id}`,f.owner.token,{visibility:'full_read'},'PUT')).status,200);
 await f.send(group,f.other,'full access');events=(await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates;assert.deepEqual(events.map(e=>e.data.text),['full access']);
 const withoutScope=await f.call(`/developer/v1/bots/${b.bot.id}/tokens`,f.owner.token,{scopes:['messages:read_events']});await f.send(group,f.other,'not allowed by token');assert.deepEqual((await f.call('/bot/v1/updates?timeout=0',withoutScope.data.token)).data.updates,[]);
 await f.call('/developer/v1/bots/'+b.bot.id,f.owner.token,{status:'suspended'},'PATCH');assert.equal((await f.call(`/api/chats/${group}/bots/${b.bot.id}`,f.owner.token,undefined,'DELETE')).status,200);await f.call('/developer/v1/bots/'+b.bot.id,f.owner.token,{status:'active'},'PATCH');await f.send(group,f.other,'/help');assert.deepEqual((await f.call('/bot/v1/updates?timeout=0',withoutScope.data.token)).data.updates,[]);
});

test('long polling wakes for new events, rejects parallel requests and rechecks rotated tokens while waiting',async t=>{
 const f=await fixture(t),b=await f.bot(),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 const pending=f.call('/bot/v1/updates?timeout=5',b.token);await new Promise(r=>setTimeout(r,80));
 assert.equal((await f.call('/bot/v1/updates?timeout=0',b.token)).status,409);
 await f.send(chat,f.other,'wake up');const result=await pending;assert.equal(result.status,200);assert.equal(result.data.updates[0].data.text,'wake up');
 const next=result.data.updates[0].update_id+1,waiting=f.call('/bot/v1/updates?timeout=5&offset='+next,b.token);await new Promise(r=>setTimeout(r,80));
 await f.call(`/developer/v1/bots/${b.bot.id}/tokens`,f.owner.token,{});assert.equal((await waiting).status,401);
 assert.equal((await f.call('/bot/v1/updates?timeout=-1',b.token)).status,401);
});

test('own edits/deletes use revision checks and cannot change another bot or user message; commands and suspension',async t=>{
 const f=await fixture(t),b=await f.bot(),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 const sent=await f.call('/bot/v1/messages',b.token,{chat_id:String(chat),type:'text',text:'original'},'POST',{'Idempotency-Key':randomUUID()});assert.equal(sent.status,201);
 const edited=await f.call('/bot/v1/messages/'+sent.data.id,b.token,{revision:0,text:'edited'},'PATCH');assert.equal(edited.status,200);assert.equal(edited.data.revision,1);
 assert.equal((await f.call('/bot/v1/messages/'+sent.data.id,b.token,{revision:0,text:'stale'},'PATCH')).status,409);
 const human=await f.send(chat,f.other,'human');assert.equal((await f.call('/bot/v1/messages/'+human.data.id,b.token,undefined,'DELETE')).status,403);
 assert.equal((await f.call('/bot/v1/messages/'+sent.data.id,b.token,undefined,'DELETE')).status,204);assert.equal((await f.call('/bot/v1/messages/'+sent.data.id,b.token,undefined,'DELETE')).status,204);
 assert.equal((await f.call('/bot/v1/commands',b.token,{commands:[{command:'start',description:'Начать'}]},'PUT')).status,204);assert.deepEqual((await f.call('/bot/v1/commands',b.token)).data.commands,[{command:'start',description:'Начать'}]);
 assert.equal((await f.call('/bot/v1/commands',b.token,{commands:[{command:'BAD',description:'invalid'}]},'PUT')).status,400);
 const commands=Array.from({length:100},(_,i)=>({command:'cmd_'+i,description:'Описание '.repeat(28)}));assert.equal((await f.call('/bot/v1/commands',b.token,{commands},'PUT')).status,204);assert.equal((await f.call('/bot/v1/commands',b.token)).data.commands.length,100);
 await f.call('/developer/v1/bots/'+b.bot.id,f.owner.token,{status:'suspended'},'PATCH');assert.equal((await f.call('/bot/v1/me',b.token)).status,403);
 await f.call('/developer/v1/bots/'+b.bot.id,f.owner.token,{status:'active'},'PATCH');assert.equal((await f.call('/bot/v1/me',b.token)).status,200);
});

test('transactional outbox survives unpublished commit, ignores rollbacks and excludes E2EE and bot-to-bot events',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-bot-restart-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const database=join(dir,'db');
 const f=await fixture(t,{database,uploads:join(dir,'uploads')}),b=await f.bot(),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 const insert=text=>f.app.db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(chat,f.other.id,text,randomUUID(),new Date().toISOString());
 f.app.db.exec('BEGIN');insert('rolled back');f.app.db.exec('ROLLBACK');assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM bot_message_outbox').get().n,0);
 insert('committed before restart');assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM bot_message_outbox WHERE processed IS NULL').get().n,1);
 await f.app.close();f.app.close=async()=>{};
 const app=createApp({database,uploads:join(dir,'uploads'),newsEnabled:false});t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/bot/v1/updates?timeout=0',{headers:{Authorization:'Bearer '+b.token}});assert.equal(r.status,200);assert.deepEqual((await r.json()).updates.map(e=>e.data.text),['committed before restart']);
 const e2ee=Number(app.db.prepare("INSERT INTO chats(pair,kind,encryption_mode) VALUES(?,'group','e2ee')").run('e2ee:'+randomUUID()).lastInsertRowid);app.db.prepare("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'owner')").run(e2ee,f.other.id);
 app.db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(e2ee,f.other.id,'ciphertext',randomUUID(),new Date().toISOString());
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM bot_message_outbox WHERE chat_id=?').get(e2ee).n,0);
 assert.throws(()=>app.db.prepare('INSERT INTO members(chat_id,user_id) VALUES(?,?)').run(e2ee,b.bot.account_id),/E2EE_BOT_UNSUPPORTED/);
 assert.throws(()=>app.db.prepare("UPDATE chats SET encryption_mode='e2ee' WHERE id=?").run(chat),/dedicated migration/);
});

test('revocation during a streamed message body is rechecked before sending',async t=>{
 const f=await fixture(t),b=await f.bot(),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 const {request}=await import('node:http');const payload=JSON.stringify({chat_id:String(chat),type:'text',text:'must not be sent'});
 let outgoing;const completed=new Promise((resolve,reject)=>{outgoing=request(f.base+'/bot/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+b.token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'Idempotency-Key':randomUUID()}},response=>{let data='';response.on('data',part=>data+=part);response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(data)}));});outgoing.on('error',reject);outgoing.flushHeaders();});
 await new Promise(r=>setTimeout(r,80));await f.call(`/developer/v1/bots/${b.bot.id}/tokens`,f.owner.token,{});outgoing.end(payload);
 assert.equal((await completed).status,401);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM messages WHERE sender_id=?').get(b.bot.account_id).n,0);
});

test('scope denial, locked chats, E2EE grant rejection and bot-owner blocking cannot be bypassed',async t=>{
 const f=await fixture(t),b=await f.bot({scopes:['messages:read_events']}),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 const send=token=>f.call('/bot/v1/messages',token,{chat_id:String(chat),type:'text',text:'restricted'},'POST',{'Idempotency-Key':randomUUID()});assert.equal((await send(b.token)).status,403);
 const token=(await f.call(`/developer/v1/bots/${b.bot.id}/tokens`,f.owner.token,{scopes:['messages:send','messages:read_events']})).data.token;
 f.app.db.prepare('UPDATE chats SET admin_locked=1 WHERE id=?').run(chat);assert.equal((await send(token)).status,403);f.app.db.prepare('UPDATE chats SET admin_locked=0 WHERE id=?').run(chat);
 const e2ee=Number(f.app.db.prepare("INSERT INTO chats(pair,kind,encryption_mode) VALUES(?,'group','e2ee')").run(randomUUID()).lastInsertRowid);f.app.db.prepare("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'owner')").run(e2ee,f.owner.id);
 assert.equal((await f.call(`/api/chats/${e2ee}/bots/${b.bot.id}`,f.owner.token,{},'PUT')).data.code,'E2EE_BOT_UNSUPPORTED');
 f.app.db.prepare('UPDATE users SET admin_blocked=1 WHERE id=?').run(f.owner.id);assert.equal((await f.call('/bot/v1/me',token)).status,403);
});

test('restricted group bot receives addressed commands and deletion tombstones without routing-only text',async t=>{
 const f=await fixture(t),b=await f.bot(),group=(await f.call('/api/communities',f.owner.token,{kind:'group',title:'Commands',client_id:randomUUID()})).data.id;
 await f.call(`/api/chats/${group}/bots/${b.bot.id}`,f.owner.token,{},'PUT');
 const message=await f.send(group,f.owner,'/help@'+b.bot.username+' argument');await f.send(group,f.owner,'/help@another_bot');
 const created=(await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates;assert.equal(created.length,1);assert.equal(created[0].data.text,'/help@'+b.bot.username+' argument');assert.ok(!JSON.stringify(created).includes('_routing_text'));
 await f.call('/api/messages/'+message.data.id+'/delete',f.owner.token,{});
 const deleted=(await f.call('/bot/v1/updates?timeout=0&offset='+(created[0].update_id+1),b.token)).data.updates;
 assert.equal(deleted.length,1);assert.equal(deleted[0].event_type,'message.deleted');assert.equal(deleted[0].data.text,'');assert.ok(!JSON.stringify(deleted).includes('_routing_text'));assert.ok(!JSON.stringify(deleted).includes('/help@'));
});

test('documented Python echo bot processes a real event and persists its polling offset',async t=>{
 const f=await fixture(t),b=await f.bot(),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 const {spawn}=await import('node:child_process'),{existsSync,readFileSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'volna-echo-state-')),state=join(dir,'offset.json');
 const child=spawn('python3',['examples/echo-bot.py'],{env:{...process.env,VOLNA_URL:f.base,BOT_TOKEN:b.token,BOT_OFFSET_PATH:state},stdio:['ignore','pipe','pipe']});
 let error='';child.stderr.on('data',part=>error+=part);child.stdout.resume();
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}rmSync(dir,{recursive:true,force:true});});
 await f.send(chat,f.other,'Проверка Python-бота');let reply,offset;
 const deadline=Date.now()+10000;while(Date.now()<deadline){
  reply=(await f.call(`/api/chats/${chat}/messages`,f.other.token)).data.find(m=>m.sender_id===b.bot.account_id);
  if(existsSync(state))offset=JSON.parse(readFileSync(state,'utf8')).offset;
  if(reply&&offset>1)break;
  assert.equal(child.exitCode,null,error);await new Promise(r=>setTimeout(r,50));
 }
 assert.equal(reply?.text,'Проверка Python-бота',error);assert.ok(offset>1);assert.equal(reply.sender_is_bot,true);
});
