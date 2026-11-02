import {randomBytes} from 'node:crypto';
import {ADMIN_PHONE} from './admin-config.mjs';
import {normalizePhone} from './phone-auth.mjs';
/** A private command chat, available only to the configured administrator's messenger account. */
export function callDebugBot({menus,db,access,broadcast,hydrate,clock=Date.now,adminPhone=process.env.ADMIN_PHONE||ADMIN_PHONE,publicOrigin=process.env.CHAT_DOMAIN?`https://${process.env.CHAT_DOMAIN}`:null}){
 adminPhone=normalizePhone(adminPhone);
 const help='Журнал звонков Волны\n\n/calllog — создать ссылку на журнал на 24 часа\n/revoke — отозвать доступ по ссылке\n/help — показать команды\n\nСсылка показывает текущий журнал и два последних архива, обновляется при каждом открытии и даёт доступ только к диагностике звонков. Новая ссылка отменяет предыдущую. Пришлите ссылку для разбора сбоя.';
 function ensure(uid){
  const admin=db.prepare('SELECT id FROM users WHERE phone=? AND admin_blocked=0').get(adminPhone);if(!admin||uid!==undefined&&uid!==admin.id)return null;
  let actor=db.prepare("SELECT id FROM users WHERE phone='service:call-debug-bot'").get();
  if(!actor)actor={id:Number(db.prepare('INSERT INTO users(username,name,phone,admin_blocked,admin_reason) VALUES(?,?,?,?,?)').run('volna_diagnostics_'+randomBytes(6).toString('hex'),'Волна — диагностика','service:call-debug-bot',1,'Служебный бот: вход запрещён').lastInsertRowid)};
  menus?.register(actor.id,[{command:'/calllog',description:'Ссылка на актуальный журнал на 24 часа'},{command:'/revoke',description:'Отозвать доступ'},{command:'/help',description:'Команды'}],admin.id);
  let chat=db.prepare("SELECT id FROM chats WHERE pair=?").get('call-debug-bot:'+admin.id);
  if(!chat){
   db.exec('BEGIN IMMEDIATE');try{
    chat={id:Number(db.prepare("INSERT INTO chats(pair,kind) VALUES(?,'direct')").run('call-debug-bot:'+admin.id).lastInsertRowid)};
    db.prepare("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'member'),(?,?,'member')").run(chat.id,admin.id,chat.id,actor.id);
    db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(chat.id,actor.id,help,'call-debug-welcome',new Date(clock()).toISOString());db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {admin:admin.id,actor:actor.id,chat:chat.id};
 }
 function message(row){
  const owner=db.prepare('SELECT id FROM users WHERE id=? AND phone=? AND admin_blocked=0').get(row.sender_id,adminPhone);if(!owner)return;
  const info=ensure(owner.id);if(row.chat_id!==info.chat)return;
  // Never release a link into a group or a chat modified to include another reader.
  const members=db.prepare('SELECT user_id FROM members WHERE chat_id=?').all(info.chat);
  if(members.length!==2||members.some(m=>![info.admin,info.actor].includes(m.user_id))||db.prepare('SELECT kind FROM chats WHERE id=?').get(info.chat)?.kind!=='direct')return;
  const key='call-debug-reply:'+row.id;if(db.prepare('SELECT 1 FROM messages WHERE sender_id=? AND client_id=?').get(info.actor,key))return;
  const command=row.text.trim().toLocaleLowerCase('ru-RU');let text=help,reply;
  const audit=(action,target,reason,details={})=>db.prepare('INSERT INTO admin_audit(created,actor,action,target,reason,details) VALUES(?,?,?,?,?,?)').run(clock(),'messenger:'+owner.id,action,target,reason,JSON.stringify(details));
  db.exec('BEGIN IMMEDIATE');try{
   if(['/calllog','/logs','лог','логи'].includes(command)){
    if(!publicOrigin)text='Публичный адрес сайта не настроен. Задайте CHAT_DOMAIN на сервере.';
    else {const link=access.createShare(audit);text=`Журнал звонков:\n${new URL(link.path,publicOrigin).href}\n\nСсылка действует 24 часа, до ${new Date(link.expires).toISOString()} (UTC). Пришлите её для разбора. После первого неудачного и повторного звонка журнал можно открыть по этой же ссылке.\n\n/revoke — отозвать доступ.`;}
   }else if(['/revoke','отозвать'].includes(command)){access.revoke(audit);text='Доступ по ссылке к журналу звонков отозван.';}
   const id=Number(db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(info.chat,info.actor,text,key,new Date(clock()).toISOString()).lastInsertRowid);reply=db.prepare('SELECT * FROM messages WHERE id=?').get(id);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  broadcast(info.chat,{type:'message',message:hydrate(reply)});
 }
 return {ensure,message};
}
