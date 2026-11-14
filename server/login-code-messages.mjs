import {isIP} from 'node:net';
import {randomBytes,createHmac,createCipheriv,createDecipheriv} from 'node:crypto';

/** Private read-only service channel. Active OTPs are encrypted at rest. */
export function loginCodeMessages({db,broadcast,hydrate,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS login_code_channels(owner INTEGER PRIMARY KEY REFERENCES users(id),chat_id INTEGER UNIQUE NOT NULL REFERENCES chats(id));
 CREATE TABLE IF NOT EXISTS login_code_messages(message_id INTEGER PRIMARY KEY REFERENCES messages(id),challenge_id TEXT UNIQUE NOT NULL,owner INTEGER NOT NULL REFERENCES users(id),cipher BLOB,iv BLOB,tag BLOB);
 CREATE INDEX IF NOT EXISTS login_code_pending ON login_code_messages(message_id) WHERE cipher IS NOT NULL;`);
 if(!db.prepare('PRAGMA table_info(login_code_messages)').all().some(c=>c.name==='challenge_source'))db.exec("ALTER TABLE login_code_messages ADD COLUMN challenge_source TEXT NOT NULL DEFAULT 'sms'");
 const root=db.prepare("SELECT value FROM auth_settings WHERE key='hmac'").get().value,key=createHmac('sha256',root).update('volna-login-service-message-v1').digest();
 const expired='Код входа больше не действует. Для новой попытки запросите новый код в приложении.',placeholder='Служебное сообщение о входе в аккаунт';
 const aad=(id,owner,source)=>Buffer.from(source==='desktop'?`desktop:${id}:${owner}`:`${id}:${owner}`);
 const challenge=row=>{
  if(row.challenge_source==='sms')return db.prepare('SELECT status,expires FROM sms_challenges WHERE id=?').get(row.challenge_id);
  if(row.challenge_source!=='desktop')return null;
  const current=db.prepare('SELECT status,expires FROM desktop_login_challenges WHERE id=?').get(row.challenge_id);
  if(current?.status==='sent'&&!db.prepare('SELECT 1 FROM desktop_login_grants g LEFT JOIN refresh_sessions r ON r.id=g.refresh_id JOIN sessions s ON s.token=CASE WHEN g.refresh_id IS NULL THEN g.access_id ELSE r.access_id END WHERE g.challenge_id=? AND (s.expires>? OR r.expires>?) LIMIT 1').get(row.challenge_id,clock(),clock()))return {...current,status:'revoked'};
  return current;
 };
 function text(row){
  const stored=db.prepare('SELECT * FROM login_code_messages WHERE message_id=?').get(row.id);if(!stored)return null;
  const current=challenge(stored);if(!stored.cipher||current?.status!=='sent'||current.expires<=clock())return expired;
  try{const decipher=createDecipheriv('aes-256-gcm',key,stored.iv);decipher.setAAD(aad(stored.challenge_id,stored.owner,stored.challenge_source));decipher.setAuthTag(stored.tag);const code=Buffer.concat([decipher.update(stored.cipher),decipher.final()]).toString();
   return `Код входа в Волну: ${code}\n\n${stored.challenge_source==='desktop'?'Этот код нужен для входа в Волну на Windows.\n\n':''}Никому не сообщайте этот код, даже если представляются сотрудниками Волны. Код действует 5 минут и только для этой попытки входа.\n\nЕсли вы не запрашивали вход, не передавайте код и проверьте активные устройства.`;
  }catch{return expired;}
 }
 function refresh(){for(const stored of db.prepare('SELECT * FROM login_code_messages WHERE cipher IS NOT NULL').all()){
  const current=challenge(stored);if(current?.status==='sent'&&current.expires>clock())continue;
  db.prepare('UPDATE login_code_messages SET cipher=NULL,iv=NULL,tag=NULL WHERE message_id=?').run(stored.message_id);const row=db.prepare('SELECT * FROM messages WHERE id=?').get(stored.message_id);if(row&&!row.deleted_at)broadcast(row.chat_id,{type:'message-update',message:hydrate(row),notify:false});
 }}
 function channel(owner){
  let actor=db.prepare("SELECT id FROM users WHERE phone='service:login-codes'").get();if(!actor){actor={id:Number(db.prepare('INSERT INTO users(username,name,phone,admin_blocked,admin_reason) VALUES(?,?,?,?,?)').run('volna_security_'+randomBytes(8).toString('hex'),'Волна — служба входа','service:login-codes',1,'Служебный аккаунт: вход запрещён').lastInsertRowid)};}
  let row=db.prepare('SELECT chat_id FROM login_code_channels WHERE owner=?').get(owner);
  if(!row){const id=Number(db.prepare("INSERT INTO chats(pair,kind,title,description,created_by,posting_policy) VALUES(?,'channel',?,?,?,'admins')").run('login-service:'+owner,'Волна — служебные уведомления','Личные уведомления о входе. Никому не передавайте коды.',actor.id).lastInsertRowid);db.prepare('INSERT INTO login_code_channels VALUES(?,?)').run(owner,id);row={chat_id:id};}
  else db.prepare("UPDATE chats SET title='Волна — служебные уведомления' WHERE id=? AND title='Волна — коды входа'").run(row.chat_id);
  db.prepare("INSERT OR IGNORE INTO members(chat_id,user_id,role) VALUES(?,?,'owner')").run(row.chat_id,actor.id);db.prepare("INSERT OR IGNORE INTO members(chat_id,user_id,role) VALUES(?,?,'member')").run(row.chat_id,owner);return {chat:row.chat_id,actor:actor.id};
 }
 function deliver({userId,challengeId,code,source='sms'}){
  if(!Number.isSafeInteger(userId)||!/^\d{6}$/.test(code)||!['sms','desktop'].includes(source))return false;
  if(!db.prepare('SELECT 1 FROM sessions s LEFT JOIN refresh_sessions r ON r.access_id=s.token WHERE s.user_id=? AND (s.expires>? OR r.expires>?) LIMIT 1').get(userId,clock(),clock()))return false;
  const current=source==='desktop'?db.prepare("SELECT id FROM desktop_login_challenges WHERE id=? AND user_id=? AND status='sent' AND expires>? AND phone=(SELECT phone FROM users WHERE id=?)").get(challengeId,userId,clock(),userId):db.prepare("SELECT id FROM sms_challenges WHERE id=? AND purpose='login' AND status='sent' AND expires>? AND phone=(SELECT phone FROM users WHERE id=?)").get(challengeId,clock(),userId);
  if(!current||db.prepare('SELECT 1 FROM login_code_messages WHERE challenge_id=?').get(challengeId))return false;
  let message;db.exec('BEGIN IMMEDIATE');try{
   const {chat,actor}=channel(userId),id=Number(db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(chat,actor,placeholder,'login-code:'+challengeId,new Date(clock()).toISOString()).lastInsertRowid);
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(challengeId,userId,source));const encrypted=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);
   db.prepare('INSERT INTO login_code_messages(message_id,challenge_id,owner,cipher,iv,tag,challenge_source) VALUES(?,?,?,?,?,?,?)').run(id,challengeId,userId,encrypted,iv,cipher.getAuthTag(),source);message=db.prepare('SELECT * FROM messages WHERE id=?').get(id);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  refresh();broadcast(message.chat_id,{type:'message',message:hydrate(message)});return true;
 }
 function newSession({userId,platform,agent,ip,created}){
  if(!Number.isSafeInteger(userId)||platform!=='windows')return;
  let message;db.exec('BEGIN IMMEDIATE');try{const {chat,actor}=channel(userId),text=`Вход с нового устройства\n\nВ ваш аккаунт Волны выполнен вход ${new Date(created).toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC')}.\n\nУстройство: Волна для Windows\n${String(agent||'').replace(/[^\p{L}\p{N} ._()\/-]/gu,'').slice(0,160)}\nIP-адрес: ${isIP(String(ip))?String(ip):'неизвестен'}\n\nЕсли это были не вы, откройте Настройки → Безопасность → Устройства и завершите незнакомый сеанс.`;
   const id=Number(db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(chat,actor,text,'session-login:'+randomBytes(16).toString('hex'),new Date(created).toISOString()).lastInsertRowid);message=db.prepare('SELECT * FROM messages WHERE id=?').get(id);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  broadcast(message.chat_id,{type:'message',message:hydrate(message)});
 }
 return {deliver,text,refresh,newSession};
}
