import http from 'node:http';
import {randomBytes,createHash,createHmac,randomInt,timingSafeEqual} from 'node:crypto';
import {readFileSync,mkdirSync,statSync,statfsSync,createReadStream,readdirSync,linkSync,chmodSync,existsSync,rmSync} from 'node:fs';
import {rm,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {notificoreSender,normalizePhone} from './phone-auth.mjs';
import {ADMIN_PHONE,initAdminSchema,readAdminSettings,validateAdminSettings} from './admin-config.mjs';
import {canonicalUsername,usernameProblem,availablePhoneUsername} from './usernames.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const secret=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const run=promisify(execFile);
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version;
const staticRoot=fileURLToPath(new URL('./admin-ui/',import.meta.url));
const text=(value,max=500)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw fail(400,`Введите текст от 1 до ${max} символов`);return value.trim();};
const numeric=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw fail(400,'Некорректный идентификатор');return n;};
const boolean=value=>{if(typeof value!=='boolean')throw fail(400,'Ожидается переключатель');return value;};
const opaque=(value,length=32)=>{if(typeof value!=='string'||!new RegExp(`^[a-f0-9]{${length}}$`).test(value))throw fail(400,'Некорректный идентификатор');return value;};
export function createAdminServer({db,uploads,json,body,publish,broadcast,hydrate,userById,disconnectUser,cleanupFiles,callService,
 adminPhone=process.env.ADMIN_PHONE||ADMIN_PHONE,origin=process.env.ADMIN_PUBLIC_URL||(process.env.CHAT_DOMAIN?`https://${process.env.CHAT_DOMAIN}:8998`:'http://localhost:8998'),
 sender=notificoreSender(),smsReady=!!(process.env.NOTIFICORE_API_KEY&&process.env.NOTIFICORE_ORIGINATOR),clock=Date.now,
 codeGenerator=()=>String(randomInt(0,1000000)).padStart(6,'0'),trustProxy=process.env.AUTH_TRUST_PROXY==='1',cookieSecure=new URL(origin).protocol==='https:',
 serviceStatus=async()=>{const url=new URL(process.env.WHISPER_URL||'http://transcription:8000/transcribe');url.pathname='/health';const r=await fetch(url,{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error();const v=await r.json();return {available:true,ready:!!v.ready,state:String(v.state||'unknown').slice(0,30),model:String(v.model||'').slice(0,40)};}}){
 initAdminSchema(db);adminPhone=normalizePhone(adminPhone);origin=new URL(origin).origin;
 const priorPhone=db.prepare("SELECT value FROM admin_meta WHERE key='admin-phone'").get()?.value;
 if(priorPhone&&priorPhone!==adminPhone){db.exec('DELETE FROM admin_sessions; DELETE FROM admin_sms;');}
 db.prepare("INSERT INTO admin_meta VALUES('admin-phone',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(adminPhone);
 db.prepare('INSERT OR IGNORE INTO admin_meta VALUES(?,?)').run('hmac',secret());
 const key=db.prepare("SELECT value FROM admin_meta WHERE key='hmac'").get().value;
 const mac=value=>createHmac('sha256',key).update(value).digest('hex');
 const csrf=token=>mac('csrf:'+token);
 const ip=req=>String(trustProxy?req.headers['x-real-ip']||req.socket.remoteAddress:req.socket.remoteAddress||'unknown').slice(0,100);
 const buckets=new Map();let makingBackup=false,backupTask=null;
 const audit=(action,target='system',reason='',details={},actor=adminPhone)=>db.prepare('INSERT INTO admin_audit(created,actor,action,target,reason,details) VALUES(?,?,?,?,?,?)').run(clock(),actor,action,String(target).slice(0,100),reason,JSON.stringify(details));
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const cookie=(res,value,maxAge=28800)=>res.setHeader('Set-Cookie',`volna.admin=${value}; HttpOnly; ${cookieSecure?'Secure; ':''}SameSite=Strict; Path=/; Max-Age=${maxAge}`);
 function authenticate(req){
  const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('volna.admin='))?.slice(12);
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))throw fail(401,'Войдите в панель по SMS');
  const row=db.prepare('SELECT id,created,expires,last_seen,agent,ip FROM admin_sessions WHERE token_hash=? AND expires>?').get(hash(token),clock());
  if(!row)throw fail(401,'Сеанс администратора завершён');
  if(req.method!=='GET'&&req.method!=='HEAD'){
   const expected=csrf(token),provided=String(req.headers['x-admin-csrf']||'');
   if(provided.length!==expected.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))throw fail(403,'Обновите панель: проверка запроса не пройдена');
  }
  db.prepare('UPDATE admin_sessions SET last_seen=? WHERE id=?').run(clock(),row.id);return {...row,csrf_token:csrf(token)};
 }
 const requireConfirm=(data,id)=>{if(data.confirm!==String(id))throw fail(400,'Подтвердите действие в панели');};
 const revokeUser=uid=>{db.prepare('DELETE FROM sessions WHERE user_id=?').run(uid);db.prepare('DELETE FROM qr_challenges WHERE user_id=?').run(uid);disconnectUser(uid);for(const c of callService.list())if(c.caller===uid||c.callee===uid)callService.terminate(c.id);};
 const protectedUser=uid=>{const row=db.prepare('SELECT * FROM users WHERE id=?').get(uid);if(!row)throw fail(404,'Пользователь не найден');if(row.phone===adminPhone)throw fail(403,'Основного администратора нельзя заблокировать или обезличить');return row;};
 const notifyProfile=uid=>publish([...new Set([uid,...db.prepare('SELECT DISTINCT b.user_id FROM members a JOIN members b ON a.chat_id=b.chat_id WHERE a.user_id=?').all(uid).map(r=>r.user_id)])],{type:'profile',user_id:uid});
 const notifyChat=chat=>broadcast(chat,{type:'community',chat_id:chat});
 const removeMessage=(id,reason)=>{const row=db.prepare('SELECT * FROM messages WHERE id=?').get(id);if(!row)throw fail(404,'Сообщение не найдено');transaction(()=>{db.prepare("UPDATE messages SET text='',transcript=NULL,interactive=NULL,deleted_at=? WHERE id=?").run(new Date(clock()).toISOString(),id);db.prepare('DELETE FROM message_emoji WHERE message_id=?').run(id);db.prepare('DELETE FROM reactions WHERE message_id=?').run(id);db.prepare('DELETE FROM pins WHERE message_id=?').run(id);audit('message.delete',id,reason,{chat_id:row.chat_id});});broadcast(row.chat_id,{type:'message-update',message:hydrate(db.prepare('SELECT * FROM messages WHERE id=?').get(id))});};
 const fileResponse=(res,path,name)=>{let size;try{size=statSync(path).size;}catch{throw fail(404,'Файл отсутствует в хранилище');}res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Content-Length':size});createReadStream(path).on('error',()=>res.destroy()).pipe(res);};
 const page=url=>{const n=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(n)||n<1||n>100000)throw fail(400,'Некорректная страница');return {page:n,limit:30,offset:(n-1)*30,q:String(url.searchParams.get('q')||'').trim().toLocaleLowerCase('ru-RU').slice(0,100)};};
 function list(sql,countSql,args,p){return {items:db.prepare(sql+' LIMIT ? OFFSET ?').all(...args,p.limit,p.offset),total:db.prepare(countSql).get(...args).n,page:p.page,page_size:p.limit};}
 const backupDir=join(dirname(uploads),'admin-backups');
 if(existsSync(backupDir))for(const entry of readdirSync(backupDir))if(/^\.[a-f0-9]{32}$/.test(entry)||/^Volna-[0-9.]+-[a-f0-9]{32}\.tar\.gz\.part$/.test(entry))rmSync(join(backupDir,entry),{recursive:true,force:true});
 async function makeBackup(reason){
  if(makingBackup)throw fail(409,'Резервная копия уже создаётся');makingBackup=true;
  const id=randomBytes(16).toString('hex'),stage=join(backupDir,'.'+id),filename=`Volna-${version}-${id}.tar.gz`,target=join(backupDir,filename);
  try{mkdirSync(stage,{recursive:true,mode:0o700});mkdirSync(join(stage,'uploads'),{mode:0o700});
   // Uploads are immutable files. Hard links keep this snapshot intact during later deletion.
   for(const entry of readdirSync(uploads,{withFileTypes:true}))if(entry.isFile()&&/^[a-f0-9]{48}$/.test(entry.name))linkSync(join(uploads,entry.name),join(stage,'uploads',entry.name));
   db.prepare('VACUUM INTO ?').run(join(stage,'volna.db'));
   await run('tar',['-czf',target+'.part','-C',stage,'volna.db','uploads'],{timeout:600000,maxBuffer:1024*1024});
   chmodSync(target+'.part',0o600);await rename(target+'.part',target);const size=statSync(target).size,created=clock();
   db.prepare('INSERT INTO admin_backups VALUES(?,?,?,?)').run(id,filename,created,size);audit('backup.create',id,reason,{size});return {id,filename,created,size};
  }catch(e){await rm(target+'.part',{force:true}).catch(()=>{});throw fail(503,'Не удалось создать полную резервную копию. Проверьте место на диске и доступ к файлам.');}
  finally{await rm(stage,{recursive:true,force:true}).catch(()=>{});makingBackup=false;}
 }
 async function handle(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url=new URL(req.url,'http://local'),path=url.pathname,method=req.method;
  try{
   if(path.startsWith('/admin/api/')&&req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw fail(403,'Межсайтовые запросы запрещены');
   if(req.headers.origin&&req.headers.origin!==origin)throw fail(403,'Источник запроса не разрешён');
   if(method==='OPTIONS')throw fail(403,'Межсайтовые запросы запрещены');
   if(path==='/admin/api/health'&&method==='GET')return json(res,200,{ok:true});
   if(!path.startsWith('/admin/api/')){
    const assets={'/':['index.html','text/html; charset=utf-8'],'/admin.js':['admin.js','text/javascript; charset=utf-8'],'/admin.css':['admin.css','text/css; charset=utf-8']},asset=assets[path];
    if(!asset||!['GET','HEAD'].includes(method))throw fail(404,'Страница не найдена');const bytes=readFileSync(join(staticRoot,asset[0]));res.writeHead(200,{'Content-Type':asset[1]});return res.end(method==='HEAD'?undefined:bytes);
   }
   if(method!=='GET'&&!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw fail(415,'Ожидается JSON');
   if(path==='/admin/api/config'&&method==='GET')return json(res,200,{version,sms_enabled:smsReady,phone_hint:adminPhone.slice(0,2)+' ••• ••• '+adminPhone.slice(-4),origin});
   if(path.startsWith('/admin/api/auth/')){
    const address=ip(req),now=clock();let bucket=buckets.get(address);if(!bucket||bucket.until<=now){bucket={until:now+60000,count:0};buckets.set(address,bucket);}if(++bucket.count>30)throw fail(429,'Подождите минуту');
    const data=await body(req);
    if(path==='/admin/api/auth/request'&&method==='POST'){
     const raw=typeof data.phone==='string'?data.phone.replace(/[\s()-]/g,''):'';const phone=normalizePhone(/^[78]\d{10}$/.test(raw)?'+7'+raw.slice(1):raw);
     if(phone!==adminPhone)throw fail(403,'Вход разрешён только администратору');if(!smsReady)throw fail(503,'Отправка SMS не настроена');
     const challenge=transaction(()=>{
      const recent=db.prepare('SELECT id,code_hash,created FROM admin_sms ORDER BY created DESC LIMIT 1').get();if(recent&&now-recent.created<60000)throw fail(429,'Повторный код — через 60 секунд');
      const adminHour=db.prepare('SELECT COUNT(*) n FROM admin_sms WHERE created>?').get(now-3600000).n;
      const regularPhone=db.prepare('SELECT COUNT(*) n FROM sms_challenges WHERE phone=? AND created>?').get(phone,now-3600000).n;
      const allDay=db.prepare('SELECT COUNT(*) n FROM sms_challenges WHERE created>?').get(now-86400000).n+db.prepare('SELECT COUNT(*) n FROM admin_sms WHERE created>?').get(now-86400000).n;
      if(adminHour+regularPhone>=5||allDay>=readAdminSettings(db).sms_day)throw fail(429,'Лимит SMS исчерпан. Попробуйте позже');
      let code;for(let i=0;i<100;i++){code=codeGenerator();if(!/^\d{6}$/.test(code))throw Error('Invalid admin SMS generator');if(!recent||mac('admin:'+recent.id+':'+code)!==recent.code_hash)break;if(i===99)throw Error('Repeated SMS code');}const id=secret();
      const counter=Number(db.prepare("SELECT value FROM auth_settings WHERE key='sms-reference'").get().value)+1;
      if(!Number.isSafeInteger(counter))throw Error('SMS counter exhausted');db.prepare("UPDATE auth_settings SET value=? WHERE key='sms-reference'").run(String(counter));
      const reference='ext_id_'+String(counter).padStart(3,'0');db.prepare("UPDATE admin_sms SET status='expired' WHERE status IN ('created','sent')").run();
      db.prepare('INSERT INTO admin_sms(id,phone,code_hash,reference,created,expires,status,ip) VALUES(?,?,?,?,?,?,?,?)').run(id,phone,mac('admin:'+id+':'+code),reference,now,now+300000,'created',address);return {id,phone,code,reference};
     });
     try{const provider=await sender(challenge);db.prepare("UPDATE admin_sms SET status='sent',provider_id=? WHERE id=? AND status='created'").run(String(provider?.id||'').slice(0,100),challenge.id);audit('auth.sms.accepted',challenge.reference,'',{},'system');json(res,200,{sms_session_id:challenge.id,expires_in:300,resend_after:60});}
     catch(e){db.prepare("UPDATE admin_sms SET status='failed' WHERE id=?").run(challenge.id);audit('auth.sms.failed',challenge.reference,'',{},'system');throw fail(503,'Не удалось отправить SMS администратора. Проверьте Notificore');}return;
    }
    if(path==='/admin/api/auth/verify'&&method==='POST'){
     const code=String(data.code||'').replace('-','');if(!/^\d{6}$/.test(code)||typeof data.sms_session_id!=='string')throw fail(400,'Введите шесть цифр из SMS');
     const row=db.prepare('SELECT * FROM admin_sms WHERE id=?').get(data.sms_session_id);
     if(!row||row.phone!==adminPhone||row.ip!==address||row.status!=='sent'||row.expires<=now)throw fail(410,'Код истёк или недействителен');
     if(!timingSafeEqual(Buffer.from(row.code_hash,'hex'),Buffer.from(mac('admin:'+row.id+':'+code),'hex'))){db.prepare("UPDATE admin_sms SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'blocked' ELSE status END WHERE id=?").run(row.id);throw fail(400,'Неверный код');}
     const token=secret(),id=randomBytes(16).toString('hex');transaction(()=>{db.prepare("UPDATE admin_sms SET status='verified' WHERE id=?").run(row.id);db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?,?,?)').run(id,hash(token),now,now+28800000,now,String(req.headers['user-agent']||'').replace(/[\x00-\x1f\x7f]/g,'').slice(0,160),address);audit('auth.login',id);});cookie(res,token);return json(res,200,{csrf_token:csrf(token),expires:now+28800000});
    }
    throw fail(404,'Не найдено');
   }
   const session=authenticate(req);
   if(path==='/admin/api/session'&&method==='GET')return json(res,200,{id:session.id,phone:adminPhone,csrf_token:session.csrf_token,expires:session.expires,version});
   if(path==='/admin/api/logout'&&method==='POST'){db.prepare('DELETE FROM admin_sessions WHERE id=?').run(session.id);audit('auth.logout',session.id);cookie(res,'',0);return json(res,200,{ok:true});}
   const p=page(url);
   if(path==='/admin/api/stats'&&method==='GET'){
    const counts={};for(const [key,table] of Object.entries({users:'users',chats:'chats',messages:'messages',files:'attachments',push_jobs:'push_jobs'}))counts[key]=db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
    counts.blocked_users=db.prepare('SELECT COUNT(*) n FROM users WHERE admin_blocked=1').get().n;counts.active_sessions=db.prepare('SELECT COUNT(*) n FROM sessions WHERE expires>?').get(clock()).n;counts.storage_bytes=db.prepare('SELECT COALESCE(SUM(size),0) n FROM attachments').get().n;
    let disk=null;try{const v=statfsSync(uploads);disk={free_bytes:v.bavail*v.bsize,total_bytes:v.blocks*v.bsize};}catch{}
    const whisper=await serviceStatus().catch(()=>({available:false,ready:false,state:'unavailable'}));
    return json(res,200,{version,uptime_seconds:Math.floor(process.uptime()),counts,disk,whisper,active_calls:callService.list(),settings:readAdminSettings(db),activity:db.prepare("SELECT substr(created_at,1,10) AS day,COUNT(*) AS messages FROM messages GROUP BY day ORDER BY day DESC LIMIT 14").all()});
   }
   if(path==='/admin/api/users'&&method==='GET'){
    const where=' WHERE (?=\'\' OR instr(lower(u.username),?)>0 OR instr(casefold(u.name),?)>0 OR instr(COALESCE(u.phone,\'\'),?)>0 OR CAST(u.id AS TEXT)=?)';const args=[p.q,p.q,p.q,p.q,p.q];
    return json(res,200,list('SELECT u.id,u.username,u.name,u.phone,u.bio,u.created_at,u.admin_blocked,u.admin_reason,(SELECT COUNT(*) FROM members WHERE user_id=u.id) AS chats,(SELECT COUNT(*) FROM messages WHERE sender_id=u.id) AS messages FROM users u'+where+' ORDER BY u.id DESC','SELECT COUNT(*) n FROM users u'+where,args,p));
   }
   let match=path.match(/^\/admin\/api\/users\/(\d+)(?:\/(block|sessions|anonymize))?$/);
   if(match){const id=numeric(match[1]),op=match[2],row=db.prepare('SELECT id,username,name,phone,bio,created_at,avatar_hidden,admin_blocked,admin_reason FROM users WHERE id=?').get(id);if(!row)throw fail(404,'Пользователь не найден');
    if(method==='GET'&&!op)return json(res,200,{...row,protected:row.phone===adminPhone,chats:db.prepare('SELECT c.id,c.kind,c.title,m.role FROM chats c JOIN members m ON m.chat_id=c.id WHERE m.user_id=? ORDER BY c.id DESC LIMIT 100').all(id),sessions:db.prepare('SELECT r.id,r.platform,d.agent,d.last_seen,r.expires FROM refresh_sessions r LEFT JOIN session_details d ON d.token=r.access_id WHERE r.user_id=?').all(id)});
    if(method==='POST'){const d=await body(req),reason=text(d.reason);if(op==='block'){protectedUser(id);const blocked=boolean(d.blocked);transaction(()=>{db.prepare('UPDATE users SET admin_blocked=?,admin_reason=? WHERE id=?').run(+blocked,reason,id);if(blocked)revokeUser(id);audit(blocked?'user.block':'user.unblock',id,reason);});notifyProfile(id);}
     else if(op==='sessions'){requireConfirm(d,id);revokeUser(id);audit('user.sessions.revoke',id,reason);}
     else if(op==='anonymize'){protectedUser(id);requireConfirm(d,id);transaction(()=>{revokeUser(id);db.prepare("UPDATE users SET phone='deleted:'||id,username=?,name='Удалённый пользователь',bio='',avatar_id=NULL,avatar_hidden=1,admin_blocked=1,admin_reason=? WHERE id=?").run('deleted_'+id+'_'+randomBytes(4).toString('hex'),reason,id);audit('user.anonymize',id,reason);});notifyProfile(id);}
     else if(!op){const name=text(d.name,64),bio=typeof d.bio==='string'?d.bio.trim():'';if(bio.length>280)throw fail(400,'Описание — до 280 символов');const nick=canonicalUsername(d.username),problem=usernameProblem(nick,{allowNumeric:nick===row.username});if(problem)throw fail(400,problem);if(db.prepare('SELECT 1 FROM users WHERE username_normalized=? AND id<>?').get(nick,id))throw fail(409,'Username уже занят');db.prepare('UPDATE users SET name=?,bio=?,username=?,avatar_hidden=? WHERE id=?').run(name,bio,nick,+boolean(d.avatar_hidden),id);audit('user.edit',id,reason);notifyProfile(id);}
     else throw fail(404,'Не найдено');return json(res,200,{ok:true});}
   }
   if(path==='/admin/api/chats'&&method==='POST'){
    const d=await body(req),reason=text(d.reason),title=text(d.title,80),owner=numeric(d.owner_id);
    if(!['group','channel'].includes(d.kind))throw fail(400,'Выберите группу или канал');
    if(!db.prepare('SELECT 1 FROM users WHERE id=? AND admin_blocked=0').get(owner))throw fail(404,'Активный владелец не найден');
    const id=transaction(()=>{const id=Number(db.prepare('INSERT INTO chats(pair,kind,title,created_by,posting_policy) VALUES(?,?,?,?,?)').run('admin-community:'+randomBytes(16).toString('hex'),d.kind,title,owner,d.kind==='channel'?'admins':'all').lastInsertRowid);db.prepare("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'owner')").run(id,owner);audit('chat.create',id,reason,{kind:d.kind,owner_id:owner});return id;});publish([owner],{type:'chats'});return json(res,201,{id});
   }
   if(path==='/admin/api/chats'&&method==='GET'){
    const kind=url.searchParams.get('kind')||'';if(kind&&!['direct','saved','group','channel','topic'].includes(kind))throw fail(400,'Некорректный тип чата');const where=" WHERE (?='' OR instr(casefold(c.title),?)>0 OR CAST(c.id AS TEXT)=?) AND (?='' OR c.kind=? OR (?='topic' AND c.parent_id IS NOT NULL))",args=[p.q,p.q,p.q,kind,kind,kind];
    return json(res,200,list('SELECT c.*,(SELECT COUNT(*) FROM members WHERE chat_id=c.id) AS member_count,(SELECT COUNT(*) FROM messages WHERE chat_id=c.id) AS message_count FROM chats c'+where+' ORDER BY c.id DESC','SELECT COUNT(*) n FROM chats c'+where,args,p));
   }
   match=path.match(/^\/admin\/api\/chats\/(\d+)(?:\/(lock|delete|restore|members|invites))?$/);
   if(match){const id=numeric(match[1]),op=match[2],row=db.prepare('SELECT * FROM chats WHERE id=?').get(id);if(!row)throw fail(404,'Чат не найден');
    if(method==='GET'&&!op)return json(res,200,{...row,members:db.prepare('SELECT u.id,u.username,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? ORDER BY m.role,u.name LIMIT 500').all(id),topics:db.prepare('SELECT id,title,topic_closed,admin_deleted FROM chats WHERE parent_id=?').all(id),invite:db.prepare('SELECT expires,uses,max_uses FROM community_invites WHERE chat_id=?').get(id)||null});
    if(method==='POST'){const d=await body(req),reason=text(d.reason);
     if(op==='lock'){db.prepare('UPDATE chats SET admin_locked=? WHERE id=? OR parent_id=?').run(+boolean(d.locked),id,id);audit(d.locked?'chat.lock':'chat.unlock',id,reason);}
     else if(op==='delete'||op==='restore'){requireConfirm(d,id);const ids=db.prepare('SELECT id FROM chats WHERE id=? OR parent_id=?').all(id).map(c=>c.id);transaction(()=>{db.prepare('UPDATE chats SET admin_deleted=? WHERE id=? OR parent_id=?').run(op==='delete'?1:0,id,id);if(op==='delete')for(const cid of ids)db.prepare('DELETE FROM community_invites WHERE chat_id=?').run(cid);audit('chat.'+op,id,reason);});for(const cid of ids){if(op==='delete')broadcast(cid,{type:'removed',chat_id:cid});else notifyChat(cid);}for(const call of callService.list())if(ids.includes(call.chat_id))callService.terminate(call.id);return json(res,200,{ok:true});}
     else if(op==='invites'){db.prepare('DELETE FROM community_invites WHERE chat_id=?').run(id);audit('chat.invites.revoke',id,reason);}
     else if(op==='members'){
      if(!['group','channel'].includes(row.kind)||row.parent_id)throw fail(400,'Участниками управляют в основной группе или канале');const uid=numeric(d.user_id);if(!db.prepare('SELECT 1 FROM users WHERE id=? AND (?=1 OR admin_blocked=0)').get(uid,+(d.operation==='remove')))throw fail(404,'Активный пользователь не найден');
      const current=db.prepare('SELECT role FROM members WHERE chat_id=? AND user_id=?').get(id,uid);if(d.operation==='add'&&!current&&db.prepare('SELECT COUNT(*) n FROM members WHERE chat_id=?').get(id).n>=300)throw fail(409,'В сообществе допускается до 300 участников');const children=db.prepare('SELECT id FROM chats WHERE id=? OR parent_id=?').all(id).map(c=>c.id);
      if(d.operation==='remove'){if(current?.role==='owner')throw fail(409,'Сначала передайте владение сообществом');transaction(()=>{for(const cid of children){db.prepare('DELETE FROM members WHERE chat_id=? AND user_id=?').run(cid,uid);db.prepare('DELETE FROM chat_preferences WHERE chat_id=? AND user_id=?').run(cid,uid);}audit('chat.member.remove',id,reason,{user_id:uid});});publish([uid],{type:'removed',chat_id:id});}
      else if(d.operation==='add'||d.operation==='role'){
       const role=d.role||'member';if(!['owner','admin','member'].includes(role))throw fail(400,'Некорректная роль');if(d.operation==='role'&&!current)throw fail(404,'Участник не найден');if(current?.role==='owner'&&role!=='owner')throw fail(409,'Для смены владельца выберите нового участника с ролью Владелец');
       transaction(()=>{for(const cid of children){if(role==='owner')db.prepare("UPDATE members SET role='admin' WHERE chat_id=? AND role='owner'").run(cid);db.prepare('DELETE FROM community_bans WHERE chat_id=? AND user_id=?').run(cid,uid);db.prepare('INSERT INTO members(chat_id,user_id,role) VALUES(?,?,?) ON CONFLICT(chat_id,user_id) DO UPDATE SET role=excluded.role').run(cid,uid,role);}if(role==='owner')db.prepare('UPDATE chats SET created_by=? WHERE id=? OR parent_id=?').run(uid,id,id);audit('chat.member.'+d.operation,id,reason,{user_id:uid,role});});publish([uid],{type:'chats'});
      }else throw fail(400,'Некорректная операция');
     }
     else if(!op){if(!['group','channel'].includes(row.kind))throw fail(400,'Название можно изменить у группы или канала');const title=text(d.title,120),description=typeof d.description==='string'?d.description.trim():'';if(description.length>1000)throw fail(400,'Описание — до 1000 символов');if(!['all','admins'].includes(d.posting_policy))throw fail(400,'Некорректные права публикации');db.prepare('UPDATE chats SET title=?,description=?,posting_policy=?,topic_closed=? WHERE id=?').run(title,description,row.kind==='channel'?'admins':d.posting_policy,+boolean(d.topic_closed),id);audit('chat.edit',id,reason);}
     else throw fail(404,'Не найдено');for(const c of db.prepare('SELECT id FROM chats WHERE id=? OR parent_id=?').all(id))notifyChat(c.id);return json(res,200,{ok:true});}
   }
   if(path==='/admin/api/messages'&&method==='GET'){
    const chat=Number(url.searchParams.get('chat')||0),user=Number(url.searchParams.get('user')||0);if(!Number.isSafeInteger(chat)||chat<0||!Number.isSafeInteger(user)||user<0)throw fail(400,'Некорректный фильтр');
    const where=" WHERE (?='' OR instr(casefold(m.text),?)>0 OR CAST(m.id AS TEXT)=?) AND (?=0 OR m.chat_id=?) AND (?=0 OR m.sender_id=?)",args=[p.q,p.q,p.q,chat,chat,user,user];
    return json(res,200,list('SELECT m.id,m.chat_id,m.sender_id,u.name AS sender_name,m.text,m.created_at,m.deleted_at,m.attachment_id,a.name AS attachment_name FROM messages m JOIN users u ON u.id=m.sender_id LEFT JOIN attachments a ON a.id=m.attachment_id'+where+' ORDER BY m.id DESC','SELECT COUNT(*) n FROM messages m'+where,args,p));
   }
   match=path.match(/^\/admin\/api\/messages\/(\d+)\/(delete|pin)$/);
   if(match&&method==='POST'){const id=numeric(match[1]),d=await body(req),reason=text(d.reason);if(match[2]==='delete'){requireConfirm(d,id);removeMessage(id,reason);}else{const row=db.prepare('SELECT * FROM messages WHERE id=? AND deleted_at IS NULL').get(id);if(!row)throw fail(404,'Сообщение не найдено');if(boolean(d.pinned))db.prepare('INSERT OR IGNORE INTO pins VALUES(?,?)').run(row.chat_id,id);else db.prepare('DELETE FROM pins WHERE message_id=?').run(id);audit(d.pinned?'message.pin':'message.unpin',id,reason);broadcast(row.chat_id,{type:'message-update',message:hydrate(row)});}return json(res,200,{ok:true});}
   if(path==='/admin/api/files'&&method==='GET'){
    const where=" WHERE (?='' OR instr(casefold(a.name),?)>0 OR a.id=?)",args=[p.q,p.q,p.q];return json(res,200,list('SELECT a.*,(SELECT COUNT(*) FROM messages WHERE attachment_id=a.id AND deleted_at IS NULL) AS references_count FROM attachments a'+where+' ORDER BY a.created_at DESC','SELECT COUNT(*) n FROM attachments a'+where,args,p));
   }
   match=path.match(/^\/admin\/api\/files\/([a-f0-9]{48})\/(download|block)$/);
   if(match){const id=opaque(match[1],48),file=db.prepare('SELECT * FROM attachments WHERE id=?').get(id);if(!file)throw fail(404,'Файл не найден');if(match[2]==='download'&&method==='GET'){audit('file.download',id);return fileResponse(res,join(uploads,id),file.name);}if(match[2]==='block'&&method==='POST'){const d=await body(req),blocked=boolean(d.blocked),reason=text(d.reason);db.prepare('UPDATE attachments SET admin_blocked=? WHERE id=?').run(+blocked,id);if(blocked)db.prepare('UPDATE users SET avatar_hidden=1 WHERE avatar_id=?').run(id);audit(blocked?'file.block':'file.unblock',id,reason);const users=db.prepare('SELECT DISTINCT user_id FROM members').all().map(x=>x.user_id);publish(users,{type:'emoji_asset.unavailable',attachment_id:id});return json(res,200,{ok:true});}}
   if(path==='/admin/api/packs'&&method==='GET'){const where=" WHERE (?='' OR instr(casefold(p.title),?)>0 OR p.id=?)",args=[p.q,p.q,p.q];return json(res,200,list('SELECT p.id,p.title,p.kind,p.owner_id,p.public,p.status,p.created,(SELECT COUNT(*) FROM expression_items WHERE pack_id=p.id) AS items FROM expression_packs p'+where+' ORDER BY p.created DESC','SELECT COUNT(*) n FROM expression_packs p'+where,args,p));}
   match=path.match(/^\/admin\/api\/packs\/([a-f0-9]{32})$/);
   if(match&&method==='POST'){const id=opaque(match[1]),d=await body(req),reason=text(d.reason);if(!['published','blocked'].includes(d.status))throw fail(400,'Некорректный статус набора');if(!db.prepare('SELECT 1 FROM expression_packs WHERE id=?').get(id))throw fail(404,'Набор не найден');db.prepare('UPDATE expression_packs SET status=?,updated=? WHERE id=?').run(d.status,clock(),id);audit('pack.'+d.status,id,reason);publish(db.prepare('SELECT id FROM users').all().map(x=>x.id),{type:'emoji_pack.updated',pack_id:id});return json(res,200,{ok:true});}
   if(path==='/admin/api/sms'&&method==='GET')return json(res,200,{regular:db.prepare("SELECT reference,substr(phone,1,2)||'••••'||substr(phone,-4) AS phone,status,attempts,created,expires,provider_id FROM sms_challenges ORDER BY created DESC LIMIT 100").all(),admin:db.prepare('SELECT reference,status,attempts,created,expires FROM admin_sms ORDER BY created DESC LIMIT 30').all(),limits:readAdminSettings(db)});
   if(path==='/admin/api/sms/reset'&&method==='POST'){const d=await body(req),phone=normalizePhone(d.phone),reason=text(d.reason);requireConfirm(d,'RESET');const recent=db.prepare('SELECT id FROM sms_challenges WHERE phone=? AND created>?').all(phone,clock()-86400000);transaction(()=>{db.prepare("UPDATE sms_challenges SET status='expired',created=MIN(created,?) WHERE phone=? AND created>?").run(clock()-86400000-1,phone,clock()-86400000);audit('sms.limit.reset',phone.slice(0,2)+'••••'+phone.slice(-4),reason,{requests:recent.length});});return json(res,200,{ok:true});}
   if(path==='/admin/api/devices'&&method==='GET')return json(res,200,list('SELECT r.id,r.user_id,u.name,r.platform,r.created,r.expires,d.last_seen,d.agent FROM refresh_sessions r JOIN users u ON u.id=r.user_id LEFT JOIN session_details d ON d.token=r.access_id ORDER BY d.last_seen DESC','SELECT COUNT(*) n FROM refresh_sessions',[],p));
   match=path.match(/^\/admin\/api\/devices\/([A-Za-z0-9_-]{43})\/revoke$/);
   if(match&&method==='POST'){const d=await body(req),reason=text(d.reason),row=db.prepare('SELECT access_id,user_id FROM refresh_sessions WHERE id=?').get(match[1]);if(!row)throw fail(404,'Устройство не найдено');db.prepare('DELETE FROM sessions WHERE token=?').run(row.access_id);disconnectUser(row.user_id);audit('device.revoke',match[1],reason,{user_id:row.user_id});return json(res,200,{ok:true});}
   if(path==='/admin/api/calls'&&method==='GET')return json(res,200,{active:callService.list(),...list('SELECT id,chat_id,caller,callee,created,answered,ended,status,video FROM call_history ORDER BY created DESC','SELECT COUNT(*) n FROM call_history',[],p)});
   match=path.match(/^\/admin\/api\/calls\/([a-f0-9]{32})\/end$/);
   if(match&&method==='POST'){const d=await body(req),reason=text(d.reason);callService.terminate(match[1]);audit('call.terminate',match[1],reason);return json(res,200,{ok:true});}
   if(path==='/admin/api/settings'){
    if(method==='GET')return json(res,200,readAdminSettings(db));if(method==='POST'){const d=await body(req),reason=text(d.reason),settings=validateAdminSettings(d.settings);db.prepare('INSERT INTO admin_config VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(settings));audit('settings.update','system',reason,{keys:Object.keys(settings)});return json(res,200,settings);}
   }
   if(path==='/admin/api/maintenance/cleanup'&&method==='POST'){const d=await body(req),reason=text(d.reason);cleanupFiles();const result=db.prepare('DELETE FROM push_jobs WHERE expires<?').run(clock());audit('storage.cleanup','system',reason,{expired_push_jobs:Number(result.changes)});return json(res,200,{ok:true});}
   if(path==='/admin/api/backups'){
    if(method==='GET')return json(res,200,{items:db.prepare('SELECT * FROM admin_backups ORDER BY created DESC LIMIT 50').all(),busy:makingBackup});
    if(method==='POST'){const d=await body(req);if(makingBackup)throw fail(409,'Резервная копия уже создаётся');backupTask=makeBackup(text(d.reason));try{return json(res,201,await backupTask);}finally{backupTask=null;}}
   }
   match=path.match(/^\/admin\/api\/backups\/([a-f0-9]{32})\/(download|delete)$/);
   if(match){const id=opaque(match[1]),row=db.prepare('SELECT * FROM admin_backups WHERE id=?').get(id);if(!row)throw fail(404,'Копия не найдена');if(match[2]==='download'&&method==='GET'){audit('backup.download',id);return fileResponse(res,join(backupDir,row.filename),row.filename);}if(match[2]==='delete'&&method==='POST'){const d=await body(req);requireConfirm(d,id);const reason=text(d.reason);await rm(join(backupDir,row.filename),{force:true});db.prepare('DELETE FROM admin_backups WHERE id=?').run(id);audit('backup.delete',id,reason);return json(res,200,{ok:true});}}
   if(path==='/admin/api/audit'&&method==='GET'){const where=" WHERE (?='' OR instr(lower(action||' '||target||' '||reason),?)>0)",args=[p.q,p.q];return json(res,200,list('SELECT id,created,actor,action,target,reason,details FROM admin_audit'+where+' ORDER BY id DESC','SELECT COUNT(*) n FROM admin_audit'+where,args,p));}
   if(path==='/admin/api/admin-sessions'&&method==='GET')return json(res,200,{items:db.prepare('SELECT id,created,expires,last_seen,agent,ip FROM admin_sessions WHERE expires>? ORDER BY last_seen DESC').all(clock()),current_id:session.id});
   if(path==='/admin/api/admin-sessions/revoke'&&method==='POST'){const d=await body(req),id=opaque(d.id);db.prepare('DELETE FROM admin_sessions WHERE id=?').run(id);audit('admin.session.revoke',id,text(d.reason));if(id===session.id)cookie(res,'',0);return json(res,200,{ok:true});}
   if(path==='/admin/api/announcement'&&method==='POST'){
    const d=await body(req),message=text(d.text,4000),reason=text(d.reason);requireConfirm(d,'SEND');
    const users=db.prepare('SELECT id FROM users WHERE admin_blocked=0 AND phone IS NOT NULL').all();if(users.length>20000)throw fail(409,'Рассылка для более 20 000 аккаунтов требует отдельной очереди');
    const result=transaction(()=>{let author=db.prepare('SELECT id FROM users WHERE phone=?').get(adminPhone);if(!author)author={id:Number(db.prepare('INSERT INTO users(username,name,phone) VALUES(?,?,?)').run(availablePhoneUsername(db,adminPhone),'Администратор Волны',adminPhone).lastInsertRowid)};
     const prior=db.prepare("SELECT value FROM admin_meta WHERE key='announcement-chat'").get();let channel=prior?db.prepare('SELECT id FROM chats WHERE id=? AND admin_deleted=0').get(Number(prior.value)):null;
     if(!channel){channel={id:Number(db.prepare("INSERT INTO chats(pair,kind,title,description,created_by,posting_policy) VALUES(?,'channel','Новости Волны','Объявления администратора',?,'admins')").run('admin:'+randomBytes(16).toString('hex'),author.id).lastInsertRowid)};db.prepare("INSERT INTO admin_meta VALUES('announcement-chat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(channel.id));}
     for(const uid of new Set([author.id,...users.map(u=>u.id)]))db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id,role) VALUES(?,?,?)').run(channel.id,uid,uid===author.id?'owner':'member');
     const id=Number(db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(channel.id,author.id,message,randomBytes(16).toString('hex'),new Date(clock()).toISOString()).lastInsertRowid);audit('announcement.send',channel.id,reason,{message_id:id,recipients:users.length});return {id,chat:channel.id};});
    publish(users.map(u=>u.id),{type:'chats'});broadcast(result.chat,{type:'message',message:hydrate(db.prepare('SELECT * FROM messages WHERE id=?').get(result.id))});return json(res,200,{ok:true,recipients:users.length,chat_id:result.chat});
   }
   throw fail(404,'Не найдено');
  }catch(e){if(!e.status)console.error('[admin] operation_failed',e.name);if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Ошибка административной операции'});else res.destroy();}
 }
 const server=http.createServer(handle);server.requestTimeout=120000;server.headersTimeout=15000;
 return {server,guard(req,url){const settings=readAdminSettings(db);if(settings.maintenance&&!['GET','HEAD'].includes(req.method)&&url.pathname!=='/api/logout')throw fail(503,settings.maintenance_message);const file=url.pathname.match(/^\/api\/files\/([a-f0-9]{48})$/);if(file&&db.prepare('SELECT admin_blocked FROM attachments WHERE id=?').get(file[1])?.admin_blocked)throw fail(404,'Файл недоступен');},cleanup(){const now=clock();db.prepare('DELETE FROM admin_sessions WHERE expires<=?').run(now);db.prepare('DELETE FROM admin_sms WHERE created<?').run(now-7*86400000);for(const [address,b] of buckets)if(b.until<=now)buckets.delete(address);},close:async()=>{if(backupTask)await backupTask.catch(()=>{});if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}}};
}
