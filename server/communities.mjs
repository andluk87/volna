import {randomBytes,createHash} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const MAX_MEMBERS=300;
export function communities({db,member,broadcast,publish,json,body,userById,online=()=>false}){
 db.exec('BEGIN IMMEDIATE');
 try{
  const chatColumns=new Set(db.prepare('PRAGMA table_info(chats)').all().map(c=>c.name));
  for(const [name,type] of Object.entries({kind:"TEXT NOT NULL DEFAULT 'direct'",title:"TEXT NOT NULL DEFAULT ''",description:"TEXT NOT NULL DEFAULT ''",created_by:'INTEGER',posting_policy:"TEXT NOT NULL DEFAULT 'all'",parent_id:"INTEGER REFERENCES chats(id)",topic_icon:"TEXT NOT NULL DEFAULT ''",topic_closed:"INTEGER NOT NULL DEFAULT 0",topic_deleted:"INTEGER NOT NULL DEFAULT 0",topic_create_policy:"TEXT NOT NULL DEFAULT 'admins'"}))if(!chatColumns.has(name))db.exec(`ALTER TABLE chats ADD COLUMN ${name} ${type}`);
  const memberColumns=new Set(db.prepare('PRAGMA table_info(members)').all().map(c=>c.name));
  if(!memberColumns.has('last_delivered'))db.exec('ALTER TABLE members ADD COLUMN last_delivered INTEGER NOT NULL DEFAULT 0');
  if(!memberColumns.has('role'))db.exec("ALTER TABLE members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  db.exec(`UPDATE chats SET kind='saved' WHERE pair LIKE 'saved:%';
   CREATE UNIQUE INDEX IF NOT EXISTS one_community_owner ON members(chat_id) WHERE role='owner';
   CREATE TABLE IF NOT EXISTS community_invites(chat_id INTEGER PRIMARY KEY REFERENCES chats(id),token_hash TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL,uses INTEGER NOT NULL DEFAULT 0,max_uses INTEGER NOT NULL DEFAULT 100);
   CREATE TABLE IF NOT EXISTS community_bans(chat_id INTEGER NOT NULL REFERENCES chats(id),user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(chat_id,user_id));
   CREATE TABLE IF NOT EXISTS chat_preferences(user_id INTEGER NOT NULL REFERENCES users(id),chat_id INTEGER NOT NULL REFERENCES chats(id),archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),PRIMARY KEY(user_id,chat_id));
   `);
  const preferenceColumns=new Set(db.prepare('PRAGMA table_info(chat_preferences)').all().map(c=>c.name));
  if(!preferenceColumns.has('pinned'))db.exec('ALTER TABLE chat_preferences ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1))');
  if(!preferenceColumns.has('notification_mode'))db.exec("ALTER TABLE chat_preferences ADD COLUMN notification_mode TEXT NOT NULL DEFAULT 'all'");
  if(db.prepare('PRAGMA user_version').get().user_version<3)db.exec('PRAGMA user_version=3');
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 const current=(chat,uid)=>{
  member(chat,uid);const c=db.prepare('SELECT * FROM chats WHERE id=?').get(chat);if(c.parent_id)throw fail(400,'Используйте управление подтемами основной группы');if(!['group','channel'].includes(c.kind))throw fail(400,'Это не группа или канал');
  const role=db.prepare('SELECT role FROM members WHERE chat_id=? AND user_id=?').get(chat,uid).role;return {...c,role};
 };
 const admin=c=>{if(!['owner','admin'].includes(c.role))throw fail(403,'Нужны права администратора');};
 const owner=c=>{if(c.role!=='owner')throw fail(403,'Действие доступно только владельцу');};
 const count=chat=>db.prepare('SELECT COUNT(*) AS n FROM members WHERE chat_id=?').get(chat).n;
 const fields=data=>{const title=String(data.title||'').trim(),description=String(data.description||'').trim();if(title.length<2||title.length>80||description.length>1000)throw fail(400,'Название: 2–80 символов. Описание: до 1000 символов');return {title,description};};
 const notice=chat=>broadcast(chat,{type:'community',chat_id:chat});
 const details=c=>{
  const canManage=['admin','owner'].includes(c.role);
  return {id:c.id,kind:c.kind,title:c.title,description:c.description,role:c.role,posting_policy:c.kind==='channel'?'admins':c.posting_policy,member_count:count(c.id),max_members:MAX_MEMBERS,
   members:c.kind==='group'||canManage?db.prepare("SELECT u.id,u.username,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.name,u.id").all(c.id):[],
   banned:canManage?db.prepare('SELECT u.id,u.username,u.name FROM community_bans b JOIN users u ON u.id=b.user_id WHERE b.chat_id=?').all(c.id):[],
   invite:canManage?db.prepare('SELECT expires,uses,max_uses FROM community_invites WHERE chat_id=?').get(c.id)||null:null};
 };
 return async(req,res,url,uid)=>{
  const path=url.pathname,method=req.method;
  if(path==='/api/chats'&&method==='GET'){
   const rows=db.prepare(`SELECT c.id,c.kind,c.parent_id,c.title AS topic_name,c.topic_closed,c.topic_icon,me.role,me.last_read,
    COALESCE((SELECT MAX(last_read) FROM members WHERE chat_id=c.id AND user_id<>?),me.last_read) AS peer_read,
    COALESCE((SELECT MAX(MAX(last_read,last_delivered)) FROM members WHERE chat_id=c.id AND user_id<>me.user_id),me.last_read) AS peer_delivered,
    CASE WHEN c.kind IN ('group','channel') THEN c.id ELSE COALESCE(peer.id,?) END AS peer_id,
    CASE WHEN c.parent_id IS NOT NULL THEN (SELECT title FROM chats WHERE id=c.parent_id)||' › '||c.title WHEN c.kind='saved' THEN 'Избранное' WHEN c.kind IN ('group','channel') THEN c.title ELSE peer.name END AS name,
    CASE WHEN c.kind='direct' THEN peer.username ELSE c.kind END AS username,
    CASE WHEN c.kind='direct' AND peer.avatar_hidden=0 THEN CASE WHEN peer.avatar_id IS NOT NULL THEN '/api/files/'||peer.avatar_id ELSE NULL END END AS avatar_url,
    CASE WHEN c.kind='saved' THEN 1 ELSE 0 END AS saved,
    CASE WHEN c.topic_closed=1 OR c.admin_locked=1 OR COALESCE((SELECT admin_locked FROM chats WHERE id=c.parent_id),0)=1 THEN 0 WHEN (c.kind='channel' OR c.kind='group' AND c.posting_policy='admins') AND me.role NOT IN ('owner','admin') THEN 0 ELSE 1 END AS can_send,
    (SELECT COUNT(*) FROM members WHERE chat_id=c.id) AS member_count,
    (SELECT CASE WHEN deleted_at IS NOT NULL THEN 'Сообщение удалено' WHEN text='' THEN 'Вложение' ELSE text END FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_text,
    (SELECT created_at FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_at,
    (SELECT id FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_id,
    (SELECT sender_id FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_sender_id,
    (SELECT COUNT(*) FROM messages WHERE chat_id=c.id AND id>me.last_read AND sender_id<>? AND deleted_at IS NULL) AS unread,
    COALESCE(pref.archived,0) AS archived,COALESCE(pref.muted,0) AS muted,COALESCE(pref.pinned,0) AS pinned
    FROM chats c JOIN members me ON me.chat_id=c.id AND me.user_id=?
    LEFT JOIN chat_preferences pref ON pref.chat_id=c.id AND pref.user_id=me.user_id
    LEFT JOIN users peer ON c.kind='direct' AND peer.id=(SELECT user_id FROM members WHERE chat_id=c.id AND user_id<>? LIMIT 1)
    WHERE c.topic_deleted=0 AND c.admin_deleted=0
    ORDER BY saved DESC,pinned DESC,COALESCE(last_at,'') DESC,c.id DESC`).all(uid,uid,uid,uid,uid);
   const topicUnread=new Map(),latestTopic=new Map();for(const row of rows)if(row.parent_id){topicUnread.set(row.parent_id,(topicUnread.get(row.parent_id)||0)+row.unread);if(row.last_at&&row.last_at>(latestTopic.get(row.parent_id)?.last_at||''))latestTopic.set(row.parent_id,row);}
   const result=rows.map(row=>{const topic=latestTopic.get(row.id);return {...row,...(topic&&topic.last_at>(row.last_at||'')?{last_at:topic.last_at,last_id:topic.last_id,last_sender_id:topic.last_sender_id,last_text:topic.topic_name+': '+(topic.last_text||'Вложение'),peer_read:topic.peer_read,peer_delivered:topic.peer_delivered}:{}),unread:row.unread+(topicUnread.get(row.id)||0),peer_online:row.kind==='direct'&&online(row.peer_id)};});
   result.sort((a,b)=>b.saved-a.saved||b.pinned-a.pinned||(b.last_at||'').localeCompare(a.last_at||'')||b.id-a.id);json(res,200,result);return true;
  }
  const preferenceMatch=path.match(/^\/api\/chats\/(\d+)\/preferences$/);
  if(preferenceMatch&&method==='POST'){
   const chat=Number(preferenceMatch[1]),data=await body(req);member(chat,uid);
   if([data.archived,data.muted,data.pinned].some(v=>v!==undefined&&typeof v!=='boolean')||data.archived===undefined&&data.muted===undefined&&data.pinned===undefined)throw fail(400,'Укажите параметр чата');
   db.prepare(`INSERT INTO chat_preferences(user_id,chat_id,archived,muted,pinned) VALUES(?,?,?,?,?) ON CONFLICT(user_id,chat_id) DO UPDATE SET archived=COALESCE(?,chat_preferences.archived),muted=COALESCE(?,chat_preferences.muted),pinned=COALESCE(?,chat_preferences.pinned)`).run(uid,chat,data.archived?1:0,data.muted?1:0,data.pinned?1:0,data.archived===undefined?null:(data.archived?1:0),data.muted===undefined?null:(data.muted?1:0),data.pinned===undefined?null:(data.pinned?1:0));
   publish([uid],{type:'chats',chat_id:chat});json(res,200,db.prepare('SELECT archived,muted,pinned FROM chat_preferences WHERE user_id=? AND chat_id=?').get(uid,chat));return true;
  }
  if(path==='/api/communities'&&method==='POST'){
   const data=await body(req);if(!['group','channel'].includes(data.kind))throw fail(400,'Выберите группу или канал');
   if(typeof data.client_id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(data.client_id))throw fail(400,'Некорректный идентификатор создания');
   const {title,description}=fields(data),pair=`${data.kind}:${uid}:${data.client_id}`;
   const prior=db.prepare('SELECT * FROM chats WHERE pair=?').get(pair);
   if(prior){member(prior.id,uid);if(prior.title!==title||prior.description!==description)throw fail(409,'Идентификатор уже использован');json(res,200,{id:prior.id});return true;}
   if(db.prepare("SELECT COUNT(*) n FROM members m JOIN chats c ON c.id=m.chat_id WHERE m.user_id=? AND m.role='owner' AND c.parent_id IS NULL").get(uid).n>=100)throw fail(400,'Лимит — 100 сообществ на владельца');
   db.exec('BEGIN IMMEDIATE');let id;
   try{const result=db.prepare('INSERT INTO chats(pair,kind,title,description,created_by) VALUES(?,?,?,?,?)').run(pair,data.kind,title,description,uid);id=Number(result.lastInsertRowid);db.prepare("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'owner')").run(id,uid);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   notice(id);json(res,201,{id});return true;
  }
  if(path==='/api/invites/join'&&method==='POST'){
   const data=await body(req);const token=String(data.token||'').trim();if(!/^[a-f0-9]{48}$/.test(token))throw fail(400,'Некорректный код приглашения');
   const invite=db.prepare('SELECT * FROM community_invites WHERE token_hash=?').get(hash(token));
   if(!invite||invite.expires<Date.now())throw fail(404,'Приглашение истекло или отозвано');
   const chat=invite.chat_id;
   if(db.prepare('SELECT 1 FROM community_bans WHERE chat_id=? AND user_id=?').get(chat,uid))throw fail(403,'Вы исключены из этого сообщества');
   if(db.prepare('SELECT 1 FROM members WHERE chat_id=? AND user_id=?').get(chat,uid)){json(res,200,{id:chat});return true;}
   if(invite.uses>=invite.max_uses)throw fail(410,'Лимит приглашения исчерпан');
   if(count(chat)>=MAX_MEMBERS)throw fail(409,'Лимит — 300 участников');
   db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO members(chat_id,user_id) VALUES(?,?)').run(chat,uid);db.prepare('UPDATE community_invites SET uses=uses+1 WHERE chat_id=?').run(chat);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   notice(chat);json(res,200,{id:chat});return true;
  }
  const match=path.match(/^\/api\/communities\/(\d+)(?:\/(settings|invite|revoke-invite|add|remove|unban|role|transfer|leave))?$/);
  if(!match)return false;
  const chat=Number(match[1]),action=match[2];
  // Read authorization again AFTER the asynchronous body read: a user may be removed while uploading it.
  const data=method==='POST'?await body(req):{};
  const c=current(chat,uid);
  if(method==='GET'&&!action){json(res,200,details(c));return true;}
  if(method!=='POST')return false;
  if(action==='leave'){
   if(c.role==='owner')throw fail(409,'Сначала передайте владение другому участнику');
   db.prepare('DELETE FROM members WHERE chat_id=? AND user_id=?').run(chat,uid);publish([uid],{type:'removed',chat_id:chat});notice(chat);json(res,200,{ok:true});return true;
  }
  admin(c);
  if(action==='settings'){
   const {title,description}=fields(data);
   if(data.posting_policy!==undefined&&!['all','admins'].includes(data.posting_policy))throw fail(400,'Некорректные разрешения сообщений');
   db.prepare('UPDATE chats SET title=?,description=?,posting_policy=COALESCE(?,posting_policy) WHERE id=?').run(title,description,data.posting_policy??null,chat);
  }
  else if(action==='invite'){
   const token=randomBytes(24).toString('hex'),expires=Date.now()+7*86400000;
   db.prepare('INSERT INTO community_invites(chat_id,token_hash,expires) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET token_hash=excluded.token_hash,expires=excluded.expires,uses=0').run(chat,hash(token),expires);
   notice(chat);json(res,200,{token,expires,max_uses:100});return true;
  }else if(action==='revoke-invite'){db.prepare('DELETE FROM community_invites WHERE chat_id=?').run(chat);}
  else{
   const target=Number(data.user_id);if(!Number.isSafeInteger(target)||target<1||!userById(target))throw fail(400,'Пользователь не найден');
   const membership=db.prepare('SELECT * FROM members WHERE chat_id=? AND user_id=?').get(chat,target);
   if(action==='add'){
    if(membership){json(res,200,{ok:true});return true;}
    if(db.prepare('SELECT 1 FROM community_bans WHERE chat_id=? AND user_id=?').get(chat,target))throw fail(409,'Сначала снимите исключение пользователя');
    if(count(chat)>=MAX_MEMBERS)throw fail(409,'Лимит — 300 участников');
    db.prepare('INSERT INTO members(chat_id,user_id) VALUES(?,?)').run(chat,target);
   }else if(action==='unban'){db.prepare('DELETE FROM community_bans WHERE chat_id=? AND user_id=?').run(chat,target);}
   else if(action==='remove'){
    if(!membership)throw fail(404,'Участник не найден');
    if(target===uid||membership.role==='owner'||(c.role==='admin'&&membership.role==='admin'))throw fail(403,'Нельзя исключить этого участника');
    db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM members WHERE chat_id=? AND user_id=?').run(chat,target);db.prepare('INSERT OR IGNORE INTO community_bans VALUES(?,?)').run(chat,target);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    publish([target],{type:'removed',chat_id:chat});
   }else if(action==='role'){
    owner(c);if(!membership||membership.role==='owner'||target===uid||!['admin','member'].includes(data.role))throw fail(400,'Некорректная смена роли');
    db.prepare('UPDATE members SET role=? WHERE chat_id=? AND user_id=?').run(data.role,chat,target);
   }else if(action==='transfer'){
    owner(c);if(!membership||target===uid)throw fail(400,'Выберите другого участника');
    db.exec('BEGIN IMMEDIATE');try{db.prepare("UPDATE members SET role='admin' WHERE chat_id=? AND user_id=?").run(chat,uid);db.prepare("UPDATE members SET role='owner' WHERE chat_id=? AND user_id=?").run(chat,target);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   }else return false;
  }
  notice(chat);json(res,200,{ok:true});return true;
 };
}
