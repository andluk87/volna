import {topicNotification} from './topics.mjs';
import webpush from 'web-push';
import {createHash,ECDH} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=s=>createHash('sha256').update(s).digest('hex');
export function validateEndpoint(value){
 if(typeof value!=='string'||value.length>2048)throw fail(400,'Некорректная push-подписка');
 let url;try{url=new URL(value);}catch{throw fail(400,'Некорректный адрес push');}
 const h=url.hostname;const allowed=h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h.endsWith('.push.services.mozilla.com')||h==='web.push.apple.com'||h.endsWith('.push.apple.com');
 if(url.protocol!=='https:'||!allowed||url.port||url.username||url.password||url.hash)throw fail(400,'Этот push-провайдер не поддерживается');return url.href;
}
export function notifications({db,auth,body,json,contactDisplay=(uid,id,name)=>name,sender=webpush.sendNotification.bind(webpush),subject=process.env.VAPID_SUBJECT||'https://volna.lknet.ru'}){
 db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE IF NOT EXISTS push_keys(id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,private_key TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,subscription TEXT NOT NULL,preview INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS push_jobs(id INTEGER PRIMARY KEY,subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,topic TEXT NOT NULL,chat_id INTEGER NOT NULL,kind TEXT NOT NULL,message_id INTEGER,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,UNIQUE(subscription_id,topic));
 CREATE INDEX IF NOT EXISTS push_jobs_due ON push_jobs(next_at);
 COMMIT;`);
 // Call state is volatile; never replay incoming calls after an API restart.
 db.prepare("DELETE FROM push_jobs WHERE kind='call'").run();
 let keys=db.prepare('SELECT * FROM push_keys WHERE id=1').get();
 if(!keys){const k=webpush.generateVAPIDKeys();db.prepare('INSERT INTO push_keys VALUES(1,?,?)').run(k.publicKey,k.privateKey);keys=db.prepare('SELECT * FROM push_keys WHERE id=1').get();}
 if(db.prepare('PRAGMA user_version').get().user_version<5)db.exec('PRAGMA user_version=5');
 let closed=false,inflight=null;
 const remove=id=>db.prepare('DELETE FROM push_jobs WHERE id=?').run(id);
 function enqueue(users,chat,kind,messageId,topic,expires){
  if(closed)return;const now=Date.now();
  const add=db.prepare(`INSERT INTO push_jobs(subscription_id,topic,chat_id,kind,message_id,expires,next_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(subscription_id,topic) DO UPDATE SET message_id=excluded.message_id,expires=excluded.expires,next_at=excluded.next_at,attempts=0`);
  for(const uid of new Set(users))for(const sub of db.prepare('SELECT p.id FROM push_subscriptions p JOIN sessions s ON s.token=p.session_token WHERE p.user_id=? AND s.expires>?').all(uid,now))add.run(sub.id,topic,chat,kind,messageId,expires,now+(kind==='message'?1500:0));
 }
 function message(chat,m){const users=db.prepare('SELECT m.user_id FROM members m LEFT JOIN chat_preferences p ON p.chat_id=m.chat_id AND p.user_id=m.user_id WHERE m.chat_id=? AND m.user_id<>? AND COALESCE(p.muted,0)=0').all(chat,m.sender_id).map(r=>r.user_id).filter(uid=>topicNotification(db,chat,uid,m.text));enqueue(users,chat,'message',m.id,'chat-'+chat,Date.now()+24*3600000);}
 function call(c){enqueue([c.callee],c.chat,'call',null,'call-'+c.id,c.created+60000);}
 async function deliver(job){
  if(closed)return;const row=db.prepare('SELECT p.*,s.expires AS session_expires FROM push_subscriptions p JOIN sessions s ON s.token=p.session_token WHERE p.id=?').get(job.subscription_id);
  const member=row&&db.prepare('SELECT last_read FROM members WHERE chat_id=? AND user_id=?').get(job.chat_id,row.user_id);
  if(!row||row.session_expires<=Date.now()||job.expires<=Date.now()||!member){remove(job.id);return;}
  if(job.kind==='message'&&db.prepare('SELECT muted FROM chat_preferences WHERE user_id=? AND chat_id=?').get(row.user_id,job.chat_id)?.muted){remove(job.id);return;}
  let title='Волна',text=job.kind==='call'?'Входящий аудиозвонок. Откройте Волну, чтобы ответить.':'Новое сообщение';
  if(job.kind==='message'){
   const m=db.prepare('SELECT m.*,u.name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=? AND m.chat_id=?').get(job.message_id,job.chat_id);
   if(!m||m.deleted_at||member.last_read>=m.id||!topicNotification(db,job.chat_id,row.user_id,m.text)){remove(job.id);return;}
   if(row.preview){const chat=db.prepare(`SELECT c.kind,CASE WHEN c.parent_id IS NOT NULL THEN (SELECT title FROM chats WHERE id=c.parent_id)||' › '||c.title ELSE c.title END AS title FROM chats c WHERE c.id=?`).get(job.chat_id);title=chat.kind==='direct'?contactDisplay(row.user_id,m.sender_id,m.name):chat.title;text=m.text?.slice(0,160)||'Новое вложение';}
  }
  try{
   await sender(JSON.parse(row.subscription),JSON.stringify({title,body:text,tag:job.topic,chat_id:job.chat_id,expires:job.expires,kind:job.kind}),{vapidDetails:{subject,publicKey:keys.public_key,privateKey:keys.private_key},TTL:Math.max(1,Math.floor((job.expires-Date.now())/1000)),urgency:'high',topic:hash(job.topic).slice(0,32),timeout:10000});
   if(!closed)db.prepare('DELETE FROM push_jobs WHERE id=? AND message_id IS ? AND expires=?').run(job.id,job.message_id,job.expires);
  }catch(e){if(closed)return;if(e.statusCode===404||e.statusCode===410)db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(row.id);else if(job.attempts>=5)remove(job.id);else db.prepare('UPDATE push_jobs SET attempts=attempts+1,next_at=? WHERE id=? AND message_id IS ?').run(Date.now()+Math.min(300000,5000*2**job.attempts),job.id,job.message_id);}
 }
 function drain(){if(closed)return Promise.resolve();if(inflight)return inflight;inflight=(async()=>{db.prepare('DELETE FROM push_jobs WHERE expires<=?').run(Date.now());const jobs=db.prepare('SELECT * FROM push_jobs WHERE next_at<=? ORDER BY next_at LIMIT 16').all(Date.now());for(let i=0;i<jobs.length&&!closed;i+=4)await Promise.all(jobs.slice(i,i+4).map(deliver));})().finally(()=>{inflight=null;});return inflight;}
 const timer=setInterval(()=>drain().catch(()=>console.error('Push queue processing failed')),1000);timer.unref();
 async function handle(req,res,url,uid){
  if(url.pathname==='/api/push/config'&&req.method==='GET'){json(res,200,{publicKey:keys.public_key});return true;}
  if(!['/api/push/subscribe','/api/push/unsubscribe','/api/push/status'].includes(url.pathname)||req.method!=='POST')return false;
  const data=await body(req),session=auth(req);const endpoint=validateEndpoint(data.subscription?.endpoint||data.endpoint),id=hash(endpoint);const existing=db.prepare('SELECT * FROM push_subscriptions WHERE id=?').get(id);
  if(url.pathname==='/api/push/status'){json(res,200,{subscribed:existing?.user_id===uid&&existing.session_token===session.token,preview:existing?.user_id===uid?!!existing.preview:false});return true;}
  if(url.pathname==='/api/push/unsubscribe'){db.prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').run(id,uid);json(res,200,{ok:true});return true;}
  if(existing&&existing.user_id!==uid)throw fail(409,'Подписка другого аккаунта: выключите и включите уведомления заново');
  const sub=data.subscription;
  for(const [key,size] of [['p256dh',65],['auth',16]])if(typeof sub?.keys?.[key]!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(sub.keys[key])||Buffer.from(sub.keys[key],'base64url').length!==size)throw fail(400,'Некорректные ключи push-подписки');
  try{ECDH.convertKey(Buffer.from(sub.keys.p256dh,'base64url'),'prime256v1');}catch{throw fail(400,'Некорректный открытый ключ подписки');}
  if(!existing&&db.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id=?').get(uid).n>=12)throw fail(400,'Лимит 12 устройств для уведомлений');
  const clean={endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}};
  db.prepare(`INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET session_token=excluded.session_token,subscription=excluded.subscription,preview=excluded.preview`).run(id,uid,session.token,JSON.stringify(clean),data.preview===true?1:0,Date.now());
  json(res,200,{subscribed:true,preview:data.preview===true});return true;
 }
 return {handle,message,call,endCall:id=>db.prepare("DELETE FROM push_jobs WHERE topic=? AND kind='call'").run('call-'+id),drain,close:async()=>{closed=true;clearInterval(timer);await inflight;}};
}
