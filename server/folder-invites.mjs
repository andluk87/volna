import {randomBytes,createHash} from 'node:crypto';
import {normalizeFolders,FOLDER_LIMIT} from '../shared/folders.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
export function folderInvites({db,body,json,publish,read}){
 db.exec(`CREATE TABLE IF NOT EXISTS folder_invites(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,owner INTEGER NOT NULL REFERENCES users(id),folder_id TEXT NOT NULL,snapshot TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)`);
 const manageable=(uid,id)=>db.prepare("SELECT c.id,c.title AS name,c.kind FROM chats c JOIN members m ON m.chat_id=c.id JOIN users u ON u.id=m.user_id WHERE c.id=? AND m.user_id=? AND m.role IN ('owner','admin') AND c.kind IN ('group','channel') AND c.parent_id IS NULL AND c.admin_deleted=0 AND u.admin_blocked=0").get(id,uid);
 const available=(invite,uid)=>JSON.parse(invite.snapshot).chats.map(id=>manageable(invite.owner,id)).filter(Boolean).filter(c=>!db.prepare('SELECT 1 FROM community_bans WHERE chat_id=? AND user_id=?').get(c.id,uid)).map(c=>({...c,joined:!!db.prepare('SELECT 1 FROM members WHERE chat_id=? AND user_id=?').get(c.id,uid)}));
 return async(req,res,url,uid)=>{
  const path=url.pathname,ownerMatch=path.match(/^\/api\/folders\/([a-zA-Z0-9_-]{1,80})\/invites(?:\/([a-f0-9]{24}))?$/),joinMatch=path.match(/^\/api\/folder-invites\/([a-f0-9]{48})$/);
  if(!ownerMatch&&!joinMatch)return false;
  const data=req.method==='POST'?await body(req):{};
  if(ownerMatch){
   const folder=read(uid).folders.find(f=>f.id===ownerMatch[1]);if(!folder)throw fail(404,'Папка не найдена');
   if(req.method==='GET'&&!ownerMatch[2]){json(res,200,db.prepare('SELECT id,expires,revoked FROM folder_invites WHERE owner=? AND folder_id=? ORDER BY expires DESC').all(uid,folder.id));return true;}
   if(req.method!=='POST')throw fail(405,'Метод не поддерживается');
   if(ownerMatch[2]){const result=db.prepare('UPDATE folder_invites SET revoked=1 WHERE owner=? AND folder_id=? AND id=?').run(uid,folder.id,ownerMatch[2]);if(!result.changes)throw fail(404,'Приглашение не найдено');json(res,200,{ok:true});return true;}
   if(!Array.isArray(data.chats)||!data.chats.length||data.chats.length>100||new Set(data.chats).size!==data.chats.length)throw fail(400,'Выберите от 1 до 100 групп или каналов');
   for(const id of data.chats)if(!Number.isSafeInteger(id)||!manageable(uid,id))throw fail(403,'Делиться можно только группами и каналами, которыми вы управляете');
   if(db.prepare('SELECT COUNT(*) n FROM folder_invites WHERE owner=? AND folder_id=? AND revoked=0 AND expires>?').get(uid,folder.id,Date.now()).n>=10)throw fail(409,'Не более 10 действующих ссылок на папку');
   const token=randomBytes(24).toString('hex'),id=randomBytes(12).toString('hex'),expires=Date.now()+7*86400000;
   const snapshot={name:folder.name,icon:folder.icon,color:folder.color,chats:data.chats};
   db.prepare('INSERT INTO folder_invites(id,token_hash,owner,folder_id,snapshot,expires) VALUES(?,?,?,?,?,?)').run(id,hash(token),uid,folder.id,JSON.stringify(snapshot),expires);
   json(res,201,{id,token,expires});return true;
  }
  const invite=db.prepare('SELECT * FROM folder_invites WHERE token_hash=? AND revoked=0 AND expires>?').get(hash(joinMatch[1]),Date.now());
  if(!invite||!read(invite.owner).folders.some(f=>f.id===invite.folder_id))throw fail(410,'Приглашение истекло или отозвано');
  const snapshot=JSON.parse(invite.snapshot),chats=available(invite,uid);if(!chats.length)throw fail(410,'В этом приглашении больше нет доступных чатов');
  if(req.method==='GET'){json(res,200,{name:snapshot.name,icon:snapshot.icon,color:snapshot.color,chats,expires:invite.expires});return true;}
  if(req.method!=='POST')throw fail(405,'Метод не поддерживается');
  if(!Array.isArray(data.chats)||!data.chats.length||new Set(data.chats).size!==data.chats.length||data.chats.some(id=>!chats.some(c=>c.id===id)))throw fail(400,'Выберите доступные чаты из приглашения');
  const current=read(uid);if(data.version!==current.version)throw fail(409,'Папки изменились. Обновите приглашение');
  const id='shared_'+invite.id,existing=current.folders.find(f=>f.id===id);
  if(!existing&&current.folders.length>=FOLDER_LIMIT)throw fail(409,'Сначала освободите место для новой папки');
  for(const chat of chats.filter(c=>data.chats.includes(c.id)))if(!chat.joined&&db.prepare('SELECT COUNT(*) n FROM members WHERE chat_id=?').get(chat.id).n>=300)throw fail(409,'В одной из групп достигнут лимит участников');
  const folder=normalizeFolders([{...snapshot,...existing,id,chats:[...new Set([...(existing?.chats||[]),...data.chats])]}])[0];
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const chat of data.chats)db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)').run(chat,uid);
   const next=existing?current.folders.map(f=>f.id===id?folder:f):[...current.folders,folder];
   db.prepare('INSERT INTO account_folders(owner,version,folders) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET version=excluded.version,folders=excluded.folders').run(uid,current.version+1,JSON.stringify(next));db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  publish([uid],{type:'folders-update',version:current.version+1});publish([uid],{type:'chats'});
  for(const chat of data.chats)publish(db.prepare('SELECT user_id FROM members WHERE chat_id=?').all(chat).map(m=>m.user_id),{type:'community',chat_id:chat});
  json(res,200,{folder_id:id,...read(uid)});return true;
 };
}
