import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const fail=(status,message,code,retryAt)=>Object.assign(Error(message),{status,code,...(retryAt?{retry_at:retryAt}:{})});
/** Existing-account login only; OTP delivery is private and independent of SMS. */
export function desktopAuth({db,body,json,clock,normalizePhone,hmac,codeGenerator,ip,audit,transaction,issue,deliver,onLoginCode,onChallengeChanged,loginCheck,log}){
 db.exec(`CREATE TABLE IF NOT EXISTS desktop_login_challenges(id TEXT PRIMARY KEY,phone TEXT NOT NULL,user_id INTEGER REFERENCES users(id),code_hash TEXT NOT NULL,verify_hash TEXT NOT NULL,request_id TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,ip TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS desktop_login_request ON desktop_login_challenges(phone,request_id);
 CREATE INDEX IF NOT EXISTS desktop_login_phone ON desktop_login_challenges(phone,created);
 CREATE INDEX IF NOT EXISTS desktop_login_ip ON desktop_login_challenges(ip,created);
 CREATE TABLE IF NOT EXISTS desktop_login_grants(challenge_id TEXT NOT NULL REFERENCES desktop_login_challenges(id) ON DELETE CASCADE,access_id TEXT NOT NULL,refresh_id TEXT,PRIMARY KEY(challenge_id,access_id));`);
 const info=row=>({challenge_id:row.id,delivery:'service',expires_at:row.expires,expires_in:Math.max(0,Math.ceil((row.expires-clock())/1000)),resend_available_at:row.created+60000,server_time:clock()});
 const validSecret=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
 const owned=data=>{if(!validSecret(data.client_secret))throw fail(401,'Попытка входа недоступна','CHALLENGE_UNAVAILABLE');const row=db.prepare('SELECT * FROM desktop_login_challenges WHERE id=? AND verify_hash=?').get(String(data.challenge_id||''),hash(data.client_secret));if(!row)throw fail(401,'Попытка входа недоступна','CHALLENGE_UNAVAILABLE');return row;};
 return async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/auth/desktop/'))return false;
  if(req.method!=='POST')throw fail(405,'Метод не поддерживается','METHOD_NOT_ALLOWED');
  const data=await body(req),path=url.pathname;
  if(path==='/api/auth/desktop/request'){
   const phone=normalizePhone(data.phone),now=clock(),address=ip(req);
   if(!validSecret(data.client_secret)||typeof data.request_id!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(data.request_id))throw fail(400,'Некорректная попытка входа','INVALID_REQUEST');
   let code,duplicate=false;
   const row=transaction(()=>{
    const old=db.prepare('SELECT * FROM desktop_login_challenges WHERE phone=? AND request_id=?').get(phone,data.request_id);
    if(old){if(old.verify_hash!==hash(data.client_secret))throw fail(401,'Попытка входа недоступна','CHALLENGE_UNAVAILABLE');if(old.status!=='sent'||old.expires<=now)throw fail(410,'Запросите новый код','CODE_EXPIRED');duplicate=true;return old;}
    const recent=db.prepare('SELECT * FROM desktop_login_challenges WHERE phone=? ORDER BY created DESC LIMIT 1').get(phone);
    if(recent&&now<recent.created+60000)throw fail(429,'Запросить код повторно можно через минуту','RATE_LIMITED',recent.created+60000);
    const phoneRate=db.prepare('SELECT COUNT(*) n FROM desktop_login_challenges WHERE phone=? AND created>?').get(phone,now-3600000).n;
    const ipRate=db.prepare('SELECT COUNT(*) n FROM desktop_login_challenges WHERE ip=? AND created>?').get(address,now-3600000).n;
    if(phoneRate>=5||ipRate>=30)throw fail(429,'Слишком много попыток входа. Повторите позже','RATE_LIMITED',now+3600000);
    const user=db.prepare('SELECT id FROM users WHERE phone=? AND admin_blocked=0').get(phone),id=randomBytes(32).toString('base64url');
    for(let n=0;n<100;n++){code=codeGenerator();if(!/^\d{6}$/.test(code))throw Error('Invalid login code generator');if(!recent||hmac(phone,code,recent.id)!==recent.code_hash)break;if(n===99)throw Error('Repeated login code');}
    db.prepare("UPDATE desktop_login_challenges SET status='expired' WHERE phone=? AND status='sent'").run(phone);
    db.prepare('INSERT INTO desktop_login_challenges(id,phone,user_id,code_hash,verify_hash,request_id,created,expires,status,ip) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,phone,user?.id||null,hmac(phone,code,id),hash(data.client_secret),data.request_id,now,now+300000,'sent',address);
    if(user)db.prepare('INSERT INTO desktop_login_grants(challenge_id,access_id,refresh_id) SELECT ?,s.token,r.id FROM sessions s LEFT JOIN refresh_sessions r ON r.access_id=s.token WHERE s.user_id=? AND (s.expires>? OR r.expires>?)').run(id,user.id,now,now);
    audit('desktop-code-request',req);return db.prepare('SELECT * FROM desktop_login_challenges WHERE id=?').get(id);
   });
   if(!duplicate&&row.user_id){try{onLoginCode({source:'desktop',userId:row.user_id,challengeId:row.id,code});}catch{log({event:'service-code-delivery-failed'});}}
   try{onChallengeChanged();}catch{}
   // The same public response also covers unknown numbers and accounts without a device.
   json(res,200,info(row));return true;
  }
  if(path==='/api/auth/desktop/cancel'){
   const row=owned(data);db.prepare("UPDATE desktop_login_challenges SET status='cancelled' WHERE id=? AND status='sent'").run(row.id);try{onChallengeChanged();}catch{}json(res,200,{ok:true});return true;
  }
  if(path==='/api/auth/desktop/verify'){
   const row=owned(data);if(typeof data.code!=='string'||!/^\d{6}$/.test(data.code))throw fail(400,'Введите шесть цифр из служебного сообщения','INVALID_CODE');
   const result=transaction(()=>{
    const current=db.prepare('SELECT * FROM desktop_login_challenges WHERE id=?').get(row.id);
    if(current.status!=='sent'||current.expires<=clock())return {error:fail(410,'Код истёк или уже использован. Запросите новый','CODE_EXPIRED')};
    const actual=Buffer.from(hmac(current.phone,data.code,current.id),'hex');
    if(!timingSafeEqual(actual,Buffer.from(current.code_hash,'hex'))){db.prepare("UPDATE desktop_login_challenges SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'blocked' ELSE status END WHERE id=?").run(current.id);audit('desktop-code-invalid',req);return {error:fail(400,'Неверный код',current.attempts+1>=5?'ATTEMPTS_EXCEEDED':'INVALID_CODE')};}
    const user=db.prepare('SELECT id FROM users WHERE id=? AND phone=?').get(current.user_id,current.phone);if(!user)return {error:fail(410,'Запросите новый код','CODE_EXPIRED')};loginCheck(user.id);
    if(!db.prepare('SELECT 1 FROM desktop_login_grants g LEFT JOIN refresh_sessions r ON r.id=g.refresh_id JOIN sessions s ON s.token=CASE WHEN g.refresh_id IS NULL THEN g.access_id ELSE r.access_id END WHERE g.challenge_id=? AND s.user_id=? AND (s.expires>? OR r.expires>?) LIMIT 1').get(current.id,user.id,clock(),clock())){db.prepare("UPDATE desktop_login_challenges SET status='cancelled' WHERE id=?").run(current.id);return {error:fail(410,'Войдите в Волну на телефоне и запросите новый код','CODE_EXPIRED')};}
    db.prepare("UPDATE desktop_login_challenges SET status='verified' WHERE id=?").run(current.id);return issue(user.id,'windows',req);
   });
   try{onChallengeChanged();}catch{}if(result.error)throw result.error;deliver(req,res,result);return true;
  }
  throw fail(404,'Не найдено','NOT_FOUND');
 };
}
