import {randomBytes,randomUUID,createCipheriv,createDecipheriv,createHmac} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {webhookUrl,egressClient} from './webhook-egress.mjs';
const types=['message.created','message.edited','message.deleted','callback.created'];
const problem=(status,code)=>Object.assign(Error(code),{status,code});
export function signature(secret,timestamp,body){return 'sha256='+createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');}
export function secretBox(key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Webhook encryption key must contain 32 bytes');
 return {seal(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');},open(value){const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');}};
}
export function botWebhooks({db,tx,get,access,wake,audit,deliverable,masterReply,masterId,egress,keyPath,key,paused=()=>false,now=Date.now,random=Math.random}){
 db.exec(`CREATE TABLE IF NOT EXISTS bot_webhooks(bot_id TEXT PRIMARY KEY REFERENCES bots(id),generation TEXT NOT NULL,url TEXT NOT NULL,secret TEXT NOT NULL,event_types TEXT NOT NULL,enabled BIGINT NOT NULL DEFAULT 0,pending BIGINT NOT NULL DEFAULT 0,failures BIGINT NOT NULL DEFAULT 0,next_attempt BIGINT NOT NULL DEFAULT 0,last_status BIGINT,last_error TEXT,updated BIGINT NOT NULL);
 CREATE TABLE IF NOT EXISTS bot_delivery_attempts(bot_id TEXT NOT NULL REFERENCES bots(id),update_id BIGINT NOT NULL,generation TEXT NOT NULL,attempts BIGINT NOT NULL DEFAULT 0,next_attempt BIGINT NOT NULL DEFAULT 0,last_status BIGINT,last_error TEXT,finished BIGINT NOT NULL DEFAULT 0,updated BIGINT NOT NULL,PRIMARY KEY(bot_id,update_id,generation));
 CREATE INDEX IF NOT EXISTS bot_delivery_retention ON bot_delivery_attempts(updated);`);
 const send=egress||(process.env.WEBHOOK_EGRESS_SOCKET?egressClient(process.env.WEBHOOK_EGRESS_SOCKET):null);
 let box;
 function secrets(){
  if(box)return box;
  if(!key){if(!keyPath)throw problem(503,'WEBHOOK_KEY_UNCONFIGURED');mkdirSync(dirname(keyPath),{recursive:true});try{writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}key=readFileSync(keyPath);}
  return box=secretBox(key);
 }
 function validate(data){
  if(!data||Object.keys(data).some(k=>!['url','event_types'].includes(k)))throw problem(400,'INVALID_WEBHOOK');
  try{webhookUrl(data.url);}catch{throw problem(400,'INVALID_WEBHOOK_URL');}
  const events=data.event_types??types;
  if(!Array.isArray(events)||!events.length||events.length>types.length||new Set(events).size!==events.length||events.some(t=>!types.includes(t)))throw problem(400,'INVALID_EVENT_TYPES');
  if(!send)throw problem(503,'WEBHOOK_EGRESS_UNCONFIGURED');
  return {url:data.url,event_types:events};
 }
 const config=id=>db.prepare('SELECT * FROM bot_webhooks WHERE bot_id=?').get(id);
 const enabled=id=>!!config(id)?.enabled;
 function save(bot,data,pending){
  if(bot.id===masterId)throw problem(403,'SYSTEM_BOT');
  const secret=randomBytes(32).toString('base64url'),sealed=secrets().seal(secret),generation=randomUUID();
  db.prepare(`INSERT INTO bot_webhooks(bot_id,generation,url,secret,event_types,enabled,pending,updated) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(bot_id) DO UPDATE SET generation=excluded.generation,url=excluded.url,secret=excluded.secret,event_types=excluded.event_types,enabled=excluded.enabled,pending=excluded.pending,failures=0,next_attempt=0,last_status=NULL,last_error=NULL,updated=excluded.updated`).run(bot.id,generation,data.url,sealed,JSON.stringify(data.event_types),+!pending,+pending,now());
  // A pending configuration leaves polling available until DNS validation succeeds.
  if(!pending)db.prepare('UPDATE bots SET poll_lease=NULL,poll_until=0 WHERE id=?').run(bot.id);
  audit(bot.id,bot.owner_id,pending?'webhook.request':'webhook.enable');wake(bot.id);
  return {secret,generation};
 }
 async function configure(bot,data){
  data=validate(data);secrets();
  try{const result=await send({op:'validate',url:data.url});if(!result.ok)throw Error();}catch{throw problem(400,'WEBHOOK_ADDRESS_DENIED');}
  return data;
 }
 function off(bot){db.prepare('DELETE FROM bot_webhooks WHERE bot_id=?').run(bot.id);audit(bot.id,bot.owner_id,'webhook.disable');wake(bot.id);}
 function status(id){const c=config(id);return {mode:c?.enabled?'webhook':'polling',pending:!!c?.pending,...(c?{url:c.url,event_types:JSON.parse(c.event_types),failures:c.failures,next_attempt:c.next_attempt,last_status:c.last_status,last_error:c.last_error}:{}),recent_attempts:db.prepare('SELECT update_id,attempts,last_status,last_error,finished,updated FROM bot_delivery_attempts WHERE bot_id=? ORDER BY updated DESC LIMIT 10').all(id),pending_updates:db.prepare('SELECT COUNT(*) n FROM bot_updates WHERE bot_id=? AND acked=0 AND expires>?').get(id,now()).n};}
 function ownerCommand(bot,value,chat){
  if(value==='off'){off(bot);return 'Webhook отключён. Включён polling.';}
  if(!value||value==='status'){const s=status(bot.id);return `Доставка @${bot.username}: ${s.mode}${s.pending?' (проверяется новый URL)':''}.\nСобытий в очереди: ${s.pending_updates}.\nОшибок подряд: ${s.failures||0}.`+(s.url?'\nURL: '+s.url:'')+(s.last_error?'\nПоследняя ошибка: '+s.last_error:'');}
  const data=validate({url:value});
  // Store the origin chat for an atomic owner-only reply after asynchronous validation.
  save(bot,data,true);db.prepare('UPDATE bot_webhooks SET reply_chat=? WHERE bot_id=?').run(chat,bot.id);
  return 'Проверяю адрес webhook. После проверки пришлю результат и отдельный секрет подписи в этот чат. Он сохранится в истории.';
 }
 if(!db.columns('bot_webhooks').some(c=>c.name==='reply_chat'))db.exec('ALTER TABLE bot_webhooks ADD COLUMN reply_chat BIGINT');
 let closed=false;const busy=new Set(),inflight=new Set();
 const current=(c)=>{const fresh=config(c.bot_id);return fresh&&fresh.generation===c.generation?fresh:null;};
 function usable(bot,row){
  if(!bot||bot.status!=='active'||bot.admin_blocked||bot.owner_blocked)return false;
  const credentials=db.prepare('SELECT scopes FROM bot_tokens WHERE bot_id=? AND revoked IS NULL').all(bot.id);
  const scopes=[...new Set(credentials.flatMap(c=>JSON.parse(c.scopes)))];
  if(!scopes.includes('messages:read_events'))return false;
  try{const chat=access(bot,row.chat_id),value=JSON.parse(row.payload);return chat.version===row.grant_version&&(row.restricted_allowed||chat.kind==='direct'||chat.visibility==='full_read'&&scopes.includes('groups:read_all'))&&(value.event_type!=='callback.created'||deliverable(value));}catch(e){if(e.status)return false;throw e;}
 }
 async function deliverBot(c){
  const bot=get(c.bot_id);
  if(!bot||bot.status!=='active'||bot.admin_blocked||bot.owner_blocked)return;
  if(c.pending){
   let valid=false;try{valid=(await send({op:'validate',url:c.url})).ok;}catch{}
   if(closed||paused()||!current(c))return;
   const freshBot=get(c.bot_id);if(!freshBot||freshBot.status!=='active'||freshBot.admin_blocked||freshBot.owner_blocked)return;
   let reply;
   tx(()=>{
    if(valid){db.prepare('UPDATE bot_webhooks SET enabled=1,pending=0,last_error=NULL WHERE bot_id=? AND generation=?').run(c.bot_id,c.generation);db.prepare('UPDATE bots SET poll_lease=NULL,poll_until=0 WHERE id=?').run(c.bot_id);audit(bot.id,bot.owner_id,'webhook.enable');reply=masterReply(c.reply_chat,`Webhook @${bot.username} включён. Polling отключён.\nСекрет подписи (храните в секрете):\n${secrets().open(c.secret)}\n\nАлгоритм: HMAC-SHA256(timestamp + "." + raw body). Секрет сохранён в истории этого личного чата.`);}
    else{db.prepare("UPDATE bot_webhooks SET pending=0,enabled=0,last_error='ADDRESS_VALIDATION_FAILED',secret='' WHERE bot_id=? AND generation=?").run(c.bot_id,c.generation);reply=masterReply(c.reply_chat,'Адрес webhook не прошёл проверку. Проверьте публичный HTTPS, DNS и доступность сервиса доставки. Polling доступен.');}
   });reply?.();wake(c.bot_id);return;
  }
  if(!c.enabled||c.next_attempt>now())return;
  const subscribed=JSON.parse(c.event_types),rows=db.prepare('SELECT * FROM bot_updates WHERE bot_id=? AND acked=0 AND expires>? AND event_type IN ('+subscribed.map(()=>'?').join(',')+') ORDER BY update_id LIMIT 100').all(c.bot_id,now(),...subscribed);
  const activeScopes=db.prepare('SELECT scopes FROM bot_tokens WHERE bot_id=? AND revoked IS NULL').all(bot.id).flatMap(t=>JSON.parse(t.scopes));if(!activeScopes.includes('messages:read_events'))return;
  let row;
  for(const candidate of rows){
   if(!usable(bot,candidate)){// Suspension/credential revocation pauses rather than deletes queued data.
    if(!db.prepare('SELECT 1 FROM bot_tokens WHERE bot_id=? AND revoked IS NULL').get(bot.id))return;
    db.prepare('UPDATE bot_updates SET acked=1 WHERE bot_id=? AND update_id=?').run(bot.id,candidate.update_id);continue;
   }
   if(!JSON.parse(c.event_types).includes(candidate.event_type))continue;
   const attempt=db.prepare('SELECT * FROM bot_delivery_attempts WHERE bot_id=? AND update_id=? AND generation=?').get(bot.id,candidate.update_id,c.generation);
   if(attempt?.next_attempt>now())continue;row=candidate;break;
  }
  if(!row)return;
  const timestamp=String(Math.floor(now()/1000));let result;
  // Persist the attempt before network I/O. A crash retries the same immutable event_id.
  db.prepare('INSERT INTO bot_delivery_attempts(bot_id,update_id,generation,attempts,next_attempt,updated) VALUES(?,?,?,1,?,?) ON CONFLICT(bot_id,update_id,generation) DO UPDATE SET attempts=bot_delivery_attempts.attempts+1,next_attempt=excluded.next_attempt,updated=excluded.updated').run(bot.id,row.update_id,c.generation,now()+10000,now());
  try{result=await send({op:'deliver',url:c.url,body:row.payload,event_id:row.event_id,timestamp,signature:signature(secrets().open(c.secret),timestamp,row.payload)});}catch{result={ok:false,error:'NETWORK_OR_POLICY_ERROR'};}
  if(closed||!current(c)?.enabled)return;
  const ok=result.ok&&result.status>=200&&result.status<300,failures=ok?0:c.failures+1,delay=ok?0:Math.floor(Math.min(300000,Math.max(failures>=5?60000:0,1000*2**Math.min(failures-1,9)))*(0.75+random()*0.5)),next=now()+delay;
  tx(()=>{
   if(ok)db.prepare('UPDATE bot_updates SET acked=1 WHERE bot_id=? AND update_id=?').run(bot.id,row.update_id);
   db.prepare('UPDATE bot_delivery_attempts SET next_attempt=?,last_status=?,last_error=?,finished=?,updated=? WHERE bot_id=? AND update_id=? AND generation=?').run(next,result.status||null,ok?null:result.error||'HTTP_NON_2XX',+ok,now(),bot.id,row.update_id,c.generation);
   db.prepare('UPDATE bot_webhooks SET failures=?,next_attempt=?,last_status=?,last_error=? WHERE bot_id=? AND generation=?').run(failures,next,result.status||null,ok?null:result.error||'HTTP_NON_2XX',bot.id,c.generation);
  });
 }
 function tick(){
  if(closed||!send||paused())return;
  // One API process; one concurrent delivery per bot, max four globally. Retry state survives restart.
  for(const c of db.prepare('SELECT * FROM bot_webhooks w WHERE (pending=1 OR enabled=1 AND EXISTS(SELECT 1 FROM bot_updates u WHERE u.bot_id=w.bot_id AND u.acked=0 AND u.expires>?)) AND next_attempt<=? ORDER BY next_attempt,updated LIMIT 100').all(now(),now())){
   if(busy.size>=4)break;if(busy.has(c.bot_id))continue;busy.add(c.bot_id);
   const task=deliverBot(c).catch(()=>console.error('[bots] webhook worker failed; queue retained')).finally(()=>{busy.delete(c.bot_id);inflight.delete(task);});inflight.add(task);
  }
 }
 const timer=setInterval(tick,500);timer.unref();
 return {enabled,configure,save,off,status,ownerCommand,tick,async idle(){await Promise.all([...inflight]);},cleanup(){db.prepare("UPDATE bot_delivery_attempts SET finished=2,last_error='UPDATE_EXPIRED' WHERE finished=0 AND EXISTS(SELECT 1 FROM bot_updates u WHERE u.bot_id=bot_delivery_attempts.bot_id AND u.update_id=bot_delivery_attempts.update_id AND u.acked=0 AND u.expires<=?)").run(now());db.prepare('DELETE FROM bot_delivery_attempts WHERE updated<?').run(now()-7*86400000);},close(){closed=true;clearInterval(timer);return Promise.allSettled([...inflight]);}};
}
