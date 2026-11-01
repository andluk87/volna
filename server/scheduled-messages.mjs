const fail=(status,message)=>Object.assign(Error(message),{status});
export function scheduledMessages({db,member,canPublish,send,isOnline=()=>false,canSeePresence=()=>false,publish,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS scheduled_messages(id INTEGER PRIMARY KEY,sender INTEGER NOT NULL,chat_id INTEGER NOT NULL,payload TEXT NOT NULL,due INTEGER NOT NULL,when_online INTEGER NOT NULL DEFAULT 0,peer INTEGER,status TEXT NOT NULL DEFAULT 'pending',error TEXT,created INTEGER NOT NULL,client_id TEXT NOT NULL,UNIQUE(sender,client_id));
 CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_messages(status,due);
 CREATE TABLE IF NOT EXISTS scheduled_files(job INTEGER NOT NULL REFERENCES scheduled_messages(id) ON DELETE CASCADE,file TEXT NOT NULL REFERENCES attachments(id),PRIMARY KEY(job,file));`);
 function notify(uid){publish([uid],{type:'scheduled'});}
 function validate(chat,uid,payload){
  if(db.prepare('SELECT admin_blocked FROM users WHERE id=?').get(uid)?.admin_blocked)throw fail(403,'Аккаунт заблокирован');
  member(chat,uid);canPublish(chat,uid);
  if(typeof payload.text!=='string'||payload.text.length>4000||!payload.text.trim()&&!payload.attachment_id&&!payload.attachment_ids?.length)throw fail(400,'Введите текст или прикрепите файл');
  const ids=payload.attachment_ids||[payload.attachment_id].filter(Boolean);
  if(!Array.isArray(ids)||payload.attachment_ids!==undefined&&ids.length===0||ids.length>10||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{48}$/.test(id)))throw fail(400,'Некорректные вложения');
  for(const id of ids){const f=db.prepare('SELECT owner_id,admin_blocked FROM attachments WHERE id=?').get(id);if(!f||f.owner_id!==uid||f.admin_blocked||db.prepare('SELECT 1 FROM messages WHERE attachment_id=?').get(id))throw fail(403,'Вложение недоступно для отправки');}
  return ids;
 }
 function create(chat,uid,data){
  if(typeof data.client_id!=='string'||!/^[a-zA-Z0-9-]{16,48}$/.test(data.client_id)||typeof data.when_online!=='boolean'&&data.when_online!==undefined)throw fail(400,'Некорректный запрос отложенной отправки');
  const payload=Object.fromEntries(['text','attachment_id','attachment_ids','reply_to','reply_quote','emoji_entities','silent','effect','client_id'].filter(key=>data[key]!==undefined).map(key=>[key,data[key]]));payload.text=String(payload.text||'');
  if(payload.silent!==undefined&&typeof payload.silent!=='boolean'||payload.effect!==undefined&&!['👍','👎','❤️','🔥','🎉','💩','🥰'].includes(payload.effect))throw fail(400,'Некорректные параметры сообщения');
  const online=data.when_online===true,due=online?0:Number(data.schedule_at);
  let peer=null;
  if(online){if(db.prepare('SELECT kind FROM chats WHERE id=?').get(chat)?.kind!=='direct')throw fail(400,'Ожидание активности доступно только в личном чате');peer=db.prepare('SELECT user_id FROM members WHERE chat_id=? AND user_id<>?').get(chat,uid)?.user_id;if(!peer||!canSeePresence(uid,peer))throw fail(403,'Статус активности этого контакта недоступен');}
  const encoded=JSON.stringify(payload),old=db.prepare('SELECT * FROM scheduled_messages WHERE sender=? AND client_id=?').get(uid,data.client_id);
  if(old){if(old.chat_id!==chat||old.payload!==encoded||old.due!==due||old.when_online!==Number(online))throw fail(409,'Идентификатор уже использован');return old;}
  if(!online&&(!Number.isSafeInteger(due)||due<clock()+1000||due>clock()+366*86400000))throw fail(400,'Выберите время в течение ближайшего года');
  const files=validate(chat,uid,payload);
  if(db.prepare("SELECT COUNT(*) n FROM scheduled_messages WHERE sender=? AND status IN ('pending','failed')").get(uid).n>=100)throw fail(409,'Не более 100 отложенных сообщений');
  db.exec('BEGIN IMMEDIATE');let id;try{id=Number(db.prepare('INSERT INTO scheduled_messages(sender,chat_id,payload,due,when_online,peer,created,client_id) VALUES(?,?,?,?,?,?,?,?)').run(uid,chat,encoded,due,Number(online),peer,clock(),data.client_id).lastInsertRowid);for(const file of files)db.prepare('INSERT INTO scheduled_files VALUES(?,?)').run(id,file);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  notify(uid);return db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(id);
 }
 let onlineCursor=0;
 function tick(){
  const due=db.prepare("SELECT * FROM scheduled_messages WHERE status='pending' AND when_online=0 AND due<=? ORDER BY due,id LIMIT 100").all(clock());
  let waiting=db.prepare("SELECT * FROM scheduled_messages WHERE status='pending' AND when_online=1 AND id>? ORDER BY id LIMIT 100").all(onlineCursor);
  if(!waiting.length){onlineCursor=0;waiting=db.prepare("SELECT * FROM scheduled_messages WHERE status='pending' AND when_online=1 ORDER BY id LIMIT 100").all();}
  if(waiting.length)onlineCursor=waiting.at(-1).id;
  for(const job of [...due,...waiting]){
   try{
    if(job.when_online){if(!canSeePresence(job.sender,job.peer))throw fail(403,'Статус активности контакта больше недоступен');if(!isOnline(job.peer))continue;}
    const payload=JSON.parse(job.payload);validate(job.chat_id,job.sender,payload);
    let messages;db.exec('BEGIN IMMEDIATE');try{if(db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(job.id)?.status!=='pending'){db.exec('ROLLBACK');continue;}messages=send(job.chat_id,job.sender,payload);db.prepare("UPDATE scheduled_messages SET status='sent',error=NULL WHERE id=?").run(job.id);db.prepare('DELETE FROM scheduled_files WHERE job=?').run(job.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    for(const message of messages)publish(null,{scheduledDelivery:true,message});notify(job.sender);
   }catch(e){db.prepare("UPDATE scheduled_messages SET status='failed',error=? WHERE id=? AND status='pending'").run(e.status?e.message:'Не удалось отправить сообщение',job.id);notify(job.sender);}
  }
 }
 function list(uid,chat){member(chat,uid);return db.prepare("SELECT id,chat_id,payload,due,when_online,status,error,created FROM scheduled_messages WHERE sender=? AND chat_id=? AND status<>'sent' ORDER BY due,id").all(uid,chat).map(j=>({...j,payload:JSON.parse(j.payload)}));}
 function cancel(uid,id){const job=db.prepare('SELECT * FROM scheduled_messages WHERE id=? AND sender=?').get(id,uid);if(!job)throw fail(404,'Отложенное сообщение не найдено');if(job.status==='sent')throw fail(409,'Сообщение уже отправлено');db.prepare('DELETE FROM scheduled_messages WHERE id=?').run(id);notify(uid);}
 function sendNow(uid,id){const job=db.prepare('SELECT * FROM scheduled_messages WHERE id=? AND sender=?').get(id,uid);if(!job)throw fail(404,'Сообщение не найдено');if(job.status==='sent')throw fail(409,'Сообщение уже отправлено');validate(job.chat_id,uid,JSON.parse(job.payload));db.prepare("UPDATE scheduled_messages SET status='pending',when_online=0,due=?,error=NULL WHERE id=?").run(clock(),id);tick();}
 const timer=setInterval(tick,1000);timer.unref();return {create,list,cancel,sendNow,tick,close:()=>clearInterval(timer)};
}
