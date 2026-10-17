import {randomUUID} from 'node:crypto';
const fail=(status,code,message)=>Object.assign(Error(message),{status,code});
const only=(data,keys)=>{if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!keys.includes(k)))throw fail(400,'INVALID_REQUEST','Некорректный запрос');};
const id=value=>{const n=Number(value);if(typeof value==='string'&&!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(n)||n<1||!['string','number'].includes(typeof value))throw fail(400,'INVALID_ID','Некорректный идентификатор');return n;};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalidUnicode=value=>/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export function botInteractions({db,get,access,member,publish,wake,tx,messaging,master}){
 db.exec("CREATE TABLE IF NOT EXISTS bot_callback_actions(id TEXT PRIMARY KEY,bot_id TEXT NOT NULL REFERENCES bots(id),message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,row_index BIGINT NOT NULL,column_index BIGINT NOT NULL,label TEXT NOT NULL,payload TEXT NOT NULL,active BIGINT NOT NULL DEFAULT 1); CREATE INDEX IF NOT EXISTS bot_actions_message ON bot_callback_actions(message_id,active); CREATE TABLE IF NOT EXISTS bot_callback_requests(id TEXT PRIMARY KEY,action_id TEXT NOT NULL REFERENCES bot_callback_actions(id) ON DELETE CASCADE,actor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,interaction_id TEXT NOT NULL,grant_version BIGINT NOT NULL,expires BIGINT NOT NULL,answer TEXT,UNIQUE(actor_id,interaction_id)); CREATE INDEX IF NOT EXISTS bot_callbacks_expiry ON bot_callback_requests(expires);");
 function markup(value){
  if(value===undefined)return undefined;if(value===null)return [];
  only(value,['inline_keyboard']);const rows=value.inline_keyboard;
  if(!Array.isArray(rows)||rows.length>8||rows.some(row=>!Array.isArray(row)||!row.length||row.length>8))throw fail(400,'INVALID_MARKUP','Клавиатура: до 8 строк по 8 кнопок');
  return rows.map(row=>row.map(button=>{
   only(button,['text','callback_data']);
   if(typeof button.text!=='string'||!button.text.trim()||Array.from(button.text).length>64||typeof button.callback_data!=='string'||Buffer.byteLength(button.callback_data,'utf8')<1||Buffer.byteLength(button.callback_data,'utf8')>128||invalidUnicode(button.text)||invalidUnicode(button.callback_data)||button.text.includes('\0')||button.callback_data.includes('\0'))throw fail(400,'INVALID_MARKUP','Название: 1–64 символа, callback_data: 1–128 байт UTF-8');
   return {text:button.text,callback_data:button.callback_data};
  }));
 }
 function setMarkup(message,bot,rows){
  if(rows===undefined)return;
  db.prepare('UPDATE bot_callback_actions SET active=0 WHERE message_id=?').run(message.id);
  rows.forEach((row,r)=>row.forEach((button,c)=>db.prepare('INSERT INTO bot_callback_actions(id,bot_id,message_id,row_index,column_index,label,payload) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),bot.id,message.id,r,c,button.text,button.callback_data)));
 }
 function buttons(message){
  if(!message||message.deleted_at)return [];
  const rows=[];for(const b of db.prepare('SELECT id,row_index,label FROM bot_callback_actions WHERE message_id=? AND active=1 ORDER BY row_index,column_index').all(message.id)){(rows[b.row_index]??=[]).push({id:b.id,text:b.label});}return rows;
 }
 function allowed(action,actor,version){
  const bot=get(action.bot_id);if(!bot)throw fail(404,'CALLBACK_NOT_FOUND','Кнопка недоступна');
  const chat=access(bot,action.chat_id);member(action.chat_id,actor);
  const hidden=db.prepare('SELECT hidden_before FROM chat_visibility WHERE chat_id=? AND user_id=?').get(action.chat_id,actor)?.hidden_before||0;
  const user=db.prepare("SELECT account_type,admin_blocked FROM users WHERE id=?").get(actor);
  if(!user||user.account_type!=='user'||user.admin_blocked||!action.active||action.deleted_at||action.message_id<=hidden||version!==undefined&&chat.version!==version)throw fail(403,'CALLBACK_ACCESS_DENIED','Кнопка недоступна');
  return {bot,chat};
 }
 const actionFor=actionId=>db.prepare('SELECT a.*,m.chat_id,m.deleted_at FROM bot_callback_actions a JOIN messages m ON m.id=a.message_id WHERE a.id=?').get(actionId);
 function requestFor(callback,actor){
  const row=db.prepare('SELECT * FROM bot_callback_requests WHERE id=?').get(callback);
  if(!row||actor!==undefined&&row.actor_id!==actor)throw fail(404,'CALLBACK_NOT_FOUND','Нажатие не найдено');
  const action=actionFor(row.action_id);if(!action)throw fail(404,'CALLBACK_NOT_FOUND','Кнопка недоступна');
  const policy=allowed(action,row.actor_id,row.grant_version);return {row,action,...policy};
 }
 const status=row=>({callback_id:row.id,status:row.answer?'answered':row.expires<=Date.now()?'expired':'pending',expires_at:row.expires,...(row.answer?{answer:JSON.parse(row.answer)}:{})});
 function create(actor,data){
  only(data,['message_id','button_id','interaction_id']);
  if(!uuid(data.button_id)||typeof data.interaction_id!=='string'||!/^[a-zA-Z0-9._:-]{16,128}$/.test(data.interaction_id))throw fail(400,'INVALID_INTERACTION','Нужны button_id и уникальный interaction_id');
  const message=id(data.message_id);
  return tx(()=>{
   const action=actionFor(data.button_id);if(!action||action.message_id!==message)throw fail(404,'CALLBACK_NOT_FOUND','Кнопка недоступна');
   const {bot,chat}=allowed(action,actor);
   const old=db.prepare('SELECT * FROM bot_callback_requests WHERE actor_id=? AND interaction_id=?').get(actor,data.interaction_id);
   if(old){if(old.action_id!==action.id)throw fail(409,'INTERACTION_CONFLICT','Идентификатор нажатия уже использован');requestFor(old.id,actor);return {response:status(old)};}
   const callback=randomUUID(),expires=Date.now()+120000;
   db.prepare('INSERT INTO bot_callback_requests(id,action_id,actor_id,interaction_id,grant_version,expires) VALUES(?,?,?,?,?,?)').run(callback,action.id,actor,data.interaction_id,chat.version,expires);
   if(bot.id===master.id){
    const text=master.command(actor,action.payload,chat.id),sent=messaging.insert(chat.id,bot.account_id,{text,client_id:randomUUID()});
    setMarkup(sent.row,bot,markup(master.markup));
    db.prepare('UPDATE bot_callback_requests SET answer=? WHERE id=?').run(JSON.stringify({text:'',show_alert:false}),callback);
    return {response:status(db.prepare('SELECT * FROM bot_callback_requests WHERE id=?').get(callback)),message:sent.row};
   }
   const actorInfo=db.prepare('SELECT id,username,name FROM users WHERE id=?').get(actor);
   const next=db.prepare('UPDATE bots SET last_update_id=last_update_id+1 WHERE id=? RETURNING last_update_id').get(bot.id).last_update_id;
   const eventData={callback_id:callback,message_id:String(message),button_id:action.id,actor:{id:String(actor),username:actorInfo.username,display_name:actorInfo.name},data:action.payload,expires_at:expires};
   const payload={update_id:next,event_id:'callback_'+callback,event_type:'callback.created',api_version:'1',bot_id:bot.id,occurred_at:new Date().toISOString(),chat_id:String(chat.id),chat_sequence:db.prepare("SELECT nextval(pg_get_serial_sequence('bot_message_outbox','id')) AS n").get().n,data:eventData};
   db.prepare('INSERT INTO bot_updates(bot_id,update_id,event_id,event_type,chat_id,grant_version,restricted_allowed,payload,expires) VALUES(?,?,?,?,?,?,?,?,?)').run(bot.id,next,payload.event_id,payload.event_type,chat.id,chat.version,1,JSON.stringify(payload),expires);
   return {response:status({id:callback,expires,answer:null}),bot:bot.id};
  });
 }
 function answer(bot,callback,data){
  only(data,['text','show_alert']);
  const text=data.text??'',show_alert=data.show_alert??false;
  if(typeof text!=='string'||Array.from(text).length>200||typeof show_alert!=='boolean')throw fail(400,'INVALID_ANSWER','Ответ: до 200 символов и show_alert boolean');
  return tx(()=>{
   const found=db.prepare('SELECT a.bot_id FROM bot_callback_requests r JOIN bot_callback_actions a ON a.id=r.action_id WHERE r.id=?').get(callback);
   if(!found||found.bot_id!==bot.id)throw fail(404,'CALLBACK_NOT_FOUND','Нажатие не найдено');
   const {row}=requestFor(callback);if(row.expires<=Date.now())throw fail(410,'CALLBACK_EXPIRED','Время ответа истекло');
   const response=JSON.stringify({text,show_alert});
   if(row.answer){if(row.answer!==response)throw fail(409,'CALLBACK_ALREADY_ANSWERED','Ответ уже отправлен');return null;}
   db.prepare('UPDATE bot_callback_requests SET answer=? WHERE id=?').run(response,callback);
   return {actor:row.actor_id,event:{type:'bot-callback-answer',callback_id:callback,...JSON.parse(response)}};
  });
 }
 return {markup,setMarkup,buttons,create,answer,
  emit(result){if(result.message)messaging.publish(result.message);if(result.bot)wake(result.bot);if(result.event)publish([result.actor],result.event);},
  getStatus(callback,actor){return status(requestFor(callback,actor).row);},
  deliverable(payload){try{const {row}=requestFor(payload.data.callback_id);return !row.answer&&row.expires>Date.now();}catch(e){if(e.status)return false;throw e;}},
  commands(chat,actor){member(chat,actor);const rows=db.prepare('SELECT b.id FROM bots b JOIN bot_chat_grants g ON g.bot_id=b.id WHERE g.chat_id=? AND g.active=1').all(chat);return rows.flatMap(b=>{try{const bot=get(b.id);access(bot,chat);return [{bot_id:bot.id,username:bot.username,commands:JSON.parse(bot.commands)}];}catch(e){if(e.status)return [];throw e;}});},
  cleanup(){db.prepare('DELETE FROM bot_callback_requests WHERE expires<?').run(Date.now()-86400000);db.prepare('DELETE FROM bot_callback_actions a WHERE a.active=0 AND NOT EXISTS(SELECT 1 FROM bot_callback_requests r WHERE r.action_id=a.id)').run();}
 };
}
