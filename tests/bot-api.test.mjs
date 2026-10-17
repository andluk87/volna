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

test('main bot manages owned bots through ordinary chat, isolates owners and commits commands exactly once',async t=>{
 const f=await fixture(t);
 const manager=(await f.call('/api/bots/manager',f.owner.token,{})).data;
 assert.ok(manager.id);assert.ok(manager.username);
 const again=(await f.call('/api/bots/manager',f.owner.token,{})).data;assert.equal(again.id,manager.id);
 const master=f.app.db.prepare('SELECT b.* FROM bot_father f JOIN bots b ON b.id=f.bot_id').get();
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM bot_tokens WHERE bot_id=?').get(master.id).n,0);
 async function command(text,who=f.owner,chat=manager.id){
  const sent=await f.send(chat,who,text);assert.equal(sent.status,201,JSON.stringify(sent.data));
  for(let i=0;i<40;i++){
   const reply=f.app.db.prepare('SELECT * FROM messages WHERE chat_id=? AND sender_id=? AND id>? ORDER BY id LIMIT 1').get(chat,master.account_id,sent.data.id);
   if(reply)return reply.text;
   await new Promise(r=>setTimeout(r,50));
  }
  assert.fail('main bot did not reply');
 }
 assert.match(await command('/start'),/\/newbot/);
 assert.match(await command('/newbot'),/название/);
 await command('Мой новый бот');
 assert.match(await command('ab'),/4 до 32/);
 const created=await command('managed_bot');assert.match(created,/@managed_bot создан/);
 const token=created.match(/vbot_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}/)[0];
 const bot=(await f.call('/bot/v1/me',token)).data;assert.equal(bot.display_name,'Мой новый бот');
 assert.match(await command('/mybots'),/@managed_bot/);
 const otherManager=(await f.call('/api/bots/manager',f.other.token,{})).data;
 assert.match(await command('/token @managed_bot',f.other,otherManager.id),/не найден/);
 assert.equal((await f.call('/bot/v1/me',token)).status,200);
 await command('/setname @managed_bot Новое имя');await command('/setdescription @managed_bot Описание');
 assert.equal((await f.call('/bot/v1/me',token)).data.display_name,'Новое имя');
 await command('/pause @managed_bot');assert.equal((await f.call('/bot/v1/me',token)).status,403);
 await command('/resume @managed_bot');assert.equal((await f.call('/bot/v1/me',token)).status,200);
 const rotated=await command('/token @managed_bot'),next=rotated.match(/vbot_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}/)[0];
 assert.equal((await f.call('/bot/v1/me',token)).status,401);
 assert.equal((await f.call('/bot/v1/me',next)).status,200);
 const full=await command('/groups @managed_bot on'),fullToken=full.match(/vbot_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}/)[0];
 assert.equal((await f.call('/bot/v1/me',next)).status,401);
 assert.ok(JSON.parse(f.app.db.prepare('SELECT scopes FROM bot_tokens WHERE token_hash=?').get(createHash('sha256').update(fullToken).digest('hex')).scopes).includes('groups:read_all'));
 const before=f.app.db.prepare('SELECT COUNT(*) n FROM messages WHERE sender_id=?').get(master.account_id).n;
 // A later poll/drain must not replay any of the accepted commands.
 await f.call('/bot/v1/updates?timeout=0',fullToken);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM messages WHERE sender_id=?').get(master.account_id).n,before);
 await command('/revoke @managed_bot');assert.equal((await f.call('/bot/v1/me',fullToken)).status,401);
 const group=(await f.call('/api/communities',f.owner.token,{kind:'group',title:'No master in groups',client_id:randomUUID()})).data.id;
 assert.equal((await f.call(`/api/chats/${group}/bots/${master.id}`,f.owner.token,{},'PUT')).status,403);
 await command('/newbot');await command('Duplicate');assert.match(await command('managed_bot'),/занят/);
 assert.match(await command('managed_second'),/создан/);
 await command('/newbot');assert.match(await command('/cancel'),/отменено/);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM bot_father_sessions').get().n,0);
});


test('main bot resumes creation after restart and does not replay the committed token issue',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-father-restart-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const database=join(dir,'db'),uploads=join(dir,'uploads'),f=await fixture(t,{database,uploads});
 const manager=(await f.call('/api/bots/manager',f.owner.token,{})).data;
 await f.send(manager.id,f.owner,'/newbot');await f.send(manager.id,f.owner,'Restart Bot');
 assert.equal(f.app.db.prepare('SELECT step FROM bot_father_sessions WHERE user_id=?').get(f.owner.id).step,'username');
 // Commit a command without publishing. It must be processed by the next API process.
 f.app.db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(manager.id,f.owner.id,'restart_managed_bot',randomUUID(),new Date().toISOString());
 await f.app.close();f.app.close=async()=>{};
 let app=createApp({database,uploads,newsEnabled:false});t.after(()=>app.close());
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 let bot;
 for(let n=0;n<60;n++){bot=app.db.prepare('SELECT b.* FROM bots b JOIN users u ON u.id=b.account_id WHERE u.username=?').get('restart_managed_bot');if(bot)break;await new Promise(r=>setTimeout(r,50));}
 assert.ok(bot);assert.equal(bot.owner_id,f.owner.id);
 const credentials=app.db.prepare('SELECT id FROM bot_tokens WHERE bot_id=?').all(bot.id);assert.equal(credentials.length,1);
 const master=app.db.prepare('SELECT b.* FROM bot_father f JOIN bots b ON b.id=f.bot_id').get();
 assert.equal(master.id,manager.bot_id);
 assert.equal(app.db.prepare("SELECT COUNT(*) n FROM messages WHERE sender_id=? AND text LIKE '%@restart_managed_bot создан%'").get(master.account_id).n,1);
 await app.close();app=createApp({database,uploads,newsEnabled:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 await new Promise(r=>setTimeout(r,1100));
 assert.deepEqual(app.db.prepare('SELECT id FROM bot_tokens WHERE bot_id=?').all(bot.id),credentials);
 assert.equal(app.db.prepare("SELECT COUNT(*) n FROM messages WHERE sender_id=? AND text LIKE '%@restart_managed_bot создан%'").get(master.account_id).n,1);
});


test('inline buttons keep callback payload server-side, bind actor and bot, deduplicate taps and answer once',async t=>{
 const f=await fixture(t),b=await f.bot(),otherBot=await f.bot(),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 const payload={chat_id:String(chat),type:'text',text:'Выберите',reply_markup:{inline_keyboard:[[{text:'Каталог',callback_data:'private_catalog_payload'}]]}};
 const key=randomUUID(),sent=await f.call('/bot/v1/messages',b.token,payload,'POST',{'Idempotency-Key':key});assert.equal(sent.status,201,JSON.stringify(sent.data));
 let message=(await f.call('/api/chats/'+chat+'/messages',f.other.token)).data.find(m=>m.id===Number(sent.data.id));
 assert.equal(message.bot_buttons[0][0].text,'Каталог');assert.ok(!JSON.stringify(message).includes('private_catalog_payload'));
 assert.equal((await f.call('/bot/v1/messages',b.token,payload,'POST',{'Idempotency-Key':key})).data.id,sent.data.id);
 const button=message.bot_buttons[0][0],tap={message_id:message.id,button_id:button.id,interaction_id:randomUUID()};
 assert.equal((await f.call('/api/bots/interactions',f.other.token,{...tap,actor_id:f.owner.id})).status,400);
 assert.equal((await f.call('/api/bots/interactions',f.other.token,{...tap,callback_data:'forged'})).status,400);
 assert.equal((await f.call('/api/bots/interactions',f.owner.token,tap)).status,403);
 const clicked=await f.call('/api/bots/interactions',f.other.token,tap);assert.equal(clicked.status,200,JSON.stringify(clicked.data));assert.equal(clicked.data.status,'pending');
 assert.equal((await f.call('/api/bots/interactions',f.other.token,tap)).data.callback_id,clicked.data.callback_id);
 const updates=(await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates;assert.equal(updates.length,1);
 const event=updates[0];assert.equal(event.event_type,'callback.created');assert.equal(event.data.actor.id,String(f.other.id));assert.equal(event.data.data,'private_catalog_payload');assert.equal(event.data.message_id,String(message.id));assert.ok(!JSON.stringify(event).includes('+7900'));
 const answerPath='/bot/v1/callbacks/'+clicked.data.callback_id+'/answer',answer={text:'Каталог открыт',show_alert:true};
 assert.equal((await f.call(answerPath,otherBot.token,answer)).status,404);
 assert.equal((await f.call('/api/bots/interactions/'+clicked.data.callback_id,f.owner.token)).status,404);
 assert.equal((await f.call(answerPath,b.token,answer)).status,204);
 assert.equal((await f.call(answerPath,b.token,answer)).status,204);
 assert.equal((await f.call(answerPath,b.token,{text:'Другой ответ'})).status,409);
 assert.deepEqual((await f.call('/api/bots/interactions/'+clicked.data.callback_id,f.other.token)).data.answer,answer);
 assert.equal((await f.call('/api/bots/interactions',f.other.token,tap)).data.status,'answered');
 assert.deepEqual((await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates,[]);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM bot_callback_requests').get().n,1);
});

test('keyboard validation, idempotency and markup-only revision changes invalidate old callbacks',async t=>{
 const f=await fixture(t),b=await f.bot(),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 const payload={chat_id:String(chat),type:'text',text:'Keyboard'},good={inline_keyboard:[[{text:'🙂'.repeat(64),callback_data:'ю'.repeat(64)}]]};
 for(const reply_markup of [{inline_keyboard:[[{text:'x',url:'https://example.com'}]]},{inline_keyboard:Array.from({length:9},()=>[{text:'x',callback_data:'x'}])},{inline_keyboard:[[]]},{inline_keyboard:[[{text:'x'.repeat(65),callback_data:'x'}]]},{inline_keyboard:[[{text:'x',callback_data:'ю'.repeat(65)}]]},{inline_keyboard:[[{text:'x',callback_data:'\ud800'}]]}]){
  assert.equal((await f.call('/bot/v1/messages',b.token,{...payload,reply_markup},'POST',{'Idempotency-Key':randomUUID()})).status,400);
 }
 const key=randomUUID(),sent=await f.call('/bot/v1/messages',b.token,{...payload,reply_markup:good},'POST',{'Idempotency-Key':key});assert.equal(sent.status,201);
 assert.equal((await f.call('/bot/v1/messages',b.token,{...payload,reply_markup:null},'POST',{'Idempotency-Key':key})).status,409);
 const message=(await f.call('/api/chats/'+chat+'/messages',f.other.token)).data.find(m=>m.id===Number(sent.data.id)),tap={message_id:message.id,button_id:message.bot_buttons[0][0].id,interaction_id:randomUUID()};
 const callback=(await f.call('/api/bots/interactions',f.other.token,tap)).data.callback_id;
 const patched=await f.call('/bot/v1/messages/'+message.id,b.token,{revision:0,reply_markup:null},'PATCH');assert.equal(patched.status,200,JSON.stringify(patched.data));assert.equal(patched.data.revision,1);
 assert.equal((await f.call('/bot/v1/messages/'+message.id,b.token,{revision:0,reply_markup:good},'PATCH')).status,409);
 const changed=(await f.call('/api/chats/'+chat+'/messages',f.other.token)).data.find(m=>m.id===message.id);assert.deepEqual(changed.bot_buttons,[]);assert.equal(changed.text,'Keyboard');
 assert.equal((await f.call('/api/bots/interactions',f.other.token,tap)).status,403);
 assert.equal((await f.call('/api/bots/interactions/'+callback,f.other.token)).status,403);
 assert.equal((await f.call('/bot/v1/callbacks/'+callback+'/answer',b.token,{text:'old'})).status,403);
 assert.deepEqual((await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates,[]);
});

test('callback expiry, token scopes, hidden history and group regrant revoke interaction access',async t=>{
 const f=await fixture(t),b=await f.bot(),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 const send=async c=>{const r=await f.call('/bot/v1/messages',b.token,{chat_id:String(c),type:'text',text:'Tap',reply_markup:{inline_keyboard:[[{text:'Кнопка',callback_data:'action'}]]}},'POST',{'Idempotency-Key':randomUUID()});assert.equal(r.status,201);return (await f.call('/api/chats/'+c+'/messages',f.other.token)).data.find(m=>m.id===Number(r.data.id));};
 const m=await send(chat),tap={message_id:m.id,button_id:m.bot_buttons[0][0].id,interaction_id:randomUUID()},callback=(await f.call('/api/bots/interactions',f.other.token,tap)).data.callback_id;
 f.app.db.prepare('UPDATE bot_callback_requests SET expires=? WHERE id=?').run(Date.now()-1,callback);
 assert.equal((await f.call('/api/bots/interactions/'+callback,f.other.token)).data.status,'expired');
 assert.equal((await f.call('/bot/v1/callbacks/'+callback+'/answer',b.token,{text:'late'})).status,410);
 const next=(await f.call('/api/bots/interactions',f.other.token,{...tap,interaction_id:randomUUID()})).data.callback_id;
 f.app.db.prepare('INSERT INTO chat_visibility(user_id,chat_id,hidden_before) VALUES(?,?,?)').run(f.other.id,chat,m.id);
 assert.equal((await f.call('/api/bots/interactions/'+next,f.other.token)).status,403);
 const scope=(await f.call('/developer/v1/bots/'+b.bot.id+'/tokens',f.owner.token,{scopes:['messages:send','messages:read_events']})).data.token;
 assert.equal((await f.call('/bot/v1/callbacks/'+next+'/answer',scope,{text:'no scope'})).status,403);
 b.token=(await f.call('/developer/v1/bots/'+b.bot.id+'/tokens',f.owner.token,{scopes:['messages:send','messages:read_events','callbacks:answer']})).data.token;
 const group=(await f.call('/api/communities',f.other.token,{kind:'group',title:'Callback group',client_id:randomUUID()})).data.id;
 await f.call('/api/chats/'+group+'/bots/'+b.bot.id,f.other.token,{},'PUT');
 const gm=await send(group),gcallback=(await f.call('/api/bots/interactions',f.other.token,{message_id:gm.id,button_id:gm.bot_buttons[0][0].id,interaction_id:randomUUID()})).data.callback_id;
 const events=(await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates;assert.equal(events.filter(e=>e.event_type==='callback.created').length,1);
 await f.call('/api/chats/'+group+'/bots/'+b.bot.id,f.other.token,{},'PUT');
 assert.equal((await f.call('/bot/v1/callbacks/'+gcallback+'/answer',b.token,{text:'regrant'})).status,403);
 assert.deepEqual((await f.call('/bot/v1/updates?timeout=0',b.token)).data.updates,[]);
});

test('main bot buttons create owner-scoped dialog state; command menus refresh and forwarded messages lose actions',async t=>{
 const f=await fixture(t),manager=(await f.call('/api/bots/manager',f.owner.token,{})).data;
 const welcome=(await f.call('/api/chats/'+manager.id+'/messages',f.owner.token)).data[0];assert.ok(welcome.bot_buttons.length);
 const pressed=await f.call('/api/bots/interactions',f.owner.token,{message_id:welcome.id,button_id:welcome.bot_buttons[0][0].id,interaction_id:randomUUID()});assert.equal(pressed.status,200,JSON.stringify(pressed.data));assert.equal(pressed.data.status,'answered');
 assert.equal(f.app.db.prepare('SELECT step FROM bot_father_sessions WHERE user_id=?').get(f.owner.id).step,'name');
 const menu=(await f.call('/api/chats/'+manager.id+'/bot-commands',f.owner.token)).data;assert.ok(menu.bots[0].commands.some(c=>c.command==='newbot'));
 assert.equal((await f.call('/api/chats/'+manager.id+'/bot-commands',f.other.token)).status,403);
 const b=await f.bot(),chat=(await f.call('/api/bots/'+b.bot.id+'/start',f.other.token,{})).data.id;
 assert.equal((await f.call('/bot/v1/commands',b.token,{commands:[{command:'catalog',description:'Каталог'}]},'PUT')).status,204);
 assert.equal((await f.call('/api/chats/'+chat+'/bot-commands',f.other.token)).data.bots[0].commands[0].command,'catalog');
 const privateChat=(await f.call('/api/chats',f.owner.token,{user_id:f.other.id})).data.id;
 const forwarded=await f.call('/api/messages/'+welcome.id+'/forward',f.owner.token,{chat_id:privateChat,client_id:randomUUID()});assert.equal(forwarded.status,201,JSON.stringify(forwarded.data));assert.deepEqual(forwarded.data.bot_buttons,[]);
});
