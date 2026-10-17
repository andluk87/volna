import {botWebhooks} from './bot-webhooks.mjs';
import {join} from 'node:path';
import {botInteractions} from './bot-interactions.mjs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createBotFather} from './bot-father.mjs';
import {initBotSchema} from './bot-schema.mjs';
import {canonicalUsername,usernameProblem} from './usernames.mjs';
import {readAdminSettings} from './admin-config.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,code,message)=>Object.assign(Error(message),{status,code});
const number=value=>{if(!['string','number'].includes(typeof value)||typeof value==='string'&&!/^[1-9]\d*$/.test(value))throw fail(400,'INVALID_ID','Некорректный идентификатор');const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw fail(400,'INVALID_ID','Некорректный идентификатор');return n;};
const defaultScopes=['messages:send','messages:edit_own','messages:delete_own','messages:read_events','chats:read_basic','commands:manage','callbacks:answer'];
const allScopes=new Set([...defaultScopes,'groups:read_all']);
const scopes=value=>{if(!Array.isArray(value)||!value.length||value.length>allScopes.size||new Set(value).size!==value.length||value.some(s=>!allScopes.has(s)))throw fail(400,'INVALID_SCOPES','Некорректные разрешения');return value;};
const only=(data,keys)=>{if(Object.keys(data).some(key=>!keys.includes(key)))throw fail(400,'UNKNOWN_FIELD','Неизвестное поле запроса');};
export function botPlatform({db,body,json,userById,member,publish,broadcast,messaging,authorizeOwner,webhookOptions={}}){
 initBotSchema(db);
 const buckets=new Map();
 const rate=(key,max)=>{const now=Date.now(),old=buckets.get(key),item=old&&old.until>now?old:{count:0,until:now+60000};if(buckets.size>=20000&&!buckets.has(key))throw fail(429,'RATE_LIMITED','Слишком много запросов');buckets.set(key,item);if(++item.count>max)throw fail(429,'RATE_LIMITED','Слишком много запросов');};
 const waiting=new Map();let closed=false,draining=false;
 const tx=fn=>{db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const get=id=>db.prepare('SELECT b.*,u.username,u.name AS display_name,u.bio AS description,u.admin_blocked,o.admin_blocked AS owner_blocked FROM bots b JOIN users u ON u.id=b.account_id JOIN users o ON o.id=b.owner_id WHERE b.id=?').get(id);
 const info=bot=>({id:bot.id,account_id:bot.account_id,username:bot.username,display_name:bot.display_name,description:bot.description,status:bot.status,execution_mode:bot.execution_mode,commands:JSON.parse(bot.commands)});
 const owned=(id,uid)=>{const bot=get(id);if(!bot||bot.owner_id!==uid)throw fail(404,'BOT_NOT_FOUND','Бот не найден');return bot;};
 const available=bot=>{if(!bot||bot.status!=='active'||bot.admin_blocked||bot.owner_blocked)throw fail(403,'BOT_DISABLED','Бот недоступен');return bot;};
 const audit=(bot,uid,action)=>db.prepare('INSERT INTO bot_audit(bot_id,actor_id,action,created) VALUES(?,?,?,?)').run(bot,uid,action,Date.now());
 function wake(id){waiting.get(id)?.();}
 function authenticate(req,scope){
  if(readAdminSettings(db).maintenance)throw fail(503,'MAINTENANCE','Сервер на обслуживании');
  const value=String(req.headers.authorization||'').match(/^Bearer (vbot_[a-f0-9]{32}\.[A-Za-z0-9_-]{43})$/)?.[1];
  const credential=value&&db.prepare('SELECT * FROM bot_tokens WHERE token_hash=? AND revoked IS NULL').get(hash(value));
  if(!credential)throw fail(401,'INVALID_TOKEN','Недействительный токен бота');
  const bot=available(get(credential.bot_id)),allowed=JSON.parse(credential.scopes);
  if(scope&&!allowed.includes(scope))throw fail(403,'SCOPE_DENIED','Токен не разрешает это действие');
  return {...bot,credential,scopes:allowed};
 }
 function issue(bot,uid,allowed){
  const id=randomBytes(16).toString('hex'),token='vbot_'+id+'.'+randomBytes(32).toString('base64url');
  db.prepare('UPDATE bot_tokens SET revoked=? WHERE bot_id=? AND revoked IS NULL').run(Date.now(),bot.id);
  db.prepare('INSERT INTO bot_tokens VALUES(?,?,?,?,?,NULL)').run(id,bot.id,hash(token),JSON.stringify(allowed),Date.now());audit(bot.id,uid,'token.rotate');wake(bot.id);
  return {token_id:id,token,scopes:allowed};
 }
 function grant(bot,chat,uid,{visibility='restricted',can_send=true}={}){
  const cutoff=db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM bot_message_outbox').get().n;
  db.prepare('INSERT INTO bot_chat_grants(bot_id,chat_id,visibility,can_send,cutoff_id,granted_by) VALUES(?,?,?,?,?,?) ON CONFLICT(bot_id,chat_id) DO UPDATE SET active=1,visibility=excluded.visibility,can_send=excluded.can_send,version=bot_chat_grants.version+1,cutoff_id=excluded.cutoff_id,granted_by=excluded.granted_by').run(bot.id,chat,visibility,+can_send,cutoff,uid);
  audit(bot.id,uid,'chat.grant');wake(bot.id);
 }
 function privateChat(uid,peer,explicit=false){
  const ref=db.prepare('SELECT id FROM bots WHERE account_id=?').get(peer),bot=available(ref&&get(ref.id));
  const pair=[uid,peer].sort((a,b)=>a-b).join(':');
  const result=tx(()=>{
   db.prepare('INSERT OR IGNORE INTO chats(pair) VALUES(?)').run(pair);const chat=db.prepare('SELECT * FROM chats WHERE pair=?').get(pair);
   if(chat.encryption_mode!=='server_readable')throw fail(409,'E2EE_BOT_UNSUPPORTED','Боты недоступны в E2EE-чатах');
   for(const id of [uid,peer])db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)').run(chat.id,id);
   const previous=db.prepare('SELECT * FROM bot_chat_grants WHERE bot_id=? AND chat_id=?').get(bot.id,chat.id);
   if(!previous||explicit&&!previous.active)grant(bot,chat.id,uid);
   return {id:chat.id,bot_id:bot.id,blocked:previous&&!previous.active&&!explicit||false};
  });broadcast(result.id,{type:'chats'});return result;
 }
 function access(bot,chat){
  const row=db.prepare('SELECT c.*,g.active,g.visibility,g.can_send,g.version,g.cutoff_id FROM chats c JOIN bot_chat_grants g ON g.chat_id=c.id WHERE c.id=? AND g.bot_id=?').get(chat,bot.id);
  if(!row||!row.active||row.encryption_mode!=='server_readable'||row.admin_deleted||row.topic_deleted||bot.status!=='active'||bot.admin_blocked||bot.owner_blocked)throw fail(403,'CHAT_ACCESS_DENIED','Чат недоступен');
  member(chat,bot.account_id);
  if(db.prepare('SELECT 1 FROM community_bans WHERE chat_id=? AND user_id=?').get(chat,bot.account_id))throw fail(403,'CHAT_ACCESS_DENIED','Чат недоступен');
  return row;
 }
 function permitted(bot,chat,data){
  if(chat.kind==='direct')return true;
  if(chat.visibility==='full_read'&&bot.scopes.includes('groups:read_all'))return true;
  const escaped=bot.username.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const command=String(data.text).match(/^\/([a-z0-9_]{1,32})(?:@([a-z0-9_]{4,32}))?(?:\s|$)/i);
  return new RegExp('(^|[^a-z0-9_])@'+escaped+'(?![a-z0-9_])','i').test(data.text)||!!(command&&(!command[2]||command[2].toLowerCase()===bot.username.toLowerCase()))||!!(data.reply_to_message_id&&db.prepare('SELECT 1 FROM messages WHERE id=? AND chat_id=? AND sender_id=?').get(number(data.reply_to_message_id),chat.id,bot.account_id));
 }
 let webhooks;
 const father=createBotFather({db,get,owned,info,issue,audit,wake,createBot:(uid,data)=>createBot(uid,data,fn=>fn()),defaultScopes,webhook:(bot,value,chat)=>webhooks.ownerCommand(bot,value,chat)});
 const interactions=botInteractions({db,get,access,member,publish,wake,tx,messaging,master:father});
 webhooks=botWebhooks({db,tx,get,access,wake,audit,masterId:father.id,paused:()=>!!readAdminSettings(db).maintenance,deliverable:interactions.deliverable,
  keyPath:process.env.WEBHOOK_KEY_PATH||(process.env.UPLOAD_PATH?join(process.env.UPLOAD_PATH,'../bot-webhook.key'):undefined),
  masterReply(chat,text){const row=messaging.insert(chat,father.accountId,{text,client_id:randomUUID()}).row;interactions.setMarkup(row,get(father.id),interactions.markup(father.markup));return ()=>messaging.publish(row);},
  ...webhookOptions});
 function drain(){
  if(closed||draining)return;draining=true;const notify=new Set(),replies=[];
  try{tx(()=>{
   const events=db.prepare('SELECT * FROM bot_message_outbox WHERE processed IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED').all();
   for(const event of events){
    const reply=father.process(event);if(reply){const row=messaging.insert(event.chat_id,father.accountId,{text:reply,client_id:hash('botfather:'+event.id)}).row;interactions.setMarkup(row,get(father.id),interactions.markup(father.markup));replies.push(row);}
    const candidates=db.prepare('SELECT b.id FROM bots b JOIN bot_chat_grants g ON g.bot_id=b.id WHERE g.chat_id=? AND g.active=1 AND g.cutoff_id<?').all(event.chat_id,event.id);
    for(const candidate of candidates){
     const bot=get(candidate.id),data=JSON.parse(event.payload);
     const creds=db.prepare('SELECT scopes FROM bot_tokens WHERE bot_id=? AND revoked IS NULL').all(bot.id);
     bot.scopes=[...new Set(creds.flatMap(c=>JSON.parse(c.scopes)))];if(!bot.scopes.includes('messages:read_events'))continue;
     let chat;try{chat=access(bot,event.chat_id);}catch(e){if(e.status)continue;throw e;}
     const policy={...data,text:data._routing_text??data.text};delete data._routing_text;
     const restricted=permitted({...bot,scopes:[]},{...chat,visibility:'restricted'},policy);
     if(!permitted(bot,chat,policy))continue;
     const eventId='evt_'+event.id;if(db.prepare('SELECT 1 FROM bot_updates WHERE bot_id=? AND event_id=?').get(bot.id,eventId))continue;
     const next=db.prepare('UPDATE bots SET last_update_id=last_update_id+1 WHERE id=? RETURNING last_update_id').get(bot.id).last_update_id;
     const payload={update_id:next,event_id:eventId,event_type:event.event_type,api_version:'1',bot_id:bot.id,occurred_at:new Date(event.created).toISOString(),chat_id:String(event.chat_id),chat_sequence:event.id,data};
     db.prepare('INSERT INTO bot_updates(bot_id,update_id,event_id,event_type,chat_id,grant_version,restricted_allowed,payload,expires) VALUES(?,?,?,?,?,?,?,?,?)').run(bot.id,next,eventId,event.event_type,event.chat_id,chat.version,+restricted,JSON.stringify(payload),Date.now()+86400000);notify.add(bot.id);
    }
    db.prepare('UPDATE bot_message_outbox SET processed=? WHERE id=?').run(Date.now(),event.id);
   }
  });for(const row of replies)messaging.publish(row);for(const id of notify)wake(id);}finally{draining=false;}
 }
 const tick=()=>{try{drain();}catch{console.error('[bots] outbox processing failed; events retained');}};
 const timer=setInterval(tick,1000);timer.unref();
 const retention=setInterval(()=>{try{webhooks.cleanup();interactions.cleanup();for(const [key,item] of buckets)if(item.until<Date.now())buckets.delete(key);db.prepare('DELETE FROM bot_father_sessions WHERE updated<?').run(Date.now()-3600000);db.prepare('DELETE FROM bot_updates WHERE expires<?').run(Date.now());db.prepare('DELETE FROM bot_idempotency WHERE created<?').run(Date.now()-86400000);db.prepare('DELETE FROM bot_message_outbox WHERE processed<?').run(Date.now()-86400000);}catch{console.error('[bots] retention failed');}},60000);retention.unref();
 async function poll(req,res,url){
  let bot=authenticate(req,'messages:read_events');if(webhooks.enabled(bot.id))throw fail(409,'DELIVERY_MODE_CONFLICT','Включён webhook');rate('poll:'+bot.id,120);
  const offset=Number(url.searchParams.get('offset')||1),count=Number(url.searchParams.get('limit')||100),timeout=Number(url.searchParams.get('timeout')??30);
  if(!Number.isSafeInteger(offset)||offset<1||offset>bot.last_update_id+1||!Number.isInteger(count)||count<1||count>100||!Number.isInteger(timeout)||timeout<0||timeout>30)throw fail(400,'INVALID_POLL','Некорректные параметры получения событий');
  const lease=randomUUID(),until=Date.now()+35000;
  if(!db.prepare('UPDATE bots SET poll_lease=?,poll_until=? WHERE id=? AND poll_until<? RETURNING id').get(lease,until,bot.id,Date.now()))throw fail(409,'POLL_CONFLICT','У бота уже есть активный запрос событий');
  let aborted=false;const abort=()=>{aborted=true;wake(bot.id);};res.once('close',abort);
  try{
   db.prepare('UPDATE bot_updates SET acked=1 WHERE bot_id=? AND update_id<?').run(bot.id,offset);
   const deadline=Date.now()+timeout*1000;
   for(;;){
    bot=authenticate(req,'messages:read_events');if(webhooks.enabled(bot.id)||db.prepare('SELECT poll_lease FROM bots WHERE id=?').get(bot.id).poll_lease!==lease)throw fail(409,'DELIVERY_MODE_CONFLICT','Транспорт изменён');drain();
    const pending=db.prepare('SELECT * FROM bot_updates WHERE bot_id=? AND update_id>=? AND acked=0 AND expires>? ORDER BY update_id LIMIT 1000').all(bot.id,offset,Date.now()),updates=[];
    for(const row of pending){let chat;try{chat=access(bot,row.chat_id);}catch(e){if(e.status){db.prepare('UPDATE bot_updates SET acked=1 WHERE bot_id=? AND update_id=?').run(bot.id,row.update_id);continue;}throw e;}
     const value=JSON.parse(row.payload);if(value.event_type==='callback.created'&&!interactions.deliverable(value)||chat.version!==row.grant_version||!(row.restricted_allowed||chat.kind==='direct'||chat.visibility==='full_read'&&bot.scopes.includes('groups:read_all'))){db.prepare('UPDATE bot_updates SET acked=1 WHERE bot_id=? AND update_id=?').run(bot.id,row.update_id);continue;}
     updates.push(value);if(updates.length===count)break;
    }
    if(aborted||closed)return;
    if(updates.length||Date.now()>=deadline)return json(res,200,{updates});
    await new Promise(resolve=>{let settled=false;const done=()=>{if(settled)return;settled=true;clearTimeout(wait);waiting.delete(bot.id);resolve();};const wait=setTimeout(done,Math.min(500,deadline-Date.now()));waiting.set(bot.id,done);});
   }
  }finally{res.off('close',abort);waiting.delete(bot.id);db.prepare('UPDATE bots SET poll_lease=NULL,poll_until=0 WHERE id=? AND poll_lease=?').run(bot.id,lease);}
 }
 async function dataHandle(req,res,url){
  const path=url.pathname.replace(/^\/api(?=\/bot\/)/,''),method=req.method;
  const routes={GET:{'/bot/v1/me':null,'/bot/v1/commands':'commands:manage'},PUT:{'/bot/v1/commands':'commands:manage'}};
  if(path==='/bot/v1/updates'&&method==='GET')return poll(req,res,url);
  let bot=authenticate(req,routes[method]?.[path]);rate('api:'+bot.id,600);
  if(path==='/bot/v1/delivery/status'&&method==='GET')return json(res,200,webhooks.status(bot.id));
  if(path==='/bot/v1/delivery/webhook'){
   if(method==='PUT'){const data=await body(req);bot=authenticate(req,'messages:read_events');const validated=await webhooks.configure(bot,data);bot=authenticate(req,'messages:read_events');const result=tx(()=>webhooks.save(bot,validated,false));return json(res,200,{mode:'webhook',webhook_secret:result.secret});}
   if(method==='DELETE'){bot=authenticate(req,'messages:read_events');tx(()=>webhooks.off(bot));res.writeHead(204);return res.end();}
  }
  if(path==='/bot/v1/me'&&method==='GET')return json(res,200,info(bot));
  if(path==='/bot/v1/commands'){
   if(method==='GET')return json(res,200,{commands:JSON.parse(bot.commands)});
   if(method==='PUT'){
    const data=await body(req);bot=authenticate(req,'commands:manage');only(data,['commands']);
    if(!Array.isArray(data.commands)||data.commands.length>100||data.commands.some(c=>!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['command','description'].includes(k))||typeof c.command!=='string'||!/^[a-z0-9_]{1,32}$/.test(c.command)||typeof c.description!=='string'||!c.description.trim()||c.description.length>256)||new Set(data.commands.map(c=>c.command)).size!==data.commands.length)throw fail(400,'INVALID_COMMANDS','Некорректные команды');
    db.prepare('UPDATE bots SET commands=? WHERE id=?').run(JSON.stringify(data.commands),bot.id);for(const chat of db.prepare('SELECT chat_id FROM bot_chat_grants WHERE bot_id=? AND active=1').all(bot.id))broadcast(chat.chat_id,{type:'bot-commands',chat_id:chat.chat_id});res.writeHead(204);return res.end();
   }
  }
  const callbackMatch=path.match(/^\/bot\/v1\/callbacks\/([a-f0-9-]{36})\/answer$/);
  if(callbackMatch&&method==='POST'){const data=await body(req);bot=authenticate(req,'callbacks:answer');const result=interactions.answer(bot,callbackMatch[1],data);if(result)interactions.emit(result);res.writeHead(204);return res.end();}
  const chatMatch=path.match(/^\/bot\/v1\/chats\/(\d+)$/);
  if(chatMatch&&method==='GET'){bot=authenticate(req,'chats:read_basic');const c=access(bot,number(chatMatch[1]));return json(res,200,{id:String(c.id),type:c.kind==='direct'?'private':'group',encryption_mode:c.encryption_mode,effective_permissions:{'messages:send':!!c.can_send&&bot.scopes.includes('messages:send'),'messages:read_events':bot.scopes.includes('messages:read_events'),'groups:read_all':c.visibility==='full_read'&&bot.scopes.includes('groups:read_all')}});}
  if(path==='/bot/v1/messages'&&method==='POST'){
   const data=await body(req);bot=authenticate(req,'messages:send');only(data,['chat_id','type','text','reply_to_message_id','reply_markup']);
   const markup=interactions.markup(data.reply_markup);
   if(data.type!=='text'||typeof data.text!=='string'||!data.text.trim()||data.text.length>4000)throw fail(400,'INVALID_MESSAGE','Текст: от 1 до 4000 символов');
   const chat=number(data.chat_id);rate('send:'+bot.id,60);rate('send-chat:'+bot.id+':'+chat,20);const reply=data.reply_to_message_id==null?null:number(data.reply_to_message_id),key=req.headers['idempotency-key'];
   if(typeof key!=='string'||!/^[a-zA-Z0-9._:-]{16,128}$/.test(key))throw fail(400,'IDEMPOTENCY_KEY_REQUIRED','Нужен Idempotency-Key: 16–128 символов');
   const fingerprint=hash(JSON.stringify({chat_id:chat,type:data.type,text:data.text,reply_to_message_id:reply,...(markup!==undefined?{reply_markup:markup}:{})}));
   const result=tx(()=>{
    const c=access(bot,chat);if(!c.can_send)throw fail(403,'SEND_DENIED','Отправка боту не разрешена');
    const old=db.prepare('SELECT * FROM bot_idempotency WHERE bot_id=? AND key=?').get(bot.id,key);
    if(old&&old.created>Date.now()-86400000){if(old.request_hash!==fingerprint)throw fail(409,'IDEMPOTENCY_CONFLICT','Этот ключ использован с другим запросом');return {response:JSON.parse(old.response_body)};}
    if(old)db.prepare('DELETE FROM bot_idempotency WHERE bot_id=? AND key=?').run(bot.id,key);
    const sent=messaging.insert(chat,bot.account_id,{text:data.text,reply_to:reply,client_id:hash(bot.id+'\0'+key+'\0'+Date.now())});
    interactions.setMarkup(sent.row,bot,markup);
    const response=messageInfo(sent.row);
    db.prepare('INSERT INTO bot_idempotency VALUES(?,?,?,?,?)').run(bot.id,key,fingerprint,JSON.stringify(response),Date.now());return {row:sent.row,response};
   });if(result.row)messaging.publish(result.row);return json(res,201,result.response);
  }
  const messageMatch=path.match(/^\/bot\/v1\/messages\/(\d+)$/);
  if(messageMatch&&['PATCH','DELETE'].includes(method)){
   const data=method==='PATCH'?await body(req):{};bot=authenticate(req,method==='PATCH'?'messages:edit_own':'messages:delete_own');
   if(method==='PATCH'){only(data,['revision','text','reply_markup']);if(!Number.isSafeInteger(data.revision)||data.revision<0||data.text===undefined&&data.reply_markup===undefined||data.text!==undefined&&(typeof data.text!=='string'||!data.text.trim()||data.text.length>4000))throw fail(400,'INVALID_MESSAGE','Нужны текст и текущая revision');}
   const markup=method==='PATCH'?interactions.markup(data.reply_markup):undefined;
   const row=tx(()=>{const old=db.prepare('SELECT * FROM messages WHERE id=?').get(number(messageMatch[1]));if(!old||old.sender_id!==bot.account_id)throw fail(403,'MESSAGE_ACCESS_DENIED','Сообщение недоступно');access(bot,old.chat_id);const changed=method==='PATCH'?messaging.editOwn(old.id,bot.account_id,{...data,text:data.text??old.text}):messaging.deleteOwn(old.id,bot.account_id);if(method==='PATCH')interactions.setMarkup(changed,bot,markup);return changed;});
   messaging.publish(row,'message-update');if(method==='DELETE'){res.writeHead(204);return res.end();}return json(res,200,messageInfo(row));
  }
  throw fail(404,'METHOD_NOT_FOUND','Метод Bot API не найден');
 }
 function messageInfo(row){return {id:String(row.id),chat_id:String(row.chat_id),sender_id:String(row.sender_id),status:'accepted',revision:row.revision,created_at:row.created_at};}
 function createBot(uid,data,atomic=tx){
    const username=canonicalUsername(data.username),problem=usernameProblem(username),name=typeof data.display_name==='string'?data.display_name.trim():'',description=data.description??'',allowed=scopes(data.scopes??defaultScopes);
    if(problem||!name||name.length>128||typeof description!=='string'||description.length>1000)throw fail(400,'INVALID_BOT',problem||'Название: 1–128, описание: до 1000 символов');
    return atomic(()=>{
     if(db.prepare('SELECT COUNT(*) n FROM bots WHERE owner_id=? AND status<>?').get(uid,'deleted').n>=20)throw fail(409,'BOT_LIMIT','Не более 20 ботов');
     const id=randomUUID();let account;
     try{account=db.prepare("INSERT INTO users(username,name,phone,bio,account_type) VALUES(?,?,?,?,'bot')").run(username,name,'bot:'+id,description).lastInsertRowid;}catch(e){if(e.code==='23505')throw fail(409,'USERNAME_TAKEN','Username занят');throw e;}
     db.prepare('INSERT INTO bots(id,account_id,owner_id,created) VALUES(?,?,?,?)').run(id,account,uid,Date.now());audit(id,uid,'bot.create');const bot=get(id);return {bot:info(bot),...issue(bot,uid,allowed)};
    });
 }
 async function developer(req,res,url,uid){
  const path=url.pathname.replace(/^\/api(?=\/developer\/)/,''),method=req.method;
  if(path==='/developer/v1/bots'){
   if(method==='GET')return json(res,200,{bots:db.prepare('SELECT id FROM bots WHERE owner_id=? ORDER BY created,id').all(uid).map(b=>info(get(b.id)))});
   if(method==='POST'){
    const data=await body(req);authorizeOwner(req);only(data,['username','display_name','description','scopes']);
    const result=createBot(uid,data);return json(res,201,result);
   }
  }
  const match=path.match(/^\/developer\/v1\/bots\/([a-f0-9-]{36})(?:\/(tokens|audit)(?:\/([a-f0-9]{32}))?)?$/);
  if(!match)throw fail(404,'METHOD_NOT_FOUND','Метод Developer API не найден');
  let bot=owned(match[1],uid);
  if(match[2]==='audit'&&method==='GET')return json(res,200,{items:db.prepare('SELECT actor_id,action,created FROM bot_audit WHERE bot_id=? ORDER BY id DESC LIMIT 100').all(bot.id)});
  if(match[2]==='tokens'){
   if(method==='GET'&&!match[3])return json(res,200,{tokens:db.prepare('SELECT id,scopes,created,revoked FROM bot_tokens WHERE bot_id=? ORDER BY created DESC LIMIT 100').all(bot.id).map(t=>({...t,scopes:JSON.parse(t.scopes)}))});
   if(method==='POST'&&!match[3]){const data=await body(req);authorizeOwner(req);bot=owned(match[1],uid);only(data,['scopes']);if(bot.status==='deleted')throw fail(409,'BOT_DELETED','Бот удалён');return json(res,201,tx(()=>issue(bot,uid,scopes(data.scopes??JSON.parse(db.prepare('SELECT scopes FROM bot_tokens WHERE bot_id=? ORDER BY created DESC LIMIT 1').get(bot.id)?.scopes||JSON.stringify(defaultScopes))))));}
   if(method==='DELETE'&&match[3]){tx(()=>{const result=db.prepare('UPDATE bot_tokens SET revoked=? WHERE bot_id=? AND id=? RETURNING id').get(Date.now(),bot.id,match[3]);if(!result)throw fail(404,'TOKEN_NOT_FOUND','Токен не найден');audit(bot.id,uid,'token.revoke');});wake(bot.id);res.writeHead(204);return res.end();}
  }
  if(!match[2]){
   if(method==='GET')return json(res,200,info(bot));
   if(method==='PATCH'){
    const data=await body(req);authorizeOwner(req);bot=owned(match[1],uid);only(data,['display_name','description','status']);
    if(bot.status==='deleted')throw fail(409,'BOT_DELETED','Бот удалён');
    const name=data.display_name??bot.display_name,description=data.description??bot.description,status=data.status??bot.status;
    if(typeof name!=='string'||!name.trim()||name.length>128||typeof description!=='string'||description.length>1000||!['active','suspended','deleted'].includes(status))throw fail(400,'INVALID_BOT','Некорректные настройки бота');
    tx(()=>{db.prepare('UPDATE users SET name=?,bio=? WHERE id=?').run(name.trim(),description,bot.account_id);db.prepare('UPDATE bots SET status=? WHERE id=?').run(status,bot.id);if(status==='deleted'){db.prepare('UPDATE bot_tokens SET revoked=? WHERE bot_id=? AND revoked IS NULL').run(Date.now(),bot.id);db.prepare('UPDATE bot_chat_grants SET active=0,version=version+1 WHERE bot_id=?').run(bot.id);}audit(bot.id,uid,'bot.update');});wake(bot.id);return json(res,200,info(get(bot.id)));
   }
  }
  throw fail(404,'METHOD_NOT_FOUND','Метод Developer API не найден');
 }
 async function userHandle(req,res,url,uid){
  if(url.pathname==='/api/bots/interactions'&&req.method==='POST'){const data=await body(req);authorizeOwner(req);rate('interaction:'+uid,60);const result=interactions.create(uid,data);interactions.emit(result);json(res,200,result.response);return true;}
  const interaction=url.pathname.match(/^\/api\/bots\/interactions\/([a-f0-9-]{36})$/);
  if(interaction&&req.method==='GET'){json(res,200,interactions.getStatus(interaction[1],uid));return true;}
  const commands=url.pathname.match(/^\/api\/chats\/(\d+)\/bot-commands$/);
  if(commands&&req.method==='GET'){json(res,200,{bots:interactions.commands(number(commands[1]),uid)});return true;}
  if(url.pathname==='/api/bots/manager'&&req.method==='POST'){await body(req);authorizeOwner(req);const chat=privateChat(uid,father.accountId,true);const welcome=tx(()=>{if(db.prepare('SELECT 1 FROM messages WHERE chat_id=? AND sender_id=?').get(chat.id,father.accountId))return null;const row=messaging.insert(chat.id,father.accountId,{text:father.help,client_id:randomUUID()}).row;interactions.setMarkup(row,get(father.id),interactions.markup(father.markup));return row;});if(welcome)messaging.publish(welcome);json(res,200,{...chat,username:father.username});return true;}
  if(url.pathname==='/api/bots/resolve'&&req.method==='GET'){const row=db.prepare('SELECT b.id FROM bots b JOIN users u ON u.id=b.account_id WHERE u.username_normalized=?').get(canonicalUsername(url.searchParams.get('username')));const bot=available(row&&get(row.id));json(res,200,info(bot));return true;}
  const match=url.pathname.match(/^\/api\/bots\/([a-f0-9-]{36})\/(start|block)$/);
  if(match&&req.method==='POST'){
   await body(req);authorizeOwner(req);const bot=get(match[1]);if(!bot)throw fail(404,'BOT_NOT_FOUND','Бот не найден');
   if(match[2]==='start'){json(res,200,privateChat(uid,bot.account_id,true));return true;}
   const pair=[uid,bot.account_id].sort((a,b)=>a-b).join(':'),chat=db.prepare('SELECT * FROM chats WHERE pair=?').get(pair);
   if(!chat)throw fail(404,'CHAT_NOT_FOUND','Диалог не найден');member(chat.id,uid);
   tx(()=>{db.prepare('UPDATE bot_chat_grants SET active=0,version=version+1 WHERE bot_id=? AND chat_id=?').run(bot.id,chat.id);audit(bot.id,uid,'chat.block');});wake(bot.id);broadcast(chat.id,{type:'chats'});json(res,200,{blocked:true});return true;
  }
  const group=url.pathname.match(/^\/api\/chats\/(\d+)\/bots(?:\/([a-f0-9-]{36}))?$/);
  if(!group)return false;const chat=number(group[1]);member(chat,uid);
  if(req.method==='GET'&&!group[2]){json(res,200,{bots:db.prepare('SELECT b.id,g.visibility,g.can_send,g.active FROM bots b JOIN bot_chat_grants g ON g.bot_id=b.id JOIN members m ON m.user_id=b.account_id AND m.chat_id=g.chat_id WHERE g.chat_id=?').all(chat).map(row=>({bot:info(get(row.id)),visibility:row.visibility,can_send:!!row.can_send,active:!!row.active}))});return true;}
  const data=await body(req);authorizeOwner(req);const c=db.prepare('SELECT c.*,m.role FROM chats c JOIN members m ON m.chat_id=c.id WHERE c.id=? AND m.user_id=?').get(chat,uid);
  if(!['owner','admin'].includes(c.role)||c.kind!=='group'||c.parent_id)throw fail(403,'GROUP_ADMIN_REQUIRED','Нужны права администратора основной группы');
  if(c.encryption_mode!=='server_readable')throw fail(409,'E2EE_BOT_UNSUPPORTED','Боты недоступны в E2EE-чатах');
  const bot=get(group[2]);if(!bot)throw fail(404,'BOT_NOT_FOUND','Бот не найден');
  if(req.method==='PUT'){
   if(bot.account_id===father.accountId)throw fail(403,'SYSTEM_BOT','Главный бот доступен только в личном чате');
   available(bot);
   only(data,['visibility','can_send']);if(data.visibility!==undefined&&!['restricted','full_read'].includes(data.visibility)||data.can_send!==undefined&&typeof data.can_send!=='boolean')throw fail(400,'INVALID_GRANT','Некорректные разрешения');
   tx(()=>{if(db.prepare('SELECT 1 FROM community_bans WHERE chat_id=? AND user_id=?').get(chat,bot.account_id))throw fail(403,'BOT_BANNED','Бот заблокирован в группе');if(!db.prepare('SELECT 1 FROM members WHERE chat_id=? AND user_id=?').get(chat,bot.account_id)&&db.prepare('SELECT COUNT(*) n FROM members WHERE chat_id=?').get(chat).n>=300)throw fail(409,'GROUP_FULL','Группа заполнена');db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)').run(chat,bot.account_id);grant(bot,chat,uid,data);});
  }else if(req.method==='DELETE'){tx(()=>{db.prepare('UPDATE bot_chat_grants SET active=0,version=version+1 WHERE bot_id=? AND chat_id=?').run(bot.id,chat);db.prepare('DELETE FROM members WHERE chat_id=? AND user_id=?').run(chat,bot.account_id);audit(bot.id,uid,'chat.revoke');});wake(bot.id);}else return false;
  broadcast(chat,{type:'community',chat_id:chat});json(res,200,{ok:true});return true;
 }
 return {
  privateChat,drain:tick,webhooks,buttons:interactions.buttons,
  checkHumanSend(chat,uid){const bot=db.prepare("SELECT b.id FROM bots b JOIN members m ON m.user_id=b.account_id WHERE m.chat_id=? AND b.account_id<>? AND (SELECT kind FROM chats WHERE id=?)='direct'").get(chat,uid,chat);if(bot){const row=db.prepare('SELECT active FROM bot_chat_grants WHERE bot_id=? AND chat_id=?').get(bot.id,chat);if(!row?.active)throw fail(403,'BOT_BLOCKED','Сначала разблокируйте бота');available(get(bot.id));}},
  async handle(req,res,url,uid){
   const botPath=/^\/(?:api\/)?bot\/v1(?:\/|$)/.test(url.pathname),devPath=/^\/(?:api\/)?developer\/v1(?:\/|$)/.test(url.pathname);
   if(!botPath&&!devPath)return userHandle(req,res,url,uid);
   try{rate('ip:'+String(process.env.AUTH_TRUST_PROXY==='1'?req.headers['x-real-ip']||req.socket.remoteAddress:req.socket.remoteAddress).slice(0,100),1200);if(readAdminSettings(db).maintenance)throw fail(503,'MAINTENANCE','Сервер на обслуживании');if(botPath)await dataHandle(req,res,url);else await developer(req,res,url,uid);}
   catch(e){if(!e.status)console.error('[bots] request failed',e.code||'internal');if(!res.headersSent&&!res.destroyed){if(e.status===429)res.setHeader('Retry-After','60');res.setHeader('X-Request-ID',req.botRequestId||'');json(res,e.status||500,{error:{code:e.code||(e.status?'REQUEST_FAILED':'INTERNAL_ERROR'),message:e.status?e.message:'Ошибка сервера',request_id:req.botRequestId,retryable:!e.status||e.status>=500||e.status===429}});}}
   return true;
  },
  close(){closed=true;clearInterval(timer);clearInterval(retention);for(const done of waiting.values())done();waiting.clear();return webhooks.close();}
 };
}
