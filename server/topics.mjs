import {randomBytes} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function mentioned(text,username){return new RegExp('(^|[^a-z0-9_])@'+username+'(?![a-z0-9_])','i').test(String(text||''));}
export function topicNotification(db,chat,uid,text){const row=db.prepare('SELECT p.muted,p.notification_mode,u.username FROM users u LEFT JOIN chat_preferences p ON p.user_id=u.id AND p.chat_id=? WHERE u.id=?').get(chat,uid);return !!row&&!row.muted&&row.notification_mode!=='none'&&(row.notification_mode!=='mentions'||mentioned(text,row.username));}
export function topics({db,body,json,member,broadcast,publish}){
 db.exec(`CREATE TRIGGER IF NOT EXISTS topic_member_add AFTER INSERT ON members BEGIN
 INSERT OR IGNORE INTO members(chat_id,user_id,role) SELECT id,NEW.user_id,NEW.role FROM chats WHERE parent_id=NEW.chat_id AND topic_deleted=0; END;
 CREATE TRIGGER IF NOT EXISTS topic_member_remove AFTER DELETE ON members BEGIN
 DELETE FROM members WHERE user_id=OLD.user_id AND chat_id IN (SELECT id FROM chats WHERE parent_id=OLD.chat_id); END;
 CREATE TRIGGER IF NOT EXISTS topic_member_role AFTER UPDATE OF role ON members BEGIN
 UPDATE members SET role=NEW.role WHERE user_id=NEW.user_id AND chat_id IN (SELECT id FROM chats WHERE parent_id=NEW.chat_id AND topic_deleted=0); END;
 CREATE TRIGGER IF NOT EXISTS topic_posting_policy AFTER UPDATE OF posting_policy ON chats BEGIN
 UPDATE chats SET posting_policy=NEW.posting_policy WHERE parent_id=NEW.id; END;`);
 const group=(id,uid)=>{member(id,uid);const c=db.prepare('SELECT c.*,m.role FROM chats c JOIN members m ON m.chat_id=c.id AND m.user_id=? WHERE c.id=?').get(uid,id);if(c.kind!=='group'||c.parent_id)throw fail(400,'Подтемы доступны в основной группе');return c;};
 const get=(gid,id,uid)=>{group(gid,uid);const c=db.prepare('SELECT * FROM chats WHERE id=? AND parent_id=? AND topic_deleted=0').get(id,gid);if(!c)throw fail(404,'Подтема не найдена');member(id,uid);return c;};
 const canManage=(c,g,uid)=>g.role==='owner'||g.role==='admin'||c.created_by===uid;
 const fields=data=>{if(data.description!==undefined&&typeof data.description!=='string'||data.icon!==undefined&&typeof data.icon!=='string')throw fail(400,'Описание и иконка должны быть текстом');const name=typeof data.name==='string'?data.name.trim():'',description=typeof data.description==='string'?data.description.trim():'',icon=typeof data.icon==='string'?data.icon.trim():'';if(!name||name.length>80||description.length>1000||icon.length>16)throw fail(400,'Название: 1–80, описание: до 1000, иконка: до 16 символов');return {name,description,icon};};
 const summary=(c,g,uid)=>{const preference=db.prepare('SELECT notification_mode FROM chat_preferences WHERE chat_id=? AND user_id=?').get(c.id,uid),unread=db.prepare('SELECT COUNT(*) n FROM messages WHERE chat_id=? AND deleted_at IS NULL AND sender_id<>? AND id>COALESCE((SELECT last_read FROM members WHERE chat_id=? AND user_id=?),0)').get(c.id,uid,c.id,uid).n;return {id:c.id,group_id:g.id,chat_id:c.id,name:c.title,description:c.description,icon:c.topic_icon,closed:!!c.topic_closed,can_manage:canManage(c,g,uid),can_send:!c.admin_locked&&!g.admin_locked&&!c.topic_closed&&(g.posting_policy==='all'||g.role!=='member'),notification_mode:preference?.notification_mode||'all',unread_count:unread,created_by:c.created_by};};
 const changed=g=>{broadcast(g,{type:'topics',chat_id:g});publish(db.prepare('SELECT user_id FROM members WHERE chat_id=?').all(g).map(r=>r.user_id),{type:'chats',chat_id:g});};
 return async(req,res,url,uid)=>{
 const m=url.pathname.match(/^\/api\/groups\/(\d+)\/topics(?:\/(\d+))?(?:\/(settings|messages|notifications))?$/);if(!m)return false;
 const gid=Number(m[1]),id=m[2]?Number(m[2]):null;if(!Number.isSafeInteger(gid)||gid<1||id!==null&&(!Number.isSafeInteger(id)||id<1))throw fail(400,'Некорректный идентификатор группы или подтемы');const action=m[3],data=['POST','PATCH'].includes(req.method)?await body(req):{},g=group(gid,uid);
 if(!id&&!action&&req.method==='GET'){const rows=db.prepare('SELECT * FROM chats WHERE parent_id=? AND topic_deleted=0 AND admin_deleted=0 ORDER BY id').all(gid);json(res,200,{topics:rows.map(c=>summary(c,g,uid)),role:g.role,create_policy:g.topic_create_policy,can_create:g.role==='owner'||g.topic_create_policy==='all'||g.topic_create_policy==='admins'&&g.role==='admin'});return true;}
 if(!id&&action==='settings'&&req.method==='POST'){if(!['owner','admin'].includes(g.role))throw fail(403,'Нужны права администратора');if(!['owner','admins','all'].includes(data.create_policy))throw fail(400,'Выберите права создания подтем');db.prepare('UPDATE chats SET topic_create_policy=? WHERE id=?').run(data.create_policy,gid);changed(gid);json(res,200,{ok:true});return true;}
 if(!id&&!action&&req.method==='POST'){
 if(!(g.role==='owner'||g.topic_create_policy==='all'||g.topic_create_policy==='admins'&&g.role==='admin'))throw fail(403,'Недостаточно прав для создания подтемы');
 const f=fields(data),cid=data.client_id||randomBytes(16).toString('hex');if(typeof cid!=='string'||!/^[a-zA-Z0-9_-]{16,64}$/.test(cid))throw fail(400,'Некорректный идентификатор создания');const pair=`topic:${gid}:${uid}:${cid}`,old=db.prepare('SELECT * FROM chats WHERE pair=?').get(pair);
 if(old){if(old.topic_deleted||old.title!==f.name||old.description!==f.description||old.topic_icon!==f.icon)throw fail(409,'Идентификатор уже использован');json(res,200,summary(old,g,uid));return true;}
 if(db.prepare('SELECT COUNT(*) n FROM chats WHERE parent_id=? AND topic_deleted=0').get(gid).n>=100)throw fail(409,'В группе допускается до 100 подтем');
 db.exec('BEGIN IMMEDIATE');let created;try{const inserted=db.prepare("INSERT INTO chats(pair,kind,title,description,created_by,posting_policy,parent_id,topic_icon) VALUES(?,'group',?,?,?,?,?,?)").run(pair,f.name,f.description,uid,g.posting_policy,gid,f.icon);const tid=Number(inserted.lastInsertRowid);db.prepare('INSERT INTO members(chat_id,user_id,role) SELECT ?,user_id,role FROM members WHERE chat_id=?').run(tid,gid);created=db.prepare('SELECT * FROM chats WHERE id=?').get(tid);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 changed(gid);json(res,201,summary(created,g,uid));return true;
 }
 if(!id)throw fail(404,'Подтема не найдена');const c=get(gid,id,uid);
 if(action==='messages'&&['GET','POST'].includes(req.method)){// Reuse the complete message pipeline: albums, replies, files, reactions and idempotency.
 req.volnaParsedBody=req.method==='POST'?data:undefined;url.pathname=`/api/chats/${id}/messages`;return false;
 }
 if(action==='notifications'&&req.method==='POST'){if(!['all','mentions','none'].includes(data.mode))throw fail(400,'Выберите режим уведомлений');db.prepare('INSERT INTO chat_preferences(user_id,chat_id,notification_mode) VALUES(?,?,?) ON CONFLICT(user_id,chat_id) DO UPDATE SET notification_mode=excluded.notification_mode').run(uid,id,data.mode);publish([uid],{type:'topics',chat_id:gid});json(res,200,{mode:data.mode});return true;}
 if(!action&&req.method==='GET'){json(res,200,summary(c,g,uid));return true;}
 if(!action&&['PATCH','POST','DELETE'].includes(req.method)){
 if(!canManage(c,g,uid))throw fail(403,'Управлять подтемой может создатель или администратор');
 if(req.method==='DELETE'){
 db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE chats SET topic_deleted=1 WHERE id=?').run(id);db.prepare('UPDATE messages SET deleted_at=COALESCE(deleted_at,?) WHERE chat_id=?').run(new Date().toISOString(),id);db.prepare('DELETE FROM pins WHERE chat_id=?').run(id);db.prepare('DELETE FROM members WHERE chat_id=?').run(id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}broadcast(gid,{type:'removed',chat_id:id});changed(gid);json(res,200,{ok:true});return true;}
 const f=fields({...data,name:data.name??c.title,description:data.description??c.description,icon:data.icon??c.topic_icon});if(data.closed!==undefined&&typeof data.closed!=='boolean')throw fail(400,'Некорректное состояние подтемы');db.prepare('UPDATE chats SET title=?,description=?,topic_icon=?,topic_closed=? WHERE id=?').run(f.name,f.description,f.icon,data.closed===undefined?c.topic_closed:Number(data.closed),id);changed(gid);json(res,200,summary(db.prepare('SELECT * FROM chats WHERE id=?').get(id),g,uid));return true;
 }
 throw fail(404,'Действие с подтемой не найдено');
 };
}
