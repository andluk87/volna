import {randomBytes,createHmac,createCipheriv,createDecipheriv} from 'node:crypto';

/** Private read-only service channels. OTPs are encrypted at rest, and shown only while valid. */
export function loginCodeMessages({db,broadcast,hydrate,clock=Date.now}) {
 db.exec(`CREATE TABLE IF NOT EXISTS login_code_channels(owner INTEGER PRIMARY KEY REFERENCES users(id),chat_id INTEGER UNIQUE NOT NULL REFERENCES chats(id));
 CREATE TABLE IF NOT EXISTS login_code_messages(message_id INTEGER PRIMARY KEY REFERENCES messages(id),challenge_id TEXT UNIQUE NOT NULL,owner INTEGER NOT NULL REFERENCES users(id),cipher BLOB,iv BLOB,tag BLOB);
 CREATE INDEX IF NOT EXISTS login_code_pending ON login_code_messages(message_id) WHERE cipher IS NOT NULL;`);
 const root=db.prepare("SELECT value FROM auth_settings WHERE key='hmac'").get().value;
 const key=createHmac('sha256',root).update('volna-login-service-message-v1').digest();
 const expired='Код входа больше не действует. Для новой попытки запросите новый код в приложении.';
 const placeholder='Служебное сообщение о входе в аккаунт';
 const aad=(id,owner)=>Buffer.from(`${id}:${owner}`);
 function text(row){
  const stored=db.prepare('SELECT * FROM login_code_messages WHERE message_id=?').get(row.id);
  if(!stored)return null;
  const challenge=db.prepare('SELECT status,expires FROM sms_challenges WHERE id=?').get(stored.challenge_id);
  if(!stored.cipher||challenge?.status!=='sent'||challenge.expires<=clock())return expired;
  try{
   const decipher=createDecipheriv('aes-256-gcm',key,stored.iv);decipher.setAAD(aad(stored.challenge_id,stored.owner));decipher.setAuthTag(stored.tag);
   const code=Buffer.concat([decipher.update(stored.cipher),decipher.final()]).toString();
   return `Код входа в Волну: ${code}\n\nНикому не сообщайте этот код, даже если представляются сотрудниками Волны. Код действует 5 минут и только для этой попытки входа.\n\nЕсли вы не запрашивали вход, не передавайте код и проверьте активные устройства.`;
  }catch{return expired;}
 }
 function refresh(){
  const rows=db.prepare("SELECT l.message_id FROM login_code_messages l LEFT JOIN sms_challenges s ON s.id=l.challenge_id WHERE l.cipher IS NOT NULL AND (s.id IS NULL OR s.status<>'sent' OR s.expires<=?)").all(clock());
  for(const {message_id} of rows){
   db.prepare('UPDATE login_code_messages SET cipher=NULL,iv=NULL,tag=NULL WHERE message_id=?').run(message_id);
   const row=db.prepare('SELECT * FROM messages WHERE id=?').get(message_id);
   if(row&&!row.deleted_at)broadcast(row.chat_id,{type:'message-update',message:hydrate(row),notify:false});
  }
 }
 function deliver({userId,challengeId,code}){
  if(!Number.isSafeInteger(userId)||!/^\d{6}$/.test(code))return;
  // No delivery to another account, a new registration, or a fully revoked account.
  if(!db.prepare('SELECT 1 FROM sessions s LEFT JOIN refresh_sessions r ON r.access_id=s.token WHERE s.user_id=? AND (s.expires>? OR r.expires>?) LIMIT 1').get(userId,clock(),clock()))return;
  const challenge=db.prepare("SELECT id FROM sms_challenges WHERE id=? AND purpose='login' AND status='sent' AND expires>? AND phone=(SELECT phone FROM users WHERE id=?)").get(challengeId,clock(),userId);
  if(!challenge||db.prepare('SELECT 1 FROM login_code_messages WHERE challenge_id=?').get(challengeId))return;
  let message;
  db.exec('BEGIN IMMEDIATE');
  try{
   let actor=db.prepare("SELECT id FROM users WHERE phone='service:login-codes'").get();
   if(!actor){const suffix=randomBytes(8).toString('hex');actor={id:Number(db.prepare('INSERT INTO users(username,name,phone,admin_blocked,admin_reason) VALUES(?,?,?,?,?)').run('volna_security_'+suffix,'Волна — служба входа','service:login-codes',1,'Служебный аккаунт: вход запрещён').lastInsertRowid)};}
   let channel=db.prepare('SELECT chat_id FROM login_code_channels WHERE owner=?').get(userId);
   if(!channel){const id=Number(db.prepare("INSERT INTO chats(pair,kind,title,description,created_by,posting_policy) VALUES(?,'channel',?,?,?,'admins')").run('login-service:'+userId,'Волна — коды входа','Личные служебные сообщения о входе. Никому не передавайте коды.',actor.id).lastInsertRowid);db.prepare('INSERT INTO login_code_channels VALUES(?,?)').run(userId,id);channel={chat_id:id};}
   db.prepare("INSERT OR IGNORE INTO members(chat_id,user_id,role) VALUES(?,?,'owner')").run(channel.chat_id,actor.id);
   db.prepare("INSERT OR IGNORE INTO members(chat_id,user_id,role) VALUES(?,?,'member')").run(channel.chat_id,userId);
   const id=Number(db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(channel.chat_id,actor.id,placeholder,'login-code:'+challengeId,new Date(clock()).toISOString()).lastInsertRowid);
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(challengeId,userId));const encrypted=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);
   db.prepare('INSERT INTO login_code_messages VALUES(?,?,?,?,?,?)').run(id,challengeId,userId,encrypted,iv,cipher.getAuthTag());
   message=db.prepare('SELECT * FROM messages WHERE id=?').get(id);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  refresh();
  broadcast(message.chat_id,{type:'message',message:hydrate(message)});
 }
 return {deliver,text,refresh};
}
