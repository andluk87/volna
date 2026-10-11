import {defaultFolders,normalizeFolders,FOLDER_LIMIT} from '../shared/folders.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function folders({db,body,json,publish}){
 db.exec('CREATE TABLE IF NOT EXISTS account_folders(owner INTEGER PRIMARY KEY REFERENCES users(id),version INTEGER NOT NULL,folders TEXT NOT NULL)');
 const read=uid=>{const row=db.prepare('SELECT version,folders FROM account_folders WHERE owner=?').get(uid);if(!row)return {version:0,folders:defaultFolders()};const owned=new Set(db.prepare('SELECT chat_id FROM members WHERE user_id=?').all(uid).map(m=>m.chat_id));return {version:row.version,folders:JSON.parse(row.folders).map(f=>({...f,chats:f.chats.filter(id=>owned.has(id)),excluded:f.excluded.filter(id=>owned.has(id)),pinned:f.pinned.filter(id=>owned.has(id))}))};};
 return async(req,res,url,uid)=>{
  if(url.pathname!=='/api/folders')return false;
  if(req.method==='GET'){json(res,200,read(uid));return true;}
  if(req.method!=='POST')throw fail(405,'Метод не поддерживается');
  const data=await body(req);
  if(!Number.isSafeInteger(data.version)||data.version<0||!Array.isArray(data.folders)||data.folders.length>FOLDER_LIMIT)throw fail(400,'Некорректные настройки папок');
  const items=normalizeFolders(data.folders);
  if(items.length!==data.folders.length)throw fail(400,'Проверьте названия и уникальность папок');
  const member=db.prepare('SELECT 1 FROM members WHERE user_id=? AND chat_id=?');
  for(const f of items)for(const id of [...f.chats,...f.excluded,...f.pinned])if(!member.get(uid,id))throw fail(400,'Можно выбирать только собственные чаты');
  db.exec('BEGIN IMMEDIATE');
  try{const current=read(uid);if(current.version!==data.version)throw fail(409,'Папки изменены на другом устройстве. Обновите список');
   db.prepare('INSERT INTO account_folders(owner,version,folders) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET version=excluded.version,folders=excluded.folders').run(uid,current.version+1,JSON.stringify(items));db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  const result=read(uid);publish([uid],{type:'folders-update',version:result.version});json(res,200,result);return true;
 };
}
