import {readAdminSettings} from './admin-config.mjs';
import {availablePhoneUsername} from './usernames.mjs';
import {randomBytes, randomInt, createHash, createHmac, timingSafeEqual} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const tokenHash=value=>createHash('sha256').update(String(value)).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
export function normalizePhone(value){
  if(typeof value!=='string'||value.length>40||!/^[+0-9\s()-]+$/.test(value))throw fail(400,'Укажите номер с кодом страны, например +7 900 123-45-67');
  const clean=value.replace(/[\s()-]/g,'');
  if(!/^\+[1-9][0-9]{7,14}$/.test(clean))throw fail(400,'Нужен международный номер с кодом страны');
  return clean;
}
export function notificoreSender({key=process.env.NOTIFICORE_API_KEY||'',originator=process.env.NOTIFICORE_ORIGINATOR||'',fetcher=fetch}={}){
  return async ({phone,code,reference})=>{
    if(!key||!originator)throw fail(503,'Отправка SMS пока не настроена');
    const response=await fetcher('https://api.notificore.ru/v1.0/sms/create',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'X-API-KEY':key,'Content-Type':'application/json'},
      body:JSON.stringify({destination:'phone',originator,body:`${code.slice(0,3)}-${code.slice(3)} твоя волна`,msisdn:phone.slice(1),reference})});
    const text=await response.text();if(text.length>32000)throw fail(503,'SMS-провайдер временно недоступен');
    let data;try{data=JSON.parse(text);}catch{throw fail(503,'SMS-провайдер временно недоступен');}
    const result=data.result||data;
    if(!response.ok||Number(result.error)!==0||!result.id)throw Object.assign(fail(503,'Не удалось отправить SMS. Повторите позже'),{smsDiagnostic:{kind:'provider-rejected',http_status:response.status,provider_error:Number.isSafeInteger(Number(result.error))?Number(result.error):null}});
    // Do not retain the provider's raw response: it may echo phone, body or secrets.
    return {id:String(result.id).slice(0,100),error:0};
  };
}
export function phoneAuth({db,body,json,userById,auth,disconnect=()=>{},sender=notificoreSender(),clock=Date.now,
  codeGenerator=()=>String(randomInt(0,1000000)).padStart(6,'0'),trustProxy=process.env.AUTH_TRUST_PROXY==='1',
  loginCheck=()=>{},logger=event=>console.info('[sms]',JSON.stringify(event)),
  referenceStart=Number(process.env.SMS_REFERENCE_START||0),smsReady=!!(process.env.NOTIFICORE_API_KEY&&process.env.NOTIFICORE_ORIGINATOR)}){
  db.exec(`CREATE TABLE IF NOT EXISTS auth_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sms_challenges(id TEXT PRIMARY KEY,phone TEXT NOT NULL,code_hash TEXT NOT NULL,
      reference TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,used INTEGER,attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,ip TEXT NOT NULL,provider_id TEXT);
    CREATE INDEX IF NOT EXISTS sms_phone_created ON sms_challenges(phone,created);
    CREATE INDEX IF NOT EXISTS sms_ip_created ON sms_challenges(ip,created);
    CREATE TABLE IF NOT EXISTS auth_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,created INTEGER NOT NULL,ip TEXT NOT NULL,user_id INTEGER);
    CREATE TABLE IF NOT EXISTS refresh_sessions(id TEXT PRIMARY KEY,refresh_hash TEXT UNIQUE NOT NULL,
      access_id TEXT UNIQUE NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id),
      platform TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS qr_challenges(id TEXT PRIMARY KEY,scan_hash TEXT UNIQUE NOT NULL,poll_hash TEXT NOT NULL,
      platform TEXT NOT NULL,agent TEXT NOT NULL,ip TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',user_id INTEGER REFERENCES users(id),approved_by TEXT);`);
  db.prepare('INSERT OR IGNORE INTO auth_settings VALUES(?,?)').run('hmac',randomBytes(32).toString('hex'));
  if(!Number.isSafeInteger(referenceStart)||referenceStart<0)throw Error('SMS_REFERENCE_START must be a non-negative integer');
  db.prepare('INSERT OR IGNORE INTO auth_settings VALUES(?,?)').run('sms-reference',String(referenceStart));
  const log=event=>{try{logger(event);}catch{}};
  const hmacKey=db.prepare("SELECT value FROM auth_settings WHERE key='hmac'").get().value;
  const hmac=(phone,code,id)=>createHmac('sha256',hmacKey).update(`${phone}\0${id}\0${code}`).digest('hex');
  const ip=req=>trustProxy?String(req.headers['x-real-ip']||req.socket.remoteAddress).slice(0,100):req.socket.remoteAddress||'unknown';
  const audit=(event,req,uid=null)=>db.prepare('INSERT INTO auth_audit(event,created,ip,user_id) VALUES(?,?,?,?)').run(event,clock(),ip(req),uid);
  const agent=req=>String(req.headers['user-agent']||'Волна').replace(/[\x00-\x1f\x7f]/g,'').slice(0,160);
  const transaction=callback=>{db.exec('BEGIN IMMEDIATE');try{const result=callback();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const issue=(uid,platform,req)=>{
    loginCheck(uid);
    const token=secret(),refresh=secret(),id=secret(),now=clock(),expires=now+3600000;
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),uid,expires);
    db.prepare('INSERT INTO refresh_sessions VALUES(?,?,?,?,?,?,?)').run(id,tokenHash(refresh),tokenHash(token),uid,platform,now,now+90*86400000);
    db.prepare('INSERT INTO session_details VALUES(?,?,?,?)').run(tokenHash(token),agent(req),now,now);
    audit('session-created',req,uid);
    return {platform,token,access_token:token,refresh_token:refresh,expires,refresh_expires:now+90*86400000,user:userById(uid,true)};
  };
  function qrForScan(value){
    if(typeof value!=='string'||!/^volna:\/\/login\/[A-Za-z0-9_-]{43}$/.test(value))throw fail(400,'Это не QR-код входа Волны');
    const row=db.prepare('SELECT * FROM qr_challenges WHERE scan_hash=?').get(tokenHash(value.slice('volna://login/'.length)));
    if(!row||row.expires<=clock()||!['pending','scanned'].includes(row.status))throw fail(410,'QR-код истёк или уже использован');return row;
  }
  const android=session=>{if(db.prepare('SELECT platform FROM refresh_sessions WHERE access_id=?').get(session.token)?.platform!=='android')throw fail(403,'Подтвердите вход в Android-приложении');};
  function deliver(res,result){
    if(result.platform==='web'&&result.refresh_token){
      res.setHeader('Set-Cookie',`volna.refresh=${result.refresh_token}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=${Math.max(0,Math.floor((result.refresh_expires-clock())/1000))}`);
      const safe={...result};delete safe.refresh_token;json(res,200,safe);
    }else json(res,200,result);
  }
  const limits=new Map();
  async function handle(req,res,url){
    const path=url.pathname,post=req.method==='POST';
    if(path==='/api/auth/config'&&req.method==='GET'){json(res,200,{mode:'phone-qr-v1',sms_enabled:smsReady});return true;}
    if(!path.startsWith('/api/auth/'))return false;
    const address=ip(req),now=clock();let bucket=limits.get(address);if(!bucket||bucket.until<now){bucket={count:0,until:now+60000};limits.set(address,bucket);}if(++bucket.count>240)throw fail(429,'Подождите минуту');
    if(path==='/api/auth/clear'&&post){res.setHeader('Set-Cookie','volna.refresh=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0');json(res,200,{ok:true});return true;}
    if(path==='/api/auth/sms/request'&&post){
      if(!smsReady)throw fail(503,'Отправка SMS пока не настроена');
      const data=await body(req),phone=normalizePhone(data.phone),now=clock(),address=ip(req);
      const existingUser=db.prepare('SELECT id FROM users WHERE phone=?').get(phone);loginCheck(existingUser?.id);
      const settings=readAdminSettings(db);
      const challenge=transaction(()=>{
        const recent=db.prepare('SELECT * FROM sms_challenges WHERE phone=? ORDER BY created DESC LIMIT 1').get(phone);
        if(recent&&now-recent.created<60000)throw fail(429,'Отправить код повторно можно через 60 секунд');
        const hour=now-3600000;
        if(db.prepare('SELECT COUNT(*) n FROM sms_challenges WHERE phone=? AND created>?').get(phone,hour).n+db.prepare('SELECT COUNT(*) n FROM admin_sms WHERE phone=? AND created>?').get(phone,hour).n>=settings.sms_phone_hour||
          db.prepare('SELECT COUNT(*) n FROM sms_challenges WHERE ip=? AND created>?').get(address,hour).n+db.prepare('SELECT COUNT(*) n FROM admin_sms WHERE ip=? AND created>?').get(address,hour).n>=settings.sms_ip_hour||
          db.prepare('SELECT COUNT(*) n FROM sms_challenges WHERE created>?').get(now-86400000).n+db.prepare('SELECT COUNT(*) n FROM admin_sms WHERE created>?').get(now-86400000).n>=settings.sms_day)throw fail(429,'Лимит SMS исчерпан. Попробуйте позже');
        const id=secret();let code;
        for(let i=0;i<100;i++){code=codeGenerator();if(!/^\d{6}$/.test(code))throw Error('Invalid SMS generator');if(!recent||hmac(phone,code,recent.id)!==recent.code_hash)break;if(i===99)throw Error('SMS generator repeated previous code');}
        const counter=Number(db.prepare("SELECT value FROM auth_settings WHERE key='sms-reference'").get().value)+1;
        if(!Number.isSafeInteger(counter))throw Error('SMS reference counter exhausted');
        db.prepare("UPDATE auth_settings SET value=? WHERE key='sms-reference'").run(String(counter));
        const reference='ext_id_'+String(counter).padStart(3,'0');
        db.prepare("UPDATE sms_challenges SET status='expired' WHERE phone=? AND status IN ('created','sent')").run(phone);
        db.prepare('INSERT INTO sms_challenges(id,phone,code_hash,reference,created,expires,status,ip) VALUES(?,?,?,?,?,?,?,?)').run(id,phone,hmac(phone,code,id),reference,now,now+300000,'created',address);
        audit('sms-request',req);return {id,phone,code,reference};
      });
      try{
        const provider=await sender(challenge);
        db.prepare("UPDATE sms_challenges SET status='sent',provider_id=? WHERE id=? AND status='created'").run(provider?.id||'',challenge.id);
        log({event:'accepted',reference:challenge.reference});
        json(res,200,{success:true,sms_session_id:challenge.id,expires_in:300,resend_after:60});
      }catch(e){const networkCodes=['ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'];const diagnostic=e.smsDiagnostic||{kind:['AbortError','TimeoutError'].includes(e.name)?'timeout':networkCodes.includes(e.cause?.code)?e.cause.code:'provider-unavailable'};log({event:'failed',reference:challenge.reference,...diagnostic});db.prepare("UPDATE sms_challenges SET status='failed' WHERE id=?").run(challenge.id);audit('sms-failed',req);throw fail(503,'Не удалось отправить SMS. Повторите позже');}
      return true;
    }
    if(path==='/api/auth/sms/verify'&&post){
      const data=await body(req),code=typeof data.code==='string'?data.code.replace('-', ''):'';
      if(!/^\d{6}$/.test(code)||typeof data.sms_session_id!=='string')throw fail(400,'Введите шесть цифр из SMS');
      const result=transaction(()=>{
        const row=db.prepare('SELECT * FROM sms_challenges WHERE id=?').get(data.sms_session_id);
        if(!row||row.expires<=clock()||row.status!=='sent')return {error:fail(410,'Код истёк или уже использован. Запросите новый')};
        const actual=Buffer.from(hmac(row.phone,code,row.id),'hex');
        if(!timingSafeEqual(actual,Buffer.from(row.code_hash,'hex'))){
          db.prepare("UPDATE sms_challenges SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'blocked' ELSE status END WHERE id=?").run(row.id);
          audit('sms-invalid',req);return {error:fail(400,'Неверный код. Проверьте код из SMS и попробуйте еще раз.')};
        }
        let user=db.prepare('SELECT id FROM users WHERE phone=?').get(row.phone);
        loginCheck(user?.id);
        if(!user){const inserted=db.prepare('INSERT INTO users(username,name,phone) VALUES(?,?,?)').run(availablePhoneUsername(db,row.phone),'Новый пользователь',row.phone);user={id:Number(inserted.lastInsertRowid)};}
        db.prepare("UPDATE sms_challenges SET status='verified',used=? WHERE id=?").run(clock(),row.id);
        return issue(user.id,'android',req);
      });
      if(result.error)throw result.error;json(res,200,result);return true;
    }
    if(path==='/api/auth/refresh'&&post){
      const data=await body(req);if(!data.refresh_token){data.refresh_token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('volna.refresh='))?.slice('volna.refresh='.length);}
      if(typeof data.refresh_token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.refresh_token))throw fail(401,'Войдите заново');
      const result=transaction(()=>{
        const row=db.prepare('SELECT * FROM refresh_sessions WHERE refresh_hash=? AND expires>?').get(tokenHash(data.refresh_token),clock());
        if(!row)throw fail(401,'Сеанс завершён. Войдите заново');loginCheck(row.user_id);
        const oldToken=row.access_id,token=secret(),refresh=secret(),expires=clock()+3600000;
        const details=db.prepare('SELECT * FROM session_details WHERE token=?').get(oldToken);
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),row.user_id,expires);
        db.prepare('UPDATE refresh_sessions SET refresh_hash=?,access_id=? WHERE id=?').run(tokenHash(refresh),tokenHash(token),row.id);
        db.prepare('INSERT INTO session_details VALUES(?,?,?,?)').run(tokenHash(token),agent(req),details?.created||row.created,clock());
        db.prepare('DELETE FROM sessions WHERE token=?').run(oldToken);disconnect(row.user_id,oldToken);audit('refresh',req,row.user_id);
        return {platform:row.platform,token,access_token:token,refresh_token:refresh,expires,refresh_expires:row.expires,user:userById(row.user_id,true)};
      });deliver(res,result);return true;
    }
    if(path==='/api/auth/qr/request'&&post){
      const data=await body(req);if(!['web','windows'].includes(data.platform))throw fail(400,'Укажите Web или Windows');
      if(db.prepare("SELECT COUNT(*) n FROM auth_audit WHERE event='qr-request' AND ip=? AND created>?").get(ip(req),clock()-60000).n>=10)throw fail(429,'Подождите минуту');
      const id=secret(),scan=secret(),poll=secret(),now=clock();
      db.prepare('INSERT INTO qr_challenges(id,scan_hash,poll_hash,platform,agent,ip,created,expires) VALUES(?,?,?,?,?,?,?,?)').run(id,tokenHash(scan),tokenHash(poll),data.platform,agent(req),ip(req),now,now+180000);
      audit('qr-request',req);json(res,200,{id,poll_token:poll,qr_text:'volna://login/'+scan,expires_in:180});return true;
    }
    if(path==='/api/auth/qr/poll'&&post){
      const data=await body(req),row=db.prepare('SELECT * FROM qr_challenges WHERE id=? AND poll_hash=?').get(String(data.id||''),tokenHash(data.poll_token||''));
      if(!row)throw fail(404,'Попытка входа не найдена');
      if(row.expires<=clock()){db.prepare("UPDATE qr_challenges SET status='expired' WHERE id=? AND status NOT IN ('used','rejected')").run(row.id);json(res,200,{status:'expired'});return true;}
      if(row.status==='approved'){
        const result=transaction(()=>{const current=db.prepare('SELECT * FROM qr_challenges WHERE id=?').get(row.id);if(current.status!=='approved')throw fail(410,'QR уже использован');
          if(!db.prepare('SELECT 1 FROM refresh_sessions r JOIN sessions s ON r.access_id=s.token WHERE r.id=? AND s.user_id=? AND r.platform=\'android\' AND r.expires>?').get(row.approved_by,row.user_id,clock())){db.prepare("UPDATE qr_challenges SET status='rejected' WHERE id=?").run(row.id);return {status:'rejected'};}
          db.prepare("UPDATE qr_challenges SET status='used' WHERE id=?").run(row.id);return {status:'used',...issue(row.user_id,row.platform,req)};});deliver(res,result);
      }else json(res,200,{status:row.status});return true;
    }
    if(['/api/auth/qr/scan','/api/auth/qr/confirm'].includes(path)&&post){
      const session=auth(req);android(session);const data=await body(req);
      const result=transaction(()=>{
        const row=qrForScan(data.qr_text);
        if(path.endsWith('/scan')){
          if(row.user_id&&row.user_id!==session.user_id)throw fail(409,'QR уже отсканирован другим аккаунтом');
          db.prepare("UPDATE qr_challenges SET status='scanned',user_id=? WHERE id=?").run(session.user_id,row.id);
          return {platform:row.platform,device:row.agent,ip:row.ip,expires_at:row.expires};
        }
        if(row.status!=='scanned'||row.user_id!==session.user_id)throw fail(403,'Сначала отсканируйте QR этим аккаунтом');
        if(typeof data.approve!=='boolean')throw fail(400,'Подтвердите или отклоните вход');
        db.prepare('UPDATE qr_challenges SET status=?,approved_by=? WHERE id=?').run(data.approve?'approved':'rejected',db.prepare('SELECT id FROM refresh_sessions WHERE access_id=?').get(session.token).id,row.id);
        audit(data.approve?'qr-approved':'qr-rejected',req,session.user_id);return {success:true};
      });deliver(res,result);return true;
    }
    throw fail(404,'Этот способ входа недоступен');
  }
  function cleanup(){
    const now=clock();for(const [key,row] of limits)if(row.until<now)limits.delete(key);db.prepare('DELETE FROM sessions WHERE token IN (SELECT access_id FROM refresh_sessions WHERE expires<?)').run(now);
    db.prepare('DELETE FROM sms_challenges WHERE created<?').run(now-7*86400000);
    db.prepare('DELETE FROM qr_challenges WHERE expires<?').run(now-3600000);
    db.prepare('DELETE FROM auth_audit WHERE created<?').run(now-30*86400000);
  }
  return {handle,cleanup};
}
