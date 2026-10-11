import {randomBytes} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function mentioned(text,username){return new RegExp('(^|[^a-z0-9_])@'+username+'(?![a-z0-9_])','i').test(String(text||''));}
export function topicNotification(db,chat,uid,text,replyTo=null){
 const user=db.prepare('SELECT username FROM users WHERE id=?').get(uid);if(!user)return false;
 const c=db.prepare('SELECT parent_id FROM chats WHERE id=?').get(chat),own=db.prepare('SELECT * FROM chat_preferences WHERE chat_id=? AND user_id=?').get(chat,uid),parent=c?.parent_id?db.prepare('SELECT * FROM chat_preferences WHERE chat_id=? AND user_id=?').get(c.parent_id,uid):null;
 if(own?.muted)return false;
 const override=own?.notification_override||own?.notification_mode&&own.notification_mode!=='all'&&own.notification_mode!=='inherit';
 const preference=override?own:parent||own,mode=preference?.notification_mode||'all';
 if(preference?.muted||mode==='none')return false;
 return mode!=='mentions'||mentioned(text,user.username)||!!(replyTo&&db.prepare('SELECT 1 FROM messages WHERE id=? AND chat_id=? AND sender_id=? AND deleted_at IS NULL').get(replyTo,chat,uid));
}
export function topics({db,body,json,member,broadcast,publish}){
 const preferenceColumns=new Set(db.prepare('PRAGMA table_info(chat_preferences)').all().map(c=>c.name));
 if(!preferenceColumns.has('notification_override'))db.exec('ALTER TABLE chat_preferences ADD COLUMN notification_override INTEGER NOT NULL DEFAULT 0');
 db.exec(`CREATE TRIGGER IF NOT EXISTS topic_member_add AFTER INSERT ON members BEGIN
 INSERT OR IGNORE INTO members(chat_id,user_id,role) SELECT id,NEW.user_id,NEW.role FROM chats WHERE parent_id=NEW.chat_id AND topic_deleted=0; END;
 CREATE TRIGGER IF NOT EXISTS topic_member_remove AFTER DELETE ON members BEGIN
 DELETE FROM members WHERE user_id=OLD.user_id AND chat_id IN (SELECT id FROM chats WHERE parent_id=OLD.chat_id); END;
 CREATE TRIGGER IF NOT EXISTS topic_member_role AFTER UPDATE OF role ON members BEGIN
 UPDATE members SET role=NEW.role WHERE user_id=NEW.user_id AND chat_id IN (SELECT id FROM chats WHERE parent_id=NEW.chat_id AND topic_deleted=0); END;
 CREATE TRIGGER IF NOT EXISTS topic_posting_policy AFTER UPDATE OF posting_policy ON chats BEGIN
 UPDATE chats SET posting_policy=NEW.posting_policy WHERE parent_id=NEW.id; END;`);
 const group=(id,uid)=>{member(id,uid);const c=db.prepare('SELECT c.*,m.role FROM chats c JOIN members m ON m.chat_id=c.id AND m.user_id=? WHERE c.id=?').get(uid,id);if(c.kind!=='group'||c.parent_id)throw fail(400,'Темы доступны в основной группе');return c;};
 const get=(gid,id,uid)=>{group(gid,uid);const c=id===gid?db.prepare('SELECT * FROM chats WHERE id=?').get(gid):db.prepare('SELECT * FROM chats WHERE id=? AND parent_id=? AND topic_deleted=0 AND admin_deleted=0').get(id,gid);if(!c)throw fail(404,'Тема не найдена');member(id,uid);return c;};
 const canManage=(c,g,uid)=>g.role==='owner'||g.role==='admin'||c.created_by===uid;
 const fields=data=>{if(data.description!==undefined&&typeof data.description!=='string'||data.icon!==undefined&&typeof data.icon!=='string')throw fail(400,'Описание и иконка должны быть текстом');const name=typeof data.name==='string'?data.name.trim():'',description=typeof data.description==='string'?data.description.trim():'',icon=typeof data.icon==='string'?data.icon.trim():'';if(!name||name.length>80||description.length>1000||icon.length>16)throw fail(400,'Название: 1–80, описание: до 1000, иконка: до 16 символов');return {name,description,icon};};
 const summary=(c,g,uid)=>{
 const general=c.id===g.id,preference=db.prepare('SELECT * FROM chat_preferences WHERE chat_id=? AND user_id=?').get(c.id,uid),unread=db.prepare('SELECT COUNT(*) n FROM messages WHERE chat_id=? AND deleted_at IS NULL AND sender_id<>? AND id>MAX(COALESCE((SELECT last_read FROM members WHERE chat_id=? AND user_id=?),0),COALESCE((SELECT hidden_before FROM chat_visibility WHERE chat_id=? AND user_id=?),0))').get(c.id,uid,c.id,uid,c.id,uid).n;
 const last=db.prepare('SELECT text,created_at,sender_id FROM messages WHERE chat_id=? AND deleted_at IS NULL AND id>COALESCE((SELECT hidden_before FROM chat_visibility WHERE chat_id=? AND user_id=?),0) ORDER BY id DESC LIMIT 1').get(c.id,c.id,uid);
 return {id:c.id,group_id:g.id,chat_id:c.id,message_thread_id:c.id,name:general?g.general_name:c.title,description:general?'Общий поток и история группы':c.description,icon:general?'💬':c.topic_icon,general,hidden:general&&!!g.general_hidden,pinned:!!c.topic_pinned,pin_order:c.topic_pin_order,closed:!!c.topic_closed,can_manage:general?['owner','admin'].includes(g.role):canManage(c,g,uid),can_send:!c.admin_locked&&!g.admin_locked&&(!c.topic_closed||['owner','admin'].includes(g.role))&&(g.posting_policy==='all'||g.role!=='member'),notification_mode:general?preference?.notification_mode||'all':preference?.notification_override||preference?.notification_mode&&preference.notification_mode!=='all'?preference.notification_mode:'inherit',unread_count:unread,last_text:last?.text||'',last_at:last?.created_at||null,created_by:c.created_by,link:'/app?chat='+c.id};
 };
 const changed=g=>{broadcast(g,{type:'topics',chat_id:g});publish(db.prepare('SELECT user_id FROM members WHERE chat_id=?').all(g).map(r=>r.user_id),{type:'chats',chat_id:g});};
 return async(req,res,url,uid)=>{
 const m=url.pathname.match(/^\/api\/groups\/(\d+)\/topics(?:\/(\d+))?(?:\/(settings|messages|notifications|reorder))?$/);if(!m)return false;
 const gid=Number(m[1]),id=m[2]?Number(m[2]):null;if(!Number.isSafeInteger(gid)||gid<1||id!==null&&(!Number.isSafeInteger(id)||id<1))throw fail(400,'Некорректный идентификатор группы или темы');const action=m[3],data=['POST','PATCH'].includes(req.method)?await body(req):{},g=group(gid,uid);
 if(!id&&!action&&req.method==='GET'){const rows=db.prepare("SELECT * FROM chats WHERE parent_id=? AND topic_deleted=0 AND admin_deleted=0 ORDER BY topic_pinned DESC,topic_pin_order,COALESCE((SELECT MAX(created_at) FROM messages WHERE chat_id=chats.id AND deleted_at IS NULL),'') DESC,id").all(gid);json(res,200,{topics:rows.map(c=>summary(c,g,uid)),general:summary(g,g,uid),enabled:!!g.topics_enabled,role:g.role,create_policy:g.topic_create_policy,can_create:g.role==='owner'||g.topic_create_policy==='all'||g.topic_create_policy==='admins'&&g.role==='admin'});return true;}
 if(!id&&action==='settings'&&req.method==='POST'){
 if(!['owner','admin'].includes(g.role))throw fail(403,'Нужны права администратора');
 if(data.create_policy!==undefined&&!['owner','admins','all'].includes(data.create_policy))throw fail(400,'Выберите права создания тем');if(data.enabled!==undefined&&typeof data.enabled!=='boolean')throw fail(400,'Некорректное состояние режима тем');
 db.prepare('UPDATE chats SET topic_create_policy=?,topics_enabled=? WHERE id=?').run(data.create_policy??g.topic_create_policy,data.enabled===undefined?g.topics_enabled:Number(data.enabled),gid);changed(gid);json(res,200,{ok:true});return true;
 }
 if(!id&&action==='reorder'&&req.method==='POST'){
 if(!['owner','admin'].includes(g.role))throw fail(403,'Нужны права администратора');
 const ids=data.ids;if(!Array.isArray(ids)||ids.length>101||ids.some(id=>!Number.isSafeInteger(id))||new Set(ids).size!==ids.length)throw fail(400,'Некорректный порядок тем');
 const pinned=db.prepare('SELECT id FROM chats WHERE (id=? OR parent_id=?) AND topic_pinned=1 AND topic_deleted=0 AND admin_deleted=0').all(gid,gid).map(c=>c.id);
 if(pinned.length!==ids.length||ids.some(id=>!pinned.includes(id)))throw fail(400,'Укажите все закреплённые темы этой группы');
 db.exec('BEGIN IMMEDIATE');try{ids.forEach((id,i)=>db.prepare('UPDATE chats SET topic_pin_order=? WHERE id=?').run(i,id));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}changed(gid);json(res,200,{ok:true});return true;
 }
 if(!id&&!action&&req.method==='POST'){
 if(!(g.role==='owner'||g.topic_create_policy==='all'||g.topic_create_policy==='admins'&&g.role==='admin'))throw fail(403,'Недостаточно прав для создания темы');
 const f=fields(data),cid=data.client_id||randomBytes(16).toString('hex');if(typeof cid!=='string'||!/^[a-zA-Z0-9_-]{16,64}$/.test(cid))throw fail(400,'Некорректный идентификатор создания');const pair=`topic:${gid}:${uid}:${cid}`,old=db.prepare('SELECT * FROM chats WHERE pair=?').get(pair);
 if(old){if(old.topic_deleted||old.title!==f.name||old.description!==f.description||old.topic_icon!==f.icon)throw fail(409,'Идентификатор уже использован');json(res,200,summary(old,g,uid));return true;}
 if(db.prepare('SELECT COUNT(*) n FROM chats WHERE parent_id=? AND topic_deleted=0').get(gid).n>=100)throw fail(409,'В группе допускается до 100 тем');
 db.exec('BEGIN IMMEDIATE');let created;try{const inserted=db.prepare("INSERT INTO chats(pair,kind,title,description,created_by,posting_policy,parent_id,topic_icon) VALUES(?,'group',?,?,?,?,?,?)").run(pair,f.name,f.description,uid,g.posting_policy,gid,f.icon);const tid=Number(inserted.lastInsertRowid);db.prepare('INSERT INTO members(chat_id,user_id,role) SELECT ?,user_id,role FROM members WHERE chat_id=?').run(tid,gid);created=db.prepare('SELECT * FROM chats WHERE id=?').get(tid);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 db.prepare('UPDATE chats SET topics_enabled=1 WHERE id=?').run(gid);changed(gid);json(res,201,summary(created,g,uid));return true;
 }
 if(!id)throw fail(404,'Тема не найдена');const c=get(gid,id,uid);
 if(action==='messages'&&['GET','POST'].includes(req.method)){// Reuse the complete message pipeline: albums, replies, files, reactions and idempotency.
 req.volnaParsedBody=req.method==='POST'?data:undefined;url.pathname=`/api/chats/${id}/messages`;return false;
 }
 if(action==='notifications'&&req.method==='POST'){if(!['inherit','all','mentions','none'].includes(data.mode)||id===gid&&data.mode==='inherit')throw fail(400,'Выберите режим уведомлений');db.prepare('INSERT INTO chat_preferences(user_id,chat_id,notification_mode,notification_override) VALUES(?,?,?,?) ON CONFLICT(user_id,chat_id) DO UPDATE SET notification_mode=excluded.notification_mode,notification_override=excluded.notification_override').run(uid,id,data.mode,data.mode==='inherit'?0:1);publish([uid],{type:'topics',chat_id:gid});json(res,200,{mode:data.mode});return true;}
 if(!action&&req.method==='GET'){json(res,200,summary(c,g,uid));return true;}
 if(!action&&['PATCH','POST','DELETE'].includes(req.method)){
 if(!canManage(c,g,uid))throw fail(403,'Управлять темой может создатель или администратор');
 if(req.method==='DELETE'){
 if(id===gid)throw fail(400,'Системную тему удалить нельзя');
 db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE chats SET topic_deleted=1 WHERE id=?').run(id);db.prepare('UPDATE messages SET deleted_at=COALESCE(deleted_at,?) WHERE chat_id=?').run(new Date().toISOString(),id);db.prepare('DELETE FROM pins WHERE chat_id=?').run(id);db.prepare('DELETE FROM members WHERE chat_id=?').run(id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}broadcast(gid,{type:'removed',chat_id:id});changed(gid);json(res,200,{ok:true});return true;}
 const f=fields({...data,name:data.name??(id===gid?g.general_name:c.title),description:data.description??c.description,icon:data.icon??c.topic_icon});
 for(const key of ['closed','hidden','pinned'])if(data[key]!==undefined&&typeof data[key]!=='boolean')throw fail(400,'Некорректное состояние темы');
 if(data.hidden!==undefined&&id!==gid)throw fail(400,'Скрывать можно только системную тему');if(data.pinned!==undefined&&!['owner','admin'].includes(g.role))throw fail(403,'Закреплять темы могут администраторы');
 if(id===gid)db.prepare('UPDATE chats SET general_name=?,general_hidden=?,topic_closed=?,topic_pinned=? WHERE id=?').run(f.name,data.hidden===undefined?g.general_hidden:Number(data.hidden),data.closed===undefined?c.topic_closed:Number(data.closed),data.pinned===undefined?c.topic_pinned:Number(data.pinned),id);
 else db.prepare('UPDATE chats SET title=?,description=?,topic_icon=?,topic_closed=?,topic_pinned=? WHERE id=?').run(f.name,f.description,f.icon,data.closed===undefined?c.topic_closed:Number(data.closed),data.pinned===undefined?c.topic_pinned:Number(data.pinned),id);
 if(data.pinned===true&&!c.topic_pinned)db.prepare('UPDATE chats SET topic_pin_order=(SELECT COALESCE(MAX(topic_pin_order),-1)+1 FROM chats WHERE (id=? OR parent_id=?) AND topic_pinned=1 AND id<>?) WHERE id=?').run(gid,gid,id,id);
 changed(gid);json(res,200,summary(db.prepare('SELECT * FROM chats WHERE id=?').get(id),{...g,...db.prepare('SELECT * FROM chats WHERE id=?').get(gid)},uid));return true;
 }
 throw fail(404,'Действие с темой не найдено');
 };
}
