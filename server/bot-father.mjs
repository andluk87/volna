import {randomUUID} from 'node:crypto';
import {canonicalUsername} from './usernames.mjs';

const help=`Я главный бот Волны. Управляю только вашими ботами.
/newbot — создать бота
/mybots — список ваших ботов
/token @username — новый токен (старый перестанет работать)
/revoke @username — отозвать токен
/pause @username — отключить бота
/resume @username — включить бота
/setname @username Название — изменить название
/setdescription @username Описание — изменить описание
/groups @username on|off — разрешить или запретить полное чтение групп
/callbacks @username on|off — разрешить ответы на кнопки (новый токен)
/cancel — отменить создание
/help — помощь

Токены отправляются в этот личный чат и сохраняются в его истории. Не пересылайте их. Доступ к конкретной группе отдельно разрешает её администратор.`;

// Runs inside the outbox transaction: command, state, credentials, reply and
// processed marker commit together. No privileged bot credential is exposed.
export function createBotFather({db,get,owned,info,issue,audit,wake,createBot,defaultScopes}){
 db.exec(`CREATE TABLE IF NOT EXISTS bot_father(singleton BIGINT PRIMARY KEY CHECK(singleton=1),bot_id TEXT UNIQUE NOT NULL REFERENCES bots(id));
 CREATE TABLE IF NOT EXISTS bot_father_sessions(user_id BIGINT PRIMARY KEY REFERENCES users(id),step TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',updated BIGINT NOT NULL);`);
 let ref=db.prepare('SELECT bot_id FROM bot_father WHERE singleton=1').get();
 if(!ref){
  db.exec('BEGIN');
  try{
   // Take the same lock on every startup, including concurrent first starts.
   db.exec('LOCK TABLE bot_father IN EXCLUSIVE MODE');
   ref=db.prepare('SELECT bot_id FROM bot_father WHERE singleton=1').get();
   if(!ref){
    let username='volna_botfather';
    if(db.prepare('SELECT 1 FROM users WHERE username_normalized=?').get(username))username='vlnfather_'+randomUUID().replaceAll('-','').slice(0,16);
    const id=randomUUID(),account=db.prepare("INSERT INTO users(username,name,phone,bio,account_type) VALUES(?,?,?,?,'bot')").run(username,'Главный бот Волны','bot:'+id,'Создание и управление вашими ботами. /help').lastInsertRowid;
    db.prepare('INSERT INTO bots(id,account_id,owner_id,created) VALUES(?,?,?,?)').run(id,account,account,Date.now());
    db.prepare('INSERT INTO bot_father VALUES(1,?)').run(id);ref={bot_id:id};
   }
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 db.prepare('UPDATE bots SET commands=? WHERE id=?').run("[{\"command\":\"newbot\",\"description\":\"Создать бота\"},{\"command\":\"mybots\",\"description\":\"Мои боты\"},{\"command\":\"token\",\"description\":\"Перевыпустить токен: @username\"},{\"command\":\"revoke\",\"description\":\"Отозвать токен: @username\"},{\"command\":\"pause\",\"description\":\"Отключить бота: @username\"},{\"command\":\"resume\",\"description\":\"Включить бота: @username\"},{\"command\":\"setname\",\"description\":\"Изменить название: @username название\"},{\"command\":\"setdescription\",\"description\":\"Описание: @username текст\"},{\"command\":\"groups\",\"description\":\"Полное чтение групп: @username on|off\"},{\"command\":\"callbacks\",\"description\":\"Ответы на кнопки: @username on|off\"},{\"command\":\"cancel\",\"description\":\"Отменить создание\"},{\"command\":\"help\",\"description\":\"Помощь\"}]",ref.bot_id);
 const master=get(ref.bot_id);
 const setState=(uid,step,name='')=>db.prepare('INSERT INTO bot_father_sessions VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET step=excluded.step,name=excluded.name,updated=excluded.updated').run(uid,step,name,Date.now());
 const clear=uid=>db.prepare('DELETE FROM bot_father_sessions WHERE user_id=?').run(uid);
 const tokenText=result=>`Новый токен (предыдущий отозван):\n${result.token}\n\nХраните его в секрете. Он сохранён в истории этого чата.`;
 function command(uid,text){
  const [raw,arg,...rest]=text.trim().split(/\s+/),cmd=raw.toLowerCase(),value=rest.join(' ');
  if(cmd==='/cancel'){clear(uid);return 'Создание отменено. /help — команды.';}
  if(cmd==='/start'||cmd==='/help')return help;
  if(cmd==='/mybots'){
   const bots=db.prepare("SELECT id FROM bots WHERE owner_id=? AND status<>'deleted' ORDER BY created,id").all(uid).map(b=>info(get(b.id)));
   return bots.length?bots.map(b=>`@${b.username} — ${b.display_name} (${b.status==='active'?'включён':'отключён'})`).join('\n'):'У вас пока нет ботов. /newbot — создать.';
  }
  if(cmd==='/newbot'){setState(uid,'name');return 'Введите название нового бота (до 128 символов). /cancel — отмена.';}
  const state=db.prepare('SELECT * FROM bot_father_sessions WHERE user_id=?').get(uid);
  if(state&&state.updated>Date.now()-3600000&&!text.startsWith('/')){
   if(state.step==='name'){
    if(!text.trim()||text.trim().length>128)return 'Название должно содержать от 1 до 128 символов.';
    setState(uid,'username',text.trim());return 'Введите уникальный username: 4–32 латинские буквы, цифры или подчёркивание.';
   }
   const result=createBot(uid,{username:text.trim().replace(/^@/,''),display_name:state.name});clear(uid);
   return `Бот @${result.bot.username} создан.\n${tokenText(result)}\n\nПодключите программу к Bot API. /help — управление.`;
  }
  const actions=['/token','/revoke','/pause','/resume','/setname','/setdescription','/groups','/callbacks'];
  if(!actions.includes(cmd))return 'Неизвестная команда. /help — помощь.';
  const username=canonicalUsername((arg||'').replace(/^@/,''));
  const row=db.prepare('SELECT b.id FROM bots b JOIN users u ON u.id=b.account_id WHERE u.username_normalized=? AND b.owner_id=?').get(username,uid);
  if(!row) return 'Ваш бот не найден. Укажите @username из /mybots.';
  const bot=owned(row.id,uid);if(bot.status==='deleted')return 'Бот удалён.';
  if(cmd==='/token'||cmd==='/groups'||cmd==='/callbacks'){
   const previous=JSON.parse(db.prepare('SELECT scopes FROM bot_tokens WHERE bot_id=? ORDER BY created DESC LIMIT 1').get(bot.id)?.scopes||JSON.stringify(defaultScopes));
   if(cmd!=='/token'&&!['on','off'].includes(value))return 'Использование: '+cmd+' @username on|off. Изменение разрешений перевыпускает токен.';
   const scope=cmd==='/callbacks'?'callbacks:answer':'groups:read_all';
   const allowed=cmd!=='/token'?[...previous.filter(s=>s!==scope),...(value==='on'?[scope]:[])]:previous;
   return tokenText(issue(bot,uid,allowed));
  }
  if(cmd==='/revoke'){
   db.prepare('UPDATE bot_tokens SET revoked=? WHERE bot_id=? AND revoked IS NULL').run(Date.now(),bot.id);audit(bot.id,uid,'token.revoke');wake(bot.id);return `Токен @${bot.username} отозван. /token @${bot.username} — выпустить новый.`;
  }
  if(cmd==='/pause'||cmd==='/resume'){
   db.prepare('UPDATE bots SET status=? WHERE id=?').run(cmd==='/pause'?'suspended':'active',bot.id);audit(bot.id,uid,'bot.update');wake(bot.id);return `Бот @${bot.username} ${cmd==='/pause'?'отключён':'включён'}.`;
  }
  if(cmd==='/setname'&&(!value||value.length>128))return 'Название: от 1 до 128 символов.';
  if(cmd==='/setdescription'&&value.length>1000)return 'Описание: до 1000 символов.';
  if(cmd==='/setname')db.prepare('UPDATE users SET name=? WHERE id=?').run(value,bot.account_id);
  else db.prepare('UPDATE users SET bio=? WHERE id=?').run(value,bot.account_id);
  audit(bot.id,uid,'bot.update');return 'Настройки сохранены.';
 }
 return {id:master.id,accountId:master.account_id,username:master.username,help,command,markup:{inline_keyboard:[[{text:'Создать бота',callback_data:'/newbot'},{text:'Мои боты',callback_data:'/mybots'}],[{text:'Помощь',callback_data:'/help'}]]},process(event){
  if(event.event_type!=='message.created')return null;
  const chat=db.prepare("SELECT c.id FROM chats c JOIN members m ON m.chat_id=c.id WHERE c.id=? AND c.kind='direct' AND c.admin_locked=0 AND c.admin_deleted=0 AND c.encryption_mode='server_readable' AND m.user_id=?").get(event.chat_id,master.account_id);
  if(!chat)return null;
  const user=db.prepare("SELECT id FROM users WHERE id=? AND account_type='user' AND admin_blocked=0").get(event.sender_id);
  const grant=db.prepare('SELECT * FROM bot_chat_grants WHERE bot_id=? AND chat_id=?').get(master.id,event.chat_id);
  const current=db.prepare('SELECT text,deleted_at FROM messages WHERE id=?').get(event.message_id);
  if(!user||get(master.id).status!=='active'||get(master.id).admin_blocked||!db.prepare('SELECT 1 FROM members WHERE chat_id=? AND user_id=?').get(event.chat_id,user.id)||!grant?.active||event.id<=grant.cutoff_id||!current||current.deleted_at)return null;
  const text=JSON.parse(event.payload).text;
  // An edited command must never execute a different action later.
  if(current.text!==text)return null;
  db.exec('SAVEPOINT father_command');
  try{const reply=command(user.id,text);db.exec('RELEASE SAVEPOINT father_command');return reply;}
  catch(e){db.exec('ROLLBACK TO SAVEPOINT father_command');db.exec('RELEASE SAVEPOINT father_command');if(e.status)return e.message;throw e;}
 }};
}
