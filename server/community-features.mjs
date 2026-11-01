import {randomBytes} from 'node:crypto';
import {isEmoji} from '../shared/emoji-text.mjs';
export function communityFeatures({db,broadcast,hydrate}){
 const columns=new Set(db.prepare('PRAGMA table_info(chats)').all().map(c=>c.name));
 for(const [name,type]of Object.entries({topic_layout:"TEXT NOT NULL DEFAULT 'tabs'",welcome_message:"TEXT NOT NULL DEFAULT ''",allowed_reactions:'TEXT'}))if(!columns.has(name))db.exec(`ALTER TABLE chats ADD COLUMN ${name} ${type}`);
 db.exec('CREATE TABLE IF NOT EXISTS community_audit(id INTEGER PRIMARY KEY,group_id INTEGER NOT NULL,actor_id INTEGER NOT NULL,action TEXT NOT NULL,target_id INTEGER,created INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS community_audit_group ON community_audit(group_id,created DESC)');
 function record(group,actor,action,target=null){db.prepare('INSERT INTO community_audit(group_id,actor_id,action,target_id,created) VALUES(?,?,?,?,?)').run(group,actor,action,target,Date.now());}
 function settings(data,current){
  const welcome=data.welcome_message??current.welcome_message;
  if(typeof welcome!=='string'||welcome.length>1000)throw Object.assign(Error('Приветственное сообщение: до 1000 символов'),{status:400});
  let reactions=current.allowed_reactions;
  if(data.allowed_reactions!==undefined){const value=data.allowed_reactions;if(value!==null&&(!Array.isArray(value)||value.length>24||new Set(value).size!==value.length||value.some(e=>!isEmoji(e))))throw Object.assign(Error('Выберите до 24 разных реакций'),{status:400});reactions=value===null?null:JSON.stringify(value);}
  return {welcome,reactions};
 }
 function welcome(chat,user){
  const c=db.prepare("SELECT welcome_message FROM chats WHERE id=? AND kind='group'").get(chat);if(!c?.welcome_message)return;
  // A blocked internal sender cannot sign in or acquire group administrator rights.
  let actor=db.prepare("SELECT id FROM users WHERE phone='service:groups'").get();
  if(!actor)actor={id:Number(db.prepare('INSERT INTO users(username,name,phone,admin_blocked,admin_reason) VALUES(?,?,?,?,?)').run('volna_groups_'+randomBytes(8).toString('hex'),'Волна','service:groups',1,'Служебный аккаунт').lastInsertRowid)};
  const name=db.prepare('SELECT name FROM users WHERE id=?').get(user)?.name||'Участник',text=c.welcome_message.replaceAll('{name}',name);
  const id=Number(db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at) VALUES(?,?,?,?,?)').run(chat,actor.id,text,'welcome-'+randomBytes(16).toString('hex'),new Date().toISOString()).lastInsertRowid);
  broadcast(chat,{type:'message',message:hydrate(db.prepare('SELECT * FROM messages WHERE id=?').get(id))});
 }
 function audit(chat){return db.prepare(`SELECT a.*,u.name actor_name,t.name target_name FROM (SELECT id,group_id,actor_id,action,target_id,created FROM community_audit WHERE group_id=? UNION ALL SELECT id,group_id,actor_id,'topic.'||action,topic_id,created FROM topic_audit WHERE group_id=?) a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users t ON t.id=a.target_id AND a.action NOT LIKE 'topic.%' ORDER BY a.created DESC,a.id DESC LIMIT 100`).all(chat,chat);}
 return {record,settings,welcome,audit};
}
